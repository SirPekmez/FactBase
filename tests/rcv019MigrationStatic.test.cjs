const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const path = require("node:path");
const migration = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "rcv019_add_temporal_evidence_evolution.sql"),
  "utf8",
);

test("RCV-019 migration contains only the planned four immutable tables", () => {
  for (const table of [
    "rcv019_temporal_evidence_analyses",
    "rcv019_temporal_evidence_points",
    "rcv019_temporal_evidence_point_facets",
    "rcv019_temporal_evidence_transitions",
  ]) assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}\\b`));
  assert.equal((migration.match(/CREATE TABLE public\./g) || []).length, 4);
  assert.match(migration, /knowledge_at TIMESTAMPTZ NOT NULL/);
  assert.doesNotMatch(migration, /knowledge_at[^\n]*DEFAULT/i);
  assert.doesNotMatch(migration, /knowledge_at[^\n]*(now\(|transaction_timestamp\()/i);
  assert.match(migration, /ON DELETE NO ACTION ON UPDATE NO ACTION/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
});
