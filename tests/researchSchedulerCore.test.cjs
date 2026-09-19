const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const time = require("../dist/services/researchSchedulerTime");
const core = require("../dist/services/researchSchedulerSemanticCore");

const OPERATION = "11111111-1111-4111-8111-111111111111";
const POLICY = "22222222-2222-4222-8222-222222222222";

function version(number, overrides = {}) {
  return {
    operationId: OPERATION,
    policyId: POLICY,
    version: String(number),
    enabled: true,
    effectiveAtMicros: String(BigInt(number - 1) * 100n),
    firstEligibilityAtMicros: "0",
    fixedIntervalMicros: "10",
    ...overrides,
  };
}

const versions = [version(1), version(3, { effectiveAtMicros: "200" })];

test("Policy history validates monotonic versions, stable cadence, and permits version gaps", () => {
  const validated = core.validateSchedulerPolicyHistory(versions);
  assert.deepEqual(validated.map((item) => item.versionBigInt), [1n, 3n]);
  assert.equal(core.selectSchedulerPolicyOwner(validated, "0").versionBigInt, 1n);
  assert.equal(core.selectSchedulerPolicyOwner(validated, "200").versionBigInt, 3n);
  assert.equal(core.selectSchedulerPolicyOwner(validated, "199").versionBigInt, 1n);
  for (const invalid of [
    [version(1), version(2, { effectiveAtMicros: "100", firstEligibilityAtMicros: "1" })],
    [version(1), version(2, { effectiveAtMicros: "100", fixedIntervalMicros: "11" })],
    [version(1), version(2, { effectiveAtMicros: "-1" })],
    [version(1, { effectiveAtMicros: "1", firstEligibilityAtMicros: "0" })],
  ]) assert.throws(() => core.validateSchedulerPolicyHistory(invalid), core.SchedulerSemanticError);
  assert.throws(() => core.selectSchedulerPolicyOwner([version(1, { effectiveAtMicros: "100" })], "0"), core.SchedulerSemanticError);
});

test("Transient evaluation is non-authoritative and exact before first eligibility", () => {
  const later = core.evaluateScheduler({ evaluationAtMicros: "-1", operationState: "OPEN", policyVersions: [version(1)] });
  assert.deepEqual(later, { kind: "TRANSIENT_EVALUATION", evaluationAtMicros: "-1", decision: "SCHEDULE_LATER", reason: "NOT_YET_ELIGIBLE", nextEligibleAtMicros: "0", dueSlot: null });
  const closed = core.evaluateScheduler({ evaluationAtMicros: "-1", operationState: "CLOSED", policyVersions: [version(1)] });
  assert.equal(closed.reason, "OPERATION_CLOSED");
  assert.equal(closed.nextEligibleAtMicros, null);
  const disabled = core.evaluateScheduler({ evaluationAtMicros: "-1", operationState: "OPEN", policyVersions: [version(1, { enabled: false })] });
  assert.deepEqual(disabled, { kind: "TRANSIENT_EVALUATION", evaluationAtMicros: "-1", decision: "NO_ACTION", reason: "POLICY_DISABLED", nextEligibleAtMicros: null, dueSlot: null });
});

test("Due precedence and next eligibility are exact for CLOSED, DISABLED, ACTIVE_RUN, and RUN_NOW", () => {
  const closed = core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "CLOSED", policyVersions: [version(1)] });
  assert.deepEqual([closed.decision, closed.reason, closed.nextEligibleAtMicros], ["NO_ACTION", "OPERATION_CLOSED", null]);
  const disabled = core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "OPEN", policyVersions: [version(1, { enabled: false })] });
  assert.deepEqual([disabled.decision, disabled.reason, disabled.nextEligibleAtMicros], ["NO_ACTION", "POLICY_DISABLED", null]);
  const active = core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "OPEN", policyVersions: [version(1)], activeRunHistoricalState: "PLANNED" });
  assert.deepEqual([active.decision, active.reason, active.nextEligibleAtMicros], ["NO_ACTION", "ACTIVE_RUN", "10"]);
  const runNow = core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "OPEN", policyVersions: [version(1)] });
  assert.deepEqual([runNow.slotIndex, runNow.scheduledAtMicros, runNow.nextEligibleAtMicros, runNow.reason], ["0", "0", "10", "INITIAL_ELIGIBILITY"]);
});

test("INTERVAL and MISSED classifications use only immutable consumed-slot input", () => {
  const interval = core.evaluateScheduler({ evaluationAtMicros: "50", operationState: "OPEN", policyVersions: [version(1)], consumedSlots: core.makeSchedulerConsumedSlotSet(["0", "1", "2", "3", "4"]) });
  assert.deepEqual([interval.slotIndex, interval.reason], ["5", "INTERVAL_ELIGIBILITY"]);
  const missed = core.evaluateScheduler({ evaluationAtMicros: "50", operationState: "OPEN", policyVersions: [version(1)], consumedSlots: core.makeSchedulerConsumedSlotSet(["0", "1", "3", "4"]) });
  assert.deepEqual([missed.slotIndex, missed.reason], ["5", "MISSED_SLOT_COALESCED"]);
  const repeated = core.evaluateScheduler({ evaluationAtMicros: "70", operationState: "OPEN", policyVersions: [version(1)], consumedSlots: core.makeSchedulerConsumedSlotSet(["0", "1", "3", "4", "5", "6"]) });
  assert.deepEqual([repeated.slotIndex, repeated.reason], ["7", "MISSED_SLOT_COALESCED"]);
  assert.equal(core.classifySchedulerDueReason("0", core.makeSchedulerConsumedSlotSet([])), "INITIAL_ELIGIBILITY");
});

test("Policy owner selection honors exact effectiveAt boundaries and never uses a current pointer", () => {
  const history = [version(1), version(2, { effectiveAtMicros: "100" }), version(4, { effectiveAtMicros: "200" })];
  assert.equal(core.selectSchedulerPolicyOwner(history, "99").versionBigInt, 1n);
  assert.equal(core.selectSchedulerPolicyOwner(history, "100").versionBigInt, 2n);
  assert.equal(core.selectSchedulerPolicyOwner(history, "200").versionBigInt, 4n);
  assert.equal(core.selectSchedulerPolicyOwner(history, "999").versionBigInt, 4n);
});

test("Scheduler semantic core is deterministic and has no clock/DB dependency", () => {
  const input = { evaluationAtMicros: "50", operationState: "OPEN", policyVersions: [version(1)], consumedSlots: core.makeSchedulerConsumedSlotSet(["0", "1", "2", "3", "4"]) };
  const stable = (value) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
  const first = stable(core.evaluateScheduler(input));
  for (let repeat = 0; repeat < 100; repeat += 1) assert.equal(stable(core.evaluateScheduler(input)), first);
  const source = fs.readFileSync("src/services/researchSchedulerSemanticCore.ts", "utf8");
  assert.doesNotMatch(source, /\bnew\s+Date\b|\bDate\s*\(|\bNumber\s*\(|\bfetch\s*\(|\bSELECT\b|\bINSERT\b/i);
});

test("Due arithmetic rejects timestamp-domain overflow instead of clamping or wrapping", () => {
  assert.throws(() => time.deriveSchedulerDueSlot(time.SCHEDULER_POSTGRES_TIMESTAMP_MAX_MICROS, 1n, time.SCHEDULER_POSTGRES_TIMESTAMP_MAX_MICROS), time.SchedulerTimeError);
});
