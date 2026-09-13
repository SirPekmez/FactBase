const assert = require("node:assert/strict");
const test = require("node:test");

const canonical = require("../dist/services/rcv019Canonical");
const contract = require("../dist/contracts/rcv019TemporalEvidenceContractV1");

const id = "00000000-0000-0000-0000-000000000001";
const versionId = "00000000-0000-0000-0000-000000000002";
const snapshotId = "00000000-0000-0000-0000-000000000003";
const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function state(extra = {}) {
  return {
    contractVersion: 1,
    claimId: id,
    claimVersionId: versionId,
    evidenceProvenance: [{ evidenceId: id, relation: "supports" }],
    rcv016Snapshot: { snapshotId, snapshotHash: hash },
    ...extra,
  };
}

test("RCV-019 state canonical/hash excludes occurrence metadata", () => {
  const first = canonical.canonicalizeRcv019State(state());
  const second = canonical.canonicalizeRcv019State(state({ pointId: id, knowledgeAt: "2026-01-02T03:04:05.000000Z" }));
  assert.deepEqual(first, second);
  assert.equal(first.canonical.includes("pointId"), false);
  assert.equal(first.canonical.includes("knowledgeAt"), false);
});

test("RCV-019 canonicalization is insertion-order neutral and versions participate", () => {
  const first = canonical.canonicalizeRcv019State(state());
  const reordered = canonical.canonicalizeRcv019State({ ...state(), rcv016Snapshot: { snapshotHash: hash, snapshotId } });
  assert.deepEqual(first, reordered);
  assert.throws(() => canonical.canonicalizeRcv019State(state({ contractVersion: 2 })), contract.Rcv019ValidationError);
});

test("RCV-019 knowledgeAt round-trips exactly and rejects malformed values", () => {
  const value = "2026-01-02T03:04:05.000000Z";
  assert.equal(canonical.canonicalizeRcv019KnowledgeAt(value), value);
  for (const invalid of ["2026-01-02T03:04:05Z", "2026-01-02T03:04:05.000Z", "not-a-time", null]) {
    assert.throws(() => canonical.canonicalizeRcv019KnowledgeAt(invalid), contract.Rcv019ValidationError);
  }
});

test("RCV-019 transition vocabulary is closed, unique, and ordered", () => {
  assert.deepEqual(canonical.canonicalizeRcv019TransitionTypes(["SUPPORTING_EVIDENCE_ADDED", "UNCHANGED"]), ["SUPPORTING_EVIDENCE_ADDED", "UNCHANGED"]);
  assert.throws(() => canonical.canonicalizeRcv019TransitionTypes(["UNCHANGED", "SUPPORTING_EVIDENCE_ADDED"]), contract.Rcv019ValidationError);
  assert.throws(() => canonical.canonicalizeRcv019TransitionTypes(["UNCHANGED", "UNCHANGED"]), contract.Rcv019ValidationError);
});
