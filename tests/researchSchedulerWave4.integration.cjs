const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");
const schedulerWriter = require("../dist/services/researchSchedulerPostgresWriter");
const schedulerReader = require("../dist/services/researchSchedulerPostgresReader");
const schedulerCanonical = require("../dist/services/researchSchedulerCanonical");
const schedulerTime = require("../dist/services/researchSchedulerTime");
const rcvCanonical = require("../dist/services/rcv021Canonical");
const rcvVerifier = require("../dist/services/rcv021WriteVerifier");
const rcvRepo = require("../dist/services/rcv021PostgresRepository");

const database = process.env.SCHEDULER_W4_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const owner = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 12 }) : null;
const readerRole = "scheduler_reader_wave4";
const reader = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: readerRole, password: "wave4", max: 4 }) : null;
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const before = "2025-12-31T23:59:59.000000Z";
const at = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000000Z`;
const fields = (value) => { const result = rcvCanonical.canonicalizeRcv021Authority(value); return { canonicalVersion: 1, canonical: result.canonical, canonicalHash: result.hash }; };
const request = (fixture, changes = {}) => ({ operationId: fixture.operationId, policyId: fixture.policyId, evaluationAt: changes.evaluationAt || at(0), deadlineAt: changes.deadlineAt || at(40), strategyIdentity: "scheduler-strategy", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}" });

function operationBundle(seed) {
  const base = seed * 100;
  const operationId = id(base + 1), subjectBindingId = id(base + 2), triggerBindingId = id(base + 3);
  const subjectValue = { subjectBindingId, operationId, subjectType: "AUTHENTICATED_OPERATOR_REQUEST", captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: id(base + 5), historicalClaimId: null };
  const triggerValue = { triggerBindingId, operationId, triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: before, executionOwner: "owner", executionContext: "ctx", triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null };
  const operationValue = { operationId, subjectBindingId, triggerBindingId, purpose: "research", scopeCanonical: "{}", operationCreatedAt: before };
  const subject = { ...subjectValue, ...fields(subjectValue) }, trigger = { ...triggerValue, ...fields(triggerValue) }, operation = { ...operationValue, ...fields(operationValue) };
  return { operationId, subject, trigger, operation };
}

async function seed(seed) {
  const fixture = operationBundle(seed);
  await rcvRepo.persistRcv021Bundle(owner, { operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger] });
  fixture.policyId = id(seed * 100 + 50);
  const policy = schedulerCanonical.canonicalizeSchedulerPolicyVersion({ policyId: fixture.policyId, operationId: fixture.operationId, version: "1", enabled: true, effectiveAtMicros: schedulerTime.parseSchedulerTimestamp(at(0)), firstEligibilityAtMicros: schedulerTime.parseSchedulerTimestamp(at(0)), fixedIntervalMicros: "1000000" });
  await owner.query("INSERT INTO public.scheduler_policy_streams(policy_id,operation_id) VALUES($1,$2)", [fixture.policyId, fixture.operationId]);
  await owner.query("INSERT INTO public.scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES($1,1,true,$2,$2,1000000,1,$3,$4)", [fixture.policyId, at(0), policy.canonical, Buffer.from(policy.hash, "hex")]);
  return fixture;
}

async function appendPolicyVersion(fixture, version, effectiveAt, enabled = true) {
  const policy = schedulerCanonical.canonicalizeSchedulerPolicyVersion({ policyId: fixture.policyId, operationId: fixture.operationId, version: String(version), enabled, effectiveAtMicros: schedulerTime.parseSchedulerTimestamp(effectiveAt), firstEligibilityAtMicros: schedulerTime.parseSchedulerTimestamp(at(0)), fixedIntervalMicros: "1000000" });
  await owner.query("INSERT INTO public.scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,$4,$5,1000000,1,$6,$7)", [fixture.policyId, version, enabled, effectiveAt, at(0), policy.canonical, Buffer.from(policy.hash, "hex")]);
}

async function appendClose(fixture, eventAt = at(10)) {
  const value = { eventId: id(900000 + Number(fixture.policyId.slice(-3))), operationId: fixture.operationId, eventType: "CLOSED", eventAt, actorIdentity: "operator" };
  const event = { ...value, ...fields(value) };
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await rcvRepo.persistRcv021BundleWithinTransaction(client, rcvVerifier.verifyRcv021Write({ operations: [fixture.operation], subjects: [fixture.subject], triggers: [fixture.trigger], operationLifecycleEvents: [event] }));
    await client.query("COMMIT");
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
}

async function disableSchedulerTrigger(table) { await owner.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`); }
async function enableSchedulerTrigger(table) { await owner.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`); }
async function decisionRow(fixture) { return (await owner.query("SELECT * FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId])).rows[0]; }

function manifestId(operationId, policyId, slotIndex, evaluationAt) {
  const micros = schedulerTime.parseSchedulerTimestamp(evaluationAt).toString();
  const digest = createHash("sha256").update("factbase/scheduler-manifest/v1\0", "utf8").update(`${operationId}:${policyId}:${slotIndex}:${micros}`, "utf8").digest();
  const bytes = Buffer.from(digest.subarray(0, 16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function insertBranchDecision(fixture, slot = "2", dropSuccessorIndex = true) {
  const first = await decisionRow(fixture);
  const run = (await owner.query("SELECT run_id::text AS run_id, canonical_hash, encode(canonical_hash,'hex') AS hash FROM research_runs WHERE operation_id=$1", [fixture.operationId])).rows[0];
  const operation = (await owner.query("SELECT operation_created_at, canonical_version, encode(canonical_hash,'hex') AS hash FROM research_operations WHERE operation_id=$1", [fixture.operationId])).rows[0];
  const evalAt = at(Number(slot)); const mid = manifestId(fixture.operationId, fixture.policyId, slot, evalAt);
  const members = [{ authorityKind: "OPERATION_CREATED", authoritativeTimeMicros: schedulerTime.parseSchedulerTimestamp(before), authorityIdentity: fixture.operationId, authorityCanonicalVersion: "1", authorityCanonicalHash: operation.hash }, { authorityKind: "RUN_CREATED", authoritativeTimeMicros: schedulerTime.parseSchedulerTimestamp(at(0)), authorityIdentity: run.run_id, authorityCanonicalVersion: "1", authorityCanonicalHash: run.hash }];
  const manifest = schedulerCanonical.canonicalizeSchedulerLifecyclePrefixManifest({ manifestId: mid, operationId: fixture.operationId, policyId: fixture.policyId, slotIndex: slot, evaluationAtMicros: schedulerTime.parseSchedulerTimestamp(evalAt), members });
  await owner.query("INSERT INTO scheduler_lifecycle_prefix_manifests(manifest_id,operation_id,policy_id,slot_index,evaluation_at,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,$4,$5,1,$6,$7)", [mid, fixture.operationId, fixture.policyId, slot, evalAt, manifest.canonical, Buffer.from(manifest.hash, "hex")]);
  for (const member of manifest.value.members) await owner.query("INSERT INTO scheduler_lifecycle_prefix_members(manifest_id,authority_kind,authoritative_time,authority_identity,authority_canonical_version,authority_canonical_hash) VALUES($1,$2,$3,$4,$5,$6)", [mid, member.authorityKind, schedulerTime.formatSchedulerTimestamp(BigInt(member.authoritativeTimeMicros)), member.authorityIdentity, 1, Buffer.from(member.authorityCanonicalHash, "hex")]);
  const next = at(Number(slot) + 1);
  const decision = schedulerCanonical.canonicalizeSchedulerDecision({ operationId: fixture.operationId, policyId: fixture.policyId, slotIndex: slot, previousDecisionIdentity: { operationId: fixture.operationId, policyId: fixture.policyId, slotIndex: "0" }, previousDecisionCanonicalHash: first.canonical_hash.toString("hex"), policyVersion: "1", policyVersionCanonicalHash: first.policy_version_canonical_hash.toString("hex"), scheduledAtMicros: schedulerTime.parseSchedulerTimestamp(at(Number(slot))), evaluationAtMicros: schedulerTime.parseSchedulerTimestamp(evalAt), decision: "NO_ACTION", reason: "ACTIVE_RUN", nextEligibleAtMicros: schedulerTime.parseSchedulerTimestamp(next), operationManifestId: mid, operationManifestHash: manifest.hash, activeRunId: run.run_id, activeRunCreationIdentity: run.run_id, activeRunCreationHash: run.hash, activeRunHistoricalState: "PLANNED", activeRunRunningEventIdentity: null, activeRunRunningEventHash: null, runNowBindingIdentity: null, runNowRunId: null });
  if (dropSuccessorIndex) await owner.query("DROP INDEX uq_scheduler_decision_successor");
  await owner.query("INSERT INTO scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,previous_decision_canonical_hash,active_run_id,active_run_creation_identity,active_run_creation_hash,active_run_historical_state,canonical_version,canonical,canonical_hash) VALUES($1,$2,$3,1,$4,$5,$6,'NO_ACTION','ACTIVE_RUN',$7,$8,$9,$1,$2,0,$10,$11,$11,$12,'PLANNED',1,$13,$14)", [fixture.operationId, fixture.policyId, slot, Buffer.from(first.policy_version_canonical_hash), at(Number(slot)), evalAt, next, mid, Buffer.from(manifest.hash, "hex"), Buffer.from(first.canonical_hash), run.run_id, Buffer.from(run.hash, "hex"), decision.canonical, Buffer.from(decision.hash, "hex")]);
}

test.before(async () => {
  if (!enabled) return;
  await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${readerRole}') THEN CREATE ROLE ${readerRole} LOGIN PASSWORD 'wave4'; END IF; END $$`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${readerRole}`);
  await owner.query(`REVOKE CREATE ON SCHEMA public FROM ${readerRole}`);
  const tables = (await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'scheduler_%' OR tablename LIKE 'research_%')")).rows;
  for (const row of tables) await owner.query(`GRANT SELECT ON public.${row.tablename} TO ${readerRole}`);
});

test("independent SELECT-only Reader verifies valid authority and survives restart", { skip: !enabled }, async () => {
  const fixture = await seed(401);
  const committed = await schedulerWriter.createSchedulerRunNow(owner, request(fixture));
  assert.equal(committed.status, "COMMITTED");
  const verified = await schedulerReader.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId);
  assert.deepEqual(verified, { verified: true, operationId: fixture.operationId, policyId: fixture.policyId, decisionCount: 1, tailSlotIndex: "0" });
  await assert.rejects(() => reader.query("INSERT INTO scheduler_policy_streams(policy_id,operation_id) VALUES($1,$2)", [id(999901), id(999902)]), /permission denied/);
  const restarted = new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: readerRole, password: "wave4", max: 2 });
  try { assert.deepEqual(await schedulerReader.verifySchedulerHistory(restarted, fixture.operationId, fixture.policyId), verified); } finally { await restarted.end(); }
});

test("later mutable-looking state does not rewrite an older cutoff, while backdated authority fails closed", { skip: !enabled }, async () => {
  const fixture = await seed(402);
  await schedulerWriter.createSchedulerRunNow(owner, request(fixture));
  await appendPolicyVersion(fixture, 2, at(10), true);
  await appendClose(fixture, at(10));
  assert.equal((await schedulerReader.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId)).verified, true);
  const backdated = await seed(408);
  await schedulerWriter.createSchedulerRunNow(owner, request(backdated));
  await appendClose(backdated, at(0));
  await assert.rejects(() => schedulerReader.verifySchedulerHistory(reader, backdated.operationId, backdated.policyId), /LIFECYCLE_PREFIX_VIOLATION|LIFECYCLE_VIOLATION/);
});

test("Reader recomputes a valid historical ACTIVE_RUN Decision", { skip: !enabled }, async () => {
  const fixture = await seed(403);
  await schedulerWriter.createSchedulerRunNow(owner, request(fixture));
  await insertBranchDecision(fixture, "2", false);
  assert.deepEqual(await schedulerReader.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId), { verified: true, operationId: fixture.operationId, policyId: fixture.policyId, decisionCount: 2, tailSlotIndex: "2" });
});

test("Reader detects canonical corruption without repairing persisted authority", { skip: !enabled }, async () => {
  const fixture = await seed(404);
  await schedulerWriter.createSchedulerRunNow(owner, request(fixture));
  const before = await decisionRow(fixture);
  await disableSchedulerTrigger("scheduler_decisions");
  try { await owner.query("UPDATE scheduler_decisions SET canonical_hash=decode(repeat('00',32),'hex') WHERE operation_id=$1 AND policy_id=$2", [fixture.operationId, fixture.policyId]); } finally { await enableSchedulerTrigger("scheduler_decisions"); }
  await assert.rejects(() => schedulerReader.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId), /HASH_MISMATCH|CANONICAL_MISMATCH|LIFECYCLE_PREFIX_VIOLATION/);
  const after = await decisionRow(fixture);
  assert.equal(after.canonical_hash.toString("hex"), "00".repeat(32));
  assert.notEqual(after.canonical_hash.toString("hex"), before.canonical_hash.toString("hex"));
});

test("Reader detects manifest-member corruption and missing predecessor authority", { skip: !enabled }, async () => {
  const fixture = await seed(405);
  await schedulerWriter.createSchedulerRunNow(owner, request(fixture));
  const member = (await owner.query("SELECT * FROM scheduler_lifecycle_prefix_members WHERE manifest_id=(SELECT manifest_id FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2)", [fixture.operationId, fixture.policyId])).rows[0];
  await disableSchedulerTrigger("scheduler_lifecycle_prefix_members");
  try { await owner.query("UPDATE scheduler_lifecycle_prefix_members SET authority_canonical_hash=decode(repeat('11',32),'hex') WHERE manifest_id=$1 AND authority_kind=$2 AND authority_identity=$3", [member.manifest_id, member.authority_kind, member.authority_identity]); } finally { await enableSchedulerTrigger("scheduler_lifecycle_prefix_members"); }
  await assert.rejects(() => schedulerReader.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId), /HASH_MISMATCH|CANONICAL_MISMATCH|LIFECYCLE_PREFIX_VIOLATION/);
  await disableSchedulerTrigger("scheduler_lifecycle_prefix_members");
  try { await owner.query("UPDATE scheduler_lifecycle_prefix_members SET authority_canonical_hash=$1 WHERE manifest_id=$2 AND authority_kind=$3 AND authority_identity=$4", [member.authority_canonical_hash, member.manifest_id, member.authority_kind, member.authority_identity]); } finally { await enableSchedulerTrigger("scheduler_lifecycle_prefix_members"); }
  await disableSchedulerTrigger("scheduler_decisions");
  try { await owner.query("UPDATE scheduler_decisions SET previous_operation_id=$1, previous_policy_id=$2, previous_slot_index=99, previous_decision_canonical_hash=decode(repeat('22',32),'hex') WHERE operation_id=$3 AND policy_id=$4", [id(999991), fixture.policyId, fixture.operationId, fixture.policyId]); } finally { await enableSchedulerTrigger("scheduler_decisions"); }
  await assert.rejects(() => schedulerReader.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId), /MISSING_DATA|IDENTITY_MISMATCH|CANONICAL_MISMATCH|HASH_MISMATCH|predecessor/);
});

test("Reader rejects persisted branch, self-cycle, and disconnected chain authority", { skip: !enabled }, async () => {
  const fixture = await seed(406);
  await schedulerWriter.createSchedulerRunNow(owner, request(fixture));
  await insertBranchDecision(fixture);
  await insertBranchDecision(fixture, "3", false);
  await assert.rejects(() => schedulerReader.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId), /branch|DUPLICATE_CONFLICT|LIFECYCLE_PREFIX_VIOLATION/);
  await owner.query("ALTER TABLE scheduler_decisions DISABLE TRIGGER USER");
  await owner.query("DELETE FROM scheduler_decisions WHERE operation_id=$1 AND policy_id=$2 AND slot_index>0", [fixture.operationId, fixture.policyId]);
  await owner.query("ALTER TABLE scheduler_decisions ENABLE TRIGGER USER");
  await owner.query("ALTER TABLE scheduler_lifecycle_prefix_members DISABLE TRIGGER USER");
  await owner.query("DELETE FROM scheduler_lifecycle_prefix_members WHERE manifest_id IN (SELECT manifest_id FROM scheduler_lifecycle_prefix_manifests WHERE operation_id=$1 AND policy_id=$2 AND slot_index>0)", [fixture.operationId, fixture.policyId]);
  await owner.query("ALTER TABLE scheduler_lifecycle_prefix_members ENABLE TRIGGER USER");
  await owner.query("ALTER TABLE scheduler_lifecycle_prefix_manifests DISABLE TRIGGER USER");
  await owner.query("DELETE FROM scheduler_lifecycle_prefix_manifests WHERE operation_id=$1 AND policy_id=$2 AND slot_index>0", [fixture.operationId, fixture.policyId]);
  await owner.query("ALTER TABLE scheduler_lifecycle_prefix_manifests ENABLE TRIGGER USER");
  await owner.query("CREATE UNIQUE INDEX uq_scheduler_decision_successor ON public.scheduler_decisions (policy_id, previous_operation_id, previous_policy_id, previous_slot_index) WHERE previous_operation_id IS NOT NULL AND previous_policy_id IS NOT NULL AND previous_slot_index IS NOT NULL AND previous_decision_canonical_hash IS NOT NULL");
  await owner.query("ALTER TABLE scheduler_decisions DISABLE TRIGGER USER");
  try { await owner.query("UPDATE scheduler_decisions SET previous_operation_id=$1, previous_policy_id=$2, previous_slot_index=0, previous_decision_canonical_hash=decode(repeat('33',32),'hex') WHERE operation_id=$3 AND policy_id=$4 AND slot_index=0", [fixture.operationId, fixture.policyId, fixture.operationId, fixture.policyId]); } finally { await owner.query("ALTER TABLE scheduler_decisions ENABLE TRIGGER USER"); }
  await assert.rejects(() => schedulerReader.verifySchedulerHistory(reader, fixture.operationId, fixture.policyId), /predecessor|CANONICAL_MISMATCH|HASH_MISMATCH|LIFECYCLE_PREFIX_VIOLATION/);
});

test.after(async () => { if (reader) await reader.end(); if (owner) await owner.end(); });
