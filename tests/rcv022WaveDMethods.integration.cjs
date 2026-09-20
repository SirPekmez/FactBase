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
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 8 }) : null;
const root = path.join(__dirname, "..");
const id = (n) => `85000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const digest = (value) => sha(canonicalizeJson(value));
const wrongDigest = (value) => { const good = digest(value); return `${good[0] === "0" ? "1" : "0"}${good.slice(1)}`; };
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
      VALUES ($1,$2,1,'Wave D method title','Wave D method statement','en','fact','draft','unpublished','wave-d method fixture',$3)`, [versionId, claimId, "2026-01-01T00:00:00.000000Z"]);
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

function sampling() { return { schema: "factbase-rcv022-sampling-parameters", canonicalVersion: 1, entries: [{ name: "temperature", value: 0 }] }; }
function methodProvenance(kind, participation, acceptanceStatus) {
  const common = { methodIdentity: `wave-d-${kind.toLowerCase()}-method`, methodVersion: "1", methodHash: h("a"), inputCanonicalHashes: [], structuredOutputHash: h("b"), reviewStatus: kind === "HUMAN" ? "REVIEWED" : "NOT_REVIEWED" };
  if (kind === "DETERMINISTIC") return { methodType: kind, ...common };
  if (kind === "HUMAN") return { methodType: kind, ...common, reviewerIdentity: "wave-d-reviewer", reviewProcessIdentity: "wave-d-review-process", reviewProcessVersion: "1", reviewProcessHash: h("c") };
  const samplingParameters = sampling(); const model = { methodType: kind, ...common, providerIdentity: "wave-d-provider", modelIdentity: "wave-d-model", modelVersion: "1", processIdentity: "wave-d-process", processVersion: "1", processHash: h("c"), promptTemplateHash: h("d"), systemInstructionHash: h("e"), samplingParameters, samplingParametersHash: digest(samplingParameters), rawOutputHash: h("a"), retryIdentity: "wave-d-retry", toolParticipation: participation };
  if (participation === "USED") model.toolContextHash = h("d");
  if (kind === "MIXED") { model.reviewerIdentity = "wave-d-reviewer"; model.reviewProcessIdentity = "wave-d-review-process"; model.reviewProcessVersion = "1"; model.reviewProcessHash = h("e"); model.acceptanceStatus = acceptanceStatus; model.reviewStatus = "REVIEWED"; }
  return model;
}

function makeBundle(ids, method, offset) {
  const c = require("../dist/services/rcv022Canonical");
  const fragment = { fragmentId: id(offset), captureId: ids.captureId, captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: ids.captureCanonicalHash, captureRepresentationHash: h("b"), fragmentKind: "TEXT", locator: { kind: "WHOLE_TEXT" }, contentBinding: { kind: "TEXT", utf8Text: "method matrix text", contentHash: sha("method matrix text") }, extractionAuthority: { kind: "DIRECT" } };
  const fragmentBuilt = c.buildEvidenceFragmentCanonical(fragment);
  const match = { matchId: id(offset + 1), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, matcherIdentity: "wave-d-method-matcher", matcherVersion: "1", matcherHash: h("e"), matcherInputCanonicalHashes: [] };
  const matchBuilt = c.buildClaimEvidenceMatchCanonical(match);
  const assessment = { assessmentId: id(offset + 2), claimEvidenceMatchId: match.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: matchBuilt.hash, claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, assessmentResult: { relation: "SUPPORTS", rationale: "fixed method matrix rationale" }, methodProvenance: method, assessedAt: "2026-01-01T00:00:00.123456Z" };
  const assessmentBuilt = c.buildEvidenceAssessmentCanonical(assessment);
  const envelope = { envelopeId: id(offset + 3), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:00.123456Z", matchRefs: [{ id: match.matchId, canonicalVersion: 1, canonicalHash: matchBuilt.hash }], assessmentRefs: [{ id: assessment.assessmentId, canonicalVersion: 1, canonicalHash: assessmentBuilt.hash }], analysisMethodIdentity: "wave-d-method-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") };
  return { fragment, match, assessment, envelope, built: { fragment: fragmentBuilt, match: matchBuilt, assessment: assessmentBuilt, envelope: c.buildSemanticAnalysisEnvelopeCanonical(envelope) } };
}

async function persistBundle(bundle) {
  const w = require("../dist/services/rcv022Writer"); const client = await pool.connect();
  try { await client.query("BEGIN"); await w.persistRcv022BundleWithinTransaction(client, bundle); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

async function snapshot(table, column, value) { return (await pool.query(`SELECT row_to_json(t) AS state FROM (SELECT * FROM public.${table} WHERE ${column}=$1) t`, [value])).rows; }
async function withUserTriggersDisabled(table, work) { const client = await pool.connect(); try { await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`); return await work(client); } finally { await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`).catch(() => {}); client.release(); } }
function verifyInFreshProcess(envelopeId, expectedCode) {
  const readerPath = path.join(process.cwd(), "dist/services/rcv022Reader.js");
  const child = spawnSync(process.execPath, ["-e", `const {Pool}=require('pg'); const r=require(${JSON.stringify(readerPath)}); const p=new Pool({database:process.env.RCV022_WAVE_D_DATABASE,host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD}); r.verifyRcv022HistoricalEnvelope(process.env.RCV022_ENVELOPE,p).then(v=>{process.stdout.write(JSON.stringify({verified:v.verified})); return p.end().then(()=>process.exit(process.env.EXPECTED_CODE==='PASS'?0:1));}).catch(e=>{process.stdout.write(JSON.stringify({code:e.code})); return p.end().then(()=>process.exit(e.code===process.env.EXPECTED_CODE?0:1));});`], { env: { ...process.env, RCV022_ENVELOPE: envelopeId, EXPECTED_CODE: expectedCode }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), expectedCode === "PASS" ? { verified: true } : { code: expectedCode });
}

async function expectInvalidAssessment(ids, method, offset) {
  const bundle = makeBundle(ids, methodProvenance("DETERMINISTIC"), offset); bundle.assessment.methodProvenance = method; const w = require("../dist/services/rcv022Writer"); const client = await pool.connect(); let error;
  try { await client.query("BEGIN"); await w.persistEvidenceAssessmentWithinTransaction(client, bundle.assessment); } catch (e) { error = e; await client.query("ROLLBACK"); } finally { client.release(); }
  assert.ok(error); assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [bundle.envelope.envelopeId])).rows[0].n, 0);
}

