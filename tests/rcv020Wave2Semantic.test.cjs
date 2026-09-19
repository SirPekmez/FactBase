const assert = require("node:assert/strict");
const test = require("node:test");

const canonical = require("../dist/services/rcv020Canonical");
const core = require("../dist/services/rcv020SemanticCore");
const contract = require("../dist/contracts/rcv020ObservatoryContractV1");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (letter = "a") => letter.repeat(64);
const time = (second) => {
  const hour = Math.floor(second / 3600);
  const minute = Math.floor((second % 3600) / 60);
  const value = second % 60;
  return `2026-01-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(value).padStart(2, "0")}.000000Z`;
};

function request(index = 0) {
  return { method: "GET", target: `https://example.test/items/${index}`, parameters: { page: index }, credentialReference: null };
}

function config() {
  return {
    monitorConfigurationVersionId: id(3), monitorId: id(2), versionNumber: "1", endpointRequest: request(),
    retrievalMethod: "GET", authenticationReference: null, expectedMediaConstraints: {}, triggerEligibility: "SCHEDULED",
    scope: {}, safetyPolicy: {}, adapterId: "probe", adapterVersion: "1", parserId: null, parserVersion: null,
    retentionPolicy: "METADATA_HASH_ONLY", retentionPolicyVersion: 1, effectiveFrom: time(0), effectiveUntil: time(30),
  };
}

function occurrence(origin = "SCHEDULED", number = 10) {
  return {
    occurrenceId: id(number), logicalSourceId: id(1), monitorId: id(2), monitorConfigurationVersionId: id(3),
    triggerOrigin: origin, scheduledAt: origin === "SCHEDULED" ? time(1) : null,
    triggerReceivedAt: origin === "EXTERNAL" ? time(1) : null, requestedAt: origin === "OPERATOR" ? time(1) : null,
    dueAt: time(2), evaluationCutoffAt: time(20),
  };
}

function attempt(number, attemptId, occurrenceId, previousAttemptId = null, started = 3, deadline = 10) {
  return { attemptId: id(attemptId), occurrenceId: id(occurrenceId), previousAttemptId, retryNumber: String(number), retrievalStartedAt: time(started), attemptDeadlineAt: time(deadline) };
}

function resolution(attemptId, outcome, completed = 4, failureCode = null) {
  return { attemptId: id(attemptId), retrievalCompletedAt: time(completed), outcome, failureCode };
}

function capture(captureId, attemptId, occurrenceId, observed = 4, content = "a") {
  return { captureId: id(captureId), logicalSourceId: id(1), monitorId: id(2), monitorConfigurationVersionId: id(3), occurrenceId: id(occurrenceId), retrievalAttemptId: id(attemptId), observedAt: time(observed), contentHash: hash(content), byteLength: "0", rawObjectIdentity: null };
}

test("RCV-020 canonical/hash and BigInt boundaries are deterministic", () => {
  const first = canonical.canonicalizeRcv020Request(request(1));
  const reordered = canonical.canonicalizeRcv020Request({ credentialReference: null, parameters: { page: 1 }, target: "https://example.test/items/1", method: "GET" });
  assert.deepEqual(first, reordered);
  assert.equal(canonical.canonicalBigInt("9007199254740993"), "9007199254740993");
  assert.equal(canonical.canonicalBigInt(9007199254740993n), "9007199254740993");
  assert.throws(() => canonical.canonicalBigInt(9007199254740993), contract.Rcv020ValidationError);
  assert.throws(() => canonical.canonicalizeRcv020Request({ ...request(), token: "secret" }), contract.Rcv020ValidationError);
  assert.throws(() => canonical.canonicalizeRcv020({ bad: undefined }), contract.Rcv020ValidationError);
  const c = canonical.canonicalizeRcv020MonitorConfiguration(config());
  assert.equal(c.canonical, canonical.canonicalizeRcv020MonitorConfiguration(config()).canonical);
});

