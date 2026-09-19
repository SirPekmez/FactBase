import type {
  Rcv020AttemptResolution,
  Rcv020Capture,
  Rcv020CaptureComparison,
  Rcv020LifecycleEvent,
  Rcv020MonitorConfigurationVersion,
  Rcv020ObservationOccurrence,
  Rcv020OccurrenceOutcome,
  Rcv020RetentionAvailabilityEvent,
  Rcv020RetrievalAttempt,
} from "../contracts/rcv020ObservatoryContractV1";

export interface Rcv020ReadClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: readonly Record<string, unknown>[]; rowCount?: number | null }>;
  release?: () => void;
}
export interface Rcv020ReadPool { connect(): Promise<Rcv020ReadClient>; }

export interface Rcv020ReadSource {
  readonly logicalSourceId: string;
  readonly organizationIdentity: string;
  readonly sourceClass: string;
  readonly jurisdiction: string | null;
  readonly createdAt: string;
  readonly identityCanonical: unknown;
  readonly identityHash: string;
}
export interface Rcv020ReadMonitor {
  readonly monitorId: string;
  readonly logicalSourceId: string;
  readonly monitorKind: string;
  readonly createdAt: string;
  readonly identityCanonical: unknown;
  readonly identityHash: string;
}
export interface Rcv020ReadConfiguration extends Rcv020MonitorConfigurationVersion {
  readonly createdAt: string;
  readonly endpointRequestCanonical: string;
  readonly endpointRequestHash: string;
}
export interface Rcv020ReadOccurrence extends Rcv020ObservationOccurrence {
  readonly triggerCanonical: string;
  readonly triggerHash: string;
  readonly evaluationPolicyVersion: number;
  readonly createdAt: string;
  readonly canonical: string;
  readonly canonicalHash: string;
}
export interface Rcv020ReadOccurrenceResolution {
  readonly resolutionId: string;
  readonly occurrenceId: string;
  readonly outcome: Rcv020OccurrenceOutcome;
  readonly evaluationCutoffAt: string;
  readonly evaluatedAt: string;
  readonly skipReason: string | null;
  readonly skipActorPolicyIdentity: string | null;
  readonly terminalizationPolicyVersion: number;
  readonly canonical: string;
  readonly canonicalHash: string;
  readonly createdAt: string;
}
export interface Rcv020ReadAttempt extends Rcv020RetrievalAttempt {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly requestCanonical: string;
  readonly requestHash: string;
  readonly createdAt: string;
  readonly canonical: string;
  readonly canonicalHash: string;
}
export interface Rcv020ReadAttemptResolution extends Rcv020AttemptResolution {
  readonly attemptResolutionId: string;
  readonly failureTaxonomyVersion: number | null;
  readonly diagnosticCanonical: string | null;
  readonly canonical: string;
  readonly canonicalHash: string;
  readonly createdAt: string;
}
export interface Rcv020ReadCapture extends Rcv020Capture {
  readonly requestHash: string;
  readonly requestedTarget: string;
  readonly finalUrl: string | null;
  readonly redirectCanonical: string | null;
  readonly responseStatus: number;
  readonly responseMetadataCanonical: string;
  readonly mediaType: string;
  readonly captureCanonical: string;
  readonly captureHash: string;
  readonly retentionPolicy: string;
  readonly retentionPolicyVersion: number;
  readonly rawObjectReference: string | null;
  readonly createdAt: string;
}
export interface Rcv020ReadComparison extends Rcv020CaptureComparison {
  readonly inputCanonical: string;
  readonly inputHash: string;
  readonly canonical: string;
  readonly canonicalHash: string;
  readonly createdAt: string;
}
export interface Rcv020ReadRetentionEvent extends Rcv020RetentionAvailabilityEvent {
  readonly reason: string;
  readonly policyLegalBasis: string | null;
  readonly resultingAvailability: string;
  readonly canonical: string;
  readonly canonicalHash: string;
  readonly createdAt: string;
}
export interface Rcv020ReadHandoff {
  readonly handoffId: string;
  readonly captureId: string;
  readonly logicalSourceId: string;
  readonly monitorId: string;
  readonly monitorConfigurationVersionId: string;
  readonly occurrenceId: string;
  readonly retrievalAttemptId: string;
  readonly captureHash: string;
  readonly rawObjectIdentity: string | null;
  readonly rawAvailabilitySnapshot: string;
  readonly observedAt: string;
  readonly sourcePublishedAt: string | null;
  readonly sourceArtifactIdentity: string | null;
  readonly derivedExtractionReference: string | null;
  readonly derivedExtractionVersion: string | null;
  readonly derivedExtractionHash: string | null;
  readonly provenanceManifest: string;
  readonly handoffCanonical: string;
  readonly handoffHash: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}
