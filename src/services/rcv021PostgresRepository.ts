import { Rcv021WriteBundle, verifyRcv021Write } from "./rcv021WriteVerifier";

export interface Rcv021PgResult { readonly rows?: readonly Record<string, unknown>[]; readonly rowCount?: number | null; }
export interface Rcv021PgClient { query(text: string, values?: readonly unknown[]): Promise<Rcv021PgResult>; }
export interface Rcv021PgPool extends Rcv021PgClient { connect(): Promise<Rcv021PgClient & { release?: () => void }>; }
const bytes = (hex: string): Buffer => Buffer.from(hex, "hex");
const q = async (client: Rcv021PgClient, text: string, values: readonly unknown[] = []): Promise<Rcv021PgResult> => client.query(text, values);

async function insert(client: Rcv021PgClient, table: string, idColumn: string, id: string, columns: readonly string[], values: readonly unknown[]): Promise<void> {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(",");
  // Ignore any concurrent uniqueness conflict, then compare the immutable row
  // addressed by the authoritative identity. This is required where a table
  // has additional semantic unique keys (for example observation_occurrence_id).
  const inserted = await q(client, `INSERT INTO public.${table} (${columns.join(",")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING ${idColumn}`, values);
  if ((inserted.rows ?? []).length > 0) return;
  const existing = await q(client, `SELECT canonical, canonical_hash FROM public.${table} WHERE ${idColumn} = $1`, [id]);
  if ((existing.rows ?? []).length === 0) throw new Error("DUPLICATE_CONFLICT: concurrent insert disappeared");
  const row = existing.rows![0];
  const canonical = values[columns.indexOf("canonical")]; const hash = values[columns.indexOf("canonical_hash")];
  if (row.canonical !== canonical || !Buffer.from(row.canonical_hash as Uint8Array).equals(Buffer.from(hash as Uint8Array))) throw new Error("DUPLICATE_CONFLICT: divergent immutable authority");
}

export type AuthenticatedRcv021WriteBundle = Readonly<Rcv021WriteBundle>;

/**
 * Writes one already-authenticated RCV-021 bundle inside the caller's
 * transaction. This primitive deliberately has no transaction or connection
 * ownership: it never begins, commits, rolls back, or releases the client.
 */
