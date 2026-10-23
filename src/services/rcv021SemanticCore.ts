import { assessRcv021DeadlineEvidence } from "./rcv021DeadlineProvenance";
import {
  RCV021_ATTEMPT_OUTCOMES, RCV021_FAILURE_CODES, RCV021_RUN_TERMINAL_OUTCOMES, RCV021_SUBJECT_TYPES, RCV021_TRIGGER_TYPES,
  AttemptResolution, OperationLifecycleEvent, ProviderResult, ResearchAttempt,
  ResearchOperation, ResearchRun, ResultSelection, RunLifecycleEvent,
  RunTerminalResolution, SubjectBinding, TriggerBinding, Rcv021FailureCode,
  Rcv021ValidationError, Rcv021RunState,
} from "../contracts/rcv021ActiveResearchContractV1";
import { assertRcv021HashMatches, canonicalizeRcv021Authority, canonicalRcv021NonNegativeBigInt, deriveProviderResultManifest, validateRcv021BigInt, validateRcv021NonNegativeBigInt, validateRcv021Timestamp, validateRcv021Uuid, validateRcv021Version } from "./rcv021Canonical";

export const RCV021_FAILURE_PRECEDENCE: readonly Rcv021FailureCode[] = Object.freeze([...RCV021_FAILURE_CODES]);
function fail(code: Rcv021FailureCode, path: string, message: string): never { throw new Rcv021ValidationError(code, path, message); }
function ensure(condition: unknown, code: Rcv021FailureCode, path: string, message: string): void { if (!condition) fail(code, path, message); }
function text(value: unknown, path: string): string { ensure(typeof value === "string" && value.length > 0, "MALFORMED_DATA", path, "expected non-empty text"); return value as string; }
export function authenticateRcv021CanonicalFields(value: { readonly canonicalVersion: number; readonly canonical: string; readonly canonicalHash: string }, path: string): void {
  validateRcv021Version(value.canonicalVersion, `${path}.canonicalVersion`);
  text(value.canonical, `${path}.canonical`);
  const payload = (input: unknown): unknown => {
    if (typeof input === "bigint") return input.toString(10);
    if (Array.isArray(input)) return input.map(payload);
    if (input !== null && typeof input === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) if (key !== "canonicalVersion" && key !== "canonical" && key !== "canonicalHash") output[key] = payload(item);
      return output;
    }
    return input;
  };
  const expected = canonicalizeRcv021Authority(payload(value), path).canonical;
  if (expected !== value.canonical) throw new Rcv021ValidationError("CANONICAL_MISMATCH", `${path}.canonical`, "does not match semantic fields");
  assertRcv021HashMatches(value.canonical, value.canonicalHash, `${path}.canonicalHash`);
}
function id(value: unknown, path: string): string { return validateRcv021Uuid(value, path); }
function ts(value: unknown, path: string): string { return validateRcv021Timestamp(value, path); }

export function validateSubjectBinding(binding: SubjectBinding): SubjectBinding {
  authenticateRcv021CanonicalFields(binding, "subject"); id(binding.subjectBindingId, "subject.subjectBindingId"); id(binding.operationId, "subject.operationId");
  ensure(RCV021_SUBJECT_TYPES.includes(binding.subjectType), "SUBJECT_BINDING_VIOLATION", "subject.subjectType", "unsupported subject type");
  const refs: Record<string, string | null | undefined> = { captureId: binding.captureId, observationOccurrenceId: binding.observationOccurrenceId, researchTriggerRequestId: binding.researchTriggerRequestId, operatorRequestId: binding.operatorRequestId, historicalClaimId: binding.historicalClaimId };
  const present = Object.entries(refs).filter(([, value]) => value !== null && value !== undefined);
  ensure(present.length === 1, "SUBJECT_BINDING_VIOLATION", "subject", "exactly one typed reference is required");
  const expected: Record<string, string> = { RCV020_CAPTURE: "captureId", RCV020_OBSERVATION_OCCURRENCE: "observationOccurrenceId", RCV020_RESEARCH_TRIGGER_REQUEST: "researchTriggerRequestId", AUTHENTICATED_OPERATOR_REQUEST: "operatorRequestId", HISTORICAL_CLAIM_IDENTITY: "historicalClaimId" };
  ensure(present[0][0] === expected[binding.subjectType], "SUBJECT_BINDING_VIOLATION", `subject.${present[0][0]}`, "reference does not match discriminator");
  id(present[0][1], `subject.${present[0][0]}`);
  return binding;
}

