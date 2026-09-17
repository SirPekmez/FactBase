export const RCV021_CANONICAL_VERSION = 1 as const;

export const RCV021_OPERATION_LIFECYCLES = ["OPEN", "CLOSED"] as const;
export const RCV021_OPERATION_LIFECYCLE_STATES = RCV021_OPERATION_LIFECYCLES;
export type Rcv021OperationLifecycle = (typeof RCV021_OPERATION_LIFECYCLES)[number];
export const RCV021_RUN_STATES = ["PLANNED", "RUNNING", "SUCCESS_WITH_RESULTS", "SUCCESS_NO_RESULTS", "FAILED", "TIMED_OUT"] as const;
export const RCV021_RUN_LIFECYCLE_STATES = RCV021_RUN_STATES;
export const RCV021_RUN_TERMINAL_OUTCOMES = ["SUCCESS_WITH_RESULTS", "SUCCESS_NO_RESULTS", "FAILED", "TIMED_OUT"] as const;
export type Rcv021RunState = (typeof RCV021_RUN_STATES)[number];
export const RCV021_ATTEMPT_OUTCOMES = ["SUCCEEDED", "FAILED"] as const;
export const RCV021_ATTEMPT_TERMINAL_OUTCOMES = RCV021_ATTEMPT_OUTCOMES;
export type Rcv021AttemptOutcome = (typeof RCV021_ATTEMPT_OUTCOMES)[number];
export const RCV021_TRIGGER_TYPES = ["OPERATOR", "RCV020_RESEARCH_REQUEST"] as const;
export const RCV021_TRIGGER_DISCRIMINATORS = RCV021_TRIGGER_TYPES;
export type Rcv021TriggerType = (typeof RCV021_TRIGGER_TYPES)[number];
export const RCV021_SUBJECT_TYPES = ["RCV020_CAPTURE", "RCV020_OBSERVATION_OCCURRENCE", "RCV020_RESEARCH_TRIGGER_REQUEST", "AUTHENTICATED_OPERATOR_REQUEST", "HISTORICAL_CLAIM_IDENTITY"] as const;
export const RCV021_SUBJECT_DISCRIMINATORS = RCV021_SUBJECT_TYPES;
export type Rcv021SubjectType = (typeof RCV021_SUBJECT_TYPES)[number];
export const RCV021_OPERATION_EVENT_TYPES = ["CLOSED"] as const;
export const RCV021_RUN_EVENT_TYPES = ["STARTED"] as const;

export const RCV021_FAILURE_CODES = [
  "MISSING_DATA", "MALFORMED_DATA", "VERSION_MISMATCH", "CANONICAL_MISMATCH", "HASH_MISMATCH", "IDENTITY_MISMATCH", "DUPLICATE_CONFLICT", "SUBJECT_BINDING_VIOLATION", "TRIGGER_BINDING_VIOLATION", "ORDERING_VIOLATION", "DEADLINE_VIOLATION", "LIFECYCLE_VIOLATION", "RETRY_LINEAGE_VIOLATION", "RERUN_LINEAGE_VIOLATION", "TERMINAL_RESOLUTION_MISMATCH", "RESULT_MANIFEST_MISMATCH", "RESULT_BINDING_VIOLATION", "RCV020_BINDING_VIOLATION", "CURRENT_STATE_SUBSTITUTION", "UNSUPPORTED_STATE",
] as const;
export const RCV021_FAILURE_TAXONOMY = RCV021_FAILURE_CODES;
export type Rcv021FailureCode = (typeof RCV021_FAILURE_CODES)[number];

export class Rcv021ValidationError extends Error {
  readonly name = "Rcv021ValidationError";
  constructor(readonly code: Rcv021FailureCode, readonly path: string, message: string) {
    super(`${code} at ${path}: ${message}`);
  }
}

export type CanonicalFields = Readonly<{ canonicalVersion: number; canonical: string; canonicalHash: string }>;
export interface SubjectBinding extends CanonicalFields {
  readonly subjectBindingId: string; readonly operationId: string; readonly subjectType: Rcv021SubjectType;
  readonly captureId?: string | null; readonly observationOccurrenceId?: string | null; readonly researchTriggerRequestId?: string | null; readonly operatorRequestId?: string | null; readonly historicalClaimId?: string | null;
}
export interface TriggerBinding extends CanonicalFields {
  readonly triggerBindingId: string; readonly operationId: string; readonly triggerType: Rcv021TriggerType;
  readonly initiatorIdentity?: string | null; readonly authorizationCanonical?: string | null; readonly creationTime?: string | null; readonly executionOwner?: string | null; readonly executionContext?: string | null;
  readonly triggerRequestId?: string | null; readonly originatingCaptureId?: string | null; readonly originatingOccurrenceId?: string | null; readonly ruleIdentity?: string | null; readonly ruleVersion?: number | null;
}
export interface ResearchOperation extends CanonicalFields { readonly operationId: string; readonly subjectBindingId: string; readonly triggerBindingId: string; readonly purpose: string; readonly scopeCanonical: string; readonly operationCreatedAt: string; }
export interface OperationLifecycleEvent extends CanonicalFields { readonly eventId: string; readonly operationId: string; readonly eventType: "CLOSED"; readonly eventAt: string; readonly actorIdentity: string; }
export interface ResearchRun extends CanonicalFields { readonly runId: string; readonly operationId: string; readonly strategyIdentity: string; readonly strategyVersion: number; readonly providerIdentity: string; readonly adapterIdentity: string; readonly adapterVersion: string; readonly executionParametersCanonical: string; readonly runCreatedAt: string; readonly deadlineAt: string; readonly predecessorRunId?: string | null; }
export interface RunLifecycleEvent extends CanonicalFields { readonly eventId: string; readonly runId: string; readonly eventType: "STARTED"; readonly eventAt: string; readonly executionAuthority: string; }
export interface RunTerminalResolution extends CanonicalFields { readonly resolutionId: string; readonly runId: string; readonly outcome: "SUCCESS_WITH_RESULTS" | "SUCCESS_NO_RESULTS" | "FAILED" | "TIMED_OUT"; readonly terminalAt: string; readonly completionAuthority: string; readonly resultManifestCanonical: string; readonly resultManifestHash: string; readonly resultCount: bigint | string; }
export interface ResearchAttempt extends CanonicalFields { readonly attemptId: string; readonly runId: string; readonly attemptNumber: bigint | string; readonly predecessorAttemptId?: string | null; readonly startedAt: string; }
export interface AttemptResolution extends CanonicalFields { readonly resolutionId: string; readonly attemptId: string; readonly outcome: Rcv021AttemptOutcome; readonly terminalAt: string; readonly failureAuthority?: string | null; }
export interface ProviderResult extends CanonicalFields { readonly resultId: string; readonly runId: string; readonly providerItemIdentity: string; readonly providerEnvelopeCanonical: string; readonly providerIdentity: string; readonly adapterIdentity: string; readonly adapterVersion: string; readonly resultObservedAt: string; readonly providerSourceTime?: string | null; readonly protocolResultStatus: string; }
export interface ResultSelection extends CanonicalFields { readonly selectionId: string; readonly providerResultId: string; readonly selectionAuthorization: string; readonly selectedArtifactIdentity: string; readonly observationOccurrenceId: string; readonly selectedAt: string; }
