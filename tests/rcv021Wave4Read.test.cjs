const assert = require("node:assert/strict");
const test = require("node:test");
const c = require("../dist/services/rcv021Canonical");
const core = require("../dist/services/rcv021SemanticCore");
const verifier = require("../dist/services/rcv021ReadVerifier");

const id = (n) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = (n) => `2026-01-01T00:00:${String(n).padStart(2, "0")}.000000Z`;
const fields = (value) => { const x = c.canonicalizeRcv021Authority(value); return { canonicalVersion: 1, canonical: x.canonical, canonicalHash: x.hash }; };
function graph() {
  const operationId = id(1);
  const subject = { ...fields({ subjectBindingId: id(2), operationId, subjectType: "AUTHENTICATED_OPERATOR_REQUEST", captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: id(3), historicalClaimId: null }), subjectBindingId: id(2), operationId, subjectType: "AUTHENTICATED_OPERATOR_REQUEST", captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: id(3), historicalClaimId: null };
  const trigger = { ...fields({ triggerBindingId: id(4), operationId, triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: time(1), executionOwner: "owner", executionContext: null, triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null }), triggerBindingId: id(4), operationId, triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: time(1), executionOwner: "owner", executionContext: null, triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null };
  const operation = { ...fields({ operationId, subjectBindingId: id(2), triggerBindingId: id(4), purpose: "research", scopeCanonical: "{}", operationCreatedAt: time(1) }), operationId, subjectBindingId: id(2), triggerBindingId: id(4), purpose: "research", scopeCanonical: "{}", operationCreatedAt: time(1) };
  const run = { ...fields({ runId: id(5), operationId, strategyIdentity: "strategy", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}", runCreatedAt: time(2), deadlineAt: time(40), predecessorRunId: null }), runId: id(5), operationId, strategyIdentity: "strategy", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}", runCreatedAt: time(2), deadlineAt: time(40), predecessorRunId: null };
  const result = { ...fields({ resultId: id(6), runId: run.runId, providerItemIdentity: "item", providerEnvelopeCanonical: "{}", providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", resultObservedAt: time(3), providerSourceTime: null, protocolResultStatus: "returned" }), resultId: id(6), runId: run.runId, providerItemIdentity: "item", providerEnvelopeCanonical: "{}", providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", resultObservedAt: time(3), providerSourceTime: null, protocolResultStatus: "returned" };
  const selection = { ...fields({ selectionId: id(7), providerResultId: result.resultId, selectionAuthorization: "operator", selectedArtifactIdentity: "artifact", observationOccurrenceId: id(8), selectedAt: time(4) }), selectionId: id(7), providerResultId: result.resultId, selectionAuthorization: "operator", selectedArtifactIdentity: "artifact", observationOccurrenceId: id(8), selectedAt: time(4) };
  return { operation, subject, trigger, operationLifecycleEvents: [], runs: [run], runLifecycleEvents: [], terminalResolutions: [], attempts: [], attemptResolutions: [], providerResults: [result], resultSelections: [selection], rcv020Occurrences: [] };
}

test("Wave-4 verifier accepts deterministic T1 history and preserves BigInt text", () => {
  const input = graph(); const verified = verifier.verifyRcv021HistoricalGraph(input); assert.equal(verified.verified, true); assert.equal(verified.replayable, false);
  assert.equal(c.validateRcv021BigInt("9007199254740993").toString(), "9007199254740993");
  assert.deepEqual(verifier.verifyRcv021HistoricalGraph(input), verifier.verifyRcv021HistoricalGraph(input));
});

test("Wave-4 verifier rejects corruption without repair", () => {
  const input = graph(); const before = JSON.stringify(input); const corrupted = { ...input, operation: { ...input.operation, canonicalHash: "0".repeat(64) } };
  assert.throws(() => verifier.verifyRcv021HistoricalGraph(corrupted), /HASH_MISMATCH|CANONICAL_MISMATCH/); assert.equal(JSON.stringify(input), before);
});

test("terminal manifest is independently deterministic", () => {
  const input = graph(); const results = input.providerResults; const manifest = core.deriveTerminalManifest(results.slice().reverse()); assert.equal(manifest.count, "1"); assert.match(manifest.canonical, /resultId/); assert.equal(manifest.hash.length, 64);
});
