const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const database = process.env.RCV022_WAVE_A_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({
  database,
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 2,
}) : null;
const migrationRoot = path.join(__dirname, '..', 'migrations');
const migrationFiles = () => fs.readdirSync(migrationRoot).filter((n) => n.endsWith('.sql')).sort().map((n) => path.join(migrationRoot, n));

function requireDatabase(t) {
  if (!enabled) { t.skip('set RCV022_WAVE_A_DATABASE, PGHOST, and PGPORT for disposable PostgreSQL proof'); return false; }
  return true;
}

async function replayMigrations() {
  const client = await pool.connect();
  try {
    for (const file of migrationFiles()) await client.query(fs.readFileSync(file, 'utf8'));
  } finally { client.release(); }
}

const ids = {
  claim: '10000000-0000-0000-0000-000000000001',
  version: '20000000-0000-0000-0000-000000000001',
  capture: '30000000-0000-0000-0000-000000000001',
  fragment: '40000000-0000-0000-0000-000000000001',
  match: '50000000-0000-0000-0000-000000000001',
  assessment: '60000000-0000-0000-0000-000000000001',
  envelope: '70000000-0000-0000-0000-000000000001',
};
const h = (c) => crypto.createHash('sha256').update(c, 'utf8').digest('hex');
const hash = (c) => c.repeat(64);
const SQL_NULL = Symbol('SQL_NULL');
const fixture = (id) => ({
  schema: 'RCV022-EVIDENCE-FRAGMENT-V1', canonicalVersion: 1, fragmentId: id,
  captureId: ids.capture, captureCanonicalVersion: 'RCV020-CANONICAL-V1', captureCanonicalHash: hash('c'),
  captureRepresentationHash: hash('b'), fragmentKind: 'TEXT', locator: { kind: 'WHOLE_TEXT' },
  contentBinding: { kind: 'TEXT', utf8Text: 'hello', contentHash: hash('d') }, extractionAuthority: { kind: 'DIRECT' },
});

async function seedUpstream() {
  const client = await pool.connect();
  try {
    await client.query("SET session_replication_role='replica'");
    await client.query('INSERT INTO public.claims(id) VALUES ($1)', [ids.claim]);
    await client.query(`INSERT INTO public.claim_versions
    (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at)
    VALUES ($1,$2,1,'title','statement','en','fact','draft','unpublished','fixture',$3)`, [ids.version, ids.claim, '2026-09-19T12:00:00.000000Z']);
    await client.query(`INSERT INTO public.rcv020_captures
    (capture_id,logical_source_id,monitor_id,monitor_configuration_version_id,occurrence_id,retrieval_attempt_id,request_hash,requested_target,final_url,redirect_canonical,response_status,response_metadata_canonical,media_type,byte_length,observed_at,content_hash,canonical,capture_hash,retention_policy,retention_policy_version,raw_object_identity,raw_object_reference)
    VALUES ($1,$2,$3,$4,$5,$6,repeat('a',64),'https://example.test','https://example.test',NULL,200,'{}','text/plain',1,$7,repeat('b',64),'{}',repeat('c',64),'METADATA_HASH_ONLY',1,NULL,NULL)`, [ids.capture, '31000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001', '2026-09-19T12:00:00.000000Z']);
    await client.query("SET session_replication_role='origin'");
    await client.query('INSERT INTO public.claim_identity_authorities VALUES ($1,1,$2,$3)', [ids.claim, '{}', hash('a')]);
    await client.query('INSERT INTO public.claim_version_authorities VALUES ($1,$2,1,$3,$4,$5,$6,1,$7,$8)', [ids.version, ids.claim, 'title', 'statement', 'en', 'fact', '{}', hash('b')]);
  } finally {
    await client.query("SET session_replication_role='origin'").catch(() => {});
    client.release();
  }
}

async function insertFragment(id, value = fixture(id), projection = {}, executor = pool) {
  const canonical = JSON.stringify(value);
  const p = { locator: value.locator, contentBinding: value.contentBinding, extractionAuthority: value.extractionAuthority, ...projection };
  await executor.query(`INSERT INTO public.rcv022_evidence_fragments
    (fragment_id,canonical_version,canonical,canonical_hash,capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority)
    VALUES ($1,1,$2,$3,$4,'RCV020-CANONICAL-V1',$5,$6,'TEXT',$7::jsonb,$8::jsonb,$9::jsonb)`, [id, canonical, h(canonical), ids.capture, hash('c'), hash('b'), JSON.stringify(p.locator), JSON.stringify(p.contentBinding), JSON.stringify(p.extractionAuthority)]);
}

async function insertEnvelopeValues(client, id, canonicalValue, projection = {}) {
  const canonical = JSON.stringify(canonicalValue);
  const matchRefs = Object.prototype.hasOwnProperty.call(projection, 'matchRefs') ? projection.matchRefs : canonicalValue.matchRefs;
  const assessmentRefs = Object.prototype.hasOwnProperty.call(projection, 'assessmentRefs') ? projection.assessmentRefs : canonicalValue.assessmentRefs;
  const encoded = (value) => value === SQL_NULL ? null : JSON.stringify(value);
  await client.query(`INSERT INTO public.rcv022_semantic_analysis_envelopes
    (envelope_id,canonical_version,canonical,canonical_hash,claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,analysis_cutoff_at,analysis_at,match_refs,assessment_refs,analysis_method_identity,analysis_method_version,analysis_method_hash)
    VALUES ($1,1,$2,$3,$4,1,$5,$6,1,$7,$8,$9,$10::jsonb,$11::jsonb,'fixture','1',$12)`, [id, canonical, h(canonical), ids.claim, hash('a'), ids.version, hash('b'), canonicalValue.analysisCutoffAt, canonicalValue.analysisAt, encoded(matchRefs), encoded(assessmentRefs), hash('3')]);
}

async function insertEnvelope(client, id, matchRefs, assessmentRefs, projection = {}) {
  const canonicalValue = { schema: 'RCV022-SEMANTIC-ANALYSIS-ENVELOPE-V1', canonicalVersion: 1, envelopeId: id, claimId: ids.claim, claimCanonicalVersion: 1, claimCanonicalHash: hash('a'), claimVersionId: ids.version, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: hash('b'), analysisCutoffAt: '2026-09-19T12:00:00.000000Z', analysisAt: '2026-09-19T12:00:00.123456Z', matchRefs, assessmentRefs, analysisMethodIdentity: 'fixture', analysisMethodVersion: '1', analysisMethodHash: hash('3') };
  await insertEnvelopeValues(client, id, canonicalValue, projection);
}

async function expectReject(query, values = [], predicate = undefined) {
  await assert.rejects(pool.query(query, values), predicate);
}