export interface Rcv020ReadQuarantine {
  readonly quarantineId: string;
  readonly attemptId: string;
  readonly reason: string;
  readonly policyCanonical: string;
  readonly objectIdentity: string | null;
  readonly payloadHash: string | null;
  readonly byteLength: string | null;
  readonly createdAt: string;
}

export interface Rcv020HistoricalBundle {
  readonly contractVersion: 1;
  readonly source: Rcv020ReadSource;
  readonly monitor: Rcv020ReadMonitor;
  readonly configuration: Rcv020ReadConfiguration;
  readonly configurations?: readonly Rcv020ReadConfiguration[];
  readonly lifecycleEvents: readonly Rcv020LifecycleEvent[];
  readonly occurrence: Rcv020ReadOccurrence;
  readonly occurrenceResolution: Rcv020ReadOccurrenceResolution | null;
  readonly occurrenceResolutions?: readonly Rcv020ReadOccurrenceResolution[];
  readonly attempts: readonly Rcv020ReadAttempt[];
  readonly attemptResolutions: readonly Rcv020ReadAttemptResolution[];
  readonly captures: readonly Rcv020ReadCapture[];
  readonly comparisons: readonly Rcv020ReadComparison[];
  readonly retentionEvents: readonly Rcv020ReadRetentionEvent[];
  readonly handoffs: readonly Rcv020ReadHandoff[];
  readonly quarantine: readonly Rcv020ReadQuarantine[];
}

