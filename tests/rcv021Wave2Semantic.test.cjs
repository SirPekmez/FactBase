const assert = require("node:assert/strict");
const test = require("node:test");
const canonical = require("../dist/services/rcv021Canonical");
const core = require("../dist/services/rcv021SemanticCore");
const contract = require("../dist/contracts/rcv021ActiveResearchContractV1");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000000Z`;
const fields = (value) => { const c = canonical.canonicalizeRcv021(value); return { canonicalVersion: 1, canonical: c.canonical, canonicalHash: c.hash }; };

function subject(type = "AUTHENTICATED_OPERATOR_REQUEST") {
  const value = { subjectBindingId: id(1), operationId: id(2), subjectType: type, captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: type === "AUTHENTICATED_OPERATOR_REQUEST" ? id(3) : null, historicalClaimId: null }; return { ...value, ...fields(value) };
}
function trigger(type = "OPERATOR") {
  const value = type === "OPERATOR" ? { triggerType: type, initiatorIdentity: "operator", authorizationCanonical: "auth", creationTime: time(0), executionOwner: "owner", executionContext: "ctx" } : { triggerType: type, triggerRequestId: id(4), creationTime: time(0), executionOwner: "owner", ruleIdentity: "rule", ruleVersion: 1, originatingCaptureId: null, originatingOccurrenceId: id(5) };
  const full = { triggerBindingId: id(6), operationId: id(2), ...value }; return { ...full, ...fields(full) };
}
function operation() { const value = { operationId: id(2), subjectBindingId: id(1), triggerBindingId: id(6), purpose: "research", scopeCanonical: "scope", operationCreatedAt: time(0) }; return { ...value, ...fields(value) }; }
function run(n = 10, predecessorRunId = null) { const value = { runId: id(n), operationId: id(2), strategyIdentity: "strategy", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}", runCreatedAt: time(n === 10 ? 1 : 20), deadlineAt: time(n === 10 ? 50 : 60), predecessorRunId }; return { ...value, ...fields(value) }; }
function attempt(n, number, predecessorAttemptId = null, started = 3) { const value = { attemptId: id(n), runId: id(10), attemptNumber: String(number), predecessorAttemptId, startedAt: time(started) }; return { ...value, ...fields(value) }; }
function resolution(n, outcome, terminal = 4, failureAuthority = null) { const value = { resolutionId: id(n + 100), attemptId: id(n), outcome, terminalAt: time(terminal), failureAuthority }; return { ...value, ...fields(value) }; }
function provider(n, observed = 5) { const value = { resultId: id(n), runId: id(10), providerItemIdentity: `item-${n}`, providerEnvelopeCanonical: "{}", providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", resultObservedAt: time(observed), providerSourceTime: null, protocolResultStatus: "returned" }; return { ...value, ...fields(value) }; }

test("closed vocabularies and canonical/hash repeatability", () => {
  assert.deepEqual(contract.RCV021_ATTEMPT_OUTCOMES, ["SUCCEEDED", "FAILED"]);
  const a = canonical.canonicalizeRcv021({ z: 1, a: "x" });
  const b = canonical.canonicalizeRcv021({ a: "x", z: 1 });
  assert.deepEqual(a, b);
  assert.equal(canonical.sha256Rcv021Text(a.canonical), a.hash);
  assert.throws(() => canonical.validateRcv021BigInt(9007199254740993), contract.Rcv021ValidationError);
  assert.equal(canonical.canonicalRcv021BigInt("9007199254740993"), "9007199254740993");
});

test("secret boundary rejects nested canonical-envelope plaintext", () => {
  const forbidden = [
    { providerEnvelopeCanonical: JSON.stringify({ token: "bearer" }) },
    { executionParametersCanonical: JSON.stringify({ auth: { password: "pw" } }) },
    { authorizationCanonical: JSON.stringify({ nested: [{ apiKey: "key" }] }) },
    { failureAuthority: JSON.stringify({ privateCredential: "secret" }) },
  ];
  for (const payload of forbidden) assert.throws(() => canonical.canonicalizeRcv021Authority(payload), /MALFORMED_DATA/);
  assert.doesNotThrow(() => canonical.canonicalizeRcv021Authority({ credentialReferenceId: "cred-1", credentialReferenceVersion: "v1", providerAccountId: "acct-1", redactedExecution: "[REDACTED]" }));
});

test("independent frozen canonical/hash golden vectors", () => {
  const vectors = [
    [
      { operationId: "00000000-0000-4000-8000-000000000002", subjectBindingId: "00000000-0000-4000-8000-000000000001", triggerBindingId: "00000000-0000-4000-8000-000000000006", purpose: "research", scopeCanonical: "scope", operationCreatedAt: "2026-01-01T00:00:00.000000Z" },
      "{\"operationCreatedAt\":\"2026-01-01T00:00:00.000000Z\",\"operationId\":\"00000000-0000-4000-8000-000000000002\",\"purpose\":\"research\",\"scopeCanonical\":\"scope\",\"subjectBindingId\":\"00000000-0000-4000-8000-000000000001\",\"triggerBindingId\":\"00000000-0000-4000-8000-000000000006\"}",
      "68d21ec09f8d859a69237c12b26b6e6a34cd1bffd7a22ac913e6c75b82e1ff9f",
    ],
    [
      { attemptId: "00000000-0000-4000-8000-000000000020", runId: "00000000-0000-4000-8000-000000000010", attemptNumber: "1", predecessorAttemptId: null, startedAt: "2026-01-01T00:00:02.000000Z" },
      "{\"attemptId\":\"00000000-0000-4000-8000-000000000020\",\"attemptNumber\":\"1\",\"predecessorAttemptId\":null,\"runId\":\"00000000-0000-4000-8000-000000000010\",\"startedAt\":\"2026-01-01T00:00:02.000000Z\"}",
      "cf680a543b7c68cfb66fcd8b0ebb37052350955e3d59e99cd3a629db4700ce62",
    ],
    [
      { resultId: "00000000-0000-4000-8000-000000000030", runId: "00000000-0000-4000-8000-000000000010", providerItemIdentity: "item", providerEnvelopeCanonical: "{}", providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", resultObservedAt: "2026-01-01T00:00:03.000000Z", providerSourceTime: null, protocolResultStatus: "returned" },
      "{\"adapterIdentity\":\"adapter\",\"adapterVersion\":\"1\",\"protocolResultStatus\":\"returned\",\"providerEnvelopeCanonical\":\"{}\",\"providerIdentity\":\"provider\",\"providerItemIdentity\":\"item\",\"providerSourceTime\":null,\"resultId\":\"00000000-0000-4000-8000-000000000030\",\"resultObservedAt\":\"2026-01-01T00:00:03.000000Z\",\"runId\":\"00000000-0000-4000-8000-000000000010\"}",
      "6b1908bba5e36673cc79a9bae1a4c9db15bc00fce73f30c376ca6fedab2cccf6",
    ],
    [
      { triggerBindingId: "00000000-0000-4000-8000-000000000006", operationId: "00000000-0000-4000-8000-000000000002", triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: "2026-01-01T00:00:00.000000Z", executionOwner: "owner", executionContext: "ctx", triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null },
      "{\"authorizationCanonical\":\"{}\",\"creationTime\":\"2026-01-01T00:00:00.000000Z\",\"executionContext\":\"ctx\",\"executionOwner\":\"owner\",\"initiatorIdentity\":\"operator\",\"operationId\":\"00000000-0000-4000-8000-000000000002\",\"originatingCaptureId\":null,\"originatingOccurrenceId\":null,\"ruleIdentity\":null,\"ruleVersion\":null,\"triggerBindingId\":\"00000000-0000-4000-8000-000000000006\",\"triggerRequestId\":null,\"triggerType\":\"OPERATOR\"}",
      "1a3ad2a218b3c47701416e67a3315faae961902adc4a03a87bb5dc1fec413603",
    ],
  ];
  for (const [value, expectedCanonical, expectedHash] of vectors) { const actual = canonical.canonicalizeRcv021Authority(value); assert.equal(actual.canonical, expectedCanonical); assert.equal(actual.hash, expectedHash); }
  const unordered = canonical.canonicalizeUnorderedCollection([{ b: 2 }, { a: 1 }]); assert.equal(unordered.canonical, '["{\\"a\\":1}","{\\"b\\":2}"]'); assert.equal(unordered.hash, "c5ef08c25e1a1af0d149d7d737c03d6bcfc80e38f31185dc2d3359d58f0bac7e");
  const ordered = canonical.canonicalizeOrderedCollection([{ n: 2 }, { n: 1 }]); assert.equal(ordered.canonical, '[{"n":2},{"n":1}]'); assert.equal(ordered.hash, "ab1002419e27018c30037806e30698e6bf8e97b2c6967d77e964d045ff527069");
});

test("set ordering is stable and sequence ordering is preserved", () => {
  const unorderedA = canonical.canonicalizeUnorderedCollection([{ b: 2 }, { a: 1 }]);
  const unorderedB = canonical.canonicalizeUnorderedCollection([{ a: 1 }, { b: 2 }]);
  assert.equal(unorderedA.canonical, unorderedB.canonical);
  const orderedA = canonical.canonicalizeOrderedCollection([{ n: 2 }, { n: 1 }]);
  const orderedB = canonical.canonicalizeOrderedCollection([{ n: 1 }, { n: 2 }]);
  assert.notEqual(orderedA.canonical, orderedB.canonical);
});

test("subject and trigger XOR validation is exact", () => {
  core.validateSubjectBinding(subject());
  const badSubject = { ...subject(), observationOccurrenceId: id(7) }; const { canonicalVersion: _sv, canonical: _sc, canonicalHash: _sh, ...badSubjectPayload } = badSubject; assert.throws(() => core.validateSubjectBinding({ ...badSubject, ...fields(badSubjectPayload) }), /SUBJECT_BINDING_VIOLATION/);
  core.validateTriggerBinding(trigger("OPERATOR"));
  core.validateTriggerBinding(trigger("RCV020_RESEARCH_REQUEST"));
  const badTrigger = { ...trigger(), triggerType: "SYSTEM" }; const { canonicalVersion: _tv, canonical: _tc, canonicalHash: _th, ...badTriggerPayload } = badTrigger; assert.throws(() => core.validateTriggerBinding({ ...badTrigger, ...fields(badTriggerPayload) }), /TRIGGER_BINDING_VIOLATION/);
});

test("operation and run lifecycle are closed and current-state free", () => {
  const op = operation();
  assert.equal(core.validateOperationCreation(op, subject(), trigger()), op);
  assert.equal(core.deriveOperationLifecycle(op, []), "OPEN");
  const closeValue = { eventId: id(8), operationId: id(2), eventType: "CLOSED", eventAt: time(9), actorIdentity: "operator" }; const close = { ...closeValue, ...fields(closeValue) };
  assert.equal(core.deriveOperationLifecycle(op, [close]), "CLOSED");
  assert.throws(() => core.validateRunCreation(run(), op, "CLOSED"), /LIFECYCLE_VIOLATION/);
  assert.deepEqual(core.validateRunCreation(run(), op, "OPEN"), run());
});

test("attempt terminal model and valid retry lineage", () => {
  const first = attempt(20, 1, null, 3); const failed = resolution(20, "FAILED", 4, "technical");
  const retry = attempt(21, 2, id(20), 5); const succeeded = resolution(21, "SUCCEEDED", 6, null);
  core.validateAttemptSet([first, retry], [failed, succeeded], time(10));
  const badResolution = { ...failed, outcome: "TIMED_OUT" }; assert.throws(() => core.validateAttemptSet([first, retry], [{ ...badResolution, ...fields(badResolution) }, succeeded]), /RETRY_LINEAGE_VIOLATION|UNSUPPORTED_STATE/);
  assert.throws(() => core.validateRetry({ ...retry, attemptNumber: "3" }, first, failed), /RETRY_LINEAGE_VIOLATION/);
  assert.throws(() => core.validateRetry({ ...retry, startedAt: time(4) }, first, failed), /ORDERING_VIOLATION/);
});

test("exact BigInt retry arithmetic beyond MAX_SAFE is preserved", () => {
  const predecessor = attempt(30, "9007199254740993", null, 3); const failed = resolution(30, "FAILED", 4, "technical");
  const retry = attempt(31, "9007199254740994", id(30), 5);
  core.validateRetry(retry, predecessor, failed);
  assert.equal(canonical.canonicalRcv021BigInt(retry.attemptNumber), "9007199254740994");
  const exact = canonical.canonicalizeRcv021Authority({ versionNumber: "9007199254740993", retryNumber: "9007199254740994", eventSequence: "9007199254740995" });
  assert.match(exact.canonical, /9007199254740993/); assert.match(exact.canonical, /9007199254740994/); assert.match(exact.canonical, /9007199254740995/);
});

test("PostgreSQL BIGINT maximum and retry overflow fail closed", () => {
  const maximum = "9223372036854775807";
  assert.equal(canonical.validateRcv021BigInt(maximum).toString(), maximum);
  assert.throws(() => canonical.validateRcv021BigInt("9223372036854775808"), /MALFORMED_DATA/);
  const predecessor = attempt(32, maximum, null, 3); const failed = resolution(32, "FAILED", 4, "technical");
  assert.throws(() => core.validateRetry(attempt(33, "9223372036854775808", id(32), 5), predecessor, failed), /MALFORMED_DATA|RETRY_LINEAGE_VIOLATION/);
});

test("deadline timeout resolves active attempts before terminal Run", () => {
  const a = attempt(40, 1, null, 3); const r = resolution(40, "FAILED", 10, "RUN_DEADLINE_EXPIRED");
  const timeoutRunValue = { ...run(), deadlineAt: time(10) }; const timeoutRun = { ...timeoutRunValue, ...fields(timeoutRunValue) };
  core.validateAttemptSet([a], [r], time(12));
  const results = [];
  const manifest = core.deriveTerminalManifest(results);
  const terminalValue = { resolutionId: id(41), runId: id(10), outcome: "TIMED_OUT", terminalAt: time(12), completionAuthority: "engine", resultManifestCanonical: manifest.canonical, resultManifestHash: manifest.hash, resultCount: "0" };
  core.validateRunTerminalResolution({ ...terminalValue, ...fields(terminalValue) }, timeoutRun, [a], [r], results);
  assert.throws(() => core.validateRunTerminalResolution({ ...terminalValue, terminalAt: time(40), ...fields({ ...terminalValue, terminalAt: time(40) }) }, run(), [a], [], results), /LIFECYCLE_VIOLATION/);
});

test("ProviderResult manifest is deterministic and terminal integrity only", () => {
  const results = [provider(52), provider(51)]; const manifest = core.deriveTerminalManifest(results);
  assert.deepEqual(JSON.parse(manifest.canonical).map((x) => x.resultId), [id(51), id(52)]);
  const terminalValue = { resolutionId: id(60), runId: id(10), outcome: "SUCCESS_WITH_RESULTS", terminalAt: time(10), completionAuthority: "engine", resultManifestCanonical: manifest.canonical, resultManifestHash: manifest.hash, resultCount: manifest.count };
  core.validateRunTerminalResolution({ ...terminalValue, ...fields(terminalValue) }, run(), [attempt(61, 1, null, 3)], [resolution(61, "SUCCEEDED", 6)], results);
  assert.throws(() => core.validateRunTerminalResolution({ ...terminalValue, resultCount: "1", ...fields({ ...terminalValue, resultCount: "1" }) }, run(), [attempt(61, 1, null, 3)], [resolution(61, "SUCCEEDED", 6)], results), /RESULT_MANIFEST_MISMATCH/);
});

test("selection preserves occurrence identity without implying Capture", () => {
  const result = provider(70); const value = { selectionId: id(71), providerResultId: id(70), selectionAuthorization: "authorized", selectedArtifactIdentity: "artifact", observationOccurrenceId: id(72), selectedAt: time(7) };
  const selection = { ...value, ...fields(value) };
  core.validateResultSelection(selection, [result]); core.validateObservationBinding(selection, id(72));
  assert.throws(() => core.validateObservationBinding(selection, id(73)), /RCV020_BINDING_VIOLATION/);
});

test("rerun requires OPEN operation and terminal predecessor", () => {
  const op = operation(); const first = { ...run(10), terminalAt: time(10) }; const second = run(11, id(10));
  core.validateRerun(second, op, "OPEN", first);
  assert.throws(() => core.validateRerun(second, op, "CLOSED", first), /RERUN_LINEAGE_VIOLATION/);
  assert.throws(() => core.validateRerun({ ...second, runCreatedAt: time(5) }, op, "OPEN", first), /ORDERING_VIOLATION/);
});

test("failure precedence and late-result predicate are deterministic", () => {
  const choice = core.classifyRcv021Failures([{ code: "HASH_MISMATCH", path: "z" }, { code: "MALFORMED_DATA", path: "a" }, { code: "HASH_MISMATCH", path: "a" }]);
  assert.equal(choice.code, "MALFORMED_DATA");
  assert.equal(core.classifyRcv021Failures([{ code: "HASH_MISMATCH", path: "z" }, { code: "HASH_MISMATCH", path: "a" }]).path, "a");
  assert.equal(core.isLateProviderResult(time(11), time(10)), true);
  assert.equal(core.isLateProviderResult(time(10), time(10)), false);
  assert.equal(core.compareRcv021Identity(id(1), "a", id(1), "a"), "IDEMPOTENT");
  assert.equal(core.compareRcv021Identity(id(1), "a", id(1), "b"), "CONFLICT");
  assert.equal(core.compareRcv021Identity(id(1), "a", id(2), "a"), "DISTINCT");
});

test("deterministic structured canonical fuzz has no unexpected outcomes", () => {
  let valid = 0; let invalid = 0;
  for (let i = 0; i < 1000; i += 1) {
    if (i < 500) { const value = { index: i, set: [{ v: 2 }, { v: 1 }] }; assert.doesNotThrow(() => canonical.canonicalizeRcv021Authority(value)); valid += 1; }
    else { assert.throws(() => canonical.canonicalizeRcv021Authority({ index: i, token: `secret-${i}` }), /MALFORMED_DATA/); invalid += 1; }
  }
  assert.deepEqual({ valid, invalid }, { valid: 500, invalid: 500 });
});

test("pure functions do not mutate inputs and remain deterministic across repetition", () => {
  const result = provider(80); const before = JSON.stringify(result); const first = core.deriveTerminalManifest([result]);
  for (let i = 0; i < 1000; i += 1) assert.deepEqual(core.deriveTerminalManifest([result]), first);
  assert.equal(JSON.stringify(result), before);
});
