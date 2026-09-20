const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourcePath = path.join(__dirname, "..", "src/services/rcv022Reader.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const reader = require("../dist/services/rcv022Reader");

test("Wave C reader is an independent SELECT-only verifier", () => {
  assert.doesNotMatch(source, /rcv022Writer|persistRcv022|persistEvidence/);
  assert.doesNotMatch(source, /rcv022Canonical|buildEvidenceFragmentCanonical|buildClaimEvidenceMatchCanonical|buildEvidenceAssessmentCanonical|buildSemanticAnalysisEnvelopeCanonical/);
  assert.match(source, /authenticateIndependentCanonical/);
  assert.match(source, /validateFragmentShape/);
  assert.match(source, /validateMatchShape/);
  assert.match(source, /validateAssessmentShape/);
  assert.match(source, /validateEnvelopeShape/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE|DROP)\b/);
  assert.doesNotMatch(source, /SELECT\s+FOR\s+(?:UPDATE|SHARE)/i);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /to_char\([^\n]+AT TIME ZONE 'UTC'/);
  assert.doesNotMatch(source, /Date\.now|new Date|current_timestamp|\bnow\s*\(/i);
  assert.equal(typeof reader.verifyRcv022HistoricalEnvelope, "function");
  assert.equal(typeof reader.verifyRcv022HistoricalEnvelopeWithinTransaction, "function");
});

test("Wave C failure classification is stable and fail-closed", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => reader.verifyRcv022HistoricalEnvelopeWithinTransaction(client, "81000000-0000-4000-8000-000000000001"),
    (error) => error instanceof reader.Rcv022HistoricalVerificationError && error.code === "MISSING_AUTHORITY",
  );
});

test("Wave C public failure taxonomy includes frozen Contract classes", () => {
  for (const code of ["MISSING_AUTHORITY", "UNSUPPORTED_VERSION", "MALFORMED_DATA", "IDENTITY_MISMATCH", "LINEAGE_MISMATCH", "CANONICAL_MISMATCH", "HASH_MISMATCH", "INVALID_RELATION", "METHOD_AUTHORITY_MISMATCH", "REPAIR_ATTEMPT"]) {
    assert.ok(reader.RCV022_READER_FAILURE_CODES.includes(code), code);
  }
});

test("Wave C frozen failure precedence is independent of candidate discovery order", () => {
  const cases = [
    [[{ code: "LINEAGE_MISMATCH", path: "z.lineage", message: "lineage" }, { code: "MALFORMED_DATA", path: "a.shape", message: "shape" }], "MALFORMED_DATA"],
    [[{ code: "LINEAGE_MISMATCH", path: "z.lineage", message: "lineage" }, { code: "HASH_MISMATCH", path: "a.hash", message: "hash" }], "HASH_MISMATCH"],
    [[{ code: "METHOD_AUTHORITY_MISMATCH", path: "z.method", message: "method" }, { code: "LINEAGE_MISMATCH", path: "a.lineage", message: "lineage" }], "LINEAGE_MISMATCH"],
  ];
  for (const [candidates, expected] of cases) {
    const forward = reader.selectRcv022Failure(candidates);
    const reverse = reader.selectRcv022Failure([...candidates].reverse());
    assert.equal(forward.code, expected);
    assert.deepEqual(reverse, forward);
  }
});
