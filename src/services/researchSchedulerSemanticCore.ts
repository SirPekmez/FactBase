import {
  canonicalizeSchedulerPolicyVersion,
  SchedulerCanonicalError,
  SchedulerDecisionReason,
  SchedulerDecisionValue,
  SchedulerPolicyVersionInput,
  SchedulerHistoricalRunState,
} from "./researchSchedulerCanonical";
import {
  assertSchedulerTimestampMicros,
  canonicalSchedulerMicros,
  deriveSchedulerDueSlot,
  parseSchedulerMicros,
  validateSchedulerBigInt,
} from "./researchSchedulerTime";

export class SchedulerSemanticError extends Error {
  constructor(
    readonly code: SchedulerCanonicalError["code"],
    message: string,
    readonly path = "value",
  ) {
    super(message);
    this.name = "SchedulerSemanticError";
  }
}

function fail(code: SchedulerSemanticError["code"], message: string, path = "value"): never {
  throw new SchedulerSemanticError(code, message, path);
}

export interface ValidatedSchedulerPolicyVersion extends SchedulerPolicyVersionInput {
  readonly versionBigInt: bigint;
  readonly effectiveAtBigInt: bigint;
  readonly firstEligibilityAtBigInt: bigint;
  readonly fixedIntervalBigInt: bigint;
  readonly canonical: string;
  readonly canonicalHash: string;
}

function normalizeVersion(input: SchedulerPolicyVersionInput, index: bigint): ValidatedSchedulerPolicyVersion {
  try {
    const encoded = canonicalizeSchedulerPolicyVersion(input);
    return Object.freeze({
      ...input,
      versionBigInt: BigInt(encoded.value.version),
      effectiveAtBigInt: BigInt(encoded.value.effectiveAtMicros),
      firstEligibilityAtBigInt: BigInt(encoded.value.firstEligibilityAtMicros),
      fixedIntervalBigInt: BigInt(encoded.value.fixedIntervalMicros),
      canonical: encoded.canonical,
      canonicalHash: encoded.hash,
    });
  } catch (error) {
    if (error instanceof SchedulerCanonicalError) {
      fail(error.code, error.message, `versions[${index.toString()}].${error.path}`);
    }
    fail("MALFORMED_DATA", "invalid policy version", `versions[${index.toString()}]`);
  }
}

export function validateSchedulerPolicyHistory(
  inputs: readonly SchedulerPolicyVersionInput[],
): readonly ValidatedSchedulerPolicyVersion[] {
  if (!Array.isArray(inputs) || inputs.length === 0) fail("MISSING_DATA", "at least one policy version is required", "versions");
  const normalized = inputs.map((input, index) => normalizeVersion(input, BigInt(index)));
  normalized.sort((left, right) => (left.versionBigInt < right.versionBigInt ? -1 : left.versionBigInt > right.versionBigInt ? 1 : 0));
  const first = normalized[0];
  const seenVersions = new Set<string>();
  let previousEffective: bigint | null = null;
  for (const [index, version] of normalized.entries()) {
    const position = BigInt(index).toString(10);
    if (seenVersions.has(version.versionBigInt.toString(10))) fail("POLICY_VERSION_VIOLATION", "duplicate policy version", `versions[${position}].version`);
    seenVersions.add(version.versionBigInt.toString(10));
    if (previousEffective !== null && version.effectiveAtBigInt <= previousEffective) fail("POLICY_VERSION_VIOLATION", "effectiveAt must strictly increase", `versions[${position}].effectiveAtMicros`);
    previousEffective = version.effectiveAtBigInt;
    if (version.policyId !== first.policyId || version.operationId !== first.operationId) fail("IDENTITY_MISMATCH", "all policy versions must share one stream identity", `versions[${position}]`);
    if (version.firstEligibilityAtBigInt !== first.firstEligibilityAtBigInt) fail("POLICY_VERSION_VIOLATION", "firstEligibilityAt must remain stable", `versions[${position}].firstEligibilityAtMicros`);
    if (version.fixedIntervalBigInt !== first.fixedIntervalBigInt) fail("POLICY_VERSION_VIOLATION", "fixedIntervalMicros must remain stable", `versions[${position}].fixedIntervalMicros`);
  }
  if (first.effectiveAtBigInt > first.firstEligibilityAtBigInt) fail("POLICY_VERSION_VIOLATION", "initial effectiveAt must not be after firstEligibilityAt", "versions[0].effectiveAtMicros");
  return Object.freeze(normalized);
}