export function validateTriggerBinding(binding: TriggerBinding): TriggerBinding {
  authenticateRcv021CanonicalFields(binding, "trigger"); id(binding.triggerBindingId, "trigger.triggerBindingId"); id(binding.operationId, "trigger.operationId");
  ensure(RCV021_TRIGGER_TYPES.includes(binding.triggerType), "TRIGGER_BINDING_VIOLATION", "trigger.triggerType", "unsupported trigger type");
  if (binding.triggerType === "OPERATOR") {
    text(binding.initiatorIdentity, "trigger.initiatorIdentity"); text(binding.authorizationCanonical, "trigger.authorizationCanonical"); if (binding.creationTime != null) ts(binding.creationTime, "trigger.creationTime"); text(binding.executionOwner, "trigger.executionOwner"); if (binding.executionContext != null) text(binding.executionContext, "trigger.executionContext");
    for (const key of ["triggerRequestId", "originatingCaptureId", "originatingOccurrenceId", "ruleIdentity", "ruleVersion"]) ensure(binding[key as keyof TriggerBinding] == null, "TRIGGER_BINDING_VIOLATION", `trigger.${key}`, "forbidden for OPERATOR");
  } else {
    text(binding.triggerRequestId, "trigger.triggerRequestId"); if (binding.creationTime != null) ts(binding.creationTime, "trigger.creationTime"); text(binding.executionOwner, "trigger.executionOwner"); text(binding.ruleIdentity, "trigger.ruleIdentity"); ensure(Number.isInteger(binding.ruleVersion) && (binding.ruleVersion as number) >= 1, "TRIGGER_BINDING_VIOLATION", "trigger.ruleVersion", "positive rule version required");
    ensure((binding.originatingCaptureId == null) !== (binding.originatingOccurrenceId == null), "TRIGGER_BINDING_VIOLATION", "trigger.originating", "at most one originating reference is allowed");
    if (binding.originatingCaptureId != null) id(binding.originatingCaptureId, "trigger.originatingCaptureId");
    if (binding.originatingOccurrenceId != null) id(binding.originatingOccurrenceId, "trigger.originatingOccurrenceId");
    for (const key of ["initiatorIdentity", "authorizationCanonical", "executionContext"]) ensure(binding[key as keyof TriggerBinding] == null, "TRIGGER_BINDING_VIOLATION", `trigger.${key}`, "forbidden for RCV020_RESEARCH_REQUEST");
  }
  return binding;
}

export function validateOperationCreation(operation: ResearchOperation, subject: SubjectBinding, trigger: TriggerBinding): ResearchOperation {
  authenticateRcv021CanonicalFields(operation, "operation"); id(operation.operationId, "operation.operationId"); id(operation.subjectBindingId, "operation.subjectBindingId"); id(operation.triggerBindingId, "operation.triggerBindingId"); text(operation.purpose, "operation.purpose"); text(operation.scopeCanonical, "operation.scopeCanonical"); ts(operation.operationCreatedAt, "operation.operationCreatedAt");
  ensure(subject.operationId === operation.operationId && subject.subjectBindingId === operation.subjectBindingId, "IDENTITY_MISMATCH", "operation.subjectBindingId", "subject does not belong to operation");
  ensure(trigger.operationId === operation.operationId && trigger.triggerBindingId === operation.triggerBindingId, "IDENTITY_MISMATCH", "operation.triggerBindingId", "trigger does not belong to operation");
  validateSubjectBinding(subject); validateTriggerBinding(trigger); return operation;
}

