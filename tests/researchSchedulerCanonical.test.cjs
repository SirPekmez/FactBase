const assert = require("node:assert/strict");
const test = require("node:test");

const canonical = require("../dist/services/researchSchedulerCanonical");

const OPERATION = "11111111-1111-4111-8111-111111111111";
const POLICY = "22222222-2222-4222-8222-222222222222";
const MANIFEST = "33333333-3333-4333-8333-333333333333";
const RUN = "55555555-5555-4555-8555-555555555555";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

const policyInput = {
  operationId: OPERATION,
  policyId: POLICY,
  version: "1",
  enabled: true,
  effectiveAtMicros: "0",
  firstEligibilityAtMicros: "0",
  fixedIntervalMicros: "1000000",
};

const baseDecision = {
  operationId: OPERATION,
  policyId: POLICY,
  slotIndex: "0",
  previousDecisionIdentity: null,
  previousDecisionCanonicalHash: null,
  policyVersion: "1",
  policyVersionCanonicalHash: HASH_A,
  scheduledAtMicros: "0",
  evaluationAtMicros: "3",
  decision: "RUN_NOW",
  reason: "INITIAL_ELIGIBILITY",
  nextEligibleAtMicros: "1000000",
  operationManifestId: MANIFEST,
  operationManifestHash: HASH_B,
  activeRunId: null,
  activeRunCreationIdentity: null,
  activeRunCreationHash: null,
  activeRunHistoricalState: null,
  activeRunRunningEventIdentity: null,
  activeRunRunningEventHash: null,
  runNowBindingIdentity: "binding-0",
  runNowRunId: RUN,
};

test("PolicyVersion canonical golden vector is exact RFC 8785 UTF-8 JSON and SHA-256", () => {
  const result = canonical.canonicalizeSchedulerPolicyVersion(policyInput);
  assert.equal(result.canonical, "{\"canonicalVersion\":\"1\",\"effectiveAtMicros\":\"0\",\"enabled\":true,\"firstEligibilityAtMicros\":\"0\",\"fixedIntervalMicros\":\"1000000\",\"operationId\":\"11111111-1111-4111-8111-111111111111\",\"policyId\":\"22222222-2222-4222-8222-222222222222\",\"schema\":\"scheduler-policy-version-v1\",\"version\":\"1\"}");
  assert.equal(result.hash, "5333f9ae41b81c05aa308d327a7b34b4907224c8dc2a051774ff188268077bd1");
});

test("Manifest canonical golden vector sorts members by time, kind rank, and UTF-8 identity", () => {
  const result = canonical.canonicalizeSchedulerLifecyclePrefixManifest({
    manifestId: MANIFEST,
    operationId: OPERATION,
    policyId: POLICY,
    slotIndex: "0",
    evaluationAtMicros: "3",
    members: [
      { authorityKind: "RUN_CREATED", authoritativeTimeMicros: "2", authorityIdentity: "44444444-4444-4444-8444-444444444444", authorityCanonicalVersion: "1", authorityCanonicalHash: HASH_B },
      { authorityKind: "OPERATION_CREATED", authoritativeTimeMicros: "0", authorityIdentity: OPERATION, authorityCanonicalVersion: "1", authorityCanonicalHash: HASH_A },
    ],
  });
  assert.equal(result.canonical, "{\"canonicalVersion\":\"1\",\"evaluationAtMicros\":\"3\",\"manifestId\":\"33333333-3333-4333-8333-333333333333\",\"members\":[{\"authoritativeTimeMicros\":\"0\",\"authorityCanonicalHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"authorityCanonicalVersion\":\"1\",\"authorityIdentity\":\"11111111-1111-4111-8111-111111111111\",\"authorityKind\":\"OPERATION_CREATED\"},{\"authoritativeTimeMicros\":\"2\",\"authorityCanonicalHash\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"authorityCanonicalVersion\":\"1\",\"authorityIdentity\":\"44444444-4444-4444-8444-444444444444\",\"authorityKind\":\"RUN_CREATED\"}],\"operationId\":\"11111111-1111-4111-8111-111111111111\",\"policyId\":\"22222222-2222-4222-8222-222222222222\",\"schema\":\"scheduler-lifecycle-prefix-manifest-v1\",\"slotIndex\":\"0\"}");
  assert.equal(result.hash, "a1ca996e2e679b9ed2d15b8704974a39a8999762324a03cc082e1867da602b93");
});

