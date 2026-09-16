const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const canonical = require("../dist/services/rcv020Canonical");
const wave5 = require("../dist/services/rcv020Wave5Integration");

const hash = (value) => canonical.sha256Rcv020Text(value);
const request = { method: "GET", target: "https://example.test/items", parameters: { page: 1 }, credentialReference: null };

test("Wave 5 deterministic adapter binds to canonical request authority", async () => {
  const encoded = canonical.canonicalizeRcv020Request(request);
  const adapter = new wave5.Rcv020MapAdapter(new Map([[encoded.hash, { outcome: "FAILED", completedAt: "2026-01-01T00:00:03.000000Z", failureCode: "TIMEOUT" }]]));
  const result = await adapter.retrieve({ occurrenceId: "00000000-0000-4000-8000-000000000004", attemptId: "00000000-0000-4000-8000-000000000005", request, requestCanonical: encoded.canonical, requestHash: encoded.hash, attemptDeadlineAt: "2026-01-01T00:00:10.000000Z" });
  assert.deepEqual(result, { outcome: "FAILED", completedAt: "2026-01-01T00:00:03.000000Z", failureCode: "TIMEOUT" });
  await assert.rejects(() => new wave5.Rcv020MapAdapter({}).retrieve({ occurrenceId: "00000000-0000-4000-8000-000000000004", attemptId: "00000000-0000-4000-8000-000000000005", request, requestCanonical: encoded.canonical, requestHash: encoded.hash, attemptDeadlineAt: "2026-01-01T00:00:10.000000Z" }), /response missing/);
});

test("Wave 5 scheduled coverage is derived from occurrence authority only", () => {
  const occurrences = [
    { occurrenceId: "00000000-0000-4000-8000-000000000001", triggerOrigin: "SCHEDULED" },
    { occurrenceId: "00000000-0000-4000-8000-000000000002", triggerOrigin: "SCHEDULED" },
    { occurrenceId: "00000000-0000-4000-8000-000000000003", triggerOrigin: "SCHEDULED" },
    { occurrenceId: "00000000-0000-4000-8000-000000000004", triggerOrigin: "EXTERNAL" },
  ];
  const coverage = wave5.deriveRcv020ScheduledCoverage(occurrences,
    [{ occurrenceId: occurrences[0].occurrenceId, outcome: "SUCCEEDED" }, { occurrenceId: occurrences[1].occurrenceId, outcome: "SKIPPED" }, { occurrenceId: occurrences[2].occurrenceId, outcome: "MISSED" }],
    [occurrences[0].occurrenceId]);
  assert.deepEqual(coverage, { expected: 3, attempted: 1, succeeded: 1, failed: 0, missed: 1, skipped: 1 });
});

test("Wave 5 does not treat equivalent bytes as the same Capture identity", () => {
  const bytes = Buffer.from("same bytes");
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(contentHash, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.notEqual("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011");
  assert.equal(hash("{}"), hash("{}"));
});
