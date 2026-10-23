import { runRcv021OwnedTransaction } from "./rcv021OwnedTransaction";
import { randomUUID } from "node:crypto";
import { orderRcv021Terminals, requireRcv021ReadCommitted, verifyRcv021OperationStoredContexts, lockRcv021AffectedOperations, measuredRcv021Rows, verifyRcv021PendingStoredContexts, verifyRcv021RunCreationStoredContext, verifyRcv021TerminalStoredContext } from "./rcv021TerminalWriteContext";
import { Rcv021RetainedFailure, throwRcv021RetainedFailures } from "./rcv021WriteFailures";
import { Rcv021WriteBundle, verifyRcv021WriteProposal } from "./rcv021WriteVerifier";

export interface Rcv021PgResult { readonly rows?: readonly Record<string, unknown>[]; readonly rowCount?: number | null; readonly command?: string; }
export interface Rcv021PgClient { query(text: string, values?: readonly unknown[]): Promise<Rcv021PgResult>; }
export interface Rcv021PgPool extends Rcv021PgClient { connect(): Promise<Rcv021PgClient & { release: (destroy?: boolean) => void | Promise<void> }>; }
const bytes = (hex: string): Buffer => Buffer.from(hex, "hex");
const q = async (client: Rcv021PgClient, text: string, values: readonly unknown[] = []): Promise<Rcv021PgResult> => client.query(text, values);

async function insert(client: Rcv021PgClient, table: string, idColumn: string, id: string, columns: readonly string[], values: readonly unknown[]): Promise<void> {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(",");
  // Ignore any concurrent uniqueness conflict, then compare the immutable row
  // addressed by the authoritative identity. This is required where a table
  // has additional semantic unique keys (for example observation_occurrence_id).
  const inserted = await q(client, `INSERT INTO public.${table} (${columns.join(",")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING ${idColumn}`, values);
  const returned = measuredRcv021Rows(inserted);
  if (returned.length === 1 && returned[0][idColumn] === id) return;
  if (returned.length !== 0) throw new Error("MALFORMED_DATA: insertion identity acknowledgement");
  const existing = await q(client, `SELECT canonical, canonical_hash FROM public.${table} WHERE ${idColumn} = $1`, [id]);
  if (measuredRcv021Rows(existing).length === 0) throw new Error("DUPLICATE_CONFLICT: concurrent insert disappeared");
  const rows = measuredRcv021Rows(existing);
  if (rows.length !== 1) throw new Error("DUPLICATE_CONFLICT: ambiguous immutable authority");
  const row = rows[0];
  const canonical = values[columns.indexOf("canonical")]; const hash = values[columns.indexOf("canonical_hash")];
  if (row.canonical !== canonical || !Buffer.from(row.canonical_hash as Uint8Array).equals(Buffer.from(hash as Uint8Array))) throw new Error("DUPLICATE_CONFLICT: divergent immutable authority");
}

export type AuthenticatedRcv021WriteBundle = Readonly<Rcv021WriteBundle>;

/**
 * Writes one already-authenticated RCV-021 bundle inside the caller's
 * READ COMMITTED transaction. It owns only its savepoint: it may roll back
 * that scope, but never begins/commits/rolls back the caller transaction or
 * releases the connection. The caller must exclusively use this client until
 * the returned promise settles.
 */
export async function persistRcv021BundleWithinTransaction(
  client: Rcv021PgClient,
  bundle: AuthenticatedRcv021WriteBundle,
): Promise<void> {
  const bundleSnapshot = verifyRcv021WriteProposal(bundle);
  const scope = `rcv021_${randomUUID().replace(/-/g, "")}`;
  const failures: Rcv021RetainedFailure[] = [];
  await q(client, `SAVEPOINT ${scope}`);
  try {
    await requireRcv021ReadCommitted(client);
    await persistRcv021ScopedBundle(client, bundleSnapshot);
    await q(client, `RELEASE SAVEPOINT ${scope}`);
  } catch (error) {
    failures.push({ phase: "primary", error });
    try { await q(client, `ROLLBACK TO SAVEPOINT ${scope}`); } catch (error) { failures.push({ phase: "rollback", error }); }
    try { await q(client, `RELEASE SAVEPOINT ${scope}`); } catch (error) { failures.push({ phase: "savepoint-release", error }); }
  }
  throwRcv021RetainedFailures(failures);
}

