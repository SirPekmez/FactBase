import {
  RCV020_ATTEMPT_OUTCOMES,
  RCV020_COMPARISON_RESULTS,
  RCV020_FAILURE_CODES,
  RCV020_LIFECYCLE_EVENTS,
  RCV020_OCCURRENCE_OUTCOMES,
  RCV020_RETENTION_EVENTS,
  RCV020_TRIGGER_ORIGINS,
  Rcv020AttemptResolution,
  Rcv020AttemptOutcome,
  Rcv020Capture,
  Rcv020CaptureComparison,
  Rcv020FailureCode,
  Rcv020LifecycleEvent,
  Rcv020MonitorConfigurationVersion,
  Rcv020ObservationOccurrence,
  Rcv020OccurrenceOutcome,
  Rcv020RetentionAvailabilityEvent,
  Rcv020RetrievalAttempt,
  Rcv020ValidationError,
  validateRcv020Timestamp,
  validateRcv020Uuid,
} from "../contracts/rcv020ObservatoryContractV1";
import { canonicalizeRcv020, canonicalizeRcv020MonitorConfiguration, validateRcv020BigInt, validateRcv020NonNegativeBigInt } from "./rcv020Canonical";

function fail(path: string, message: string): never { throw new Rcv020ValidationError(path, message); }
function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(path, "unsupported closed value");
  return value as T;
}

export type Rcv020LifecycleState = "NOT_ACTIVATED" | "ACTIVE" | "PAUSED" | "RETIRED";

export function validateMonitorConfigurationVersion(config: Rcv020MonitorConfigurationVersion): Rcv020CanonicalResult {
  return canonicalizeRcv020MonitorConfiguration(config);
}

export interface Rcv020CanonicalResult {
  readonly canonical: string;
  readonly hash: string;
}

export function deriveLifecycleState(
  config: Pick<Rcv020MonitorConfigurationVersion, "monitorConfigurationVersionId" | "effectiveFrom" | "effectiveUntil">,
  events: readonly Rcv020LifecycleEvent[],
): Rcv020LifecycleState {
  validateRcv020Uuid(config.monitorConfigurationVersionId, "monitorConfigurationVersionId");
  validateRcv020Timestamp(config.effectiveFrom, "effectiveFrom");
  if (config.effectiveUntil !== undefined && config.effectiveUntil !== null) validateRcv020Timestamp(config.effectiveUntil, "effectiveUntil");
  let state: Rcv020LifecycleState = "NOT_ACTIVATED";
  let priorTime: string | undefined;
  let priorSequence: bigint | undefined;
  let activation: Rcv020LifecycleEvent | undefined;
  let retirement: Rcv020LifecycleEvent | undefined;
  for (const [index, event] of events.entries()) {
    const path = `lifecycleEvents[${index}]`;
    if (event.monitorConfigurationVersionId !== config.monitorConfigurationVersionId) fail(`${path}.monitorConfigurationVersionId`, "does not match configuration");
    validateRcv020Uuid(event.eventId, `${path}.eventId`);
    validateRcv020Timestamp(event.eventAt, `${path}.eventAt`);
    const sequence = validateRcv020BigInt(event.eventSequence, `${path}.eventSequence`);
    const type = oneOf(event.eventType, RCV020_LIFECYCLE_EVENTS, `${path}.eventType`);
    if (priorSequence !== undefined && sequence <= priorSequence) fail(`${path}.eventSequence`, "must strictly increase");
    if (priorTime !== undefined && event.eventAt < priorTime) fail(`${path}.eventAt`, "must not decrease");
    priorSequence = sequence; priorTime = event.eventAt;
    if (type === "ACTIVATED" && state === "NOT_ACTIVATED") { state = "ACTIVE"; activation = event; }
    else if (type === "PAUSED" && state === "ACTIVE") state = "PAUSED";
    else if (type === "RESUMED" && state === "PAUSED") state = "ACTIVE";
    else if (type === "RETIRED" && (state === "ACTIVE" || state === "PAUSED")) { state = "RETIRED"; retirement = event; }
    else fail(`${path}.eventType`, `illegal transition from ${state}`);
  }
  if (activation && activation.eventAt !== config.effectiveFrom) fail("lifecycleEvents", "activation time contradicts effectiveFrom");
  if (retirement && config.effectiveUntil !== undefined && config.effectiveUntil !== null && retirement.eventAt !== config.effectiveUntil) {
    fail("lifecycleEvents", "retirement time contradicts effectiveUntil");
  }
  return state;
}

