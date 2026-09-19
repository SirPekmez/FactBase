const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool } = require("pg");

const policyV1 = require("../dist/services/researchSchedulerPolicyV1");
const scheduler = require("../dist/services/researchSchedulerPostgresWriter");
const reader = require("../dist/services/researchSchedulerPostgresReader");
const core = require("../dist/services/researchSchedulerSemanticCore");
const canonical = require("../dist/services/researchSchedulerCanonical");
const time = require("../dist/services/researchSchedulerTime");
const rcvCanonical = require("../dist/services/rcv021Canonical");
const rcvVerifier = require("../dist/services/rcv021WriteVerifier");
const rcvRepo = require("../dist/services/rcv021PostgresRepository");
const rcvCore = require("../dist/services/rcv021SemanticCore");

const database = process.env.SCHEDULER_POLICY_V1_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const owner = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 12 }) : null;
let historicalReader = null;
const readerRole = "scheduler_reader_policy_v1";
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AUTH = "2026-01-01T00:00:00.000000Z";
const SLOT1 = "2026-01-02T00:00:00.000000Z";
const SLOT2 = "2026-01-03T00:00:00.000000Z";
const SLOT3 = "2026-01-04T00:00:00.000000Z";
const BEFORE_AUTH = "2025-12-31T23:59:59.999999Z";
const HOUR_AFTER = "2026-01-01T01:00:00.000000Z";
const fields = (value) => {
  const result = rcvCanonical.canonicalizeRcv021Authority(value);
  return { canonicalVersion: 1, canonical: result.canonical, canonicalHash: result.hash };
};

function operationBundle(seed) {
  const base = seed * 100;
  const operationId = id(base + 1), subjectBindingId = id(base + 2), triggerBindingId = id(base + 3);
  const subjectValue = { subjectBindingId, operationId, subjectType: "AUTHENTICATED_OPERATOR_REQUEST", captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: id(base + 5), historicalClaimId: null };
  const triggerValue = { triggerBindingId, operationId, triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: AUTH, executionOwner: "owner", executionContext: "ctx", triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null };
  const operationValue = { operationId, subjectBindingId, triggerBindingId, purpose: "research", scopeCanonical: "{}", operationCreatedAt: AUTH };
  return {
    operationId,
    subject: { ...subjectValue, ...fields(subjectValue) },
    trigger: { ...triggerValue, ...fields(triggerValue) },
    operation: { ...operationValue, ...fields(operationValue) },
  };
}

function runRequest(fixture, evaluationAt) {
  return { operationId: fixture.operationId, policyId: fixture.policyId, evaluationAt, deadlineAt: "2026-01-04T01:00:00.000000Z", strategyIdentity: "scheduler-policy-v1", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}" };
}

async function seed(seed) {
  const fixture = operationBundle(seed);
  await rcvRepo.persistRcv021Bundle(owner, { operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger] });
  fixture.policyId = id(seed * 100 + 50);
  fixture.policy = await policyV1.createResearchSchedulerPolicyV1(owner, { operationId: fixture.operationId, policyId: fixture.policyId });
  return fixture;
}

