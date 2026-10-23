const assert = require("node:assert/strict");
const test = require("node:test");
const canonical = require("../dist/services/rcv021Canonical");
const verifier = require("../dist/services/rcv021WriteVerifier");
const repo = require("../dist/services/rcv021PostgresRepository");
const { ContextClient, contextPool } = require("./helpers/rcv021ContextClient.cjs");
const adapter = require("../dist/services/rcv021BindingAdapter");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000000Z`;
const fields = (value) => { const c = canonical.canonicalizeRcv021Authority(value); return { canonicalVersion: 1, canonical: c.canonical, canonicalHash: c.hash }; };
function result(n = 1) { const value = { resultId: id(n), runId: id(10), providerItemIdentity: `item-${n}`, providerEnvelopeCanonical: "{}", providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", resultObservedAt: time(2), providerSourceTime: null, protocolResultStatus: "returned" }; return { ...value, ...fields(value) }; }
function selection(n = 1, resultId = id(1)) { const value = { selectionId: id(50 + n), providerResultId: resultId, selectionAuthorization: "operator", selectedArtifactIdentity: `artifact-${n}`, observationOccurrenceId: id(100 + n), selectedAt: time(3) }; return { ...value, ...fields(value) }; }

function storedGraph() {
  const built = value => ({ ...value, ...fields(value) });
  const operation = built({ operationId: id(2), subjectBindingId: id(1), triggerBindingId: id(6), purpose: "research", scopeCanonical: "{}", operationCreatedAt: time(0) });
  const subject = built({ subjectBindingId: id(1), operationId: id(2), subjectType: "AUTHENTICATED_OPERATOR_REQUEST", captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: id(3), historicalClaimId: null });
  const trigger = built({ triggerBindingId: id(6), operationId: id(2), triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: time(0), executionOwner: "owner", executionContext: "ctx", triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null });
  const run = built({ runId: id(10), operationId: id(2), strategyIdentity: "strategy", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}", runCreatedAt: time(1), deadlineAt: time(50), predecessorRunId: null });
  return { operation, subject, trigger, runs: [run], operationLifecycleEvents: [], runLifecycleEvents: [], terminalResolutions: [], attempts: [], attemptResolutions: [], providerResults: [], resultSelections: [], rcv020Occurrences: [] };
}
class FakeClient extends ContextClient {
  constructor(failOn = null) { super(storedGraph(), failOn === null ? {} : { insertError: { table: failOn, error: new Error("injected failure") } }); }
}


test("T0 ProviderResult persists independently and T1 selection is valid without local result rows", () => {
  assert.doesNotThrow(() => verifier.verifyRcv021Write({ providerResults: [result()] }));
  assert.doesNotThrow(() => verifier.verifyRcv021Write({ resultSelections: [selection()] }));
});

test("write verification rejects divergent canonical/hash before persistence", () => {
  assert.throws(() => verifier.verifyRcv021Write({ providerResults: [{ ...result(), canonicalHash: "a".repeat(64), canonical: "{}" }] }), /HASH_MISMATCH|CANONICAL_MISMATCH/);
});

test("repository uses one parameterized transaction and exact immutable fields", async () => {
  const client = new FakeClient(); await repo.persistRcv021Bundle(contextPool(client), { providerResults: [result()] });
  assert.match(client.sql[0].text, /^SAVEPOINT rcv021_idle_/); assert.equal(client.sql.filter(entry => entry.text === "BEGIN").length, 1); const insert = client.sql.find((entry) => /INSERT INTO public\.research_provider_results/.test(entry.text)); assert.ok(insert); assert.ok(insert.text.includes("$1")); assert.equal(client.sql.at(-1).text, "COMMIT");
});

test("transaction-neutral primitive uses caller transaction without owning it", async () => {
  const client = new FakeClient();
  let released = 0; client.release = () => { released += 1; };
  await client.query("BEGIN");
  const before = client.sql.length;
  const authenticated = verifier.verifyRcv021Write({ providerResults: [result()] });
  await repo.persistRcv021BundleWithinTransaction(client, authenticated);
  assert.equal(client.sql.slice(before).some((entry) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(entry.text)), false);
  assert.equal(released, 0);
});

test("repository rolls back on mutation failure and never reports success", async () => {
  const client = new FakeClient("research_provider_results"); await assert.rejects(() => repo.persistRcv021Bundle(contextPool(client), { providerResults: [result()] }), /injected failure/); assert.equal(client.sql.at(-1).text, "ROLLBACK");
});

test("same identity conflict behavior is deterministic and no last-write-wins", () => {
  const core = require("../dist/services/rcv021SemanticCore");
  assert.equal(core.compareRcv021Identity(id(1), "x", id(1), "x"), "IDEMPOTENT"); assert.equal(core.compareRcv021Identity(id(1), "x", id(1), "y"), "CONFLICT"); assert.equal(core.compareRcv021Identity(id(1), "x", id(2), "x"), "DISTINCT");
});

test("T2 adapter fails closed when intended occurrence identity is absent", async () => {
  await assert.rejects(() => adapter.bindRcv021SelectionToRcv020(new FakeClient(), selection(), { contractVersion: 1, occurrences: [] }), /RCV020_BINDING_VIOLATION/);
});


test("STARTED event insert binds its exact event timestamp and all SQL parameters", async () => {
  const event = { eventId: id(200), runId: id(10), eventType: "STARTED", eventAt: time(2), executionAuthority: "engine" };
  const client = new FakeClient();
  await repo.persistRcv021Bundle(contextPool(client), { runLifecycleEvents: [{ ...event, ...fields(event) }] });
  const insert = client.sql.find((entry) => entry.text.startsWith("INSERT INTO public.research_run_lifecycle_events"));
  assert.ok(insert);
  const count = Math.max(...[...insert.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
  assert.equal(insert.values.length, count);
  assert.deepEqual(insert.values.slice(0, 5), [event.eventId, event.runId, event.eventType, event.eventAt, event.executionAuthority]);
});
