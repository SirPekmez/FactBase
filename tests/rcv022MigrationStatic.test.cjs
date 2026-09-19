const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(__dirname, '..', 'migrations', 'rcv022_add_semantic_analysis_authority.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

const tables = [
  'rcv022_evidence_fragments',
  'rcv022_claim_evidence_matches',
  'rcv022_evidence_assessments',
  'rcv022_semantic_analysis_envelopes',
  'rcv022_envelope_match_refs',
  'rcv022_envelope_assessment_refs',
];

test('RCV-022 Wave A migration has exactly the frozen six-table model', () => {
  for (const table of tables) assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}\\b`));
  assert.equal((sql.match(/CREATE TABLE public\.rcv022_/g) || []).length, 6);
});

test('RCV-022 Wave A migration has the exact fourteen NO ACTION foreign keys', () => {
  const names = [
    'fk_rcv022_fragment_capture', 'fk_rcv022_match_claim', 'fk_rcv022_match_claim_version',
    'fk_rcv022_match_fragment', 'fk_rcv022_assessment_match', 'fk_rcv022_assessment_claim',
    'fk_rcv022_assessment_claim_version', 'fk_rcv022_assessment_fragment',
    'fk_rcv022_envelope_claim', 'fk_rcv022_envelope_claim_version',
    'fk_rcv022_match_ref_envelope', 'fk_rcv022_match_ref_match',
    'fk_rcv022_assessment_ref_envelope', 'fk_rcv022_assessment_ref_assessment',
  ];
  for (const name of names) assert.match(sql, new RegExp(`CONSTRAINT ${name}\\b`));
  assert.equal((sql.match(/CONSTRAINT fk_rcv022_/g) || []).length, 14);
  assert.equal((sql.match(/ON DELETE NO ACTION ON UPDATE NO ACTION/g) || []).length, 14);
});

test('RCV-022 Wave A trigger inventory is exact', () => {
  const immutable = (sql.match(/CREATE TRIGGER trg_rcv022_immutable_/g) || []).length;
  const admission = (sql.match(/CREATE TRIGGER trg_rcv022_validate_.*_insert_projection/g) || []).length;
  const deferred = (sql.match(/CREATE CONSTRAINT TRIGGER trg_rcv022_validate_envelope_membership_/g) || []).length;
  assert.equal(immutable, 6);
  assert.equal(admission, 4);
  assert.equal(deferred, 3);
  assert.equal((sql.match(/DEFERRABLE INITIALLY DEFERRED FOR EACH ROW/g) || []).length, 3);
});

test('RCV-022 Wave A migration freezes fail-closed timestamp and projection guards', () => {
  assert.match(sql, /TIMESTAMPTZ\(6\)/);
  assert.match(sql, /infinite timestamp/);
  assert.match(sql, /timestamp year outside RCV-022 domain/);
  assert.match(sql, /canonical hash mismatch/);
  assert.match(sql, /malformed canonical JSON/);
  assert.match(sql, /IS DISTINCT FROM/);
  assert.match(sql, /JSON projection mismatch/);
});

test('RCV-022 Wave A migration includes the corrected toolParticipation authority rule', () => {
  assert.match(sql, /required:=ARRAY\[[^;]*'toolParticipation'[^;]*\]/s);
  assert.equal((sql.match(/'toolParticipation'/g) || []).length >= 2, true);
  assert.match(sql, /NOT IN \('USED','NOT_USED'\)/);
  assert.match(sql, /USED requires toolContextHash/);
  assert.match(sql, /NOT_USED forbids toolContextHash/);
  assert.match(sql, /required,ARRAY\['toolContextHash'\]/);
});