test("Wave D MethodProvenance matrix persists, restarts, verifies, and fails closed", { concurrency: false, timeout: 180000 }, async (t) => {
  if (!enabled) { t.skip("set RCV022_WAVE_D_DATABASE, PGHOST, and PGPORT for disposable PostgreSQL proof"); return; }
  const pre = await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rcv022_%'"); assert.equal(pre.rows[0].n, 0);
  await replayMigrations(); const ids = await seedAuthenticatedUpstream();
  const orderedSampling = sampling(); const reorderedSampling = { entries: orderedSampling.entries, schema: orderedSampling.schema, canonicalVersion: orderedSampling.canonicalVersion };
  assert.equal(canonicalizeJson(orderedSampling), canonicalizeJson(reorderedSampling)); assert.equal(digest(orderedSampling), digest(reorderedSampling)); assert.equal(digest(orderedSampling), "991c32c266cf69f0bca68c8879f697999742b737988187906495443a7505fa3a");
  const unicodeSampling = { schema: orderedSampling.schema, canonicalVersion: 1, entries: [{ name: "temperature", value: "café" }] };
  assert.equal(digest(unicodeSampling), createHash("sha256").update(canonicalizeJson(unicodeSampling), "utf8").digest("hex"));
  const cases = [
    ["DETERMINISTIC", methodProvenance("DETERMINISTIC"), 100],
    ["MODEL_ASSISTED_USED", methodProvenance("MODEL_ASSISTED", "USED"), 110],
    ["MODEL_ASSISTED_NOT_USED", methodProvenance("MODEL_ASSISTED", "NOT_USED"), 120],
    ["HUMAN", methodProvenance("HUMAN"), 130],
    ["MIXED_USED", methodProvenance("MIXED", "USED", "PENDING"), 140],
    ["MIXED_NOT_USED_ACCEPTED", methodProvenance("MIXED", "NOT_USED", "ACCEPTED"), 150],
    ["MIXED_NOT_USED_REJECTED", methodProvenance("MIXED", "NOT_USED", "REJECTED"), 160],
  ];
  const bundles = new Map();
  for (const [name, method, offset] of cases) {
    const bundle = makeBundle(ids, method, offset); bundles.set(name, bundle); await persistBundle(bundle);
    const row = (await pool.query("SELECT canonical,canonical_hash,method_provenance,assessment_result FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0];
    assert.equal(row.canonical, bundle.built.assessment.canonical); assert.equal(row.canonical_hash, bundle.built.assessment.hash); assert.deepEqual(row.method_provenance, method); assert.deepEqual(row.assessment_result, bundle.assessment.assessmentResult);
    verifyInFreshProcess(bundle.envelope.envelopeId, "PASS");
  }
  assert.equal(new Set([...bundles.values()].map((b) => b.built.assessment.hash)).size, cases.length);
  assert.equal(Object.prototype.hasOwnProperty.call(bundles.get("MODEL_ASSISTED_USED").assessment.methodProvenance, "toolContextHash"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(bundles.get("MODEL_ASSISTED_NOT_USED").assessment.methodProvenance, "toolContextHash"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bundles.get("MIXED_USED").assessment.methodProvenance, "toolContextHash"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(bundles.get("MIXED_NOT_USED_ACCEPTED").assessment.methodProvenance, "toolContextHash"), false);
  assert.equal(new Set(["PENDING", "ACCEPTED", "REJECTED"]).size, 3);

  const canonical = require("../dist/services/rcv022Canonical");
  for (const [name, method] of [["MODEL_ASSISTED", bundles.get("MODEL_ASSISTED_USED").assessment.methodProvenance], ["MIXED", bundles.get("MIXED_USED").assessment.methodProvenance]]) {
    const wrong = { ...method, samplingParametersHash: wrongDigest(method.samplingParameters) };
    assert.throws(() => canonical.buildEvidenceAssessmentCanonical({ ...bundles.get("MODEL_ASSISTED_USED").assessment, methodProvenance: wrong }), /samplingParametersHash.*does not match/ , name);
  }

  const c = require("../dist/services/rcv022Canonical");
  assert.notEqual(c.buildEvidenceAssessmentCanonical({ ...bundles.get("MODEL_ASSISTED_USED").assessment, methodProvenance: methodProvenance("MODEL_ASSISTED", "USED") }).hash, c.buildEvidenceAssessmentCanonical({ ...bundles.get("MODEL_ASSISTED_USED").assessment, methodProvenance: methodProvenance("MODEL_ASSISTED", "NOT_USED") }).hash);
  assert.notEqual(c.buildEvidenceAssessmentCanonical({ ...bundles.get("MIXED_USED").assessment, methodProvenance: methodProvenance("MIXED", "USED", "PENDING") }).hash, c.buildEvidenceAssessmentCanonical({ ...bundles.get("MIXED_USED").assessment, methodProvenance: methodProvenance("MIXED", "NOT_USED", "PENDING") }).hash);

  const invalidBase = methodProvenance("MODEL_ASSISTED", "USED");
  const invalids = [
    ["model missing participation", { ...invalidBase, toolParticipation: undefined }, 300],
    ["model used missing context", { ...invalidBase, toolContextHash: undefined }, 301],
    ["model not used with context", { ...invalidBase, toolParticipation: "NOT_USED" }, 302],
    ["model not used null context", { ...invalidBase, toolParticipation: "NOT_USED", toolContextHash: null }, 303],
    ["mixed missing participation", { ...methodProvenance("MIXED", "USED", "PENDING"), toolParticipation: undefined }, 304],
    ["mixed used missing context", { ...methodProvenance("MIXED", "USED", "PENDING"), toolContextHash: undefined }, 305],
    ["mixed not used with context", { ...methodProvenance("MIXED", "NOT_USED", "PENDING"), toolContextHash: h("a") }, 306],
    ["mixed not used null context", { ...methodProvenance("MIXED", "NOT_USED", "PENDING"), toolContextHash: null }, 307],
    ["deterministic participation", { ...methodProvenance("DETERMINISTIC"), toolParticipation: "NOT_USED" }, 308],
    ["deterministic context", { ...methodProvenance("DETERMINISTIC"), toolContextHash: h("a") }, 309],
    ["human participation", { ...methodProvenance("HUMAN"), toolParticipation: "NOT_USED" }, 310],
    ["human context", { ...methodProvenance("HUMAN"), toolContextHash: h("a") }, 311],
    ["invalid method type", { ...methodProvenance("DETERMINISTIC"), methodType: "UNKNOWN" }, 312],
    ["invalid review status", { ...methodProvenance("DETERMINISTIC"), reviewStatus: "PENDING" }, 313],
    ["invalid acceptance status", { ...methodProvenance("MIXED", "USED", "PENDING"), acceptanceStatus: "UNKNOWN" }, 314],
    ["duplicate sampling name", { ...methodProvenance("MODEL_ASSISTED", "USED"), samplingParameters: { ...sampling(), entries: [{ name: "temperature", value: 0 }, { name: "temperature", value: 1 }] } }, 315],
    ["invalid structured output hash", { ...methodProvenance("DETERMINISTIC"), structuredOutputHash: "A".repeat(64) }, 316],
  ];
  for (const [, method, offset] of invalids) await expectInvalidAssessment(ids, method, offset);

  const rollback = makeBundle(ids, methodProvenance("MODEL_ASSISTED", "USED"), 330); rollback.envelope.assessmentRefs[0].canonicalHash = h("f");
  const w = require("../dist/services/rcv022Writer"); const client = await pool.connect(); let rollbackError;
  try { await client.query("BEGIN"); await w.persistEvidenceFragmentWithinTransaction(client, rollback.fragment); await w.persistClaimEvidenceMatchWithinTransaction(client, rollback.match); await w.persistEvidenceAssessmentWithinTransaction(client, rollback.assessment); await w.persistSemanticAnalysisEnvelopeWithinTransaction(client, rollback.envelope); await client.query("COMMIT"); } catch (error) { rollbackError = error; await client.query("ROLLBACK"); } finally { client.release(); }
  assert.ok(rollbackError); for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", rollback.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", rollback.match.matchId], ["rcv022_evidence_assessments", "assessment_id", rollback.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", rollback.envelope.envelopeId]]) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${column}=$1`, [value])).rows[0].n, 0);

  const corruption = bundles.get("MODEL_ASSISTED_USED"); const before = await snapshot("rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId);
  await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET method_provenance=jsonb_set(method_provenance,'{toolParticipation}',to_jsonb('NOT_USED'::text)) WHERE assessment_id=$1", [corruption.assessment.assessmentId]); });
  const corrupted = await snapshot("rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId); verifyInFreshProcess(corruption.envelope.envelopeId, "LINEAGE_MISMATCH");
  const reader = require("../dist/services/rcv022Reader"); await assert.rejects(() => reader.verifyRcv022HistoricalEnvelope(corruption.envelope.envelopeId, pool), (error) => error.code === "LINEAGE_MISMATCH"); assert.deepEqual(await snapshot("rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId), corrupted); assert.notDeepEqual(corrupted, before);
  await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET method_provenance=$1::jsonb WHERE assessment_id=$2", [JSON.stringify(corruption.assessment.methodProvenance), corruption.assessment.assessmentId]); });

  const digestCorruption = bundles.get("MODEL_ASSISTED_USED"); const originalDigestRow = (await pool.query("SELECT canonical,canonical_hash,method_provenance FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [digestCorruption.assessment.assessmentId])).rows[0];
  const originalEnvelopeRow = (await pool.query("SELECT canonical,canonical_hash,assessment_refs FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [digestCorruption.envelope.envelopeId])).rows[0];
  const originalSupportRow = (await pool.query("SELECT envelope_id,ordinal,assessment_id,assessment_canonical_version,assessment_canonical_hash FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 AND assessment_id=$2", [digestCorruption.envelope.envelopeId, digestCorruption.assessment.assessmentId])).rows[0];
  const digestCanonicalObject = JSON.parse(originalDigestRow.canonical); const digestMethod = { ...digestCanonicalObject.methodProvenance, samplingParametersHash: wrongDigest(digestCanonicalObject.methodProvenance.samplingParameters) }; digestCanonicalObject.methodProvenance = digestMethod; const digestCanonical = canonicalizeJson(digestCanonicalObject); const digestHash = sha(digestCanonical);
  const digestEnvelopeObject = JSON.parse(originalEnvelopeRow.canonical); const digestAssessmentRefs = digestEnvelopeObject.assessmentRefs.map((ref) => ref.id === digestCorruption.assessment.assessmentId ? { ...ref, canonicalHash: digestHash } : ref); digestEnvelopeObject.assessmentRefs = digestAssessmentRefs; const digestEnvelopeCanonical = canonicalizeJson(digestEnvelopeObject); const digestEnvelopeHash = sha(digestEnvelopeCanonical);
  let digestCorruptState;
  try {
    await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET canonical=$1,canonical_hash=$2,method_provenance=$3::jsonb WHERE assessment_id=$4", [digestCanonical, digestHash, JSON.stringify(digestMethod), digestCorruption.assessment.assessmentId]); });
    await withUserTriggersDisabled("rcv022_semantic_analysis_envelopes", async (client) => { await client.query("UPDATE public.rcv022_semantic_analysis_envelopes SET canonical=$1,canonical_hash=$2,assessment_refs=$3::jsonb WHERE envelope_id=$4", [digestEnvelopeCanonical, digestEnvelopeHash, JSON.stringify(digestAssessmentRefs), digestCorruption.envelope.envelopeId]); });
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [digestHash, digestCorruption.envelope.envelopeId, digestCorruption.assessment.assessmentId]); });
    assert.equal((await pool.query("SELECT canonical,canonical_hash,method_provenance FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [digestCorruption.assessment.assessmentId])).rows[0].canonical, digestCanonical);
    assert.equal((await pool.query("SELECT canonical_hash FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [digestCorruption.assessment.assessmentId])).rows[0].canonical_hash, digestHash);
    assert.deepEqual((await pool.query("SELECT method_provenance FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [digestCorruption.assessment.assessmentId])).rows[0].method_provenance, digestMethod);
    assert.deepEqual((await pool.query("SELECT assessment_refs FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [digestCorruption.envelope.envelopeId])).rows[0].assessment_refs, digestAssessmentRefs);
    assert.equal((await pool.query("SELECT canonical_hash FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [digestCorruption.envelope.envelopeId])).rows[0].canonical_hash, digestEnvelopeHash);
    assert.equal((await pool.query("SELECT assessment_canonical_hash FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 AND assessment_id=$2", [digestCorruption.envelope.envelopeId, digestCorruption.assessment.assessmentId])).rows[0].assessment_canonical_hash, digestHash);
    digestCorruptState = { assessment: await snapshot("rcv022_evidence_assessments", "assessment_id", digestCorruption.assessment.assessmentId), envelope: await snapshot("rcv022_semantic_analysis_envelopes", "envelope_id", digestCorruption.envelope.envelopeId), support: await snapshot("rcv022_envelope_assessment_refs", "assessment_id", digestCorruption.assessment.assessmentId) }; verifyInFreshProcess(digestCorruption.envelope.envelopeId, "MALFORMED_DATA");
    const digestReader = require("../dist/services/rcv022Reader"); await assert.rejects(() => digestReader.verifyRcv022HistoricalEnvelope(digestCorruption.envelope.envelopeId, pool), (error) => error.code === "MALFORMED_DATA"); assert.deepEqual(await snapshot("rcv022_evidence_assessments", "assessment_id", digestCorruption.assessment.assessmentId), digestCorruptState.assessment); assert.deepEqual(await snapshot("rcv022_semantic_analysis_envelopes", "envelope_id", digestCorruption.envelope.envelopeId), digestCorruptState.envelope); assert.deepEqual(await snapshot("rcv022_envelope_assessment_refs", "assessment_id", digestCorruption.assessment.assessmentId), digestCorruptState.support);
  } finally {
    await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET canonical=$1,canonical_hash=$2,method_provenance=$3::jsonb WHERE assessment_id=$4", [originalDigestRow.canonical, originalDigestRow.canonical_hash, JSON.stringify(originalDigestRow.method_provenance), digestCorruption.assessment.assessmentId]); });
    await withUserTriggersDisabled("rcv022_semantic_analysis_envelopes", async (client) => { await client.query("UPDATE public.rcv022_semantic_analysis_envelopes SET canonical=$1,canonical_hash=$2,assessment_refs=$3::jsonb WHERE envelope_id=$4", [originalEnvelopeRow.canonical, originalEnvelopeRow.canonical_hash, JSON.stringify(originalEnvelopeRow.assessment_refs), digestCorruption.envelope.envelopeId]); });
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [originalSupportRow.assessment_canonical_hash, digestCorruption.envelope.envelopeId, digestCorruption.assessment.assessmentId]); });
  }

  const staleSupportBefore = await snapshot("rcv022_envelope_assessment_refs", "assessment_id", digestCorruption.assessment.assessmentId); try {
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [wrongDigest(digestCorruption.assessment.methodProvenance.samplingParameters), digestCorruption.envelope.envelopeId, digestCorruption.assessment.assessmentId]); });
    verifyInFreshProcess(digestCorruption.envelope.envelopeId, "HASH_MISMATCH"); const staleReader = require("../dist/services/rcv022Reader"); await assert.rejects(() => staleReader.verifyRcv022HistoricalEnvelope(digestCorruption.envelope.envelopeId, pool), (error) => error.code === "HASH_MISMATCH"); assert.notDeepEqual(await snapshot("rcv022_envelope_assessment_refs", "assessment_id", digestCorruption.assessment.assessmentId), staleSupportBefore);
  } finally {
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [originalSupportRow.assessment_canonical_hash, digestCorruption.envelope.envelopeId, digestCorruption.assessment.assessmentId]); });
  }
});

test.after(async () => { if (pool) await pool.end(); });
