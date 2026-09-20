const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const c = require("../dist/services/rcv022Canonical");
const { canonicalizeJson } = require("../dist/services/canonicalJson");

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const h = (ch) => ch.repeat(64);
const base = {
  fragmentId: id(1), captureId: id(2), captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: h("a"), captureRepresentationHash: h("b"), fragmentKind: "TEXT", locator: { kind: "WHOLE_TEXT" }, contentBinding: { kind: "TEXT", utf8Text: "hello", contentHash: hash("hello") }, extractionAuthority: { kind: "DIRECT" },
};
const match = { matchId: id(3), claimId: id(4), claimCanonicalVersion: 1, claimCanonicalHash: h("d"), claimVersionId: id(5), claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: h("e"), evidenceFragmentId: id(1), evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: h("f"), matcherIdentity: "matcher", matcherVersion: "1", matcherHash: h("a"), matcherInputCanonicalHashes: [] };
const sampling = { schema: "factbase-rcv022-sampling-parameters", canonicalVersion: 1, entries: [{ name: "temperature", value: 0 }] };
const deterministic = { methodType: "DETERMINISTIC", methodIdentity: "rule", methodVersion: "1", methodHash: h("a"), inputCanonicalHashes: [], structuredOutputHash: h("b"), reviewStatus: "NOT_REVIEWED" };
const human = { methodType: "HUMAN", methodIdentity: "review", methodVersion: "1", methodHash: h("a"), reviewerIdentity: "person", reviewProcessIdentity: "process", reviewProcessVersion: "1", reviewProcessHash: h("b"), inputCanonicalHashes: [], structuredOutputHash: h("c"), reviewStatus: "REVIEWED" };
const model = { methodType: "MODEL_ASSISTED", methodIdentity: "model", methodVersion: "1", methodHash: h("a"), providerIdentity: "provider", modelIdentity: "model", modelVersion: "1", processIdentity: "process", processVersion: "1", processHash: h("b"), promptTemplateHash: h("c"), systemInstructionHash: h("d"), samplingParameters: sampling, samplingParametersHash: hash(canonicalizeJson(sampling)), inputCanonicalHashes: [], rawOutputHash: h("a"), structuredOutputHash: h("b"), retryIdentity: "retry", reviewStatus: "NOT_REVIEWED", toolParticipation: "NOT_USED" };
const mixed = { ...model, methodType: "MIXED", reviewerIdentity: "person", reviewProcessIdentity: "process", reviewProcessVersion: "1", reviewProcessHash: h("c"), acceptanceStatus: "ACCEPTED" };
const assessment = { assessmentId: id(6), claimEvidenceMatchId: id(3), claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: h("a"), claimId: id(4), claimCanonicalVersion: 1, claimCanonicalHash: h("d"), claimVersionId: id(5), claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: h("e"), evidenceFragmentId: id(1), evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: h("f"), assessmentResult: { relation: "SUPPORTS", rationale: "reason" }, methodProvenance: deterministic, assessedAt: "2026-01-01T00:00:00.123456Z" };
const envelope = { envelopeId: id(7), claimId: id(4), claimCanonicalVersion: 1, claimCanonicalHash: h("d"), claimVersionId: id(5), claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: h("e"), analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:00.123456Z", matchRefs: [], assessmentRefs: [], analysisMethodIdentity: "analysis", analysisMethodVersion: "1", analysisMethodHash: h("a") };

test("all four Wave B builders produce deterministic JCS and lowercase SHA-256", () => {
  const builders = [[c.buildEvidenceFragmentCanonical, base], [c.buildClaimEvidenceMatchCanonical, match], [c.buildEvidenceAssessmentCanonical, assessment], [c.buildSemanticAnalysisEnvelopeCanonical, envelope]];
  for (const [builder, input] of builders) {
    const first = builder(input); const reordered = Object.fromEntries(Object.entries(input).reverse()); const second = builder(reordered);
    assert.equal(first.canonical, second.canonical); assert.equal(first.hash, second.hash); assert.match(first.hash, /^[0-9a-f]{64}$/); assert.equal(first.hash, hash(first.canonical));
  }
});

test("builders enforce exact shape and toolParticipation conditional", () => {
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, extra: true }), /unexpected input key/);
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, locator: "wrong" }), /expected object/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: { ...model, toolParticipation: "USED" } }), /toolContextHash/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: { ...model, toolContextHash: h("v") } }), /toolContextHash/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: { ...human, toolContextHash: h("v") } }), /unexpected or missing key/);
  const used = c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: { ...model, toolParticipation: "USED", toolContextHash: h("a") } });
  assert.equal(used.value.methodProvenance.toolContextHash, h("a"));
  assert.equal(c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: human }).value.methodProvenance.methodType, "HUMAN");
  assert.equal(c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: mixed }).value.methodProvenance.methodType, "MIXED");
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: { ...mixed, acceptanceStatus: undefined } }), /acceptanceStatus/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: { ...mixed, toolParticipation: "USED" } }), /toolContextHash/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: { ...mixed, toolParticipation: "NOT_USED", toolContextHash: h("a") } }), /toolContextHash/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: { ...mixed, toolParticipation: "UNKNOWN" } }), /unsupported value/);
});

