import { canonicalizeRcv020, canonicalizeRcv020MonitorConfiguration, sha256Rcv020Text } from "./rcv020Canonical";
import { canonicalizeRcv020Attempt, canonicalizeRcv020CaptureComparison, canonicalizeRcv020Occurrence, canonicalizeRcv020RetentionAvailabilityEvent } from "./rcv020SemanticCore";
import { randomUUID } from "node:crypto";
import { Rcv020WriteBundle, Rcv020HandoffWrite, verifyRcv020Write } from "./rcv020WriteVerifier";

export interface Rcv020PgResult { readonly rows?: readonly Record<string, unknown>[]; readonly rowCount?: number | null; }
export interface Rcv020PgClient { query(text: string, values?: readonly unknown[]): Promise<Rcv020PgResult>; }
export interface Rcv020PgPool extends Rcv020PgClient { connect(): Promise<Rcv020PgClient & { release?: () => void }>; }

const hashBytes = (hex: string): Buffer => Buffer.from(hex, "hex");
const json = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value);
const now = (): string => new Date().toISOString();
const q = async (client: Rcv020PgClient, sql: string, values: readonly unknown[] = []): Promise<void> => { await client.query(sql, values); };

/** Persists one authenticated bundle. The caller must have supplied a transaction-bound client. */
export async function persistRcv020Bundle(client: Rcv020PgClient, input: Rcv020WriteBundle, createdAt = now()): Promise<void> {
  const bundle = verifyRcv020Write(input);
  await q(client, "BEGIN");
  try {
    for (const s of bundle.sources ?? []) await q(client, "INSERT INTO public.rcv020_logical_sources (logical_source_id,organization_identity,source_class,jurisdiction,created_at,identity_canonical,identity_hash) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)", [s.logicalSourceId, s.organizationIdentity, s.sourceClass, s.jurisdiction ?? null, createdAt, s.canonical, hashBytes(s.identityHash)]);
    for (const m of bundle.monitors ?? []) await q(client, "INSERT INTO public.rcv020_monitors (monitor_id,logical_source_id,monitor_kind,created_at,identity_canonical,identity_hash) VALUES ($1,$2,$3,$4,$5::jsonb,$6)", [m.monitorId, m.logicalSourceId, m.monitorKind, createdAt, m.canonical, hashBytes(m.identityHash)]);
    for (const c of bundle.configurations ?? []) {
      const encoded = canonicalizeRcv020MonitorConfiguration(c);
      const endpoint = canonicalizeRcv020({ schema: "RCV020-REQUEST-V1", ...c.endpointRequest }, "request");
      await q(client, "INSERT INTO public.rcv020_monitor_configuration_versions (monitor_configuration_version_id,monitor_id,version_number,endpoint_request_canonical,endpoint_request_hash,retrieval_method,authentication_reference,expected_media_constraints,trigger_eligibility,scope_canonical,safety_policy_canonical,adapter_id,adapter_version,parser_id,parser_version,retention_policy,retention_policy_version,effective_from,effective_until,created_at,canonical,canonical_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)", [c.monitorConfigurationVersionId, c.monitorId, c.versionNumber.toString(), endpoint.canonical, endpoint.hash, c.retrievalMethod, c.authenticationReference ?? null, json(c.expectedMediaConstraints), c.triggerEligibility, json(c.scope), json(c.safetyPolicy), c.adapterId, c.adapterVersion, c.parserId ?? null, c.parserVersion ?? null, c.retentionPolicy, c.retentionPolicyVersion, c.effectiveFrom, c.effectiveUntil ?? null, createdAt, encoded.canonical, hashBytes(encoded.hash)]);
    }
    for (const e of bundle.lifecycleEvents ?? []) {
      const encoded = canonicalizeRcv020({ schema: "RCV020-LIFECYCLE-V1", ...e, eventSequence: e.eventSequence.toString(10) });
      await q(client, "INSERT INTO public.rcv020_configuration_lifecycle_events (event_id,monitor_configuration_version_id,event_type,event_at,actor_policy_identity,reason,event_sequence,canonical,canonical_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [e.eventId, e.monitorConfigurationVersionId, e.eventType, e.eventAt, e.actorPolicyIdentity, null, e.eventSequence.toString(), encoded.canonical, encoded.hash, createdAt]);
    }
    for (const o of bundle.occurrences ?? []) {
      const encoded = canonicalizeRcv020Occurrence(o);
      const trigger = canonicalizeRcv020({ schema: "RCV020-TRIGGER-V1", triggerOrigin: o.triggerOrigin, scheduledAt: o.scheduledAt ?? null, triggerReceivedAt: o.triggerReceivedAt ?? null, requestedAt: o.requestedAt ?? null }, "trigger");
      await q(client, "INSERT INTO public.rcv020_observation_occurrences (occurrence_id,logical_source_id,monitor_id,monitor_configuration_version_id,trigger_origin,trigger_canonical,trigger_hash,scheduled_at,trigger_received_at,requested_at,due_at,evaluation_policy_version,evaluation_cutoff_at,created_at,canonical,canonical_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)", [o.occurrenceId, o.logicalSourceId, o.monitorId, o.monitorConfigurationVersionId, o.triggerOrigin, trigger.canonical, trigger.hash, o.scheduledAt ?? null, o.triggerReceivedAt ?? null, o.requestedAt ?? null, o.dueAt ?? null, 1, o.evaluationCutoffAt, createdAt, encoded.canonical, encoded.hash]);
    }
    for (const a of bundle.attempts ?? []) {
      const encoded = canonicalizeRcv020Attempt(a);
      const requestCanonical = (a as unknown as { requestCanonical?: string }).requestCanonical ?? "{\"credentialReference\":null,\"method\":\"GET\",\"parameters\":{},\"target\":\"\"}";
      const requestHash = (a as unknown as { requestHash?: string }).requestHash ?? sha256Rcv020Text(requestCanonical);
      const adapterId = (a as unknown as { adapterId?: string }).adapterId ?? "unknown";
      const adapterVersion = (a as unknown as { adapterVersion?: string }).adapterVersion ?? "1";
      await q(client, "INSERT INTO public.rcv020_retrieval_attempts (attempt_id,occurrence_id,previous_attempt_id,retry_number,retrieval_started_at,attempt_deadline_at,adapter_id,adapter_version,request_canonical,request_hash,created_at,canonical,canonical_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [a.attemptId, a.occurrenceId, a.previousAttemptId ?? null, a.retryNumber.toString(), a.retrievalStartedAt, a.attemptDeadlineAt, adapterId, adapterVersion, requestCanonical, requestHash, createdAt, encoded.canonical, encoded.hash]);
    }
    for (const r of bundle.attemptResolutions ?? []) {
      const encoded = r.canonical && r.canonicalHash ? { canonical: r.canonical, hash: r.canonicalHash } : canonicalizeRcv020({ schema: "RCV020-ATTEMPT-RESOLUTION-V1", ...r });
      await q(client, "INSERT INTO public.rcv020_retrieval_attempt_resolutions (attempt_resolution_id,attempt_id,retrieval_completed_at,outcome,failure_taxonomy_version,failure_code,diagnostic_canonical,canonical,canonical_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [r.attemptResolutionId ?? randomUUID(), r.attemptId, r.retrievalCompletedAt, r.outcome, r.outcome === "FAILED" ? (r.failureTaxonomyVersion ?? 1) : null, r.failureCode ?? null, r.diagnosticCanonical ?? null, encoded.canonical, encoded.hash, createdAt]);
    }
    for (const c of bundle.captures ?? []) {
      const x = c as unknown as Record<string, unknown>;
      const { rawObjectReference: _rawObjectReference, captureCanonical: _captureCanonical, captureHash: _captureHash, ...captureCanonicalInput } = x;
      const encoded = canonicalizeRcv020({ schema: "RCV020-CAPTURE-ENVELOPE-V1", ...captureCanonicalInput, byteLength: c.byteLength.toString() });
      await q(client, "INSERT INTO public.rcv020_captures (capture_id,logical_source_id,monitor_id,monitor_configuration_version_id,occurrence_id,retrieval_attempt_id,request_hash,requested_target,final_url,redirect_canonical,response_status,response_metadata_canonical,media_type,byte_length,observed_at,content_hash,canonical,capture_hash,retention_policy,retention_policy_version,raw_object_identity,raw_object_reference,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)", [c.captureId, c.logicalSourceId, c.monitorId, c.monitorConfigurationVersionId, c.occurrenceId, c.retrievalAttemptId, x.requestHash ?? "0".repeat(64), x.requestedTarget ?? "unknown", x.finalUrl ?? null, x.redirectCanonical ?? null, x.responseStatus ?? 200, x.responseMetadataCanonical ?? "{}", x.mediaType ?? "application/octet-stream", c.byteLength.toString(), c.observedAt, c.contentHash, encoded.canonical, x.captureHash ?? encoded.hash, x.retentionPolicy ?? "METADATA_HASH_ONLY", x.retentionPolicyVersion ?? 1, c.rawObjectIdentity ?? null, x.rawObjectReference ?? null, createdAt]);
    }
    for (const c of bundle.comparisons ?? []) {
      const encoded = canonicalizeRcv020CaptureComparison(c);
      const x = c as unknown as Record<string, unknown>;
      await q(client, "INSERT INTO public.rcv020_capture_comparisons (comparison_id,current_capture_id,prior_capture_id,comparison_algorithm_id,comparison_algorithm_version,input_canonical,input_hash,result,canonical,canonical_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [c.comparisonId, c.currentCaptureId, c.priorCaptureId ?? null, c.algorithmId, c.algorithmVersion, x.inputCanonical ?? "{}", x.inputHash ?? sha256Rcv020Text(String(x.inputCanonical ?? "{}")), c.result, encoded.canonical, encoded.hash, createdAt]);
    }
    for (const e of bundle.occurrenceResolutions ?? []) {
      await q(client, "INSERT INTO public.rcv020_observation_occurrence_resolutions (resolution_id,occurrence_id,outcome,evaluation_cutoff_at,evaluated_at,skip_reason,skip_actor_policy_identity,terminalization_policy_version,canonical,canonical_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [e.resolutionId, e.occurrenceId, e.outcome, e.evaluationCutoffAt, e.evaluatedAt, e.skipReason ?? null, e.skipActorPolicyIdentity ?? null, e.terminalizationPolicyVersion, e.canonical, e.canonicalHash, createdAt]);
    }
    for (const e of bundle.retentionEvents ?? []) {
      const encoded = canonicalizeRcv020RetentionAvailabilityEvent(e);
      const x = e as unknown as Record<string, unknown>;
      await q(client, "INSERT INTO public.rcv020_retention_availability_events (event_id,capture_id,event_type,reason,policy_legal_basis,event_at,resulting_availability,event_sequence,canonical,canonical_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [e.eventId, e.captureId, e.eventType, x.reason ?? "unspecified", x.policyLegalBasis ?? null, e.eventAt, x.resultingAvailability ?? "UNAVAILABLE", e.eventSequence.toString(), encoded.canonical, encoded.hash, createdAt]);
    }
    for (const h of bundle.handoffs ?? []) await insertHandoff(client, h, createdAt);
    for (const qrow of bundle.quarantine ?? []) await q(client, "INSERT INTO public.rcv020_quarantined_payloads (quarantine_id,attempt_id,reason,policy_canonical,object_identity,payload_hash,byte_length,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [qrow.quarantineId, qrow.attemptId, qrow.reason, qrow.policyCanonical, qrow.objectIdentity ?? null, qrow.payloadHash ?? null, qrow.byteLength == null ? null : qrow.byteLength.toString(), createdAt]);
    await q(client, "COMMIT");
  } catch (error) { try { await q(client, "ROLLBACK"); } catch { /* preserve original error */ } throw error; }
}

export async function insertHandoff(client: Rcv020PgClient, handoff: Rcv020HandoffWrite, createdAt = now()): Promise<"inserted" | "idempotent"> {
  const existing = await client.query("SELECT handoff_hash, handoff_canonical FROM public.rcv020_authenticated_handoffs WHERE idempotency_key = $1", [handoff.idempotencyKey]);
  if ((existing.rows ?? []).length > 0) {
    const row = (existing.rows ?? [])[0];
    if (row.handoff_hash !== handoff.handoffHash || row.handoff_canonical !== handoff.handoffCanonical) throw new Error("RCV-020 handoff idempotency conflict");
    return "idempotent";
  }
  await q(client, "INSERT INTO public.rcv020_authenticated_handoffs (handoff_id,capture_id,logical_source_id,monitor_id,monitor_configuration_version_id,occurrence_id,retrieval_attempt_id,capture_hash,raw_object_identity,raw_availability_snapshot,observed_at,source_published_at,source_artifact_identity,derived_extraction_reference,derived_extraction_version,derived_extraction_hash,provenance_manifest,handoff_canonical,handoff_hash,idempotency_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)", [handoff.handoffId, handoff.captureId, handoff.logicalSourceId, handoff.monitorId, handoff.monitorConfigurationVersionId, handoff.occurrenceId, handoff.retrievalAttemptId, handoff.captureHash, handoff.rawObjectIdentity ?? null, handoff.rawAvailabilitySnapshot, handoff.observedAt, handoff.sourcePublishedAt ?? null, handoff.sourceArtifactIdentity ?? null, handoff.derivedExtractionReference ?? null, handoff.derivedExtractionVersion ?? null, handoff.derivedExtractionHash ?? null, handoff.provenanceManifest, handoff.handoffCanonical, handoff.handoffHash, handoff.idempotencyKey, createdAt]);
  return "inserted";
}

export const persistRcv020Write = persistRcv020Bundle;