export async function persistRcv021BundleWithinTransaction(
  client: Rcv021PgClient,
  bundle: AuthenticatedRcv021WriteBundle,
): Promise<void> {
  for (const row of bundle.operations ?? []) await insert(client, "research_operations", "operation_id", row.operationId, ["operation_id","subject_binding_id","trigger_binding_id","purpose","scope_canonical","operation_created_at","canonical_version","canonical","canonical_hash"], [row.operationId,row.subjectBindingId,row.triggerBindingId,row.purpose,row.scopeCanonical,row.operationCreatedAt,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.subjects ?? []) await insert(client, "research_operation_subject_bindings", "subject_binding_id", row.subjectBindingId, ["subject_binding_id","operation_id","subject_type","capture_id","observation_occurrence_id","research_trigger_request_id","operator_request_id","historical_claim_id","canonical_version","canonical","canonical_hash"], [row.subjectBindingId,row.operationId,row.subjectType,row.captureId ?? null,row.observationOccurrenceId ?? null,row.researchTriggerRequestId ?? null,row.operatorRequestId ?? null,row.historicalClaimId ?? null,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.triggers ?? []) await insert(client, "research_operation_trigger_bindings", "trigger_binding_id", row.triggerBindingId, ["trigger_binding_id","operation_id","trigger_type","initiator_identity","authorization_canonical","execution_owner","trigger_request_id","originating_capture_id","originating_occurrence_id","rule_identity","rule_version","canonical_version","canonical","canonical_hash"], [row.triggerBindingId,row.operationId,row.triggerType,row.initiatorIdentity ?? null,row.authorizationCanonical ?? null,row.executionOwner ?? null,row.triggerRequestId ?? null,row.originatingCaptureId ?? null,row.originatingOccurrenceId ?? null,row.ruleIdentity ?? null,row.ruleVersion ?? null,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.operationLifecycleEvents ?? []) {
    // Serialize close against concurrent Run creation on the same operation.
    await q(client, "SELECT operation_id FROM public.research_operations WHERE operation_id = $1 FOR UPDATE", [row.operationId]);
    await insert(client, "research_operation_lifecycle_events", "event_id", row.eventId, ["event_id","operation_id","event_type","event_at","actor_identity","canonical_version","canonical","canonical_hash"], [row.eventId,row.operationId,row.eventType,row.eventAt,row.actorIdentity,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  }
  for (const row of bundle.runs ?? []) {
    // Lock the parent operation so close-vs-create is a single ordered race.
    await q(client, "SELECT operation_id FROM public.research_operations WHERE operation_id = $1 FOR UPDATE", [row.operationId]);
    const closed = await q(client, "SELECT event_id FROM public.research_operation_lifecycle_events WHERE operation_id = $1 AND event_type = 'CLOSED'", [row.operationId]);
    if ((closed.rows ?? []).length > 0) throw new Error("LIFECYCLE_VIOLATION: closed operation cannot create a run");
    await insert(client, "research_runs", "run_id", row.runId, ["run_id","operation_id","strategy_identity","strategy_version","provider_identity","adapter_identity","adapter_version","execution_parameters_canonical","run_created_at","deadline_at","predecessor_run_id","canonical_version","canonical","canonical_hash"], [row.runId,row.operationId,row.strategyIdentity,row.strategyVersion,row.providerIdentity,row.adapterIdentity,row.adapterVersion,row.executionParametersCanonical,row.runCreatedAt,row.deadlineAt,row.predecessorRunId ?? null,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  }
  for (const row of bundle.runLifecycleEvents ?? []) await insert(client, "research_run_lifecycle_events", "event_id", row.eventId, ["event_id","run_id","event_type","event_at","execution_authority","canonical_version","canonical","canonical_hash"], [row.eventId,row.runId,row.eventType,row.executionAuthority,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.attempts ?? []) await insert(client, "research_attempts", "attempt_id", row.attemptId, ["attempt_id","run_id","attempt_number","predecessor_attempt_id","started_at","canonical_version","canonical","canonical_hash"], [row.attemptId,row.runId,row.attemptNumber.toString(),row.predecessorAttemptId ?? null,row.startedAt,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.attemptResolutions ?? []) await insert(client, "research_attempt_resolutions", "resolution_id", row.resolutionId, ["resolution_id","attempt_id","outcome","terminal_at","failure_authority","canonical_version","canonical","canonical_hash"], [row.resolutionId,row.attemptId,row.outcome,row.terminalAt,row.failureAuthority ?? null,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.providerResults ?? []) {
    const terminal = await q(client, "SELECT resolution_id FROM public.research_run_terminal_resolutions WHERE run_id = $1", [row.runId]);
    if ((terminal.rows ?? []).length > 0) throw new Error("TERMINAL_RESOLUTION_MISMATCH: late ProviderResult is forbidden");
    await insert(client, "research_provider_results", "result_id", row.resultId, ["result_id","run_id","provider_item_identity","provider_envelope_canonical","provider_identity","adapter_identity","adapter_version","result_observed_at","provider_source_time","protocol_result_status","canonical_version","canonical","canonical_hash"], [row.resultId,row.runId,row.providerItemIdentity,row.providerEnvelopeCanonical,row.providerIdentity,row.adapterIdentity,row.adapterVersion,row.resultObservedAt,row.providerSourceTime ?? null,row.protocolResultStatus,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  }
  // Terminal resolution snapshots the authenticated ProviderResult set;
  // therefore it is persisted after any same-bundle ProviderResults.
  for (const row of bundle.runTerminalResolutions ?? []) await insert(client, "research_run_terminal_resolutions", "resolution_id", row.resolutionId, ["resolution_id","run_id","outcome","terminal_at","completion_authority","result_manifest_canonical","result_manifest_hash","result_count","canonical_version","canonical","canonical_hash"], [row.resolutionId,row.runId,row.outcome,row.terminalAt,row.completionAuthority,row.resultManifestCanonical,bytes(row.resultManifestHash),row.resultCount.toString(),row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.resultSelections ?? []) await insert(client, "research_result_selections", "selection_id", row.selectionId, ["selection_id","provider_result_id","selection_authorization","selected_artifact_identity","observation_occurrence_id","selected_at","canonical_version","canonical","canonical_hash"], [row.selectionId,row.providerResultId,row.selectionAuthorization,row.selectedArtifactIdentity,row.observationOccurrenceId,row.selectedAt,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
}

/** Persists one authenticated RCV-021 bundle. Caller may provide a transaction-bound client. */
export async function persistRcv021Bundle(clientOrPool: Rcv021PgClient | Rcv021PgPool, input: Rcv021WriteBundle): Promise<void> {
  const bundle = verifyRcv021Write(input);
  const client = typeof (clientOrPool as Rcv021PgPool).connect === "function" ? await (clientOrPool as Rcv021PgPool).connect() : clientOrPool as Rcv021PgClient;
  try {
    await q(client, "BEGIN");
    try {
      await persistRcv021BundleWithinTransaction(client, bundle);
      await q(client, "COMMIT");
    } catch (error) { try { await q(client, "ROLLBACK"); } catch { /* preserve original */ } throw error; }
  } finally { const release = (client as Rcv021PgClient & { release?: () => void }).release; if (release) release(); }
}

export const persistRcv021Write = persistRcv021Bundle;
export async function persistRcv021Operation(client: Rcv021PgClient | Rcv021PgPool, operation: Rcv021WriteBundle): Promise<void> { return persistRcv021Bundle(client, operation); }
export async function persistRcv021ProviderResult(client: Rcv021PgClient | Rcv021PgPool, result: Rcv021WriteBundle): Promise<void> { return persistRcv021Bundle(client, result); }
export async function persistRcv021ResultSelection(client: Rcv021PgClient | Rcv021PgPool, selection: Rcv021WriteBundle): Promise<void> { return persistRcv021Bundle(client, selection); }
