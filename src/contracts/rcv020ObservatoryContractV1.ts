export const RCV020_CONTRACT_VERSION = 1 as const;
export const RCV020_CANONICAL_VERSION = "RCV020-CANONICAL-V1" as const;
export const RCV020_REQUEST_CANONICAL_VERSION = "RCV020-REQUEST-V1" as const;
export const RCV020_FAILURE_TAXONOMY_VERSION = 1 as const;

export const RCV020_TRIGGER_ORIGINS = ["SCHEDULED", "EXTERNAL", "OPERATOR"] as const;
export type Rcv020TriggerOrigin = (typeof RCV020_TRIGGER_ORIGINS)[number];
export const RCV020_OCCURRENCE_OUTCOMES = ["SUCCEEDED", "FAILED", "MISSED", "SKIPPED"] as const;
export type Rcv020OccurrenceOutcome = (typeof RCV020_OCCURRENCE_OUTCOMES)[number];
export const RCV020_ATTEMPT_OUTCOMES = ["CAPTURED_CHANGED", "CAPTURED_UNCHANGED", "CAPTURED_EMPTY", "FAILED"] as const;
export type Rcv020AttemptOutcome = (typeof RCV020_ATTEMPT_OUTCOMES)[number];
export const RCV020_LIFECYCLE_EVENTS = ["ACTIVATED", "RETIRED", "PAUSED", "RESUMED"] as const;
export type Rcv020LifecycleEventType = (typeof RCV020_LIFECYCLE_EVENTS)[number];
export const RCV020_COMPARISON_RESULTS = ["FIRST_OBSERVED", "CHANGED", "UNCHANGED"] as const;
export type Rcv020ComparisonResult = (typeof RCV020_COMPARISON_RESULTS)[number];
export const RCV020_RETENTION_EVENTS = ["DELETED", "EXPIRED", "RESTRICTED", "LOST", "AVAILABILITY_CHANGED"] as const;
export type Rcv020RetentionEventType = (typeof RCV020_RETENTION_EVENTS)[number];
export const RCV020_FAILURE_CODES = [
  "DNS_FAILURE", "CONNECTION_FAILURE", "TIMEOUT", "HTTP_FAILURE", "AUTHENTICATION_FAILURE",
  "RATE_LIMITED", "UNSAFE_REDIRECT", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA", "MALFORMED_RESPONSE",
  "PARSER_FAILURE", "CAPTURE_INTEGRITY_FAILURE", "SOURCE_REMOVED", "ACCESS_RESTRICTED",
  "CONFIGURATION_ERROR", "INTERNAL_ERROR", "OTHER_UNCLASSIFIED",
] as const;
export type Rcv020FailureCode = (typeof RCV020_FAILURE_CODES)[number];

export type Rcv020Uuid = string & { readonly __rcv020Uuid: unique symbol };
export type Rcv020Hash = string & { readonly __rcv020Hash: unique symbol };
export type Rcv020Timestamp = string & { readonly __rcv020Timestamp: unique symbol };

export interface Rcv020RequestQuery {
  readonly method: string;
  readonly target: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly credentialReference: string | null;
}

export interface Rcv020MonitorConfigurationVersion {
  readonly monitorConfigurationVersionId: Rcv020Uuid;
  readonly monitorId: Rcv020Uuid;
  readonly versionNumber: bigint | string;
  readonly endpointRequest: Rcv020RequestQuery;
  readonly retrievalMethod: string;
  readonly authenticationReference?: string | null;
  readonly expectedMediaConstraints: Readonly<Record<string, unknown>>;
  readonly triggerEligibility: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly safetyPolicy: Readonly<Record<string, unknown>>;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly parserId?: string | null;
  readonly parserVersion?: string | null;
  readonly retentionPolicy: "PERMANENT_RAW" | "TEMPORARY_RAW" | "METADATA_HASH_ONLY";
  readonly retentionPolicyVersion: number;
  readonly effectiveFrom: Rcv020Timestamp;
  readonly effectiveUntil?: Rcv020Timestamp | null;
  readonly canonical?: string;
  readonly canonicalHash?: Rcv020Hash;
}

