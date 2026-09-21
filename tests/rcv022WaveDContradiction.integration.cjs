const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { Pool } = require("pg");
const { canonicalizeJson } = require("../dist/services/canonicalJson");

const database = process.env.RCV022_WAVE_D_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 12 }) : null;
const root = path.join(__dirname, "..");
const id = (n) => `87000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const h = (ch) => ch.repeat(64);
const migrationFiles = () => fs.readdirSync(path.join(root, "migrations")).filter((name) => name.endsWith(".sql")).sort().map((name) => path.join(root, "migrations", name));

async function replayMigrations() {
  const client = await pool.connect();
  try { for (const file of migrationFiles()) await client.query(fs.readFileSync(file, "utf8")); }
  finally { client.release(); }
}

async function seedUpstream() {
  const rcv020 = require("../dist/services/rcv020SemanticCore");
  const claimWriter = require("../dist/services/claimHistoricalAuthorityWriter");
  const claimId = id(1); const versionId = id(2); const version2Id = id(3); const otherClaimId = id(4); const otherVersionId = id(5); const captureId = id(6);
  const capture = { captureId, logicalSourceId: id(7), monitorId: id(8), monitorConfigurationVersionId: id(9), occurrenceId: id(10), retrievalAttemptId: id(11), observedAt: "2026-01-01T00:00:00.000000Z", contentHash: h("b"), byteLength: "5", rawObjectIdentity: null, requestHash: h("a"), requestedTarget: "https://example.test", finalUrl: "https://example.test", redirectCanonical: null, responseStatus: 200, responseMetadataCanonical: "{}", mediaType: "text/plain", retentionPolicy: "METADATA_HASH_ONLY", retentionPolicyVersion: 1 };
  const captureBuilt = rcv020.canonicalizeRcv020Capture(capture);
  const source = await pool.connect();
  try {
    await source.query("SET session_replication_role='replica'");
    await source.query("INSERT INTO public.claims(id) VALUES ($1),($2)", [claimId, otherClaimId]);
    await source.query(`INSERT INTO public.claim_versions (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at) VALUES ($1,$2,1,'Stage 5 title','Stage 5 statement','en','fact','draft','unpublished','stage-5 fixture',$3),($4,$2,2,'Stage 5 title v2','Stage 5 statement v2','en','fact','draft','unpublished','stage-5 version fixture',$3),($5,$6,1,'Other claim title','Other claim statement','en','fact','draft','unpublished','stage-5 cross-claim fixture',$3)`, [versionId, claimId, "2026-01-01T00:00:00.000000Z", version2Id, otherVersionId, otherClaimId]);
    await source.query(`INSERT INTO public.rcv020_captures (capture_id,logical_source_id,monitor_id,monitor_configuration_version_id,occurrence_id,retrieval_attempt_id,request_hash,requested_target,final_url,redirect_canonical,response_status,response_metadata_canonical,media_type,byte_length,observed_at,content_hash,canonical,capture_hash,retention_policy,retention_policy_version,raw_object_identity,raw_object_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, [captureId, capture.logicalSourceId, capture.monitorId, capture.monitorConfigurationVersionId, capture.occurrenceId, capture.retrievalAttemptId, capture.requestHash, capture.requestedTarget, capture.finalUrl, capture.redirectCanonical, capture.responseStatus, capture.responseMetadataCanonical, capture.mediaType, capture.byteLength, capture.observedAt, capture.contentHash, captureBuilt.canonical, captureBuilt.hash, capture.retentionPolicy, capture.retentionPolicyVersion, null, null]);
  } finally { await source.query("SET session_replication_role='origin'").catch(() => {}); source.release(); }
  const authority = await pool.connect();
  try {
    await authority.query("BEGIN");
    const claim = await claimWriter.persistClaimIdentityAuthorityWithinTransaction(authority, claimId);
    const version = await claimWriter.persistClaimVersionAuthorityWithinTransaction(authority, versionId);
    const version2 = await claimWriter.persistClaimVersionAuthorityWithinTransaction(authority, version2Id);
    const otherClaim = await claimWriter.persistClaimIdentityAuthorityWithinTransaction(authority, otherClaimId);
    const otherVersion = await claimWriter.persistClaimVersionAuthorityWithinTransaction(authority, otherVersionId);
    await authority.query("COMMIT");
    return { claimId, versionId, version2Id, otherClaimId, otherVersionId, captureId, captureCanonicalHash: captureBuilt.hash, claim, version, version2, otherClaim, otherVersion };
  } catch (error) { await authority.query("ROLLBACK").catch(() => {}); throw error; }
  finally { authority.release(); }
}