test("RCV-020 lifecycle and occurrence semantics are closed and reconstructible", () => {
  const cfg = config();
  const events = [
    { eventId: id(20), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "policy" },
    { eventId: id(21), monitorConfigurationVersionId: id(3), eventType: "PAUSED", eventAt: time(5), eventSequence: "2", actorPolicyIdentity: "policy" },
    { eventId: id(22), monitorConfigurationVersionId: id(3), eventType: "RESUMED", eventAt: time(6), eventSequence: "3", actorPolicyIdentity: "policy" },
    { eventId: id(23), monitorConfigurationVersionId: id(3), eventType: "RETIRED", eventAt: time(30), eventSequence: "4", actorPolicyIdentity: "policy" },
  ];
  assert.equal(core.deriveLifecycleState(cfg, events), "RETIRED");
  assert.throws(() => core.deriveLifecycleState(cfg, [events[0], { ...events[1], eventType: "RESUMED", eventSequence: "2" }]), contract.Rcv020ValidationError);
  assert.throws(() => core.validateObservationOccurrence({ ...occurrence(), triggerOrigin: "DISABLED" }), contract.Rcv020ValidationError);
  for (const origin of ["SCHEDULED", "EXTERNAL", "OPERATOR"]) core.validateObservationOccurrence(occurrence(origin, origin === "SCHEDULED" ? 10 : origin === "EXTERNAL" ? 11 : 12));
  assert.equal(core.resolveOccurrenceTerminal(occurrence("SCHEDULED", 10), [], [], []), "MISSED");
  assert.equal(core.resolveOccurrenceTerminal(occurrence("SCHEDULED", 10), [], [], [], "SKIPPED"), "SKIPPED");
  assert.equal(core.canonicalizeRcv020Occurrence(occurrence()).hash.length, 64);
});

test("RCV-020 retry, terminal, Capture, and directional comparison semantics", () => {
  const o = occurrence();
  const first = attempt(1, 30, 10, null, 3, 8);
  const retry = attempt(2, 31, 10, id(30), 5, 10);
  const resolutions = [resolution(30, "FAILED", 4, "TIMEOUT"), resolution(31, "CAPTURED_CHANGED", 6)];
  const captures = [capture(40, 31, 10, 6)];
  core.validateAttemptSet([first, retry], new Map([[o.occurrenceId, o]]), new Map(resolutions.map((r) => [r.attemptId, r])));
  core.validateCapture(captures[0], retry, resolutions[1]);
  assert.equal(core.canonicalizeRcv020Attempt(retry).hash.length, 64);
  assert.equal(core.resolveOccurrenceTerminal(o, [first, retry], resolutions, captures), "SUCCEEDED");
  const prior = capture(41, 31, 10, 5, "b");
  const comparison = { comparisonId: id(42), currentCaptureId: id(40), priorCaptureId: id(41), algorithmId: "raw-bytes", algorithmVersion: 1, result: "CHANGED" };
  core.validateCaptureComparison(comparison, captures[0], prior);
  assert.equal(core.canonicalizeRcv020CaptureComparison(comparison).hash.length, 64);
  assert.equal(core.canonicalizeRcv020RetentionAvailabilityEvent({ eventId: id(43), captureId: id(40), eventType: "LOST", eventAt: time(7), eventSequence: "1" }).hash.length, 64);
  assert.throws(() => core.validateCaptureComparison({ ...comparison, priorCaptureId: id(40) }, captures[0], captures[0]), contract.Rcv020ValidationError);
  assert.throws(() => core.validateCaptureComparison({ ...comparison, result: "UNCHANGED" }, captures[0], { ...prior, observedAt: time(6) }), contract.Rcv020ValidationError);
});

