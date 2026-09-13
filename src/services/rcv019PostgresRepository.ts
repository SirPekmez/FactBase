import { Rcv019ValidationError } from "../contracts/rcv019TemporalEvidenceContractV1";
import { Rcv019VerifiedWrite } from "./rcv019WriteVerifier";

export interface Rcv019PgClient { query(text: string, values?: readonly unknown[]): Promise<{ rows?: readonly Record<string, unknown>[] }> }

/** Persists one already-authenticated projection atomically; no semantic writes occur here. */
export async function persistRcv019Timeline(client: Rcv019PgClient, verified: Rcv019VerifiedWrite, createdAt: string): Promise<void> {
  if (typeof createdAt !== "string" || createdAt.length === 0) throw new Rcv019ValidationError("createdAt", "persistence metadata is required");
  const { analysis, pointRows, facetRows, transitionRows } = verified;
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO public.rcv019_temporal_evidence_analyses (analysis_id,claim_id,contract_version,canonical,timeline_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [analysis.analysisId, analysis.claimId, analysis.contractVersion, analysis.canonical, analysis.timelineHash, createdAt]);
    for (const row of pointRows) await client.query("INSERT INTO public.rcv019_temporal_evidence_points (point_id,analysis_id,ordinal,claim_id,claim_version_id,knowledge_at,state_version,state_canonical,state_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [row.pointId, row.analysisId, row.ordinal, row.claimId, row.claimVersionId, row.knowledgeAt, row.stateVersion, row.stateCanonical, row.stateHash]);
    for (const row of facetRows) await client.query("INSERT INTO public.rcv019_temporal_evidence_point_facets (point_id,ordinal,facet_kind,facet_id,facet_version,facet_hash) VALUES ($1,$2,$3,$4,$5,$6)", [row.pointId, row.ordinal, row.facetKind, row.facetId, row.facetVersion, row.facetHash]);
    for (const row of transitionRows) await client.query("INSERT INTO public.rcv019_temporal_evidence_transitions (analysis_id,ordinal,from_point_id,to_point_id,transition_version,change_types) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", [row.analysisId, row.ordinal, row.fromPointId, row.toPointId, row.transitionVersion, JSON.stringify(row.changeTypes)]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original persistence failure */ }
    throw error;
  }
}

export const persistRcv019Write = persistRcv019Timeline;