async function persistRcv021ScopedBundle(client: Rcv021PgClient, bundle: AuthenticatedRcv021WriteBundle): Promise<void> {
  for (const row of [...(bundle.operations ?? [])].sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0)) await insert(client, "research_operations", "operation_id", row.operationId, ["operation_id","subject_binding_id","trigger_binding_id","purpose","scope_canonical","operation_created_at","canonical_version","canonical","canonical_hash"], [row.operationId,row.subjectBindingId,row.triggerBindingId,row.purpose,row.scopeCanonical,row.operationCreatedAt,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.subjects ?? []) await insert(client, "research_operation_subject_bindings", "subject_binding_id", row.subjectBindingId, ["subject_binding_id","operation_id","subject_type","capture_id","observation_occurrence_id","research_trigger_request_id","operator_request_id","historical_claim_id","canonical_version","canonical","canonical_hash"], [row.subjectBindingId,row.operationId,row.subjectType,row.captureId ?? null,row.observationOccurrenceId ?? null,row.researchTriggerRequestId ?? null,row.operatorRequestId ?? null,row.historicalClaimId ?? null,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  for (const row of bundle.triggers ?? []) await insert(client, "research_operation_trigger_bindings", "trigger_binding_id", row.triggerBindingId, ["trigger_binding_id","operation_id","trigger_type","initiator_identity","authorization_canonical","execution_owner","trigger_request_id","originating_capture_id","originating_occurrence_id","rule_identity","rule_version","canonical_version","canonical","canonical_hash"], [row.triggerBindingId,row.operationId,row.triggerType,row.initiatorIdentity ?? null,row.authorizationCanonical ?? null,row.executionOwner ?? null,row.triggerRequestId ?? null,row.originatingCaptureId ?? null,row.originatingOccurrenceId ?? null,row.ruleIdentity ?? null,row.ruleVersion ?? null,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  const owners = await lockRcv021AffectedOperations(client, bundle);
  for (const row of bundle.operationLifecycleEvents ?? []) {
    // Serialize close against concurrent Run creation on the same operation.
    await q(client, "SELECT operation_id FROM public.research_operations WHERE operation_id = $1 FOR UPDATE", [row.operationId]);
    await insert(client, "research_operation_lifecycle_events", "event_id", row.eventId, ["event_id","operation_id","event_type","event_at","actor_identity","canonical_version","canonical","canonical_hash"], [row.eventId,row.operationId,row.eventType,row.eventAt,row.actorIdentity,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  }
  const newlyCreatedRuns = [];
  for (const row of bundle.runs ?? []) {
    // Lock the parent operation so close-vs-create is a single ordered race.
    await q(client, "SELECT operation_id FROM public.research_operations WHERE operation_id = $1 FOR UPDATE", [row.operationId]);
    const closed = await q(client, "SELECT event_id FROM public.research_operation_lifecycle_events WHERE operation_id = $1 AND event_type = 'CLOSED'", [row.operationId]);
    const existingRun = measuredRcv021Rows(await q(client, "SELECT canonical, canonical_hash FROM public.research_runs WHERE run_id=$1", [row.runId]));
    if (existingRun.length > 1) throw new Error("DUPLICATE_CONFLICT: Run identity");
    if (existingRun.length === 0) {
      if (measuredRcv021Rows(closed).length > 0) throw new Error("LIFECYCLE_VIOLATION: closed operation cannot create a run");
      newlyCreatedRuns.push(row);
    }
    await insert(client, "research_runs", "run_id", row.runId, ["run_id","operation_id","strategy_identity","strategy_version","provider_identity","adapter_identity","adapter_version","execution_parameters_canonical","run_created_at","deadline_at","predecessor_run_id","canonical_version","canonical","canonical_hash"], [row.runId,row.operationId,row.strategyIdentity,row.strategyVersion,row.providerIdentity,row.adapterIdentity,row.adapterVersion,row.executionParametersCanonical,row.runCreatedAt,row.deadlineAt,row.predecessorRunId ?? null,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  }
  for (const row of bundle.runLifecycleEvents ?? []) { if (await childReplayOrReject(client, row.runId, "research_run_lifecycle_events", "event_id", row.eventId, row.canonical, row.canonicalHash)) continue; await insert(client, "research_run_lifecycle_events", "event_id", row.eventId, ["event_id","run_id","event_type","event_at","execution_authority","canonical_version","canonical","canonical_hash"], [row.eventId,row.runId,row.eventType,row.eventAt,row.executionAuthority,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]); }
  for (const row of bundle.attempts ?? []) { if (await childReplayOrReject(client, row.runId, "research_attempts", "attempt_id", row.attemptId, row.canonical, row.canonicalHash)) continue; await insert(client, "research_attempts", "attempt_id", row.attemptId, ["attempt_id","run_id","attempt_number","predecessor_attempt_id","started_at","canonical_version","canonical","canonical_hash"], [row.attemptId,row.runId,row.attemptNumber.toString(),row.predecessorAttemptId ?? null,row.startedAt,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]); }
  for (const row of bundle.attemptResolutions ?? []) { if (await childReplayOrReject(client, (bundle.attempts?.find(attempt => attempt.attemptId === row.attemptId)?.runId ?? await storedAttemptRun(client, row.attemptId)), "research_attempt_resolutions", "resolution_id", row.resolutionId, row.canonical, row.canonicalHash)) continue; await insert(client, "research_attempt_resolutions", "resolution_id", row.resolutionId, ["resolution_id","attempt_id","outcome","terminal_at","failure_authority","canonical_version","canonical","canonical_hash"], [row.resolutionId,row.attemptId,row.outcome,row.terminalAt,row.failureAuthority ?? null,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]); }
  for (const row of bundle.providerResults ?? []) {
    if (await childReplayOrReject(client, row.runId, "research_provider_results", "result_id", row.resultId, row.canonical, row.canonicalHash)) continue;
    await insert(client, "research_provider_results", "result_id", row.resultId, ["result_id","run_id","provider_item_identity","provider_envelope_canonical","provider_identity","adapter_identity","adapter_version","result_observed_at","provider_source_time","protocol_result_status","canonical_version","canonical","canonical_hash"], [row.resultId,row.runId,row.providerItemIdentity,row.providerEnvelopeCanonical,row.providerIdentity,row.adapterIdentity,row.adapterVersion,row.resultObservedAt,row.providerSourceTime ?? null,row.protocolResultStatus,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  }
  await verifyRcv021OperationStoredContexts(client, bundle, owners);
  // Terminal resolution snapshots the authenticated ProviderResult set;
  // therefore it is persisted after any same-bundle ProviderResults.
  for (const row of await orderRcv021Terminals(client, owners, bundle.runTerminalResolutions ?? [])) { await verifyRcv021TerminalStoredContext(client, owners, row); await insert(client, "research_run_terminal_resolutions", "resolution_id", row.resolutionId, ["resolution_id","run_id","outcome","terminal_at","completion_authority","result_manifest_canonical","result_manifest_hash","result_count","canonical_version","canonical","canonical_hash"], [row.resolutionId,row.runId,row.outcome,row.terminalAt,row.completionAuthority,row.resultManifestCanonical,bytes(row.resultManifestHash),row.resultCount.toString(),row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]); }
  for (const row of newlyCreatedRuns) await verifyRcv021RunCreationStoredContext(client, row);
  for (const row of bundle.resultSelections ?? []) await insert(client, "research_result_selections", "selection_id", row.selectionId, ["selection_id","provider_result_id","selection_authorization","selected_artifact_identity","observation_occurrence_id","selected_at","canonical_version","canonical","canonical_hash"], [row.selectionId,row.providerResultId,row.selectionAuthorization,row.selectedArtifactIdentity,row.observationOccurrenceId,row.selectedAt,row.canonicalVersion,row.canonical,bytes(row.canonicalHash)]);
  await verifyRcv021PendingStoredContexts(client, owners);
}

/** Standalone pool-owned transaction. Caller clients use the savepoint primitive. */
export async function persistRcv021Bundle(pool: Rcv021PgPool, input: Rcv021WriteBundle): Promise<void> {
  const bundle = verifyRcv021WriteProposal(input);
  await runRcv021OwnedTransaction(pool, client => persistRcv021BundleWithinTransaction(client, bundle));
}

export const persistRcv021Write = persistRcv021Bundle;
export async function persistRcv021Operation(client: Rcv021PgPool, operation: Rcv021WriteBundle): Promise<void> { return persistRcv021Bundle(client, operation); }
export async function persistRcv021ProviderResult(client: Rcv021PgPool, result: Rcv021WriteBundle): Promise<void> { return persistRcv021Bundle(client, result); }
export async function persistRcv021ResultSelection(client: Rcv021PgPool, selection: Rcv021WriteBundle): Promise<void> { return persistRcv021Bundle(client, selection); }

async function storedAttemptRun(client: Rcv021PgClient, attemptId: string): Promise<string> {
  const rows = measuredRcv021Rows(await q(client, 'SELECT run_id::text AS "runId" FROM public.research_attempts WHERE attempt_id=$1', [attemptId]));
  if (rows.length !== 1 || typeof rows[0].runId !== "string") throw new Error("MISSING_DATA: attempt owner");
  return rows[0].runId;
}
async function childReplayOrReject(client: Rcv021PgClient, runId: string, table: string, column: string, identity: string, canonical: string, canonicalHash: string): Promise<boolean> {
  const terminal = measuredRcv021Rows(await q(client, "SELECT resolution_id FROM public.research_run_terminal_resolutions WHERE run_id=$1", [runId]));
  if (terminal.length > 1) throw new Error("DUPLICATE_CONFLICT: multiple Run terminals");
  if (terminal.length === 0) return false;
  const previous = measuredRcv021Rows(await q(client, `SELECT canonical, canonical_hash FROM public.${table} WHERE ${column}=$1`, [identity]));
  if (previous.length === 1 && previous[0].canonical === canonical && Buffer.isBuffer(previous[0].canonical_hash) && previous[0].canonical_hash.equals(bytes(canonicalHash))) return true;
  throw new Error("TERMINAL_RESOLUTION_MISMATCH: new or divergent Child authority after terminal Run");
}
