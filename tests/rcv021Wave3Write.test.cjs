const assert = require("node:assert/strict");
const test = require("node:test");
const canonical = require("../dist/services/rcv021Canonical");
const verifier = require("../dist/services/rcv021WriteVerifier");
const repo = require("../dist/services/rcv021PostgresRepository");
const adapter = require("../dist/services/rcv021BindingAdapter");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000000Z`;
const fields = (value) => { const c = canonical.canonicalizeRcv021Authority(value); return { canonicalVersion: 1, canonical: c.canonical, canonicalHash: c.hash }; };
function result(n = 1) { const value = { resultId: id(n), runId: id(10), providerItemIdentity: `item-${n}`, providerEnvelopeCanonical: "{}", providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", resultObservedAt: time(2), providerSourceTime: null, protocolResultStatus: "returned" }; return { ...value, ...fields(value) }; }
function selection(n = 1, resultId = id(1)) { const value = { selectionId: id(50 + n), providerResultId: resultId, selectionAuthorization: "operator", selectedArtifactIdentity: `artifact-${n}`, observationOccurrenceId: id(100 + n), selectedAt: time(3) }; return { ...value, ...fields(value) }; }

class FakeClient {
  constructor(failOn = null) { this.sql = []; this.failOn = failOn; }
  async query(text, values = []) { this.sql.push({ text, values }); if (this.failOn && text.includes(this.failOn)) throw new Error("injected failure"); if (text.startsWith("INSERT")) return { rows: [{ ok: true }] }; return { rows: [] }; }
}

test("T0 ProviderResult persists independently and T1 selection is valid without local result rows", () => {
  assert.doesNotThrow(() => verifier.verifyRcv021Write({ providerResults: [result()] }));
  assert.doesNotThrow(() => verifier.verifyRcv021Write({ resultSelections: [selection()] }));
});

test("write verification rejects divergent canonical/hash before persistence", () => {
  assert.throws(() => verifier.verifyRcv021Write({ providerResults: [{ ...result(), canonicalHash: "a".repeat(64), canonical: "{}" }] }), /HASH_MISMATCH|CANONICAL_MISMATCH/);
});

test("repository uses one parameterized transaction and exact immutable fields", async () => {
  const client = new FakeClient(); await repo.persistRcv021Bundle(client, { providerResults: [result()] });
  assert.equal(client.sql[0].text, "BEGIN"); const insert = client.sql.find((entry) => /INSERT INTO public\.research_provider_results/.test(entry.text)); assert.ok(insert); assert.ok(insert.text.includes("$1")); assert.equal(client.sql.at(-1).text, "COMMIT");
});

test("transaction-neutral primitive uses caller transaction without owning it", async () => {
  const client = new FakeClient();
  let released = 0; client.release = () => { released += 1; };
  const authenticated = verifier.verifyRcv021Write({ providerResults: [result()] });
  await repo.persistRcv021BundleWithinTransaction(client, authenticated);
  assert.equal(client.sql.some((entry) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(entry.text)), false);
  assert.equal(released, 0);
});

test("repository rolls back on mutation failure and never reports success", async () => {
  const client = new FakeClient("research_provider_results"); await assert.rejects(() => repo.persistRcv021Bundle(client, { providerResults: [result()] }), /injected failure/); assert.equal(client.sql.at(-1).text, "ROLLBACK");
});

test("same identity conflict behavior is deterministic and no last-write-wins", () => {
  const core = require("../dist/services/rcv021SemanticCore");
  assert.equal(core.compareRcv021Identity(id(1), "x", id(1), "x"), "IDEMPOTENT"); assert.equal(core.compareRcv021Identity(id(1), "x", id(1), "y"), "CONFLICT"); assert.equal(core.compareRcv021Identity(id(1), "x", id(2), "x"), "DISTINCT");
});

test("T2 adapter fails closed when intended occurrence identity is absent", async () => {
  await assert.rejects(() => adapter.bindRcv021SelectionToRcv020(new FakeClient(), selection(), { contractVersion: 1, occurrences: [] }), /RCV020_BINDING_VIOLATION/);
});
