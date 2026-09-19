const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");
const scheduler = require("../dist/services/researchSchedulerPostgresWriter");
const schedCanonical = require("../dist/services/researchSchedulerCanonical");
const schedTime = require("../dist/services/researchSchedulerTime");
const rcvCanonical = require("../dist/services/rcv021Canonical");
const rcvVerifier = require("../dist/services/rcv021WriteVerifier");
const rcvRepo = require("../dist/services/rcv021PostgresRepository");

const database = process.env.SCHEDULER_W3_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 12 }) : null;
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const before = "2025-12-31T23:59:59.000000Z";
const at = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000000Z`;
const fields = (value) => { const result = rcvCanonical.canonicalizeRcv021Authority(value); return { canonicalVersion: 1, canonical: result.canonical, canonicalHash: result.hash }; };
const runRequest = (fixture, changes = {}) => ({ operationId: fixture.operationId, policyId: fixture.policyId, evaluationAt: changes.evaluationAt || at(0), deadlineAt: changes.deadlineAt || at(40), strategyIdentity: changes.strategyIdentity || "scheduler-strategy", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: changes.executionParametersCanonical || "{}" });

function operationBundle(seed) {
  const base = seed * 100;
  const operationId = id(base + 1), subjectBindingId = id(base + 2), triggerBindingId = id(base + 3);
  const subjectValue = { subjectBindingId, operationId, subjectType: "AUTHENTICATED_OPERATOR_REQUEST", captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: id(base + 5), historicalClaimId: null };
  const triggerValue = { triggerBindingId, operationId, triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: before, executionOwner: "owner", executionContext: "ctx", triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null };
  const operationValue = { operationId, subjectBindingId, triggerBindingId, purpose: "research", scopeCanonical: "{}", operationCreatedAt: before };
  const subject = { ...subjectValue, ...fields(subjectValue) };
  const trigger = { ...triggerValue, ...fields(triggerValue) };
  const operation = { ...operationValue, ...fields(operationValue) };
  return { operationId, subject, trigger, operation };
}

async function seed(seed, options = {}) {
  const fixture = operationBundle(seed);
  await rcvRepo.persistRcv021Bundle(pool, { operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger] });
  fixture.policyId = id(seed * 100 + 50);
  const policy = schedCanonical.canonicalizeSchedulerPolicyVersion({ policyId: fixture.policyId, operationId: fixture.operationId, version: "1", enabled: true, effectiveAtMicros: schedTime.parseSchedulerTimestamp(at(0)), firstEligibilityAtMicros: schedTime.parseSchedulerTimestamp(at(0)), fixedIntervalMicros: "1000000" });
  await pool.query("INSERT INTO public.scheduler_policy_streams(policy_id,operation_id) VALUES($1,$2)", [fixture.policyId, fixture.operationId]);
  await pool.query("INSERT INTO public.scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES($1,1,true,$2,$2,1000000,1,$3,$4)", [fixture.policyId, at(0), policy.canonical, Buffer.from(policy.hash, "hex")]);
  if (options.version2) {
    const second = schedCanonical.canonicalizeSchedulerPolicyVersion({ policyId: fixture.policyId, operationId: fixture.operationId, version: "2", enabled: true, effectiveAtMicros: schedTime.parseSchedulerTimestamp(at(1)), firstEligibilityAtMicros: schedTime.parseSchedulerTimestamp(at(0)), fixedIntervalMicros: "1000000" });
    await pool.query("INSERT INTO public.scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES($1,2,true,$2,$3,1000000,1,$4,$5)", [fixture.policyId, at(1), at(0), second.canonical, Buffer.from(second.hash, "hex")]);
  }
  return fixture;
}

async function counts(fixture) {
  const q = async (sql, values) => Number((await pool.query(sql, values)).rows[0].count);
  return {
    runs: await q("SELECT count(*) AS count FROM research_runs WHERE operation_id=$1", [fixture.operationId]),
    decisions: await q("SELECT count(*) AS count FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]),
    manifests: await q("SELECT count(*) AS count FROM scheduler_lifecycle_prefix_manifests WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]),
    members: await q("SELECT count(*) AS count FROM scheduler_lifecycle_prefix_members WHERE manifest_id IN (SELECT manifest_id FROM scheduler_lifecycle_prefix_manifests WHERE operation_id=$1 AND policy_id=$2)", [fixture.operationId, fixture.policyId]),
    bindings: await q("SELECT count(*) AS count FROM scheduler_run_now_bindings WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]),
  };
}

test("RUN_NOW commits one complete authority set and retries idempotently", { skip: !enabled }, async () => {
  const fixture = await seed(1);
  const first = await scheduler.createSchedulerRunNow(pool, runRequest(fixture));
  assert.equal(first.status, "COMMITTED");
  assert.deepEqual(await counts(fixture), { runs: 1, decisions: 1, manifests: 1, members: 1, bindings: 1 });
  const second = await scheduler.createSchedulerRunNow(pool, runRequest(fixture));
  assert.equal(second.status, "IDEMPOTENT");
  assert.equal(second.runId, first.runId);
  assert.deepEqual(await counts(fixture), { runs: 1, decisions: 1, manifests: 1, members: 1, bindings: 1 });
  const row = (await pool.query("SELECT d.run_now_run_id::text AS run_id, b.run_id::text AS binding_run_id, r.run_id::text AS actual_run_id FROM scheduler_decisions d JOIN scheduler_run_now_bindings b ON b.operation_id=d.operation_id AND b.policy_id=d.policy_id AND b.slot_index=d.slot_index JOIN research_runs r ON r.run_id=b.run_id WHERE d.operation_id=$1 AND d.policy_id=$2", [fixture.operationId, fixture.policyId])).rows[0];
  assert.equal(row.run_id, first.runId); assert.equal(row.binding_run_id, first.runId); assert.equal(row.actual_run_id, first.runId);
  const authorities = (await pool.query("SELECT d.canonical AS decision_canonical, encode(d.canonical_hash,'hex') AS decision_hash, m.canonical AS manifest_canonical, encode(m.canonical_hash,'hex') AS manifest_hash, b.canonical AS binding_canonical, encode(b.canonical_hash,'hex') AS binding_hash, r.canonical AS run_canonical, encode(r.canonical_hash,'hex') AS run_hash FROM scheduler_decisions d JOIN scheduler_lifecycle_prefix_manifests m ON m.manifest_id=d.manifest_id JOIN scheduler_run_now_bindings b ON b.operation_id=d.operation_id AND b.policy_id=d.policy_id AND b.slot_index=d.slot_index JOIN research_runs r ON r.run_id=b.run_id WHERE d.operation_id=$1 AND d.policy_id=$2", [fixture.operationId, fixture.policyId])).rows[0];
  for (const [canonical, hash] of [[authorities.decision_canonical, authorities.decision_hash], [authorities.manifest_canonical, authorities.manifest_hash], [authorities.binding_canonical, authorities.binding_hash], [authorities.run_canonical, authorities.run_hash]]) assert.equal(createHash("sha256").update(canonical, "utf8").digest("hex"), hash);
});

for (const [point, index] of ["after-locks", "after-run", "after-manifest", "after-member", "after-decision", "before-binding", "after-binding"].map((point, index) => [point, index])) {
  test(`failure at ${point} rolls back every authority`, { skip: !enabled }, async () => {
    const fixture = await seed(10 + index);
    await assert.rejects(() => scheduler.createSchedulerRunNow(pool, runRequest(fixture), { failAfter: point }), /TEST_INJECTED_FAILURE/);
    assert.deepEqual(await counts(fixture), { runs: 0, decisions: 0, manifests: 0, members: 0, bindings: 0 });
  });
}

test("rollback retry succeeds and divergent same-slot input fails closed", { skip: !enabled }, async () => {
  const fixture = await seed(30);
  await assert.rejects(() => scheduler.createSchedulerRunNow(pool, runRequest(fixture), { failAfter: "after-binding" }));
  const committed = await scheduler.createSchedulerRunNow(pool, runRequest(fixture));
  assert.equal(committed.status, "COMMITTED");
  await assert.rejects(() => scheduler.createSchedulerRunNow(pool, runRequest(fixture, { strategyIdentity: "different" })), /DUPLICATE_CONFLICT/);
  assert.deepEqual(await counts(fixture), { runs: 1, decisions: 1, manifests: 1, members: 1, bindings: 1 });
});

test("same-slot identical requests serialize to one authority set", { skip: !enabled }, async () => {
  const fixture = await seed(31);
  const results = await Promise.all([scheduler.createSchedulerRunNow(pool, runRequest(fixture)), scheduler.createSchedulerRunNow(pool, runRequest(fixture))]);
  assert.deepEqual(results.map((item) => item.status).sort(), ["COMMITTED", "IDEMPOTENT"]);
  assert.deepEqual(await counts(fixture), { runs: 1, decisions: 1, manifests: 1, members: 1, bindings: 1 });
});

test("same-slot divergent requests serialize and leave one immutable authority", { skip: !enabled }, async () => {
  const fixture = await seed(319);
  const outcomes = await Promise.all([
    scheduler.createSchedulerRunNow(pool, runRequest(fixture)),
    scheduler.createSchedulerRunNow(pool, runRequest(fixture, { strategyIdentity: "concurrent-different" })),
  ].map((promise) => promise.then((value) => value.status).catch((error) => String(error.message))));
  assert.equal(outcomes.filter((value) => value === "COMMITTED").length, 1);
  assert.equal(outcomes.filter((value) => value.includes("DUPLICATE_CONFLICT") || value === "IDEMPOTENT").length, 1);
  assert.deepEqual(await counts(fixture), { runs: 1, decisions: 1, manifests: 1, members: 1, bindings: 1 });
});

test("operation close wins the shared row lock and blocks RUN_NOW", { skip: !enabled }, async () => {
  const fixture = await seed(32);
  const closeClient = await pool.connect();
  try {
    await closeClient.query("BEGIN");
    await closeClient.query("SELECT operation_id FROM research_operations WHERE operation_id=$1 FOR UPDATE", [fixture.operationId]);
    const closeValue = { eventId: id(3299), operationId: fixture.operationId, eventType: "CLOSED", eventAt: at(0), actorIdentity: "operator" };
    const close = { ...closeValue, ...fields(closeValue) };
    await rcvRepo.persistRcv021BundleWithinTransaction(closeClient, rcvVerifier.verifyRcv021Write({ operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger], operationLifecycleEvents: [close] }));
    const pending = scheduler.createSchedulerRunNow(pool, runRequest(fixture));
    await new Promise((resolve) => setTimeout(resolve, 30));
    await closeClient.query("COMMIT");
    await assert.rejects(pending, /LIFECYCLE_VIOLATION/);
  } finally { try { await closeClient.query("ROLLBACK"); } catch {} closeClient.release(); }
  assert.deepEqual(await counts(fixture), { runs: 0, decisions: 0, manifests: 0, members: 0, bindings: 0 });
});

test("a committed external nonterminal Run blocks RUN_NOW after operation serialization", { skip: !enabled }, async () => {
  const fixture = await seed(33);
  const runValue = { runId: id(3399), operationId: fixture.operationId, strategyIdentity: "external", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}", runCreatedAt: at(0), deadlineAt: at(40), predecessorRunId: null };
  const external = { ...runValue, ...fields(runValue) };
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT operation_id FROM research_operations WHERE operation_id=$1 FOR UPDATE", [fixture.operationId]);
    const pending = scheduler.createSchedulerRunNow(pool, runRequest(fixture));
    await rcvRepo.persistRcv021BundleWithinTransaction(holder, { operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger], runs: [external] });
    await holder.query("COMMIT");
    await assert.rejects(pending, /NONTERMINAL_RUN_VIOLATION/);
  } finally { try { await holder.query("ROLLBACK"); } catch {} holder.release(); }
  assert.deepEqual(await counts(fixture), { runs: 1, decisions: 0, manifests: 0, members: 0, bindings: 0 });
});

test("policy stream lock rechecks a version appended during the race", { skip: !enabled }, async () => {
  const fixture = await seed(34);
  const second = schedCanonical.canonicalizeSchedulerPolicyVersion({ policyId: fixture.policyId, operationId: fixture.operationId, version: "2", enabled: true, effectiveAtMicros: schedTime.parseSchedulerTimestamp(at(1)), firstEligibilityAtMicros: schedTime.parseSchedulerTimestamp(at(0)), fixedIntervalMicros: "1000000" });
  const holder = await pool.connect();
  await holder.query("BEGIN");
  await holder.query("SELECT policy_id FROM scheduler_policy_streams WHERE policy_id=$1 FOR UPDATE", [fixture.policyId]);
  const pending = scheduler.createSchedulerRunNow(pool, runRequest(fixture, { evaluationAt: at(1), deadlineAt: at(40) }));
  await holder.query("INSERT INTO public.scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES($1,2,true,$2,$3,1000000,1,$4,$5)", [fixture.policyId, at(1), at(0), second.canonical, Buffer.from(second.hash, "hex")]);
  await holder.query("COMMIT");
  holder.release();
  const result = await pending;
  assert.equal(result.status, "COMMITTED");
  const row = (await pool.query("SELECT policy_version FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId])).rows[0];
  assert.equal(String(row.policy_version), "2");
});

test.after(async () => { if (pool) await pool.end(); });
