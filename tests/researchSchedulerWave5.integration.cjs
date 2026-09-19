const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");
const writer = require("../dist/services/researchSchedulerPostgresWriter");
const readerApi = require("../dist/services/researchSchedulerPostgresReader");
const sched = require("../dist/services/researchSchedulerCanonical");
const time = require("../dist/services/researchSchedulerTime");
const rcvCanonical = require("../dist/services/rcv021Canonical");
const rcvVerify = require("../dist/services/rcv021WriteVerifier");
const rcvRepo = require("../dist/services/rcv021PostgresRepository");
const rcvCore = require("../dist/services/rcv021SemanticCore");

const database = process.env.SCHEDULER_W5_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const owner = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 12 }) : null;
const readerRole = "scheduler_reader_wave5";
const reader = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: readerRole, password: "wave5", max: 4 }) : null;
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const before = "2025-12-31T23:59:59.000000Z";
const at = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000000Z`;
const fields = (value) => { const result = rcvCanonical.canonicalizeRcv021Authority(value); return { canonicalVersion: 1, canonical: result.canonical, canonicalHash: result.hash }; };
const request = (fixture, changes = {}) => ({ operationId: fixture.operationId, policyId: fixture.policyId, evaluationAt: changes.evaluationAt || at(0), deadlineAt: changes.deadlineAt || at(40), strategyIdentity: changes.strategyIdentity || "scheduler-strategy", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: changes.executionParametersCanonical || "{}" });

function operationBundle(seed) {
  const base = seed * 100;
  const operationId = id(base + 1), subjectBindingId = id(base + 2), triggerBindingId = id(base + 3);
  const subjectValue = { subjectBindingId, operationId, subjectType: "AUTHENTICATED_OPERATOR_REQUEST", captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: id(base + 5), historicalClaimId: null };
  const triggerValue = { triggerBindingId, operationId, triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: before, executionOwner: "owner", executionContext: "ctx", triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null };
  const operationValue = { operationId, subjectBindingId, triggerBindingId, purpose: "research", scopeCanonical: "{}", operationCreatedAt: before };
  const subject = { ...subjectValue, ...fields(subjectValue) }, trigger = { ...triggerValue, ...fields(triggerValue) }, operation = { ...operationValue, ...fields(operationValue) };
  return { operationId, subject, trigger, operation };
}

async function seed(seed, enabledPolicy = true) {
  const fixture = operationBundle(seed);
  await rcvRepo.persistRcv021Bundle(owner, { operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger] });
  fixture.policyId = id(seed * 100 + 50);
  const policy = sched.canonicalizeSchedulerPolicyVersion({ policyId: fixture.policyId, operationId: fixture.operationId, version: "1", enabled: enabledPolicy, effectiveAtMicros: time.parseSchedulerTimestamp(at(0)), firstEligibilityAtMicros: time.parseSchedulerTimestamp(at(0)), fixedIntervalMicros: "1000000" });
  await owner.query("INSERT INTO scheduler_policy_streams(policy_id,operation_id) VALUES($1,$2)", [fixture.policyId, fixture.operationId]);
  await owner.query("INSERT INTO scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES($1,1,$3,$2,$2,1000000,1,$4,$5)", [fixture.policyId, at(0), enabledPolicy, policy.canonical, Buffer.from(policy.hash, "hex")]);
  return fixture;
}

async function appendVersion(fixture, version, effectiveAt, enabledValue = true) {
  const policy = sched.canonicalizeSchedulerPolicyVersion({ policyId: fixture.policyId, operationId: fixture.operationId, version: String(version), enabled: enabledValue, effectiveAtMicros: time.parseSchedulerTimestamp(effectiveAt), firstEligibilityAtMicros: time.parseSchedulerTimestamp(at(0)), fixedIntervalMicros: "1000000" });
  await owner.query("INSERT INTO scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,$4,$5,1000000,1,$6,$7)", [fixture.policyId, version, enabledValue, effectiveAt, at(0), policy.canonical, Buffer.from(policy.hash, "hex")]);
}

async function appendClose(fixture, eventAt = at(0)) {
  const value = { eventId: id(900000 + Number(fixture.policyId.slice(-3))), operationId: fixture.operationId, eventType: "CLOSED", eventAt, actorIdentity: "operator" };
  const event = { ...value, ...fields(value) }; const client = await owner.connect();
  try { await client.query("BEGIN"); await rcvRepo.persistRcv021BundleWithinTransaction(client, rcvVerify.verifyRcv021Write({ operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger], operationLifecycleEvents: [event] })); await client.query("COMMIT"); }
  catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
}

let terminalSequence = 0;
async function terminalizeRun(runId, terminalAt = at(3)) {
  const startedValue = { eventId: id(920000 + terminalSequence), runId, eventType: "STARTED", eventAt: at(2), executionAuthority: "wave5-test" };
  const started = { ...startedValue, ...fields(startedValue) };
  await owner.query("INSERT INTO research_run_lifecycle_events(event_id,run_id,event_type,event_at,execution_authority,canonical_version,canonical,canonical_hash) VALUES($1,$2,'STARTED',$3,$4,1,$5,$6)", [started.eventId, started.runId, started.eventAt, started.executionAuthority, started.canonical, Buffer.from(started.canonicalHash, "hex")]);
  const manifest = rcvCore.deriveTerminalManifest([]);
  const value = { resolutionId: id(910000 + terminalSequence++), runId, outcome: "SUCCESS_NO_RESULTS", terminalAt, completionAuthority: "wave5-test", resultManifestCanonical: manifest.canonical, resultManifestHash: manifest.hash, resultCount: "0" };
  const terminal = { ...value, ...fields(value) };
  await owner.query("INSERT INTO research_run_terminal_resolutions(resolution_id,run_id,outcome,terminal_at,completion_authority,result_manifest_canonical,result_manifest_hash,result_count,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,$4,$5,$6,$7,0,1,$8,$9)", [terminal.resolutionId, terminal.runId, terminal.outcome, terminal.terminalAt, terminal.completionAuthority, terminal.resultManifestCanonical, Buffer.from(terminal.resultManifestHash, "hex"), terminal.canonical, Buffer.from(terminal.canonicalHash, "hex")]);
}

function manifestId(operationId, policyId, slotIndex, evaluationAt) {
  const micros = time.parseSchedulerTimestamp(evaluationAt).toString(); const digest = createHash("sha256").update("factbase/scheduler-manifest/v1\0", "utf8").update(`${operationId}:${policyId}:${slotIndex}:${micros}`, "utf8").digest(); const bytes = Buffer.from(digest.subarray(0, 16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const hex = bytes.toString("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function insertGenesis(fixture, { enabledPolicy = false, evaluationAt = at(0), reason = "POLICY_DISABLED" } = {}) {
  const operation = (await owner.query("SELECT canonical_version, encode(canonical_hash,'hex') AS hash FROM research_operations WHERE operation_id=$1", [fixture.operationId])).rows[0];
  const mid = manifestId(fixture.operationId, fixture.policyId, "0", evaluationAt);
  const members = [{ authorityKind: "OPERATION_CREATED", authoritativeTimeMicros: time.parseSchedulerTimestamp(before), authorityIdentity: fixture.operationId, authorityCanonicalVersion: "1", authorityCanonicalHash: operation.hash }];
  const events = (await owner.query("SELECT event_id::text AS id, (to_char(event_at AT TIME ZONE 'UTC','YYYY-MM-DD') || 'T' || to_char(event_at AT TIME ZONE 'UTC','HH24:MI:SS.US') || 'Z') AS event_at, canonical_version, encode(canonical_hash,'hex') AS hash FROM research_operation_lifecycle_events WHERE operation_id=$1 AND event_at <= $2 ORDER BY event_at,event_id", [fixture.operationId, evaluationAt])).rows;
  for (const event of events) members.push({ authorityKind: "OPERATION_LIFECYCLE_EVENT", authoritativeTimeMicros: time.parseSchedulerTimestamp(String(event.event_at)), authorityIdentity: event.id, authorityCanonicalVersion: String(event.canonical_version), authorityCanonicalHash: event.hash });
  const manifest = sched.canonicalizeSchedulerLifecyclePrefixManifest({ manifestId: mid, operationId: fixture.operationId, policyId: fixture.policyId, slotIndex: "0", evaluationAtMicros: time.parseSchedulerTimestamp(evaluationAt), members });
  await owner.query("INSERT INTO scheduler_lifecycle_prefix_manifests(manifest_id,operation_id,policy_id,slot_index,evaluation_at,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,0,$4,1,$5,$6)", [mid, fixture.operationId, fixture.policyId, evaluationAt, manifest.canonical, Buffer.from(manifest.hash, "hex")]);
  for (const member of manifest.value.members) await owner.query("INSERT INTO scheduler_lifecycle_prefix_members(manifest_id,authority_kind,authoritative_time,authority_identity,authority_canonical_version,authority_canonical_hash) VALUES($1,$2,$3,$4,1,$5)", [mid, member.authorityKind, time.formatSchedulerTimestamp(BigInt(member.authoritativeTimeMicros)), member.authorityIdentity, Buffer.from(member.authorityCanonicalHash, "hex")]);
  const pv = (await owner.query("SELECT encode(canonical_hash,'hex') AS hash FROM scheduler_policy_versions WHERE policy_id=$1 AND version=1", [fixture.policyId])).rows[0].hash;
  const canonical = sched.canonicalizeSchedulerDecision({ operationId: fixture.operationId, policyId: fixture.policyId, slotIndex: "0", previousDecisionIdentity: null, previousDecisionCanonicalHash: null, policyVersion: "1", policyVersionCanonicalHash: pv, scheduledAtMicros: time.parseSchedulerTimestamp(at(0)), evaluationAtMicros: time.parseSchedulerTimestamp(evaluationAt), decision: "NO_ACTION", reason, nextEligibleAtMicros: null, operationManifestId: mid, operationManifestHash: manifest.hash, activeRunId: null, activeRunCreationIdentity: null, activeRunCreationHash: null, activeRunHistoricalState: null, activeRunRunningEventIdentity: null, activeRunRunningEventHash: null, runNowBindingIdentity: null, runNowRunId: null });
  await owner.query("INSERT INTO scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,previous_decision_canonical_hash,active_run_id,active_run_creation_identity,active_run_creation_hash,active_run_historical_state,active_run_running_event_identity,active_run_running_event_hash,run_now_binding_identity,run_now_run_id,canonical_version,canonical,canonical_hash) VALUES($1,$2,0,1,$3,$4,$5,'NO_ACTION',$6,NULL,$7,$8,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,$9,$10)", [fixture.operationId, fixture.policyId, Buffer.from(pv, "hex"), at(0), evaluationAt, reason, mid, Buffer.from(manifest.hash, "hex"), canonical.canonical, Buffer.from(canonical.hash, "hex")]);
}

async function countAuthority(fixture) {
  const q = async (sql, values) => Number((await owner.query(sql, values)).rows[0].count);
  return { runs: await q("SELECT count(*) AS count FROM research_runs WHERE operation_id=$1", [fixture.operationId]), decisions: await q("SELECT count(*) AS count FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]), manifests: await q("SELECT count(*) AS count FROM scheduler_lifecycle_prefix_manifests WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]), bindings: await q("SELECT count(*) AS count FROM scheduler_run_now_bindings WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]) };
}

async function disable(table) { await owner.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`); }
async function enable(table) { await owner.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`); }

test.before(async () => {
  if (!enabled) return;
  await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${readerRole}') THEN CREATE ROLE ${readerRole} LOGIN PASSWORD 'wave5'; END IF; END $$`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${readerRole}`); await owner.query(`REVOKE CREATE ON SCHEMA public FROM ${readerRole}`);
  for (const row of (await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'scheduler_%' OR tablename LIKE 'research_%')")).rows) await owner.query(`GRANT SELECT ON public.${row.tablename} TO ${readerRole}`);
});

test("Wave 5 transient evaluation persists no authority", { skip: !enabled }, async () => {
  const fixture = await seed(501);
  await assert.rejects(() => writer.createSchedulerRunNow(owner, request(fixture, { evaluationAt: "2025-12-31T23:59:59.999999Z" })), /UNSUPPORTED_STATE/);
  assert.deepEqual(await countAuthority(fixture), { runs: 0, decisions: 0, manifests: 0, bindings: 0 });
});

test("Wave 5 persists and independently verifies POLICY_DISABLED and OPERATION_CLOSED", { skip: !enabled }, async () => {
  const disabled = await seed(502, false); await insertGenesis(disabled, { reason: "POLICY_DISABLED" });
  assert.deepEqual(await readerApi.verifySchedulerHistory(reader, disabled.operationId, disabled.policyId), { verified: true, operationId: disabled.operationId, policyId: disabled.policyId, decisionCount: 1, tailSlotIndex: "0" });
  const closed = await seed(503, true); await appendClose(closed, at(0)); await insertGenesis(closed, { reason: "OPERATION_CLOSED" });
  assert.deepEqual(await readerApi.verifySchedulerHistory(reader, closed.operationId, closed.policyId), { verified: true, operationId: closed.operationId, policyId: closed.policyId, decisionCount: 1, tailSlotIndex: "0" });
});

test("Wave 5 proves INITIAL, INTERVAL, MISSED, and repeated MISSED with Reader parity", { skip: !enabled }, async () => {
  const initial = await seed(504, true); const first = await writer.createSchedulerRunNow(owner, request(initial)); assert.equal(first.status, "COMMITTED"); assert.equal((await readerApi.verifySchedulerHistory(reader, initial.operationId, initial.policyId)).tailSlotIndex, "0");
  const interval = await seed(505, false); await appendVersion(interval, 2, at(1), true); await insertGenesis(interval, { reason: "POLICY_DISABLED" }); const i = await writer.createSchedulerRunNow(owner, request(interval, { evaluationAt: at(1) })); assert.equal(i.status, "COMMITTED"); assert.equal((await owner.query("SELECT reason FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2 AND slot_index=1", [interval.operationId, interval.policyId])).rows[0].reason, "INTERVAL_ELIGIBILITY"); assert.equal((await readerApi.verifySchedulerHistory(reader, interval.operationId, interval.policyId)).tailSlotIndex, "1");
  const missed = await seed(506, false); await appendVersion(missed, 2, at(1), true); await insertGenesis(missed, { reason: "POLICY_DISABLED" }); const m2 = await writer.createSchedulerRunNow(owner, request(missed, { evaluationAt: at(2) })); assert.equal(m2.status, "COMMITTED"); await terminalizeRun(m2.runId); const m3 = await writer.createSchedulerRunNow(owner, request(missed, { evaluationAt: at(3) })); assert.equal(m3.status, "COMMITTED"); const reasons = (await owner.query("SELECT slot_index::text AS slot, reason FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2 ORDER BY slot_index", [missed.operationId, missed.policyId])).rows; assert.deepEqual(reasons.map((row) => [row.slot, row.reason]), [["0", "POLICY_DISABLED"], ["2", "MISSED_SLOT_COALESCED"], ["3", "MISSED_SLOT_COALESCED"]]); assert.equal((await readerApi.verifySchedulerHistory(reader, missed.operationId, missed.policyId)).tailSlotIndex, "3");
});

test("Wave 5 old-slot retry authenticates its stored predecessor and does not rebind", { skip: !enabled }, async () => {
  const fixture = await seed(507, true); const committed = await writer.createSchedulerRunNow(owner, request(fixture)); assert.equal(committed.status, "COMMITTED");
  const retry = await writer.createSchedulerRunNow(owner, request(fixture)); assert.equal(retry.status, "IDEMPOTENT"); assert.equal(retry.runId, committed.runId); assert.deepEqual(await countAuthority(fixture), { runs: 1, decisions: 1, manifests: 1, bindings: 1 });
});

test("Wave 5 corruption and no-repair checks remain fail-closed and deterministic", { skip: !enabled }, async () => {
  const fixture = await seed(508, true); await writer.createSchedulerRunNow(owner, request(fixture)); const before = (await owner.query("SELECT canonical,encode(canonical_hash,'hex') AS hash FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId])).rows[0];
  await disable("scheduler_decisions"); try { await owner.query("UPDATE scheduler_decisions SET canonical_hash=decode(repeat('aa',32),'hex') WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]); } finally { await enable("scheduler_decisions"); }
  const verifyError = async () => { try { await readerApi.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId); throw new Error("expected verification failure"); } catch (error) { return error; } }; const first = await verifyError(); const second = await verifyError(); assert.equal(first.message, second.message); const after = (await owner.query("SELECT canonical,encode(canonical_hash,'hex') AS hash FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId])).rows[0]; assert.equal(after.canonical, before.canonical); assert.equal(after.hash, "aa".repeat(32));
});

test("Wave 5 persisted corruption matrix rejects chain, policy, manifest, and binding substitutions", { skip: !enabled }, async () => {
  const missing = await seed(510, true); await writer.createSchedulerRunNow(owner, request(missing)); await owner.query("ALTER TABLE scheduler_decisions DROP CONSTRAINT chk_scheduler_decision_predecessor_shape"); await disable("scheduler_decisions"); try { await owner.query("UPDATE scheduler_decisions SET previous_operation_id=$1, previous_policy_id=$2, previous_slot_index=99, previous_decision_canonical_hash=decode(repeat('11',32),'hex') WHERE operation_id=$3 AND policy_id=$4", [id(999991), missing.policyId, missing.operationId, missing.policyId]); } finally { await enable("scheduler_decisions"); } await assert.rejects(() => readerApi.verifySchedulerHistory(reader, missing.operationId, missing.policyId), /MISSING_DATA|MALFORMED_DATA|IDENTITY_MISMATCH|HASH_MISMATCH|LIFECYCLE_PREFIX/);
  const predecessorHash = await seed(511, true); await writer.createSchedulerRunNow(owner, request(predecessorHash)); await disable("scheduler_decisions"); try { await owner.query("UPDATE scheduler_decisions SET previous_decision_canonical_hash=decode(repeat('22',32),'hex') WHERE operation_id=$1 AND policy_id=$2", [predecessorHash.operationId, predecessorHash.policyId]); } finally { await enable("scheduler_decisions"); } await assert.rejects(() => readerApi.verifySchedulerHistory(reader, predecessorHash.operationId, predecessorHash.policyId), /HASH_MISMATCH|CANONICAL_MISMATCH|predecessor/);
  const policyHash = await seed(512, true); await writer.createSchedulerRunNow(owner, request(policyHash)); await disable("scheduler_policy_versions"); try { await owner.query("UPDATE scheduler_policy_versions SET canonical_hash=decode(repeat('33',32),'hex') WHERE policy_id=$1", [policyHash.policyId]); } finally { await enable("scheduler_policy_versions"); } await assert.rejects(() => readerApi.verifySchedulerHistory(reader, policyHash.operationId, policyHash.policyId), /HASH_MISMATCH|CANONICAL_MISMATCH/);
  const binding = await seed(513, true); await writer.createSchedulerRunNow(owner, request(binding)); await disable("scheduler_run_now_bindings"); try { await owner.query("UPDATE scheduler_run_now_bindings SET canonical_hash=decode(repeat('44',32),'hex') WHERE operation_id=$1 AND policy_id=$2", [binding.operationId, binding.policyId]); } finally { await enable("scheduler_run_now_bindings"); } await assert.rejects(() => readerApi.verifySchedulerHistory(reader, binding.operationId, binding.policyId), /HASH_MISMATCH|RUN_NOW_BINDING_VIOLATION/);
  const manifest = await seed(514, true); await writer.createSchedulerRunNow(owner, request(manifest)); await disable("scheduler_lifecycle_prefix_members"); try { await owner.query("UPDATE scheduler_lifecycle_prefix_members SET authority_canonical_hash=decode(repeat('55',32),'hex') WHERE manifest_id=(SELECT manifest_id FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2)", [manifest.operationId, manifest.policyId]); } finally { await enable("scheduler_lifecycle_prefix_members"); } await assert.rejects(() => readerApi.verifySchedulerHistory(reader, manifest.operationId, manifest.policyId), /LIFECYCLE_PREFIX|HASH_MISMATCH|CANONICAL_MISMATCH/);
  const multi = await seed(519, true); await writer.createSchedulerRunNow(owner, request(multi)); await disable("scheduler_policy_versions"); try { await owner.query("UPDATE scheduler_policy_versions SET canonical_hash=decode(repeat('77',32),'hex') WHERE policy_id=$1", [multi.policyId]); } finally { await enable("scheduler_policy_versions"); } await disable("scheduler_decisions"); try { await owner.query("UPDATE scheduler_decisions SET canonical_hash=decode(repeat('88',32),'hex') WHERE operation_id=$1 AND policy_id=$2", [multi.operationId, multi.policyId]); } finally { await enable("scheduler_decisions"); } const deterministic = async () => { try { await readerApi.verifySchedulerHistory(reader, multi.operationId, multi.policyId); throw new Error("expected corruption"); } catch (error) { return error.message; } }; assert.equal(await deterministic(), await deterministic());
});

test("Wave 5 SELECT-only role verifies valid and corrupt histories without locks or writes", { skip: !enabled }, async () => {
  const fixture = await seed(509, true); await writer.createSchedulerRunNow(owner, request(fixture)); assert.equal((await readerApi.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId)).verified, true);
  await assert.rejects(() => reader.query("INSERT INTO scheduler_policy_streams(policy_id,operation_id) VALUES($1,$2)", [id(999991), id(999992)]), /permission denied/);
  const source = require("node:fs").readFileSync("src/services/researchSchedulerPostgresReader.ts", "utf8"); assert.doesNotMatch(source, /\b(BEGIN|COMMIT|ROLLBACK|INSERT\s+INTO|UPDATE\s+|DELETE\s+|FOR\s+(UPDATE|SHARE)|Date\.now|CURRENT_TIMESTAMP|clock_timestamp)\b/i);
});

test("Wave 5 missing RUN_NOW binding and active evidence corruption fail closed", { skip: !enabled }, async () => {
  const missingBinding = await seed(515, true); await writer.createSchedulerRunNow(owner, request(missingBinding)); await owner.query("ALTER TABLE scheduler_run_now_bindings DISABLE TRIGGER USER"); try { await owner.query("DELETE FROM scheduler_run_now_bindings WHERE operation_id=$1 AND policy_id=$2", [missingBinding.operationId, missingBinding.policyId]); } finally { await owner.query("ALTER TABLE scheduler_run_now_bindings ENABLE TRIGGER USER"); } await assert.rejects(() => readerApi.verifySchedulerHistory(reader, missingBinding.operationId, missingBinding.policyId), /RUN_NOW_BINDING_VIOLATION|MISSING_DATA/);
  const active = await seed(516, true); await writer.createSchedulerRunNow(owner, request(active)); const row = (await owner.query("SELECT run_id::text AS run_id FROM research_runs WHERE operation_id=$1", [active.operationId])).rows[0]; const eventValue = { eventId: id(930000), runId: row.run_id, eventType: "STARTED", eventAt: at(2), executionAuthority: "wave5-active" }; const event = { ...eventValue, ...fields(eventValue) }; await owner.query("INSERT INTO research_run_lifecycle_events(event_id,run_id,event_type,event_at,execution_authority,canonical_version,canonical,canonical_hash) VALUES($1,$2,'STARTED',$3,$4,1,$5,$6)", [event.eventId, event.runId, event.eventAt, event.executionAuthority, event.canonical, Buffer.from(event.canonicalHash, "hex")]);
  await owner.query("ALTER TABLE scheduler_decisions DROP CONSTRAINT chk_scheduler_decision_active_run_evidence"); await owner.query("ALTER TABLE scheduler_decisions DISABLE TRIGGER USER"); try { await owner.query("UPDATE scheduler_decisions SET active_run_historical_state='RUNNING', active_run_running_event_identity=$1, active_run_running_event_hash=decode(repeat('66',32),'hex') WHERE operation_id=$2 AND policy_id=$3", [event.eventId, active.operationId, active.policyId]); } finally { await owner.query("ALTER TABLE scheduler_decisions ENABLE TRIGGER USER"); } await assert.rejects(() => readerApi.verifySchedulerHistory(reader, active.operationId, active.policyId), /MALFORMED_DATA|CANONICAL_MISMATCH|HASH_MISMATCH|DECISION_PRECEDENCE|NONTERMINAL/);
});

test("Wave 5 backdated and genuinely later Run authority are distinguished", { skip: !enabled }, async () => {
  const backdated = await seed(517, true); await writer.createSchedulerRunNow(owner, request(backdated));
  const oldRunValue = { runId: id(970000), operationId: backdated.operationId, strategyIdentity: "external-old", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}", runCreatedAt: before, deadlineAt: at(40), predecessorRunId: null }; const oldRun = { ...oldRunValue, ...fields(oldRunValue) };
  await owner.query("INSERT INTO research_runs(run_id,operation_id,strategy_identity,strategy_version,provider_identity,adapter_identity,adapter_version,execution_parameters_canonical,run_created_at,deadline_at,predecessor_run_id,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13)", [oldRun.runId, oldRun.operationId, oldRun.strategyIdentity, oldRun.strategyVersion, oldRun.providerIdentity, oldRun.adapterIdentity, oldRun.adapterVersion, oldRun.executionParametersCanonical, oldRun.runCreatedAt, oldRun.deadlineAt, oldRun.predecessorRunId, oldRun.canonical, Buffer.from(oldRun.canonicalHash, "hex")]);
  await assert.rejects(() => readerApi.verifySchedulerHistory(reader, backdated.operationId, backdated.policyId), /LIFECYCLE_PREFIX|NONTERMINAL|DECISION_PRECEDENCE|CANONICAL_MISMATCH/);
  const later = await seed(518, true); await writer.createSchedulerRunNow(owner, request(later)); const laterRunValue = { ...oldRunValue, runId: id(970001), operationId: later.operationId, runCreatedAt: at(10), strategyIdentity: "external-later" }; const laterRun = { ...laterRunValue, ...fields(laterRunValue) }; await owner.query("INSERT INTO research_runs(run_id,operation_id,strategy_identity,strategy_version,provider_identity,adapter_identity,adapter_version,execution_parameters_canonical,run_created_at,deadline_at,predecessor_run_id,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13)", [laterRun.runId, laterRun.operationId, laterRun.strategyIdentity, laterRun.strategyVersion, laterRun.providerIdentity, laterRun.adapterIdentity, laterRun.adapterVersion, laterRun.executionParametersCanonical, laterRun.runCreatedAt, laterRun.deadlineAt, laterRun.predecessorRunId, laterRun.canonical, Buffer.from(laterRun.canonicalHash, "hex")]); assert.equal((await readerApi.verifySchedulerHistory(reader, later.operationId, later.policyId)).verified, true);
});

test.after(async () => { if (reader) await reader.end(); if (owner) await owner.end(); });
