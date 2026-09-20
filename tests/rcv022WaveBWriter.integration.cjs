const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const c = require("../dist/services/rcv022Canonical");
const w = require("../dist/services/rcv022Writer");
const { canonicalizeJson } = require("../dist/services/canonicalJson");

const database = process.env.RCV022_WAVE_B_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 8 }) : null;
const id = (n) => `81000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const h = (ch) => ch.repeat(64);
const contentHash = crypto.createHash("sha256").update("hello", "utf8").digest("hex");
const hashText = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const migrationRoot = path.join(__dirname, "..", "migrations");
const migrationFiles = () => fs.readdirSync(migrationRoot).filter((n) => n.endsWith(".sql")).sort().map((n) => path.join(migrationRoot, n));
const fixtureIds = { claim: id(1), version: id(2), capture: id(3) };

async function replay() { const client = await pool.connect(); try { for (const file of migrationFiles()) await client.query(fs.readFileSync(file, "utf8")); } finally { client.release(); } }
async function seed() {
  const client = await pool.connect();
  try {
    await client.query("SET session_replication_role='replica'");
    await client.query("INSERT INTO public.claims(id) VALUES ($1)", [fixtureIds.claim]);
    await client.query(`INSERT INTO public.claim_versions (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at) VALUES ($1,$2,1,'title','statement','en','fact','draft','unpublished','fixture',$3)`, [fixtureIds.version, fixtureIds.claim, "2026-01-01T00:00:00.000000Z"]);
    await client.query(`INSERT INTO public.rcv020_captures (capture_id,logical_source_id,monitor_id,monitor_configuration_version_id,occurrence_id,retrieval_attempt_id,request_hash,requested_target,final_url,redirect_canonical,response_status,response_metadata_canonical,media_type,byte_length,observed_at,content_hash,canonical,capture_hash,retention_policy,retention_policy_version,raw_object_identity,raw_object_reference) VALUES ($1,$2,$3,$4,$5,$6,repeat('a',64),'https://example.test','https://example.test',NULL,200,'{}','text/plain',1,$7,repeat('b',64),'{}',repeat('c',64),'METADATA_HASH_ONLY',1,NULL,NULL)`, [fixtureIds.capture, id(4), id(5), id(6), id(7), id(8), "2026-01-01T00:00:00.000000Z"]);
    await client.query("SET session_replication_role='origin'");
    await client.query("INSERT INTO public.claim_identity_authorities VALUES ($1,1,$2,$3)", [fixtureIds.claim, "{}", h("a")]);
    await client.query("INSERT INTO public.claim_version_authorities VALUES ($1,$2,1,$3,$4,$5,$6,1,$7,$8)", [fixtureIds.version, fixtureIds.claim, "title", "statement", "en", "fact", "{}", h("b")]);
  } finally { await client.query("SET session_replication_role='origin'").catch(() => {}); client.release(); }
}
function makeBundle(seed) {
  const fragmentInput = { fragmentId: id(seed + 10), captureId: fixtureIds.capture, captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: h("c"), captureRepresentationHash: h("b"), fragmentKind: "TEXT", locator: { kind: "WHOLE_TEXT" }, contentBinding: { kind: "TEXT", utf8Text: "hello", contentHash }, extractionAuthority: { kind: "DIRECT" } };
  const fragment = c.buildEvidenceFragmentCanonical(fragmentInput);
  const matchInput = { matchId: id(seed + 11), claimId: fixtureIds.claim, claimCanonicalVersion: 1, claimCanonicalHash: h("a"), claimVersionId: fixtureIds.version, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: h("b"), evidenceFragmentId: fragmentInput.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragment.hash, matcherIdentity: "matcher", matcherVersion: "1", matcherHash: h("e"), matcherInputCanonicalHashes: [] };
  const match = c.buildClaimEvidenceMatchCanonical(matchInput);
  const assessmentInput = { assessmentId: id(seed + 12), claimEvidenceMatchId: matchInput.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: match.hash, claimId: fixtureIds.claim, claimCanonicalVersion: 1, claimCanonicalHash: h("a"), claimVersionId: fixtureIds.version, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: h("b"), evidenceFragmentId: fragmentInput.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragment.hash, assessmentResult: { relation: "SUPPORTS", rationale: "fixture" }, methodProvenance: { methodType: "DETERMINISTIC", methodIdentity: "rule", methodVersion: "1", methodHash: h("f"), inputCanonicalHashes: [], structuredOutputHash: h("b"), reviewStatus: "NOT_REVIEWED" }, assessedAt: "2026-01-01T00:00:00.123456Z" };
  const assessment = c.buildEvidenceAssessmentCanonical(assessmentInput);
  const envelopeInput = { envelopeId: id(seed + 13), claimId: fixtureIds.claim, claimCanonicalVersion: 1, claimCanonicalHash: h("a"), claimVersionId: fixtureIds.version, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: h("b"), analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:00.123456Z", matchRefs: [{ id: matchInput.matchId, canonicalVersion: 1, canonicalHash: match.hash }], assessmentRefs: [{ id: assessmentInput.assessmentId, canonicalVersion: 1, canonicalHash: assessment.hash }], analysisMethodIdentity: "analysis", analysisMethodVersion: "1", analysisMethodHash: h("d") };
  return { fragment: fragmentInput, match: matchInput, assessment: assessmentInput, envelope: envelopeInput };
}
async function tx(bundle, shouldCommit = true) { const client = await pool.connect(); try { await client.query("BEGIN"); await w.persistRcv022BundleWithinTransaction(client, bundle); if (shouldCommit) await client.query("COMMIT"); else await client.query("ROLLBACK"); } catch (e) { try { await client.query("ROLLBACK"); } catch {} throw e; } finally { client.release(); } }
function requireDb(t) { if (!enabled) { t.skip("set RCV022_WAVE_B_DATABASE, PGHOST, and PGPORT for disposable PostgreSQL proof"); return false; } return true; }

test("Wave B disposable replay, atomic bundle persistence, exact readback, and idempotent retry", { concurrency: false }, async (t) => {
  if (!requireDb(t)) return;
  const pre = await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rcv022_%'"); assert.equal(pre.rows[0].n, 0); await replay(); await seed();
  const bundle = makeBundle(100); await tx(bundle);
  const row = (await pool.query("SELECT assessment_id::text AS assessment_id,canonical,canonical_hash,to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0];
  const assessment = c.buildEvidenceAssessmentCanonical(bundle.assessment); assert.deepEqual(row, { assessment_id: bundle.assessment.assessmentId, canonical: assessment.canonical, canonical_hash: assessment.hash, assessed_at: bundle.assessment.assessedAt });
  await tx(bundle); assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [bundle.envelope.envelopeId])).rows[0].n), 1);
});

test("Wave B divergent retry and caller rollback leave persisted state unchanged", { concurrency: false }, async (t) => {
  if (!requireDb(t)) return;
  const bundle = makeBundle(200); await tx(bundle); const before = (await pool.query("SELECT canonical,canonical_hash FROM public.rcv022_evidence_fragments WHERE fragment_id=$1", [bundle.fragment.fragmentId])).rows[0];
  const divergent = { ...bundle, fragment: { ...bundle.fragment, contentBinding: { kind: "TEXT", utf8Text: "different", contentHash: hashText("different") } } };
  await assert.rejects(() => tx(divergent), /DUPLICATE_CONFLICT|projection mismatch|canonical hash mismatch/);
  const after = (await pool.query("SELECT canonical,canonical_hash FROM public.rcv022_evidence_fragments WHERE fragment_id=$1", [bundle.fragment.fragmentId])).rows[0]; assert.deepEqual(after, before);
  const staged = makeBundle(300); const client = await pool.connect(); try { await client.query("BEGIN"); await w.persistRcv022BundleWithinTransaction(client, staged); await client.query("INSERT INTO public.rcv022_evidence_fragments (fragment_id,canonical_version,canonical,canonical_hash,capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority) VALUES ($1,1,'{}',$2,$3,'RCV020-CANONICAL-V1',$4,$5,'TEXT','{}','{}','{}')", [id(999), h("z"), id(999), h("c"), h("b")]); await assert.fail("expected database failure"); } catch { await client.query("ROLLBACK"); } finally { client.release(); }
  for (const [table, col, value] of [["rcv022_evidence_fragments", "fragment_id", staged.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", staged.match.matchId], ["rcv022_evidence_assessments", "assessment_id", staged.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", staged.envelope.envelopeId]]) assert.equal(Number((await pool.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${col}=$1`, [value])).rows[0].n), 0);
});