export function validateObservationOccurrence(occurrence: Rcv020ObservationOccurrence): void {
  validateRcv020Uuid(occurrence.occurrenceId, "occurrenceId");
  validateRcv020Uuid(occurrence.logicalSourceId, "logicalSourceId");
  validateRcv020Uuid(occurrence.monitorId, "monitorId");
  validateRcv020Uuid(occurrence.monitorConfigurationVersionId, "monitorConfigurationVersionId");
  const origin = oneOf(occurrence.triggerOrigin, RCV020_TRIGGER_ORIGINS, "triggerOrigin");
  validateRcv020Timestamp(occurrence.evaluationCutoffAt, "evaluationCutoffAt");
  if (origin === "SCHEDULED") {
    if (!occurrence.scheduledAt) fail("scheduledAt", "required for SCHEDULED occurrence");
    validateRcv020Timestamp(occurrence.scheduledAt, "scheduledAt");
    if (occurrence.triggerReceivedAt != null || occurrence.requestedAt != null) fail("trigger timestamps", "only scheduledAt is allowed");
  } else if (origin === "EXTERNAL") {
    if (!occurrence.triggerReceivedAt) fail("triggerReceivedAt", "required for EXTERNAL occurrence");
    validateRcv020Timestamp(occurrence.triggerReceivedAt, "triggerReceivedAt");
    if (occurrence.scheduledAt != null || occurrence.requestedAt != null) fail("trigger timestamps", "only triggerReceivedAt is allowed");
  } else {
    if (!occurrence.requestedAt) fail("requestedAt", "required for OPERATOR occurrence");
    validateRcv020Timestamp(occurrence.requestedAt, "requestedAt");
    if (occurrence.scheduledAt != null || occurrence.triggerReceivedAt != null) fail("trigger timestamps", "only requestedAt is allowed");
  }
  if (occurrence.dueAt != null) validateRcv020Timestamp(occurrence.dueAt, "dueAt");
}

export function canonicalizeRcv020Occurrence(occurrence: Rcv020ObservationOccurrence): Rcv020CanonicalResult {
  validateObservationOccurrence(occurrence);
  return canonicalizeRcv020({
    schema: "RCV020-OCCURRENCE-V1",
    occurrenceId: occurrence.occurrenceId,
    logicalSourceId: occurrence.logicalSourceId,
    monitorId: occurrence.monitorId,
    monitorConfigurationVersionId: occurrence.monitorConfigurationVersionId,
    triggerOrigin: occurrence.triggerOrigin,
    scheduledAt: occurrence.scheduledAt ?? null,
    triggerReceivedAt: occurrence.triggerReceivedAt ?? null,
    requestedAt: occurrence.requestedAt ?? null,
    dueAt: occurrence.dueAt ?? null,
    evaluationCutoffAt: occurrence.evaluationCutoffAt,
  }, "occurrence");
}

export function validateOccurrenceOutcome(value: unknown, path = "outcome"): Rcv020OccurrenceOutcome {
  return oneOf(value, RCV020_OCCURRENCE_OUTCOMES, path);
}

export function validateAttemptOutcome(value: unknown, path = "outcome"): Rcv020AttemptOutcome {
  return oneOf(value, RCV020_ATTEMPT_OUTCOMES, path);
}

