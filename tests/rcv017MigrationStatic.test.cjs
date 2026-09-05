const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "migrations",
  "rcv017_add_claim_evidence_dependency_analysis.sql",
);

const TABLES = [
  "dependency_analysis_policies",
  "dependency_analysis_policy_relationships",
  "claim_evidence_dependency_analyses",
  "dependency_analysis_evidence_relations",
  "dependency_analysis_bindings",
  "dependency_analysis_shared_artifact_findings",
  "dependency_analysis_shared_artifact_members",
  "dependency_analysis_common_upstream_findings",
  "dependency_analysis_common_upstream_members",
  "dependency_analysis_common_upstream_witness_steps",
  "dependency_analysis_no_common_upstream_findings",
  "dependency_analysis_knowledge_incomplete_findings",
  "dependency_analysis_knowledge_affected_artifacts",
  "dependency_analysis_knowledge_state_evidence",
  "dependency_analysis_derived_unrecorded_evidence",
];

const FUNCTIONS = [
  "rcv017_guard_historical_row",
  "rcv017_validate_dependency_analysis_policy",
  "rcv017_validate_claim_evidence_dependency_analysis",
];

function migration() {
  assert.equal(
    fs.existsSync(MIGRATION_PATH),
    true,
    "RCV-017 migration must exist before migration conformance can pass",
  );
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

function occurrences(source, expression) {
  return [...source.matchAll(expression)].length;
}

test("RCV-017 migration has the exact frozen object inventory", () => {
  const sql = migration();
  const createdTables = [...sql.matchAll(/CREATE TABLE public\.([a-z0-9_]+)\s*\(/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(createdTables, TABLES);
  assert.equal(occurrences(sql, /\bPRIMARY KEY\s*\(/g), 15);
  assert.equal(occurrences(sql, /\bUNIQUE\s*\(/g), 3);
  assert.equal(occurrences(sql, /\bFOREIGN KEY\s*\(/g), 39);
  assert.equal(occurrences(sql, /\bCHECK\s*\(/g), 13);
  assert.equal(occurrences(sql, /CREATE (?:CONSTRAINT )?TRIGGER\s+/g), 30);
  assert.equal(occurrences(sql, /CREATE OR REPLACE FUNCTION public\.rcv017_/g), 3);
  for (const name of FUNCTIONS) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  }
});

test("RCV-017 migration preserves typed, append-only, NO ACTION boundaries", () => {
  const sql = migration();
  assert.equal(occurrences(sql, /CREATE TRIGGER trg_rcv017_guard_/g), 15);
  assert.equal(occurrences(sql, /CREATE CONSTRAINT TRIGGER trg_rcv017_validate_/g), 15);
  assert.equal(occurrences(sql, /ON DELETE NO ACTION ON UPDATE NO ACTION/g), 39);
  assert.doesNotMatch(sql, /\bCASCADE\b/i);
  assert.doesNotMatch(sql, /\bJSONB?\b/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.(?:provenance_|evidence_|knowledge_|artifact_|source_|claim_)/i);
  assert.doesNotMatch(sql, /CREATE TABLE public\.dependency_analysis_findings\b/i);
  assert.doesNotMatch(sql, /\b(?:current|latest|winner|effective|best|independence_score|confidence|weight|rank)\b/i);
});

test("RCV-017 policy and findings remain closed and SQL does not become a semantic engine", () => {
  const sql = migration();
  for (const relationship of [
    "quotes",
    "incorporates",
    "reposts",
    "syndicated_from",
    "derived_from",
    "uses_information_from",
  ]) {
    assert.match(sql, new RegExp(`'${relationship}'`));
  }
  assert.doesNotMatch(sql, /relationship\s+IN\s*\([^)]*'cites'/is);
  assert.match(sql, /dependency_analysis_shared_artifact_findings/);
  assert.match(sql, /dependency_analysis_common_upstream_findings/);
  assert.match(sql, /dependency_analysis_no_common_upstream_findings/);
  assert.match(sql, /dependency_analysis_knowledge_incomplete_findings/);
  assert.match(sql, /dependency_analysis_common_upstream_witness_steps/);
  assert.doesNotMatch(sql, /WITH\s+RECURSIVE/i);
  assert.doesNotMatch(sql, /json_build|jsonb_build|json_agg|jsonb_agg/i);
  assert.doesNotMatch(sql, /derivedUnrecordedStates|derived_unrecorded_states/);
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE )?FUNCTION[^;]*(?:canonicalize|jcs)/is);
});
