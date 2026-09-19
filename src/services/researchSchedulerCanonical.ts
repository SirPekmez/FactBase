import { createHash } from "node:crypto";
import { canonicalizeAndHash } from "./canonicalJson";
import {
  assertSchedulerTimestampMicros,
  canonicalSchedulerMicros,
  parseSchedulerMicros,
  validateSchedulerBigInt,
  validateSchedulerPositiveBigInt,
} from "./researchSchedulerTime";

export const SCHEDULER_CANONICAL_VERSION = "1" as const;
export const SCHEDULER_RUN_ID_DOMAIN = "factbase/rcv021/scheduler-run-id/v1\0";

export type SchedulerAuthorityKind =
  | "OPERATION_CREATED"
  | "OPERATION_LIFECYCLE_EVENT"
  | "RUN_CREATED"
  | "RUN_LIFECYCLE_EVENT"
  | "RUN_TERMINAL_RESOLUTION";

export type SchedulerDecisionValue = "RUN_NOW" | "NO_ACTION";
export type SchedulerDecisionReason =
  | "INITIAL_ELIGIBILITY"
  | "INTERVAL_ELIGIBILITY"
  | "MISSED_SLOT_COALESCED"
  | "OPERATION_CLOSED"
  | "POLICY_DISABLED"
  | "ACTIVE_RUN";
export type SchedulerHistoricalRunState = "PLANNED" | "RUNNING";

export interface SchedulerCanonicalResult<T extends object = object> {
  readonly value: T;
  readonly canonical: string;
  readonly hash: string;
}

export class SchedulerCanonicalError extends Error {
  constructor(
    readonly code:
      | "MISSING_DATA"
      | "MALFORMED_DATA"
      | "VERSION_MISMATCH"
      | "CANONICAL_MISMATCH"
      | "HASH_MISMATCH"
      | "IDENTITY_MISMATCH"
      | "DUPLICATE_CONFLICT"
      | "POLICY_VERSION_VIOLATION"
      | "SLOT_ARITHMETIC_VIOLATION"
      | "RETROACTIVE_SLOT_VIOLATION"
      | "DECISION_PRECEDENCE_VIOLATION"
      | "LIFECYCLE_PREFIX_VIOLATION"
      | "NONTERMINAL_RUN_VIOLATION"
      | "RUN_NOW_BINDING_VIOLATION"
      | "CURRENT_STATE_SUBSTITUTION"
      | "UNSUPPORTED_STATE",
    message: string,
    readonly path = "value",
  ) {
    super(message);
    this.name = "SchedulerCanonicalError";
  }
}

function fail(message: string, path = "value", code: SchedulerCanonicalError["code"] = "MALFORMED_DATA"): never {
  throw new SchedulerCanonicalError(code, message, path);
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    fail("expected lowercase canonical UUID", path, "IDENTITY_MISMATCH");
  }
  return value;
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail("expected lowercase SHA-256 hex", path, "HASH_MISMATCH");
  }
  return value;
}

function canonicalVersion(value: unknown, path: string): "1" {
  if (value !== SCHEDULER_CANONICAL_VERSION) fail("unsupported canonical version", path, "VERSION_MISMATCH");
  return SCHEDULER_CANONICAL_VERSION;
}

function canonicalDecimal(value: unknown, path: string): string {
  return validateSchedulerBigInt(value, path).toString(10);
}

function canonicalPositiveDecimal(value: unknown, path: string): string {
  return validateSchedulerPositiveBigInt(value, path).toString(10);
}

function canonicalTime(value: unknown, path: string): string {
  return canonicalSchedulerMicros(
    typeof value === "bigint" ? assertSchedulerTimestampMicros(value, path) : parseSchedulerMicros(value, path),
    path,
  );
}

function canonicalString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail("expected non-empty string", path);
  return value;
}

function finalize<T extends object>(value: T): SchedulerCanonicalResult<T> {
  const result = canonicalizeAndHash(value);
  return Object.freeze({ value: Object.freeze(value), canonical: result.canonical, hash: result.hash });
}

