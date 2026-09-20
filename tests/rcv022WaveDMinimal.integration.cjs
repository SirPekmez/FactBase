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
const id = (n) => `83000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
      VALUES ($1,$2,1,'Wave D title','Wave D statement','en','fact','draft','unpublished','wave-d minimal fixture',$3)`, [versionId, claimId, "2026-01-01T00:00:00.000000Z"]);
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
    return { claimId, versionId, captureId, captureCanonicalHash: captureBuilt.hash, claim, version, capture };
  } catch (error) { await authority.query("ROLLBACK").catch(() => {}); throw error; }
  finally { authority.release(); }
}

function makeBundle(ids, offset = 10) {
  const c = require("../dist/services/rcv022Canonical");
  const fragment = { fragmentId: id(offset), captureId: ids.captureId, captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: ids.captureCanonicalHash, captureRepresentationHash: h("b"), fragmentKind: "TEXT", locator: { kind: "WHOLE_TEXT" }, contentBinding: { kind: "TEXT", utf8Text: "hello", contentHash: sha("hello") }, extractionAuthority: { kind: "DIRECT" } };
  const fragmentBuilt = c.buildEvidenceFragmentCanonical(fragment);
  const match = { matchId: id(offset + 1), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, matcherIdentity: "wave-d-deterministic-matcher", matcherVersion: "1", matcherHash: h("e"), matcherInputCanonicalHashes: [] };
  const matchBuilt = c.buildClaimEvidenceMatchCanonical(match);
  const assessment = { assessmentId: id(offset + 2), claimEvidenceMatchId: match.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: matchBuilt.hash, claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, assessmentResult: { relation: "SUPPORTS", rationale: "wave-d deterministic fixture rationale" }, methodProvenance: { methodType: "DETERMINISTIC", methodIdentity: "wave-d-rule", methodVersion: "1", methodHash: h("f"), inputCanonicalHashes: [], structuredOutputHash: h("b"), reviewStatus: "NOT_REVIEWED" }, assessedAt: "2026-01-01T00:00:00.123456Z" };
  const assessmentBuilt = c.buildEvidenceAssessmentCanonical(assessment);
  const envelope = { envelopeId: id(offset + 3), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:00.123456Z", matchRefs: [{ id: match.matchId, canonicalVersion: 1, canonicalHash: matchBuilt.hash }], assessmentRefs: [{ id: assessment.assessmentId, canonicalVersion: 1, canonicalHash: assessmentBuilt.hash }], analysisMethodIdentity: "wave-d-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") };
  return { fragment, match, assessment, envelope, built: { fragment: fragmentBuilt, match: matchBuilt, assessment: assessmentBuilt, envelope: c.buildSemanticAnalysisEnvelopeCanonical(envelope) } };
}

async function persistBundle(bundle) {
  const w = require("../dist/services/rcv022Writer"); const client = await pool.connect();
  try { await client.query("BEGIN"); await w.persistRcv022BundleWithinTransaction(client, bundle); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

async function snapshot(table, column, value) {
  return (await pool.query(`SELECT row_to_json(t) AS state FROM (SELECT * FROM public.${table} WHERE ${column}=$1) t`, [value])).rows;
}
async function count(table, column, value) {
  return Number((await pool.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${column}=$1`, [value])).rows[0].n);
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

test("Wave D minimal authenticated slice persists, restarts, verifies, corrupts, and rolls back atomically", { concurrency: false, timeout: 60000 }, async (t) => {
  if (!enabled) { t.skip("set RCV022_WAVE_D_DATABASE, PGHOST, and PGPORT for disposable PostgreSQL proof"); return; }
  const pre = await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rcv022_%'"); assert.equal(pre.rows[0].n, 0);
  await replayMigrations();
  const ids = await seedAuthenticatedUpstream(); const bundle = makeBundle(ids); await persistBundle(bundle);
  assert.equal(await count("rcv022_evidence_fragments", "fragment_id", bundle.fragment.fragmentId), 1);
  assert.equal(await count("rcv022_claim_evidence_matches", "match_id", bundle.match.matchId), 1);
  assert.equal(await count("rcv022_evidence_assessments", "assessment_id", bundle.assessment.assessmentId), 1);
  assert.equal(await count("rcv022_semantic_analysis_envelopes", "envelope_id", bundle.envelope.envelopeId), 1);
  assert.equal(await count("rcv022_envelope_match_refs", "envelope_id", bundle.envelope.envelopeId), 1);
  assert.equal(await count("rcv022_envelope_assessment_refs", "envelope_id", bundle.envelope.envelopeId), 1);
  const fragmentRow = (await pool.query("SELECT canonical,canonical_hash,capture_id::text AS capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority FROM public.rcv022_evidence_fragments WHERE fragment_id=$1", [bundle.fragment.fragmentId])).rows[0];
  assert.deepEqual(fragmentRow, { canonical: bundle.built.fragment.canonical, canonical_hash: bundle.built.fragment.hash, capture_id: ids.captureId, capture_canonical_version: bundle.fragment.captureCanonicalVersion, capture_canonical_hash: ids.captureCanonicalHash, capture_representation_hash: bundle.fragment.captureRepresentationHash, fragment_kind: "TEXT", locator: bundle.fragment.locator, content_binding: bundle.fragment.contentBinding, extraction_authority: bundle.fragment.extractionAuthority });
  const matchRow = (await pool.query("SELECT canonical,canonical_hash,claim_id::text AS claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id::text AS claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,evidence_fragment_id::text AS evidence_fragment_id,evidence_fragment_canonical_version,evidence_fragment_canonical_hash,matcher_identity,matcher_version,matcher_hash,matcher_input_canonical_hashes FROM public.rcv022_claim_evidence_matches WHERE match_id=$1", [bundle.match.matchId])).rows[0];
  assert.equal(matchRow.canonical, bundle.built.match.canonical); assert.equal(matchRow.canonical_hash, bundle.built.match.hash); assert.equal(matchRow.claim_id, ids.claimId); assert.equal(matchRow.claim_canonical_hash, ids.claim.canonicalHash); assert.equal(matchRow.claim_version_id, ids.version.claimVersionId); assert.equal(matchRow.claim_version_canonical_hash, ids.version.canonicalHash); assert.equal(matchRow.evidence_fragment_id, bundle.fragment.fragmentId); assert.equal(matchRow.evidence_fragment_canonical_hash, bundle.built.fragment.hash); assert.deepEqual(matchRow.matcher_input_canonical_hashes, []);
  const assessmentRow = (await pool.query("SELECT canonical,canonical_hash,assessment_result,method_provenance,to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0];
  assert.equal(assessmentRow.canonical, bundle.built.assessment.canonical); assert.equal(assessmentRow.canonical_hash, bundle.built.assessment.hash); assert.deepEqual(assessmentRow.assessment_result, bundle.assessment.assessmentResult); assert.deepEqual(assessmentRow.method_provenance, bundle.assessment.methodProvenance); assert.equal(assessmentRow.assessed_at, bundle.assessment.assessedAt);
  const envelopeRow = (await pool.query("SELECT canonical,canonical_hash,claim_id::text AS claim_id,claim_canonical_hash,claim_version_id::text AS claim_version_id,claim_version_canonical_hash,to_char(analysis_cutoff_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS analysis_cutoff_at,to_char(analysis_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS analysis_at,match_refs,assessment_refs,analysis_method_identity,analysis_method_version,analysis_method_hash FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [bundle.envelope.envelopeId])).rows[0];
  assert.equal(envelopeRow.canonical, bundle.built.envelope.canonical); assert.equal(envelopeRow.canonical_hash, bundle.built.envelope.hash); assert.equal(envelopeRow.claim_id, ids.claimId); assert.equal(envelopeRow.claim_canonical_hash, ids.claim.canonicalHash); assert.equal(envelopeRow.claim_version_id, ids.version.claimVersionId); assert.equal(envelopeRow.claim_version_canonical_hash, ids.version.canonicalHash); assert.equal(envelopeRow.analysis_cutoff_at, bundle.envelope.analysisCutoffAt); assert.equal(envelopeRow.analysis_at, bundle.envelope.analysisAt); assert.deepEqual(envelopeRow.match_refs, bundle.envelope.matchRefs); assert.deepEqual(envelopeRow.assessment_refs, bundle.envelope.assessmentRefs); assert.equal(envelopeRow.analysis_method_identity, bundle.envelope.analysisMethodIdentity); assert.equal(envelopeRow.analysis_method_version, bundle.envelope.analysisMethodVersion); assert.equal(envelopeRow.analysis_method_hash, bundle.envelope.analysisMethodHash);
  const matchRef = (await pool.query("SELECT ordinal,match_id::text AS id,match_canonical_version AS canonical_version,match_canonical_hash AS canonical_hash FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1 ORDER BY ordinal", [bundle.envelope.envelopeId])).rows;
  const assessmentRef = (await pool.query("SELECT ordinal,assessment_id::text AS id,assessment_canonical_version AS canonical_version,assessment_canonical_hash AS canonical_hash FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 ORDER BY ordinal", [bundle.envelope.envelopeId])).rows;
  assert.deepEqual(matchRef, [{ ordinal: 0, id: bundle.match.matchId, canonical_version: 1, canonical_hash: bundle.built.match.hash }]); assert.deepEqual(assessmentRef, [{ ordinal: 0, id: bundle.assessment.assessmentId, canonical_version: 1, canonical_hash: bundle.built.assessment.hash }]);
  const reader = require("../dist/services/rcv022Reader"); const verified = await reader.verifyRcv022HistoricalEnvelope(bundle.envelope.envelopeId, pool); assert.equal(verified.verified, true); verifyInFreshProcess(bundle.envelope.envelopeId, "PASS");
  const corruptionBefore = await snapshot("rcv022_evidence_assessments", "assessment_id", bundle.assessment.assessmentId);
  await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET method_provenance=jsonb_set(method_provenance,'{methodIdentity}',to_jsonb('corrupted'::text)) WHERE assessment_id=$1", [bundle.assessment.assessmentId]); });
  const corruptionState = await snapshot("rcv022_evidence_assessments", "assessment_id", bundle.assessment.assessmentId);
  verifyInFreshProcess(bundle.envelope.envelopeId, "LINEAGE_MISMATCH");
  await assert.rejects(() => reader.verifyRcv022HistoricalEnvelope(bundle.envelope.envelopeId, pool), (error) => error.code === "LINEAGE_MISMATCH");
  assert.deepEqual(await snapshot("rcv022_evidence_assessments", "assessment_id", bundle.assessment.assessmentId), corruptionState); assert.notDeepEqual(corruptionState, corruptionBefore);
  await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET method_provenance=$1::jsonb WHERE assessment_id=$2", [JSON.stringify(bundle.assessment.methodProvenance), bundle.assessment.assessmentId]); });
  const rollbackBundle = makeBundle(ids, 20); rollbackBundle.envelope.assessmentRefs[0].canonicalHash = h("f");
  const baseline = { fragment: await snapshot("rcv022_evidence_fragments", "fragment_id", bundle.fragment.fragmentId), match: await snapshot("rcv022_claim_evidence_matches", "match_id", bundle.match.matchId), assessment: await snapshot("rcv022_evidence_assessments", "assessment_id", bundle.assessment.assessmentId), envelope: await snapshot("rcv022_semantic_analysis_envelopes", "envelope_id", bundle.envelope.envelopeId), matchRef: await snapshot("rcv022_envelope_match_refs", "envelope_id", bundle.envelope.envelopeId), assessmentRef: await snapshot("rcv022_envelope_assessment_refs", "envelope_id", bundle.envelope.envelopeId) };
  const w = require("../dist/services/rcv022Writer"); const rollbackClient = await pool.connect(); let rollbackError;
  try { await rollbackClient.query("BEGIN"); await w.persistEvidenceFragmentWithinTransaction(rollbackClient, rollbackBundle.fragment); await w.persistClaimEvidenceMatchWithinTransaction(rollbackClient, rollbackBundle.match); await w.persistEvidenceAssessmentWithinTransaction(rollbackClient, rollbackBundle.assessment); await w.persistSemanticAnalysisEnvelopeWithinTransaction(rollbackClient, rollbackBundle.envelope); await rollbackClient.query("COMMIT"); }
  catch (error) { rollbackError = error; await rollbackClient.query("ROLLBACK"); }
  finally { rollbackClient.release(); }
  assert.ok(rollbackError); assert.match(String(rollbackError.message), /HASH_MISMATCH|MISSING_AUTHORITY/); for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", rollbackBundle.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", rollbackBundle.match.matchId], ["rcv022_evidence_assessments", "assessment_id", rollbackBundle.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", rollbackBundle.envelope.envelopeId]]) assert.equal(await count(table, column, value), 0); assert.deepEqual({ fragment: await snapshot("rcv022_evidence_fragments", "fragment_id", bundle.fragment.fragmentId), match: await snapshot("rcv022_claim_evidence_matches", "match_id", bundle.match.matchId), assessment: await snapshot("rcv022_evidence_assessments", "assessment_id", bundle.assessment.assessmentId), envelope: await snapshot("rcv022_semantic_analysis_envelopes", "envelope_id", bundle.envelope.envelopeId), matchRef: await snapshot("rcv022_envelope_match_refs", "envelope_id", bundle.envelope.envelopeId), assessmentRef: await snapshot("rcv022_envelope_assessment_refs", "envelope_id", bundle.envelope.envelopeId) }, baseline);
  verifyInFreshProcess(rollbackBundle.envelope.envelopeId, "MISSING_AUTHORITY");
});

test.after(async () => { if (pool) await pool.end(); });