test('RCV-022 fresh PostgreSQL replay and catalog reality', { concurrency: false }, async (t) => {
  if (!requireDatabase(t)) return;
  const pre = await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rcv022_%'");
  assert.equal(pre.rows[0].n, 0, 'Wave A target must be a fresh disposable database');
  await replayMigrations();
  await seedUpstream();
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'rcv022_%' ORDER BY tablename")).rows.map((r) => r.tablename);
  assert.deepEqual(tables, ['rcv022_claim_evidence_matches','rcv022_envelope_assessment_refs','rcv022_envelope_match_refs','rcv022_evidence_assessments','rcv022_evidence_fragments','rcv022_semantic_analysis_envelopes']);
  const fkRows = await pool.query(`
    SELECT c.conname, c.confupdtype, c.confdeltype,
           src.relname AS source_table, tgt.relname AS target_table,
           ARRAY_AGG(sa.attname::text ORDER BY sk.ord)::text[] AS source_columns,
           ARRAY_AGG(ta.attname::text ORDER BY sk.ord)::text[] AS target_columns
    FROM pg_constraint c
    JOIN pg_class src ON src.oid=c.conrelid
    JOIN pg_class tgt ON tgt.oid=c.confrelid
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS sk(attnum,ord) ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS tk(attnum,ord) ON tk.ord=sk.ord
    JOIN pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=sk.attnum
    JOIN pg_attribute ta ON ta.attrelid=tgt.oid AND ta.attnum=tk.attnum
    WHERE c.contype='f' AND src.relname LIKE 'rcv022_%'
    GROUP BY c.oid,c.conname,c.confupdtype,c.confdeltype,src.relname,tgt.relname
    ORDER BY c.conname`);
  const expectedFks = [
    ['fk_rcv022_assessment_claim','rcv022_evidence_assessments','claim_identity_authorities',['claim_id'],['claim_id']],
    ['fk_rcv022_assessment_claim_version','rcv022_evidence_assessments','claim_version_authorities',['claim_version_id'],['claim_version_id']],
    ['fk_rcv022_assessment_fragment','rcv022_evidence_assessments','rcv022_evidence_fragments',['evidence_fragment_id'],['fragment_id']],
    ['fk_rcv022_assessment_match','rcv022_evidence_assessments','rcv022_claim_evidence_matches',['claim_evidence_match_id'],['match_id']],
    ['fk_rcv022_assessment_ref_assessment','rcv022_envelope_assessment_refs','rcv022_evidence_assessments',['assessment_id'],['assessment_id']],
    ['fk_rcv022_assessment_ref_envelope','rcv022_envelope_assessment_refs','rcv022_semantic_analysis_envelopes',['envelope_id'],['envelope_id']],
    ['fk_rcv022_envelope_claim','rcv022_semantic_analysis_envelopes','claim_identity_authorities',['claim_id'],['claim_id']],
    ['fk_rcv022_envelope_claim_version','rcv022_semantic_analysis_envelopes','claim_version_authorities',['claim_version_id'],['claim_version_id']],
    ['fk_rcv022_fragment_capture','rcv022_evidence_fragments','rcv020_captures',['capture_id'],['capture_id']],
    ['fk_rcv022_match_claim','rcv022_claim_evidence_matches','claim_identity_authorities',['claim_id'],['claim_id']],
    ['fk_rcv022_match_claim_version','rcv022_claim_evidence_matches','claim_version_authorities',['claim_version_id'],['claim_version_id']],
    ['fk_rcv022_match_fragment','rcv022_claim_evidence_matches','rcv022_evidence_fragments',['evidence_fragment_id'],['fragment_id']],
    ['fk_rcv022_match_ref_envelope','rcv022_envelope_match_refs','rcv022_semantic_analysis_envelopes',['envelope_id'],['envelope_id']],
    ['fk_rcv022_match_ref_match','rcv022_envelope_match_refs','rcv022_claim_evidence_matches',['match_id'],['match_id']],
  ];
  assert.equal(fkRows.rows.length, expectedFks.length);
  assert.deepEqual(fkRows.rows.map((row) => row.conname).sort(), expectedFks.map((row) => row[0]).sort());
  for (const [name, source, target, sourceColumns, targetColumns] of expectedFks) {
    const row = fkRows.rows.find((candidate) => candidate.conname === name);
    assert.deepEqual(row && [row.source_table,row.target_table,row.source_columns,row.target_columns], [source,target,sourceColumns,targetColumns]);
    assert.equal(row.confupdtype, 'a');
    assert.equal(row.confdeltype, 'a');
  }
  const triggerRows = await pool.query(`
    SELECT tr.tgname,tr.tgrelid::regclass::text AS table_name,tr.tgdeferrable,tr.tginitdeferred,pg_get_triggerdef(tr.oid) AS definition
    FROM pg_trigger tr
    JOIN pg_class rel ON rel.oid=tr.tgrelid
    JOIN pg_namespace ns ON ns.oid=rel.relnamespace
    WHERE ns.nspname='public' AND rel.relname LIKE 'rcv022_%' AND NOT tr.tgisinternal
    ORDER BY tr.tgname`);
  assert.equal(triggerRows.rows.length, 13);
  assert.deepEqual(triggerRows.rows.map((row) => row.tgname).sort(), [
    'trg_rcv022_immutable_claim_evidence_matches',
    'trg_rcv022_immutable_envelope_assessment_refs',
    'trg_rcv022_immutable_envelope_match_refs',
    'trg_rcv022_immutable_evidence_assessments',
    'trg_rcv022_immutable_evidence_fragments',
    'trg_rcv022_immutable_semantic_analysis_envelopes',
    'trg_rcv022_validate_assessment_insert_projection',
    'trg_rcv022_validate_envelope_insert_projection',
    'trg_rcv022_validate_envelope_membership_on_assessment_ref',
    'trg_rcv022_validate_envelope_membership_on_envelope',
    'trg_rcv022_validate_envelope_membership_on_match_ref',
    'trg_rcv022_validate_fragment_insert_projection',
    'trg_rcv022_validate_match_insert_projection',
  ].sort());
  const deferredAttachments = {
    trg_rcv022_validate_envelope_membership_on_envelope: 'rcv022_semantic_analysis_envelopes',
    trg_rcv022_validate_envelope_membership_on_match_ref: 'rcv022_envelope_match_refs',
    trg_rcv022_validate_envelope_membership_on_assessment_ref: 'rcv022_envelope_assessment_refs',
  };
  for (const row of triggerRows.rows.filter((candidate) => candidate.tgname.startsWith('trg_rcv022_immutable_'))) {
    assert.match(row.definition, /BEFORE DELETE OR UPDATE/);
    assert.equal(row.tgdeferrable, false);
  }
  for (const row of triggerRows.rows.filter((candidate) => candidate.tgname.startsWith('trg_rcv022_validate_envelope_membership_'))) {
    assert.equal(row.table_name, deferredAttachments[row.tgname]);
    assert.match(row.definition, /AFTER INSERT/);
    assert.match(row.definition, /DEFERRABLE INITIALLY DEFERRED/);
    assert.equal(row.tgdeferrable, true);
    assert.equal(row.tginitdeferred, true);
    assert.match(row.definition, /rcv022_validate_envelope_membership_commit/);
  }
  const timestampColumns = await pool.query(`SELECT table_name,column_name,data_type,datetime_precision FROM information_schema.columns WHERE table_schema='public' AND ((table_name='rcv022_evidence_assessments' AND column_name='assessed_at') OR (table_name='rcv022_semantic_analysis_envelopes' AND column_name IN ('analysis_at','analysis_cutoff_at'))) ORDER BY table_name,column_name`);
  assert.deepEqual(timestampColumns.rows.map((row) => [row.table_name,row.column_name,row.data_type,Number(row.datetime_precision)]), [
    ['rcv022_evidence_assessments','assessed_at','timestamp with time zone',6],
    ['rcv022_semantic_analysis_envelopes','analysis_at','timestamp with time zone',6],
    ['rcv022_semantic_analysis_envelopes','analysis_cutoff_at','timestamp with time zone',6],
  ]);
});