export interface SchedulerPolicyVersionInput {
  readonly policyId: string;
  readonly operationId: string;
  readonly version: bigint | string;
  readonly enabled: boolean;
  readonly effectiveAtMicros: bigint | string;
  readonly firstEligibilityAtMicros: bigint | string;
  readonly fixedIntervalMicros: bigint | string;
}

export type SchedulerPolicyVersionCanonical = {
  readonly schema: "scheduler-policy-version-v1";
  readonly canonicalVersion: "1";
  readonly policyId: string;
  readonly operationId: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly effectiveAtMicros: string;
  readonly firstEligibilityAtMicros: string;
  readonly fixedIntervalMicros: string;
};

export function canonicalizeSchedulerPolicyVersion(input: SchedulerPolicyVersionInput): SchedulerCanonicalResult<SchedulerPolicyVersionCanonical> {
  if (typeof input.enabled !== "boolean") fail("enabled must be boolean", "enabled");
  const value: SchedulerPolicyVersionCanonical = {
    schema: "scheduler-policy-version-v1",
    canonicalVersion: SCHEDULER_CANONICAL_VERSION,
    policyId: uuid(input.policyId, "policyId"),
    operationId: uuid(input.operationId, "operationId"),
    version: canonicalPositiveDecimal(input.version, "version"),
    enabled: input.enabled,
    effectiveAtMicros: canonicalTime(input.effectiveAtMicros, "effectiveAtMicros"),
    firstEligibilityAtMicros: canonicalTime(input.firstEligibilityAtMicros, "firstEligibilityAtMicros"),
    fixedIntervalMicros: canonicalPositiveDecimal(input.fixedIntervalMicros, "fixedIntervalMicros"),
  };
  return finalize(value);
}

export interface SchedulerManifestMemberInput {
  readonly authorityKind: SchedulerAuthorityKind;
  readonly authoritativeTimeMicros: bigint | string;
  readonly authorityIdentity: string;
  readonly authorityCanonicalVersion: bigint | string;
  readonly authorityCanonicalHash: string;
}

export type SchedulerManifestMemberCanonical = {
  readonly authorityKind: SchedulerAuthorityKind;
  readonly authoritativeTimeMicros: string;
  readonly authorityIdentity: string;
  readonly authorityCanonicalVersion: string;
  readonly authorityCanonicalHash: string;
};

const AUTHORITY_KIND_RANK: Readonly<Record<SchedulerAuthorityKind, number>> = Object.freeze({
  OPERATION_CREATED: 0,
  OPERATION_LIFECYCLE_EVENT: 1,
  RUN_CREATED: 2,
  RUN_LIFECYCLE_EVENT: 3,
  RUN_TERMINAL_RESOLUTION: 4,
});