export function deriveOperationLifecycle(operation: ResearchOperation, events: ReadonlyArray<OperationLifecycleEvent>): "OPEN" | "CLOSED" {
  ts(operation.operationCreatedAt, "operation.operationCreatedAt"); let closed = false;
  for (const event of [...events].sort((a, b) => Buffer.from(typeof a.eventAt === "string" ? a.eventAt : "", "utf8").compare(Buffer.from(typeof b.eventAt === "string" ? b.eventAt : "", "utf8")) || Buffer.from(typeof a.eventId === "string" ? a.eventId : "", "utf8").compare(Buffer.from(typeof b.eventId === "string" ? b.eventId : "", "utf8")))) {
    authenticateRcv021CanonicalFields(event, "operationLifecycle"); id(event.eventId, "event.eventId"); ensure(event.operationId === operation.operationId, "IDENTITY_MISMATCH", "event.operationId", "wrong operation"); ensure(event.eventType === "CLOSED", "UNSUPPORTED_STATE", "event.eventType", "unsupported operation event"); ts(event.eventAt, "event.eventAt"); text(event.actorIdentity, "event.actorIdentity"); ensure(event.eventAt >= operation.operationCreatedAt, "ORDERING_VIOLATION", "event.eventAt", "before operation creation"); ensure(!closed, "LIFECYCLE_VIOLATION", "event", "duplicate close"); closed = true;
  }
  return closed ? "CLOSED" : "OPEN";
}

export function validateRunCreation(run: ResearchRun, operation: ResearchOperation, operationState: "OPEN" | "CLOSED", predecessor?: { readonly run: ResearchRun; readonly terminalAt: string; }): ResearchRun {
  authenticateRcv021CanonicalFields(run, "run"); id(run.runId, "run.runId"); id(run.operationId, "run.operationId"); ensure(run.operationId === operation.operationId, "IDENTITY_MISMATCH", "run.operationId", "wrong operation"); ensure(operationState === "OPEN", "LIFECYCLE_VIOLATION", "operation", "closed operation cannot create a run"); text(run.strategyIdentity, "run.strategyIdentity"); ensure(Number.isInteger(run.strategyVersion) && run.strategyVersion >= 1, "VERSION_MISMATCH", "run.strategyVersion", "positive version required"); text(run.providerIdentity, "run.providerIdentity"); text(run.adapterIdentity, "run.adapterIdentity"); text(run.adapterVersion, "run.adapterVersion"); text(run.executionParametersCanonical, "run.executionParametersCanonical"); ts(run.runCreatedAt, "run.runCreatedAt"); ts(run.deadlineAt, "run.deadlineAt"); ensure(run.deadlineAt >= run.runCreatedAt, "DEADLINE_VIOLATION", "run.deadlineAt", "deadline before creation");
  if (run.predecessorRunId != null) { id(run.predecessorRunId, "run.predecessorRunId"); ensure(predecessor != null && predecessor.run.operationId === operation.operationId && predecessor.run.runId === run.predecessorRunId, "RERUN_LINEAGE_VIOLATION", "run.predecessorRunId", "invalid predecessor"); ensure(predecessor!.terminalAt < run.runCreatedAt, "ORDERING_VIOLATION", "run.runCreatedAt", "rerun must follow predecessor terminal"); }
  return run;
}

export function validateRunLifecycle(run: ResearchRun, starts: ReadonlyArray<RunLifecycleEvent>, terminal: RunTerminalResolution | undefined, attempts: ReadonlyArray<ResearchAttempt>, resolutions: ReadonlyArray<AttemptResolution>, results: ReadonlyArray<ProviderResult> = [], deadlineMode: "write" | "historical" = "write"): Rcv021RunState {
  ts(run.runCreatedAt, "run.runCreatedAt"); ensure(starts.length <= 1, "LIFECYCLE_VIOLATION", "run.lifecycle", "duplicate start");
  if (starts.length) { const start = starts[0]; authenticateRcv021CanonicalFields(start, "runStart"); ensure(start.runId === run.runId && start.eventType === "STARTED", "LIFECYCLE_VIOLATION", "runStart", "invalid start"); ensure(start.eventAt >= run.runCreatedAt, "ORDERING_VIOLATION", "runStart.eventAt", "before run creation"); ts(start.eventAt, "runStart.eventAt"); text(start.executionAuthority, "runStart.executionAuthority"); }
  if (!terminal) return starts.length ? "RUNNING" : "PLANNED";
  validateRunTerminalResolution(terminal, run, attempts, resolutions, results, deadlineMode);
  ensure(starts.length === 1, "LIFECYCLE_VIOLATION", "run", "terminal run must have started");
  return terminal.outcome;
}