const utc = (name: string): string => `to_char(${name} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const hex = (name: string): string => `encode(${name}, 'hex')`;
const row = (r: Record<string, unknown>, key: string): any => r[key];
const nullable = (v: unknown): string | null => v == null ? null : String(v);
const jsonValue = (v: unknown): unknown => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };

/** Exact-ID read projection. It uses a single read-only repeatable-read transaction and no current-state lookup. */
export class Rcv020PostgresReadRepository {
  constructor(private readonly pool: Rcv020ReadPool) {}

  async loadByOccurrenceId(occurrenceId: string): Promise<Rcv020HistoricalBundle | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const occurrenceResult = await client.query(
        `SELECT occurrence_id, logical_source_id, monitor_id, monitor_configuration_version_id,
          trigger_origin, trigger_canonical, trigger_hash,
          ${utc("scheduled_at")} AS scheduled_at, ${utc("trigger_received_at")} AS trigger_received_at,
          ${utc("requested_at")} AS requested_at, ${utc("due_at")} AS due_at,
          evaluation_policy_version, ${utc("evaluation_cutoff_at")} AS evaluation_cutoff_at,
          ${utc("created_at")} AS created_at, canonical, canonical_hash
         FROM public.rcv020_observation_occurrences WHERE occurrence_id=$1`, [occurrenceId]);
      if (!occurrenceResult.rows.length) { await client.query("COMMIT"); return null; }
      const o = occurrenceResult.rows[0];
      const sourceResult = await client.query(
        `SELECT logical_source_id, organization_identity, source_class, jurisdiction, ${utc("created_at")} AS created_at,
          identity_canonical::text AS identity_canonical, ${hex("identity_hash")} AS identity_hash
         FROM public.rcv020_logical_sources WHERE logical_source_id=$1`, [o.logical_source_id]);
      const monitorResult = await client.query(
        `SELECT monitor_id, logical_source_id, monitor_kind, ${utc("created_at")} AS created_at,
          identity_canonical::text AS identity_canonical, ${hex("identity_hash")} AS identity_hash
         FROM public.rcv020_monitors WHERE monitor_id=$1`, [o.monitor_id]);
      const configResult = await client.query(
        `SELECT monitor_configuration_version_id, monitor_id, version_number::text AS version_number,
          endpoint_request_canonical, endpoint_request_hash, retrieval_method, authentication_reference,
          expected_media_constraints, trigger_eligibility, scope_canonical, safety_policy_canonical,
          adapter_id, adapter_version, parser_id, parser_version, retention_policy, retention_policy_version,
          ${utc("effective_from")} AS effective_from, ${utc("effective_until")} AS effective_until,
          ${utc("created_at")} AS created_at, canonical::text AS canonical, ${hex("canonical_hash")} AS canonical_hash
         FROM public.rcv020_monitor_configuration_versions WHERE monitor_configuration_version_id=$1`, [o.monitor_configuration_version_id]);
      const configurationsResult = await client.query(
        `SELECT monitor_configuration_version_id, monitor_id, version_number::text AS version_number,
          endpoint_request_canonical, endpoint_request_hash, retrieval_method, authentication_reference,
          expected_media_constraints, trigger_eligibility, scope_canonical, safety_policy_canonical,
          adapter_id, adapter_version, parser_id, parser_version, retention_policy, retention_policy_version,
          ${utc("effective_from")} AS effective_from, ${utc("effective_until")} AS effective_until,
          ${utc("created_at")} AS created_at, canonical::text AS canonical, ${hex("canonical_hash")} AS canonical_hash
         FROM public.rcv020_monitor_configuration_versions WHERE monitor_id=$1
         ORDER BY version_number::numeric, monitor_configuration_version_id`, [o.monitor_id]);
      const lifecycleResult = await client.query(
        `SELECT event_id, monitor_configuration_version_id, event_type, ${utc("event_at")} AS event_at,
          event_sequence::text AS event_sequence, actor_policy_identity
         FROM public.rcv020_configuration_lifecycle_events WHERE monitor_configuration_version_id=$1
         ORDER BY event_sequence::numeric, event_id`, [o.monitor_configuration_version_id]);
      const resolutionResult = await client.query(
        `SELECT resolution_id, occurrence_id, outcome, ${utc("evaluation_cutoff_at")} AS evaluation_cutoff_at,
          ${utc("evaluated_at")} AS evaluated_at, skip_reason, skip_actor_policy_identity,
          terminalization_policy_version, canonical, canonical_hash, ${utc("created_at")} AS created_at
         FROM public.rcv020_observation_occurrence_resolutions WHERE occurrence_id=$1`, [occurrenceId]);
      const attemptsResult = await client.query(
        `SELECT attempt_id, occurrence_id, previous_attempt_id, retry_number::text AS retry_number,
          ${utc("retrieval_started_at")} AS retrieval_started_at, ${utc("attempt_deadline_at")} AS attempt_deadline_at,
          adapter_id, adapter_version, request_canonical, request_hash, ${utc("created_at")} AS created_at,
          canonical, canonical_hash
         FROM public.rcv020_retrieval_attempts WHERE occurrence_id=$1 ORDER BY retry_number::numeric, attempt_id`, [occurrenceId]);
      const attemptIds = attemptsResult.rows.map((r) => r.attempt_id);
      const resolutionsResult = attemptIds.length ? await client.query(
        `SELECT attempt_resolution_id, attempt_id, ${utc("retrieval_completed_at")} AS retrieval_completed_at,
          outcome, failure_taxonomy_version, failure_code, diagnostic_canonical, canonical, canonical_hash,
          ${utc("created_at")} AS created_at
         FROM public.rcv020_retrieval_attempt_resolutions WHERE attempt_id = ANY($1::uuid[])
         ORDER BY attempt_id, ${utc("retrieval_completed_at")}`, [attemptIds]) : { rows: [] };
      const capturesResult = await client.query(
        `SELECT capture_id, logical_source_id, monitor_id, monitor_configuration_version_id, occurrence_id,
          retrieval_attempt_id, request_hash, requested_target, final_url, redirect_canonical, response_status,
          response_metadata_canonical, media_type, byte_length::text AS byte_length, ${utc("observed_at")} AS observed_at,
          content_hash, canonical, capture_hash, retention_policy, retention_policy_version, raw_object_identity,
          raw_object_reference, ${utc("created_at")} AS created_at
         FROM public.rcv020_captures WHERE occurrence_id=$1 ORDER BY ${utc("observed_at")}, capture_id`, [occurrenceId]);
      const captureIds = capturesResult.rows.map((r) => r.capture_id);
      const comparisonsResult = captureIds.length ? await client.query(
        `SELECT comparison_id, current_capture_id, prior_capture_id, comparison_algorithm_id,
          comparison_algorithm_version, input_canonical, input_hash, result, canonical, canonical_hash,
          ${utc("created_at")} AS created_at
         FROM public.rcv020_capture_comparisons WHERE current_capture_id = ANY($1::uuid[])
         ORDER BY current_capture_id, comparison_algorithm_id, comparison_algorithm_version`, [captureIds]) : { rows: [] };
      const retentionResult = captureIds.length ? await client.query(
        `SELECT event_id, capture_id, event_type, reason, policy_legal_basis, ${utc("event_at")} AS event_at,
          resulting_availability, event_sequence::text AS event_sequence, canonical, canonical_hash,
          ${utc("created_at")} AS created_at
         FROM public.rcv020_retention_availability_events
         WHERE capture_id = ANY($1::uuid[])
         ORDER BY capture_id, event_sequence::numeric, event_id`, [captureIds]) : { rows: [] };
      const handoffsResult = captureIds.length ? await client.query(
        `SELECT handoff_id, capture_id, logical_source_id, monitor_id, monitor_configuration_version_id,
          occurrence_id, retrieval_attempt_id, capture_hash, raw_object_identity, raw_availability_snapshot,
          ${utc("observed_at")} AS observed_at, ${utc("source_published_at")} AS source_published_at,
          source_artifact_identity, derived_extraction_reference, derived_extraction_version, derived_extraction_hash,
          provenance_manifest, handoff_canonical, handoff_hash, idempotency_key, ${utc("created_at")} AS created_at
         FROM public.rcv020_authenticated_handoffs WHERE capture_id = ANY($1::uuid[])
         ORDER BY capture_id, ${utc("created_at")}, handoff_id`, [captureIds]) : { rows: [] };
      const quarantineResult = attemptIds.length ? await client.query(
        `SELECT quarantine_id, attempt_id, reason, policy_canonical, object_identity, payload_hash,
          byte_length::text AS byte_length, ${utc("created_at")} AS created_at
         FROM public.rcv020_quarantined_payloads WHERE attempt_id = ANY($1::uuid[])
         ORDER BY attempt_id, ${utc("created_at")}, quarantine_id`, [attemptIds]) : { rows: [] };
      await client.query("COMMIT");
      if (!sourceResult.rows.length || !monitorResult.rows.length || !configResult.rows.length) {
        return Object.freeze({ contractVersion: 1, source: undefined as never, monitor: undefined as never, configuration: undefined as never,
          lifecycleEvents: [], occurrence: undefined as never, occurrenceResolution: null, attempts: [], attemptResolutions: [], captures: [], comparisons: [], retentionEvents: [], handoffs: [], quarantine: [] });
      }
      const s = sourceResult.rows[0], m = monitorResult.rows[0], c = configResult.rows[0];
      const source: Rcv020ReadSource = Object.freeze({ logicalSourceId: row(s, "logical_source_id"), organizationIdentity: row(s, "organization_identity"), sourceClass: row(s, "source_class"), jurisdiction: nullable(s.jurisdiction), createdAt: row(s, "created_at"), identityCanonical: jsonValue(s.identity_canonical), identityHash: row(s, "identity_hash") });
      const monitor: Rcv020ReadMonitor = Object.freeze({ monitorId: row(m, "monitor_id"), logicalSourceId: row(m, "logical_source_id"), monitorKind: row(m, "monitor_kind"), createdAt: row(m, "created_at"), identityCanonical: jsonValue(m.identity_canonical), identityHash: row(m, "identity_hash") });
      const safeJson = (v: unknown): unknown => { try { return JSON.parse(String(v)); } catch { return v; } };
      const configuration = Object.freeze({ monitorConfigurationVersionId: row(c, "monitor_configuration_version_id"), monitorId: row(c, "monitor_id"), versionNumber: row(c, "version_number"), endpointRequest: safeJson(c.endpoint_request_canonical), retrievalMethod: row(c, "retrieval_method"), authenticationReference: nullable(c.authentication_reference), expectedMediaConstraints: jsonValue(c.expected_media_constraints) as Record<string, unknown>, triggerEligibility: row(c, "trigger_eligibility"), scope: safeJson(c.scope_canonical), safetyPolicy: safeJson(c.safety_policy_canonical), adapterId: row(c, "adapter_id"), adapterVersion: row(c, "adapter_version"), parserId: nullable(c.parser_id), parserVersion: nullable(c.parser_version), retentionPolicy: row(c, "retention_policy"), retentionPolicyVersion: Number(c.retention_policy_version), effectiveFrom: row(c, "effective_from"), effectiveUntil: nullable(c.effective_until), canonical: row(c, "canonical"), canonicalHash: row(c, "canonical_hash"), createdAt: row(c, "created_at"), endpointRequestCanonical: row(c, "endpoint_request_canonical"), endpointRequestHash: row(c, "endpoint_request_hash") }) as unknown as Rcv020ReadConfiguration;
      const configurations = Object.freeze(configurationsResult.rows.map((x) => Object.freeze({ monitorConfigurationVersionId: row(x, "monitor_configuration_version_id"), monitorId: row(x, "monitor_id"), versionNumber: row(x, "version_number"), endpointRequest: safeJson(x.endpoint_request_canonical), retrievalMethod: row(x, "retrieval_method"), authenticationReference: nullable(x.authentication_reference), expectedMediaConstraints: jsonValue(x.expected_media_constraints) as Record<string, unknown>, triggerEligibility: row(x, "trigger_eligibility"), scope: safeJson(x.scope_canonical), safetyPolicy: safeJson(x.safety_policy_canonical), adapterId: row(x, "adapter_id"), adapterVersion: row(x, "adapter_version"), parserId: nullable(x.parser_id), parserVersion: nullable(x.parser_version), retentionPolicy: row(x, "retention_policy"), retentionPolicyVersion: Number(x.retention_policy_version), effectiveFrom: row(x, "effective_from"), effectiveUntil: nullable(x.effective_until), canonical: row(x, "canonical"), canonicalHash: row(x, "canonical_hash"), createdAt: row(x, "created_at"), endpointRequestCanonical: row(x, "endpoint_request_canonical"), endpointRequestHash: row(x, "endpoint_request_hash") })) as unknown as Rcv020ReadConfiguration[]);
      const occurrence: Rcv020ReadOccurrence = Object.freeze({ occurrenceId: row(o, "occurrence_id"), logicalSourceId: row(o, "logical_source_id"), monitorId: row(o, "monitor_id"), monitorConfigurationVersionId: row(o, "monitor_configuration_version_id"), triggerOrigin: row(o, "trigger_origin") as never, triggerCanonical: row(o, "trigger_canonical"), triggerHash: row(o, "trigger_hash"), scheduledAt: nullable(o.scheduled_at) as never, triggerReceivedAt: nullable(o.trigger_received_at) as never, requestedAt: nullable(o.requested_at) as never, dueAt: nullable(o.due_at) as never, evaluationCutoffAt: row(o, "evaluation_cutoff_at"), evaluationPolicyVersion: Number(o.evaluation_policy_version), createdAt: row(o, "created_at"), canonical: row(o, "canonical"), canonicalHash: row(o, "canonical_hash") });
      const lifecycleEvents = Object.freeze(lifecycleResult.rows.map((e) => Object.freeze({ eventId: row(e, "event_id"), monitorConfigurationVersionId: row(e, "monitor_configuration_version_id"), eventType: row(e, "event_type"), eventAt: row(e, "event_at"), eventSequence: row(e, "event_sequence"), actorPolicyIdentity: row(e, "actor_policy_identity") })) as Rcv020LifecycleEvent[]);
      const occurrenceResolutions = Object.freeze(resolutionResult.rows.map((r) => Object.freeze({ resolutionId: row(r, "resolution_id"), occurrenceId: row(r, "occurrence_id"), outcome: row(r, "outcome") as Rcv020OccurrenceOutcome, evaluationCutoffAt: row(r, "evaluation_cutoff_at"), evaluatedAt: row(r, "evaluated_at"), skipReason: nullable(r.skip_reason), skipActorPolicyIdentity: nullable(r.skip_actor_policy_identity), terminalizationPolicyVersion: Number(r.terminalization_policy_version), canonical: row(r, "canonical"), canonicalHash: row(r, "canonical_hash"), createdAt: row(r, "created_at") })));
      const occurrenceResolution = occurrenceResolutions[0] ?? null;
      const attempts = Object.freeze(attemptsResult.rows.map((a) => Object.freeze({ attemptId: row(a, "attempt_id"), occurrenceId: row(a, "occurrence_id"), previousAttemptId: nullable(a.previous_attempt_id), retryNumber: row(a, "retry_number"), retrievalStartedAt: row(a, "retrieval_started_at"), attemptDeadlineAt: row(a, "attempt_deadline_at"), adapterId: row(a, "adapter_id"), adapterVersion: row(a, "adapter_version"), requestCanonical: row(a, "request_canonical"), requestHash: row(a, "request_hash"), createdAt: row(a, "created_at"), canonical: row(a, "canonical"), canonicalHash: row(a, "canonical_hash") })) as unknown as Rcv020ReadAttempt[]);
      const attemptResolutions = Object.freeze(resolutionsResult.rows.map((r) => Object.freeze({ attemptResolutionId: row(r, "attempt_resolution_id"), attemptId: row(r, "attempt_id"), retrievalCompletedAt: row(r, "retrieval_completed_at"), outcome: row(r, "outcome"), failureTaxonomyVersion: r.failure_taxonomy_version == null ? null : Number(r.failure_taxonomy_version), failureCode: r.failure_code == null ? null : String(r.failure_code), diagnosticCanonical: nullable(r.diagnostic_canonical), canonical: row(r, "canonical"), canonicalHash: row(r, "canonical_hash"), createdAt: row(r, "created_at") })) as Rcv020ReadAttemptResolution[]);
      const captures = Object.freeze(capturesResult.rows.map((x) => Object.freeze({ captureId: row(x, "capture_id"), logicalSourceId: row(x, "logical_source_id"), monitorId: row(x, "monitor_id"), monitorConfigurationVersionId: row(x, "monitor_configuration_version_id"), occurrenceId: row(x, "occurrence_id"), retrievalAttemptId: row(x, "retrieval_attempt_id"), observedAt: row(x, "observed_at"), contentHash: row(x, "content_hash"), byteLength: row(x, "byte_length"), rawObjectIdentity: nullable(x.raw_object_identity), requestHash: row(x, "request_hash"), requestedTarget: row(x, "requested_target"), finalUrl: nullable(x.final_url), redirectCanonical: nullable(x.redirect_canonical), responseStatus: Number(x.response_status), responseMetadataCanonical: row(x, "response_metadata_canonical"), mediaType: row(x, "media_type"), captureCanonical: row(x, "canonical"), captureHash: row(x, "capture_hash"), retentionPolicy: row(x, "retention_policy"), retentionPolicyVersion: Number(x.retention_policy_version), rawObjectReference: nullable(x.raw_object_reference), createdAt: row(x, "created_at") })) as Rcv020ReadCapture[]);
      const comparisons = Object.freeze(comparisonsResult.rows.map((x) => Object.freeze({ comparisonId: row(x, "comparison_id"), currentCaptureId: row(x, "current_capture_id"), priorCaptureId: nullable(x.prior_capture_id), algorithmId: row(x, "comparison_algorithm_id"), algorithmVersion: Number(x.comparison_algorithm_version), inputCanonical: row(x, "input_canonical"), inputHash: row(x, "input_hash"), result: row(x, "result"), canonical: row(x, "canonical"), canonicalHash: row(x, "canonical_hash"), createdAt: row(x, "created_at") })) as Rcv020ReadComparison[]);
      const retentionEvents = Object.freeze(retentionResult.rows.map((x) => Object.freeze({ eventId: row(x, "event_id"), captureId: row(x, "capture_id"), eventType: row(x, "event_type"), eventAt: row(x, "event_at"), eventSequence: row(x, "event_sequence"), reason: row(x, "reason"), policyLegalBasis: nullable(x.policy_legal_basis), resultingAvailability: row(x, "resulting_availability"), canonical: row(x, "canonical"), canonicalHash: row(x, "canonical_hash"), createdAt: row(x, "created_at") })) as Rcv020ReadRetentionEvent[]);
      const handoffs = Object.freeze(handoffsResult.rows.map((x) => Object.freeze({ handoffId: row(x, "handoff_id"), captureId: row(x, "capture_id"), logicalSourceId: row(x, "logical_source_id"), monitorId: row(x, "monitor_id"), monitorConfigurationVersionId: row(x, "monitor_configuration_version_id"), occurrenceId: row(x, "occurrence_id"), retrievalAttemptId: row(x, "retrieval_attempt_id"), captureHash: row(x, "capture_hash"), rawObjectIdentity: nullable(x.raw_object_identity), rawAvailabilitySnapshot: row(x, "raw_availability_snapshot"), observedAt: row(x, "observed_at"), sourcePublishedAt: nullable(x.source_published_at), sourceArtifactIdentity: nullable(x.source_artifact_identity), derivedExtractionReference: nullable(x.derived_extraction_reference), derivedExtractionVersion: nullable(x.derived_extraction_version), derivedExtractionHash: nullable(x.derived_extraction_hash), provenanceManifest: row(x, "provenance_manifest"), handoffCanonical: row(x, "handoff_canonical"), handoffHash: row(x, "handoff_hash"), idempotencyKey: row(x, "idempotency_key"), createdAt: row(x, "created_at") })) as Rcv020ReadHandoff[]);
      const quarantine = Object.freeze(quarantineResult.rows.map((x) => Object.freeze({ quarantineId: row(x, "quarantine_id"), attemptId: row(x, "attempt_id"), reason: row(x, "reason"), policyCanonical: row(x, "policy_canonical"), objectIdentity: nullable(x.object_identity), payloadHash: nullable(x.payload_hash), byteLength: nullable(x.byte_length), createdAt: row(x, "created_at") })) as Rcv020ReadQuarantine[]);
      return Object.freeze({ contractVersion: 1 as const, source, monitor, configuration, configurations, lifecycleEvents, occurrence, occurrenceResolution, occurrenceResolutions, attempts, attemptResolutions, captures, comparisons, retentionEvents, handoffs, quarantine });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release?.(); }
  }

  loadOccurrence(occurrenceId: string): Promise<Rcv020HistoricalBundle | null> { return this.loadByOccurrenceId(occurrenceId); }
  readOccurrence(occurrenceId: string): Promise<Rcv020HistoricalBundle | null> { return this.loadByOccurrenceId(occurrenceId); }
}

export async function readRcv020Occurrence(pool: Rcv020ReadPool, occurrenceId: string): Promise<Rcv020HistoricalBundle | null> {
  return new Rcv020PostgresReadRepository(pool).loadByOccurrenceId(occurrenceId);
}
export const readRcv020HistoricalBundle = readRcv020Occurrence;
