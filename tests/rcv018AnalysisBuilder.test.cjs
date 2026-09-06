const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require("../dist/contracts/rcv018EvidenceContradictionContractV1");
const canon = require("../dist/services/rcv018Canonical");
const { buildRcv018Analysis, Rcv018BuilderError } = require("../dist/services/rcv018AnalysisBuilder");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const hash = (n) => String(n).repeat(64).slice(0, 64);
const domain = {
  valueDomainId: id(1), valueDomainVersion: 1, kind: "CLOSED_SYMBOLIC_STATE", allowedValues: ["A", "B"],
};
const comparison = {
  comparisonDomainId: id(2), comparisonDomainVersion: 1, propertyId: id(3), valueDomainId: id(1), valueDomainVersion: 1,
  valueDomainHash: "", comparisonKeySchema: [], ruleFamily: "EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR", incompatibilityPairs: [["A", "B"]],
};
const binding = { contractId: "factbase-rcv018-contract", contractVersion: 1, contractHash: hash("c") };
const algorithm = { algorithmId: "factbase-rcv018-builder", algorithmVersion: 1, algorithmHash: hash("d") };

function authenticated(value) {
  const encoded = canon.canonicalizeRcv018(value);
  return { value, canonical: encoded.canonical, hash: encoded.hash };
}
const domainInput = authenticated(domain);
comparison.valueDomainHash = domainInput.hash;
const comparisonInput = authenticated(comparison);

function assertion(number, value = "A", statementKind = "ArtifactProvenanceStatement") {
  const semantic = {
    assertionId: id(number), subjectId: id(10), propertyId: id(3), comparisonDomainId: id(2), comparisonDomainVersion: 1,
    comparisonDomainHash: comparisonInput.hash, valueDomainId: id(1), valueDomainVersion: 1, valueDomainHash: domainInput.hash,
    value, comparisonContext: [], evidenceBasis: [{ evidenceRelationId: id(100 + number), evidenceId: id(200 + number), artifactVersionId: id(300 + number), statementKind, statementId: id(999) }],
    historicalBindings: [{ kind: "STATEMENT", statementKind, statementId: id(999) }],
  };
  return authenticated(semantic);
}
function input(assertions, overrides = {}) {
  return { analysisId: id(500), assertions, valueDomains: [domainInput], comparisonDomains: [comparisonInput], contractBinding: binding, algorithmBinding: algorithm, ...overrides };
}

test("complete pair enumeration handles N=0, 1, 2, and 3", () => {
  const empty = buildRcv018Analysis({ analysisId: id(500), assertions: [], valueDomains: [], comparisonDomains: [], contractBinding: binding, algorithmBinding: algorithm });
  assert.equal(empty.pairEvaluations.length, 0);
  const one = buildRcv018Analysis(input([assertion(1)]));
  assert.equal(one.pairEvaluations.length, 0);
  const two = buildRcv018Analysis(input([assertion(1, "A"), assertion(2, "B")]));
  assert.equal(two.pairEvaluations.length, 1);
  assert.equal(two.findings.length, 1);
  const three = buildRcv018Analysis(input([assertion(1, "A"), assertion(2, "B"), assertion(3, "A")]));
  assert.equal(three.pairEvaluations.length, 3);
  assert.equal(three.findings.length, 2);
});

test("Builder output is deterministic under input permutation and preserves typed statement identity", () => {
  const a = assertion(1, "A", "ArtifactProvenanceStatement");
  const b = assertion(2, "B", "KnowledgeStateStatement");
  const first = buildRcv018Analysis(input([a, b]));
  const second = buildRcv018Analysis(input([b, a]));
  assert.equal(first.canonical, second.canonical);
  assert.equal(first.hash, second.hash);
  assert.equal(first.findings[0].assertionAId, id(1));
  assert.equal(Object.isFrozen(first.analysis), true);
  assert.equal(a.value.evidenceBasis[0].statementKind, "ArtifactProvenanceStatement");
  assert.equal(b.value.historicalBindings[0].statementKind, "KnowledgeStateStatement");
});

test("Builder rejects duplicate, missing, drifted, and malformed inputs", () => {
  assert.throws(() => buildRcv018Analysis(input([assertion(1), assertion(1, "B")])), (e) => e instanceof Rcv018BuilderError && e.code === "duplicate_assertion_membership");
  assert.throws(() => buildRcv018Analysis(input([assertion(1)], { valueDomains: [] })), (e) => e instanceof Rcv018BuilderError && e.code === "missing_value_domain");
  const drift = { ...assertion(1), value: { value: "A" } };
  assert.throws(() => buildRcv018Analysis(input([drift])), Rcv018BuilderError);
  assert.throws(() => buildRcv018Analysis(input([assertion(1)], { comparisonDomains: [] })), Rcv018BuilderError);
  assert.throws(() => buildRcv018Analysis(input([assertion(1)], { comparisonDomains: [{ ...comparisonInput, value: { ...comparisonInput.value, ruleFamily: "OTHER" } }] })), Rcv018BuilderError);
  assert.throws(() => buildRcv018Analysis(input([{ ...assertion(1), value: { ...assertion(1).value, historicalBindings: [{ kind: "STATEMENT", statementId: id(999) }] } }])), Rcv018BuilderError);
  assert.throws(() => buildRcv018Analysis(input([{ ...assertion(1), value: { ...assertion(1).value, comparisonContext: [{ key: "x", type: "UUID" }] } }])), Rcv018BuilderError);
});

test("Builder does not persist negative outcomes or mutate caller input", () => {
  const a = assertion(1, "A"); const b = assertion(2, "A");
  const before = JSON.stringify([a, b]);
  const result = buildRcv018Analysis(input([a, b]));
  assert.equal(result.findings.length, 0);
  assert.equal(result.pairEvaluations[0].outcome, "COMPARABLE");
  assert.equal(JSON.stringify([a, b]), before);
});
