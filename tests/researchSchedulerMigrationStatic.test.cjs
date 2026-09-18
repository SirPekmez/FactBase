const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "..",
  "migrations",
  "scheduler_add_research_scheduler_policy.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

const tables = [
  "scheduler_policy_streams",
  "scheduler_policy_versions",
  "scheduler_decisions",
  "scheduler_lifecycle_prefix_manifests",
  "scheduler_lifecycle_prefix_members",
  "scheduler_run_now_bindings",
];

test("Scheduler migration has exactly the six frozen authority tables", () => {
  assert.equal((migration.match(/CREATE TABLE public\./g) || []).length, tables.length);
  for (const table of tables) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}\\b`));
  }
  assert.doesNotMatch(migration, /scheduler_(evaluation|tail|issuance|queue|current_policy)/i);
  assert.doesNotMatch(migration, /CREATE SEQUENCE/i);
});

test("Scheduler migration has frozen closed vocabularies and timestamp/BIGINT shapes", () => {
  assert.match(migration, /CREATE TYPE public\.scheduler_decision_value AS ENUM \(\s*'RUN_NOW',\s*'NO_ACTION'\s*\)/s);
  assert.match(migration, /CREATE TYPE public\.scheduler_decision_reason AS ENUM \([\s\S]*'INITIAL_ELIGIBILITY'[\s\S]*'INTERVAL_ELIGIBILITY'[\s\S]*'ACTIVE_RUN'[\s\S]*'OPERATION_CLOSED'[\s\S]*'POLICY_DISABLED'[\s\S]*'MISSED_SLOT_COALESCED'[\s\S]*\)/);
  assert.doesNotMatch(migration, /SCHEDULE_LATER|NOT_YET_ELIGIBLE/);
  assert.match(migration, /effective_at TIMESTAMPTZ\(6\) NOT NULL/);
  assert.match(migration, /first_eligibility_at TIMESTAMPTZ\(6\) NOT NULL/);
  assert.match(migration, /fixed_interval_micros BIGINT NOT NULL/);
  assert.match(migration, /slot_index BIGINT NOT NULL/);
  assert.doesNotMatch(migration, /epoch_micro|epochMicros|issued_at|issuanceOrdinal/i);
});

test("Scheduler migration has identity, predecessor, referential, and immutable guards", () => {
  assert.match(migration, /PRIMARY KEY \(operation_id, policy_id, slot_index\)/);
  assert.match(migration, /chk_scheduler_decision_predecessor_shape/);
  assert.match(migration, /uq_scheduler_decision_genesis/);
  assert.match(migration, /uq_scheduler_decision_successor/);
  assert.match(migration, /FOREIGN KEY \(policy_id, policy_version\)/);
  assert.match(migration, /FOREIGN KEY \(operation_id, policy_id, slot_index\)/);
  assert.match(migration, /ON DELETE NO ACTION ON UPDATE NO ACTION/);
  assert.doesNotMatch(migration, /ON DELETE CASCADE|ON UPDATE CASCADE/i);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.%I FOR EACH ROW EXECUTE FUNCTION public\.scheduler_guard_immutable/);
  assert.equal((migration.match(/trg_scheduler_immutable_/g) || []).length, 1);
});

test("Scheduler migration has row-local decision matrix and conditional checks", () => {
  assert.match(migration, /chk_scheduler_decision_reason_matrix/);
  assert.match(migration, /chk_scheduler_decision_next_eligibility/);
  assert.match(migration, /chk_scheduler_decision_active_run_evidence/);
  assert.match(migration, /chk_scheduler_decision_run_now_binding_evidence/);
  assert.match(migration, /chk_scheduler_policy_version_positive/);
  assert.match(migration, /chk_scheduler_policy_interval_positive/);
  assert.match(migration, /chk_scheduler_decision_slot_nonnegative/);
  assert.match(migration, /chk_scheduler_binding_canonical_hash/);
});
