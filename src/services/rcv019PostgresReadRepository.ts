import { validateRcv019Uuid } from "../contracts/rcv019TemporalEvidenceContractV1";

export interface Rcv019ReadQueryable {
  connect(): Promise<Rcv019ReadClient>;
}

export interface Rcv019ReadClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: readonly Record<string, unknown>[]; rowCount?: number | null }>;
  release?: () => void;
}

export interface Rcv019PersistedReadBundle {
  readonly analysis: Readonly<Record<string, unknown>>;
  readonly points: readonly Readonly<Record<string, unknown>>[];
  readonly facets: readonly Readonly<Record<string, unknown>>[];
  readonly transitions: readonly Readonly<Record<string, unknown>>[];
}

export class Rcv019ReadRepositoryError extends Error {
  readonly name = "Rcv019ReadRepositoryError";
  constructor(public readonly code: "invalid_analysis_id" | "database_error", message: string, public readonly cause?: unknown) {
    super(message);
  }
}

function safeBigInt(value: unknown, field: string): number {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Rcv019ReadRepositoryError("database_error", `invalid BIGINT value for ${field}`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Rcv019ReadRepositoryError("database_error", `unsafe BIGINT value for ${field}`);
  return number;
}

function normalizeAnalysis(row: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    analysisId: row.analysis_id,
    claimId: row.claim_id,
    contractVersion: safeBigInt(row.contract_version, "contract_version"),
    canonical: row.canonical,
    timelineHash: row.timeline_hash,
    createdAt: row.created_at,
  });
}

function normalizePoint(row: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    pointId: row.point_id,
    analysisId: row.analysis_id,
    ordinal: safeBigInt(row.ordinal, "point.ordinal"),
    claimId: row.claim_id,
    claimVersionId: row.claim_version_id,
    knowledgeAt: row.knowledge_at,
    stateVersion: safeBigInt(row.state_version, "point.state_version"),
    stateCanonical: row.state_canonical,
    stateHash: row.state_hash,
  });
}

function normalizeFacet(row: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    pointId: row.point_id,
    ordinal: safeBigInt(row.ordinal, "facet.ordinal"),
    facetKind: row.facet_kind,
    facetId: row.facet_id,
    facetVersion: safeBigInt(row.facet_version, "facet.version"),
    facetHash: row.facet_hash,
  });
}

function normalizeTransition(row: Record<string, unknown>): Readonly<Record<string, unknown>> {
  let changeTypes: unknown = row.change_types;
  if (typeof changeTypes === "string") {
    try { changeTypes = JSON.parse(changeTypes); } catch { /* verifier classifies malformed JSON */ }
  }
  return Object.freeze({
    analysisId: row.analysis_id,
    ordinal: safeBigInt(row.ordinal, "transition.ordinal"),
    fromPointId: row.from_point_id,
    toPointId: row.to_point_id,
    transitionVersion: safeBigInt(row.transition_version, "transition.version"),
    changeTypes,
  });
}

/** Exact-ID, read-only reconstruction. It never selects latest/current state or repairs rows. */
export async function readRcv019Analysis(pool: Rcv019ReadQueryable, analysisId: unknown): Promise<Rcv019PersistedReadBundle | null> {
  let id: string;
  try { id = validateRcv019Uuid(analysisId, "analysisId"); }
  catch { throw new Rcv019ReadRepositoryError("invalid_analysis_id", "analysisId must be a lowercase canonical UUID"); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const analysisResult = await client.query(
      "SELECT analysis_id, claim_id, contract_version, canonical, timeline_hash, created_at FROM public.rcv019_temporal_evidence_analyses WHERE analysis_id=$1",
      [id],
    );
    if (analysisResult.rows.length === 0) {
      await client.query("COMMIT");
      return null;
    }
    const points = await client.query(
      "SELECT point_id, analysis_id, ordinal, claim_id, claim_version_id, to_char(knowledge_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS knowledge_at, state_version, state_canonical, state_hash FROM public.rcv019_temporal_evidence_points WHERE analysis_id=$1 ORDER BY ordinal",
      [id],
    );
    const facets = await client.query(
      "SELECT f.point_id, f.ordinal, f.facet_kind, f.facet_id, f.facet_version, f.facet_hash FROM public.rcv019_temporal_evidence_point_facets f JOIN public.rcv019_temporal_evidence_points p ON p.point_id=f.point_id WHERE p.analysis_id=$1 ORDER BY f.point_id, f.ordinal",
      [id],
    );
    const transitions = await client.query(
      "SELECT analysis_id, ordinal, from_point_id, to_point_id, transition_version, change_types::text AS change_types FROM public.rcv019_temporal_evidence_transitions WHERE analysis_id=$1 ORDER BY ordinal",
      [id],
    );
    await client.query("COMMIT");
    return Object.freeze({
      analysis: normalizeAnalysis(analysisResult.rows[0]),
      points: Object.freeze(points.rows.map(normalizePoint)),
      facets: Object.freeze(facets.rows.map(normalizeFacet)),
      transitions: Object.freeze(transitions.rows.map(normalizeTransition)),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Rcv019ReadRepositoryError) throw error;
    throw new Rcv019ReadRepositoryError("database_error", "RCV-019 read failed", error);
  } finally {
    client.release?.();
  }
}

export class Rcv019PostgresReadRepository {
  constructor(private readonly pool: Rcv019ReadQueryable) {}
  loadAnalysisById(analysisId: unknown): Promise<Rcv019PersistedReadBundle | null> { return readRcv019Analysis(this.pool, analysisId); }
  readAnalysis(analysisId: unknown): Promise<Rcv019PersistedReadBundle | null> { return this.loadAnalysisById(analysisId); }
}
