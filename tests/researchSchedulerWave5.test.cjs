const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const core = require("../dist/services/researchSchedulerSemanticCore");
const canonical = require("../dist/services/researchSchedulerCanonical");
const time = require("../dist/services/researchSchedulerTime");

const OPERATION = "11111111-1111-4111-8111-111111111111";
const POLICY = "22222222-2222-4222-8222-222222222222";
const MANIFEST = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);

function version(n, overrides = {}) {
  return {
    operationId: OPERATION,
    policyId: POLICY,
    version: String(n),
    enabled: true,
    effectiveAtMicros: String((n - 1) * 100),
    firstEligibilityAtMicros: "0",
    fixedIntervalMicros: "10",
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    operationId: OPERATION,
    policyId: POLICY,
    slotIndex: "0",
    previousDecisionIdentity: null,
    previousDecisionCanonicalHash: null,
    policyVersion: "1",
    policyVersionCanonicalHash: HASH,
    scheduledAtMicros: "0",
    evaluationAtMicros: "0",
    decision: "RUN_NOW",
    reason: "INITIAL_ELIGIBILITY",
    nextEligibleAtMicros: "10",
    operationManifestId: MANIFEST,
    operationManifestHash: HASH,
    activeRunId: null,
    activeRunCreationIdentity: null,
    activeRunCreationHash: null,
    activeRunHistoricalState: null,
    activeRunRunningEventIdentity: null,
    activeRunRunningEventHash: null,
    runNowBindingIdentity: "scheduler-run-now:test:0",
    runNowRunId: RUN,
    ...overrides,
  };
}

test("Wave 5 exhaustively proves transient, persisted, and precedence matrices", () => {
  const open = core.evaluateScheduler({ evaluationAtMicros: "-1", operationState: "OPEN", policyVersions: [version(1)] });
  assert.deepEqual([open.kind, open.decision, open.reason, open.dueSlot], ["TRANSIENT_EVALUATION", "SCHEDULE_LATER", "NOT_YET_ELIGIBLE", null]);
  assert.deepEqual([core.evaluateScheduler({ evaluationAtMicros: "-1", operationState: "CLOSED", policyVersions: [version(1)] }).reason], ["OPERATION_CLOSED"]);
  assert.deepEqual([core.evaluateScheduler({ evaluationAtMicros: "-1", operationState: "OPEN", policyVersions: [version(1, { enabled: false })] }).reason], ["POLICY_DISABLED"]);
  const rows = [
    ["OPERATION_CLOSED", core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "CLOSED", policyVersions: [version(1, { enabled: false })], activeRunHistoricalState: "PLANNED" })],
    ["POLICY_DISABLED", core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "OPEN", policyVersions: [version(1, { enabled: false })], activeRunHistoricalState: null })],
    ["ACTIVE_RUN", core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "OPEN", policyVersions: [version(1)], activeRunHistoricalState: "RUNNING" })],
    ["INITIAL_ELIGIBILITY", core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "OPEN", policyVersions: [version(1)] })],
    ["INTERVAL_ELIGIBILITY", core.evaluateScheduler({ evaluationAtMicros: "50", operationState: "OPEN", policyVersions: [version(1)], consumedSlots: core.makeSchedulerConsumedSlotSet(["0", "1", "2", "3", "4"]) })],
    ["MISSED_SLOT_COALESCED", core.evaluateScheduler({ evaluationAtMicros: "50", operationState: "OPEN", policyVersions: [version(1)], consumedSlots: core.makeSchedulerConsumedSlotSet(["0", "2", "4"]) })],
  ];
  for (const [reason, result] of rows) assert.equal(result.reason, reason);
  assert.equal(rows[0][1].kind, "DUE_EVALUATION");
  assert.equal(rows[0][1].decision, "NO_ACTION");
  assert.equal(rows[1][1].decision, "NO_ACTION");
  assert.equal(rows[2][1].decision, "NO_ACTION");
  assert.equal(rows[3][1].decision, "RUN_NOW");
  assert.equal(rows[4][1].decision, "RUN_NOW");
  assert.equal(rows[5][1].decision, "RUN_NOW");
});

