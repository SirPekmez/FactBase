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
const id = (n) => `86000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const h = (ch) => ch.repeat(64);
const text = "café 東京";
const textBytes = Buffer.byteLength(text, "utf8");
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
  const representationHash = sha(text);
  const capture = {
    captureId, logicalSourceId: id(4), monitorId: id(5), monitorConfigurationVersionId: id(6), occurrenceId: id(7), retrievalAttemptId: id(8),
    observedAt: "2026-01-01T00:00:00.000000Z", contentHash: representationHash, byteLength: String(textBytes), rawObjectIdentity: null,
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
      VALUES ($1,$2,1,'Wave D fragment title','Wave D fragment statement','en','fact','draft','unpublished','wave-d fragment fixture',$3)`, [versionId, claimId, "2026-01-01T00:00:00.000000Z"]);
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
    return { claimId, versionId, captureId, captureCanonicalHash: captureBuilt.hash, captureRepresentationHash: representationHash, claim, version };
  } catch (error) { await authority.query("ROLLBACK").catch(() => {}); throw error; }
  finally { authority.release(); }
}

function structuredCanonical() {
  const value = { items: [{ name: "zero" }, { name: "one" }] };
  return canonicalizeJson(value);
}

function makeBundle(ids, kind, locator, contentBinding, extractionAuthority, offset) {
  const c = require("../dist/services/rcv022Canonical");
  const fragment = { fragmentId: id(offset), captureId: ids.captureId, captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: ids.captureCanonicalHash, captureRepresentationHash: ids.captureRepresentationHash, fragmentKind: kind, locator, contentBinding, extractionAuthority };
  const fragmentBuilt = c.buildEvidenceFragmentCanonical(fragment);
  const match = { matchId: id(offset + 1), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, matcherIdentity: "wave-d-fragment-matcher", matcherVersion: "1", matcherHash: h("e"), matcherInputCanonicalHashes: [] };
  const matchBuilt = c.buildClaimEvidenceMatchCanonical(match);
  const assessment = { assessmentId: id(offset + 2), claimEvidenceMatchId: match.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: matchBuilt.hash, claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, assessmentResult: { relation: "SUPPORTS", rationale: "fixed fragment matrix rationale" }, methodProvenance: { methodType: "DETERMINISTIC", methodIdentity: "wave-d-fragment-method", methodVersion: "1", methodHash: h("a"), inputCanonicalHashes: [], structuredOutputHash: h("b"), reviewStatus: "NOT_REVIEWED" }, assessedAt: "2026-01-01T00:00:00.123456Z" };
  const assessmentBuilt = c.buildEvidenceAssessmentCanonical(assessment);
  const envelope = { envelopeId: id(offset + 3), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:00.123456Z", matchRefs: [{ id: match.matchId, canonicalVersion: 1, canonicalHash: matchBuilt.hash }], assessmentRefs: [{ id: assessment.assessmentId, canonicalVersion: 1, canonicalHash: assessmentBuilt.hash }], analysisMethodIdentity: "wave-d-fragment-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") };
  return { fragment, match, assessment, envelope, built: { fragment: fragmentBuilt, match: matchBuilt, assessment: assessmentBuilt, envelope: c.buildSemanticAnalysisEnvelopeCanonical(envelope) } };
}

async function persistBundle(bundle) {
  const w = require("../dist/services/rcv022Writer"); const client = await pool.connect();
  try { await client.query("BEGIN"); await w.persistRcv022BundleWithinTransaction(client, { ...bundle, inspector: { inspect: () => ({ representationHash: bundle.fragment.captureRepresentationHash, imageWidth: 10, imageHeight: 8 }) } }); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

function verifyInFreshProcess(envelopeId, expectedCode = "PASS") {
  const readerPath = path.join(process.cwd(), "dist/services/rcv022Reader.js");
  const child = spawnSync(process.execPath, ["-e", `const {Pool}=require('pg'); const r=require(${JSON.stringify(readerPath)}); const p=new Pool({database:process.env.RCV022_WAVE_D_DATABASE,host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD}); r.verifyRcv022HistoricalEnvelope(process.env.RCV022_ENVELOPE,p).then(v=>{process.stdout.write(JSON.stringify({verified:v.verified})); return p.end().then(()=>process.exit(process.env.EXPECTED_CODE==='PASS'?0:1));}).catch(e=>{process.stdout.write(JSON.stringify({code:e.code})); return p.end().then(()=>process.exit(e.code===process.env.EXPECTED_CODE?0:1));});`], { env: { ...process.env, RCV022_ENVELOPE: envelopeId, EXPECTED_CODE: expectedCode }, encoding: "utf8" });
  assert.equal(child.status, 0, `${child.stderr} ${child.stdout}`); assert.deepEqual(JSON.parse(child.stdout), expectedCode === "PASS" ? { verified: true } : { code: expectedCode });
}

async function snapshot(table, column, value) { return (await pool.query(`SELECT row_to_json(t) AS state FROM (SELECT * FROM public.${table} WHERE ${column}=$1) t`, [value])).rows; }
async function withUserTriggersDisabled(table, work) { const client = await pool.connect(); try { await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`); return await work(client); } finally { await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`).catch(() => {}); client.release(); } }

test("Wave D Stage 3 Fragment matrix persists, restarts, rejects invalid locators, and remains historical", { concurrency: false, timeout: 240000 }, async (t) => {
  if (!enabled) { t.skip("set RCV022_WAVE_D_DATABASE, PGHOST, and PGPORT for disposable PostgreSQL proof"); return; }
  const pre = await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rcv022_%'"); assert.equal(pre.rows[0].n, 0);
  await replayMigrations(); const ids = await seedAuthenticatedUpstream(); const c = require("../dist/services/rcv022Canonical");
  const textBinding = { kind: "TEXT", utf8Text: text, contentHash: sha(text) };
  const structured = structuredCanonical(); const structuredBinding = { kind: "STRUCTURED", canonicalVersion: 1, canonical: structured, canonicalHash: sha(structured) };
  const imageBinding = { kind: "IMAGE_REGION", sourceRepresentationHash: ids.captureRepresentationHash };
  const direct = { kind: "DIRECT" }; const derived = { kind: "DERIVED", extractorIdentity: "wave-d-extractor", extractorVersion: "1", extractorHash: h("c") };
  const valid = [
    ["TEXT_WHOLE_TEXT_DIRECT", "TEXT", { kind: "WHOLE_TEXT" }, textBinding, direct, 100],
    ["TEXT_UTF8_BYTE_RANGE_DIRECT", "TEXT", { kind: "UTF8_BYTE_RANGE", startByte: 4, endByteExclusive: textBytes }, textBinding, direct, 110],
    ["STRUCTURED_STRUCTURED_PATH_DIRECT", "STRUCTURED", { kind: "STRUCTURED_PATH", segments: [{ kind: "KEY", key: "items" }, { kind: "INDEX", index: 1 }, { kind: "KEY", key: "name" }] }, structuredBinding, direct, 120],
    ["IMAGE_REGION_DIRECT", "IMAGE_REGION", { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 10, imageHeight: 8, x: 8, y: 6, width: 2, height: 2 }, imageBinding, direct, 130],
    ["TEXT_WHOLE_TEXT_DERIVED", "TEXT", { kind: "WHOLE_TEXT" }, textBinding, derived, 140],
  ];
  const bundles = new Map();
  for (const [name, kind, locator, binding, extraction, offset] of valid) { const bundle = makeBundle(ids, kind, locator, binding, extraction, offset); bundles.set(name, bundle); await persistBundle(bundle); verifyInFreshProcess(bundle.envelope.envelopeId); }
  assert.notEqual(valid[0][3].utf8Text.length, textBytes); assert.equal(valid[1][2].endByteExclusive, textBytes); assert.equal(c.buildEvidenceFragmentCanonical({ ...bundles.get("TEXT_UTF8_BYTE_RANGE_DIRECT").fragment, locator: { kind: "UTF8_BYTE_RANGE", startByte: 5, endByteExclusive: 6 } }).value.locator.startByte, 5);
  const utf8 = Buffer.from(text, "utf8"); const halfOpenStart = 3; const halfOpenEnd = 11;
  const halfOpenExpected = Buffer.from([0xc3, 0xa9, 0x20, 0xe6, 0x9d, 0xb1, 0xe4, 0xba]);
  const halfOpenBundle = { ...bundles.get("TEXT_UTF8_BYTE_RANGE_DIRECT").fragment, locator: { kind: "UTF8_BYTE_RANGE", startByte: halfOpenStart, endByteExclusive: halfOpenEnd } };
  c.buildEvidenceFragmentCanonical(halfOpenBundle);
  assert.deepEqual([...utf8.subarray(halfOpenStart, halfOpenEnd)], [...halfOpenExpected]);
  assert.equal(utf8[halfOpenEnd], 0xac);
  assert.notDeepEqual([...utf8.subarray(halfOpenStart, halfOpenEnd + 1)], [...halfOpenExpected]);
  assert.throws(() => makeBundle(ids, "TEXT", { kind: "UTF8_BYTE_RANGE", startByte: textBytes, endByteExclusive: textBytes }, textBinding, direct, 650), /invalid byte range/);

  const crossFamily = [
    ["TEXT", { kind: "STRUCTURED_PATH", segments: [] }, textBinding], ["TEXT", { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 1, imageHeight: 1, x: 0, y: 0, width: 1, height: 1 }, textBinding],
    ["STRUCTURED", { kind: "WHOLE_TEXT" }, structuredBinding], ["STRUCTURED", { kind: "UTF8_BYTE_RANGE", startByte: 0, endByteExclusive: 1 }, structuredBinding], ["STRUCTURED", { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 1, imageHeight: 1, x: 0, y: 0, width: 1, height: 1 }, structuredBinding],
    ["IMAGE_REGION", { kind: "WHOLE_TEXT" }, imageBinding], ["IMAGE_REGION", { kind: "UTF8_BYTE_RANGE", startByte: 0, endByteExclusive: 1 }, imageBinding], ["IMAGE_REGION", { kind: "STRUCTURED_PATH", segments: [] }, imageBinding],
  ];
  for (const [kind, locator, binding] of crossFamily) assert.throws(() => makeBundle(ids, kind, locator, binding, direct, 500 + crossFamily.indexOf(crossFamily.find((x) => x[0] === kind && x[1] === locator))), /mismatch/);
  const ranges = [{ startByte: -1, endByteExclusive: 1 }, { startByte: 4, endByteExclusive: 3 }, { startByte: 4, endByteExclusive: textBytes + 1 }, { startByte: 1.5, endByteExclusive: 2 }, { startByte: null, endByteExclusive: 2 }];
  for (const locator of ranges) assert.throws(() => makeBundle(ids, "TEXT", { kind: "UTF8_BYTE_RANGE", ...locator }, textBinding, direct, 600 + ranges.indexOf(locator)), /invalid byte range|expected integer|byte range exceeds|null\/undefined/);
  const structuredNegatives = [{ kind: "STRUCTURED_PATH", segments: [{ kind: "INDEX", index: -1 }] }, { kind: "STRUCTURED_PATH", segments: [{ kind: "INDEX", index: 1.5 }] }, { kind: "STRUCTURED_PATH", segments: [{ kind: "INDEX", index: "1" }] }, { kind: "STRUCTURED_PATH", segments: [{ kind: "KEY", key: "" }] }, { kind: "STRUCTURED_PATH", segments: [{ kind: "NOPE", key: "items" }] }, { kind: "STRUCTURED_PATH", segments: [{ kind: "KEY", key: "items", extra: true }] }];
  for (const locator of structuredNegatives) assert.throws(() => makeBundle(ids, "STRUCTURED", locator, structuredBinding, direct, 700 + structuredNegatives.indexOf(locator)), /invalid index|invalid segment|expected non-empty|expected integer|unexpected or missing key/);
  const imageNegatives = [
    { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 10, imageHeight: 8, x: -1, y: 0, width: 1, height: 1 },
    { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 10, imageHeight: 8, x: 0, y: 0, width: 0, height: 1 },
    { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 10, imageHeight: 8, x: 9, y: 0, width: 2, height: 1 },
    { kind: "IMAGE_REGION", coordinateSystemId: "wrong", coordinateSystemVersion: 1, imageWidth: 10, imageHeight: 8, x: 0, y: 0, width: 1, height: 1 },
    { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 10.5, imageHeight: 8, x: 0, y: 0, width: 1, height: 1 },
    { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 10, imageHeight: 8, x: 0, y: 7, width: 1, height: 2 },
    { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 0, imageHeight: 8, x: 0, y: 0, width: 1, height: 1 },
    { kind: "IMAGE_REGION", coordinateSystemId: "raw-pixel-v1", coordinateSystemVersion: 1, imageWidth: 10, imageHeight: 0, x: 0, y: 0, width: 1, height: 1 },
  ];
  for (const locator of imageNegatives) assert.throws(() => makeBundle(ids, "IMAGE_REGION", locator, imageBinding, direct, 800 + imageNegatives.indexOf(locator)), /invalid|outside|coordinate|expected integer/);
  const extractionNegatives = [
    { kind: "DIRECT", extra: true },
    { kind: "DERIVED", extractorVersion: "1", extractorHash: h("c") },
    { kind: "DERIVED", extractorIdentity: "wave-d-extractor", extractorHash: h("c") },
    { kind: "DERIVED", extractorIdentity: "wave-d-extractor", extractorVersion: "1" },
    { kind: "DERIVED", extractorIdentity: "wave-d-extractor", extractorVersion: "1", extractorHash: null },
    { kind: "OTHER" },
  ];
  for (const extraction of extractionNegatives) assert.throws(() => makeBundle(ids, "TEXT", { kind: "WHOLE_TEXT" }, textBinding, extraction, 820 + extractionNegatives.indexOf(extraction)), /unexpected or missing key|unsupported|lowercase SHA-256|null\/undefined/);
  const keyCaseA = makeBundle(ids, "STRUCTURED", { kind: "STRUCTURED_PATH", segments: [{ kind: "KEY", key: "items" }] }, structuredBinding, direct, 850);
  const keyCaseB = makeBundle(ids, "STRUCTURED", { kind: "STRUCTURED_PATH", segments: [{ kind: "KEY", key: "Items" }] }, structuredBinding, direct, 860);
  assert.notEqual(keyCaseA.built.fragment.hash, keyCaseB.built.fragment.hash);
  const samePayloadA = { ...bundles.get("TEXT_WHOLE_TEXT_DIRECT").fragment, fragmentId: id(900) };
  const samePayloadB = { ...bundles.get("TEXT_WHOLE_TEXT_DIRECT").fragment, fragmentId: id(901) };
  assert.notEqual(c.buildEvidenceFragmentCanonical(samePayloadA).hash, c.buildEvidenceFragmentCanonical(samePayloadB).hash);
  const captureCase = makeBundle({ ...ids, captureCanonicalHash: h("f") }, "TEXT", { kind: "WHOLE_TEXT" }, textBinding, direct, 870);
  assert.notEqual(bundles.get("TEXT_WHOLE_TEXT_DIRECT").built.fragment.hash, captureCase.built.fragment.hash);
  assert.notEqual(bundles.get("TEXT_WHOLE_TEXT_DIRECT").built.fragment.hash, bundles.get("TEXT_WHOLE_TEXT_DERIVED").built.fragment.hash);

  const badInspector = makeBundle(ids, "IMAGE_REGION", valid[3][2], imageBinding, direct, 890); const badClient = await pool.connect(); let inspectorError;
  try { await badClient.query("BEGIN"); await require("../dist/services/rcv022Writer").persistRcv022BundleWithinTransaction(badClient, { ...badInspector, inspector: { inspect: () => ({ representationHash: h("f"), imageWidth: 10, imageHeight: 8 }) } }); await badClient.query("COMMIT"); } catch (error) { inspectorError = error; await badClient.query("ROLLBACK"); } finally { badClient.release(); }
  assert.match(String(inspectorError), /capture representation/);

  const rollback = makeBundle(ids, "TEXT", { kind: "WHOLE_TEXT" }, textBinding, direct, 880); rollback.envelope.assessmentRefs[0].canonicalHash = h("f");
  const w = require("../dist/services/rcv022Writer"); const tx = await pool.connect(); let rollbackError;
  try { await tx.query("BEGIN"); await w.persistRcv022BundleWithinTransaction(tx, { ...rollback, inspector: undefined }); await tx.query("COMMIT"); } catch (error) { rollbackError = error; await tx.query("ROLLBACK"); } finally { tx.release(); }
  assert.ok(rollbackError); for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", rollback.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", rollback.match.matchId], ["rcv022_evidence_assessments", "assessment_id", rollback.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", rollback.envelope.envelopeId]]) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${column}=$1`, [value])).rows[0].n, 0);

  const corruption = bundles.get("TEXT_WHOLE_TEXT_DIRECT"); const original = {};
  for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", corruption.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", corruption.match.matchId], ["rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", corruption.envelope.envelopeId]]) original[table] = (await snapshot(table, column, value))[0];
  original.matchSupport = (await snapshot("rcv022_envelope_match_refs", "match_id", corruption.match.matchId))[0]; original.assessmentSupport = (await snapshot("rcv022_envelope_assessment_refs", "assessment_id", corruption.assessment.assessmentId))[0];
  const fragmentObj = JSON.parse(original.rcv022_evidence_fragments.state.canonical); fragmentObj.locator = { kind: "UTF8_BYTE_RANGE", startByte: 4, endByteExclusive: textBytes + 1 }; const fragmentCanonical = canonicalizeJson(fragmentObj); const fragmentHash = sha(fragmentCanonical);
  const matchObj = JSON.parse(original.rcv022_claim_evidence_matches.state.canonical); matchObj.evidenceFragmentCanonicalHash = fragmentHash; const matchCanonical = canonicalizeJson(matchObj); const matchHash = sha(matchCanonical);
  const assessmentObj = JSON.parse(original.rcv022_evidence_assessments.state.canonical); assessmentObj.claimEvidenceMatchCanonicalHash = matchHash; assessmentObj.evidenceFragmentCanonicalHash = fragmentHash; const assessmentCanonical = canonicalizeJson(assessmentObj); const assessmentHash = sha(assessmentCanonical);
  const envelopeObj = JSON.parse(original.rcv022_semantic_analysis_envelopes.state.canonical); envelopeObj.matchRefs = envelopeObj.matchRefs.map((ref) => ref.id === corruption.match.matchId ? { ...ref, canonicalHash: matchHash } : ref); envelopeObj.assessmentRefs = envelopeObj.assessmentRefs.map((ref) => ref.id === corruption.assessment.assessmentId ? { ...ref, canonicalHash: assessmentHash } : ref); const envelopeCanonical = canonicalizeJson(envelopeObj); const envelopeHash = sha(envelopeCanonical);
  try {
    await withUserTriggersDisabled("rcv022_evidence_fragments", async (client) => { await client.query("UPDATE public.rcv022_evidence_fragments SET canonical=$1,canonical_hash=$2,locator=$3::jsonb WHERE fragment_id=$4", [fragmentCanonical, fragmentHash, JSON.stringify(fragmentObj.locator), corruption.fragment.fragmentId]); });
    await withUserTriggersDisabled("rcv022_claim_evidence_matches", async (client) => { await client.query("UPDATE public.rcv022_claim_evidence_matches SET canonical=$1,canonical_hash=$2,evidence_fragment_canonical_hash=$3 WHERE match_id=$4", [matchCanonical, matchHash, fragmentHash, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET canonical=$1,canonical_hash=$2,claim_evidence_match_canonical_hash=$3,evidence_fragment_canonical_hash=$4 WHERE assessment_id=$5", [assessmentCanonical, assessmentHash, matchHash, fragmentHash, corruption.assessment.assessmentId]); });
    await withUserTriggersDisabled("rcv022_semantic_analysis_envelopes", async (client) => { await client.query("UPDATE public.rcv022_semantic_analysis_envelopes SET canonical=$1,canonical_hash=$2,match_refs=$3::jsonb,assessment_refs=$4::jsonb WHERE envelope_id=$5", [envelopeCanonical, envelopeHash, JSON.stringify(envelopeObj.matchRefs), JSON.stringify(envelopeObj.assessmentRefs), corruption.envelope.envelopeId]); });
    await withUserTriggersDisabled("rcv022_envelope_match_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_match_refs SET match_canonical_hash=$1 WHERE envelope_id=$2 AND match_id=$3", [matchHash, corruption.envelope.envelopeId, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [assessmentHash, corruption.envelope.envelopeId, corruption.assessment.assessmentId]); });
    const before = {}; for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", corruption.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", corruption.match.matchId], ["rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", corruption.envelope.envelopeId]]) before[table] = (await snapshot(table, column, value))[0]; before.matchSupport = (await snapshot("rcv022_envelope_match_refs", "match_id", corruption.match.matchId))[0]; before.assessmentSupport = (await snapshot("rcv022_envelope_assessment_refs", "assessment_id", corruption.assessment.assessmentId))[0];
    verifyInFreshProcess(corruption.envelope.envelopeId, "MALFORMED_DATA"); const reader = require("../dist/services/rcv022Reader"); await assert.rejects(() => reader.verifyRcv022HistoricalEnvelope(corruption.envelope.envelopeId, pool), (error) => error.code === "MALFORMED_DATA");
    for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", corruption.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", corruption.match.matchId], ["rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", corruption.envelope.envelopeId]]) assert.deepEqual((await snapshot(table, column, value))[0], before[table]); assert.deepEqual((await snapshot("rcv022_envelope_match_refs", "match_id", corruption.match.matchId))[0], before.matchSupport); assert.deepEqual((await snapshot("rcv022_envelope_assessment_refs", "assessment_id", corruption.assessment.assessmentId))[0], before.assessmentSupport);
    await withUserTriggersDisabled("rcv022_evidence_fragments", async (client) => { await client.query("UPDATE public.rcv022_evidence_fragments SET canonical=$1,canonical_hash=$2,locator=$3::jsonb WHERE fragment_id=$4", [original.rcv022_evidence_fragments.state.canonical, original.rcv022_evidence_fragments.state.canonical_hash, JSON.stringify(original.rcv022_evidence_fragments.state.locator), corruption.fragment.fragmentId]); });
    await withUserTriggersDisabled("rcv022_claim_evidence_matches", async (client) => { await client.query("UPDATE public.rcv022_claim_evidence_matches SET canonical=$1,canonical_hash=$2,evidence_fragment_canonical_hash=$3 WHERE match_id=$4", [original.rcv022_claim_evidence_matches.state.canonical, original.rcv022_claim_evidence_matches.state.canonical_hash, original.rcv022_claim_evidence_matches.state.evidence_fragment_canonical_hash, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET canonical=$1,canonical_hash=$2,claim_evidence_match_canonical_hash=$3,evidence_fragment_canonical_hash=$4 WHERE assessment_id=$5", [original.rcv022_evidence_assessments.state.canonical, original.rcv022_evidence_assessments.state.canonical_hash, original.rcv022_evidence_assessments.state.claim_evidence_match_canonical_hash, original.rcv022_evidence_assessments.state.evidence_fragment_canonical_hash, corruption.assessment.assessmentId]); });
    await withUserTriggersDisabled("rcv022_semantic_analysis_envelopes", async (client) => { await client.query("UPDATE public.rcv022_semantic_analysis_envelopes SET canonical=$1,canonical_hash=$2,match_refs=$3::jsonb,assessment_refs=$4::jsonb WHERE envelope_id=$5", [original.rcv022_semantic_analysis_envelopes.state.canonical, original.rcv022_semantic_analysis_envelopes.state.canonical_hash, JSON.stringify(original.rcv022_semantic_analysis_envelopes.state.match_refs), JSON.stringify(original.rcv022_semantic_analysis_envelopes.state.assessment_refs), corruption.envelope.envelopeId]); });
    await withUserTriggersDisabled("rcv022_envelope_match_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_match_refs SET match_canonical_hash=$1 WHERE envelope_id=$2 AND match_id=$3", [original.matchSupport.state.match_canonical_hash, corruption.envelope.envelopeId, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [original.assessmentSupport.state.assessment_canonical_hash, corruption.envelope.envelopeId, corruption.assessment.assessmentId]); });
    await withUserTriggersDisabled("rcv022_envelope_match_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_match_refs SET match_canonical_hash=$1 WHERE envelope_id=$2 AND match_id=$3", [h("f"), corruption.envelope.envelopeId, corruption.match.matchId]); }); verifyInFreshProcess(corruption.envelope.envelopeId, "HASH_MISMATCH");
  } finally {
    await withUserTriggersDisabled("rcv022_evidence_fragments", async (client) => { await client.query("UPDATE public.rcv022_evidence_fragments SET canonical=$1,canonical_hash=$2,locator=$3::jsonb WHERE fragment_id=$4", [original.rcv022_evidence_fragments.state.canonical, original.rcv022_evidence_fragments.state.canonical_hash, JSON.stringify(original.rcv022_evidence_fragments.state.locator), corruption.fragment.fragmentId]); });
    await withUserTriggersDisabled("rcv022_claim_evidence_matches", async (client) => { await client.query("UPDATE public.rcv022_claim_evidence_matches SET canonical=$1,canonical_hash=$2,evidence_fragment_canonical_hash=$3 WHERE match_id=$4", [original.rcv022_claim_evidence_matches.state.canonical, original.rcv022_claim_evidence_matches.state.canonical_hash, original.rcv022_claim_evidence_matches.state.evidence_fragment_canonical_hash, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET canonical=$1,canonical_hash=$2,claim_evidence_match_canonical_hash=$3,evidence_fragment_canonical_hash=$4 WHERE assessment_id=$5", [original.rcv022_evidence_assessments.state.canonical, original.rcv022_evidence_assessments.state.canonical_hash, original.rcv022_evidence_assessments.state.claim_evidence_match_canonical_hash, original.rcv022_evidence_assessments.state.evidence_fragment_canonical_hash, corruption.assessment.assessmentId]); });
    await withUserTriggersDisabled("rcv022_semantic_analysis_envelopes", async (client) => { await client.query("UPDATE public.rcv022_semantic_analysis_envelopes SET canonical=$1,canonical_hash=$2,match_refs=$3::jsonb,assessment_refs=$4::jsonb WHERE envelope_id=$5", [original.rcv022_semantic_analysis_envelopes.state.canonical, original.rcv022_semantic_analysis_envelopes.state.canonical_hash, JSON.stringify(original.rcv022_semantic_analysis_envelopes.state.match_refs), JSON.stringify(original.rcv022_semantic_analysis_envelopes.state.assessment_refs), corruption.envelope.envelopeId]); });
    await withUserTriggersDisabled("rcv022_envelope_match_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_match_refs SET match_canonical_hash=$1 WHERE envelope_id=$2 AND match_id=$3", [original.matchSupport.state.match_canonical_hash, corruption.envelope.envelopeId, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [original.assessmentSupport.state.assessment_canonical_hash, corruption.envelope.envelopeId, corruption.assessment.assessmentId]); });
  }

  const incompatibleOriginal = {};
  for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", corruption.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", corruption.match.matchId], ["rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", corruption.envelope.envelopeId]]) incompatibleOriginal[table] = (await snapshot(table, column, value))[0];
  incompatibleOriginal.matchSupport = (await snapshot("rcv022_envelope_match_refs", "match_id", corruption.match.matchId))[0]; incompatibleOriginal.assessmentSupport = (await snapshot("rcv022_envelope_assessment_refs", "assessment_id", corruption.assessment.assessmentId))[0];
  const incompatibleFragmentObj = JSON.parse(incompatibleOriginal.rcv022_evidence_fragments.state.canonical); incompatibleFragmentObj.locator = { kind: "STRUCTURED_PATH", segments: [] }; const incompatibleFragmentCanonical = canonicalizeJson(incompatibleFragmentObj); const incompatibleFragmentHash = sha(incompatibleFragmentCanonical);
  const incompatibleMatchObj = JSON.parse(incompatibleOriginal.rcv022_claim_evidence_matches.state.canonical); incompatibleMatchObj.evidenceFragmentCanonicalHash = incompatibleFragmentHash; const incompatibleMatchCanonical = canonicalizeJson(incompatibleMatchObj); const incompatibleMatchHash = sha(incompatibleMatchCanonical);
  const incompatibleAssessmentObj = JSON.parse(incompatibleOriginal.rcv022_evidence_assessments.state.canonical); incompatibleAssessmentObj.claimEvidenceMatchCanonicalHash = incompatibleMatchHash; incompatibleAssessmentObj.evidenceFragmentCanonicalHash = incompatibleFragmentHash; const incompatibleAssessmentCanonical = canonicalizeJson(incompatibleAssessmentObj); const incompatibleAssessmentHash = sha(incompatibleAssessmentCanonical);
  const incompatibleEnvelopeObj = JSON.parse(incompatibleOriginal.rcv022_semantic_analysis_envelopes.state.canonical); incompatibleEnvelopeObj.matchRefs = incompatibleEnvelopeObj.matchRefs.map((ref) => ref.id === corruption.match.matchId ? { ...ref, canonicalHash: incompatibleMatchHash } : ref); incompatibleEnvelopeObj.assessmentRefs = incompatibleEnvelopeObj.assessmentRefs.map((ref) => ref.id === corruption.assessment.assessmentId ? { ...ref, canonicalHash: incompatibleAssessmentHash } : ref); const incompatibleEnvelopeCanonical = canonicalizeJson(incompatibleEnvelopeObj); const incompatibleEnvelopeHash = sha(incompatibleEnvelopeCanonical);
  try {
    await withUserTriggersDisabled("rcv022_evidence_fragments", async (client) => { await client.query("UPDATE public.rcv022_evidence_fragments SET canonical=$1,canonical_hash=$2,locator=$3::jsonb WHERE fragment_id=$4", [incompatibleFragmentCanonical, incompatibleFragmentHash, JSON.stringify(incompatibleFragmentObj.locator), corruption.fragment.fragmentId]); });
    await withUserTriggersDisabled("rcv022_claim_evidence_matches", async (client) => { await client.query("UPDATE public.rcv022_claim_evidence_matches SET canonical=$1,canonical_hash=$2,evidence_fragment_canonical_hash=$3 WHERE match_id=$4", [incompatibleMatchCanonical, incompatibleMatchHash, incompatibleFragmentHash, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET canonical=$1,canonical_hash=$2,claim_evidence_match_canonical_hash=$3,evidence_fragment_canonical_hash=$4 WHERE assessment_id=$5", [incompatibleAssessmentCanonical, incompatibleAssessmentHash, incompatibleMatchHash, incompatibleFragmentHash, corruption.assessment.assessmentId]); });
    await withUserTriggersDisabled("rcv022_semantic_analysis_envelopes", async (client) => { await client.query("UPDATE public.rcv022_semantic_analysis_envelopes SET canonical=$1,canonical_hash=$2,match_refs=$3::jsonb,assessment_refs=$4::jsonb WHERE envelope_id=$5", [incompatibleEnvelopeCanonical, incompatibleEnvelopeHash, JSON.stringify(incompatibleEnvelopeObj.matchRefs), JSON.stringify(incompatibleEnvelopeObj.assessmentRefs), corruption.envelope.envelopeId]); });
    await withUserTriggersDisabled("rcv022_envelope_match_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_match_refs SET match_canonical_hash=$1 WHERE envelope_id=$2 AND match_id=$3", [incompatibleMatchHash, corruption.envelope.envelopeId, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [incompatibleAssessmentHash, corruption.envelope.envelopeId, corruption.assessment.assessmentId]); });
    const incompatibleBefore = {}; for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", corruption.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", corruption.match.matchId], ["rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", corruption.envelope.envelopeId]]) incompatibleBefore[table] = (await snapshot(table, column, value))[0]; incompatibleBefore.matchSupport = (await snapshot("rcv022_envelope_match_refs", "match_id", corruption.match.matchId))[0]; incompatibleBefore.assessmentSupport = (await snapshot("rcv022_envelope_assessment_refs", "assessment_id", corruption.assessment.assessmentId))[0];
    verifyInFreshProcess(corruption.envelope.envelopeId, "MALFORMED_DATA"); const incompatibleReader = require("../dist/services/rcv022Reader"); await assert.rejects(() => incompatibleReader.verifyRcv022HistoricalEnvelope(corruption.envelope.envelopeId, pool), (error) => error.code === "MALFORMED_DATA");
    for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", corruption.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", corruption.match.matchId], ["rcv022_evidence_assessments", "assessment_id", corruption.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", corruption.envelope.envelopeId]]) assert.deepEqual((await snapshot(table, column, value))[0], incompatibleBefore[table]); assert.deepEqual((await snapshot("rcv022_envelope_match_refs", "match_id", corruption.match.matchId))[0], incompatibleBefore.matchSupport); assert.deepEqual((await snapshot("rcv022_envelope_assessment_refs", "assessment_id", corruption.assessment.assessmentId))[0], incompatibleBefore.assessmentSupport);
  } finally {
    await withUserTriggersDisabled("rcv022_evidence_fragments", async (client) => { await client.query("UPDATE public.rcv022_evidence_fragments SET canonical=$1,canonical_hash=$2,locator=$3::jsonb WHERE fragment_id=$4", [incompatibleOriginal.rcv022_evidence_fragments.state.canonical, incompatibleOriginal.rcv022_evidence_fragments.state.canonical_hash, JSON.stringify(incompatibleOriginal.rcv022_evidence_fragments.state.locator), corruption.fragment.fragmentId]); });
    await withUserTriggersDisabled("rcv022_claim_evidence_matches", async (client) => { await client.query("UPDATE public.rcv022_claim_evidence_matches SET canonical=$1,canonical_hash=$2,evidence_fragment_canonical_hash=$3 WHERE match_id=$4", [incompatibleOriginal.rcv022_claim_evidence_matches.state.canonical, incompatibleOriginal.rcv022_claim_evidence_matches.state.canonical_hash, incompatibleOriginal.rcv022_evidence_fragments.state.canonical_hash, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_evidence_assessments", async (client) => { await client.query("UPDATE public.rcv022_evidence_assessments SET canonical=$1,canonical_hash=$2,claim_evidence_match_canonical_hash=$3,evidence_fragment_canonical_hash=$4 WHERE assessment_id=$5", [incompatibleOriginal.rcv022_evidence_assessments.state.canonical, incompatibleOriginal.rcv022_evidence_assessments.state.canonical_hash, incompatibleOriginal.rcv022_claim_evidence_matches.state.canonical_hash, incompatibleOriginal.rcv022_evidence_fragments.state.canonical_hash, corruption.assessment.assessmentId]); });
    await withUserTriggersDisabled("rcv022_semantic_analysis_envelopes", async (client) => { await client.query("UPDATE public.rcv022_semantic_analysis_envelopes SET canonical=$1,canonical_hash=$2,match_refs=$3::jsonb,assessment_refs=$4::jsonb WHERE envelope_id=$5", [incompatibleOriginal.rcv022_semantic_analysis_envelopes.state.canonical, incompatibleOriginal.rcv022_semantic_analysis_envelopes.state.canonical_hash, JSON.stringify(incompatibleOriginal.rcv022_semantic_analysis_envelopes.state.match_refs), JSON.stringify(incompatibleOriginal.rcv022_semantic_analysis_envelopes.state.assessment_refs), corruption.envelope.envelopeId]); });
    await withUserTriggersDisabled("rcv022_envelope_match_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_match_refs SET match_canonical_hash=$1 WHERE envelope_id=$2 AND match_id=$3", [incompatibleOriginal.matchSupport.state.match_canonical_hash, corruption.envelope.envelopeId, corruption.match.matchId]); });
    await withUserTriggersDisabled("rcv022_envelope_assessment_refs", async (client) => { await client.query("UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$1 WHERE envelope_id=$2 AND assessment_id=$3", [incompatibleOriginal.assessmentSupport.state.assessment_canonical_hash, corruption.envelope.envelopeId, corruption.assessment.assessmentId]); });
  }
});

test.after(async () => { if (pool) await pool.end(); });
