const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { Pool } = require("pg");
const { Rcv017PostgresAnalysisReadRepository } = require("../dist/services/rcv017PostgresReadRepository");
const { Rcv017ReadIntegrityError, verifyRcv017PersistedAnalysis } = require("../dist/services/rcv017ReadVerifier");
const { sha256Rcv016Text } = require("../dist/services/rcv016Canonical");

const EXPECTED_DATABASE = "factbase_rcv017_phase6_20260904_01";
const requestedDatabase = process.env.RCV017_PHASE6_DATABASE;
if (requestedDatabase !== undefined && requestedDatabase !== EXPECTED_DATABASE) {
  throw new Error(`Refusing non-disposable RCV017 Phase-6 database: ${requestedDatabase}`);
}
const enabled = requestedDatabase === EXPECTED_DATABASE;
const ANALYSIS_ID = process.env.RCV017_PHASE6_ANALYSIS_ID || "40000000-0000-0000-0000-000000000320";
const ALGORITHM_HASH = process.env.RCV017_PHASE6_ALGORITHM_HASH || "b".repeat(64);
const pool = enabled ? new Pool({ database: EXPECTED_DATABASE, host: "/private/tmp", max: 12 }) : null;

async function loadBundle(readPool = pool) {
  assert.ok(readPool);
  const bundle = await new Rcv017PostgresAnalysisReadRepository(readPool).loadAnalysisById(ANALYSIS_ID);
  assert.ok(bundle, "externally provisioned valid analysis is missing");
  return bundle;
}

async function verify(bundle) {
  return verifyRcv017PersistedAnalysis(bundle, ALGORITHM_HASH);
}

async function query(sql, values = []) {
  assert.ok(pool);
  return pool.query(sql, values);
}

function tracedPool(base) {
  const trace = [];
  return { trace, async connect() {
    const client = await base.connect();
    return { async query(sql, values) {
      const text = typeof sql === "string" ? sql : sql.text;
      trace.push(text.replace(/\s+/g, " ").trim());
      return client.query(sql, values);
    }, release(error) { client.release(error); } };
  } };
}