test("Wave 5 proves exact slot boundaries, consumption holes, and repeated MISSED", () => {
  const policies = [version(1)];
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: "-1", operationState: "OPEN", policyVersions: policies }).dueSlot, null);
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: "0", operationState: "OPEN", policyVersions: policies }).slotIndex, "0");
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: "9", operationState: "OPEN", policyVersions: policies }).slotIndex, "0");
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: "10", operationState: "OPEN", policyVersions: policies, consumedSlots: core.makeSchedulerConsumedSlotSet(["0"]) }).slotIndex, "1");
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: "10", operationState: "OPEN", policyVersions: policies, consumedSlots: core.makeSchedulerConsumedSlotSet(["0"]) }).reason, "INTERVAL_ELIGIBILITY");
  const gap = core.makeSchedulerConsumedSlotSet(["0", "2", "3"]);
  for (const at of ["20", "30", "40"]) assert.equal(core.evaluateScheduler({ evaluationAtMicros: at, operationState: "OPEN", policyVersions: policies, consumedSlots: gap }).reason, "MISSED_SLOT_COALESCED");
  const huge = core.makeSchedulerConsumedSlotSet(["0", "1", "2", "3", "4", "5"]);
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: "50", operationState: "OPEN", policyVersions: policies, consumedSlots: huge }).reason, "INTERVAL_ELIGIBILITY");
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: "50", operationState: "OPEN", policyVersions: policies, consumedSlots: core.makeSchedulerConsumedSlotSet(["0", "1", "2", "4", "5"]) }).reason, "MISSED_SLOT_COALESCED");
});

test("Wave 5 validates policy history, owner boundaries, gaps, and immutable cadence", () => {
  const history = [version(1), version(3, { effectiveAtMicros: "100" }), version(7, { effectiveAtMicros: "200" })];
  assert.equal(core.selectSchedulerPolicyOwner(history, "99").versionBigInt, 1n);
  assert.equal(core.selectSchedulerPolicyOwner(history, "100").versionBigInt, 3n);
  assert.equal(core.selectSchedulerPolicyOwner(history, "200").versionBigInt, 7n);
  assert.throws(() => core.validateSchedulerPolicyHistory([version(1), version(2, { effectiveAtMicros: "100", firstEligibilityAtMicros: "1" })]), /firstEligibilityAt/);
  assert.throws(() => core.validateSchedulerPolicyHistory([version(1), version(2, { effectiveAtMicros: "100", fixedIntervalMicros: "11" })]), /fixedInterval/);
  assert.throws(() => core.validateSchedulerPolicyHistory([version(1), version(2, { effectiveAtMicros: "100" }), version(3, { effectiveAtMicros: "90" })]), /effectiveAt/);
  assert.throws(() => core.validateSchedulerPolicyHistory([version(1, { effectiveAtMicros: "100" })]), /initial effectiveAt/);
  assert.throws(() => core.selectSchedulerPolicyOwner([version(1, { effectiveAtMicros: "100", firstEligibilityAtMicros: "100" })], "0"), /no applicable/);
});

test("Wave 5 canonical schemas reject impossible combinations and preserve explicit nulls", () => {
  const genesis = canonical.canonicalizeSchedulerDecision(decision());
  for (const key of ["previousDecisionIdentity", "previousDecisionCanonicalHash", "activeRunId", "activeRunCreationIdentity", "activeRunCreationHash", "activeRunHistoricalState", "activeRunRunningEventIdentity", "activeRunRunningEventHash"]) assert.equal(genesis.value[key], null);
  const planned = canonical.canonicalizeSchedulerDecision(decision({ decision: "NO_ACTION", reason: "ACTIVE_RUN", nextEligibleAtMicros: "10", runNowBindingIdentity: null, runNowRunId: null, activeRunId: RUN, activeRunCreationIdentity: RUN, activeRunCreationHash: HASH, activeRunHistoricalState: "PLANNED" }));
  assert.equal(planned.value.activeRunHistoricalState, "PLANNED");
  assert.throws(() => canonical.canonicalizeSchedulerDecision(decision({ previousDecisionIdentity: { operationId: OPERATION, policyId: POLICY, slotIndex: "0" }, previousDecisionCanonicalHash: null })), /predecessor/);
  assert.throws(() => canonical.canonicalizeSchedulerDecision(decision({ decision: "NO_ACTION", reason: "ACTIVE_RUN", nextEligibleAtMicros: "10", activeRunId: RUN, activeRunCreationIdentity: RUN, activeRunCreationHash: HASH, activeRunHistoricalState: "PLANNED", runNowBindingIdentity: "bad", runNowRunId: RUN })), /RUN_NOW evidence/);
  assert.throws(() => canonical.canonicalizeSchedulerDecision(decision({ decision: "NO_ACTION", reason: "ACTIVE_RUN", nextEligibleAtMicros: "10", activeRunId: RUN, activeRunCreationIdentity: RUN, activeRunCreationHash: HASH, activeRunHistoricalState: "PLANNED", activeRunRunningEventIdentity: RUN, activeRunRunningEventHash: HASH, runNowBindingIdentity: null, runNowRunId: null })), /PLANNED evidence/);
  assert.throws(() => canonical.canonicalizeSchedulerDecision(decision({ decision: "RUN_NOW", reason: "MISSED_SLOT_COALESCED", nextEligibleAtMicros: null })), /next eligibility/);
});

