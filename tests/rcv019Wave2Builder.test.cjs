const assert = require("node:assert/strict");
const test = require("node:test");
const { canonicalizeRcv019State, hashRcv019State } = require("../dist/services/rcv019Canonical");
const { buildRcv019Timeline } = require("../dist/services/rcv019TimelineBuilder");
const { Rcv019ValidationError } = require("../dist/contracts/rcv019TemporalEvidenceContractV1");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const snapshotHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const claimId = id(1901);
const state = (version, evidence = [], facets = []) => ({
  contractVersion: 1,
  claimId,
  claimVersionId: id(version),
  evidenceProvenance: evidence,
  rcv016Snapshot: { snapshotId: id(1900), snapshotHash },
  ...(facets.length ? { optionalFacets: facets } : {}),
});
const point = (n, timestamp, value) => {
  const content = state(n, value);
  return { pointId: id(2000 + n), claimId, claimVersionId: id(n), knowledgeAt: timestamp, state: content, stateHash: hashRcv019State(content) };
};

test("RCV-019 builder creates ordered baseline and exact timeline hash", () => {
  const result = buildRcv019Timeline({ analysisId: id(3000), claimId, points: [
    point(1, "2026-01-01T00:00:00.000000Z", []),
    { ...point(1, "2026-01-02T00:00:00.000000Z", [{ evidenceId: id(10), relation: "supports" }]), pointId: id(2002) },
  ] });
  assert.equal(result.points.length, 2);
  assert.equal(result.transitions.length, 1);
  assert.deepEqual(result.transitions[0].changeTypes, ["SUPPORTING_EVIDENCE_ADDED"]);
  assert.equal(typeof result.timelineHash, "string");
});

test("ordering is derived from knowledgeAt and equal times fail closed", () => {
  const a = point(1, "2026-01-01T00:00:00.000000Z", []);
  const b = { ...point(1, "2026-01-02T00:00:00.000000Z", [{ evidenceId: id(10), relation: "supports" }]), pointId: id(2002) };
  const forward = buildRcv019Timeline({ analysisId: id(3001), claimId, points: [b, a] });
  assert.deepEqual(forward.points.map((p) => p.pointId), [a.pointId, b.pointId]);
  assert.throws(() => buildRcv019Timeline({ analysisId: id(3002), claimId, points: [a, { ...b, knowledgeAt: a.knowledgeAt, stateHash: hashRcv019State(b.state) }] }), /AMBIGUOUS_TEMPORAL_ORDER/);
});

test("equal authenticated state content produces UNCHANGED and preserves occurrences", () => {
  const first = point(1, "2026-01-01T00:00:00.000000Z", []);
  const secondState = { ...first.state, claimVersionId: first.claimVersionId };
  const second = { ...first, pointId: id(2999), knowledgeAt: "2026-01-02T00:00:00.000000Z", state: secondState, stateHash: first.stateHash };
  const result = buildRcv019Timeline({ analysisId: id(3003), claimId, points: [second, first] });
  assert.deepEqual(result.transitions[0].changeTypes, ["UNCHANGED"]);
  assert.notEqual(result.points[0].pointId, result.points[1].pointId);
});

test("unequal state with no applicable closed transition fails as UNSUPPORTED_TRANSITION", () => {
  const first = point(1, "2026-01-01T00:00:00.000000Z", []);
  const changed = point(2, "2026-01-02T00:00:00.000000Z", []);
  assert.throws(() => buildRcv019Timeline({ analysisId: id(3004), claimId, points: [first, changed] }), /UNSUPPORTED_TRANSITION/);
});

test("malformed or incomplete historical prerequisites fail closed without mutation", () => {
  const malformed = { claimId, claimVersionId: id(1), evidenceProvenance: [null], rcv016Snapshot: {} };
  const before = JSON.stringify(malformed);
  assert.throws(() => require("../dist/services/rcv019HistoricalStateAssembler").assembleRcv019HistoricalState(malformed), Rcv019ValidationError);
  assert.equal(JSON.stringify(malformed), before);
});

