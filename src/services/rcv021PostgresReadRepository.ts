import { runRcv021OwnedTransaction } from "./rcv021OwnedTransaction";
import type { Rcv021PgClient, Rcv021PgPool } from "./rcv021PostgresRepository";

export interface Rcv021HistoricalGraph {
  readonly operation: Record<string, unknown>;
  readonly subject: Record<string, unknown>;
  readonly trigger: Record<string, unknown>;
  readonly operationLifecycleEvents: readonly Record<string, unknown>[];
  readonly runs: readonly Record<string, unknown>[];
  readonly runLifecycleEvents: readonly Record<string, unknown>[];
  readonly terminalResolutions: readonly Record<string, unknown>[];
  readonly attempts: readonly Record<string, unknown>[];
  readonly attemptResolutions: readonly Record<string, unknown>[];
  readonly providerResults: readonly Record<string, unknown>[];
  readonly resultSelections: readonly Record<string, unknown>[];
  readonly rcv020Occurrences: readonly Record<string, unknown>[];
}

const one = async (client: Rcv021PgClient, sql: string, values: readonly unknown[]): Promise<Record<string, unknown> | null> => {
  const result = await client.query(sql, values);
  if (!result || !Array.isArray(result.rows)) throw new Rcv021ReadRepositoryError("unmeasured historical row set");
  if (result.rows.length > 1) throw new Rcv021ReadRepositoryError("ambiguous historical row set");
  return result.rows.length === 1 ? result.rows[0] : null;
};
const many = async (client: Rcv021PgClient, sql: string, values: readonly unknown[]): Promise<readonly Record<string, unknown>[]> => {
  const result = await client.query(sql, values);
  if (!result || !Array.isArray(result.rows)) throw new Rcv021ReadRepositoryError("unmeasured historical row set");
  return result.rows;
};
const id = (value: unknown): string => String(value);
const hex = (value: unknown): string => typeof value === "string" ? value : Buffer.from(value as Uint8Array).toString("hex");
const ts = (column: string): string => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export class Rcv021ReadRepositoryError extends Error { readonly code = "MISSING_DATA" as const; }

/** Exact-ID, read-only historical retrieval. No verification, repair, or current-state lookup. */
export class Rcv021PostgresReadRepository {
  constructor(private readonly pool: Rcv021PgPool) {}

  async loadByOperationId(operationId: string): Promise<Rcv021HistoricalGraph | null> {
    return runRcv021OwnedTransaction(this.pool, client => loadRcv021HistoricalGraphWithinTransaction(client, operationId), "snapshot-read");
  }
}