async function withReplicaMutation(table, where, params, apply, expectedCode) {
  const snapshot = await query(`SELECT row_to_json(t) AS value FROM public.${table} t WHERE ${where}`, params);
  assert.ok(snapshot.rowCount > 0, `fixture row missing for ${table}`);
  const baselineAnalysis = await query("SELECT analysis_canonical, analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1", [ANALYSIS_ID]);
  assert.equal(baselineAnalysis.rowCount, 1);
  const writer = await pool.connect();
  let mutated = false;
  try {
    await writer.query("BEGIN");
    await writer.query("SET LOCAL session_replication_role='replica'");
    await apply(writer);
    await writer.query("COMMIT");
    mutated = true;
  } catch (error) {
    await writer.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { writer.release(); }
  try {
    const corrupted = await query(`SELECT row_to_json(t) AS value FROM public.${table} t WHERE ${where}`, params);
    assert.notDeepEqual(corrupted.rows, snapshot.rows, `mutation for ${table} was a no-op`);
    const corruptedAnalysis = await query("SELECT analysis_canonical, analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1", [ANALYSIS_ID]);
    assert.equal(corruptedAnalysis.rowCount, 1);
    await assert.rejects(async () => verify(await loadBundle()), (error) => error instanceof Rcv017ReadIntegrityError && error.code === expectedCode);
    const afterCorruption = await query(`SELECT row_to_json(t) AS value FROM public.${table} t WHERE ${where}`, params);
    assert.deepEqual(afterCorruption.rows, corrupted.rows, "verification repaired persisted corruption");
    const afterAnalysis = await query("SELECT analysis_canonical, analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1", [ANALYSIS_ID]);
    assert.deepEqual(afterAnalysis.rows, corruptedAnalysis.rows, "verification rewrote persisted Canonical/hash");
  } finally {
    if (mutated) {
      const restorer = await pool.connect();
      try {
        await restorer.query("BEGIN");
        await restorer.query("SET LOCAL session_replication_role='replica'");
        await restorer.query(`DELETE FROM public.${table} WHERE ${where}`, params);
        for (const row of snapshot.rows) {
          await restorer.query(`INSERT INTO public.${table} SELECT * FROM json_populate_record(NULL::public.${table}, $1::json)`, [JSON.stringify(row.value)]);
        }
        await restorer.query("COMMIT");
      } catch (error) {
        await restorer.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { restorer.release(); }
    }
  }
}

test.before(async () => {
  if (!enabled) return;
  const identity = await query("SELECT current_database() AS database, current_setting('server_encoding') AS encoding, current_setting('server_version_num')::int / 10000 AS major, inet_server_addr() IS NULL AS local_socket");
  assert.deepEqual(identity.rows[0], { database: EXPECTED_DATABASE, encoding: "UTF8", major: 16, local_socket: true });
});

test("valid persisted analysis verifies through the real Read Repository and corrected RCV-016 boundary", { skip: !enabled }, async () => {
  const bundle = await loadBundle();
  const snapshot = JSON.parse(bundle.rcv016SnapshotRead.header.snapshotCanonical);
  const policy = JSON.parse(bundle.policyHeader.definitionCanonical);
  const dependencyRelationships = new Set(policy.enabledDependencyRelationships);
  const statements = snapshot.artifactProvenanceStatements.filter((statement) => dependencyRelationships.has(statement.relationship));
  const ids = snapshot.artifactProvenanceStatements.map((statement) => statement.statementId);
  assert.ok(ids.some((value, index) => index > 0 && value < ids[index - 1]));
  const alternatePaths = statements.flatMap((first) => statements
    .filter((second) => second.subjectArtifactVersionId === first.objectArtifactVersionId && second.objectArtifactVersionId !== first.subjectArtifactVersionId)
    .map((second) => ({ start: first.subjectArtifactVersionId, end: second.objectArtifactVersionId, ids: [first.statementId, second.statementId] })));
  assert.ok(alternatePaths.length > 1 && alternatePaths.some((left, index) => alternatePaths.slice(index + 1).some((right) => left.end === right.end && left.start !== right.start && left.ids.join("\0") !== right.ids.join("\0"))));
  const anchors = new Set(JSON.parse(bundle.header.analysisCanonical).selectedBindings.map((binding) => binding.artifactVersionId));
  assert.ok(statements.some((edge) => anchors.has(edge.subjectArtifactVersionId) || anchors.has(edge.objectArtifactVersionId)));
  assert.ok(statements.some((edge) => statements.some((reverse) => edge.statementId !== reverse.statementId && edge.subjectArtifactVersionId === reverse.objectArtifactVersionId && edge.objectArtifactVersionId === reverse.subjectArtifactVersionId)));
  assert.equal((await verify(bundle)).verified, true);
  assert.equal(sha256Rcv016Text(bundle.header.analysisCanonical), bundle.header.analysisHash);
});

test("Read Repository preserves exact UTF-8 Canonical bytes and performs exact-ID retrieval", { skip: !enabled }, async () => {
  const traced = tracedPool(pool);
  const bundle = await loadBundle(traced);
  assert.equal((await verify(bundle)).verified, true);
  const stored = (await query("SELECT analysis_canonical, analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1", [ANALYSIS_ID])).rows[0];
  assert.deepEqual(Buffer.from(stored.analysis_canonical, "utf8"), Buffer.from(bundle.header.analysisCanonical, "utf8"));
  assert.equal(stored.analysis_hash, sha256Rcv016Text(Buffer.from(bundle.header.analysisCanonical, "utf8").toString("utf8")));
  assert.equal(await new Rcv017PostgresAnalysisReadRepository(traced).loadAnalysisById("40000000-0000-0000-0000-00000000ffff"), null);
  assert.equal(traced.trace.some((sql) => /\b(?:INSERT|UPDATE|DELETE|UPSERT|CREATE|DROP|ALTER)\b/i.test(sql)), false);
});

test("persisted RCV-016 tuple-order corruption is rejected without repair", { skip: !enabled }, async () => {
  const original = (await query("SELECT snapshot_canonical, snapshot_hash FROM public.provenance_snapshots WHERE id=(SELECT provenance_snapshot_id FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1)", [ANALYSIS_ID])).rows[0];
  const value = JSON.parse(original.snapshot_canonical);
  value.artifactProvenanceStatements.reverse();
  const canonical = require("../dist/services/rcv016Canonical").canonicalizeRcv016(value).canonical;
  await withReplicaMutation(
    "provenance_snapshots", "id=(SELECT provenance_snapshot_id FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1)", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.provenance_snapshots SET snapshot_canonical=$1, snapshot_hash=$2 WHERE id=(SELECT provenance_snapshot_id FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$3)", [canonical, sha256Rcv016Text(canonical), ANALYSIS_ID]),
    "snapshot_integrity_mismatch",
  );
});

test("persisted Policy and Snapshot binding substitutions fail closed", { skip: !enabled }, async () => {
  await withReplicaMutation(
    "claim_evidence_dependency_analyses", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.claim_evidence_dependency_analyses SET provenance_snapshot_hash=$1 WHERE analysis_id=$2", ["c".repeat(64), ANALYSIS_ID]), "snapshot_integrity_mismatch");
  await withReplicaMutation(
    "claim_evidence_dependency_analyses", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.claim_evidence_dependency_analyses SET dependency_analysis_policy_hash=$1 WHERE analysis_id=$2", ["c".repeat(64), ANALYSIS_ID]), "policy_integrity_mismatch");
  await withReplicaMutation(
    "claim_evidence_dependency_analyses", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.claim_evidence_dependency_analyses SET dependency_analysis_policy_version=dependency_analysis_policy_version+1 WHERE analysis_id=$1", [ANALYSIS_ID]), "policy_integrity_mismatch");
  await withReplicaMutation(
    "claim_evidence_dependency_analyses", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.claim_evidence_dependency_analyses SET provenance_snapshot_id=$1 WHERE analysis_id=$2", ["40000000-0000-0000-0000-00000000ffff", ANALYSIS_ID]), "snapshot_integrity_mismatch");
  await withReplicaMutation(
    "claim_evidence_dependency_analyses", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.claim_evidence_dependency_analyses SET dependency_analysis_policy_id=$1 WHERE analysis_id=$2", ["40000000-0000-0000-0000-00000000ffff", ANALYSIS_ID]), "policy_integrity_mismatch");
});

test("persisted Canonical/JCS/hash and relational projection corruption are detected", { skip: !enabled }, async () => {
  const original = (await query("SELECT analysis_canonical, analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1", [ANALYSIS_ID])).rows[0];
  const nonJcs = JSON.stringify(JSON.parse(original.analysis_canonical), null, 2);
  await withReplicaMutation(
    "claim_evidence_dependency_analyses", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.claim_evidence_dependency_analyses SET analysis_canonical=$1, analysis_hash=public.rcv016_sha256_text($1) WHERE analysis_id=$2", [nonJcs, ANALYSIS_ID]), "canonical_not_jcs");
  const hashRowBefore = await query("SELECT analysis_canonical, analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1", [ANALYSIS_ID]);
  const hashWriter = await pool.connect();
  try {
    await hashWriter.query("BEGIN");
    await hashWriter.query("SET LOCAL session_replication_role='replica'");
    try {
      await assert.rejects(
        () => hashWriter.query("UPDATE public.claim_evidence_dependency_analyses SET analysis_hash=$1 WHERE analysis_id=$2", ["d".repeat(64), ANALYSIS_ID]),
        (error) => error && error.code === "23514" && error.constraint === "chk_claim_evidence_dependency_analyses_hash",
      );
    } finally {
      await hashWriter.query("ROLLBACK").catch(() => {});
    }
  } finally { hashWriter.release(); }
  const hashRowAfter = await query("SELECT analysis_canonical, analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1", [ANALYSIS_ID]);
  assert.deepEqual(hashRowAfter.rows, hashRowBefore.rows, "rejected hash mutation changed persisted state");
  await withReplicaMutation(
    "dependency_analysis_bindings", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.dependency_analysis_bindings AS target SET artifact_version_id=(SELECT source.artifact_version_id FROM public.dependency_analysis_bindings AS source WHERE source.analysis_id=$1 AND source.artifact_version_id<>target.artifact_version_id LIMIT 1) WHERE target.analysis_id=$1 AND EXISTS (SELECT 1 FROM public.dependency_analysis_bindings AS source WHERE source.analysis_id=$1 AND source.artifact_version_id<>target.artifact_version_id)", [ANALYSIS_ID]), "relational_parity_mismatch");
  await withReplicaMutation(
    "dependency_analysis_evidence_relations", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("DELETE FROM public.dependency_analysis_evidence_relations WHERE ctid=(SELECT ctid FROM public.dependency_analysis_evidence_relations WHERE analysis_id=$1 LIMIT 1)", [ANALYSIS_ID]), "historical_input_mismatch");
});

test("persisted extra semantic relational member is rejected", { skip: !enabled }, async () => {
  await withReplicaMutation(
    "dependency_analysis_shared_artifact_members", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query(`INSERT INTO public.dependency_analysis_shared_artifact_members
      (analysis_id,direction,artifact_version_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
      SELECT f.analysis_id,f.direction,f.artifact_version_id,b.claim_version_evidence_relation_id,b.evidence_artifact_binding_statement_id
      FROM public.dependency_analysis_shared_artifact_findings f
      JOIN public.dependency_analysis_bindings b ON b.analysis_id=f.analysis_id
      WHERE f.analysis_id=$1 AND NOT EXISTS (
        SELECT 1 FROM public.dependency_analysis_shared_artifact_members m
        WHERE m.analysis_id=f.analysis_id AND m.direction=f.direction AND m.artifact_version_id=f.artifact_version_id
          AND m.claim_version_evidence_relation_id=b.claim_version_evidence_relation_id
          AND m.evidence_artifact_binding_statement_id=b.evidence_artifact_binding_statement_id)
      LIMIT 1`, [ANALYSIS_ID]), "relational_parity_mismatch");
});

test("persisted witness, common-upstream, negative, knowledge, and derived evidence corruption is detected", { skip: !enabled }, async () => {
  await withReplicaMutation(
    "dependency_analysis_common_upstream_witness_steps", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.dependency_analysis_common_upstream_witness_steps SET ordinal=ordinal+1000 WHERE analysis_id=$1 AND ordinal=(SELECT min(ordinal) FROM public.dependency_analysis_common_upstream_witness_steps WHERE analysis_id=$1)", [ANALYSIS_ID]), "witness_reproduction_mismatch");
  await withReplicaMutation(
    "dependency_analysis_common_upstream_witness_steps", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.dependency_analysis_common_upstream_witness_steps AS target SET artifact_provenance_statement_id=(SELECT source.artifact_provenance_statement_id FROM public.dependency_analysis_common_upstream_witness_steps AS source WHERE source.analysis_id=$1 AND source.artifact_provenance_statement_id IS NOT NULL AND source.artifact_provenance_statement_id<>target.artifact_provenance_statement_id LIMIT 1) WHERE target.ctid=(SELECT ctid FROM public.dependency_analysis_common_upstream_witness_steps WHERE analysis_id=$1 AND artifact_provenance_statement_id IS NOT NULL LIMIT 1) AND EXISTS (SELECT 1 FROM public.dependency_analysis_common_upstream_witness_steps AS source WHERE source.analysis_id=$1 AND source.artifact_provenance_statement_id IS NOT NULL AND source.artifact_provenance_statement_id<>target.artifact_provenance_statement_id)", [ANALYSIS_ID]), "witness_reproduction_mismatch");
  await withReplicaMutation(
    "dependency_analysis_common_upstream_findings", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.dependency_analysis_common_upstream_findings AS target SET upstream_artifact_version_id=(SELECT b.artifact_version_id FROM public.dependency_analysis_bindings AS b WHERE b.analysis_id=$1 AND b.artifact_version_id<>target.upstream_artifact_version_id AND NOT EXISTS (SELECT 1 FROM public.dependency_analysis_common_upstream_findings AS existing WHERE existing.analysis_id=target.analysis_id AND existing.direction=target.direction AND existing.upstream_artifact_version_id=b.artifact_version_id) ORDER BY b.artifact_version_id::text LIMIT 1) WHERE target.ctid=(SELECT ctid FROM public.dependency_analysis_common_upstream_findings WHERE analysis_id=$1 ORDER BY direction, upstream_artifact_version_id::text LIMIT 1) AND EXISTS (SELECT 1 FROM public.dependency_analysis_bindings AS b WHERE b.analysis_id=$1 AND b.artifact_version_id<>target.upstream_artifact_version_id AND NOT EXISTS (SELECT 1 FROM public.dependency_analysis_common_upstream_findings AS existing WHERE existing.analysis_id=target.analysis_id AND existing.direction=target.direction AND existing.upstream_artifact_version_id=b.artifact_version_id))", [ANALYSIS_ID]), "relational_parity_mismatch");
  await withReplicaMutation(
    "dependency_analysis_no_common_upstream_findings", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.dependency_analysis_no_common_upstream_findings SET lower_claim_version_evidence_relation_id=upper_claim_version_evidence_relation_id WHERE analysis_id=$1", [ANALYSIS_ID]), "relational_parity_mismatch");
  await withReplicaMutation(
    "dependency_analysis_knowledge_state_evidence", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.dependency_analysis_knowledge_state_evidence AS target SET knowledge_state_statement_id=(SELECT source.id FROM public.knowledge_state_statements AS source WHERE NOT EXISTS (SELECT 1 FROM public.dependency_analysis_knowledge_state_evidence AS existing WHERE existing.analysis_id=target.analysis_id AND existing.claim_version_evidence_relation_id=target.claim_version_evidence_relation_id AND existing.evidence_artifact_binding_statement_id=target.evidence_artifact_binding_statement_id AND existing.knowledge_state_statement_id=source.id) ORDER BY source.id::text LIMIT 1) WHERE target.ctid=(SELECT ctid FROM public.dependency_analysis_knowledge_state_evidence WHERE analysis_id=$1 ORDER BY claim_version_evidence_relation_id::text, evidence_artifact_binding_statement_id::text, knowledge_state_statement_id::text LIMIT 1) AND EXISTS (SELECT 1 FROM public.knowledge_state_statements AS source WHERE NOT EXISTS (SELECT 1 FROM public.dependency_analysis_knowledge_state_evidence AS existing WHERE existing.analysis_id=target.analysis_id AND existing.claim_version_evidence_relation_id=target.claim_version_evidence_relation_id AND existing.evidence_artifact_binding_statement_id=target.evidence_artifact_binding_statement_id AND existing.knowledge_state_statement_id=source.id))", [ANALYSIS_ID]), "relational_parity_mismatch");
  await withReplicaMutation(
    "dependency_analysis_derived_unrecorded_evidence", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.dependency_analysis_derived_unrecorded_evidence AS target SET artifact_version_id=(SELECT b.artifact_version_id FROM public.dependency_analysis_bindings AS b WHERE b.analysis_id=$1 AND b.artifact_version_id<>target.artifact_version_id LIMIT 1) WHERE target.analysis_id=$1 AND EXISTS (SELECT 1 FROM public.dependency_analysis_bindings AS b WHERE b.analysis_id=$1 AND b.artifact_version_id<>target.artifact_version_id)", [ANALYSIS_ID]), "knowledge_reproduction_mismatch");
});

test("persisted longer but structurally valid witness is rejected as non-minimal", { skip: !enabled }, async () => {
  const bundle = await loadBundle();
  const analysis = JSON.parse(bundle.header.analysisCanonical);
  const snapshot = JSON.parse(bundle.rcv016SnapshotRead.header.snapshotCanonical);
  const dependencyRelationships = new Set(JSON.parse(bundle.policyHeader.definitionCanonical).enabledDependencyRelationships);
  let candidate = null;
  for (const finding of analysis.findings.filter((item) => item.type === "RECORDED_COMMON_UPSTREAM")) {
    for (const member of finding.members) {
      if (member.witness.artifactProvenanceStatementIds.length !== 1) continue;
      const anchor = member.witness.artifactVersionIds[0];
      const upstream = finding.upstreamArtifactVersionId;
      const first = snapshot.artifactProvenanceStatements.find((statement) => dependencyRelationships.has(statement.relationship) && statement.subjectArtifactVersionId === anchor && statement.objectArtifactVersionId !== upstream);
      const second = first && snapshot.artifactProvenanceStatements.find((statement) => dependencyRelationships.has(statement.relationship) && statement.subjectArtifactVersionId === first.objectArtifactVersionId && statement.objectArtifactVersionId === upstream);
      if (first && second) { candidate = { finding, member, first, second }; break; }
    }
    if (candidate) break;
  }
  assert.ok(candidate, "fixture must provide a valid longer witness path");
  const { finding, member, first, second } = candidate;
  await withReplicaMutation(
    "dependency_analysis_common_upstream_witness_steps", "analysis_id=$1", [ANALYSIS_ID],
    async (client) => {
      const key = [ANALYSIS_ID, finding.direction, finding.upstreamArtifactVersionId, member.branchKey.claimVersionEvidenceRelationId, member.branchKey.evidenceArtifactBindingStatementId];
      await client.query(`UPDATE public.dependency_analysis_common_upstream_witness_steps
        SET artifact_version_id=$1, artifact_provenance_statement_id=$2
        WHERE analysis_id=$3 AND direction=$4 AND upstream_artifact_version_id=$5
          AND claim_version_evidence_relation_id=$6 AND evidence_artifact_binding_statement_id=$7 AND ordinal=0`,
      [first.objectArtifactVersionId, first.statementId, ...key]);
      await client.query(`UPDATE public.dependency_analysis_common_upstream_witness_steps
        SET artifact_version_id=$1, artifact_provenance_statement_id=$2
        WHERE analysis_id=$3 AND direction=$4 AND upstream_artifact_version_id=$5
          AND claim_version_evidence_relation_id=$6 AND evidence_artifact_binding_statement_id=$7 AND ordinal=1`,
      [second.objectArtifactVersionId, second.statementId, ...key]);
      await client.query(`INSERT INTO public.dependency_analysis_common_upstream_witness_steps
        (analysis_id,provenance_snapshot_id,direction,upstream_artifact_version_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,ordinal,artifact_version_id,artifact_provenance_statement_id)
        SELECT analysis_id,provenance_snapshot_id,direction,upstream_artifact_version_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,2,$1,NULL
        FROM public.dependency_analysis_common_upstream_witness_steps
        WHERE analysis_id=$2 AND direction=$3 AND upstream_artifact_version_id=$4
          AND claim_version_evidence_relation_id=$5 AND evidence_artifact_binding_statement_id=$6 AND ordinal=1`,
      [finding.upstreamArtifactVersionId, ...key]);
    }, "witness_reproduction_mismatch");
});

test("persisted equal-length alternate witness with the wrong lexical tie-break is rejected", { skip: !enabled }, async () => {
  const bundle = await loadBundle();
  const analysis = JSON.parse(bundle.header.analysisCanonical);
  const snapshot = JSON.parse(bundle.rcv016SnapshotRead.header.snapshotCanonical);
  const policy = JSON.parse(bundle.policyHeader.definitionCanonical);
  const dependencyRelationships = new Set(policy.enabledDependencyRelationships);
  let candidate = null;
  for (const finding of analysis.findings.filter((item) => item.type === "RECORDED_COMMON_UPSTREAM")) {
    for (const member of finding.members.filter((item) => item.witness.artifactProvenanceStatementIds.length > 0)) {
      const chosen = member.witness.artifactProvenanceStatementIds[0];
      const first = member.witness.artifactVersionIds[0];
      const second = member.witness.artifactVersionIds[1];
      const alternatives = snapshot.artifactProvenanceStatements
        .filter((statement) => statement.statementId !== chosen && statement.subjectArtifactVersionId === first && statement.objectArtifactVersionId === second && dependencyRelationships.has(statement.relationship))
        .filter((statement) => statement.statementId > chosen)
        .sort((left, right) => right.statementId < left.statementId ? -1 : right.statementId > left.statementId ? 1 : 0);
      if (alternatives.length > 0) { candidate = { member, chosen, alternate: alternatives[0] }; break; }
    }
    if (candidate) break;
  }
  assert.ok(candidate, "fixture must provide an equal-length parallel witness candidate");
  const { member, chosen, alternate } = candidate;
  await withReplicaMutation(
    "dependency_analysis_common_upstream_witness_steps", "analysis_id=$1", [ANALYSIS_ID],
    (client) => client.query("UPDATE public.dependency_analysis_common_upstream_witness_steps SET artifact_provenance_statement_id=$1 WHERE analysis_id=$2 AND artifact_provenance_statement_id=$3", [alternate.statementId, ANALYSIS_ID, chosen]), "witness_reproduction_mismatch");
});

test("later live provenance does not enrich the finalized analysis", { skip: !enabled }, async () => {
  const before = await loadBundle();
  const source = (await query("SELECT id FROM public.artifact_provenance_statements LIMIT 1")).rows[0];
  const laterId = "40000000-0000-0000-0000-00000000f901";
  await query("INSERT INTO public.artifact_provenance_statements(id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,observed_at,payload_limits_id,payload_limits_version) SELECT $1,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,observed_at,payload_limits_id,payload_limits_version FROM public.artifact_provenance_statements WHERE id=$2", [laterId, source.id]);
  try { const after = await loadBundle(); assert.equal((await verify(after)).verified, true); assert.equal(after.header.analysisCanonical, before.header.analysisCanonical); assert.equal(after.header.analysisHash, before.header.analysisHash); } finally {
    const cleanup = await pool.connect();
    try { await cleanup.query("BEGIN"); await cleanup.query("SET LOCAL session_replication_role='replica'"); await cleanup.query("DELETE FROM public.artifact_provenance_statements WHERE id=$1", [laterId]); await cleanup.query("COMMIT"); } finally { cleanup.release(); }
  }
});

test("persisted RCV-014 assessments and SourceRelationship context remain outside RCV-017 verification", { skip: !enabled }, async () => {
  const before = await loadBundle();
  const relation = (await query("SELECT id FROM public.claim_version_evidence WHERE id IN (SELECT claim_version_evidence_relation_id FROM public.dependency_analysis_evidence_relations WHERE analysis_id=$1) LIMIT 1", [ANALYSIS_ID])).rows[0];
  const payload = (await query("SELECT limits_id, limits_version FROM public.provenance_payload_limits LIMIT 1")).rows[0];
  assert.ok(relation && payload);
  const assessmentId = "40000000-0000-0000-0000-00000000f902";
  const sourceOne = "40000000-0000-0000-0000-00000000f903";
  const sourceTwo = "40000000-0000-0000-0000-00000000f904";
  const sourceStatement = "40000000-0000-0000-0000-00000000f905";
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role='replica'");
    await c.query("INSERT INTO public.evidence_assessments(id,claim_version_evidence_id,source_quality,independence,assessment_method,rationale,rubric_id,rubric_version,assessed_at) VALUES($1,$2,$3,NULL,'manual','phase6 exclusion fixture','factbase-evidence-assessment','1',transaction_timestamp())", [assessmentId, relation.id, 0.99]);
    await c.query("INSERT INTO public.provenance_sources(id) VALUES($1),($2)", [sourceOne, sourceTwo]);
    await c.query("INSERT INTO public.source_relationship_statements(id,subject_source_id,relationship_type,object_source_id,observed_at,payload_limits_id,payload_limits_version) VALUES($1,$2,'controlled_by',$3,transaction_timestamp(),$4,$5)", [sourceStatement, sourceOne, sourceTwo, payload.limits_id, payload.limits_version]);
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { c.release(); }
  try {
    const after = await loadBundle();
    assert.equal((await verify(after)).verified, true);
    assert.equal(after.header.analysisCanonical, before.header.analysisCanonical);
    assert.equal(after.header.analysisHash, before.header.analysisHash);
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query("SET LOCAL session_replication_role='replica'");
      await cleanup.query("DELETE FROM public.source_relationship_statements WHERE id=$1", [sourceStatement]);
      await cleanup.query("DELETE FROM public.provenance_sources WHERE id IN ($1,$2)", [sourceOne, sourceTwo]);
      await cleanup.query("DELETE FROM public.evidence_assessments WHERE id=$1", [assessmentId]);
      await cleanup.query("COMMIT");
    } catch (error) {
      await cleanup.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { cleanup.release(); }
  }
});

test("duplicate relational identity remains a physical constraint", { skip: !enabled }, async () => {
  const row = (await query("SELECT analysis_id, claim_version_evidence_relation_id, evidence_id, direction FROM public.dependency_analysis_evidence_relations WHERE analysis_id=$1 LIMIT 1", [ANALYSIS_ID])).rows[0];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(() => client.query("INSERT INTO public.dependency_analysis_evidence_relations(analysis_id,claim_version_evidence_relation_id,evidence_id,direction) VALUES($1,$2,$3,$4)", [row.analysis_id, row.claim_version_evidence_relation_id, row.evidence_id, row.direction]));
    await client.query("ROLLBACK");
  } finally { client.release(); }
});

test("Read Repository and Read-Verifier source contain no write, repair, or selection operations", { skip: !enabled }, () => {
  for (const file of ["src/services/rcv017PostgresReadRepository.ts", "src/services/rcv017ReadVerifier.ts"]) {
    const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|UPSERT|CREATE|DROP|ALTER)\b/);
    assert.doesNotMatch(source, /ORDER BY\s+created_at\s+DESC|latest|current|winner|effective|best|repair/i);
  }
});

test.after(async () => { if (pool) await pool.end(); });