export function selectSchedulerPolicyOwner(
  versions: readonly ValidatedSchedulerPolicyVersion[] | readonly SchedulerPolicyVersionInput[],
  scheduledAtMicros: bigint | string,
): ValidatedSchedulerPolicyVersion {
  const history = versions.length > 0 && "versionBigInt" in versions[0]
    ? versions as readonly ValidatedSchedulerPolicyVersion[]
    : validateSchedulerPolicyHistory(versions as readonly SchedulerPolicyVersionInput[]);
  const scheduled = typeof scheduledAtMicros === "bigint" ? assertSchedulerTimestampMicros(scheduledAtMicros, "scheduledAtMicros") : parseSchedulerMicros(scheduledAtMicros, "scheduledAtMicros");
  let owner: ValidatedSchedulerPolicyVersion | null = null;
  for (const version of history) {
    if (version.effectiveAtBigInt <= scheduled && (owner === null || version.versionBigInt > owner.versionBigInt)) owner = version;
  }
  if (owner === null) fail("POLICY_VERSION_VIOLATION", "no applicable policy version owns the scheduled slot", "scheduledAtMicros");
  return owner;
}

export interface SchedulerConsumedSlotSet {
  readonly has: (slotIndex: bigint) => boolean;
  readonly allBefore: (slotIndex: bigint) => boolean;
}

export function makeSchedulerConsumedSlotSet(values: Iterable<bigint | string>): SchedulerConsumedSlotSet {
  const slots = new Set<string>();
  for (const value of values) slots.add(validateSchedulerBigInt(value, "consumedSlot").toString(10));
  return Object.freeze({
    has: (slotIndex: bigint) => slots.has(slotIndex.toString(10)),
    allBefore: (slotIndex: bigint) => {
      for (let candidate = 0n; candidate < slotIndex; candidate += 1n) if (!slots.has(candidate.toString(10))) return false;
      return true;
    },
  });
}

const EMPTY_CONSUMED_SLOTS = makeSchedulerConsumedSlotSet([]);

export interface SchedulerTransientEvaluation {
  readonly kind: "TRANSIENT_EVALUATION";
  readonly evaluationAtMicros: string;
  readonly decision: "SCHEDULE_LATER" | "NO_ACTION";
  readonly reason: "NOT_YET_ELIGIBLE" | "OPERATION_CLOSED" | "POLICY_DISABLED";
  readonly nextEligibleAtMicros: string | null;
  readonly dueSlot: null;
}

export interface SchedulerDueEvaluation {
  readonly kind: "DUE_EVALUATION";
  readonly evaluationAtMicros: string;
  readonly slotIndex: string;
  readonly scheduledAtMicros: string;
  readonly nextEligibleAtMicros: string | null;
  readonly decision: SchedulerDecisionValue;
  readonly reason: SchedulerDecisionReason;
  readonly owningPolicyVersion: ValidatedSchedulerPolicyVersion;
}

export type SchedulerEvaluation = SchedulerTransientEvaluation | SchedulerDueEvaluation;

export interface SchedulerEvaluationInput {
  readonly evaluationAtMicros: bigint | string;
  readonly operationState: "OPEN" | "CLOSED";
  readonly policyVersions: readonly SchedulerPolicyVersionInput[];
  readonly activeRunHistoricalState?: SchedulerHistoricalRunState | null;
  readonly consumedSlots?: SchedulerConsumedSlotSet;
}