export function validateAttemptSet(
  attempts: readonly Rcv020RetrievalAttempt[],
  occurrences: ReadonlyMap<string, Rcv020ObservationOccurrence>,
  resolutions: ReadonlyMap<string, Rcv020AttemptResolution>,
): void {
  const ids = new Set<string>();
  const retryNumbers = new Set<string>();
  for (const [index, attempt] of attempts.entries()) {
    const path = `attempts[${index}]`;
    validateRcv020Uuid(attempt.attemptId, `${path}.attemptId`);
    validateRcv020Uuid(attempt.occurrenceId, `${path}.occurrenceId`);
    if (ids.has(attempt.attemptId)) fail(`${path}.attemptId`, "duplicate attempt identity");
    ids.add(attempt.attemptId);
    const occurrence = occurrences.get(attempt.occurrenceId);
    if (!occurrence) fail(`${path}.occurrenceId`, "unknown occurrence");
    validateRcv020Timestamp(attempt.retrievalStartedAt, `${path}.retrievalStartedAt`);
    validateRcv020Timestamp(attempt.attemptDeadlineAt, `${path}.attemptDeadlineAt`);
    if (attempt.retrievalStartedAt > attempt.attemptDeadlineAt) fail(`${path}.attemptDeadlineAt`, "must not precede start");
    if (attempt.attemptDeadlineAt > occurrence.evaluationCutoffAt) fail(`${path}.attemptDeadlineAt`, "must not exceed occurrence cutoff");
    const retryNumber = validateRcv020BigInt(attempt.retryNumber, `${path}.retryNumber`);
    const retryKey = `${attempt.occurrenceId}:${retryNumber.toString(10)}`;
    if (retryNumbers.has(retryKey)) fail(`${path}.retryNumber`, "duplicate retry number for occurrence");
    retryNumbers.add(retryKey);
    if (attempt.previousAttemptId == null) {
      if (retryNumber !== 1n) fail(`${path}.retryNumber`, "first attempt must have retry number 1");
    } else {
      validateRcv020Uuid(attempt.previousAttemptId, `${path}.previousAttemptId`);
      const predecessor = attempts.find((candidate) => candidate.attemptId === attempt.previousAttemptId);
      if (!predecessor) fail(`${path}.previousAttemptId`, "unknown predecessor");
      if (predecessor.occurrenceId !== attempt.occurrenceId) fail(`${path}.previousAttemptId`, "predecessor belongs to another occurrence");
      const predecessorResolution = resolutions.get(predecessor.attemptId);
      if (!predecessorResolution || predecessorResolution.outcome !== "FAILED") fail(`${path}.previousAttemptId`, "predecessor must be terminal FAILED");
      const predecessorNumber = validateRcv020BigInt(predecessor.retryNumber, `${path}.predecessor.retryNumber`);
      if (retryNumber !== predecessorNumber + 1n) fail(`${path}.retryNumber`, "must immediately follow predecessor");
      if (attempt.retrievalStartedAt <= predecessorResolution.retrievalCompletedAt) fail(`${path}.retrievalStartedAt`, "retry must start after predecessor terminal resolution");
      let cursor: Rcv020RetrievalAttempt | undefined = predecessor;
      const seen = new Set<string>([attempt.attemptId]);
      while (cursor?.previousAttemptId != null) {
        if (seen.has(cursor.previousAttemptId)) fail(`${path}.previousAttemptId`, "retry lineage cycle");
        seen.add(cursor.previousAttemptId);
        cursor = attempts.find((candidate) => candidate.attemptId === cursor?.previousAttemptId);
        if (!cursor) fail(`${path}.previousAttemptId`, "broken retry lineage");
      }
    }
    const resolution = resolutions.get(attempt.attemptId);
    if (resolution) {
      validateRcv020Timestamp(resolution.retrievalCompletedAt, `${path}.resolution.retrievalCompletedAt`);
      validateAttemptOutcome(resolution.outcome, `${path}.resolution.outcome`);
      if (resolution.retrievalCompletedAt < attempt.retrievalStartedAt) fail(`${path}.resolution.retrievalCompletedAt`, "must not precede start");
      if (resolution.retrievalCompletedAt > attempt.attemptDeadlineAt && resolution.outcome !== "FAILED") fail(`${path}.resolution`, "successful completion is after immutable deadline");
      if (resolution.outcome === "FAILED") oneOf(resolution.failureCode, RCV020_FAILURE_CODES, `${path}.resolution.failureCode`);
      else if (resolution.failureCode != null) fail(`${path}.resolution.failureCode`, "failure code is only valid for FAILED");
    }
  }
  for (const resolution of resolutions.values()) {
    if (!ids.has(resolution.attemptId)) fail("resolutions", "resolution has no parent attempt");
  }
}

