import type { Pool, PoolClient, QueryResult } from "pg";
import type { Rcv018AuthenticatedWriteProjection, Rcv018ExistingFindingInput } from "./rcv018WriteVerifier";

export type Rcv018PersistenceFailureCode =
  | "prerequisite_missing" | "duplicate_conflict" | "constraint_rejection"
  | "transaction_failure" | "database_error" | "affected_row_count"
  | "malformed_projection";

export class Rcv018PersistenceError extends Error {
  constructor(public readonly code: Rcv018PersistenceFailureCode, message: string, public readonly cause?: unknown) {
    super(message); this.name = "Rcv018PersistenceError";
  }
}

type Queryable = Pick<Pool, "connect">;
type Client = Pick<PoolClient, "query" | "release">;

function fail(code: Rcv018PersistenceFailureCode, message: string, cause?: unknown): never {
  throw new Rcv018PersistenceError(code, message, cause);
}
function exactRows(result: QueryResult, expected: number, label: string): void {
  if (result.rowCount !== expected) fail("affected_row_count", `${label}: expected ${expected} affected rows, received ${result.rowCount}`);
}
function projection(value: unknown): Rcv018AuthenticatedWriteProjection {
  if (!value || typeof value !== "object") fail("malformed_projection", "write projection must be an object");
  const item = value as Partial<Rcv018AuthenticatedWriteProjection>;
  if (!item.analysis || typeof item.analysisCanonical !== "string" || typeof item.analysisHash !== "string") fail("malformed_projection", "missing authenticated analysis projection");
  if (!Array.isArray(item.assertions) || !Array.isArray(item.valueDomains) || !Array.isArray(item.comparisonDomains) || !Array.isArray(item.findingsToInsertAuthenticated) || !Array.isArray(item.existingFindings)) fail("malformed_projection", "incomplete write projection");
  return item as Rcv018AuthenticatedWriteProjection;
}

async function requireOne(client: Client, sql: string, params: unknown[], label: string): Promise<void> {
  const result = await client.query(sql, params);
  if (result.rowCount !== 1) fail("prerequisite_missing", `${label}: prerequisite does not exist`);
}

function findingParams(record: Rcv018ExistingFindingInput): unknown[] {
  const f = record.value;
  return [record.hash, f.assertionAId, f.assertionAHash, f.assertionBId, f.assertionBHash, f.comparisonDomainId, f.comparisonDomainVersion, f.comparisonDomainHash, f.incompatibilityLeft, f.incompatibilityRight, record.canonical];
}

/** Append-only persistence of an authenticated RCV-018 write projection. */
export async function persistRcv018Analysis(pool: Queryable, rawProjection: unknown): Promise<{ analysisId: string; analysisHash: string }> {
  const p = projection(rawProjection);
  let client: Client | undefined; let began = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED"); began = true;

    for (const domain of p.valueDomains) await requireOne(client, "SELECT 1 FROM public.rcv018_value_domains WHERE value_domain_id=$1 AND value_domain_version=$2", [domain.valueDomainId, domain.valueDomainVersion], "ValueDomain");
    for (const domain of p.comparisonDomains) await requireOne(client, "SELECT 1 FROM public.rcv018_comparison_domains WHERE comparison_domain_id=$1 AND comparison_domain_version=$2", [domain.comparisonDomainId, domain.comparisonDomainVersion], "ComparisonDomain");
    for (const assertion of p.assertions) await requireOne(client, "SELECT 1 FROM public.rcv018_evidence_assertions WHERE assertion_id=$1", [assertion.assertionId], "EvidenceAssertion");

    for (const finding of p.findingsToInsertAuthenticated) {
      const result = await client.query(`INSERT INTO public.rcv018_contradiction_findings
        (finding_hash, assertion_a_id, assertion_a_hash, assertion_b_id, assertion_b_hash,
         comparison_domain_id, comparison_domain_version, comparison_domain_hash,
         incompatibility_left, incompatibility_right, canonical)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, findingParams(finding));
      exactRows(result, 1, "ContradictionFinding insert");
    }

    const a = p.analysis;
    const analysisResult = await client.query(`INSERT INTO public.rcv018_analyses
      (analysis_id, contract_id, contract_version, contract_hash, algorithm_id, algorithm_version, algorithm_hash, canonical, analysis_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [a.analysisId, a.contractBinding.contractId, a.contractBinding.contractVersion, a.contractBinding.contractHash, a.algorithmBinding.algorithmId, a.algorithmBinding.algorithmVersion, a.algorithmBinding.algorithmHash, p.analysisCanonical, p.analysisHash]);
    exactRows(analysisResult, 1, "Analysis insert");

    for (const row of p.assertions) exactRows(await client.query("INSERT INTO public.rcv018_analysis_assertions (analysis_id, ordinal, assertion_id, assertion_hash) VALUES ($1,$2,$3,$4)", [a.analysisId, p.assertions.indexOf(row), row.assertionId, row.assertionHash]), 1, "analysis assertion insert");
    for (const row of p.valueDomains) exactRows(await client.query("INSERT INTO public.rcv018_analysis_value_domains (analysis_id, ordinal, value_domain_id, value_domain_version, value_domain_hash) VALUES ($1,$2,$3,$4,$5)", [a.analysisId, p.valueDomains.indexOf(row), row.valueDomainId, row.valueDomainVersion, row.valueDomainHash]), 1, "analysis ValueDomain insert");
    for (const row of p.comparisonDomains) exactRows(await client.query("INSERT INTO public.rcv018_analysis_comparison_domains (analysis_id, ordinal, comparison_domain_id, comparison_domain_version, comparison_domain_hash) VALUES ($1,$2,$3,$4,$5)", [a.analysisId, p.comparisonDomains.indexOf(row), row.comparisonDomainId, row.comparisonDomainVersion, row.comparisonDomainHash]), 1, "analysis ComparisonDomain insert");
    for (let i = 0; i < p.findingHashes.length; i += 1) exactRows(await client.query("INSERT INTO public.rcv018_analysis_findings (analysis_id, ordinal, finding_hash) VALUES ($1,$2,$3)", [a.analysisId, i, p.findingHashes[i]]), 1, "analysis finding insert");

    await client.query("COMMIT"); began = false;
    return { analysisId: a.analysisId, analysisHash: p.analysisHash };
  } catch (error) {
    if (began && client) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Rcv018PersistenceError) throw error;
    const code: Rcv018PersistenceFailureCode = (error as { code?: string })?.code === "23505" ? "duplicate_conflict" : ((error as { code?: string })?.code?.startsWith("23") ? "constraint_rejection" : "database_error");
    throw new Rcv018PersistenceError(code, "RCV-018 persistence failed", error);
  } finally { client?.release(); }
}

export class Rcv018PostgresRepository {
  constructor(private readonly pool: Queryable) {}
  persist(projection: unknown): Promise<{ analysisId: string; analysisHash: string }> { return persistRcv018Analysis(this.pool, projection); }
  persistAnalysis(projection: unknown): Promise<{ analysisId: string; analysisHash: string }> { return this.persist(projection); }
}