test("SchedulerDecision genesis and predecessor-bound successor canonical vectors are exact", () => {
  const genesis = canonical.canonicalizeSchedulerDecision(baseDecision);
  assert.equal(genesis.canonical, "{\"activeRunCreationHash\":null,\"activeRunCreationIdentity\":null,\"activeRunHistoricalState\":null,\"activeRunId\":null,\"activeRunRunningEventHash\":null,\"activeRunRunningEventIdentity\":null,\"canonicalVersion\":\"1\",\"decision\":\"RUN_NOW\",\"evaluationAtMicros\":\"3\",\"nextEligibleAtMicros\":\"1000000\",\"operationId\":\"11111111-1111-4111-8111-111111111111\",\"operationManifestHash\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"operationManifestId\":\"33333333-3333-4333-8333-333333333333\",\"policyId\":\"22222222-2222-4222-8222-222222222222\",\"policyVersion\":\"1\",\"policyVersionCanonicalHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"previousDecisionCanonicalHash\":null,\"previousDecisionIdentity\":null,\"reason\":\"INITIAL_ELIGIBILITY\",\"runNowBindingIdentity\":\"binding-0\",\"runNowRunId\":\"55555555-5555-4555-8555-555555555555\",\"scheduledAtMicros\":\"0\",\"schema\":\"scheduler-decision-v1\",\"slotIndex\":\"0\"}");
  assert.equal(genesis.hash, "7938e6b782d19509af121a8e4141ca277dbcb5b0be97c386f69ec4c9782d0611");
  const successor = canonical.canonicalizeSchedulerDecision({
    ...baseDecision,
    slotIndex: "1",
    previousDecisionIdentity: { operationId: OPERATION, policyId: POLICY, slotIndex: "0" },
    previousDecisionCanonicalHash: HASH_C,
    scheduledAtMicros: "1000000",
    reason: "INTERVAL_ELIGIBILITY",
    runNowBindingIdentity: "binding-1",
    runNowRunId: "77777777-7777-4777-8777-777777777777",
  });
  assert.equal(successor.hash, "ac569aa5364243d3c9e2f059dcf2120e6578b66cab75d253687b585ae87bcea1");
  assert.match(successor.canonical, /"previousDecisionIdentity":\{"operationId":"11111111-1111-4111-8111-111111111111","policyId":"22222222-2222-4222-8222-222222222222","slotIndex":"0"\}/);
});

test("ACTIVE_RUN PLANNED and RUNNING canonical vectors preserve explicit null rules", () => {
  const planned = canonical.canonicalizeSchedulerDecision({ ...baseDecision, decision: "NO_ACTION", reason: "ACTIVE_RUN", activeRunId: RUN, activeRunCreationIdentity: RUN, activeRunCreationHash: HASH_C, activeRunHistoricalState: "PLANNED", runNowBindingIdentity: null, runNowRunId: null });
  assert.equal(planned.hash, "4dd5f67cda928b4144381901befd564df30a948fe3b366392e0122a4e504d01d");
  const running = canonical.canonicalizeSchedulerDecision({ ...baseDecision, decision: "NO_ACTION", reason: "ACTIVE_RUN", activeRunId: RUN, activeRunCreationIdentity: RUN, activeRunCreationHash: HASH_C, activeRunHistoricalState: "RUNNING", activeRunRunningEventIdentity: "66666666-6666-4666-8666-666666666666", activeRunRunningEventHash: HASH_D, runNowBindingIdentity: null, runNowRunId: null });
  assert.equal(running.hash, "579ac814ae8e27415c51b2d2260047336b04458f4039a0023ea269c9055f36cb");
  assert.match(planned.canonical, /"activeRunRunningEventHash":null/);
  assert.match(running.canonical, /"activeRunRunningEventHash":"dddd/);
});

test("RunNowBinding canonical and deterministic Scheduler run identity vectors are exact", () => {
  const binding = canonical.canonicalizeSchedulerRunNowBinding({ operationId: OPERATION, policyId: POLICY, slotIndex: "0", runId: RUN });
  assert.equal(binding.canonical, "{\"canonicalVersion\":\"1\",\"operationId\":\"11111111-1111-4111-8111-111111111111\",\"policyId\":\"22222222-2222-4222-8222-222222222222\",\"runId\":\"55555555-5555-4555-8555-555555555555\",\"schema\":\"scheduler-run-now-binding-v1\",\"slotIndex\":\"0\"}");
  assert.equal(binding.hash, "5567261ca20e05a3aca2239f3e9f55de4e5d369447ae04b3de8fca4896911116");
  assert.equal(canonical.deriveSchedulerRunId({ operationId: OPERATION, policyId: POLICY, slotIndex: "0" }), "0d165c5d-5981-447e-96ca-00f30e686ff5");
  assert.equal(canonical.deriveSchedulerRunId({ operationId: OPERATION, policyId: POLICY, slotIndex: "9007199254740993" }), "2bcb599c-81ce-4e00-9e4a-65fee7dae115");
  assert.notEqual(canonical.deriveSchedulerRunId({ operationId: OPERATION, policyId: POLICY, slotIndex: "0" }), canonical.deriveSchedulerRunId({ operationId: OPERATION, policyId: POLICY, slotIndex: "1" }));
});

test("Canonical validators reject omitted fields, invalid null shapes, and non-canonical identities", () => {
  assert.throws(() => canonical.canonicalizeSchedulerPolicyVersion({ ...policyInput, policyId: "22222222-2222-4222-8222-22222222222" }), canonical.SchedulerCanonicalError);
  assert.throws(() => canonical.canonicalizeSchedulerDecision({ ...baseDecision, nextEligibleAtMicros: null }), canonical.SchedulerCanonicalError);
  assert.throws(() => canonical.canonicalizeSchedulerDecision({ ...baseDecision, previousDecisionIdentity: { operationId: OPERATION, policyId: POLICY, slotIndex: "0" } }), canonical.SchedulerCanonicalError);
  assert.throws(() => canonical.canonicalizeSchedulerDecision({ ...baseDecision, activeRunHistoricalState: "PLANNED", activeRunId: RUN }), canonical.SchedulerCanonicalError);
  assert.throws(() => canonical.canonicalizeSchedulerRunNowBinding({ operationId: OPERATION, policyId: POLICY, slotIndex: "0", runId: "not-a-uuid" }), canonical.SchedulerCanonicalError);
});