export function resolveOccurrenceTerminal(
  occurrence: Rcv020ObservationOccurrence,
  attempts: readonly Rcv020RetrievalAttempt[],
  resolutions: readonly Rcv020AttemptResolution[],
  captures: readonly Rcv020Capture[],
  requestedOutcome?: Rcv020OccurrenceOutcome,
): Rcv020OccurrenceOutcome {
  validateObservationOccurrence(occurrence);
  const resolutionIds = new Set<string>();
  const resolutionAttemptIds = new Set<string>();
  for (const [index, resolution] of resolutions.entries()) {
    if (resolutionIds.has(resolution.attemptId) || resolutionAttemptIds.has(resolution.attemptId)) fail(`resolutions[${index}].attemptId`, "duplicate terminal resolution");
    resolutionIds.add(resolution.attemptId);
    resolutionAttemptIds.add(resolution.attemptId);
  }
  const byAttempt = new Map(resolutions.map((resolution) => [resolution.attemptId, resolution]));
  const ownAttempts = attempts.filter((attempt) => attempt.occurrenceId === occurrence.occurrenceId);
  const ownCaptures = captures.filter((capture) => capture.occurrenceId === occurrence.occurrenceId);
  if (requestedOutcome === "SKIPPED") {
    if (ownAttempts.length !== 0) fail("outcome", "SKIPPED cannot hide retrieval attempts");
    return "SKIPPED";
  }
  if (ownAttempts.length === 0) {
    if (requestedOutcome != null && requestedOutcome !== "MISSED") fail("outcome", "zero-attempt occurrence can only be MISSED");
    return "MISSED";
  }
  for (const attempt of ownAttempts) {
    const resolution = byAttempt.get(attempt.attemptId);
    if (!resolution) fail("attempts", "terminal resolution is required before occurrence resolution");
    if (resolution.retrievalCompletedAt > attempt.attemptDeadlineAt && resolution.outcome !== "FAILED") fail("attempts", "late completion cannot succeed");
    const attemptCaptures = ownCaptures.filter((capture) => capture.retrievalAttemptId === attempt.attemptId);
    if (resolution.outcome === "FAILED" && attemptCaptures.length !== 0) fail("captures", "FAILED attempt cannot have Capture");
    if (resolution.outcome !== "FAILED" && attemptCaptures.length !== 1) fail("captures", "successful attempt requires exactly one Capture");
  }
  const successful = ownAttempts.some((attempt) => byAttempt.get(attempt.attemptId)?.outcome !== "FAILED");
  const result: Rcv020OccurrenceOutcome = successful ? "SUCCEEDED" : "FAILED";
  if (requestedOutcome != null && requestedOutcome !== result) fail("outcome", "does not match deterministic terminal result");
  return result;
}

export function validateCapture(capture: Rcv020Capture, attempt: Rcv020RetrievalAttempt, resolution: Rcv020AttemptResolution): void {
  validateRcv020Uuid(capture.captureId, "captureId");
  validateRcv020Uuid(capture.retrievalAttemptId, "retrievalAttemptId");
  validateRcv020Uuid(capture.occurrenceId, "occurrenceId");
  validateRcv020Uuid(capture.monitorId, "monitorId");
  validateRcv020Timestamp(capture.observedAt, "observedAt");
  validateRcv020NonNegativeBigInt(capture.byteLength, "byteLength");
  if (capture.retrievalAttemptId !== attempt.attemptId || capture.occurrenceId !== attempt.occurrenceId) fail("capture", "parent identity mismatch");
  if (resolution.attemptId !== attempt.attemptId || resolution.outcome === "FAILED") fail("capture", "Capture requires successful attempt resolution");
  if (capture.observedAt > resolution.retrievalCompletedAt) fail("observedAt", "cannot follow retrieval completion");
}

export function canonicalizeRcv020Attempt(attempt: Rcv020RetrievalAttempt): Rcv020CanonicalResult {
  validateRcv020Uuid(attempt.attemptId, "attemptId");
  validateRcv020Uuid(attempt.occurrenceId, "occurrenceId");
  if (attempt.previousAttemptId != null) validateRcv020Uuid(attempt.previousAttemptId, "previousAttemptId");
  validateRcv020Timestamp(attempt.retrievalStartedAt, "retrievalStartedAt");
  validateRcv020Timestamp(attempt.attemptDeadlineAt, "attemptDeadlineAt");
  return canonicalizeRcv020({ schema: "RCV020-ATTEMPT-V1", ...attempt, retryNumber: validateRcv020BigInt(attempt.retryNumber, "retryNumber").toString(10), previousAttemptId: attempt.previousAttemptId ?? null }, "attempt");
}

export function canonicalizeRcv020Capture(capture: Rcv020Capture): Rcv020CanonicalResult {
  validateRcv020Uuid(capture.captureId, "captureId");
  validateRcv020Hash(capture.contentHash, "contentHash");
  validateRcv020Timestamp(capture.observedAt, "observedAt");
  const byteLength = validateRcv020NonNegativeBigInt(capture.byteLength, "byteLength").toString(10);
  return canonicalizeRcv020({ schema: "RCV020-CAPTURE-V1", ...capture, byteLength }, "capture");
}

function validateRcv020Hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(path, "expected lowercase SHA-256 hash");
  return value;
}