test("Wave B2 Match and Assessment authority proof", { concurrency: false }, async (t) => {
  if (!requireDb(t)) return;
  const bundle = makeBundle(500);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await w.persistEvidenceFragmentWithinTransaction(client, bundle.fragment);
    await w.persistClaimEvidenceMatchWithinTransaction(client, bundle.match);
    await w.persistEvidenceAssessmentWithinTransaction(client, bundle.assessment);
    await client.query("COMMIT");
  } finally { client.release(); }
  const matchRow = (await pool.query("SELECT match_id::text AS match_id,canonical_version,canonical,canonical_hash,claim_id::text AS claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id::text AS claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,evidence_fragment_id::text AS evidence_fragment_id,evidence_fragment_canonical_version,evidence_fragment_canonical_hash,matcher_identity,matcher_version,matcher_hash,matcher_input_canonical_hashes FROM public.rcv022_claim_evidence_matches WHERE match_id=$1", [bundle.match.matchId])).rows[0];
  const matchBuilt = c.buildClaimEvidenceMatchCanonical(bundle.match);
  assert.deepEqual(matchRow, { match_id: bundle.match.matchId, canonical_version: 1, canonical: matchBuilt.canonical, canonical_hash: matchBuilt.hash, claim_id: bundle.match.claimId, claim_canonical_version: 1, claim_canonical_hash: bundle.match.claimCanonicalHash, claim_version_id: bundle.match.claimVersionId, claim_version_canonical_version: 1, claim_version_canonical_hash: bundle.match.claimVersionCanonicalHash, evidence_fragment_id: bundle.match.evidenceFragmentId, evidence_fragment_canonical_version: 1, evidence_fragment_canonical_hash: bundle.match.evidenceFragmentCanonicalHash, matcher_identity: bundle.match.matcherIdentity, matcher_version: bundle.match.matcherVersion, matcher_hash: bundle.match.matcherHash, matcher_input_canonical_hashes: [] });
  const assessmentRow = (await pool.query("SELECT assessment_id::text AS assessment_id,canonical_version,canonical,canonical_hash,claim_evidence_match_id::text AS claim_evidence_match_id,claim_evidence_match_canonical_version,claim_evidence_match_canonical_hash,claim_id::text AS claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id::text AS claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,evidence_fragment_id::text AS evidence_fragment_id,evidence_fragment_canonical_version,evidence_fragment_canonical_hash,assessment_result,method_provenance,to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0];
  const assessmentBuilt = c.buildEvidenceAssessmentCanonical(bundle.assessment);
  assert.deepEqual(assessmentRow, { assessment_id: bundle.assessment.assessmentId, canonical_version: 1, canonical: assessmentBuilt.canonical, canonical_hash: assessmentBuilt.hash, claim_evidence_match_id: bundle.assessment.claimEvidenceMatchId, claim_evidence_match_canonical_version: 1, claim_evidence_match_canonical_hash: bundle.assessment.claimEvidenceMatchCanonicalHash, claim_id: bundle.assessment.claimId, claim_canonical_version: 1, claim_canonical_hash: bundle.assessment.claimCanonicalHash, claim_version_id: bundle.assessment.claimVersionId, claim_version_canonical_version: 1, claim_version_canonical_hash: bundle.assessment.claimVersionCanonicalHash, evidence_fragment_id: bundle.assessment.evidenceFragmentId, evidence_fragment_canonical_version: 1, evidence_fragment_canonical_hash: bundle.assessment.evidenceFragmentCanonicalHash, assessment_result: bundle.assessment.assessmentResult, method_provenance: bundle.assessment.methodProvenance, assessed_at: bundle.assessment.assessedAt });
  const retryClient = await pool.connect();
  try { await retryClient.query("BEGIN"); await w.persistClaimEvidenceMatchWithinTransaction(retryClient, bundle.match); await w.persistEvidenceAssessmentWithinTransaction(retryClient, bundle.assessment); await retryClient.query("COMMIT"); } finally { retryClient.release(); }
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_claim_evidence_matches WHERE match_id=$1", [bundle.match.matchId])).rows[0].n), 1);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0].n), 1);
  const divergentMatch = { ...bundle.match, matcherVersion: "2" };
  await assert.rejects(() => tx({ ...bundle, match: divergentMatch, assessment: bundle.assessment, envelope: { ...bundle.envelope, matchRefs: [], assessmentRefs: [] } }), /DUPLICATE_CONFLICT/);
  assert.deepEqual((await pool.query("SELECT match_id::text AS match_id,canonical_version,canonical,canonical_hash,claim_id::text AS claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id::text AS claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,evidence_fragment_id::text AS evidence_fragment_id,evidence_fragment_canonical_version,evidence_fragment_canonical_hash,matcher_identity,matcher_version,matcher_hash,matcher_input_canonical_hashes FROM public.rcv022_claim_evidence_matches WHERE match_id=$1", [bundle.match.matchId])).rows[0], matchRow);
  const divergentAssessment = { ...bundle.assessment, assessmentResult: { relation: "SUPPORTS", rationale: "different" } };
  const assessmentClient = await pool.connect();
  try { await assessmentClient.query("BEGIN"); await assert.rejects(() => w.persistEvidenceAssessmentWithinTransaction(assessmentClient, divergentAssessment), /DUPLICATE_CONFLICT/); await assessmentClient.query("ROLLBACK"); } finally { assessmentClient.release(); }
  assert.deepEqual((await pool.query("SELECT assessment_id::text AS assessment_id,canonical_version,canonical,canonical_hash,claim_evidence_match_id::text AS claim_evidence_match_id,claim_evidence_match_canonical_version,claim_evidence_match_canonical_hash,claim_id::text AS claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id::text AS claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,evidence_fragment_id::text AS evidence_fragment_id,evidence_fragment_canonical_version,evidence_fragment_canonical_hash,assessment_result,method_provenance,to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0], assessmentRow);
  const wrongMatchBinding = { ...bundle.match, claimCanonicalHash: "b".repeat(64) };
  await assert.rejects(() => tx({ ...bundle, match: wrongMatchBinding, assessment: bundle.assessment, envelope: { ...bundle.envelope, matchRefs: [], assessmentRefs: [] } }), /HASH_MISMATCH/);
  const wrongAssessmentBinding = { ...bundle.assessment, assessmentId: id(516), claimCanonicalHash: "b".repeat(64) };
  const dependencyClient = await pool.connect();
  try { await dependencyClient.query("BEGIN"); await assert.rejects(() => w.persistEvidenceAssessmentWithinTransaction(dependencyClient, wrongAssessmentBinding), /HASH_MISMATCH/); await dependencyClient.query("ROLLBACK"); } finally { dependencyClient.release(); }
  const wrongAssessmentMatchBinding = { ...bundle.assessment, assessmentId: id(517), claimEvidenceMatchCanonicalHash: "b".repeat(64) };
  const dependencyMatchClient = await pool.connect();
  try { await dependencyMatchClient.query("BEGIN"); await assert.rejects(() => w.persistEvidenceAssessmentWithinTransaction(dependencyMatchClient, wrongAssessmentMatchBinding), /HASH_MISMATCH/); await dependencyMatchClient.query("ROLLBACK"); } finally { dependencyMatchClient.release(); }
  const wrongAssessmentFragmentBinding = { ...bundle.assessment, assessmentId: id(518), evidenceFragmentCanonicalHash: "b".repeat(64) };
  const dependencyFragmentClient = await pool.connect();
  try { await dependencyFragmentClient.query("BEGIN"); await assert.rejects(() => w.persistEvidenceAssessmentWithinTransaction(dependencyFragmentClient, wrongAssessmentFragmentBinding), /HASH_MISMATCH/); await dependencyFragmentClient.query("ROLLBACK"); } finally { dependencyFragmentClient.release(); }
  const matchDependencyCases = [
    ["claim version", { claimCanonicalVersion: 2 }], ["claim hash", { claimCanonicalHash: h("b") }],
    ["claim-version version", { claimVersionCanonicalVersion: 2 }], ["claim-version hash", { claimVersionCanonicalHash: h("c") }],
    ["fragment version", { evidenceFragmentCanonicalVersion: 2 }], ["fragment hash", { evidenceFragmentCanonicalHash: h("d") }],
  ];
  for (const [label, change] of matchDependencyCases) {
    await assert.rejects(() => tx({ ...bundle, match: { ...bundle.match, ...change }, envelope: { ...bundle.envelope, matchRefs: [], assessmentRefs: [] } }), /HASH_MISMATCH|canonicalVersion 1/, label);
  }
  const assessmentDependencyCases = [
    ["match version", { claimEvidenceMatchCanonicalVersion: 2 }], ["match hash", { claimEvidenceMatchCanonicalHash: h("b") }],
    ["claim version", { claimCanonicalVersion: 2 }], ["claim hash", { claimCanonicalHash: h("b") }],
    ["claim-version version", { claimVersionCanonicalVersion: 2 }], ["claim-version hash", { claimVersionCanonicalHash: h("c") }],
    ["fragment version", { evidenceFragmentCanonicalVersion: 2 }], ["fragment hash", { evidenceFragmentCanonicalHash: h("d") }],
  ];
  for (const [index, [label, change]] of assessmentDependencyCases.entries()) {
    await assert.rejects(() => tx({ ...bundle, assessment: { ...bundle.assessment, assessmentId: id(520 + index), ...change }, envelope: { ...bundle.envelope, matchRefs: [], assessmentRefs: [] } }), /HASH_MISMATCH|canonicalVersion 1/, label);
  }
  const modelSamplingParameters = { schema: "factbase-rcv022-sampling-parameters", canonicalVersion: 1, entries: [{ name: "temperature", value: 0 }] };
  const modelAssessment = { ...bundle.assessment, assessmentId: "81000000-0000-4000-8000-000000000515", methodProvenance: { methodType: "MODEL_ASSISTED", methodIdentity: "model", methodVersion: "1", methodHash: "a".repeat(64), providerIdentity: "provider", modelIdentity: "model", modelVersion: "1", processIdentity: "process", processVersion: "1", processHash: "b".repeat(64), promptTemplateHash: "c".repeat(64), systemInstructionHash: "d".repeat(64), samplingParameters: modelSamplingParameters, samplingParametersHash: hashText(canonicalizeJson(modelSamplingParameters)), inputCanonicalHashes: [], rawOutputHash: "a".repeat(64), structuredOutputHash: "b".repeat(64), retryIdentity: "retry", reviewStatus: "NOT_REVIEWED", toolParticipation: "USED", toolContextHash: "c".repeat(64) } };
  const modelClient = await pool.connect();
  try { await modelClient.query("BEGIN"); await w.persistEvidenceAssessmentWithinTransaction(modelClient, modelAssessment); await modelClient.query("COMMIT"); } finally { modelClient.release(); }
  assert.equal((await pool.query("SELECT method_provenance->>'toolParticipation' AS participation,method_provenance->>'toolContextHash' AS context_hash FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [modelAssessment.assessmentId])).rows[0].participation, "USED");
  const rollbackBundle = makeBundle(600); const rollbackClient = await pool.connect();
  try { await rollbackClient.query("BEGIN"); await w.persistEvidenceFragmentWithinTransaction(rollbackClient, rollbackBundle.fragment); await w.persistClaimEvidenceMatchWithinTransaction(rollbackClient, rollbackBundle.match); await assert.rejects(() => w.persistEvidenceAssessmentWithinTransaction(rollbackClient, { ...rollbackBundle.assessment, claimCanonicalHash: "b".repeat(64) }), /HASH_MISMATCH/); await rollbackClient.query("ROLLBACK"); } finally { rollbackClient.release(); }
  for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", rollbackBundle.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", rollbackBundle.match.matchId], ["rcv022_evidence_assessments", "assessment_id", rollbackBundle.assessment.assessmentId]]) assert.equal(Number((await pool.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${column}=$1`, [value])).rows[0].n), 0);
});

test("Wave B3 Envelope support exactness, divergence rejection, full atomicity, and concurrency", { concurrency: false, timeout: 5000 }, async (t) => {
  if (!requireDb(t)) return;
  const bundle = makeBundle(700);
  const persistAuthorities = async (candidate) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await w.persistEvidenceFragmentWithinTransaction(client, candidate.fragment);
      await w.persistClaimEvidenceMatchWithinTransaction(client, candidate.match);
      await w.persistEvidenceAssessmentWithinTransaction(client, candidate.assessment);
      await client.query("COMMIT");
    } finally { client.release(); }
  };
  const readEnvelopeState = async (candidate) => ({
    envelope: (await pool.query("SELECT envelope_id::text AS envelope_id,canonical_version,canonical,canonical_hash,claim_id::text AS claim_id,claim_canonical_version,claim_canonical_hash,claim_version_id::text AS claim_version_id,claim_version_canonical_version,claim_version_canonical_hash,to_char(analysis_cutoff_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS analysis_cutoff_at,to_char(analysis_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS analysis_at,match_refs,assessment_refs,analysis_method_identity,analysis_method_version,analysis_method_hash FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [candidate.envelope.envelopeId])).rows[0],
    matchRefs: (await pool.query("SELECT ordinal,match_id::text AS id,match_canonical_version AS canonical_version,match_canonical_hash AS canonical_hash FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1 ORDER BY ordinal", [candidate.envelope.envelopeId])).rows,
    assessmentRefs: (await pool.query("SELECT ordinal,assessment_id::text AS id,assessment_canonical_version AS canonical_version,assessment_canonical_hash AS canonical_hash FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 ORDER BY ordinal", [candidate.envelope.envelopeId])).rows,
  });
  const expectedEnvelope = c.buildSemanticAnalysisEnvelopeCanonical(bundle.envelope);
  await tx(bundle);
  const firstState = await readEnvelopeState(bundle);
  const persistedAuthorities = {
    fragment: (await pool.query("SELECT fragment_id::text AS fragment_id,canonical,canonical_hash,capture_id::text AS capture_id,capture_canonical_version,capture_canonical_hash,capture_representation_hash,fragment_kind,locator,content_binding,extraction_authority FROM public.rcv022_evidence_fragments WHERE fragment_id=$1", [bundle.fragment.fragmentId])).rows[0],
    match: (await pool.query("SELECT match_id::text AS match_id,canonical,canonical_hash,claim_id::text AS claim_id,claim_version_id::text AS claim_version_id,evidence_fragment_id::text AS evidence_fragment_id,matcher_identity,matcher_version,matcher_hash,matcher_input_canonical_hashes FROM public.rcv022_claim_evidence_matches WHERE match_id=$1", [bundle.match.matchId])).rows[0],
    assessment: (await pool.query("SELECT assessment_id::text AS assessment_id,canonical,canonical_hash,claim_evidence_match_id::text AS claim_evidence_match_id,assessment_result,method_provenance,to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0],
  };
  assert.equal(persistedAuthorities.fragment.canonical, c.buildEvidenceFragmentCanonical(bundle.fragment).canonical);
  assert.equal(persistedAuthorities.fragment.canonical_hash, c.buildEvidenceFragmentCanonical(bundle.fragment).hash);
  assert.equal(persistedAuthorities.match.canonical, c.buildClaimEvidenceMatchCanonical(bundle.match).canonical);
  assert.equal(persistedAuthorities.match.canonical_hash, c.buildClaimEvidenceMatchCanonical(bundle.match).hash);
  assert.equal(persistedAuthorities.assessment.canonical, c.buildEvidenceAssessmentCanonical(bundle.assessment).canonical);
  assert.equal(persistedAuthorities.assessment.canonical_hash, c.buildEvidenceAssessmentCanonical(bundle.assessment).hash);
  const authorityHashState = [persistedAuthorities.fragment, persistedAuthorities.match, persistedAuthorities.assessment].map((row) => ({ canonical: row.canonical, canonical_hash: row.canonical_hash }));
  assert.deepEqual(firstState.envelope, { envelope_id: bundle.envelope.envelopeId, canonical_version: 1, canonical: expectedEnvelope.canonical, canonical_hash: expectedEnvelope.hash, claim_id: bundle.envelope.claimId, claim_canonical_version: 1, claim_canonical_hash: bundle.envelope.claimCanonicalHash, claim_version_id: bundle.envelope.claimVersionId, claim_version_canonical_version: 1, claim_version_canonical_hash: bundle.envelope.claimVersionCanonicalHash, analysis_cutoff_at: bundle.envelope.analysisCutoffAt, analysis_at: bundle.envelope.analysisAt, match_refs: [{ id: bundle.match.matchId, canonicalVersion: 1, canonicalHash: bundle.match ? c.buildClaimEvidenceMatchCanonical(bundle.match).hash : "" }], assessment_refs: [{ id: bundle.assessment.assessmentId, canonicalVersion: 1, canonicalHash: c.buildEvidenceAssessmentCanonical(bundle.assessment).hash }], analysis_method_identity: bundle.envelope.analysisMethodIdentity, analysis_method_version: bundle.envelope.analysisMethodVersion, analysis_method_hash: bundle.envelope.analysisMethodHash });
  assert.deepEqual(firstState.matchRefs, [{ ordinal: 0, id: bundle.match.matchId, canonical_version: 1, canonical_hash: c.buildClaimEvidenceMatchCanonical(bundle.match).hash }]);
  assert.deepEqual(firstState.assessmentRefs, [{ ordinal: 0, id: bundle.assessment.assessmentId, canonical_version: 1, canonical_hash: c.buildEvidenceAssessmentCanonical(bundle.assessment).hash }]);
  await tx(bundle);
  assert.deepEqual(await readEnvelopeState(bundle), firstState);
  const authorityHashStateAfterRetry = [
    (await pool.query("SELECT canonical,canonical_hash FROM public.rcv022_evidence_fragments WHERE fragment_id=$1", [bundle.fragment.fragmentId])).rows[0],
    (await pool.query("SELECT canonical,canonical_hash FROM public.rcv022_claim_evidence_matches WHERE match_id=$1", [bundle.match.matchId])).rows[0],
    (await pool.query("SELECT canonical,canonical_hash FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0],
  ];
  assert.deepEqual(authorityHashStateAfterRetry, authorityHashState);
  const divergentEnvelope = { ...bundle, envelope: { ...bundle.envelope, analysisMethodVersion: "2" } };
  await assert.rejects(() => tx(divergentEnvelope), /DUPLICATE_CONFLICT/);
  assert.deepEqual(await readEnvelopeState(bundle), firstState);
  const wrongEnvelopeDependency = { ...bundle, envelope: { ...bundle.envelope, matchRefs: [{ id: bundle.match.matchId, canonicalVersion: 1, canonicalHash: h("e") }] } };
  await assert.rejects(() => tx(wrongEnvelopeDependency), /HASH_MISMATCH/);
  assert.deepEqual(await readEnvelopeState(bundle), firstState);

  const mutateReplica = async (sql, values = []) => {
    const client = await pool.connect(); let active = false;
    try { await client.query("BEGIN"); active = true; await client.query("SET session_replication_role='replica'"); await client.query(sql, values); await client.query("SET session_replication_role='origin'"); await client.query("COMMIT"); active = false; }
    catch (error) { if (active) await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { try { await client.query("SET session_replication_role='origin'"); } catch {} client.release(); }
  };
  const supportCases = [
    ["missing match member", "DELETE FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1 AND ordinal=0", [], "INSERT INTO public.rcv022_envelope_match_refs (envelope_id,ordinal,match_id,match_canonical_version,match_canonical_hash) VALUES ($1,0,$2,1,$3)", [bundle.envelope.envelopeId, bundle.match.matchId, c.buildClaimEvidenceMatchCanonical(bundle.match).hash]],
    ["extra match member", "INSERT INTO public.rcv022_envelope_match_refs (envelope_id,ordinal,match_id,match_canonical_version,match_canonical_hash) VALUES ($1,99,$2,1,$3)", [bundle.envelope.envelopeId, id(7999), h("a")], "DELETE FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1 AND ordinal=99", []],
    ["wrong match ordinal", "UPDATE public.rcv022_envelope_match_refs SET ordinal=1 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId], "UPDATE public.rcv022_envelope_match_refs SET ordinal=0 WHERE envelope_id=$1 AND ordinal=1", [bundle.envelope.envelopeId]],
    ["wrong match version", "UPDATE public.rcv022_envelope_match_refs SET match_canonical_version=2 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId], "UPDATE public.rcv022_envelope_match_refs SET match_canonical_version=1 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId]],
    ["wrong match hash", "UPDATE public.rcv022_envelope_match_refs SET match_canonical_hash=$2 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId, h("e")], "UPDATE public.rcv022_envelope_match_refs SET match_canonical_hash=$2 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId, c.buildClaimEvidenceMatchCanonical(bundle.match).hash]],
    ["missing assessment member", "DELETE FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 AND ordinal=0", [], "INSERT INTO public.rcv022_envelope_assessment_refs (envelope_id,ordinal,assessment_id,assessment_canonical_version,assessment_canonical_hash) VALUES ($1,0,$2,1,$3)", [bundle.envelope.envelopeId, bundle.assessment.assessmentId, c.buildEvidenceAssessmentCanonical(bundle.assessment).hash]],
    ["extra assessment member", "INSERT INTO public.rcv022_envelope_assessment_refs (envelope_id,ordinal,assessment_id,assessment_canonical_version,assessment_canonical_hash) VALUES ($1,99,$2,1,$3)", [bundle.envelope.envelopeId, id(7998), h("a")], "DELETE FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 AND ordinal=99", []],
    ["wrong assessment ordinal", "UPDATE public.rcv022_envelope_assessment_refs SET ordinal=1 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId], "UPDATE public.rcv022_envelope_assessment_refs SET ordinal=0 WHERE envelope_id=$1 AND ordinal=1", [bundle.envelope.envelopeId]],
    ["wrong assessment version", "UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_version=2 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId], "UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_version=1 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId]],
    ["wrong assessment hash", "UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$2 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId, h("e")], "UPDATE public.rcv022_envelope_assessment_refs SET assessment_canonical_hash=$2 WHERE envelope_id=$1 AND ordinal=0", [bundle.envelope.envelopeId, c.buildEvidenceAssessmentCanonical(bundle.assessment).hash]],
  ];
  for (const [label, mutateSql, mutateValues, restoreSql, restoreValues] of supportCases) {
    try { await mutateReplica(mutateSql, mutateValues.length ? mutateValues : [bundle.envelope.envelopeId]); }
    catch (error) {
      if (label.includes("wrong match version") || label.includes("wrong assessment version")) { assert.match(String(error), /canonical_version_check/); continue; }
      throw error;
    }
    try { await assert.rejects(() => tx(bundle), /DUPLICATE_CONFLICT/, label); }
    finally { await mutateReplica(restoreSql, restoreValues.length ? restoreValues : [bundle.envelope.envelopeId]); }
  }
  const envelopeDependencyCases = [
    ["claim version", { claimCanonicalVersion: 2 }], ["claim hash", { claimCanonicalHash: h("e") }],
    ["claim-version version", { claimVersionCanonicalVersion: 2 }], ["claim-version hash", { claimVersionCanonicalHash: h("e") }],
    ["match version", { matchRefs: [{ id: bundle.match.matchId, canonicalVersion: 2, canonicalHash: c.buildClaimEvidenceMatchCanonical(bundle.match).hash }] }],
    ["match hash", { matchRefs: [{ id: bundle.match.matchId, canonicalVersion: 1, canonicalHash: h("e") }] }],
    ["assessment version", { assessmentRefs: [{ id: bundle.assessment.assessmentId, canonicalVersion: 2, canonicalHash: c.buildEvidenceAssessmentCanonical(bundle.assessment).hash }] }],
    ["assessment hash", { assessmentRefs: [{ id: bundle.assessment.assessmentId, canonicalVersion: 1, canonicalHash: h("e") }] }],
  ];
  for (const [label, change] of envelopeDependencyCases) {
    await assert.rejects(() => tx({ ...bundle, envelope: { ...bundle.envelope, ...change } }), /HASH_MISMATCH|canonicalVersion 1/, label);
  }
  assert.deepEqual(await readEnvelopeState(bundle), firstState);

  const projectionCorruptionCases = [
    ["fragment capture hash", "UPDATE public.rcv022_evidence_fragments SET capture_canonical_hash=$2 WHERE fragment_id=$1", [bundle.fragment.fragmentId, h("d")], "UPDATE public.rcv022_evidence_fragments SET capture_canonical_hash=$2 WHERE fragment_id=$1", [bundle.fragment.fragmentId, bundle.fragment.captureCanonicalHash], "fragment"],
    ["assessment timestamp", "UPDATE public.rcv022_evidence_assessments SET assessed_at=$2 WHERE assessment_id=$1", [bundle.assessment.assessmentId, "2026-01-01T00:00:00.654321Z"], "UPDATE public.rcv022_evidence_assessments SET assessed_at=$2 WHERE assessment_id=$1", [bundle.assessment.assessmentId, bundle.assessment.assessedAt], "assessment"],
    ["envelope analysis timestamp", "UPDATE public.rcv022_semantic_analysis_envelopes SET analysis_at=$2 WHERE envelope_id=$1", [bundle.envelope.envelopeId, "2026-01-01T00:00:00.654321Z"], "UPDATE public.rcv022_semantic_analysis_envelopes SET analysis_at=$2 WHERE envelope_id=$1", [bundle.envelope.envelopeId, bundle.envelope.analysisAt], "envelope"],
  ];
  for (const [label, mutateSql, mutateValues, restoreSql, restoreValues, kind] of projectionCorruptionCases) {
    await mutateReplica(mutateSql, mutateValues);
    const before = kind === "fragment"
      ? (await pool.query("SELECT canonical,canonical_hash,capture_canonical_hash FROM public.rcv022_evidence_fragments WHERE fragment_id=$1", [bundle.fragment.fragmentId])).rows[0]
      : kind === "assessment"
        ? (await pool.query("SELECT canonical,canonical_hash,to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0]
        : (await pool.query("SELECT canonical,canonical_hash,to_char(analysis_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS analysis_at FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [bundle.envelope.envelopeId])).rows[0];
    await assert.rejects(() => tx(bundle), /DUPLICATE_CONFLICT/, label);
    const after = kind === "fragment"
      ? (await pool.query("SELECT canonical,canonical_hash,capture_canonical_hash FROM public.rcv022_evidence_fragments WHERE fragment_id=$1", [bundle.fragment.fragmentId])).rows[0]
      : kind === "assessment"
        ? (await pool.query("SELECT canonical,canonical_hash,to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1", [bundle.assessment.assessmentId])).rows[0]
        : (await pool.query("SELECT canonical,canonical_hash,to_char(analysis_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS analysis_at FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [bundle.envelope.envelopeId])).rows[0];
    assert.deepEqual(after, before, `${label}: retry must not repair corruption`);
    await mutateReplica(restoreSql, restoreValues);
  }

  const failed = makeBundle(800);
  const failedClient = await pool.connect();
  try {
    await failedClient.query("BEGIN");
    await w.persistRcv022BundleWithinTransaction(failedClient, failed);
    await assert.rejects(() => w.persistSemanticAnalysisEnvelopeWithinTransaction(failedClient, { ...failed.envelope, analysisMethodVersion: "2" }), /DUPLICATE_CONFLICT/);
    await failedClient.query("ROLLBACK");
  } finally { failedClient.release(); }
  for (const [table, column, value] of [["rcv022_evidence_fragments", "fragment_id", failed.fragment.fragmentId], ["rcv022_claim_evidence_matches", "match_id", failed.match.matchId], ["rcv022_evidence_assessments", "assessment_id", failed.assessment.assessmentId], ["rcv022_semantic_analysis_envelopes", "envelope_id", failed.envelope.envelopeId], ["rcv022_envelope_match_refs", "envelope_id", failed.envelope.envelopeId], ["rcv022_envelope_assessment_refs", "envelope_id", failed.envelope.envelopeId]]) assert.equal(Number((await pool.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${column}=$1`, [value])).rows[0].n), 0);
  assert.deepEqual(await readEnvelopeState(bundle), firstState);

  const runEnvelopeRace = async (first, second) => { let ready = 0; let release; const gate = new Promise((resolve) => { release = resolve; }); const envelopeAttempt = async (candidate) => { const client = await pool.connect(); try { await client.query("BEGIN"); if (++ready === 2) release(); await gate; await w.persistSemanticAnalysisEnvelopeWithinTransaction(client, candidate.envelope); await client.query("COMMIT"); return "COMMITTED"; } catch (e) { try { await client.query("ROLLBACK"); } catch {} return String(e.message); } finally { client.release(); } }; return Promise.all([envelopeAttempt(first), envelopeAttempt(second)]); };
  const race = makeBundle(900); await persistAuthorities(race);
  const sameOutcomes = await runEnvelopeRace(race, race);
  assert.deepEqual(sameOutcomes.sort(), ["COMMITTED", "COMMITTED"]);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [race.envelope.envelopeId])).rows[0].n), 1);
  const divergentRace = makeBundle(910); await persistAuthorities(divergentRace);
  const divergent = { ...divergentRace, envelope: { ...divergentRace.envelope, analysisMethodVersion: "2" } };
  const divergentOutcomes = await runEnvelopeRace(divergentRace, divergent);
  assert.equal(divergentOutcomes.filter((x) => x === "COMMITTED").length, 1);
  assert.equal(divergentOutcomes.filter((x) => x.includes("DUPLICATE_CONFLICT")).length, 1);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1", [divergentRace.envelope.envelopeId])).rows[0].n), 1);
});