function method(kind) {
  const common = { methodType: kind, methodIdentity: `stage5-${kind.toLowerCase()}`, methodVersion: "1", methodHash: h("f"), inputCanonicalHashes: [], structuredOutputHash: h("b"), reviewStatus: kind === "HUMAN" ? "REVIEWED" : "NOT_REVIEWED" };
  if (kind === "HUMAN") return { ...common, reviewerIdentity: "stage5-reviewer", reviewProcessIdentity: "stage5-review", reviewProcessVersion: "1", reviewProcessHash: h("c") };
  return common;
}

function makeAtom(ids, offset, relation, version = ids.version, claim = ids.claim, methodValue = method("DETERMINISTIC")) {
  const c = require("../dist/services/rcv022Canonical");
  const text = `stage5 fragment ${offset}`;
  const fragment = { fragmentId: id(offset), captureId: ids.captureId, captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: ids.captureCanonicalHash, captureRepresentationHash: h("b"), fragmentKind: "TEXT", locator: { kind: "WHOLE_TEXT" }, contentBinding: { kind: "TEXT", utf8Text: text, contentHash: sha(text) }, extractionAuthority: { kind: "DIRECT" } };
  const fragmentBuilt = c.buildEvidenceFragmentCanonical(fragment);
  const match = { matchId: id(offset + 1), claimId: claim.claimId, claimCanonicalVersion: 1, claimCanonicalHash: claim.canonicalHash, claimVersionId: version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, matcherIdentity: "stage5-matcher", matcherVersion: "1", matcherHash: h("e"), matcherInputCanonicalHashes: [] };
  const matchBuilt = c.buildClaimEvidenceMatchCanonical(match);
  const assessment = { assessmentId: id(offset + 2), claimEvidenceMatchId: match.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: matchBuilt.hash, claimId: claim.claimId, claimCanonicalVersion: 1, claimCanonicalHash: claim.canonicalHash, claimVersionId: version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, assessmentResult: { relation, rationale: `stage5 ${relation.toLowerCase()} ${offset}` }, methodProvenance: methodValue, assessedAt: "2026-01-01T00:00:00.123456Z" };
  const assessmentBuilt = c.buildEvidenceAssessmentCanonical(assessment);
  return { fragment, match, assessment, built: { fragment: fragmentBuilt, match: matchBuilt, assessment: assessmentBuilt } };
}

function assessmentFor(ids, atom, offset, relation, methodValue = method("HUMAN")) {
  const c = require("../dist/services/rcv022Canonical");
  const assessment = { assessmentId: id(offset), claimEvidenceMatchId: atom.match.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: atom.built.match.hash, claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: atom.fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: atom.built.fragment.hash, assessmentResult: { relation, rationale: `stage5 ${relation.toLowerCase()} ${offset}` }, methodProvenance: methodValue, assessedAt: "2026-01-01T00:00:00.123456Z" };
  return { ...atom, assessment, built: { ...atom.built, assessment: c.buildEvidenceAssessmentCanonical(assessment) } };
}