async function counts(fixture) {
  const count = async (sql, values) => Number((await owner.query(sql, values)).rows[0].count);
  return {
    runs: await count("SELECT count(*) FROM research_runs WHERE operation_id=$1", [fixture.operationId]),
    decisions: await count("SELECT count(*) FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]),
    manifests: await count("SELECT count(*) FROM scheduler_lifecycle_prefix_manifests WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]),
    members: await count("SELECT count(*) FROM scheduler_lifecycle_prefix_members WHERE manifest_id IN (SELECT manifest_id FROM scheduler_lifecycle_prefix_manifests WHERE operation_id=$1 AND policy_id=$2)", [fixture.operationId, fixture.policyId]),
    bindings: await count("SELECT count(*) FROM scheduler_run_now_bindings WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]),
  };
}

async function policyInput(fixture) {
  const row = (await owner.query(`SELECT policy_id::text AS policy_id, version::text AS version, enabled,
      to_char(effective_at AT TIME ZONE 'UTC','YYYY-MM-DD') || 'T' || to_char(effective_at AT TIME ZONE 'UTC','HH24:MI:SS.US') || 'Z' AS effective_at,
      to_char(first_eligibility_at AT TIME ZONE 'UTC','YYYY-MM-DD') || 'T' || to_char(first_eligibility_at AT TIME ZONE 'UTC','HH24:MI:SS.US') || 'Z' AS first_eligibility_at,
      fixed_interval_micros::text AS fixed_interval_micros
    FROM scheduler_policy_versions WHERE policy_id=$1 ORDER BY version`, [fixture.policyId])).rows;
  return row.map((item) => ({ policyId: item.policy_id, operationId: fixture.operationId, version: item.version, enabled: item.enabled, effectiveAtMicros: time.parseSchedulerTimestamp(item.effective_at), firstEligibilityAtMicros: time.parseSchedulerTimestamp(item.first_eligibility_at), fixedIntervalMicros: item.fixed_interval_micros }));
}

async function terminalize(fixture, runId, resolutionNumber, terminalAt) {
  const manifest = rcvCore.deriveTerminalManifest([]);
  const runEventValue = { eventId: id(700000 + resolutionNumber), runId, eventType: "STARTED", eventAt: time.formatSchedulerTimestamp(time.parseSchedulerTimestamp(terminalAt) - 59_000_000n), executionAuthority: "scheduler-policy-v1-test" };
  const runEventEncoded = rcvCanonical.canonicalizeRcv021Authority(runEventValue);
  const runEvent = { ...runEventValue, canonicalVersion: 1, canonical: runEventEncoded.canonical, canonicalHash: runEventEncoded.hash };
  const runValue = { runId, operationId: fixture.operationId, strategyIdentity: "scheduler-policy-v1", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}", runCreatedAt: time.formatSchedulerTimestamp(time.parseSchedulerTimestamp(runEventValue.eventAt) - 1_000_000n), deadlineAt: "2026-01-04T01:00:00.000000Z", predecessorRunId: null };
  const runEncoded = rcvCanonical.canonicalizeRcv021Authority(runValue);
  const run = { ...runValue, canonicalVersion: 1, canonical: runEncoded.canonical, canonicalHash: runEncoded.hash };
  const value = { resolutionId: id(800000 + resolutionNumber), runId, outcome: "SUCCESS_NO_RESULTS", terminalAt, completionAuthority: "scheduler-policy-v1-test", resultManifestCanonical: manifest.canonical, resultManifestHash: manifest.hash, resultCount: "0" };
  const encoded = rcvCanonical.canonicalizeRcv021Authority(value);
  const resolution = { ...value, canonicalVersion: 1, canonical: encoded.canonical, canonicalHash: encoded.hash };
  rcvVerifier.verifyRcv021Write({ operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger], runs: [run], runLifecycleEvents: [runEvent], runTerminalResolutions: [resolution] });
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO research_run_lifecycle_events(event_id,run_id,event_type,event_at,execution_authority,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [runEvent.eventId, runEvent.runId, runEvent.eventType, runEvent.eventAt, runEvent.executionAuthority, runEvent.canonicalVersion, runEvent.canonical, Buffer.from(runEvent.canonicalHash, "hex")]);
    await client.query("INSERT INTO research_run_terminal_resolutions(resolution_id,run_id,outcome,terminal_at,completion_authority,result_manifest_canonical,result_manifest_hash,result_count,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [resolution.resolutionId, resolution.runId, resolution.outcome, resolution.terminalAt, resolution.completionAuthority, resolution.resultManifestCanonical, Buffer.from(resolution.resultManifestHash, "hex"), resolution.resultCount, resolution.canonicalVersion, resolution.canonical, Buffer.from(resolution.canonicalHash, "hex")]);
    await client.query("COMMIT");
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
}

async function appendDisabledVersion(fixture) {
  const input = { policyId: fixture.policyId, operationId: fixture.operationId, version: "2", enabled: false, effectiveAtMicros: time.parseSchedulerTimestamp(SLOT1), firstEligibilityAtMicros: time.parseSchedulerTimestamp(AUTH), fixedIntervalMicros: policyV1.RESEARCH_SCHEDULER_POLICY_V1_FIXED_INTERVAL_MICROS };
  const encoded = canonical.canonicalizeSchedulerPolicyVersion(input);
  await owner.query(`INSERT INTO scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash)
    VALUES($1,2,false,$2,$3,$4,1,$5,$6)`, [fixture.policyId, SLOT1, AUTH, "86400000000", encoded.canonical, Buffer.from(encoded.hash, "hex")]);
}

test.before(async () => {
  if (!enabled) return;
  await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${readerRole}') THEN CREATE ROLE ${readerRole} LOGIN PASSWORD 'policyv1'; END IF; END $$`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${readerRole}`);
  await owner.query(`REVOKE CREATE ON SCHEMA public FROM ${readerRole}`);
  const tables = (await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'scheduler_%' OR tablename LIKE 'research_%')")).rows;
  for (const row of tables) await owner.query(`GRANT SELECT ON public.${row.tablename} TO ${readerRole}`);
  historicalReader = new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: readerRole, password: "policyv1", max: 4 });
});

test("Policy v1 persists exact authority, runs slots 0..3 at daily boundaries, and verifies after restart", { skip: !enabled }, async () => {
  const fixture = await seed(1);
  assert.deepEqual({ policyId: fixture.policy.policyId, version: fixture.policy.version, enabled: fixture.policy.enabled, effectiveAt: fixture.policy.effectiveAt, firstEligibilityAt: fixture.policy.firstEligibilityAt, fixedIntervalMicros: fixture.policy.fixedIntervalMicros }, { policyId: fixture.policyId, version: "1", enabled: true, effectiveAt: AUTH, firstEligibilityAt: AUTH, fixedIntervalMicros: "86400000000" });
  const versions = await policyInput(fixture);
  const beforeCounts = await counts(fixture);
  const transient = core.evaluateScheduler({ evaluationAtMicros: time.parseSchedulerTimestamp(BEFORE_AUTH), operationState: "OPEN", policyVersions: versions });
  assert.deepEqual([transient.kind, transient.reason, transient.nextEligibleAtMicros], ["TRANSIENT_EVALUATION", "NOT_YET_ELIGIBLE", time.parseSchedulerTimestamp(AUTH).toString()]);
  assert.deepEqual(await counts(fixture), beforeCounts);
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: time.parseSchedulerTimestamp(AUTH), operationState: "OPEN", policyVersions: versions }).slotIndex, "0");
  const expectedSlots = [AUTH, SLOT1, SLOT2, SLOT3];
  const results = [];
  for (let index = 0; index < expectedSlots.length; index += 1) {
    const result = await scheduler.createSchedulerRunNow(owner, runRequest(fixture, expectedSlots[index]));
    assert.equal(result.status, "COMMITTED");
    results.push(result);
    const decision = (await owner.query("SELECT slot_index::text, scheduled_at, reason, decision FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2 AND slot_index=$3", [fixture.operationId, fixture.policyId, String(index)])).rows[0];
    assert.equal(decision.slot_index, String(index));
    assert.equal(decision.reason, index === 0 ? "INITIAL_ELIGIBILITY" : "INTERVAL_ELIGIBILITY");
    assert.equal(decision.decision, "RUN_NOW");
    assert.equal(time.parseSchedulerTimestamp(`${decision.scheduled_at.toISOString().replace(".000Z", ".000000Z")}`), time.parseSchedulerTimestamp(expectedSlots[index]));
    await terminalize(fixture, result.runId, index + 1, index === 3 ? "2026-01-04T00:01:00.000000Z" : `2026-01-0${index + 1}T00:01:00.000000Z`);
    const verified = await reader.verifySchedulerHistory(historicalReader, fixture.operationId, fixture.policyId);
    assert.equal(verified.verified, true);
    assert.equal(verified.decisionCount, index + 1);
  }
  assert.deepEqual(await counts(fixture), { runs: 4, decisions: 4, manifests: 4, members: 22, bindings: 4 });
  assert.deepEqual(results.map((item) => item.slotIndex), ["0", "1", "2", "3"]);
  assert.equal(results[1].runId !== results[0].runId, true);
  const restartedReader = new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: readerRole, password: "policyv1", max: 2 });
  try { assert.deepEqual(await reader.verifySchedulerHistory(restartedReader, fixture.operationId, fixture.policyId), { verified: true, operationId: fixture.operationId, policyId: fixture.policyId, decisionCount: 4, tailSlotIndex: "3" }); } finally { await restartedReader.end(); }
  const retry = await scheduler.createSchedulerRunNow(owner, runRequest(fixture, AUTH));
  assert.equal(retry.status, "IDEMPOTENT");
  assert.deepEqual(await counts(fixture), { runs: 4, decisions: 4, manifests: 4, members: 22, bindings: 4 });
  await assert.rejects(() => scheduler.createSchedulerRunNow(owner, { ...runRequest(fixture, AUTH), strategyIdentity: "divergent" }), /DUPLICATE_CONFLICT/);
});