test("Wave B concurrent same authority converges and divergent authority conflicts", { concurrency: false, timeout: 5000 }, async (t) => {
  if (!requireDb(t)) return;
  const bundle = makeBundle(400); const attempt = async (candidate) => { const client = await pool.connect(); try { await client.query("BEGIN"); await w.persistEvidenceFragmentWithinTransaction(client, candidate.fragment); await client.query("COMMIT"); return "COMMITTED"; } catch (e) { try { await client.query("ROLLBACK"); } catch {} return String(e.message); } finally { client.release(); } };
  assert.deepEqual((await Promise.all([attempt(bundle), attempt(bundle)])).sort(), ["COMMITTED", "COMMITTED"]); assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM public.rcv022_evidence_fragments WHERE fragment_id=$1", [bundle.fragment.fragmentId])).rows[0].n), 1);
  const divergent = { ...bundle, fragment: { ...bundle.fragment, contentBinding: { kind: "TEXT", utf8Text: "concurrent-different", contentHash: hashText("concurrent-different") } } }; const outcomes = await Promise.all([attempt(bundle), attempt(divergent)]); assert.equal(outcomes.filter((x) => x === "COMMITTED").length, 1); assert.equal(outcomes.filter((x) => x.includes("DUPLICATE_CONFLICT") || x.includes("projection mismatch") || x.includes("canonical hash mismatch")).length, 1);
});

test.after(async () => { if (pool) await pool.end(); });
