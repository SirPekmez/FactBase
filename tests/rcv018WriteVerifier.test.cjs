const assert = require("node:assert/strict");
const test = require("node:test");
const canon = require("../dist/services/rcv018Canonical");
const { buildRcv018Analysis } = require("../dist/services/rcv018AnalysisBuilder");
const { verifyRcv018Write, Rcv018WriteVerificationError } = require("../dist/services/rcv018WriteVerifier");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const hash = (c) => String(c).repeat(64).slice(0, 64);
const auth = (value) => { const e = canon.canonicalizeRcv018(value); return { value, canonical: e.canonical, hash: e.hash }; };
const binding = { contractId: "factbase-rcv018-contract", contractVersion: 1, contractHash: hash("c") };
const algorithm = { algorithmId: "factbase-rcv018-builder", algorithmVersion: 1, algorithmHash: hash("d") };
const domain = auth({ valueDomainId: id(1), valueDomainVersion: 1, kind: "CLOSED_SYMBOLIC_STATE", allowedValues: ["A", "B"] });
const comparison = auth({ comparisonDomainId: id(2), comparisonDomainVersion: 1, propertyId: id(3), valueDomainId: id(1), valueDomainVersion: 1, valueDomainHash: domain.hash, comparisonKeySchema: [], ruleFamily: "EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR", incompatibilityPairs: [["A", "B"]] });
function assertion(n, value = "A", kind = "ArtifactProvenanceStatement") {
  return auth({ assertionId: id(n), subjectId: id(10), propertyId: id(3), comparisonDomainId: id(2), comparisonDomainVersion: 1, comparisonDomainHash: comparison.hash, valueDomainId: id(1), valueDomainVersion: 1, valueDomainHash: domain.hash, value, comparisonContext: [], evidenceBasis: [{ evidenceRelationId: id(100 + n), evidenceId: id(200 + n), artifactVersionId: id(300 + n), statementKind: kind, statementId: id(999) }], historicalBindings: [{ kind: "STATEMENT", statementKind: kind, statementId: id(999) }] });
}
function makeInput(assertions = [assertion(1, "A"), assertion(2, "B")]) { return { analysisId: id(500), assertions, valueDomains: [domain], comparisonDomains: [comparison], contractBinding: binding, algorithmBinding: algorithm }; }
function verified(assertions) { const builderInput = makeInput(assertions); return { builderInput, builderResult: buildRcv018Analysis(builderInput), existingFindings: [] }; }

test("authenticates a complete Builder result and emits exact new/existing projection", () => {
  const input = verified(); const result = verifyRcv018Write(input);
  assert.equal(result.findingsToInsert.length, 1); assert.equal(result.existingFindings.length, 0);
  const reused = { ...input, existingFindings: [auth(result.findingsToInsert[0])] };
  const reusedResult = verifyRcv018Write(reused);
  assert.equal(reusedResult.findingsToInsert.length, 0); assert.equal(reusedResult.existingFindings.length, 1);
});

test("rejects tampered analysis, pair, finding, and existing-finding projections", () => {
  const input = verified();
  assert.throws(() => verifyRcv018Write({ ...input, builderResult: { ...input.builderResult, hash: hash("a") } }), (e) => e instanceof Rcv018WriteVerificationError && e.code === "hash_mismatch");
  assert.throws(() => verifyRcv018Write({ ...input, builderResult: { ...input.builderResult, pairEvaluations: [] } }), (e) => e instanceof Rcv018WriteVerificationError && e.code === "pair_completeness_mismatch");
  const finding = input.builderResult.findings[0];
  assert.throws(() => verifyRcv018Write({ ...input, existingFindings: [auth({ ...finding, assertionAId: id(9) })] }), Rcv018WriteVerificationError);
  assert.throws(() => verifyRcv018Write({ ...input, existingFindings: [auth({ ...finding, assertionAId: id(9) })] }), Rcv018WriteVerificationError);
});

test("C1 typed identities remain distinct and verification is deterministic/non-mutating", () => {
  const a = assertion(1, "A", "ArtifactProvenanceStatement"); const b = assertion(2, "B", "KnowledgeStateStatement");
  const input = verified([a, b]); const before = JSON.stringify(input);
  const one = verifyRcv018Write(input); const two = verifyRcv018Write(input);
  assert.equal(one.analysisHash, two.analysisHash); assert.equal(one.analysisCanonical, two.analysisCanonical); assert.equal(JSON.stringify(input), before);
  assert.notEqual(a.value.evidenceBasis[0].statementKind, b.value.evidenceBasis[0].statementKind);
});