function makeEnvelope(ids, offset, atoms, assessments = atoms.map((atom) => atom.assessment), claim = ids.claim, version = ids.version) {
  const c = require("../dist/services/rcv022Canonical");
  const envelope = { envelopeId: id(offset), claimId: claim.claimId, claimCanonicalVersion: 1, claimCanonicalHash: claim.canonicalHash, claimVersionId: version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: version.canonicalHash, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:00.123456Z", matchRefs: atoms.map((atom) => ({ id: atom.match.matchId, canonicalVersion: 1, canonicalHash: atom.built.match.hash })), assessmentRefs: assessments.map((atom) => ({ id: atom.assessment.assessmentId, canonicalVersion: 1, canonicalHash: atom.built.assessment.hash })), analysisMethodIdentity: "stage5-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") };
  return { envelope, built: c.buildSemanticAnalysisEnvelopeCanonical(envelope) };
}

async function persistAtoms(atoms) {
  const writer = require("../dist/services/rcv022Writer"); const client = await pool.connect();
  try { await client.query("BEGIN"); for (const atom of atoms) { await writer.persistEvidenceFragmentWithinTransaction(client, atom.fragment); await writer.persistClaimEvidenceMatchWithinTransaction(client, atom.match); await writer.persistEvidenceAssessmentWithinTransaction(client, atom.assessment); } await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}

async function persistAssessments(assessments) {
  const writer = require("../dist/services/rcv022Writer"); const client = await pool.connect();
  try { await client.query("BEGIN"); for (const atom of assessments) await writer.persistEvidenceAssessmentWithinTransaction(client, atom.assessment); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}

async function persistEnvelope(envelope) {
  const writer = require("../dist/services/rcv022Writer"); const client = await pool.connect();
  try { await client.query("BEGIN"); await writer.persistSemanticAnalysisEnvelopeWithinTransaction(client, envelope); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}

function verifyFresh(envelopeId, expectedCode = "PASS", expectedContradiction) {
  const readerPath = path.join(process.cwd(), "dist/services/rcv022Reader.js");
  const child = spawnSync(process.execPath, ["-e", `const {Pool}=require('pg'); const r=require(${JSON.stringify(readerPath)}); const p=new Pool({database:process.env.RCV022_WAVE_D_DATABASE,host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD}); r.verifyRcv022HistoricalEnvelope(process.env.RCV022_ENVELOPE,p).then(v=>{process.stdout.write(JSON.stringify({verified:v.verified,contradiction:v.contradiction})); return p.end().then(()=>process.exit(process.env.EXPECTED_CODE==='PASS'?0:1));}).catch(e=>{process.stdout.write(JSON.stringify({code:e.code})); return p.end().then(()=>process.exit(e.code===process.env.EXPECTED_CODE?0:1));});`], { env: { ...process.env, RCV022_ENVELOPE: envelopeId, EXPECTED_CODE: expectedCode }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const actual = JSON.parse(child.stdout);
  if (expectedCode === "PASS") { assert.equal(actual.verified, true); assert.equal(actual.contradiction, expectedContradiction); }
  else assert.deepEqual(actual, { code: expectedCode });
}

async function snapshotGraph(envelopeId) {
  const result = {};
  for (const [name, table, column] of [["envelope", "rcv022_semantic_analysis_envelopes", "envelope_id"], ["matchRefs", "rcv022_envelope_match_refs", "envelope_id"], ["assessmentRefs", "rcv022_envelope_assessment_refs", "envelope_id"]]) {
    result[name] = (await pool.query(`SELECT row_to_json(t) AS state FROM (SELECT * FROM public.${table} WHERE ${column}=$1 ORDER BY 1) t`, [envelopeId])).rows;
  }
  return result;
}

async function withTriggersDisabled(tables, work) {
  const client = await pool.connect();
  try { for (const table of tables) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`); return await work(client); }
  finally { for (const table of tables) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`).catch(() => {}); client.release(); }
}

async function rewriteEnvelope(envelopeId, mutate, updateSupport = true) {
  const row = (await pool.query("SELECT canonical FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [envelopeId])).rows[0];
  const doc = JSON.parse(row.canonical); mutate(doc);
  const canonical = canonicalizeJson(doc); const values = [canonical, sha(canonical), JSON.stringify(doc.matchRefs), JSON.stringify(doc.assessmentRefs), envelopeId];
  await withTriggersDisabled(["rcv022_semantic_analysis_envelopes", ...(updateSupport ? ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"] : [])], async (client) => {
    await client.query("UPDATE public.rcv022_semantic_analysis_envelopes SET canonical=$1,canonical_hash=$2,match_refs=$3::jsonb,assessment_refs=$4::jsonb WHERE envelope_id=$5", values);
    if (updateSupport) {
      await client.query("DELETE FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1", [envelopeId]);
      await client.query("DELETE FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1", [envelopeId]);
      for (const [ordinal, ref] of doc.matchRefs.entries()) await client.query("INSERT INTO public.rcv022_envelope_match_refs (envelope_id,ordinal,match_id,match_canonical_version,match_canonical_hash) VALUES ($1,$2,$3,$4,$5)", [envelopeId, ordinal, ref.id, ref.canonicalVersion, ref.canonicalHash]);
      for (const [ordinal, ref] of doc.assessmentRefs.entries()) await client.query("INSERT INTO public.rcv022_envelope_assessment_refs (envelope_id,ordinal,assessment_id,assessment_canonical_version,assessment_canonical_hash) VALUES ($1,$2,$3,$4,$5)", [envelopeId, ordinal, ref.id, ref.canonicalVersion, ref.canonicalHash]);
    }
  });
}

test("Wave D Stage 5 contradiction is local, authenticated, deterministic, and non-adjudicative", { concurrency: false, timeout: 240000 }, async () => {
  assert.ok(enabled, "set RCV022_WAVE_D_DATABASE, PGHOST, and PGPORT for disposable PostgreSQL proof");
  const pre = await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rcv022_%'"); assert.equal(pre.rows[0].n, 0);
  await replayMigrations(); const ids = await seedUpstream();
  const support = makeAtom(ids, 100, "SUPPORTS"); const refute = makeAtom(ids, 110, "REFUTES"); const insufficient = makeAtom(ids, 120, "INSUFFICIENT"); const unrelated = makeAtom(ids, 130, "UNRELATED"); const support2 = makeAtom(ids, 140, "SUPPORTS"); const refute2 = makeAtom(ids, 150, "REFUTES"); const refute3 = makeAtom(ids, 160, "REFUTES"); const support3 = makeAtom(ids, 260, "SUPPORTS"); const support4 = makeAtom(ids, 270, "SUPPORTS"); const support5 = makeAtom(ids, 280, "SUPPORTS"); const refute4 = makeAtom(ids, 290, "REFUTES"); const refute5 = makeAtom(ids, 300, "REFUTES");
  const sameMatchRefute = assessmentFor(ids, support, 170, "REFUTES");
  await persistAtoms([support, refute, insufficient, unrelated, support2, refute2, refute3, support3, support4, support5, refute4, refute5]); await persistAssessments([sameMatchRefute]);

  const cases = [
    [180, [support], [support, sameMatchRefute], true],
    [181, [support, refute], [support, refute], true],
    [182, [support], [support], false],
    [183, [refute], [refute], false],
    [184, [support, insufficient], [support, insufficient], false],
    [185, [support, unrelated], [support, unrelated], false],
    [186, [refute, insufficient], [refute, insufficient], false],
    [187, [refute, unrelated], [refute, unrelated], false],
    [188, [insufficient, unrelated], [insufficient, unrelated], false],
    [189, [insufficient], [insufficient], false],
    [190, [unrelated], [unrelated], false],
    [191, [support], [], false],
    [192, [], [], false],
    [193, [support, support2], [support, support2], false],
    [194, [refute, refute2, refute3], [refute, refute2, refute3], false],
    [195, [support, support2, refute], [support, support2, refute], true],
    [196, [support, refute, refute2, refute3], [support, refute, refute2, refute3], true],
    [197, [support, refute, insufficient, unrelated], [support, refute, insufficient, unrelated], true],
    [198, [support, support2, support3, support4, support5, refute], [support, support2, support3, support4, support5, refute], true],
    [199, [support, refute, refute2, refute3, refute4, refute5], [support, refute, refute2, refute3, refute4, refute5], true],
  ];
  const persistedCases = new Map();
  for (const [offset, matches, assessments, expected] of cases) { const env = makeEnvelope(ids, offset, matches, assessments); await persistEnvelope(env.envelope); persistedCases.set(offset, env); const result = await require("../dist/services/rcv022Reader").verifyRcv022HistoricalEnvelope(env.envelope.envelopeId, pool); assert.equal(result.contradiction, expected); }
  verifyFresh(persistedCases.get(180).envelope.envelopeId, "PASS", true);

  const crossEnvelopeA = makeEnvelope(ids, 210, [support], [support]); const crossEnvelopeB = makeEnvelope(ids, 211, [refute], [refute]); await persistEnvelope(crossEnvelopeA.envelope); await persistEnvelope(crossEnvelopeB.envelope); assert.equal((await require("../dist/services/rcv022Reader").verifyRcv022HistoricalEnvelope(crossEnvelopeA.envelope.envelopeId, pool)).contradiction, false); assert.equal((await require("../dist/services/rcv022Reader").verifyRcv022HistoricalEnvelope(crossEnvelopeB.envelope.envelopeId, pool)).contradiction, false);

  const cv2 = makeAtom(ids, 220, "REFUTES", ids.version2, ids.claim); await persistAtoms([cv2]); const crossVersion = makeEnvelope(ids, 221, [support], [cv2], ids.claim, ids.version); await assert.rejects(() => persistEnvelope(crossVersion.envelope), /CLAIM_SCOPE_MISMATCH/);
  const other = makeAtom(ids, 230, "REFUTES", ids.otherVersion, ids.otherClaim); await persistAtoms([other]); const crossClaim = makeEnvelope(ids, 231, [support], [other], ids.claim, ids.version); await assert.rejects(() => persistEnvelope(crossClaim.envelope), /CLAIM_SCOPE_MISMATCH/);

  const invalidRelation = { ...support.assessment, assessmentResult: { relation: "NOT_A_RELATION", rationale: "invalid" } }; assert.throws(() => require("../dist/services/rcv022Canonical").buildEvidenceAssessmentCanonical(invalidRelation), /relation: unsupported/);
  const duplicate = makeEnvelope(ids, 232, [support], [support]); duplicate.envelope.assessmentRefs = [duplicate.envelope.assessmentRefs[0], duplicate.envelope.assessmentRefs[0]]; assert.throws(() => require("../dist/services/rcv022Canonical").buildSemanticAnalysisEnvelopeCanonical(duplicate.envelope), /duplicate member/);

  const hashCorrupt = makeEnvelope(ids, 240, [support, refute], [support, refute]); await persistEnvelope(hashCorrupt.envelope); await rewriteEnvelope(hashCorrupt.envelope.envelopeId, (doc) => { doc.assessmentRefs[0].canonicalHash = h("9"); }); const hashCorruptState = await snapshotGraph(hashCorrupt.envelope.envelopeId); verifyFresh(hashCorrupt.envelope.envelopeId, "HASH_MISMATCH"); assert.deepEqual(await snapshotGraph(hashCorrupt.envelope.envelopeId), hashCorruptState);
  const versionCorrupt = makeEnvelope(ids, 241, [support, refute], [support, refute]); await persistEnvelope(versionCorrupt.envelope); await rewriteEnvelope(versionCorrupt.envelope.envelopeId, (doc) => { doc.assessmentRefs[0].canonicalVersion = 2; }, false); const versionCorruptState = await snapshotGraph(versionCorrupt.envelope.envelopeId); verifyFresh(versionCorrupt.envelope.envelopeId, "UNSUPPORTED_VERSION"); assert.deepEqual(await snapshotGraph(versionCorrupt.envelope.envelopeId), versionCorruptState);
  const closureCorrupt = makeEnvelope(ids, 242, [support, refute], [support, refute]); await persistEnvelope(closureCorrupt.envelope); await rewriteEnvelope(closureCorrupt.envelope.envelopeId, (doc) => { doc.matchRefs = [doc.matchRefs[0]]; }); const closureBefore = await snapshotGraph(closureCorrupt.envelope.envelopeId); verifyFresh(closureCorrupt.envelope.envelopeId, "LINEAGE_MISMATCH"); assert.deepEqual(await snapshotGraph(closureCorrupt.envelope.envelopeId), closureBefore);
  const stale = makeEnvelope(ids, 243, [support, refute], [support, refute]); await persistEnvelope(stale.envelope); await withTriggersDisabled(["rcv022_envelope_assessment_refs"], async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND ordinal=0", [h("8"), stale.envelope.envelopeId]); }); const staleCorruptState = await snapshotGraph(stale.envelope.envelopeId); verifyFresh(stale.envelope.envelopeId, "HASH_MISMATCH"); assert.deepEqual(await snapshotGraph(stale.envelope.envelopeId), staleCorruptState);
  const missingTarget = makeEnvelope(ids, 244, [support], [support]); missingTarget.envelope.assessmentRefs[0] = { ...missingTarget.envelope.assessmentRefs[0], id: id(999) }; await assert.rejects(() => persistEnvelope(missingTarget.envelope), /MISSING_AUTHORITY/);

  const reader = require("../dist/services/rcv022Reader"); const orderA = makeEnvelope(ids, 250, [support, refute], [support, refute]); const orderB = makeEnvelope(ids, 251, [refute, support], [refute, support]); assert.notEqual(orderA.built.hash, orderB.built.hash); await persistEnvelope(orderA.envelope); await persistEnvelope(orderB.envelope); assert.equal((await reader.verifyRcv022HistoricalEnvelope(orderA.envelope.envelopeId, pool)).contradiction, true); assert.equal((await reader.verifyRcv022HistoricalEnvelope(orderB.envelope.envelopeId, pool)).contradiction, true); verifyFresh(orderB.envelope.envelopeId, "PASS", true);
  await withTriggersDisabled(["claim_versions"], async (client) => { await client.query("UPDATE public.claim_versions SET title=$1 WHERE id=$2", ["mutated current row", ids.versionId]); }); assert.equal((await reader.verifyRcv022HistoricalEnvelope(orderA.envelope.envelopeId, pool)).contradiction, true);
  const reverse = makeEnvelope(ids, 252, [support, refute], [support, refute]); await persistEnvelope(reverse.envelope); await withTriggersDisabled(["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"], async (client) => {
    await client.query("DELETE FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1", [reverse.envelope.envelopeId]); await client.query("DELETE FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1", [reverse.envelope.envelopeId]);
    for (const [ordinal, ref] of [...reverse.envelope.matchRefs.entries()].reverse()) await client.query("INSERT INTO public.rcv022_envelope_match_refs (envelope_id,ordinal,match_id,match_canonical_version,match_canonical_hash) VALUES ($1,$2,$3,$4,$5)", [reverse.envelope.envelopeId, ordinal, ref.id, ref.canonicalVersion, ref.canonicalHash]);
    for (const [ordinal, ref] of [...reverse.envelope.assessmentRefs.entries()].reverse()) await client.query("INSERT INTO public.rcv022_envelope_assessment_refs (envelope_id,ordinal,assessment_id,assessment_canonical_version,assessment_canonical_hash) VALUES ($1,$2,$3,$4,$5)", [reverse.envelope.envelopeId, ordinal, ref.id, ref.canonicalVersion, ref.canonicalHash]);
  }); verifyFresh(reverse.envelope.envelopeId, "PASS", true);
  assert.equal(cases.filter((row) => row[3]).length, 7); assert.equal(cases.filter((row) => !row[3]).length, 13);
});

test.after(async () => { if (pool) await pool.end(); });