export interface Rcv020LifecycleEvent {
  readonly eventId: Rcv020Uuid;
  readonly monitorConfigurationVersionId: Rcv020Uuid;
  readonly eventType: Rcv020LifecycleEventType;
  readonly eventAt: Rcv020Timestamp;
  readonly eventSequence: bigint | string;
  readonly actorPolicyIdentity: string;
}

export interface Rcv020ObservationOccurrence {
  readonly occurrenceId: Rcv020Uuid;
  readonly logicalSourceId: Rcv020Uuid;
  readonly monitorId: Rcv020Uuid;
  readonly monitorConfigurationVersionId: Rcv020Uuid;
  readonly triggerOrigin: Rcv020TriggerOrigin;
  readonly scheduledAt?: Rcv020Timestamp | null;
  readonly triggerReceivedAt?: Rcv020Timestamp | null;
  readonly requestedAt?: Rcv020Timestamp | null;
  readonly dueAt?: Rcv020Timestamp | null;
  readonly evaluationCutoffAt: Rcv020Timestamp;
}

export interface Rcv020RetrievalAttempt {
  readonly attemptId: Rcv020Uuid;
  readonly occurrenceId: Rcv020Uuid;
  readonly previousAttemptId?: Rcv020Uuid | null;
  readonly retryNumber: bigint | string;
  readonly retrievalStartedAt: Rcv020Timestamp;
  readonly attemptDeadlineAt: Rcv020Timestamp;
}

export interface Rcv020AttemptResolution {
  readonly attemptId: Rcv020Uuid;
  readonly retrievalCompletedAt: Rcv020Timestamp;
  readonly outcome: Rcv020AttemptOutcome;
  readonly failureCode?: Rcv020FailureCode | null;
}

export interface Rcv020Capture {
  readonly captureId: Rcv020Uuid;
  readonly logicalSourceId: Rcv020Uuid;
  readonly monitorId: Rcv020Uuid;
  readonly monitorConfigurationVersionId: Rcv020Uuid;
  readonly occurrenceId: Rcv020Uuid;
  readonly retrievalAttemptId: Rcv020Uuid;
  readonly observedAt: Rcv020Timestamp;
  readonly contentHash: Rcv020Hash;
  readonly byteLength: bigint | string;
  readonly rawObjectIdentity?: string | null;
}

export interface Rcv020CaptureComparison {
  readonly comparisonId: Rcv020Uuid;
  readonly currentCaptureId: Rcv020Uuid;
  readonly priorCaptureId?: Rcv020Uuid | null;
  readonly algorithmId: string;
  readonly algorithmVersion: number;
  readonly result: Rcv020ComparisonResult;
}

export interface Rcv020RetentionAvailabilityEvent {
  readonly eventId: Rcv020Uuid;
  readonly captureId: Rcv020Uuid;
  readonly eventType: Rcv020RetentionEventType;
  readonly eventAt: Rcv020Timestamp;
  readonly eventSequence: bigint | string;
}

export class Rcv020ValidationError extends Error {
  readonly code = "REJECT_UNSUPPORTED" as const;
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "Rcv020ValidationError";
  }
}

export function validateRcv020Uuid(value: unknown, path = "id"): Rcv020Uuid {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Rcv020ValidationError(path, "expected lowercase canonical UUID");
  }
  return value as Rcv020Uuid;
}

export function validateRcv020Hash(value: unknown, path = "hash"): Rcv020Hash {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Rcv020ValidationError(path, "expected lowercase SHA-256 hash");
  }
  return value as Rcv020Hash;
}

export function validateRcv020Timestamp(value: unknown, path = "timestamp"): Rcv020Timestamp {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) {
    throw new Rcv020ValidationError(path, "expected canonical UTC timestamp YYYY-MM-DDTHH:mm:ss.ffffffZ");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) {
    throw new Rcv020ValidationError(path, "invalid canonical UTC timestamp");
  }
  return value as Rcv020Timestamp;
}

export function validateRcv020Version(value: unknown, path = "version"): 1 {
  if (value !== 1) throw new Rcv020ValidationError(path, "unsupported RCV-020 version");
  return 1;
}