export function validateAttemptResolution(attempt: ResearchAttempt, resolution: AttemptResolution, runTerminalAt?: string): AttemptResolution {
  authenticateRcv021CanonicalFields(resolution, "attemptResolution"); id(resolution.resolutionId, "attemptResolution.resolutionId"); id(resolution.attemptId, "attemptResolution.attemptId"); ensure(resolution.attemptId === attempt.attemptId, "IDENTITY_MISMATCH", "attemptResolution.attemptId", "wrong attempt"); ensure(RCV021_ATTEMPT_OUTCOMES.includes(resolution.outcome), "UNSUPPORTED_STATE", "attemptResolution.outcome", "unsupported attempt outcome"); ts(attempt.startedAt, "attempt.startedAt"); ts(resolution.terminalAt, "attemptResolution.terminalAt"); ensure(resolution.terminalAt >= attempt.startedAt, "ORDERING_VIOLATION", "attemptResolution.terminalAt", "before start"); ensure(runTerminalAt === undefined || resolution.terminalAt <= runTerminalAt, "ORDERING_VIOLATION", "attemptResolution.terminalAt", "after run terminal");
  if (resolution.outcome === "FAILED") { if (resolution.failureAuthority != null) text(resolution.failureAuthority, "attemptResolution.failureAuthority"); } else ensure(resolution.failureAuthority == null, "MALFORMED_DATA", "attemptResolution.failureAuthority", "forbidden for SUCCEEDED");
  return resolution;
}

export function validateRetry(attempt: ResearchAttempt, predecessor: ResearchAttempt | undefined, predecessorResolution: AttemptResolution | undefined, runTerminalAt?: string): ResearchAttempt {
  validateRcv021BigInt(attempt.attemptNumber, "attempt.attemptNumber"); ensure(predecessor != null && predecessorResolution != null, "RETRY_LINEAGE_VIOLATION", "attempt.predecessorAttemptId", "predecessor required");
  ensure(attempt.runId === predecessor!.runId, "RETRY_LINEAGE_VIOLATION", "attempt.runId", "retry must stay in run"); ensure(predecessorResolution!.outcome === "FAILED", "RETRY_LINEAGE_VIOLATION", "predecessorResolution.outcome", "FAILED predecessor required"); validateAttemptResolution(predecessor!, predecessorResolution!);
  ensure(attempt.startedAt > predecessorResolution!.terminalAt, "ORDERING_VIOLATION", "attempt.startedAt", "retry must start after predecessor terminal"); ensure(validateRcv021BigInt(attempt.attemptNumber) === validateRcv021BigInt(predecessor!.attemptNumber) + 1n, "RETRY_LINEAGE_VIOLATION", "attempt.attemptNumber", "retry number must increment exactly"); ensure(runTerminalAt === undefined || attempt.startedAt < runTerminalAt, "RETRY_LINEAGE_VIOLATION", "attempt.startedAt", "retry after run terminal"); return attempt;
}