/** Same-client retrieval only: caller owns transaction, locks and cleanup. */
export async function loadRcv021HistoricalGraphWithinTransaction(client: Rcv021PgClient, operationId: string): Promise<Rcv021HistoricalGraph | null> {
      const operation = await one(client, `SELECT operation_id::text AS "operationId", subject_binding_id::text AS "subjectBindingId", trigger_binding_id::text AS "triggerBindingId", purpose, scope_canonical AS "scopeCanonical", ${ts("operation_created_at")} AS "operationCreatedAt", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_operations WHERE operation_id=$1`, [operationId]);
      if (!operation) return null;
      const subject = await one(client, `SELECT subject_binding_id::text AS "subjectBindingId", operation_id::text AS "operationId", subject_type AS "subjectType", capture_id::text AS "captureId", observation_occurrence_id::text AS "observationOccurrenceId", research_trigger_request_id::text AS "researchTriggerRequestId", operator_request_id::text AS "operatorRequestId", historical_claim_id::text AS "historicalClaimId", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_operation_subject_bindings WHERE operation_id=$1`, [operationId]);
      const trigger = await one(client, `SELECT trigger_binding_id::text AS "triggerBindingId", operation_id::text AS "operationId", trigger_type AS "triggerType", initiator_identity AS "initiatorIdentity", authorization_canonical AS "authorizationCanonical", execution_owner AS "executionOwner", trigger_request_id::text AS "triggerRequestId", originating_capture_id::text AS "originatingCaptureId", originating_occurrence_id::text AS "originatingOccurrenceId", rule_identity AS "ruleIdentity", rule_version AS "ruleVersion", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_operation_trigger_bindings WHERE operation_id=$1`, [operationId]);
      if (!subject || !trigger) throw new Rcv021ReadRepositoryError("operation binding missing");
      // TriggerBinding's optional semantic fields are carried by its immutable
      // canonical envelope (the physical migration intentionally has no
      // duplicate convenience columns). Rehydrate them from that envelope so
      // the independent verifier can reconstruct the exact authority.
      try {
        const envelope = JSON.parse(String(trigger.canonical)) as Record<string, unknown>;
        for (const key of ["creationTime", "executionContext"]) if (Object.prototype.hasOwnProperty.call(envelope, key)) trigger[key] = envelope[key];
      } catch { /* verifier reports malformed/canonical failure deterministically */ }
      const operationLifecycleEvents = await many(client, `SELECT event_id::text AS "eventId", operation_id::text AS "operationId", event_type AS "eventType", ${ts("event_at")} AS "eventAt", actor_identity AS "actorIdentity", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_operation_lifecycle_events WHERE operation_id=$1 ORDER BY event_id::text`, [operationId]);
      const runs = await many(client, `SELECT run_id::text AS "runId", operation_id::text AS "operationId", strategy_identity AS "strategyIdentity", strategy_version AS "strategyVersion", provider_identity AS "providerIdentity", adapter_identity AS "adapterIdentity", adapter_version AS "adapterVersion", execution_parameters_canonical AS "executionParametersCanonical", ${ts("run_created_at")} AS "runCreatedAt", ${ts("deadline_at")} AS "deadlineAt", predecessor_run_id::text AS "predecessorRunId", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_runs WHERE operation_id=$1 ORDER BY run_id::text`, [operationId]);
      const runIds = runs.map((r) => r.runId).filter(Boolean);
      const runLifecycleEvents = runIds.length ? await many(client, `SELECT event_id::text AS "eventId", run_id::text AS "runId", event_type AS "eventType", ${ts("event_at")} AS "eventAt", execution_authority AS "executionAuthority", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_run_lifecycle_events WHERE run_id = ANY($1::uuid[]) ORDER BY event_id::text`, [runIds]) : [];
      const terminalResolutions = runIds.length ? await many(client, `SELECT resolution_id::text AS "resolutionId", run_id::text AS "runId", outcome, ${ts("terminal_at")} AS "terminalAt", completion_authority AS "completionAuthority", result_manifest_canonical AS "resultManifestCanonical", encode(result_manifest_hash,'hex') AS "resultManifestHash", result_count::text AS "resultCount", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_run_terminal_resolutions WHERE run_id = ANY($1::uuid[]) ORDER BY resolution_id::text`, [runIds]) : [];
      const attempts = runIds.length ? await many(client, `SELECT attempt_id::text AS "attemptId", run_id::text AS "runId", attempt_number::text AS "attemptNumber", predecessor_attempt_id::text AS "predecessorAttemptId", ${ts("started_at")} AS "startedAt", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_attempts WHERE run_id = ANY($1::uuid[]) ORDER BY attempt_id::text`, [runIds]) : [];
      const attemptIds = attempts.map((a) => a.attemptId).filter(Boolean);
      const attemptResolutions = attemptIds.length ? await many(client, `SELECT resolution_id::text AS "resolutionId", attempt_id::text AS "attemptId", outcome, ${ts("terminal_at")} AS "terminalAt", failure_authority AS "failureAuthority", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_attempt_resolutions WHERE attempt_id = ANY($1::uuid[]) ORDER BY resolution_id::text`, [attemptIds]) : [];
      const providerResults = runIds.length ? await many(client, `SELECT result_id::text AS "resultId", run_id::text AS "runId", provider_item_identity AS "providerItemIdentity", provider_envelope_canonical AS "providerEnvelopeCanonical", provider_identity AS "providerIdentity", adapter_identity AS "adapterIdentity", adapter_version AS "adapterVersion", ${ts("result_observed_at")} AS "resultObservedAt", ${ts("provider_source_time")} AS "providerSourceTime", protocol_result_status AS "protocolResultStatus", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_provider_results WHERE run_id = ANY($1::uuid[]) ORDER BY result_id::text`, [runIds]) : [];
      const resultIds = providerResults.map((r) => r.resultId).filter(Boolean);
      const resultSelections = resultIds.length ? await many(client, `SELECT selection_id::text AS "selectionId", provider_result_id::text AS "providerResultId", selection_authorization AS "selectionAuthorization", selected_artifact_identity AS "selectedArtifactIdentity", observation_occurrence_id::text AS "observationOccurrenceId", ${ts("selected_at")} AS "selectedAt", canonical_version AS "canonicalVersion", canonical, encode(canonical_hash,'hex') AS "canonicalHash" FROM public.research_result_selections WHERE provider_result_id = ANY($1::uuid[]) ORDER BY selection_id::text`, [resultIds]) : [];
      const occurrenceIds = resultSelections.map((s) => s.observationOccurrenceId).filter(Boolean);
      const rcv020Occurrences = occurrenceIds.length ? await many(client, `SELECT occurrence_id::text AS "occurrenceId", logical_source_id::text AS "logicalSourceId", monitor_id::text AS "monitorId", monitor_configuration_version_id::text AS "monitorConfigurationVersionId", trigger_origin AS "triggerOrigin", trigger_canonical AS "triggerCanonical", trigger_hash AS "triggerHash", ${ts("trigger_received_at")} AS "triggerReceivedAt", ${ts("scheduled_at")} AS "scheduledAt", ${ts("requested_at")} AS "requestedAt", ${ts("due_at")} AS "dueAt", ${ts("evaluation_cutoff_at")} AS "evaluationCutoffAt", canonical, canonical_hash AS "canonicalHash" FROM public.rcv020_observation_occurrences WHERE occurrence_id = ANY($1::uuid[]) ORDER BY occurrence_id::text`, [occurrenceIds]) : [];
      return { operation, subject, trigger, operationLifecycleEvents, runs, runLifecycleEvents, terminalResolutions, attempts, attemptResolutions, providerResults, resultSelections, rcv020Occurrences };
}