test("RCV-020 terminal boundary rejects in-flight and late success authority", () => {
  const o = occurrence("SCHEDULED", 15);
  const inFlight = attempt(1, 32, 15, null, 3, 10);
  assert.throws(() => core.resolveOccurrenceTerminal(o, [inFlight], [], []), contract.Rcv020ValidationError);
  const late = resolution(32, "CAPTURED_CHANGED", 11);
  const cap = capture(33, 32, 15, 11);
  assert.throws(() => core.validateAttemptSet([inFlight], new Map([[o.occurrenceId, o]]), new Map([[late.attemptId, late]])), contract.Rcv020ValidationError);
  assert.throws(() => core.resolveOccurrenceTerminal(o, [inFlight], [late], [cap]), contract.Rcv020ValidationError);
  const failed = resolution(32, "FAILED", 10, "TIMEOUT");
  assert.equal(core.resolveOccurrenceTerminal(o, [inFlight], [failed], []), "FAILED");
  const parserFailed = resolution(32, "FAILED", 9, "PARSER_FAILURE");
  assert.equal(core.resolveOccurrenceTerminal(o, [inFlight], [parserFailed], []), "FAILED");
  const historical = [failed];
  assert.throws(() => core.resolveOccurrenceTerminal(o, [inFlight], [...historical, resolution(32, "CAPTURED_CHANGED", 9)], [cap]), contract.Rcv020ValidationError);
  assert.equal(core.resolveOccurrenceTerminal(o, [inFlight], historical, []), "FAILED");
});

