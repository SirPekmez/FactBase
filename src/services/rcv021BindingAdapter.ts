import { ResultSelection } from "../contracts/rcv021ActiveResearchContractV1";
import { Rcv020PgClient, Rcv020PgPool } from "./rcv020PostgresRepository";
import { Rcv020PersistenceInput, persistRcv020Authority } from "./rcv020PersistenceService";
import { canonicalizeRcv020Occurrence } from "./rcv020SemanticCore";
import { validateObservationBinding, validateResultSelection } from "./rcv021SemanticCore";

export async function bindRcv021SelectionToRcv020(
  clientOrPool: Rcv020PgClient | Rcv020PgPool,
  selection: ResultSelection,
  rcv020Input: Rcv020PersistenceInput,
): Promise<{ readonly occurrenceId: string; readonly persisted: true }> {
  validateResultSelection(selection, [{ resultId: selection.providerResultId } as never]);
  const occurrences = rcv020Input.occurrences ?? [];
  const occurrence = occurrences.find((candidate) => candidate.occurrenceId === selection.observationOccurrenceId);
  if (!occurrence) throw new Error("RCV020_BINDING_VIOLATION: intended occurrence is absent from binding request");
  validateObservationBinding(selection, occurrence.occurrenceId);
  const expected = canonicalizeRcv020Occurrence(occurrence);
  const client = typeof (clientOrPool as Rcv020PgPool).connect === "function" ? await (clientOrPool as Rcv020PgPool).connect() : clientOrPool as Rcv020PgClient;
  const release = (client as Rcv020PgClient & { release?: () => void }).release;
  // Serialize the complete existing RCV-020 write path per immutable occurrence
  // identity. This is a technical race guard, not a second idempotency authority.
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [occurrence.occurrenceId]);
  try {
    const existing = await client.query("SELECT canonical, canonical_hash FROM public.rcv020_observation_occurrences WHERE occurrence_id = $1", [occurrence.occurrenceId]);
    if ((existing.rows ?? []).length > 0) {
      const row = existing.rows![0];
      const persistedHash = typeof row.canonical_hash === "string" ? row.canonical_hash : Buffer.from(row.canonical_hash as Uint8Array).toString("hex");
      if (row.canonical !== expected.canonical || persistedHash !== expected.hash) throw new Error("RCV020_BINDING_VIOLATION: divergent occurrence authority");
      return Object.freeze({ occurrenceId: occurrence.occurrenceId, persisted: true as const });
    }
    // Keep the same checked-out connection so the lock covers all RCV-020 parent
    // and occurrence inserts. Hide the pool release hook from the nested service.
    const boundClient: Rcv020PgClient = { query: (text, values) => client.query(text, values) };
    await persistRcv020Authority(boundClient, rcv020Input);
    return Object.freeze({ occurrenceId: occurrence.occurrenceId, persisted: true as const });
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [occurrence.occurrenceId]); } finally { if (release) release(); }
  }
}