function member(value: SchedulerManifestMemberInput, index: number): SchedulerManifestMemberCanonical {
  if (!(value.authorityKind in AUTHORITY_KIND_RANK)) fail("unsupported authority kind", `members[${index}].authorityKind`);
  return {
    authorityKind: value.authorityKind,
    authoritativeTimeMicros: canonicalTime(value.authoritativeTimeMicros, `members[${index}].authoritativeTimeMicros`),
    authorityIdentity: uuid(value.authorityIdentity, `members[${index}].authorityIdentity`),
    authorityCanonicalVersion: canonicalPositiveDecimal(value.authorityCanonicalVersion, `members[${index}].authorityCanonicalVersion`),
    authorityCanonicalHash: hash(value.authorityCanonicalHash, `members[${index}].authorityCanonicalHash`),
  };
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function compareMembers(left: SchedulerManifestMemberCanonical, right: SchedulerManifestMemberCanonical): number {
  const time = BigInt(left.authoritativeTimeMicros) - BigInt(right.authoritativeTimeMicros);
  if (time < 0n) return -1;
  if (time > 0n) return 1;
  const kind = AUTHORITY_KIND_RANK[left.authorityKind] - AUTHORITY_KIND_RANK[right.authorityKind];
  if (kind !== 0) return kind;
  return compareUtf8(left.authorityIdentity, right.authorityIdentity);
}

export interface SchedulerLifecyclePrefixManifestInput {
  readonly manifestId: string;
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: bigint | string;
  readonly evaluationAtMicros: bigint | string;
  readonly members: readonly SchedulerManifestMemberInput[];
}

export type SchedulerLifecyclePrefixManifestCanonical = {
  readonly schema: "scheduler-lifecycle-prefix-manifest-v1";
  readonly canonicalVersion: "1";
  readonly manifestId: string;
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: string;
  readonly evaluationAtMicros: string;
  readonly members: readonly SchedulerManifestMemberCanonical[];
};

export function canonicalizeSchedulerLifecyclePrefixManifest(input: SchedulerLifecyclePrefixManifestInput): SchedulerCanonicalResult<SchedulerLifecyclePrefixManifestCanonical> {
  if (!Array.isArray(input.members)) fail("members must be an array", "members");
  const members = input.members.map(member).sort(compareMembers).map((item) => Object.freeze(item));
  for (let index = 1; index < members.length; index += 1) {
    const previous = members[index - 1];
    const current = members[index];
    if (previous.authorityKind === current.authorityKind && previous.authorityIdentity === current.authorityIdentity) fail("duplicate manifest member identity", `members[${index}].authorityIdentity`, "DUPLICATE_CONFLICT");
  }
  const value: SchedulerLifecyclePrefixManifestCanonical = {
    schema: "scheduler-lifecycle-prefix-manifest-v1",
    canonicalVersion: SCHEDULER_CANONICAL_VERSION,
    manifestId: uuid(input.manifestId, "manifestId"),
    operationId: uuid(input.operationId, "operationId"),
    policyId: uuid(input.policyId, "policyId"),
    slotIndex: canonicalDecimal(input.slotIndex, "slotIndex"),
    evaluationAtMicros: canonicalTime(input.evaluationAtMicros, "evaluationAtMicros"),
    members: Object.freeze(members),
  };
  return finalize(value);
}

export interface SchedulerDecisionInput {
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: bigint | string;
  readonly previousDecisionIdentity: SchedulerDecisionIdentityInput | null;
  readonly previousDecisionCanonicalHash: string | null;
  readonly policyVersion: bigint | string;
  readonly policyVersionCanonicalHash: string;
  readonly scheduledAtMicros: bigint | string;
  readonly evaluationAtMicros: bigint | string;
  readonly decision: SchedulerDecisionValue;
  readonly reason: SchedulerDecisionReason;
  readonly nextEligibleAtMicros: bigint | string | null;
  readonly operationManifestId: string;
  readonly operationManifestHash: string;
  readonly activeRunId: string | null;
  readonly activeRunCreationIdentity: string | null;
  readonly activeRunCreationHash: string | null;
  readonly activeRunHistoricalState: SchedulerHistoricalRunState | null;
  readonly activeRunRunningEventIdentity: string | null;
  readonly activeRunRunningEventHash: string | null;
  readonly runNowBindingIdentity: string | null;
  readonly runNowRunId: string | null;
}

export interface SchedulerDecisionIdentityInput {
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: bigint | string;
}

export type SchedulerDecisionIdentityCanonical = {
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: string;
};

function decisionIdentity(value: SchedulerDecisionIdentityInput, path: string): SchedulerDecisionIdentityCanonical {
  return {
    operationId: uuid(value.operationId, `${path}.operationId`),
    policyId: uuid(value.policyId, `${path}.policyId`),
    slotIndex: canonicalDecimal(value.slotIndex, `${path}.slotIndex`),
  };
}

function nullableUuid(value: string | null, path: string): string | null {
  return value === null ? null : uuid(value, path);
}

function nullableHash(value: string | null, path: string): string | null {
  return value === null ? null : hash(value, path);
}

function assertDecisionShape(input: SchedulerDecisionInput): void {
  const active = input.reason === "ACTIVE_RUN";
  const runNow = input.decision === "RUN_NOW";
  const closedOrDisabled = input.reason === "OPERATION_CLOSED" || input.reason === "POLICY_DISABLED";
  const matrix =
    (input.decision === "NO_ACTION" && ["OPERATION_CLOSED", "POLICY_DISABLED", "ACTIVE_RUN"].includes(input.reason)) ||
    (input.decision === "RUN_NOW" && ["INITIAL_ELIGIBILITY", "INTERVAL_ELIGIBILITY", "MISSED_SLOT_COALESCED"].includes(input.reason));
  if (!matrix) fail("decision/reason combination is unsupported", "reason", "DECISION_PRECEDENCE_VIOLATION");
  if (input.activeRunHistoricalState !== null && input.activeRunHistoricalState !== "PLANNED" && input.activeRunHistoricalState !== "RUNNING") fail("unsupported historical Run state", "activeRunHistoricalState", "UNSUPPORTED_STATE");
  if (closedOrDisabled && input.nextEligibleAtMicros !== null) fail("closed/disabled next eligibility must be null", "nextEligibleAtMicros");
  if (!closedOrDisabled && input.nextEligibleAtMicros === null) fail("next eligibility is required", "nextEligibleAtMicros");
  const activeValues = [input.activeRunId, input.activeRunCreationIdentity, input.activeRunCreationHash, input.activeRunHistoricalState, input.activeRunRunningEventIdentity, input.activeRunRunningEventHash];
  if (!active && activeValues.some((value) => value !== null)) fail("ACTIVE_RUN evidence is only valid for ACTIVE_RUN", "activeRunId");
  if (active) {
    if (input.activeRunId === null || input.activeRunCreationIdentity === null || input.activeRunCreationHash === null || input.activeRunHistoricalState === null) fail("ACTIVE_RUN evidence is incomplete", "activeRunId");
    if (input.activeRunHistoricalState === "PLANNED" && (input.activeRunRunningEventIdentity !== null || input.activeRunRunningEventHash !== null)) fail("PLANNED evidence cannot include RUNNING event", "activeRunRunningEventIdentity");
    if (input.activeRunHistoricalState === "RUNNING" && (input.activeRunRunningEventIdentity === null || input.activeRunRunningEventHash === null)) fail("RUNNING evidence requires RUNNING event", "activeRunRunningEventIdentity");
  }
  if (runNow && (input.runNowBindingIdentity === null || input.runNowRunId === null)) fail("RUN_NOW evidence is incomplete", "runNowBindingIdentity", "RUN_NOW_BINDING_VIOLATION");
  if (!runNow && (input.runNowBindingIdentity !== null || input.runNowRunId !== null)) fail("RUN_NOW evidence is only valid for RUN_NOW", "runNowBindingIdentity");
  const predecessor = input.previousDecisionIdentity;
  if ((predecessor === null) !== (input.previousDecisionCanonicalHash === null)) fail("predecessor identity and hash must both be null or non-null", "previousDecisionIdentity");
}

export type SchedulerDecisionCanonical = {
  readonly schema: "scheduler-decision-v1";
  readonly canonicalVersion: "1";
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: string;
  readonly previousDecisionIdentity: SchedulerDecisionIdentityCanonical | null;
  readonly previousDecisionCanonicalHash: string | null;
  readonly policyVersion: string;
  readonly policyVersionCanonicalHash: string;
  readonly scheduledAtMicros: string;
  readonly evaluationAtMicros: string;
  readonly decision: SchedulerDecisionValue;
  readonly reason: SchedulerDecisionReason;
  readonly nextEligibleAtMicros: string | null;
  readonly operationManifestId: string;
  readonly operationManifestHash: string;
  readonly activeRunId: string | null;
  readonly activeRunCreationIdentity: string | null;
  readonly activeRunCreationHash: string | null;
  readonly activeRunHistoricalState: SchedulerHistoricalRunState | null;
  readonly activeRunRunningEventIdentity: string | null;
  readonly activeRunRunningEventHash: string | null;
  readonly runNowBindingIdentity: string | null;
  readonly runNowRunId: string | null;
};

export function canonicalizeSchedulerDecision(input: SchedulerDecisionInput): SchedulerCanonicalResult<SchedulerDecisionCanonical> {
  assertDecisionShape(input);
  const previous = input.previousDecisionIdentity === null ? null : decisionIdentity(input.previousDecisionIdentity, "previousDecisionIdentity");
  if (previous !== null && (previous.operationId !== input.operationId || previous.policyId !== input.policyId)) fail("predecessor must belong to the same policy stream", "previousDecisionIdentity", "IDENTITY_MISMATCH");
  const value: SchedulerDecisionCanonical = {
    schema: "scheduler-decision-v1",
    canonicalVersion: SCHEDULER_CANONICAL_VERSION,
    operationId: uuid(input.operationId, "operationId"),
    policyId: uuid(input.policyId, "policyId"),
    slotIndex: canonicalDecimal(input.slotIndex, "slotIndex"),
    previousDecisionIdentity: previous,
    previousDecisionCanonicalHash: nullableHash(input.previousDecisionCanonicalHash, "previousDecisionCanonicalHash"),
    policyVersion: canonicalPositiveDecimal(input.policyVersion, "policyVersion"),
    policyVersionCanonicalHash: hash(input.policyVersionCanonicalHash, "policyVersionCanonicalHash"),
    scheduledAtMicros: canonicalTime(input.scheduledAtMicros, "scheduledAtMicros"),
    evaluationAtMicros: canonicalTime(input.evaluationAtMicros, "evaluationAtMicros"),
    decision: input.decision,
    reason: input.reason,
    nextEligibleAtMicros: input.nextEligibleAtMicros === null ? null : canonicalTime(input.nextEligibleAtMicros, "nextEligibleAtMicros"),
    operationManifestId: uuid(input.operationManifestId, "operationManifestId"),
    operationManifestHash: hash(input.operationManifestHash, "operationManifestHash"),
    activeRunId: nullableUuid(input.activeRunId, "activeRunId"),
    activeRunCreationIdentity: nullableUuid(input.activeRunCreationIdentity, "activeRunCreationIdentity"),
    activeRunCreationHash: nullableHash(input.activeRunCreationHash, "activeRunCreationHash"),
    activeRunHistoricalState: input.activeRunHistoricalState,
    activeRunRunningEventIdentity: nullableUuid(input.activeRunRunningEventIdentity, "activeRunRunningEventIdentity"),
    activeRunRunningEventHash: nullableHash(input.activeRunRunningEventHash, "activeRunRunningEventHash"),
    runNowBindingIdentity: input.runNowBindingIdentity === null ? null : canonicalString(input.runNowBindingIdentity, "runNowBindingIdentity"),
    runNowRunId: nullableUuid(input.runNowRunId, "runNowRunId"),
  };
  return finalize(value);
}

export interface SchedulerRunNowBindingInput {
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: bigint | string;
  readonly runId: string;
}

export type SchedulerRunNowBindingCanonical = {
  readonly schema: "scheduler-run-now-binding-v1";
  readonly canonicalVersion: "1";
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: string;
  readonly runId: string;
};

export function canonicalizeSchedulerRunNowBinding(input: SchedulerRunNowBindingInput): SchedulerCanonicalResult<SchedulerRunNowBindingCanonical> {
  const value: SchedulerRunNowBindingCanonical = {
    schema: "scheduler-run-now-binding-v1",
    canonicalVersion: SCHEDULER_CANONICAL_VERSION,
    operationId: uuid(input.operationId, "operationId"),
    policyId: uuid(input.policyId, "policyId"),
    slotIndex: canonicalDecimal(input.slotIndex, "slotIndex"),
    runId: uuid(input.runId, "runId"),
  };
  return finalize(value);
}

export function deriveSchedulerRunId(input: SchedulerDecisionIdentityInput): string {
  const operationId = uuid(input.operationId, "operationId");
  const policyId = uuid(input.policyId, "policyId");
  const slotIndex = canonicalDecimal(input.slotIndex, "slotIndex");
  const identityCanonical = canonicalizeAndHash({ operationId, policyId, slotIndex }).canonical;
  const digest = createHash("sha256")
    .update(Buffer.from(SCHEDULER_RUN_ID_DOMAIN, "utf8"))
    .update(Buffer.from(identityCanonical, "utf8"))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
