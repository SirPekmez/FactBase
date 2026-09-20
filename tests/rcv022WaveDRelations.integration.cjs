const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { Pool } = require("pg");

const database = process.env.RCV022_WAVE_D_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 8 }) : null;
const root = path.join(__dirname, "..");
const id = (n) => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const h = (ch) => ch.repeat(64);
const migrationFiles = () => fs.readdirSync(path.join(root, "migrations")).filter((name) => name.endsWith(".sql")).sort().map((name) => path.join(root, "migrations", name));

async function replayMigrations() {
  const client = await pool.connect();
  try { for (const file of migrationFiles()) await client.query(fs.readFileSync(file, "utf8")); }
  finally { client.release(); }
}

async function seedAuthenticatedUpstream() {
  const claimId = id(1); const versionId = id(2); const captureId = id(3);
  const rcv020 = require("../dist/services/rcv020SemanticCore");
  const claimWriter = require("../dist/services/claimHistoricalAuthorityWriter");
  const capture = {
    captureId, logicalSourceId: id(4), monitorId: id(5), monitorConfigurationVersionId: id(6), occurrenceId: id(7), retrievalAttemptId: id(8),
    observedAt: "2026-01-01T00:00:00.000000Z", contentHash: h("b"), byteLength: "5", rawObjectIdentity: null,
    requestHash: h("a"), requestedTarget: "https://example.test", finalUrl: "https://example.test", redirectCanonical: null,
    responseStatus: 200, responseMetadataCanonical: "{}", mediaType: "text/plain", retentionPolicy: "METADATA_HASH_ONLY", retentionPolicyVersion: 1,
  };
  const captureBuilt = rcv020.canonicalizeRcv020Capture(capture);
  const source = await pool.connect();
  try {
    await source.query("SET session_replication_role='replica'");
    await source.query("INSERT INTO public.claims(id) VALUES ($1)", [claimId]);
    await source.query(`INSERT INTO public.claim_versions
      (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at)
      VALUES ($1,$2,1,'Wave D relation title','Wave D relation statement','en','fact','draft','unpublished','wave-d relation fixture',$3)`, [versionId, claimId, "2026-01-01T00:00:00.000000Z"]);
    await source.query(`INSERT INTO public.rcv020_captures
      (capture_id,logical_source_id,monitor_id,monitor_configuration_version_id,occurrence_id,retrieval_attempt_id,
       request_hash,requested_target,final_url,redirect_canonical,response_status,response_metadata_canonical,media_type,
       byte_length,observed_at,content_hash,canonical,capture_hash,retention_policy,retention_policy_version,raw_object_identity,raw_object_reference)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [captureId, capture.logicalSourceId, capture.monitorId, capture.monitorConfigurationVersionId, capture.occurrenceId, capture.retrievalAttemptId,
        capture.requestHash, capture.requestedTarget, capture.finalUrl, capture.redirectCanonical, capture.responseStatus,
        capture.responseMetadataCanonical, capture.mediaType, capture.byteLength, capture.observedAt, capture.contentHash,
        captureBuilt.canonical, captureBuilt.hash, capture.retentionPolicy, capture.retentionPolicyVersion, null, null]);
  } finally { await source.query("SET session_replication_role='origin'").catch(() => {}); source.release(); }
  const authority = await pool.connect();
  try {
    await authority.query("BEGIN");
    const claim = await claimWriter.persistClaimIdentityAuthorityWithinTransaction(authority, claimId);
    const version = await claimWriter.persistClaimVersionAuthorityWithinTransaction(authority, versionId);
    await authority.query("COMMIT");
    return { claimId, versionId, captureId, captureCanonicalHash: captureBuilt.hash, claim, version };
  } catch (error) { await authority.query("ROLLBACK").catch(() => {}); throw error; }
  finally { authority.release(); }
}

function makeBundle(ids, relation, offset) {
  const c = require("../dist/services/rcv022Canonical");
  const fragment = { fragmentId: id(offset), captureId: ids.captureId, captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: ids.captureCanonicalHash, captureRepresentationHash: h("b"), fragmentKind: "TEXT", locator: { kind: "WHOLE_TEXT" }, contentBinding: { kind: "TEXT", utf8Text: "relation matrix text", contentHash: sha("relation matrix text") }, extractionAuthority: { kind: "DIRECT" } };
  const fragmentBuilt = c.buildEvidenceFragmentCanonical(fragment);
  const match = { matchId: id(offset + 1), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, matcherIdentity: "wave-d-relation-matcher", matcherVersion: "1", matcherHash: h("e"), matcherInputCanonicalHashes: [] };
  const matchBuilt = c.buildClaimEvidenceMatchCanonical(match);
  const assessment = { assessmentId: id(offset + 2), claimEvidenceMatchId: match.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: matchBuilt.hash, claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, assessmentResult: { relation, rationale: `explicit deterministic ${relation.toLowerCase()} fixture` }, methodProvenance: { methodType: "DETERMINISTIC", methodIdentity: "wave-d-relation-rule", methodVersion: "1", methodHash: h("f"), inputCanonicalHashes: [], structuredOutputHash: h("b"), reviewStatus: "NOT_REVIEWED" }, assessedAt: "2026-01-01T00:00:00.123456Z" };
  const assessmentBuilt = c.buildEvidenceAssessmentCanonical(assessment);
  const envelope = { envelopeId: id(offset + 3), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:00.123456Z", matchRefs: [{ id: match.matchId, canonicalVersion: 1, canonicalHash: matchBuilt.hash }], assessmentRefs: [{ id: assessment.assessmentId, canonicalVersion: 1, canonicalHash: assessmentBuilt.hash }], analysisMethodIdentity: "wave-d-relation-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") };
  return { fragment, match, assessment, envelope, built: { fragment: fragmentBuilt, match: matchBuilt, assessment: assessmentBuilt, envelope: c.buildSemanticAnalysisEnvelopeCanonical(envelope) } };
}

async function persistBundle(bundle) {
  const w = require("../dist/services/rcv022Writer");
  const client = await pool.connect();
  try { await client.query("BEGIN"); await w.persistRcv022BundleWithinTransaction(client, bundle); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

async function persistEnvelope(envelope) {
  const w = require("../dist/services/rcv022Writer");
  const client = await pool.connect();
  try { await client.query("BEGIN"); await w.persistSemanticAnalysisEnvelopeWithinTransaction(client, envelope); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

async function snapshot(table, column, value) {
  return (await pool.query(`SELECT row_to_json(t) AS state FROM (SELECT * FROM public.${table} WHERE ${column}=$1) t`, [value])).rows;
}

async function withUserTriggersDisabled(table, work) {
  const client = await pool.connect();
  try { await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`); return await work(client); }
  finally { await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`).catch(() => {}); client.release(); }
}

function verifyInFreshProcess(envelopeId, expectedCode) {
  const readerPath = path.join(process.cwd(), "dist/services/rcv022Reader.js");
  const child = spawnSync(process.execPath, ["-e", `const {Pool}=require('pg'); const r=require(${JSON.stringify(readerPath)}); const p=new Pool({database:process.env.RCV022_WAVE_D_DATABASE,host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD}); r.verifyRcv022HistoricalEnvelope(process.env.RCV022_ENVELOPE,p).then(v=>{process.stdout.write(JSON.stringify({verified:v.verified})); return p.end().then(()=>process.exit(process.env.EXPECTED_CODE==='PASS'?0:1));}).catch(e=>{process.stdout.write(JSON.stringify({code:e.code})); return p.end().then(()=>process.exit(e.code===process.env.EXPECTED_CODE?0:1));});`], { env: { ...process.env, RCV022_ENVELOPE: envelopeId, EXPECTED_CODE: expectedCode }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), expectedCode === "PASS" ? { verified: true } : { code: expectedCode });
}

test("Wave D relation matrix persists and independently verifies all four explicit relations", { concurrency: false, timeout: 120000 }, async (t) => {
  if (!enabled) { t.skip("set RCV022_WAVE_D_DATABASE, PGHOST, and PGPORT for disposable PostgreSQL proof"); return; }
  const pre = await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rcv022_%'");
  assert.equal(pre.rows[0].n, 0);
  await replayMigrations();
  const ids = await seedAuthenticatedUpstream();
  const relations = ["SUPPORTS", "REFUTES", "INSUFFICIENT", "UNRELATED"];
  const bundles = new Map();
  for (const [index, relation] of relations.entries()) {
    const bundle = makeBundle(ids, relation, 100 + index * 10);
    bundles.set(relation, bundle);
    await persistBundle(bundle);
    const row = (await pool.query(`SELECT assessment_result,canonical,canonical_hash FROM public.rcv022_evidence_assessments WHERE assessment_id=$1`, [bundle.assessment.assessmentId])).rows[0];
    assert.deepEqual(row.assessment_result, bundle.assessment.assessmentResult);
    assert.equal(row.canonical, bundle.built.assessment.canonical);
    assert.equal(row.canonical_hash, bundle.built.assessment.hash);
    verifyInFreshProcess(bundle.envelope.envelopeId, "PASS");
    const reader = require("../dist/services/rcv022Reader");
    assert.equal((await reader.verifyRcv022HistoricalEnvelope(bundle.envelope.envelopeId, pool)).verified, true);
  }
  assert.equal(new Set([...bundles.values()].map((b) => b.built.assessment.hash)).size, relations.length);

  const invalid = makeBundle(ids, "SUPPORTS", 160);
  invalid.assessment.assessmentResult = { relation: "NOT_A_RELATION", rationale: "invalid" };
  const writer = require("../dist/services/rcv022Writer");
  const invalidClient = await pool.connect();
  let invalidError;
  try {
    await invalidClient.query("BEGIN");
    await writer.persistEvidenceAssessmentWithinTransaction(invalidClient, invalid.assessment);
  } catch (error) {
    invalidError = error;
    await invalidClient.query("ROLLBACK");
  } finally { invalidClient.release(); }
  assert.ok(invalidError);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [invalid.assessment.assessmentId])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [invalid.envelope.envelopeId])).rows[0].n, 0);

  const zero = { envelopeId: id(190), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:00.123456Z", matchRefs: [], assessmentRefs: [], analysisMethodIdentity: "wave-d-relation-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") };
  await persistEnvelope(zero);
  verifyInFreshProcess(zero.envelopeId, "PASS");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1", [zero.envelopeId])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1", [zero.envelopeId])).rows[0].n, 0);
  assert.deepEqual(zero.matchRefs, []); assert.deepEqual(zero.assessmentRefs, []);

  const rollbackBundle = makeBundle(ids, "REFUTES", 200);
  rollbackBundle.envelope.assessmentRefs[0].canonicalHash = h("f");
  const rollbackClient = await pool.connect();
  let rollbackError;
  try {
    await rollbackClient.query("BEGIN");
    await writer.persistEvidenceFragmentWithinTransaction(rollbackClient, rollbackBundle.fragment);
    await writer.persistClaimEvidenceMatchWithinTransaction(rollbackClient, rollbackBundle.match);
    await writer.persistEvidenceAssessmentWithinTransaction(rollbackClient, rollbackBundle.assessment);
    await writer.persistSemanticAnalysisEnvelopeWithinTransaction(rollbackClient, rollbackBundle.envelope);
    await rollbackClient.query("COMMIT");
  } catch (error) {
    rollbackError = error;
    await rollbackClient.query("ROLLBACK");
  } finally { rollbackClient.release(); }
  assert.ok(rollbackError);
  assert.match(String(rollbackError.message), /HASH_MISMATCH|MISSING_AUTHORITY/);
  for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", rollbackBundle.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", rollbackBundle.match.matchId], ["rcv022_evidence_assessments", "assessment_id", rollbackBundle.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", rollbackBundle.envelope.envelopeId]]) {
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${column}=$1`, [value])).rows[0].n, 0);
  }

  const corruption = bundles.get("UNRELATED");
  const before = await snapshot("rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId);
  await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET assessment_result=jsonb_set(assessment_result,'{rationale}',to_jsonb('corrupted relation projection'::text)) WHERE assessment_id=$1", [corruption.assessment.assessmentId]); });
  const corrupted = await snapshot("rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId);
  verifyInFreshProcess(corruption.envelope.envelopeId, "LINEAGE_MISMATCH");
  const reader = require("../dist/services/rcv022Reader");
  await assert.rejects(() => reader.verifyRcv022HistoricalEnvelope(corruption.envelope.envelopeId, pool), (error) => error.code === "LINEAGE_MISMATCH");
  assert.deepEqual(await snapshot("rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId), corrupted);
  assert.notDeepEqual(corrupted, before);
  await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET assessment_result=$1::jsonb WHERE assessment_id=$2", [JSON.stringify(corruption.assessment.assessmentResult), corruption.assessment.assessmentId]); });
  assert.equal(relations.length, 4);
});

test.after(async () => { if (pool) await pool.end(); });
