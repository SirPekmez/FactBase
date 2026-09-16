const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "..",
  "migrations",
  "rcv020_add_observatory_radar_ingestion.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

const tables = [
  "rcv020_logical_sources",
  "rcv020_monitors",
  "rcv020_monitor_configuration_versions",
  "rcv020_configuration_lifecycle_events",
  "rcv020_observation_occurrences",
  "rcv020_observation_occurrence_resolutions",
  "rcv020_retrieval_attempts",
  "rcv020_retrieval_attempt_resolutions",
  "rcv020_captures",
  "rcv020_capture_comparisons",
  "rcv020_quarantined_payloads",
  "rcv020_retention_availability_events",
  "rcv020_authenticated_handoffs",
];

test("RCV-020 migration has the exact additive table inventory", () => {
  assert.equal((migration.match(/CREATE TABLE public\./g) || []).length, tables.length);
  for (const table of tables) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}\\b`));
  }
  assert.doesNotMatch(migration, /research_trigger/i);
  assert.doesNotMatch(migration, /RESTORED/);
});

test("RCV-020 migration freezes the closed enums and outcome domains", () => {
  for (const type of [
    "rcv020_trigger_origin",
    "rcv020_occurrence_outcome",
    "rcv020_attempt_outcome",
    "rcv020_lifecycle_event_type",
    "rcv020_failure_code",
    "rcv020_retention_event_type",
    "rcv020_comparison_result",
  ]) assert.match(migration, new RegExp(`CREATE TYPE public\\.${type}\\b`));
  assert.match(migration, /CREATE TYPE public\.rcv020_occurrence_outcome AS ENUM \('SUCCEEDED', 'FAILED', 'MISSED', 'SKIPPED'\)/);
  assert.match(migration, /CAPTURED_CHANGED.*CAPTURED_UNCHANGED.*CAPTURED_EMPTY.*FAILED/s);
  assert.doesNotMatch(migration, /DISABLED.*NOT_APPLICABLE/);
});

test("RCV-020 migration has restrictive historical foreign keys", () => {
  assert.doesNotMatch(migration, /ON DELETE CASCADE/i);
  assert.match(migration, /ON DELETE NO ACTION ON UPDATE NO ACTION/);
  assert.match(migration, /REFERENCES public\.rcv020_monitors \(monitor_id, logical_source_id\)/);
  assert.match(migration, /REFERENCES public\.rcv020_monitor_configuration_versions\s+\(monitor_configuration_version_id, monitor_id\)/);
});

test("RCV-020 migration covers immutable lifecycle, resolution, and object authority", () => {
  assert.match(migration, /NOT_ACTIVATED.*ACTIVE.*PAUSED.*RETIRED/s);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER trg_rcv020_lifecycle_validate/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER trg_rcv020_config_overlap/);
  assert.match(migration, /cfg\.effective_until IS NOT NULL AND EXISTS \([\s\S]*event_type = 'RETIRED'/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER trg_rcv020_attempt_lineage/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER trg_rcv020_attempt_capture_parity/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER trg_rcv020_occurrence_resolution_validate/);
  assert.match(migration, /CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public\.%I/);
  assert.match(migration, /trg_rcv020_immutable_' \|\| table_name/);
  assert.match(migration, /uq_rcv020_attempt_occurrence_retry/);
  assert.match(migration, /retrieval_attempt_id UUID NOT NULL UNIQUE/);
  assert.match(migration, /uq_rcv020_handoff_idempotency/);
});

test("RCV-020 migration has exact BIGINT and half-open interval safeguards", () => {
  assert.match(migration, /version_number BIGINT NOT NULL/);
  assert.match(migration, /retry_number BIGINT NOT NULL/);
  assert.match(migration, /event_sequence BIGINT NOT NULL/);
  assert.match(migration, /identity_canonical JSONB NOT NULL/);
  assert.match(migration, /identity_hash BYTEA NOT NULL/);
  assert.match(migration, /canonical JSONB NOT NULL/);
  assert.match(migration, /canonical_hash BYTEA NOT NULL/);
  assert.doesNotMatch(migration, /byte_length BIGINT/);
  assert.equal((migration.match(/(?:version_number|retry_number|event_sequence) BIGINT NOT NULL/g) || []).length, 3);
  assert.match(migration, /version_number >= 1/);
  assert.match(migration, /retry_number >= 1/);
  assert.match(migration, /event_sequence >= 1/);
  assert.match(migration, /a\.effective_from < COALESCE/);
  assert.match(migration, /b\.effective_from < COALESCE/);
  assert.match(migration, /monitor_configuration_version_id = b\.monitor_configuration_version_id[\s\S]*b\.effective_until/);
  assert.match(migration, /monitor_configuration_version_id = a\.monitor_configuration_version_id[\s\S]*a\.effective_until/);
  assert.match(migration, /attempt_deadline_at >= retrieval_started_at/);
});