export function validateAttemptSet(attempts: ReadonlyArray<ResearchAttempt>, resolutions: ReadonlyArray<AttemptResolution>, runTerminalAt?: string): void {
  const seen = new Set<string>(); const byId = new Map(attempts.map((a) => [a.attemptId, a]));
  for (const attempt of attempts) { id(attempt.attemptId, "attempt.attemptId"); ensure(!seen.has(attempt.attemptId), "DUPLICATE_CONFLICT", "attempt.attemptId", "duplicate attempt"); seen.add(attempt.attemptId); validateRcv021BigInt(attempt.attemptNumber, "attempt.attemptNumber"); ts(attempt.startedAt, "attempt.startedAt"); if (attempt.predecessorAttemptId != null) { const pred = byId.get(attempt.predecessorAttemptId); const res = resolutions.find((r) => r.attemptId === attempt.predecessorAttemptId); validateRetry(attempt, pred, res, runTerminalAt); } else ensure(validateRcv021BigInt(attempt.attemptNumber) === 1n, "RETRY_LINEAGE_VIOLATION", "attempt.attemptNumber", "first attempt must be 1"); }
  const resolved = new Map<string, AttemptResolution>(); for (const resolution of resolutions) { ensure(!resolved.has(resolution.attemptId), "DUPLICATE_CONFLICT", "attemptResolution.attemptId", "duplicate resolution"); const attempt = byId.get(resolution.attemptId); ensure(attempt != null, "MISSING_DATA", "attemptResolution.attemptId", "attempt missing"); validateAttemptResolution(attempt!, resolution, runTerminalAt); resolved.set(resolution.attemptId, resolution); }
  for (const attempt of attempts) ensure(resolved.has(attempt.attemptId), "LIFECYCLE_VIOLATION", `attempts.${attempt.attemptId}`, "started attempt unresolved");
  for (const attempt of attempts) {
    const path = new Set<string>(); let cursor: ResearchAttempt | undefined = attempt;
    while (cursor?.predecessorAttemptId != null) {
      ensure(!path.has(cursor.attemptId), "RETRY_LINEAGE_VIOLATION", `attempts.${attempt.attemptId}`, "cyclic retry lineage"); path.add(cursor.attemptId); cursor = byId.get(cursor.predecessorAttemptId); ensure(cursor != null, "RETRY_LINEAGE_VIOLATION", `attempts.${attempt.attemptId}.predecessorAttemptId`, "missing lineage predecessor");
    }
  }
}

export function validateRunTerminalResolution(resolution: RunTerminalResolution, run: ResearchRun, attempts: ReadonlyArray<ResearchAttempt>, attemptResolutions: ReadonlyArray<AttemptResolution>, results: ReadonlyArray<ProviderResult>, deadlineMode: "write" | "historical" = "write"): void {
  authenticateRcv021CanonicalFields(resolution, "terminal"); id(resolution.resolutionId, "terminal.resolutionId"); ensure(resolution.runId === run.runId, "IDENTITY_MISMATCH", "terminal.runId", "wrong run"); ensure(RCV021_RUN_TERMINAL_OUTCOMES.includes(resolution.outcome), "UNSUPPORTED_STATE", "terminal.outcome", "unsupported terminal outcome"); ts(resolution.terminalAt, "terminal.terminalAt"); text(resolution.completionAuthority, "terminal.completionAuthority"); validateRcv021NonNegativeBigInt(resolution.resultCount, "terminal.resultCount"); validateAttemptSet(attempts, attemptResolutions, resolution.terminalAt); ensure(resolution.outcome !== "TIMED_OUT" || resolution.terminalAt >= run.deadlineAt, "DEADLINE_VIOLATION", "terminal.terminalAt", "timeout before deadline");
  const deadlineEvidence = assessRcv021DeadlineEvidence(run, resolution, attempts, attemptResolutions);
  if (deadlineMode === "write") ensure(deadlineEvidence.status === "VERIFIED", "DEADLINE_VIOLATION", "deadlineProvenance", "deadline evidence is UNKNOWN");
  for (const result of results) ensure(result.resultObservedAt <= resolution.terminalAt, "ORDERING_VIOLATION", `results.${result.resultId}.resultObservedAt`, "late result cannot enter terminal manifest");
  const manifest = deriveProviderResultManifest(results); ensure(canonicalRcv021NonNegativeBigInt(resolution.resultCount) === manifest.count, "RESULT_MANIFEST_MISMATCH", "terminal.resultCount", "count differs"); ensure(resolution.resultManifestCanonical === manifest.canonical, "RESULT_MANIFEST_MISMATCH", "terminal.resultManifestCanonical", "manifest differs"); ensure(resolution.resultManifestHash === manifest.hash, "RESULT_MANIFEST_MISMATCH", "terminal.resultManifestHash", "manifest hash differs");
  if (resolution.outcome === "SUCCESS_NO_RESULTS") ensure(manifest.count === "0", "TERMINAL_RESOLUTION_MISMATCH", "terminal.outcome", "no-results requires empty manifest");
  if (resolution.outcome === "SUCCESS_WITH_RESULTS") ensure(manifest.count !== "0", "TERMINAL_RESOLUTION_MISMATCH", "terminal.outcome", "results required");
}

