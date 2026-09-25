const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const test = require("node:test");

const database = process.env.RCV022_WAVE_B_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 4 }) : null;
const root = path.join(__dirname, "..");
const id = (n) => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value) => require("node:crypto").createHash("sha256").update(value, "utf8").digest("hex");
const h = (character) => character.repeat(64);

function migrationFiles() {
  return fs.readdirSync(path.join(root, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(root, "migrations", name));
}

async function replayMigrations() {
  const client = await pool.connect();
  try {
    for (const file of migrationFiles()) await client.query(fs.readFileSync(file, "utf8"));
  } finally { client.release(); }
}

async function seedUpstream() {
  const claimId = id(1);
  const versionId = id(2);
  const version2Id = id(6);
  const claimCanonical = require("../dist/services/claimHistoricalAuthorityCanonical");
  const claimWriter = require("../dist/services/claimHistoricalAuthorityWriter");
  const captures = [3, 4, 5].map((n) => ({
    captureId: id(n), logicalSourceId: id(10 + n), monitorId: id(20 + n), monitorConfigurationVersionId: id(30 + n), occurrenceId: id(40 + n), retrievalAttemptId: id(50 + n),
    requestHash: h(String.fromCharCode(96 + n)), requestedTarget: `https://example.test/${n}`, finalUrl: `https://example.test/${n}`, redirectCanonical: null,
    responseStatus: 200, responseMetadataCanonical: "{}", mediaType: "text/plain", byteLength: "5", observedAt: "2026-01-01T00:00:00.000000Z", contentHash: h("b"),
    retentionPolicy: "METADATA_HASH_ONLY", retentionPolicyVersion: 1, rawObjectIdentity: null, rawObjectReference: null,
  }));
  const captureCanonical = require("../dist/services/rcv020SemanticCore");
  const builtCaptures = captures.map((capture) => ({ ...capture, built: captureCanonical.canonicalizeRcv020Capture(capture) }));
  const client = await pool.connect();
  try {
    await client.query("SET session_replication_role='replica'");
    await client.query("INSERT INTO public.claims(id) VALUES ($1)", [claimId]);
    await client.query(`INSERT INTO public.claim_versions (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at) VALUES ($1,$2,1,'Golden claim','A persisted authenticated claim','en','fact','draft','unpublished','wave-b',$3)`, [versionId, claimId, "2026-01-01T00:00:00.000000Z"]);
    await client.query(`INSERT INTO public.claim_versions (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at) VALUES ($1,$2,2,'Golden claim v2','A second authenticated claim version','en','fact','draft','unpublished','wave-b-negative',$3)`, [version2Id, claimId, "2026-01-01T00:00:01.000000Z"]);
    for (const capture of builtCaptures) {
      await client.query(`INSERT INTO public.rcv020_captures (capture_id,logical_source_id,monitor_id,monitor_configuration_version_id,occurrence_id,retrieval_attempt_id,request_hash,requested_target,final_url,redirect_canonical,response_status,response_metadata_canonical,media_type,byte_length,observed_at,content_hash,canonical,capture_hash,retention_policy,retention_policy_version,raw_object_identity,raw_object_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, [capture.captureId,capture.logicalSourceId,capture.monitorId,capture.monitorConfigurationVersionId,capture.occurrenceId,capture.retrievalAttemptId,capture.requestHash,capture.requestedTarget,capture.finalUrl,capture.redirectCanonical,capture.responseStatus,capture.responseMetadataCanonical,capture.mediaType,capture.byteLength,capture.observedAt,capture.contentHash,capture.built.canonical,capture.built.hash,capture.retentionPolicy,capture.retentionPolicyVersion,capture.rawObjectIdentity,capture.rawObjectReference]);
    }
  } finally { await client.query("SET session_replication_role='origin'").catch(() => {}); client.release(); }
  const authority = await pool.connect();
  try {
    await authority.query("BEGIN");
    const claim = await claimWriter.persistClaimIdentityAuthorityWithinTransaction(authority, claimId);
    const version = await claimWriter.persistClaimVersionAuthorityWithinTransaction(authority, versionId);
    const version2 = await claimWriter.persistClaimVersionAuthorityWithinTransaction(authority, version2Id);
    await authority.query("COMMIT");
    return { claimId, versionId, version2Id, captures: builtCaptures, claim, version, version2, claimCanonical };
  } catch (error) { await authority.query("ROLLBACK").catch(() => {}); throw error; }
  finally { authority.release(); }
}

function makeEvidence(ids, n, relation) {
  const canonical = require("../dist/services/rcv022Canonical");
  const capture = ids.captures[n];
  const fragment = { fragmentId: id(100 + n), captureId: capture.captureId, captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: capture.built.hash, captureRepresentationHash: capture.contentHash, fragmentKind: "TEXT", locator: { kind: "WHOLE_TEXT" }, contentBinding: { kind: "TEXT", utf8Text: `evidence-${n}`, contentHash: hash(`evidence-${n}`) }, extractionAuthority: { kind: "DIRECT" } };
  const fragmentBuilt = canonical.buildEvidenceFragmentCanonical(fragment);
  const match = { matchId: id(200 + n), claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, matcherIdentity: "golden-matcher", matcherVersion: "1", matcherHash: h("e"), matcherInputCanonicalHashes: [] };
  const matchBuilt = canonical.buildClaimEvidenceMatchCanonical(match);
  const methodHashes = ["a", "b", "c"].map((character) => character.repeat(64));
  const assessment = { assessmentId: id(300 + n), claimEvidenceMatchId: match.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: matchBuilt.hash, claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, evidenceFragmentId: fragment.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragmentBuilt.hash, assessmentResult: { relation, rationale: `golden rationale ${n}` }, methodProvenance: { methodType: "DETERMINISTIC", methodIdentity: `golden-method-${n}`, methodVersion: "1", methodHash: methodHashes[n], inputCanonicalHashes: [], structuredOutputHash: h("b"), reviewStatus: "NOT_REVIEWED" }, assessedAt: `2026-01-01T00:00:0${n}.123456Z` };
  const assessmentBuilt = canonical.buildEvidenceAssessmentCanonical(assessment);
  return { fragment, match, assessment, built: { fragment: fragmentBuilt, match: matchBuilt, assessment: assessmentBuilt } };
}

function makeEnvelope(ids, envelopeId, evidence, analysisAt) {
  const canonical = require("../dist/services/rcv022Canonical");
  const input = { envelopeId, claimId: ids.claimId, claimCanonicalVersion: 1, claimCanonicalHash: ids.claim.canonicalHash, claimVersionId: ids.version.claimVersionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: ids.version.canonicalHash, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt, matchRefs: evidence.map((entry) => ({ id: entry.match.matchId, canonicalVersion: 1, canonicalHash: entry.built.match.hash })), assessmentRefs: evidence.map((entry) => ({ id: entry.assessment.assessmentId, canonicalVersion: 1, canonicalHash: entry.built.assessment.hash })), analysisMethodIdentity: "golden-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") };
  return { input, built: canonical.buildSemanticAnalysisEnvelopeCanonical(input) };
}

async function persistBundle(bundle) {
  const writer = require("../dist/services/rcv022Writer");
  const client = await pool.connect();
  try { await client.query("BEGIN"); await writer.persistRcv022BundleWithinTransaction(client, bundle); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

async function physicalMembershipOrder(envelopeId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT ctid::text AS physical_id, ordinal, assessment_id::text AS assessment_id FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 ORDER BY ctid",
      [envelopeId],
    );
    return result.rows.map((row) => [row.physical_id, Number(row.ordinal), row.assessment_id]);
  } finally { client.release(); }
}

async function reorderMembershipStorage() {
  const client = await pool.connect();
  try {
    await client.query("CREATE INDEX claim_level_wave_b_row_order_idx ON public.rcv022_envelope_assessment_refs (envelope_id, ordinal DESC)");
    await client.query("CLUSTER public.rcv022_envelope_assessment_refs USING claim_level_wave_b_row_order_idx");
    await client.query("DROP INDEX claim_level_wave_b_row_order_idx");
  } finally { client.release(); }
}

function tamperedMatchCommitmentPool(basePool, envelopeId, tamperedCanonical, tamperedHash, tamperedMatchRefs, wrongMatchHash) {
  return {
    async connect() {
      const client = await basePool.connect();
      return {
        async query(text, values = []) {
          const result = await client.query(text, values);
          if (text.includes("FROM public.rcv022_semantic_analysis_envelopes") && values[0] === envelopeId) {
            return { ...result, rows: result.rows.map((row) => ({ ...row, canonical: tamperedCanonical, canonical_hash: tamperedHash, match_refs: tamperedMatchRefs })) };
          }
          if (text.includes("FROM public.rcv022_envelope_match_refs") && values[0] === envelopeId) {
            return { ...result, rows: result.rows.map((row, index) => index === 0 ? { ...row, canonical_hash: wrongMatchHash } : row) };
          }
          return result;
        },
        release() { client.release(); },
      };
    },
  };
}

test("Wave B Golden Slice authenticates and projects exact persisted scope", { concurrency: false, timeout: 60000 }, async (t) => {
  if (!enabled) { t.skip("set RCV022_WAVE_B_DATABASE, PGHOST, and PGPORT for disposable PostgreSQL proof"); return; }
  await replayMigrations();
  const ids = await seedUpstream();
  const x = makeEvidence(ids, 0, "SUPPORTS");
  const y = makeEvidence(ids, 1, "REFUTES");
  const z = makeEvidence(ids, 2, "INSUFFICIENT");
  await persistBundle({ fragment: x.fragment, match: x.match, assessment: x.assessment, envelope: makeEnvelope(ids, id(400), [x], "2026-01-01T00:00:10.000000Z").input });
  await persistBundle({ fragment: y.fragment, match: y.match, assessment: y.assessment, envelope: makeEnvelope(ids, id(401), [y], "2026-01-01T00:00:11.000000Z").input });
  await persistBundle({ fragment: z.fragment, match: z.match, assessment: z.assessment, envelope: makeEnvelope(ids, id(402), [z], "2026-01-01T00:00:12.000000Z").input });
  const envelopeA = makeEnvelope(ids, id(403), [x, y], "2026-01-01T00:01:00.000000Z").input;
  const envelopeB = makeEnvelope(ids, id(404), [x, z], "2026-01-01T00:01:01.000000Z").input;
  await persistBundle({ fragment: x.fragment, match: x.match, assessment: x.assessment, envelope: envelopeA });
  await persistBundle({ fragment: x.fragment, match: x.match, assessment: x.assessment, envelope: envelopeB });
  const view = require("../dist/services/claimLevelEvidenceView");
  const ref = (entry) => ({ envelopeId: entry.envelopeId, canonicalVersion: 1, canonicalHash: makeEnvelope(ids, entry.envelopeId, entry.evidence, entry.analysisAt).built.hash });
  const spec = { claimVersionRef: { claimVersionId: ids.version.claimVersionId, canonicalVersion: 1, canonicalHash: ids.version.canonicalHash }, envelopeManifest: [ref({ envelopeId: envelopeB.envelopeId, evidence: [x, z], analysisAt: envelopeB.analysisAt }), ref({ envelopeId: envelopeA.envelopeId, evidence: [x, y], analysisAt: envelopeA.analysisAt })], contractVersion: 1 };
  const result = await view.getClaimLevelEvidenceView(spec, pool);
  const envelopeARef = spec.envelopeManifest.find((entry) => entry.envelopeId === envelopeA.envelopeId);
  const envelopeBRef = spec.envelopeManifest.find((entry) => entry.envelopeId === envelopeB.envelopeId);
  const expectedAssessment = (entry) => ({
    assessmentRef: { assessmentId: entry.assessment.assessmentId, canonicalVersion: 1, canonicalHash: entry.built.assessment.hash },
    claimEvidenceMatchRef: { matchId: entry.match.matchId, canonicalVersion: 1, canonicalHash: entry.built.match.hash },
    evidenceFragmentRef: { fragmentId: entry.fragment.fragmentId, canonicalVersion: 1, canonicalHash: entry.built.fragment.hash },
    claimVersionRef: spec.claimVersionRef,
    relation: entry.assessment.assessmentResult.relation,
    rationale: entry.assessment.assessmentResult.rationale,
    methodProvenance: entry.assessment.methodProvenance,
    assessedAt: entry.assessment.assessedAt,
  });
  assert.deepEqual(result.claimVersionRef, spec.claimVersionRef);
  assert.deepEqual(result.envelopeManifest, [envelopeARef, envelopeBRef]);
  assert.deepEqual(result.assessmentManifest.map((entry) => entry.assessmentRef.assessmentId), [x.assessment.assessmentId, y.assessment.assessmentId, z.assessment.assessmentId].sort());
  assert.deepEqual(result.assessmentManifest, [expectedAssessment(x), expectedAssessment(y), expectedAssessment(z)]);
  assert.deepEqual(result.occurrenceManifest.map((entry) => [entry.envelopeRef.envelopeId, entry.assessmentRef.assessmentId, entry.ordinal]), [[envelopeA.envelopeId, x.assessment.assessmentId, 0], [envelopeA.envelopeId, y.assessment.assessmentId, 1], [envelopeB.envelopeId, x.assessment.assessmentId, 0], [envelopeB.envelopeId, z.assessment.assessmentId, 1]]);
  assert.deepEqual(result.envelopeProvenance, [
    { envelopeRef: envelopeARef, claimVersionRef: spec.claimVersionRef, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: envelopeA.analysisAt, analysisMethodIdentity: "golden-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") },
    { envelopeRef: envelopeBRef, claimVersionRef: spec.claimVersionRef, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: envelopeB.analysisAt, analysisMethodIdentity: "golden-analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") },
  ]);
  assert.deepEqual(result.scopeEnumeration, { scopeKind: "EXPLICIT_ENVELOPE_SET", status: "ENUMERATED_AND_CONSIDERED" });
  assert.deepEqual(await view.getClaimLevelEvidenceView({ ...spec, envelopeManifest: [...spec.envelopeManifest].reverse() }, pool), result);
  const beforePhysicalOrder = await physicalMembershipOrder(envelopeA.envelopeId);
  await reorderMembershipStorage();
  const afterPhysicalOrder = await physicalMembershipOrder(envelopeA.envelopeId);
  assert.notDeepEqual(afterPhysicalOrder, beforePhysicalOrder);
  assert.deepEqual(await view.getClaimLevelEvidenceView(spec, pool), result);
  await assert.rejects(() => view.getClaimLevelEvidenceView({ ...spec, envelopeManifest: [{ envelopeId: id(999), canonicalVersion: 1, canonicalHash: h("a") }] , }, pool), (error) => error.code === "MISSING_AUTHORITY");
  await assert.rejects(() => view.getClaimLevelEvidenceView({ ...spec, claimVersionRef: { claimVersionId: id(998), canonicalVersion: 1, canonicalHash: h("a") } }, pool), (error) => error.code === "MISSING_AUTHORITY");
  await assert.rejects(() => view.getClaimLevelEvidenceView({ ...spec, claimVersionRef: { claimVersionId: ids.version2Id, canonicalVersion: 1, canonicalHash: ids.version2.canonicalHash } }, pool), (error) => error.code === "CLAIM_SCOPE_MISMATCH");
  await assert.rejects(() => view.getClaimLevelEvidenceView({ ...spec, envelopeManifest: [envelopeARef, { envelopeId: id(997), canonicalVersion: 1, canonicalHash: h("a") }] }, pool), (error) => error.code === "MISSING_AUTHORITY");
  const canonical = require("../dist/services/rcv022Canonical");
  const wrongMatchHash = h("f");
  const tamperedEnvelopeInput = { ...envelopeA, matchRefs: envelopeA.matchRefs.map((entry, index) => index === 0 ? { ...entry, canonicalHash: wrongMatchHash } : entry) };
  const tamperedEnvelope = canonical.buildSemanticAnalysisEnvelopeCanonical(tamperedEnvelopeInput);
  const tamperedSpec = { ...spec, envelopeManifest: [{ envelopeId: envelopeA.envelopeId, canonicalVersion: 1, canonicalHash: tamperedEnvelope.hash }] };
  await assert.rejects(() => view.getClaimLevelEvidenceView(tamperedSpec, tamperedMatchCommitmentPool(pool, envelopeA.envelopeId, tamperedEnvelope.canonical, tamperedEnvelope.hash, tamperedEnvelopeInput.matchRefs, wrongMatchHash)), (error) => error.code === "HASH_MISMATCH");
  const empty = await view.getClaimLevelEvidenceView({ claimVersionRef: spec.claimVersionRef, envelopeManifest: [], contractVersion: 1 }, pool);
  assert.deepEqual(empty.claimVersionRef, spec.claimVersionRef);
  assert.deepEqual(empty.envelopeManifest, []);
  assert.deepEqual(empty.assessmentManifest, []);
  assert.deepEqual(empty.occurrenceManifest, []);
  assert.deepEqual(empty.envelopeProvenance, []);
  assert.deepEqual(empty.scopeEnumeration, { scopeKind: "EXPLICIT_ENVELOPE_SET", status: "ENUMERATED_AND_CONSIDERED" });
});

test.after(async () => { if (pool) await pool.end(); });