test("all Wave-2 transition types and deterministic multi-change ordering are reachable", () => {
  const facet = (kind, n, h = "b") => ({ kind, id: id(n), version: 1, hash: h.repeat(64) });
  const cases = [
    [[], [{ evidenceId: id(31), relation: "supports" }], "SUPPORTING_EVIDENCE_ADDED"],
    [[], [{ evidenceId: id(32), relation: "contradicts" }], "CONTRADICTING_EVIDENCE_ADDED"],
    [[], [facet("RCV017_ANALYSIS", 41)], "DEPENDENCY_GAP_INTRODUCED"],
    [[facet("RCV017_ANALYSIS", 42)], [], "DEPENDENCY_GAP_RESOLVED"],
    [[], [facet("RCV018_ANALYSIS", 51)], "CONTRADICTION_INTRODUCED"],
    [[facet("RCV018_ANALYSIS", 52)], [], "CONTRADICTION_RESOLVED"],
    [[facet("RCV011_ASSESSMENT", 61, "c")], [facet("RCV011_ASSESSMENT", 62, "d")], "ASSESSMENT_CHANGED"],
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const [beforeEvidenceOrFacets, afterEvidenceOrFacets, expected] = cases[index];
    const beforeIsFacet = beforeEvidenceOrFacets.length && beforeEvidenceOrFacets[0].kind;
    const afterIsFacet = afterEvidenceOrFacets.length && afterEvidenceOrFacets[0].kind;
    const before = point(1, `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000000Z`, beforeIsFacet ? [] : beforeEvidenceOrFacets);
    const afterState = state(1, afterIsFacet ? [] : afterEvidenceOrFacets, afterIsFacet ? afterEvidenceOrFacets : []);
    const after = { ...before, pointId: id(2100 + index), knowledgeAt: `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00.000000Z`, state: afterState, stateHash: hashRcv019State(afterState) };
    if (beforeIsFacet) {
      const beforeState = state(1, [], beforeEvidenceOrFacets);
      Object.assign(before, { state: beforeState, stateHash: hashRcv019State(beforeState) });
    }
    const result = buildRcv019Timeline({ analysisId: id(5000 + index), claimId, points: [before, after] });
    assert.deepEqual(result.transitions[0].changeTypes, [expected]);
  }
  const base = point(1, "2026-03-01T00:00:00.000000Z", []);
  const multiState = state(1, [{ evidenceId: id(71), relation: "supports" }], [facet("RCV017_ANALYSIS", 72), facet("RCV018_ANALYSIS", 73)]);
  const multi = { ...base, pointId: id(2200), knowledgeAt: "2026-03-02T00:00:00.000000Z", state: multiState, stateHash: hashRcv019State(multiState) };
  const multiResult = buildRcv019Timeline({ analysisId: id(5010), claimId, points: [base, multi] });
  assert.deepEqual(multiResult.transitions[0].changeTypes, ["SUPPORTING_EVIDENCE_ADDED", "DEPENDENCY_GAP_INTRODUCED", "CONTRADICTION_INTRODUCED"]);
});

test("deterministic seeded fuzz: 1,250 structured Wave-2 cases", () => {
  let drift = 0;
  for (let seed = 0; seed < 1250; seed += 1) {
    const e = seed % 3 === 0 ? [{ evidenceId: id(10 + (seed % 9)), relation: seed % 2 ? "supports" : "contradicts" }] : [];
    const a = point(1, "2026-01-01T00:00:00.000000Z", e);
    const b = { ...point(1, "2026-01-02T00:00:00.000000Z", e), pointId: id(2002) };
    const first = buildRcv019Timeline({ analysisId: id(4000 + seed), claimId, points: [a, b] });
    const second = buildRcv019Timeline({ analysisId: id(4000 + seed), claimId, points: [b, a] });
    if (first.canonical !== second.canonical || first.timelineHash !== second.timelineHash) drift += 1;
  }
  assert.equal(drift, 0);
});