test('RCV-022 direct SQL admission, timestamp, immutability, and commit parity proof', { concurrency: false }, async (t) => {
  if (!requireDatabase(t)) return;
  await insertFragment(ids.fragment);
  const fragmentCases = [
    ['missing key', ({ ...v }) => { delete v.fragmentId; return v; }],
    ['JSON null', (v) => ({ ...v, canonicalVersion: null })],
    ['wrong type', (v) => ({ ...v, fragmentId: [] })],
    ['extra key', (v) => ({ ...v, extra: true })],
    ['malformed JSON', () => '{'],
  ];
  for (const [name, make] of fragmentCases) {
    const value = make(fixture(`40000000-0000-0000-0000-0000000000${String(fragmentCases.indexOf(fragmentCases.find((x) => x[0] === name)) + 2).padStart(2, '0')}`));
    const canonical = typeof value === 'string' ? value : JSON.stringify(value);
    await expectReject(`INSERT INTO public.rcv022_evidence_fragments
      (fragment_id,canonical_version,canonical,canonical_hash,capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority)
      VALUES ($1,1,$2,$3,$4,'RCV020-CANONICAL-V1',$5,$6,'TEXT',$7::jsonb,$8::jsonb,$9::jsonb)`, [`41000000-0000-0000-0000-0000000000${String(fragmentCases.indexOf(fragmentCases.find((x) => x[0] === name)) + 2).padStart(2, '0')}`, canonical, h(canonical), ids.capture, hash('c'), hash('b'), JSON.stringify(fixture(ids.fragment).locator), JSON.stringify(fixture(ids.fragment).contentBinding), JSON.stringify(fixture(ids.fragment).extractionAuthority)]);
  }
  const embeddedFragmentCases = [
    ['locator missing key', (v) => ({ ...v, locator: {} })],
    ['locator extra key', (v) => ({ ...v, locator: { ...v.locator, extra: true } })],
    ['contentBinding missing key', (v) => ({ ...v, contentBinding: { kind: 'TEXT', utf8Text: 'hello' } })],
    ['contentBinding extra key', (v) => ({ ...v, contentBinding: { ...v.contentBinding, extra: true } })],
    ['extractionAuthority wrong variant', (v) => ({ ...v, extractionAuthority: { kind: 'DERIVED', extractorIdentity: 'x', extractorVersion: '1', extractorHash: hash('e'), extra: true } })],
  ];
  for (const [label, mutate] of embeddedFragmentCases) {
    const value = mutate(fixture(`44000000-0000-0000-0000-00000000${String(embeddedFragmentCases.indexOf(embeddedFragmentCases.find((x) => x[0] === label)) + 1).padStart(4, '0')}`));
    const canonical = JSON.stringify(value);
    await expectReject(`INSERT INTO public.rcv022_evidence_fragments
      (fragment_id,canonical_version,canonical,canonical_hash,capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority)
      VALUES ($1,1,$2,$3,$4,'RCV020-CANONICAL-V1',$5,$6,'TEXT',$7::jsonb,$8::jsonb,$9::jsonb)`, [value.fragmentId, canonical, h(canonical), ids.capture, hash('c'), hash('b'), JSON.stringify(value.locator), JSON.stringify(value.contentBinding), JSON.stringify(value.extractionAuthority)], (error) => error.code === '22023' && /missing or null required key|missing key|unexpected key|invalid extraction/.test(error.message));
  }
  const wrongTypeValues = [
    { ...fixture('43000000-0000-0000-0000-000000000001'), locator: 'not-an-object' },
    { ...fixture('43000000-0000-0000-0000-000000000002'), locator: [] },
    { ...fixture('43000000-0000-0000-0000-000000000003'), canonicalVersion: '1' },
  ];
  for (const value of wrongTypeValues) {
    const canonical = JSON.stringify(value);
    await expectReject(`INSERT INTO public.rcv022_evidence_fragments
      (fragment_id,canonical_version,canonical,canonical_hash,capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority)
      VALUES ($1,1,$2,$3,$4,'RCV020-CANONICAL-V1',$5,$6,'TEXT',$7::jsonb,$8::jsonb,$9::jsonb)`, [value.fragmentId, canonical, h(canonical), ids.capture, hash('c'), hash('b'), JSON.stringify(value.locator), JSON.stringify(value.contentBinding), JSON.stringify(value.extractionAuthority)]);
  }
  await expectReject(`INSERT INTO public.rcv022_evidence_fragments
    (fragment_id,canonical_version,canonical,canonical_hash,capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority)
      VALUES ($1,1,$2,$3,$4,'RCV020-CANONICAL-V1',$5,$6,'TEXT',NULL,$7::jsonb,$8::jsonb)`, ['42000000-0000-0000-0000-000000000001', JSON.stringify(fixture('42000000-0000-0000-0000-000000000001')), h(JSON.stringify(fixture('42000000-0000-0000-0000-000000000001'))), ids.capture, hash('c'), hash('b'), JSON.stringify(fixture(ids.fragment).contentBinding), JSON.stringify(fixture(ids.fragment).extractionAuthority)]);
  const mismatchValue = fixture('42000000-0000-0000-0000-000000000002');
  mismatchValue.locator = { kind: 'UTF8_BYTE_RANGE', startByte: 0, endByteExclusive: 1 };
  const mismatchCanonical = JSON.stringify(mismatchValue);
  await expectReject(`INSERT INTO public.rcv022_evidence_fragments
    (fragment_id,canonical_version,canonical,canonical_hash,capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority)
    VALUES ($1,1,$2,$3,$4,'RCV020-CANONICAL-V1',$5,$6,'TEXT',$7::jsonb,$8::jsonb,$9::jsonb)`, [mismatchValue.fragmentId, mismatchCanonical, h(mismatchCanonical), ids.capture, hash('c'), hash('b'), JSON.stringify(fixture(ids.fragment).locator), JSON.stringify(mismatchValue.contentBinding), JSON.stringify(mismatchValue.extractionAuthority)]);

  const matchCanonical = { schema: 'RCV022-CLAIM-EVIDENCE-MATCH-V1', canonicalVersion: 1, matchId: ids.match, claimId: ids.claim, claimCanonicalVersion: 1, claimCanonicalHash: hash('a'), claimVersionId: ids.version, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: hash('b'), evidenceFragmentId: ids.fragment, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: h(JSON.stringify(fixture(ids.fragment))), matcherIdentity: 'fixture', matcherVersion: '1', matcherHash: hash('f'), matcherInputCanonicalHashes: [] };
  const matchText = JSON.stringify(matchCanonical);
  await pool.query(`INSERT INTO public.rcv022_claim_evidence_matches VALUES ($1,1,$2,$3,$4,1,$5,$6,1,$7,$8,1,$9,$10,$11,$12,$13::jsonb)`, [ids.match, matchText, h(matchText), ids.claim, hash('a'), ids.version, hash('b'), ids.fragment, h(JSON.stringify(fixture(ids.fragment))), 'fixture', '1', hash('f'), '[]']);
  const invalidMatch = { ...matchCanonical, matchId: '50000000-0000-0000-0000-000000000002', matcherInputCanonicalHashes: [42] };
  const invalidMatchText = JSON.stringify(invalidMatch);
  await expectReject(`INSERT INTO public.rcv022_claim_evidence_matches VALUES ($1,1,$2,$3,$4,1,$5,$6,1,$7,$8,1,$9,$10,$11,$12,$13::jsonb)`, [invalidMatch.matchId, invalidMatchText, h(invalidMatchText), ids.claim, hash('a'), ids.version, hash('b'), ids.fragment, h(JSON.stringify(fixture(ids.fragment))), 'fixture', '1', hash('f'), JSON.stringify(invalidMatch.matcherInputCanonicalHashes)], (error) => error.code === '22023' && /invalid hash array/.test(error.message));
  const badHashMatch = { ...matchCanonical, matchId: '50000000-0000-0000-0000-000000000003' };
  const badHashMatchText = JSON.stringify(badHashMatch);
  await expectReject(`INSERT INTO public.rcv022_claim_evidence_matches VALUES ($1,1,$2,$3,$4,1,$5,$6,1,$7,$8,1,$9,$10,$11,$12,$13::jsonb)`, [badHashMatch.matchId, badHashMatchText, hash('9'), ids.claim, hash('a'), ids.version, hash('b'), ids.fragment, h(JSON.stringify(fixture(ids.fragment))), 'fixture', '1', hash('f'), '[]'], (error) => error.code === '23514' && /canonical hash mismatch/.test(error.message));
  const assessmentCanonical = { schema: 'RCV022-EVIDENCE-ASSESSMENT-V1', canonicalVersion: 1, assessmentId: ids.assessment, claimEvidenceMatchId: ids.match, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: h(matchText), claimId: ids.claim, claimCanonicalVersion: 1, claimCanonicalHash: hash('a'), claimVersionId: ids.version, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: hash('b'), evidenceFragmentId: ids.fragment, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: h(JSON.stringify(fixture(ids.fragment))), assessmentResult: { relation: 'SUPPORTS', rationale: 'fixture' }, methodProvenance: { methodType: 'DETERMINISTIC', methodIdentity: 'fixture', methodVersion: '1', methodHash: hash('1'), inputCanonicalHashes: [], structuredOutputHash: hash('2'), reviewStatus: 'NOT_REVIEWED' }, assessedAt: '2026-09-19T12:00:00.123456Z' };
  const assessmentText = JSON.stringify(assessmentCanonical);
  const insertAssessmentVariant = async (value, sqlTimestamp = value.assessedAt, predicate = undefined) => {
    const text = JSON.stringify(value);
    const operation = pool.query(`INSERT INTO public.rcv022_evidence_assessments
    (assessment_id,canonical_version,canonical,canonical_hash,claim_evidence_match_id,claim_evidence_match_canonical_version,claim_evidence_match_canonical_hash,claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,evidence_fragment_id,evidence_fragment_canonical_version,evidence_fragment_canonical_hash,assessment_result,method_provenance,assessed_at)
    VALUES ($1,1,$2,$3,$4,1,$5,$6,1,$7,$8,1,$9,$10,1,$11,$12::jsonb,$13::jsonb,$14)`, [value.assessmentId, text, h(text), ids.match, h(matchText), ids.claim, hash('a'), ids.version, hash('b'), ids.fragment, h(JSON.stringify(fixture(ids.fragment))), JSON.stringify(value.assessmentResult), JSON.stringify(value.methodProvenance), sqlTimestamp]);
    if (predicate) await assert.rejects(operation, predicate); else await operation;
  };
  await insertAssessmentVariant(assessmentCanonical);
  const invalidAssessment = { ...assessmentCanonical, assessmentId: '60000000-0000-0000-0000-000000000002', assessmentResult: 'not-an-object' };
  await insertAssessmentVariant(invalidAssessment, invalidAssessment.assessedAt, (error) => error.code === '22023' && /expected JSON object|RCV-022 missing/.test(error.message));
  const missingAssessmentResultKey = { ...assessmentCanonical, assessmentId: '60000000-0000-0000-0000-000000000004', assessmentResult: { rationale: 'fixture' } };
  await insertAssessmentVariant(missingAssessmentResultKey, missingAssessmentResultKey.assessedAt, (error) => error.code === '22023' && /missing or null required key|relation/.test(error.message));
  const extraAssessmentResultKey = { ...assessmentCanonical, assessmentId: '60000000-0000-0000-0000-000000000005', assessmentResult: { relation: 'SUPPORTS', rationale: 'fixture', extra: true } };
  await insertAssessmentVariant(extraAssessmentResultKey, extraAssessmentResultKey.assessedAt, (error) => error.code === '22023' && /unexpected key/.test(error.message));
  const invalidMethod = { ...assessmentCanonical, assessmentId: '60000000-0000-0000-0000-000000000003', methodProvenance: { ...assessmentCanonical.methodProvenance, toolContextHash: null } };
  await insertAssessmentVariant(invalidMethod, invalidMethod.assessedAt, (error) => error.code === '22023' && /unexpected key|JSON null/.test(error.message));

  const modelMethod = {
    methodType: 'MODEL_ASSISTED', methodIdentity: 'fixture-model', methodVersion: '1', methodHash: hash('1'),
    providerIdentity: 'fixture-provider', modelIdentity: 'fixture-model', modelVersion: '1',
    processIdentity: 'fixture-process', processVersion: '1', processHash: hash('2'),
    promptTemplateHash: hash('3'), systemInstructionHash: hash('4'),
    samplingParameters: { schema: 'factbase-rcv022-sampling-parameters', canonicalVersion: 1, entries: [] },
    samplingParametersHash: hash('5'), inputCanonicalHashes: [], rawOutputHash: hash('6'),
    structuredOutputHash: hash('7'), retryIdentity: 'fixture-retry', reviewStatus: 'NOT_REVIEWED',
  };
  const mixedMethod = {
    ...modelMethod, methodType: 'MIXED', reviewerIdentity: 'fixture-reviewer',
    reviewProcessIdentity: 'fixture-review-process', reviewProcessVersion: '1',
    reviewProcessHash: hash('8'), acceptanceStatus: 'PENDING',
  };
  const assessmentWithMethod = (assessmentId, methodProvenance) => ({ ...assessmentCanonical, assessmentId, methodProvenance });
  let methodNumber = 10;
  const validModelUsed = { ...modelMethod, toolParticipation: 'USED', toolContextHash: hash('a') };
  const validModelNotUsed = { ...modelMethod, toolParticipation: 'NOT_USED' };
  const validMixedUsed = { ...mixedMethod, toolParticipation: 'USED', toolContextHash: hash('b') };
  const validMixedNotUsed = { ...mixedMethod, toolParticipation: 'NOT_USED' };
  const humanMethod = {
    methodType: 'HUMAN', methodIdentity: 'fixture-model', methodVersion: '1', methodHash: hash('1'),
    reviewerIdentity: 'fixture-reviewer', reviewProcessIdentity: 'fixture-review-process', reviewProcessVersion: '1',
    reviewProcessHash: hash('8'), inputCanonicalHashes: [], structuredOutputHash: hash('7'), reviewStatus: 'NOT_REVIEWED',
  };
  for (const method of [validModelUsed, validModelNotUsed, validMixedUsed, validMixedNotUsed]) {
    const value = assessmentWithMethod(`60000000-0000-0000-0000-00000000${String(methodNumber++).padStart(4, '0')}`, method);
    await insertAssessmentVariant(value);
  }
  const validHuman = assessmentWithMethod('60000000-0000-0000-0000-000000000014', humanMethod);
  await insertAssessmentVariant(validHuman);
  const validHumanText = JSON.stringify(validHuman);
  const validHumanReadback = await pool.query(`
    SELECT assessment_id, canonical_version, canonical, canonical_hash,
           claim_evidence_match_id, claim_id, claim_version_id, evidence_fragment_id,
           assessment_result, method_provenance,
           to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS assessed_at
    FROM public.rcv022_evidence_assessments WHERE assessment_id=$1`, [validHuman.assessmentId]);
  assert.equal(validHumanReadback.rows.length, 1);
  assert.deepEqual(validHumanReadback.rows[0], {
    assessment_id: validHuman.assessmentId,
    canonical_version: 1,
    canonical: validHumanText,
    canonical_hash: h(validHumanText),
    claim_evidence_match_id: ids.match,
    claim_id: ids.claim,
    claim_version_id: ids.version,
    evidence_fragment_id: ids.fragment,
    assessment_result: validHuman.assessmentResult,
    method_provenance: humanMethod,
    assessed_at: validHuman.assessedAt,
  });
  const methodCases = [
    ['model used missing hash', { ...modelMethod, toolParticipation: 'USED' }],
    ['model used null hash', { ...modelMethod, toolParticipation: 'USED', toolContextHash: null }],
    ['model used malformed hash', { ...modelMethod, toolParticipation: 'USED', toolContextHash: 'not-a-hash' }],
    ['model not used present hash', { ...modelMethod, toolParticipation: 'NOT_USED', toolContextHash: hash('c') }],
    ['model not used null hash', { ...modelMethod, toolParticipation: 'NOT_USED', toolContextHash: null }],
    ['model missing participation', { ...modelMethod }],
    ['model null participation', { ...modelMethod, toolParticipation: null }],
    ['model unsupported participation', { ...modelMethod, toolParticipation: 'UNKNOWN' }],
    ['model wrong participation type', { ...modelMethod, toolParticipation: true }],
    ['mixed used missing hash', { ...mixedMethod, toolParticipation: 'USED' }],
    ['mixed used null hash', { ...mixedMethod, toolParticipation: 'USED', toolContextHash: null }],
    ['mixed used malformed hash', { ...mixedMethod, toolParticipation: 'USED', toolContextHash: 'not-a-hash' }],
    ['mixed not used present hash', { ...mixedMethod, toolParticipation: 'NOT_USED', toolContextHash: hash('d') }],
    ['mixed not used null hash', { ...mixedMethod, toolParticipation: 'NOT_USED', toolContextHash: null }],
    ['mixed missing participation', { ...mixedMethod }],
    ['mixed null participation', { ...mixedMethod, toolParticipation: null }],
    ['mixed unsupported participation', { ...mixedMethod, toolParticipation: 'UNKNOWN' }],
    ['mixed wrong participation type', { ...mixedMethod, toolParticipation: 1 }],
    ['mixed missing acceptance', (() => { const v = { ...mixedMethod, toolParticipation: 'NOT_USED' }; delete v.acceptanceStatus; return v; })()],
    ['mixed null acceptance', { ...mixedMethod, toolParticipation: 'NOT_USED', acceptanceStatus: null }],
    ['deterministic tool participation', { ...assessmentCanonical.methodProvenance, toolParticipation: 'NOT_USED' }],
    ['deterministic tool context', { ...assessmentCanonical.methodProvenance, toolContextHash: hash('x') }],
    ['methodProvenance missing key', (() => { const v = { ...assessmentCanonical.methodProvenance }; delete v.reviewStatus; return v; })()],
    ['methodProvenance extra key', { ...assessmentCanonical.methodProvenance, extra: true }],
    ['methodProvenance wrong type', 'not-an-object'],
    ['human tool participation', { ...humanMethod, toolParticipation: 'NOT_USED' }],
  ];
  for (const [label, method] of methodCases) {
    const value = assessmentWithMethod(`60000000-0000-0000-0000-00000000${String(methodNumber++).padStart(4, '0')}`, method);
    await insertAssessmentVariant(value, value.assessedAt, (error) => error.code === '22023' && /methodProvenance|toolParticipation|toolContextHash|unexpected key|missing key|missing or null|required key|mixed status|review status/.test(error.message));
  }
  const humanToolContextValue = assessmentWithMethod('60000000-0000-0000-0000-000000000099', { ...humanMethod, toolContextHash: hash('e') });
  const humanToolContextBefore = await pool.query(`SELECT assessment_id, canonical_hash, method_provenance FROM public.rcv022_evidence_assessments ORDER BY assessment_id`);
  await insertAssessmentVariant(humanToolContextValue, humanToolContextValue.assessedAt, (error) => error.code === '22023' && /unexpected key.*toolContextHash/.test(error.message));
  const humanToolContextAfter = await pool.query(`SELECT assessment_id, canonical_hash, method_provenance FROM public.rcv022_evidence_assessments ORDER BY assessment_id`);
  assert.deepEqual(humanToolContextAfter.rows, humanToolContextBefore.rows);
  const methodReadback = await pool.query(`SELECT method_provenance FROM public.rcv022_evidence_assessments WHERE assessment_id = ANY($1::uuid[]) ORDER BY assessment_id`, [[
    '60000000-0000-0000-0000-000000000010', '60000000-0000-0000-0000-000000000011',
    '60000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000013',
  ]]);
  assert.equal(methodReadback.rows.length, 4);
  assert.deepEqual(methodReadback.rows.map((row) => [row.method_provenance.methodType, row.method_provenance.toolParticipation, Object.prototype.hasOwnProperty.call(row.method_provenance, 'toolContextHash')]), [
    ['MODEL_ASSISTED', 'USED', true], ['MODEL_ASSISTED', 'NOT_USED', false],
    ['MIXED', 'USED', true], ['MIXED', 'NOT_USED', false],
  ]);
  for (const [label, sqlValue] of [['infinity', 'infinity'], ['negative infinity', '-infinity'], ['BC', '0001-01-01 BC'], ['out of domain', '10000-01-01T00:00:00Z']]) {
    const rendered = await pool.query(`SELECT to_char($1::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`, [sqlValue]);
    const timestampValue = label.includes('infinity') ? '' : rendered.rows[0].value;
    const variant = { ...assessmentCanonical, assessmentId: `60000000-0000-0000-0000-0000000000${String(10 + label.length).padStart(2, '0')}`, assessedAt: timestampValue };
    await insertAssessmentVariant(variant, sqlValue, (error) => error.code === '22023' && /invalid RCV-022 timestamp|timestamp year outside|timestamp format|NULL projection assessedAt/.test(error.message));
  }
  const lowerProbe = await pool.query(`SELECT
    to_char('0001-01-01 00:00:00.123456+00'::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ad_value,
    extract(year FROM '0001-01-01 00:00:00+00 BC'::timestamptz AT TIME ZONE 'UTC') AS bc_year`);
  assert.equal(lowerProbe.rows[0].ad_value, '0001-01-01T00:00:00.123456Z');
  assert.equal(Number(lowerProbe.rows[0].bc_year), -1);
  let yearZeroAccepted = false;
  try {
    const yearZero = await pool.query(`SELECT extract(year FROM '0000-01-01 00:00:00 BC'::timestamptz AT TIME ZONE 'UTC') AS year`);
    yearZeroAccepted = true;
    assert.equal(Number(yearZero.rows[0].year), -1);
  } catch (error) {
    assert.match(error.code || '', /22|23/);
  }
  assert.equal(typeof yearZeroAccepted, 'boolean');
  const lowerAssessment = { ...assessmentCanonical, assessmentId: '60000000-0000-0000-0000-000000000090', assessedAt: '0001-01-01T00:00:00.123456Z' };
  await insertAssessmentVariant(lowerAssessment, '0001-01-01 00:00:00.123456+00');
  const lowerReadback = await pool.query(`SELECT to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value FROM public.rcv022_evidence_assessments WHERE assessment_id=$1`, [lowerAssessment.assessmentId]);
  assert.equal(lowerReadback.rows[0].value, lowerAssessment.assessedAt);
  const mr = [{ id: ids.match, canonicalVersion: 1, canonicalHash: h(matchText) }];
  const ar = [{ id: ids.assessment, canonicalVersion: 1, canonicalHash: h(assessmentText) }];
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await insertEnvelope(client, ids.envelope, mr, ar);
    await client.query('INSERT INTO public.rcv022_envelope_match_refs VALUES ($1,0,$2,1,$3)', [ids.envelope, ids.match, h(matchText)]);
    await client.query('INSERT INTO public.rcv022_envelope_assessment_refs VALUES ($1,0,$2,1,$3)', [ids.envelope, ids.assessment, h(assessmentText)]);
    await client.query('COMMIT');
  } finally { client.release(); }
  const exactReadback = await pool.query(`
    SELECT e.fragment_id, e.canonical, e.canonical_hash, e.locator, e.content_binding, e.extraction_authority,
           to_char(a.assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS assessed_at,
           m.ordinal AS match_ordinal, m.match_id, m.match_canonical_version, m.match_canonical_hash,
           r.ordinal AS assessment_ordinal, r.assessment_id, r.assessment_canonical_version, r.assessment_canonical_hash
    FROM public.rcv022_evidence_fragments e
    JOIN public.rcv022_evidence_assessments a ON a.evidence_fragment_id=e.fragment_id AND a.assessment_id=$2
    JOIN public.rcv022_envelope_match_refs m ON m.match_id=$1
    JOIN public.rcv022_envelope_assessment_refs r ON r.assessment_id=$2
    WHERE e.fragment_id=$3`, [ids.match, ids.assessment, ids.fragment]);
  assert.equal(exactReadback.rows.length, 1);
  assert.equal(exactReadback.rows[0].canonical, JSON.stringify(fixture(ids.fragment)));
  assert.equal(exactReadback.rows[0].canonical_hash, h(JSON.stringify(fixture(ids.fragment))));
  assert.deepEqual(exactReadback.rows[0].locator, fixture(ids.fragment).locator);
  assert.deepEqual(exactReadback.rows[0].content_binding, fixture(ids.fragment).contentBinding);
  assert.deepEqual(exactReadback.rows[0].extraction_authority, fixture(ids.fragment).extractionAuthority);
  assert.equal(exactReadback.rows[0].assessed_at, assessmentCanonical.assessedAt);
  assert.deepEqual([exactReadback.rows[0].match_ordinal, exactReadback.rows[0].match_id, exactReadback.rows[0].match_canonical_version, exactReadback.rows[0].match_canonical_hash], [0, ids.match, 1, h(matchText)]);
  assert.deepEqual([exactReadback.rows[0].assessment_ordinal, exactReadback.rows[0].assessment_id, exactReadback.rows[0].assessment_canonical_version, exactReadback.rows[0].assessment_canonical_hash], [0, ids.assessment, 1, h(assessmentText)]);

  const envelopeCanonical = (id, matchRefs = mr, assessmentRefs = ar) => ({
    schema: 'RCV022-SEMANTIC-ANALYSIS-ENVELOPE-V1', canonicalVersion: 1, envelopeId: id,
    claimId: ids.claim, claimCanonicalVersion: 1, claimCanonicalHash: hash('a'),
    claimVersionId: ids.version, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: hash('b'),
    analysisCutoffAt: '2026-09-19T12:00:00.000000Z', analysisAt: '2026-09-19T12:00:00.123456Z',
    matchRefs, assessmentRefs, analysisMethodIdentity: 'fixture', analysisMethodVersion: '1', analysisMethodHash: hash('3'),
  });
  const envelopeShapeCases = [
    ['matchRefs missing', (v) => { delete v.matchRefs; return v; }],
    ['matchRefs JSON null', (v) => ({ ...v, matchRefs: null })],
    ['matchRefs object', (v) => ({ ...v, matchRefs: {} })],
    ['matchRefs scalar', (v) => ({ ...v, matchRefs: 'not-an-array' })],
    ['assessmentRefs missing', (v) => { delete v.assessmentRefs; return v; }],
    ['assessmentRefs JSON null', (v) => ({ ...v, assessmentRefs: null })],
    ['assessmentRefs object', (v) => ({ ...v, assessmentRefs: {} })],
    ['assessmentRefs scalar', (v) => ({ ...v, assessmentRefs: 'not-an-array' })],
  ];
  let envelopeNumber = 20;
  for (const [label, mutate] of envelopeShapeCases) {
    const id = `70000000-0000-0000-0000-00000000${String(envelopeNumber++).padStart(4, '0')}`;
    const value = mutate(envelopeCanonical(id));
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await assert.rejects(insertEnvelopeValues(c, id, value), (error) => error.code === '22023' && /missing or null required key|must be array|matchRefs|assessmentRefs/.test(error.message));
      await c.query('ROLLBACK');
    } finally { c.release(); }
  }
  for (const [label, projection] of [['matchRefs SQL NULL', { matchRefs: SQL_NULL }], ['assessmentRefs SQL NULL', { assessmentRefs: SQL_NULL }]]) {
    const id = `70000000-0000-0000-0000-00000000${String(envelopeNumber++).padStart(4, '0')}`;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await assert.rejects(insertEnvelopeValues(c, id, envelopeCanonical(id), projection), (error) => error.code === '23502' || ((error.code === '22023' || error.code === '23514') && /NULL projection|projection mismatch/.test(error.message)));
      await c.query('ROLLBACK');
    } finally { c.release(); }
  }

  const allSixTables = ['rcv022_evidence_fragments', 'rcv022_claim_evidence_matches', 'rcv022_evidence_assessments', 'rcv022_semantic_analysis_envelopes', 'rcv022_envelope_match_refs', 'rcv022_envelope_assessment_refs'];
  const beforeAllSix = {};
  for (const table of allSixTables) beforeAllSix[table] = (await pool.query(`SELECT row_to_json(t)::text AS value FROM public.${table} t ORDER BY 1`)).rows;
  const atomicIds = {
    fragment: '40000000-0000-0000-0000-000000009001', match: '50000000-0000-0000-0000-000000009001',
    assessment: '60000000-0000-0000-0000-000000009001', envelope: '70000000-0000-0000-0000-000000009001',
  };
  const atomicClient = await pool.connect();
  try {
    await atomicClient.query('BEGIN');
    await insertFragment(atomicIds.fragment, fixture(atomicIds.fragment), {}, atomicClient);
    const atomicMatch = { ...matchCanonical, matchId: atomicIds.match, evidenceFragmentId: atomicIds.fragment, evidenceFragmentCanonicalHash: h(JSON.stringify(fixture(atomicIds.fragment))) };
    const atomicMatchText = JSON.stringify(atomicMatch);
    await atomicClient.query(`INSERT INTO public.rcv022_claim_evidence_matches VALUES ($1,1,$2,$3,$4,1,$5,$6,1,$7,$8,1,$9,$10,$11,$12,$13::jsonb)`, [atomicIds.match, atomicMatchText, h(atomicMatchText), ids.claim, hash('a'), ids.version, hash('b'), atomicIds.fragment, h(JSON.stringify(fixture(atomicIds.fragment))), 'fixture', '1', hash('f'), '[]']);
    const atomicAssessment = { ...assessmentCanonical, assessmentId: atomicIds.assessment, claimEvidenceMatchId: atomicIds.match, claimEvidenceMatchCanonicalHash: h(atomicMatchText), evidenceFragmentId: atomicIds.fragment, evidenceFragmentCanonicalHash: h(JSON.stringify(fixture(atomicIds.fragment))) };
    const atomicAssessmentText = JSON.stringify(atomicAssessment);
    await atomicClient.query(`INSERT INTO public.rcv022_evidence_assessments
      (assessment_id,canonical_version,canonical,canonical_hash,claim_evidence_match_id,claim_evidence_match_canonical_version,claim_evidence_match_canonical_hash,claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,evidence_fragment_id,evidence_fragment_canonical_version,evidence_fragment_canonical_hash,assessment_result,method_provenance,assessed_at)
      VALUES ($1,1,$2,$3,$4,1,$5,$6,1,$7,$8,1,$9,$10,1,$11,$12::jsonb,$13::jsonb,$14)`, [atomicIds.assessment, atomicAssessmentText, h(atomicAssessmentText), atomicIds.match, h(atomicMatchText), ids.claim, hash('a'), ids.version, hash('b'), atomicIds.fragment, h(JSON.stringify(fixture(atomicIds.fragment))), JSON.stringify(atomicAssessment.assessmentResult), JSON.stringify(atomicAssessment.methodProvenance), atomicAssessment.assessedAt]);
    const atomicMr = [{ id: atomicIds.match, canonicalVersion: 1, canonicalHash: h(atomicMatchText) }];
    const atomicAr = [{ id: atomicIds.assessment, canonicalVersion: 1, canonicalHash: h(atomicAssessmentText) }];
    await insertEnvelope(atomicClient, atomicIds.envelope, atomicMr, atomicAr);
    await atomicClient.query('INSERT INTO public.rcv022_envelope_match_refs VALUES ($1,0,$2,1,$3)', [atomicIds.envelope, atomicIds.match, h(atomicMatchText)]);
    await atomicClient.query('INSERT INTO public.rcv022_envelope_assessment_refs VALUES ($1,0,$2,1,$3)', [atomicIds.envelope, atomicIds.assessment, h(atomicAssessmentText)]);
    await atomicClient.query('INSERT INTO public.rcv022_envelope_match_refs VALUES ($1,1,$2,1,$3)', [atomicIds.envelope, ids.match, h(matchText)]);
    await assert.rejects(atomicClient.query('COMMIT'), (error) => error.code === '23514' && /match membership parity failure/.test(error.message));
    await atomicClient.query('ROLLBACK');
  } finally { atomicClient.release(); }
  for (const table of allSixTables) {
    const after = (await pool.query(`SELECT row_to_json(t)::text AS value FROM public.${table} t ORDER BY 1`)).rows;
    assert.deepEqual(after, beforeAllSix[table]);
  }

  const timestampText = await pool.query(`SELECT to_char($1::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`, [assessmentCanonical.assessedAt]);
  assert.equal(timestampText.rows[0].value, assessmentCanonical.assessedAt);
  const timezoneClient = await pool.connect();
  try {
    await timezoneClient.query("SET TIME ZONE 'UTC'");
    const utcPersisted = await timezoneClient.query(`SELECT to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value FROM public.rcv022_evidence_assessments WHERE assessment_id=$1`, [ids.assessment]);
    await timezoneClient.query("SET TIME ZONE 'America/Los_Angeles'");
    const west = await timezoneClient.query(`SELECT to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value FROM public.rcv022_evidence_assessments WHERE assessment_id=$1`, [ids.assessment]);
    await timezoneClient.query("SET TIME ZONE 'Asia/Tokyo'");
    const east = await timezoneClient.query(`SELECT to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value FROM public.rcv022_evidence_assessments WHERE assessment_id=$1`, [ids.assessment]);
    assert.equal(utcPersisted.rows[0].value, assessmentCanonical.assessedAt);
    assert.equal(west.rows[0].value, assessmentCanonical.assessedAt);
    assert.equal(east.rows[0].value, assessmentCanonical.assessedAt);
  } finally { await timezoneClient.query('RESET TIME ZONE'); timezoneClient.release(); }

  const immutableCases = [
    ['rcv022_evidence_fragments', `fragment_id='${ids.fragment}'`, `UPDATE public.rcv022_evidence_fragments SET fragment_kind='TEXT' WHERE fragment_id='${ids.fragment}'`],
    ['rcv022_claim_evidence_matches', `match_id='${ids.match}'`, `UPDATE public.rcv022_claim_evidence_matches SET matcher_version='1' WHERE match_id='${ids.match}'`],
    ['rcv022_evidence_assessments', `assessment_id='${ids.assessment}'`, `UPDATE public.rcv022_evidence_assessments SET assessed_at=assessed_at WHERE assessment_id='${ids.assessment}'`],
    ['rcv022_semantic_analysis_envelopes', `envelope_id='${ids.envelope}'`, `UPDATE public.rcv022_semantic_analysis_envelopes SET analysis_at=analysis_at WHERE envelope_id='${ids.envelope}'`],
    ['rcv022_envelope_match_refs', `envelope_id='${ids.envelope}' AND ordinal=0`, `UPDATE public.rcv022_envelope_match_refs SET ordinal=ordinal WHERE envelope_id='${ids.envelope}' AND ordinal=0`],
    ['rcv022_envelope_assessment_refs', `envelope_id='${ids.envelope}' AND ordinal=0`, `UPDATE public.rcv022_envelope_assessment_refs SET ordinal=ordinal WHERE envelope_id='${ids.envelope}' AND ordinal=0`],
  ];
  for (const [table, where, updateSql] of immutableCases) {
    const before = await pool.query(`SELECT row_to_json(t)::text AS value FROM public.${table} t WHERE ${where}`);
    assert.equal(before.rows.length, 1);
    await expectReject(updateSql, [], (error) => error.code === '55000' && /immutable/.test(error.message));
    const afterUpdate = await pool.query(`SELECT row_to_json(t)::text AS value FROM public.${table} t WHERE ${where}`);
    assert.deepEqual(afterUpdate.rows, before.rows);
    await expectReject(`DELETE FROM public.${table} WHERE ${where}`, [], (error) => error.code === '55000' && /immutable/.test(error.message));
    const afterDelete = await pool.query(`SELECT row_to_json(t)::text AS value FROM public.${table} t WHERE ${where}`);
    assert.deepEqual(afterDelete.rows, before.rows);
  }

  const baselineCounts = await pool.query(`SELECT
    (SELECT count(*) FROM public.rcv022_evidence_fragments)::int AS fragments,
    (SELECT count(*) FROM public.rcv022_claim_evidence_matches)::int AS matches,
    (SELECT count(*) FROM public.rcv022_evidence_assessments)::int AS assessments,
    (SELECT count(*) FROM public.rcv022_semantic_analysis_envelopes)::int AS envelopes`);
  const failedFragment = fixture('40000000-0000-0000-0000-000000000099');
  const failedFragmentText = JSON.stringify(failedFragment);
  await expectReject(`INSERT INTO public.rcv022_evidence_fragments
    (fragment_id,canonical_version,canonical,canonical_hash,capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority)
    VALUES ($1,1,$2,$3,$4,'RCV020-CANONICAL-V1',$5,$6,'TEXT',$7::jsonb,$8::jsonb,$9::jsonb)`, [failedFragment.fragmentId, failedFragmentText, hash('9'), ids.capture, hash('c'), hash('b'), JSON.stringify(failedFragment.locator), JSON.stringify(failedFragment.contentBinding), JSON.stringify(failedFragment.extractionAuthority)], (error) => error.code === '23514' && /canonical hash mismatch/.test(error.message));
  const afterFailedInsert = await pool.query(`SELECT
    (SELECT count(*) FROM public.rcv022_evidence_fragments)::int AS fragments,
    (SELECT count(*) FROM public.rcv022_claim_evidence_matches)::int AS matches,
    (SELECT count(*) FROM public.rcv022_evidence_assessments)::int AS assessments,
    (SELECT count(*) FROM public.rcv022_semantic_analysis_envelopes)::int AS envelopes`);
  assert.deepEqual(afterFailedInsert.rows, baselineCounts.rows);
  const emptyId = '70000000-0000-0000-0000-000000000002';
  const emptyClient = await pool.connect();
  try { await emptyClient.query('BEGIN'); await insertEnvelope(emptyClient, emptyId, [], []); await emptyClient.query('COMMIT'); } finally { emptyClient.release(); }
  const missingId = '70000000-0000-0000-0000-000000000008';
  const missingBefore = await pool.query('SELECT count(*)::int AS n FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1', [missingId]);
  const missingClient = await pool.connect();
  try {
    await missingClient.query('BEGIN');
    await insertEnvelope(missingClient, missingId, mr, []);
    await assert.rejects(missingClient.query('COMMIT'), (error) => error.code === '23514' && /match membership parity failure/.test(error.message));
    await missingClient.query('ROLLBACK');
  } finally { missingClient.release(); }
  const missingAfter = await pool.query('SELECT count(*)::int AS n FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1', [missingId]);
  assert.deepEqual(missingAfter.rows, missingBefore.rows);
  const extraBefore = await pool.query(`SELECT
    (SELECT count(*) FROM public.rcv022_semantic_analysis_envelopes)::int AS envelopes,
    (SELECT count(*) FROM public.rcv022_envelope_match_refs)::int AS match_refs,
    (SELECT count(*) FROM public.rcv022_envelope_assessment_refs)::int AS assessment_refs`);
  const badClient = await pool.connect();
  try { await badClient.query('BEGIN'); await badClient.query('INSERT INTO public.rcv022_envelope_match_refs VALUES ($1,0,$2,1,$3)', [emptyId, ids.match, h(matchText)]); await assert.rejects(badClient.query('COMMIT'), (error) => error.code === '23514' && /match membership parity failure/.test(error.message)); await badClient.query('ROLLBACK'); } finally { badClient.release(); }
  const extraAfter = await pool.query(`SELECT
    (SELECT count(*) FROM public.rcv022_semantic_analysis_envelopes)::int AS envelopes,
    (SELECT count(*) FROM public.rcv022_envelope_match_refs)::int AS match_refs,
    (SELECT count(*) FROM public.rcv022_envelope_assessment_refs)::int AS assessment_refs`);
  assert.deepEqual(extraAfter.rows, extraBefore.rows);
  const wrongArrayClient = await pool.connect();
  try {
    await wrongArrayClient.query('BEGIN');
    await assert.rejects(insertEnvelope(wrongArrayClient, '70000000-0000-0000-0000-000000000003', {}, []), (error) => error.code === '22023' && /must be array/.test(error.message));
    await wrongArrayClient.query('ROLLBACK');
  } finally { wrongArrayClient.release(); }
  const wrongOrdinalClient = await pool.connect();
  try {
    await wrongOrdinalClient.query('BEGIN');
    const wrongOrdinalEnvelope = '70000000-0000-0000-0000-000000000004';
    await insertEnvelope(wrongOrdinalClient, wrongOrdinalEnvelope, mr, []);
    await wrongOrdinalClient.query('INSERT INTO public.rcv022_envelope_match_refs VALUES ($1,1,$2,1,$3)', [wrongOrdinalEnvelope, ids.match, h(matchText)]);
    await assert.rejects(wrongOrdinalClient.query('COMMIT'), (error) => error.code === '23514' && /match membership parity failure/.test(error.message));
    await wrongOrdinalClient.query('ROLLBACK');
  } finally { wrongOrdinalClient.release(); }
  for (const [eid, version, memberHash] of [['70000000-0000-0000-0000-000000000005', 2, h(matchText)], ['70000000-0000-0000-0000-000000000006', 1, hash('9')]]) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await insertEnvelope(c, eid, mr, []);
      if (version !== 1) {
        await assert.rejects(c.query('INSERT INTO public.rcv022_envelope_match_refs VALUES ($1,0,$2,$3,$4)', [eid, ids.match, version, memberHash]), (error) => error.code === '23514' && /match_canonical_version/.test(error.constraint || ''));
        await c.query('ROLLBACK');
      } else {
        await c.query('INSERT INTO public.rcv022_envelope_match_refs VALUES ($1,0,$2,$3,$4)', [eid, ids.match, version, memberHash]);
        await assert.rejects(c.query('COMMIT'), (error) => error.code === '23514' && /match membership parity failure/.test(error.message)); await c.query('ROLLBACK');
      }
    } finally { c.release(); }
  }
  const closureClient = await pool.connect();
  try {
    const eid = '70000000-0000-0000-0000-000000000007';
    await closureClient.query('BEGIN'); await insertEnvelope(closureClient, eid, [], ar);
    await closureClient.query('INSERT INTO public.rcv022_envelope_assessment_refs VALUES ($1,0,$2,1,$3)', [eid, ids.assessment, h(assessmentText)]);
    await assert.rejects(closureClient.query('COMMIT'), (error) => error.code === '23514' && /assessment Match closure failure/.test(error.message)); await closureClient.query('ROLLBACK');
  } finally { closureClient.release(); }
  await expectReject('UPDATE public.rcv022_evidence_fragments SET fragment_kind=$1 WHERE fragment_id=$2', ['TEXT', ids.fragment], (error) => error.code === '55000' && /immutable/.test(error.message));
  await expectReject('DELETE FROM public.rcv022_evidence_fragments WHERE fragment_id=$1', [ids.fragment], (error) => error.code === '55000' && /immutable/.test(error.message));
  await expectReject("SELECT public.rcv022_validate_timestamp('infinity'::timestamptz,'2026-09-19T12:00:00.000000Z','test')", [], (error) => error.code === '22023' && /infinite timestamp|timestamp format|invalid RCV-022 timestamp/.test(error.message));
  await expectReject("SELECT public.rcv022_validate_timestamp('-infinity'::timestamptz,'2026-09-19T12:00:00.000000Z','test')", [], (error) => error.code === '22023' && /infinite timestamp|timestamp format|invalid RCV-022 timestamp/.test(error.message));
  await expectReject("SELECT public.rcv022_validate_timestamp('0001-01-01 BC'::timestamptz,'0001-01-01T00:00:00.000000Z','test')", [], (error) => error.code === '22023' && /timestamp year outside|timestamp format|invalid RCV-022 timestamp/.test(error.message));
  await expectReject("SELECT public.rcv022_validate_timestamp('10000-01-01T00:00:00Z'::timestamptz,'10000-01-01T00:00:00.000000Z','test')", [], (error) => error.code === '22023' && /timestamp year outside|timestamp format|invalid RCV-022 timestamp/.test(error.message));
  const persisted = await pool.query('SELECT count(*)::int AS n FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1', [ids.envelope]);
  assert.equal(persisted.rows[0].n, 1);
});

test.after(async () => { if (pool) await pool.end(); });