test("Policy v1 exact boundary arithmetic and missed-slot coalescing preserve the historical gap", { skip: !enabled }, async () => {
  const fixture = await seed(2);
  const versions = await policyInput(fixture);
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: time.parseSchedulerTimestamp(BEFORE_AUTH), operationState: "OPEN", policyVersions: versions }).kind, "TRANSIENT_EVALUATION");
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: time.parseSchedulerTimestamp(AUTH), operationState: "OPEN", policyVersions: versions }).slotIndex, "0");
  assert.equal(core.evaluateScheduler({ evaluationAtMicros: time.parseSchedulerTimestamp("2026-01-01T00:00:00.000001Z"), operationState: "OPEN", policyVersions: versions }).slotIndex, "0");
  const first = await scheduler.createSchedulerRunNow(owner, runRequest(fixture, AUTH));
  await terminalize(fixture, first.runId, 20, HOUR_AFTER);
  const missed = await scheduler.createSchedulerRunNow(owner, runRequest(fixture, SLOT2));
  assert.equal(missed.slotIndex, "2");
  await terminalize(fixture, missed.runId, 21, "2026-01-03T01:00:00.000000Z");
  const slot2 = (await owner.query("SELECT decision, reason FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2 AND slot_index=2", [fixture.operationId, fixture.policyId])).rows[0];
  assert.deepEqual(slot2, { decision: "RUN_NOW", reason: "MISSED_SLOT_COALESCED" });
  const later = await scheduler.createSchedulerRunNow(owner, runRequest(fixture, SLOT3));
  assert.equal(later.slotIndex, "3");
  await terminalize(fixture, later.runId, 22, "2026-01-04T01:00:00.000000Z");
  const reasons = (await owner.query("SELECT slot_index::text, reason FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2 ORDER BY slot_index", [fixture.operationId, fixture.policyId])).rows;
  assert.deepEqual(reasons, [{ slot_index: "0", reason: "INITIAL_ELIGIBILITY" }, { slot_index: "2", reason: "MISSED_SLOT_COALESCED" }, { slot_index: "3", reason: "MISSED_SLOT_COALESCED" }]);
  assert.deepEqual(await reader.verifySchedulerHistory(historicalReader, fixture.operationId, fixture.policyId), { verified: true, operationId: fixture.operationId, policyId: fixture.policyId, decisionCount: 3, tailSlotIndex: "3" });
});

