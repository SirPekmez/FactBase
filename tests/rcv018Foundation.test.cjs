const assert = require("node:assert/strict");
const test = require("node:test");

const c = require("../dist/contracts/rcv018EvidenceContradictionContractV1");
const canonical = require("../dist/services/rcv018Canonical");

const uuid = "00000000-0000-0000-0000-000000000001";
const hash = "a".repeat(64);

test("RCV-018 primitive validators are exact and default-deny", () => {
  assert.equal(c.validateVersionV1(1), 1);
  assert.equal(c.validateVersionV1(9007199254740991), 9007199254740991);
  assert.throws(() => c.validateVersionV1(0));
  assert.throws(() => c.validateVersionV1(9007199254740992));
  assert.equal(c.validateSha256HexV1(hash), hash);
  assert.throws(() => c.validateSha256HexV1(hash.toUpperCase()));
  assert.throws(() => c.validateSha256HexV1("a".repeat(63)));
  assert.throws(() => c.validateSha256HexV1("a".repeat(65)));
  assert.equal(c.validateTokenV1("A._:-9"), "A._:-9");
  assert.throws(() => c.validateTokenV1(""));
  assert.throws(() => c.validateTokenV1("bad value"));
  assert.throws(() => c.validateTokenV1("ä"));
  assert.throws(() => c.validateTokenV1("a".repeat(129)));
});

test("C1 StatementRefV1 uses exactly the five closed kinds", () => {
  for (const statementKind of c.RCV018_STATEMENT_KINDS) {
    assert.deepEqual(c.validateStatementRefV1({ statementKind, statementId: uuid }), { statementKind, statementId: uuid });
  }
  assert.throws(() => c.validateStatementRefV1({ statementKind: "UNKNOWN", statementId: uuid }));
  assert.throws(() => c.validateStatementRefV1({ statementKind: c.RCV018_STATEMENT_KINDS[0], statementId: uuid.replace("1", "a").toUpperCase() }));
  assert.throws(() => c.validateStatementRefV1({ statementKind: c.RCV018_STATEMENT_KINDS[0], statementId: uuid, version: 1 }));
});

test("AssertionContextV1 accepts only exact UUID or TOKEN variants", () => {
  assert.deepEqual(c.validateAssertionContextEntryV1({ key: "k", type: "UUID", uuidValue: uuid }), { key: "k", type: "UUID", uuidValue: uuid });
  assert.deepEqual(c.validateAssertionContextEntryV1({ key: "k", type: "TOKEN", tokenValue: "v" }), { key: "k", type: "TOKEN", tokenValue: "v" });
  for (const value of [
    { key: "k", type: "UUID" },
    { key: "k", type: "UUID", tokenValue: "v" },
    { key: "k", type: "UUID", uuidValue: uuid, tokenValue: "v" },
    { key: "k", type: "TOKEN", uuidValue: uuid },
    { key: "k", type: "TOKEN", tokenValue: "bad value" },
    { key: "k", type: "OTHER", tokenValue: "v" },
  ]) assert.throws(() => c.validateAssertionContextEntryV1(value));
});

test("HistoricalBindingV1 validates all five closed variants and rejects mixed shapes", () => {
  const values = [
    { kind: "CLAIM_VERSION", claimVersionId: uuid },
    { kind: "STATEMENT", statementKind: "KnowledgeStateStatement", statementId: uuid },
    { kind: "ARTIFACT_VERSION", artifactVersionId: uuid },
    { kind: "RCV016_SNAPSHOT", snapshotId: uuid, snapshotHash: hash },
    { kind: "RCV017_ANALYSIS", analysisId: uuid, analysisHash: hash },
  ];
  for (const value of values) assert.doesNotThrow(() => c.validateHistoricalBindingV1(value));
  assert.throws(() => c.validateHistoricalBindingV1({ kind: "STATEMENT", statementId: uuid }));
  assert.throws(() => c.validateHistoricalBindingV1({ kind: "CLAIM_VERSION", claimVersionId: uuid, statementId: uuid }));
  assert.throws(() => c.validateHistoricalBindingV1({ kind: "NOPE", claimVersionId: uuid }));
});

test("JCS canonicalization and SHA-256 are deterministic and key-order independent", () => {
  const left = { b: 2, a: 1 };
  const right = { a: 1, b: 2 };
  const first = canonical.canonicalizeRcv018(left);
  const second = canonical.canonicalizeRcv018(right);
  assert.equal(first.canonical, '{"a":1,"b":2}');
  assert.equal(first.canonical, second.canonical);
  assert.equal(first.hash, "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
  assert.equal(canonical.sha256Rcv018Text(first.canonical), first.hash);
  assert.equal(canonical.assertRcv018TextHash(first.canonical, first.hash), first.hash);
  assert.equal(canonical.canonicalizeRcv018(left).hash, canonical.canonicalizeRcv018(left).hash);
});