test("all four builders reject representative missing, null, wrong-type, version, hash, and tagged-shape inputs", () => {
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, locator: undefined }), /null\/undefined/);
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, canonicalVersion: 2 }), /canonicalVersion 1/);
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, captureCanonicalHash: h("A") }), /lowercase SHA-256/);
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, contentBinding: { kind: "TEXT", utf8Text: "hello", contentHash: hash("hello"), extra: true } }), /unexpected or missing key/);
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, locator: { kind: "UTF8_BYTE_RANGE", startByte: 0 } }), /unexpected or missing key/);
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, extractionAuthority: { kind: "DERIVED", extractorIdentity: "extractor", extractorVersion: "1" } }), /unexpected or missing key/);
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, locator: { kind: "UTF8_BYTE_RANGE", startByte: "0", endByteExclusive: 1 } }), /expected integer/);
  assert.throws(() => c.buildEvidenceFragmentCanonical({ ...base, fragmentKind: "STRUCTURED", locator: { kind: "WHOLE_TEXT" }, contentBinding: base.contentBinding }), /locator mismatch/);
  assert.throws(() => c.buildClaimEvidenceMatchCanonical({ ...match, matcherHash: undefined }), /null\/undefined/);
  assert.throws(() => c.buildClaimEvidenceMatchCanonical({ ...match, matcherInputCanonicalHashes: {} }), /expected array/);
  assert.throws(() => c.buildClaimEvidenceMatchCanonical({ ...match, matcherInputCanonicalHashes: [h("A")] }), /lowercase SHA-256/);
  assert.throws(() => c.buildClaimEvidenceMatchCanonical({ ...match, claimCanonicalVersion: 2 }), /canonicalVersion 1/);
  assert.throws(() => c.buildClaimEvidenceMatchCanonical({ ...match, extra: true }), /unexpected input key/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, assessmentResult: [] }), /expected object/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, assessmentResult: { relation: "UNKNOWN", rationale: "reason" } }), /unsupported/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, assessedAt: 1 }), /YYYY-MM-DD/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, methodProvenance: null }), /null\/undefined|expected object/);
  assert.throws(() => c.buildEvidenceAssessmentCanonical({ ...assessment, evidenceFragmentCanonicalHash: h("A") }), /lowercase SHA-256/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, analysisAt: undefined }), /null\/undefined/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, analysisMethodHash: h("A") }), /lowercase SHA-256/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: {} }), /expected array/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, assessmentRefs: [{ id: "not-a-uuid", canonicalVersion: 1, canonicalHash: h("a") }] }), /lowercase canonical UUID/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(3), canonicalVersion: 1, canonicalHash: null }] }), /null\/undefined/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(3), canonicalVersion: 1 }] }), /unexpected or missing key/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(3), canonicalVersion: 1, canonicalHash: h("a"), tag: "MATCH" }] }), /unexpected or missing key/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(3), canonicalVersion: 2, canonicalHash: h("a") }] }), /canonicalVersion 1/);
});

test("matcher input canonical hash arrays preserve semantic order", () => {
  const first = c.buildClaimEvidenceMatchCanonical({ ...match, matcherInputCanonicalHashes: [h("a"), h("b")] });
  const second = c.buildClaimEvidenceMatchCanonical({ ...match, matcherInputCanonicalHashes: [h("b"), h("a")] });
  assert.notEqual(first.canonical, second.canonical);
  assert.notEqual(first.hash, second.hash);
});

test("envelope zero-member and ordered unique reference rules are closed", () => {
  const valid = c.buildSemanticAnalysisEnvelopeCanonical(envelope); assert.deepEqual(valid.value.matchRefs, []);
  const ref = { id: id(3), canonicalVersion: 1, canonicalHash: h("a") };
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [], assessmentRefs: [ref] }), /zero Matches/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [ref, ref] }), /duplicate/);
});

test("envelope member order and member identity are canonical authority", () => {
  const first = c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(3), canonicalVersion: 1, canonicalHash: h("a") }, { id: id(4), canonicalVersion: 1, canonicalHash: h("b") }], assessmentRefs: [] });
  const reordered = c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(4), canonicalVersion: 1, canonicalHash: h("b") }, { id: id(3), canonicalVersion: 1, canonicalHash: h("a") }], assessmentRefs: [] });
  const changed = c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(3), canonicalVersion: 1, canonicalHash: h("c") }, { id: id(4), canonicalVersion: 1, canonicalHash: h("b") }], assessmentRefs: [] });
  assert.notEqual(first.canonical, reordered.canonical);
  assert.notEqual(first.hash, reordered.hash);
  assert.notEqual(first.canonical, changed.canonical);
  assert.notEqual(first.hash, changed.hash);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: null }), /null\/undefined|expected array/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(3), canonicalVersion: 1, canonicalHash: h("a"), extra: true }], assessmentRefs: [] }), /unexpected or missing key/);
  assert.throws(() => c.buildSemanticAnalysisEnvelopeCanonical({ ...envelope, matchRefs: [{ id: id(3), canonicalVersion: 2, canonicalHash: h("a") }], assessmentRefs: [] }), /canonicalVersion 1/);
});