test("Disabled later authority follows frozen transient/due semantics without adaptive or cost inputs", { skip: !enabled }, async () => {
  const fixture = await seed(3);
  await appendDisabledVersion(fixture);
  const versions = await policyInput(fixture);
  const preDueToDisabledVersion = core.evaluateScheduler({ evaluationAtMicros: time.parseSchedulerTimestamp("2026-01-01T12:00:00.000000Z"), operationState: "OPEN", policyVersions: versions });
  assert.equal(preDueToDisabledVersion.kind, "DUE_EVALUATION");
  assert.equal(preDueToDisabledVersion.reason, "INITIAL_ELIGIBILITY");
  const dueDisabled = core.evaluateScheduler({ evaluationAtMicros: time.parseSchedulerTimestamp(SLOT1), operationState: "OPEN", policyVersions: versions, consumedSlots: core.makeSchedulerConsumedSlotSet(["0"]) });
  assert.deepEqual([dueDisabled.kind, dueDisabled.decision, dueDisabled.reason, dueDisabled.nextEligibleAtMicros], ["DUE_EVALUATION", "NO_ACTION", "POLICY_DISABLED", null]);
  assert.deepEqual(await counts(fixture), { runs: 0, decisions: 0, manifests: 0, members: 0, bindings: 0 });
  assert.match(policyV1.RESEARCH_SCHEDULER_POLICY_V1_ID, /universal-24h/);
});

test("Policy v1 authority creation rolls back its stream when version persistence fails", { skip: !enabled }, async () => {
  const fixture = operationBundle(4);
  await rcvRepo.persistRcv021Bundle(owner, { operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger] });
  const policyId = id(450);
  const failingPool = {
    connect: async () => {
      const client = await owner.connect();
      return {
        query: async (text, values) => {
          if (text.includes("INSERT INTO public.scheduler_policy_versions")) throw new Error("TEST_POLICY_VERSION_INSERT_FAILURE");
          return client.query(text, values);
        },
        release: () => client.release(),
      };
    },
  };
  await assert.rejects(() => policyV1.createResearchSchedulerPolicyV1(failingPool, { operationId: fixture.operationId, policyId }), /TEST_POLICY_VERSION_INSERT_FAILURE/);
  assert.equal((await owner.query("SELECT count(*) FROM scheduler_policy_streams WHERE operation_id=$1", [fixture.operationId])).rows[0].count, "0");
  assert.equal((await owner.query("SELECT count(*) FROM scheduler_policy_versions WHERE policy_id=$1", [policyId])).rows[0].count, "0");
  const committed = await policyV1.createResearchSchedulerPolicyV1(owner, { operationId: fixture.operationId, policyId });
  assert.equal(committed.fixedIntervalMicros, "86400000000");
});

test.after(async () => { if (historicalReader) await historicalReader.end(); if (owner) await owner.end(); });
