const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "..",
  "migrations",
  "rcv009_create_claims_historical_authority.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

const authorityTables = [
  "claim_identity_authorities",
  "claim_version_authorities",
];

test("Claim Historical Authority migration has exactly two additive tables", () => {
  assert.equal((migration.match(/CREATE TABLE public\./g) || []).length, 2);
  for (const table of authorityTables) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}\\b`));
  }
  assert.doesNotMatch(migration, /CREATE TABLE public\.(?!claim_(?:identity|version)_authorities)/);
});

test("Claim Historical Authority migration has exact canonical columns and constraints", () => {
  assert.match(migration, /claim_id UUID PRIMARY KEY/);
  assert.match(migration, /canonical_version INTEGER NOT NULL/);
  assert.match(migration, /canonical TEXT NOT NULL/);
  assert.match(migration, /canonical_hash TEXT NOT NULL/);
  for (const column of [
    "claim_version_id UUID PRIMARY KEY",
    "claim_id UUID NOT NULL",
    "version_number INTEGER NOT NULL",
    "title TEXT NOT NULL",
    "normalized_statement TEXT NOT NULL",
    "language TEXT NOT NULL",
    "claim_type TEXT NOT NULL",
  ]) assert.match(migration, new RegExp(column.replace(/[()]/g, "\\$&")));
  assert.match(migration, /UNIQUE \(claim_id, version_number\)/);
  assert.equal((migration.match(/FOREIGN KEY \(/g) || []).length, 4);
  assert.equal((migration.match(/ON DELETE NO ACTION ON UPDATE NO ACTION/g) || []).length, 4);
  assert.equal((migration.match(/canonical_version = 1/g) || []).length, 2);
  assert.equal((migration.match(/canonical_hash ~ '\^\[0-9a-f\]\{64\}\$'/g) || []).length, 2);
});

test("Claim Historical Authority migration has exactly four intended triggers", () => {
  assert.equal((migration.match(/CREATE TRIGGER /g) || []).length, 4);
  for (const trigger of [
    "trg_claim_identity_authority_immutable",
    "trg_claim_version_authority_immutable",
    "trg_claim_authenticated_source_protection",
    "trg_claim_version_authenticated_source_protection",
  ]) assert.match(migration, new RegExp(`CREATE TRIGGER ${trigger}\\b`));
  assert.equal((migration.match(/CREATE OR REPLACE FUNCTION /g) || []).length, 2);
});

test("Claim Historical Authority migration is additive and never backfills", () => {
  assert.doesNotMatch(migration, /ALTER TABLE public\.(claims|claim_versions)/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.claim_(?:identity|version)_authorities/i);
  assert.doesNotMatch(migration, /ON DELETE CASCADE|ON UPDATE CASCADE|SET NULL|SET DEFAULT/i);
  assert.doesNotMatch(migration, /reauthor/i);
  assert.doesNotMatch(migration, /rcv022/i);
});