export function deriveTerminalManifest(results: ReadonlyArray<ProviderResult>): { readonly canonical: string; readonly hash: string; readonly count: string } { return deriveProviderResultManifest(results); }
export function validateProviderResult(result: ProviderResult, run?: ResearchRun): ProviderResult { authenticateRcv021CanonicalFields(result, "providerResult"); id(result.resultId, "providerResult.resultId"); id(result.runId, "providerResult.runId"); ensure(!run || result.runId === run.runId, "IDENTITY_MISMATCH", "providerResult.runId", "wrong run"); text(result.providerItemIdentity, "providerResult.providerItemIdentity"); text(result.providerEnvelopeCanonical, "providerResult.providerEnvelopeCanonical"); text(result.providerIdentity, "providerResult.providerIdentity"); text(result.adapterIdentity, "providerResult.adapterIdentity"); text(result.adapterVersion, "providerResult.adapterVersion"); ts(result.resultObservedAt, "providerResult.resultObservedAt"); text(result.protocolResultStatus, "providerResult.protocolResultStatus"); if (result.providerSourceTime != null) ts(result.providerSourceTime, "providerResult.providerSourceTime"); return result; }
export function validateResultSelection(selection: ResultSelection, results: ReadonlyArray<ProviderResult>): ResultSelection { authenticateRcv021CanonicalFields(selection, "selection"); id(selection.selectionId, "selection.selectionId"); id(selection.providerResultId, "selection.providerResultId"); id(selection.observationOccurrenceId, "selection.observationOccurrenceId"); text(selection.selectionAuthorization, "selection.selectionAuthorization"); text(selection.selectedArtifactIdentity, "selection.selectedArtifactIdentity"); ts(selection.selectedAt, "selection.selectedAt"); ensure(results.some((result) => result.resultId === selection.providerResultId), "RESULT_BINDING_VIOLATION", "selection.providerResultId", "provider result missing"); return selection; }
export function validateObservationBinding(selection: ResultSelection, occurrenceId: string): void { id(occurrenceId, "occurrenceId"); ensure(selection.observationOccurrenceId === occurrenceId, "RCV020_BINDING_VIOLATION", "selection.observationOccurrenceId", "occurrence identity mismatch"); }
export function validateRerun(run: ResearchRun, operation: ResearchOperation, operationState: "OPEN" | "CLOSED", predecessor?: ResearchRun & { readonly terminalAt?: string }): void { ensure(operationState === "OPEN", "RERUN_LINEAGE_VIOLATION", "operation", "operation must remain open"); ensure(run.operationId === operation.operationId, "IDENTITY_MISMATCH", "run.operationId", "wrong operation"); if (run.predecessorRunId != null) { ensure(predecessor != null && predecessor.runId === run.predecessorRunId && predecessor.operationId === operation.operationId && predecessor.terminalAt != null, "RERUN_LINEAGE_VIOLATION", "run.predecessorRunId", "terminal predecessor required"); ensure(run.runCreatedAt > predecessor!.terminalAt!, "ORDERING_VIOLATION", "run.runCreatedAt", "rerun must follow terminal predecessor"); } }
export function isLateProviderResult(resultObservedAt: string, runTerminalAt: string): boolean { return resultObservedAt > runTerminalAt; }
export type Rcv021IdentityComparison = "IDEMPOTENT" | "CONFLICT" | "DISTINCT";
export function compareRcv021Identity(existingId: string, existingCanonical: string, incomingId: string, incomingCanonical: string): Rcv021IdentityComparison {
  if (existingId !== incomingId) return "DISTINCT";
  return existingCanonical === incomingCanonical ? "IDEMPOTENT" : "CONFLICT";
}

export interface FailureFinding { readonly code: Rcv021FailureCode; readonly path: string; readonly message?: string; }
export function classifyRcv021Failures(findings: ReadonlyArray<FailureFinding>): FailureFinding | undefined {
  return [...findings].sort((a, b) => {
    const precedence = RCV021_FAILURE_PRECEDENCE.indexOf(a.code) - RCV021_FAILURE_PRECEDENCE.indexOf(b.code);
    if (precedence !== 0) return precedence;
    return Buffer.from(a.path, "utf8").compare(Buffer.from(b.path, "utf8"));
  })[0];
}