test("Wave 5 canonical/run-id output is deterministic, UTF-8 ordered, and not clock/Number based", () => {
  const members = [
    { authorityKind: "RUN_CREATED", authoritativeTimeMicros: "0", authorityIdentity: RUN, authorityCanonicalVersion: "1", authorityCanonicalHash: HASH },
    { authorityKind: "OPERATION_CREATED", authoritativeTimeMicros: "0", authorityIdentity: OPERATION, authorityCanonicalVersion: "1", authorityCanonicalHash: HASH },
  ];
  const manifest = canonical.canonicalizeSchedulerLifecyclePrefixManifest({ manifestId: MANIFEST, operationId: OPERATION, policyId: POLICY, slotIndex: "9007199254740993", evaluationAtMicros: "0", members });
  assert.equal(manifest.value.members[0].authorityKind, "OPERATION_CREATED");
  assert.equal(canonical.deriveSchedulerRunId({ operationId: OPERATION, policyId: POLICY, slotIndex: "9007199254740993" }), canonical.deriveSchedulerRunId({ operationId: OPERATION, policyId: POLICY, slotIndex: "9007199254740993" }));
  assert.notEqual(canonical.deriveSchedulerRunId({ operationId: OPERATION, policyId: POLICY, slotIndex: "9007199254740993" }), canonical.deriveSchedulerRunId({ operationId: OPERATION, policyId: POLICY, slotIndex: "9007199254740994" }));
  assert.equal(time.formatSchedulerTimestamp(time.parseSchedulerTimestamp("1970-01-01T00:00:00.000000Z")), "1970-01-01T00:00:00.000000Z");
  assert.equal(time.parseSchedulerTimestamp("1969-12-31T23:59:59.999999Z"), -1n);
  assert.equal(time.parseSchedulerTimestamp("0000-01-01T00:00:00.000000Z") < 0n, true);
  assert.throws(() => time.parseSchedulerTimestamp("1970-01-01T00:00:00Z"));
  assert.throws(() => time.parseSchedulerTimestamp("1970-01-01T00:00:00.000000+00:00"));
  assert.throws(() => time.parseSchedulerTimestamp("1970-01-01T00:00:00.0000000Z"));
  const sources = ["src/services/researchSchedulerSemanticCore.ts", "src/services/researchSchedulerCanonical.ts", "src/services/researchSchedulerTime.ts", "src/services/researchSchedulerPostgresReader.ts"];
  for (const file of sources) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /Date\.now\s*\(|CURRENT_TIMESTAMP|clock_timestamp\s*\(|\bNumber\s*\(/i);
});

test("Wave 5 failure taxonomy and source boundaries remain frozen", () => {
  const design = fs.readFileSync("docs/provenance/factbase-research-scheduler-policy-implementation-design-v1.md", "utf8");
  for (const code of ["MISSING_DATA", "MALFORMED_DATA", "VERSION_MISMATCH", "IDENTITY_MISMATCH", "POLICY_VERSION_VIOLATION", "SLOT_ARITHMETIC_VIOLATION", "RETROACTIVE_SLOT_VIOLATION", "LIFECYCLE_PREFIX_VIOLATION", "NONTERMINAL_RUN_VIOLATION", "DECISION_PRECEDENCE_VIOLATION", "CANONICAL_MISMATCH", "HASH_MISMATCH", "DUPLICATE_CONFLICT", "RUN_NOW_BINDING_VIOLATION", "CURRENT_STATE_SUBSTITUTION", "UNSUPPORTED_STATE"]) assert.match(design, new RegExp(code));
  assert.match(design, /canonical field path is selected by UTF-8 byte order/);
  assert.match(design, /No semantic failure is repaired/);
});