const negativeCases = [
  ["malformed canonical", () => canonical.canonicalizeRcv020({ x: undefined })],
  ["hash mismatch", () => canonical.assertRcv020HashMatches("x", hash("b"))],
  ["unsupported version", () => contract.validateRcv020Version(2)],
  ["duplicate activation", () => core.deriveLifecycleState(config(), [{ eventId: id(50), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "x" }, { eventId: id(51), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(1), eventSequence: "2", actorPolicyIdentity: "x" }])],
  ["retirement before activation", () => core.deriveLifecycleState(config(), [{ eventId: id(52), monitorConfigurationVersionId: id(3), eventType: "RETIRED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "x" }])],
  ["resume without pause", () => core.deriveLifecycleState(config(), [{ eventId: id(53), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "x" }, { eventId: id(54), monitorConfigurationVersionId: id(3), eventType: "RESUMED", eventAt: time(1), eventSequence: "2", actorPolicyIdentity: "x" }])],
  ["post-retirement event", () => core.deriveLifecycleState(config(), [{ eventId: id(55), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "x" }, { eventId: id(56), monitorConfigurationVersionId: id(3), eventType: "RETIRED", eventAt: time(30), eventSequence: "2", actorPolicyIdentity: "x" }, { eventId: id(57), monitorConfigurationVersionId: id(3), eventType: "PAUSED", eventAt: time(31), eventSequence: "3", actorPolicyIdentity: "x" }])],
  ["lifecycle ordering", () => core.deriveLifecycleState(config(), [{ eventId: id(58), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(1), eventSequence: "2", actorPolicyIdentity: "x" }, { eventId: id(59), monitorConfigurationVersionId: id(3), eventType: "PAUSED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "x" }])],
  ["invalid trigger fields", () => core.validateObservationOccurrence({ ...occurrence(), scheduledAt: null })],
  ["unsupported occurrence outcome", () => core.validateOccurrenceOutcome("DISABLED")],
  ["deadline beyond cutoff", () => core.validateAttemptSet([attempt(1, 60, 10, null, 3, 25)], new Map([[id(10), occurrence()]]), new Map())],
  ["retry before predecessor terminal", () => core.validateAttemptSet([attempt(1, 61, 10), attempt(2, 62, 10, id(61), 4)], new Map([[id(10), occurrence()]]), new Map())],
  ["predecessor not FAILED", () => core.validateAttemptSet([attempt(1, 63, 10), attempt(2, 64, 10, id(63), 6)], new Map([[id(10), occurrence()]]), new Map([[id(63), resolution(63, "CAPTURED_EMPTY")]]))],
  ["retry cross-occurrence", () => core.validateAttemptSet([attempt(1, 65, 10), attempt(2, 66, 11, id(65), 6)], new Map([[id(10), occurrence()], [id(11), occurrence("SCHEDULED", 11)]]), new Map([[id(65), resolution(65, "FAILED", 4, "TIMEOUT")]]))],
  ["retry cycle", () => core.validateAttemptSet([attempt(1, 67, 10, id(68)), attempt(2, 68, 10, id(67), 6)], new Map([[id(10), occurrence()]]), new Map([[id(67), resolution(67, "FAILED", 4, "TIMEOUT")], [id(68), resolution(68, "FAILED", 7, "TIMEOUT")]]))],
  ["wrong retry number", () => core.validateAttemptSet([attempt(1, 69, 10), attempt(3, 70, 10, id(69), 6)], new Map([[id(10), occurrence()]]), new Map([[id(69), resolution(69, "FAILED", 4, "TIMEOUT")]]))],
  ["duplicate terminal resolution", () => core.resolveOccurrenceTerminal(occurrence(), [attempt(1, 71, 10)], [resolution(71, "FAILED", 4, "TIMEOUT"), resolution(71, "FAILED", 5, "TIMEOUT")], [])],
  ["Capture on failed attempt", () => core.validateCapture(capture(72, 71, 10), attempt(1, 71, 10), resolution(71, "FAILED", 4, "TIMEOUT"))],
  ["missing Capture for success", () => core.resolveOccurrenceTerminal(occurrence(), [attempt(1, 73, 10)], [resolution(73, "CAPTURED_EMPTY")], [])],
  ["multiple Captures", () => core.resolveOccurrenceTerminal(occurrence(), [attempt(1, 74, 10)], [resolution(74, "CAPTURED_EMPTY")], [capture(75, 74, 10), capture(76, 74, 10)])],
  ["EMPTY without request authority", () => canonical.canonicalizeRcv020Request({ method: "GET", target: "x", parameters: {}, credentialReference: undefined })],
  ["UNCHANGED without prior", () => core.validateCaptureComparison({ comparisonId: id(77), currentCaptureId: id(40), priorCaptureId: null, algorithmId: "x", algorithmVersion: 1, result: "UNCHANGED" }, capture(40, 31, 10), undefined)],
  ["self comparison", () => core.validateCaptureComparison({ comparisonId: id(78), currentCaptureId: id(40), priorCaptureId: id(40), algorithmId: "x", algorithmVersion: 1, result: "CHANGED" }, capture(40, 31, 10), capture(40, 31, 10))],
  ["future comparison", () => core.validateCaptureComparison({ comparisonId: id(79), currentCaptureId: id(40), priorCaptureId: id(41), algorithmId: "x", algorithmVersion: 1, result: "CHANGED" }, capture(40, 31, 10, 4), capture(41, 31, 10, 5))],
  ["equal-time comparison", () => core.validateCaptureComparison({ comparisonId: id(80), currentCaptureId: id(40), priorCaptureId: id(41), algorithmId: "x", algorithmVersion: 1, result: "CHANGED" }, capture(40, 31, 10, 5), capture(41, 31, 10, 5))],
  ["cross-Monitor comparison", () => core.validateCaptureComparison({ comparisonId: id(81), currentCaptureId: id(40), priorCaptureId: id(41), algorithmId: "x", algorithmVersion: 1, result: "CHANGED" }, capture(40, 31, 10, 6), { ...capture(41, 31, 10, 5), monitorId: id(99) })],
  ["semantic comparison", () => core.validateCaptureComparison({ comparisonId: id(82), currentCaptureId: id(40), priorCaptureId: id(41), algorithmId: "ai-similarity", algorithmVersion: 1, result: "UNCHANGED" }, capture(40, 31, 10, 6), capture(41, 31, 10, 5))],
  ["RESTORED event", () => core.validateRetentionAvailabilityEvent({ eventId: id(83), captureId: id(40), eventType: "RESTORED", eventAt: time(7), eventSequence: "1" })],
  ["unsafe BigInt", () => canonical.validateRcv020BigInt(1.5)],
];

test("RCV-020 negative manifest fails deterministically", () => {
  assert.equal(negativeCases.length, 29);
  for (const [name, operation] of negativeCases) assert.throws(operation, contract.Rcv020ValidationError, name);
});

test("RCV-020 deterministic soak executes 1,000 times with zero drift", () => {
  const baseline = JSON.stringify({ request: canonical.canonicalizeRcv020Request(request(2)), config: canonical.canonicalizeRcv020MonitorConfiguration(config()), state: core.deriveLifecycleState(config(), [{ eventId: id(90), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "x" }]) });
  for (let i = 0; i < 1000; i += 1) assert.equal(JSON.stringify({ request: canonical.canonicalizeRcv020Request(request(2)), config: canonical.canonicalizeRcv020MonitorConfiguration(config()), state: core.deriveLifecycleState(config(), [{ eventId: id(90), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "x" }]) }), baseline);
});

test("RCV-020 structured fuzz executes exactly 500 valid and 500 expected-invalid cases", () => {
  let valid = 0; let expectedInvalid = 0;
  for (let i = 0; i < 1000; i += 1) {
    if (i < 500) { assert.doesNotThrow(() => canonical.canonicalizeRcv020Request(request(i))); valid += 1; }
    else { assert.throws(() => canonical.canonicalizeRcv020Request({ ...request(i), token: `t-${i}` }), contract.Rcv020ValidationError); expectedInvalid += 1; }
  }
  assert.deepEqual({ valid, expectedInvalid }, { valid: 500, expectedInvalid: 500 });
});

test("RCV-020 semantic stress sizes 1/10/25/50/100 remain deterministic", () => {
  for (const size of [1, 10, 25, 50, 100]) for (let repetition = 0; repetition < 10; repetition += 1) {
    const captures = Array.from({ length: size }, (_, index) => capture(1000 + index, 2000 + index, 10, index + 1, String.fromCharCode(97 + (index % 6))));
    captures.forEach((item) => core.canonicalizeRcv020Capture(item));
    for (let index = 1; index < captures.length; index += 1) core.validateCaptureComparison({ comparisonId: id(3000 + index), currentCaptureId: captures[index].captureId, priorCaptureId: captures[index - 1].captureId, algorithmId: "raw-bytes", algorithmVersion: 1, result: "CHANGED" }, captures[index], captures[index - 1]);
    const stressOccurrence = occurrence("SCHEDULED", 10);
    stressOccurrence.evaluationCutoffAt = time(1000);
    const failedChain = Array.from({ length: size }, (_, index) => attempt(index + 1, 4000 + index, 10, index === 0 ? null : id(3999 + index), 3 + index * 3, 5 + index * 3));
    const failedResolutions = failedChain.map((item, index) => resolution(4000 + index, "FAILED", 4 + index * 3, "TIMEOUT"));
    core.validateAttemptSet(failedChain, new Map([[stressOccurrence.occurrenceId, stressOccurrence]]), new Map(failedResolutions.map((item) => [item.attemptId, item])));
    assert.equal(core.resolveOccurrenceTerminal(stressOccurrence, failedChain, failedResolutions, []), "FAILED");
    const lifecycleConfig = { ...config(), effectiveUntil: null };
    const lifecycleEvents = [{ eventId: id(5000), monitorConfigurationVersionId: id(3), eventType: "ACTIVATED", eventAt: time(0), eventSequence: "1", actorPolicyIdentity: "stress" }];
    for (let index = 1; index < size; index += 1) lifecycleEvents.push({ eventId: id(5000 + index), monitorConfigurationVersionId: id(3), eventType: index % 2 === 1 ? "PAUSED" : "RESUMED", eventAt: time(index), eventSequence: String(index + 1), actorPolicyIdentity: "stress" });
    core.deriveLifecycleState(lifecycleConfig, lifecycleEvents);
  }
});