export function validateCaptureComparison(
  comparison: Rcv020CaptureComparison,
  current: Rcv020Capture,
  prior?: Rcv020Capture,
): void {
  validateRcv020Uuid(comparison.comparisonId, "comparisonId");
  validateRcv020Uuid(comparison.currentCaptureId, "currentCaptureId");
  if (comparison.currentCaptureId !== current.captureId) fail("currentCaptureId", "does not match current Capture");
  oneOf(comparison.result, RCV020_COMPARISON_RESULTS, "result");
  if (comparison.algorithmId.length === 0 || !Number.isInteger(comparison.algorithmVersion) || comparison.algorithmVersion < 1) fail("algorithm", "algorithm identity/version is required");
  if (/(?:ai|semantic|similarity)/i.test(comparison.algorithmId)) fail("algorithm", "semantic or AI similarity is not authoritative");
  if (comparison.priorCaptureId == null) {
    if (comparison.result !== "FIRST_OBSERVED") fail("priorCaptureId", "required except for FIRST_OBSERVED");
    return;
  }
  validateRcv020Uuid(comparison.priorCaptureId, "priorCaptureId");
  if (!prior || prior.captureId !== comparison.priorCaptureId) fail("priorCaptureId", "unknown prior Capture");
  if (prior.captureId === current.captureId) fail("priorCaptureId", "self-comparison is forbidden");
  if (prior.monitorId !== current.monitorId) fail("priorCaptureId", "comparison crosses Monitor");
  if (prior.observedAt >= current.observedAt) fail("priorCaptureId", "prior Capture must be strictly earlier");
  if (comparison.result === "FIRST_OBSERVED") fail("result", "FIRST_OBSERVED cannot reference prior Capture");
}

export function canonicalizeRcv020CaptureComparison(comparison: Rcv020CaptureComparison): Rcv020CanonicalResult {
  if (comparison.priorCaptureId == null && comparison.result !== "FIRST_OBSERVED") fail("result", "non-first comparison requires prior Capture");
  validateRcv020Uuid(comparison.comparisonId, "comparisonId");
  validateRcv020Uuid(comparison.currentCaptureId, "currentCaptureId");
  if (comparison.priorCaptureId != null) validateRcv020Uuid(comparison.priorCaptureId, "priorCaptureId");
  oneOf(comparison.result, RCV020_COMPARISON_RESULTS, "result");
  if (typeof comparison.algorithmId !== "string" || comparison.algorithmId.length === 0 || !Number.isInteger(comparison.algorithmVersion) || comparison.algorithmVersion < 1) fail("algorithm", "algorithm identity/version is required");
  if (/(?:ai|semantic|similarity)/i.test(comparison.algorithmId)) fail("algorithm", "semantic or AI similarity is not authoritative");
  return canonicalizeRcv020({ schema: "RCV020-COMPARISON-V1", ...comparison, priorCaptureId: comparison.priorCaptureId ?? null }, "comparison");
}

export function validateRetentionAvailabilityEvent(event: Rcv020RetentionAvailabilityEvent): void {
  validateRcv020Uuid(event.eventId, "eventId");
  validateRcv020Uuid(event.captureId, "captureId");
  oneOf(event.eventType, RCV020_RETENTION_EVENTS, "eventType");
  validateRcv020Timestamp(event.eventAt, "eventAt");
  validateRcv020BigInt(event.eventSequence, "eventSequence");
}

export function canonicalizeRcv020RetentionAvailabilityEvent(event: Rcv020RetentionAvailabilityEvent): Rcv020CanonicalResult {
  validateRetentionAvailabilityEvent(event);
  return canonicalizeRcv020({ schema: "RCV020-RETENTION-EVENT-V1", ...event, eventSequence: validateRcv020BigInt(event.eventSequence, "eventSequence").toString(10) }, "retentionEvent");
}

export function reconstructRcv020SemanticState(
  config: Rcv020MonitorConfigurationVersion,
  lifecycle: readonly Rcv020LifecycleEvent[],
  occurrence: Rcv020ObservationOccurrence,
  attempts: readonly Rcv020RetrievalAttempt[],
  resolutions: readonly Rcv020AttemptResolution[],
  captures: readonly Rcv020Capture[],
): Readonly<{ lifecycleState: Rcv020LifecycleState; occurrenceOutcome: Rcv020OccurrenceOutcome }> {
  const lifecycleState = deriveLifecycleState(config, lifecycle);
  const occurrenceOutcome = resolveOccurrenceTerminal(occurrence, attempts, resolutions, captures);
  return Object.freeze({ lifecycleState, occurrenceOutcome });
}