export function evaluateScheduler(input: SchedulerEvaluationInput): SchedulerEvaluation {
  const evaluation = typeof input.evaluationAtMicros === "bigint" ? assertSchedulerTimestampMicros(input.evaluationAtMicros, "evaluationAtMicros") : parseSchedulerMicros(input.evaluationAtMicros, "evaluationAtMicros");
  if (input.operationState !== "OPEN" && input.operationState !== "CLOSED") fail("UNSUPPORTED_STATE", "unsupported Operation state", "operationState");
  if (input.activeRunHistoricalState !== undefined && input.activeRunHistoricalState !== null && input.activeRunHistoricalState !== "PLANNED" && input.activeRunHistoricalState !== "RUNNING") fail("UNSUPPORTED_STATE", "unsupported historical Run state", "activeRunHistoricalState");
  const history = validateSchedulerPolicyHistory(input.policyVersions);
  const anchor = history[0];
  const due = deriveSchedulerDueSlot(anchor.firstEligibilityAtBigInt, anchor.fixedIntervalBigInt, evaluation);
  const transient = (decision: SchedulerTransientEvaluation["decision"], reason: SchedulerTransientEvaluation["reason"], nextEligibleAtMicros: bigint | null): SchedulerTransientEvaluation => Object.freeze({
    kind: "TRANSIENT_EVALUATION",
    evaluationAtMicros: canonicalSchedulerMicros(evaluation),
    decision,
    reason,
    nextEligibleAtMicros: nextEligibleAtMicros === null ? null : canonicalSchedulerMicros(nextEligibleAtMicros),
    dueSlot: null,
  });
  if (due === null) {
    if (input.operationState === "CLOSED") return transient("NO_ACTION", "OPERATION_CLOSED", null);
    const owner = selectSchedulerPolicyOwner(history, anchor.firstEligibilityAtBigInt);
    return owner.enabled ? transient("SCHEDULE_LATER", "NOT_YET_ELIGIBLE", anchor.firstEligibilityAtBigInt) : transient("NO_ACTION", "POLICY_DISABLED", null);
  }
  const owner = selectSchedulerPolicyOwner(history, due.scheduledAtMicros);
  if (input.operationState === "CLOSED") return Object.freeze({ kind: "DUE_EVALUATION", evaluationAtMicros: canonicalSchedulerMicros(evaluation), slotIndex: due.slotIndex.toString(10), scheduledAtMicros: canonicalSchedulerMicros(due.scheduledAtMicros), nextEligibleAtMicros: null, decision: "NO_ACTION", reason: "OPERATION_CLOSED", owningPolicyVersion: owner });
  if (!owner.enabled) return Object.freeze({ kind: "DUE_EVALUATION", evaluationAtMicros: canonicalSchedulerMicros(evaluation), slotIndex: due.slotIndex.toString(10), scheduledAtMicros: canonicalSchedulerMicros(due.scheduledAtMicros), nextEligibleAtMicros: null, decision: "NO_ACTION", reason: "POLICY_DISABLED", owningPolicyVersion: owner });
  if (input.activeRunHistoricalState !== undefined && input.activeRunHistoricalState !== null) return Object.freeze({ kind: "DUE_EVALUATION", evaluationAtMicros: canonicalSchedulerMicros(evaluation), slotIndex: due.slotIndex.toString(10), scheduledAtMicros: canonicalSchedulerMicros(due.scheduledAtMicros), nextEligibleAtMicros: canonicalSchedulerMicros(due.nextEligibleAtMicros), decision: "NO_ACTION", reason: "ACTIVE_RUN", owningPolicyVersion: owner });
  if (due.slotIndex === 0n) return Object.freeze({ kind: "DUE_EVALUATION", evaluationAtMicros: canonicalSchedulerMicros(evaluation), slotIndex: "0", scheduledAtMicros: canonicalSchedulerMicros(due.scheduledAtMicros), nextEligibleAtMicros: canonicalSchedulerMicros(due.nextEligibleAtMicros), decision: "RUN_NOW", reason: "INITIAL_ELIGIBILITY", owningPolicyVersion: owner });
  const consumed = input.consumedSlots ?? EMPTY_CONSUMED_SLOTS;
  const reason: SchedulerDecisionReason = consumed.allBefore(due.slotIndex) ? "INTERVAL_ELIGIBILITY" : "MISSED_SLOT_COALESCED";
  return Object.freeze({ kind: "DUE_EVALUATION", evaluationAtMicros: canonicalSchedulerMicros(evaluation), slotIndex: due.slotIndex.toString(10), scheduledAtMicros: canonicalSchedulerMicros(due.scheduledAtMicros), nextEligibleAtMicros: canonicalSchedulerMicros(due.nextEligibleAtMicros), decision: "RUN_NOW", reason, owningPolicyVersion: owner });
}

export function classifySchedulerDueReason(slotIndex: bigint | string, consumedSlots: SchedulerConsumedSlotSet): SchedulerDecisionReason {
  const slot = validateSchedulerBigInt(slotIndex, "slotIndex");
  if (slot === 0n) return "INITIAL_ELIGIBILITY";
  return consumedSlots.allBefore(slot) ? "INTERVAL_ELIGIBILITY" : "MISSED_SLOT_COALESCED";
}
