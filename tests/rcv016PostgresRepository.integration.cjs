const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");

const { canonicalizeRcv016, sha256Rcv016Text } = require("../dist/services/rcv016Canonical");
const { buildRcv016ProvenanceSnapshot } = require("../dist/services/rcv016SnapshotBuilder");
const { Rcv016PostgresSnapshotRepository } = require("../dist/services/rcv016PostgresRepository");
const { Rcv016DatabaseError, Rcv016RelationalIntegrityError } = require("../dist/services/rcv016RepositoryContract");
const { writeRcv016Snapshot } = require("../dist/services/rcv016WriteVerifier");

const TEST_DATABASE = "factbase_rcv016_phase4_20260830_01";
const DATABASE_CONFIG = { database: TEST_DATABASE, host: "/private/tmp", max: 12 };
const pool = new Pool(DATABASE_CONFIG);
const TS = "2026-01-02T03:04:05.000000Z";
const EMPTY = "{}";
const EMPTY_HASH = sha256Rcv016Text(EMPTY);
const LIMITS_ID = "phase-4-limits";
const LIMITS_VERSION = "1";
const POLICY_ID = "phase-4-policy";
const POLICY_VERSION = "1";

function id(number) {
  return `00000000-0000-0000-0000-${number.toString(16).padStart(12, "0")}`;
}

function policy(policyId = POLICY_ID, policyVersion = POLICY_VERSION) {
  const definition = {
    policyId,
    policyVersion,
    maxRoots: 10,
    maxNodes: 20,
    maxEdges: 20,
    maxDepth: 4,
    maxCanonicalSnapshotBytes: 1_000_000,
    allowedRelationships: ["cites", "derived_from", "incorporates", "quotes", "reposts", "syndicated_from", "uses_information_from"],
    deterministicOrdering: "schema_category_then_canonical_key_lexicographic_v1",
    visitedSemantics: "expand_node_once_include_statement_once_diagnose_cycles_v1",
  };
  const canonical = canonicalizeRcv016(definition);
  return { ...definition, definitionCanonical: canonical.canonical, definitionHash: canonical.hash };
}

function artifactVersion(number) {
  return { artifactVersionId: id(number), artifactId: id(1000 + number), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: EMPTY, captureHash: EMPTY_HASH, createdAt: TS };
}

function sourceVersion(number, sourceNumber) {
  return { sourceVersionId: id(number), sourceId: id(sourceNumber), versionNumber: 1, metadataSchemaIdentity: { id: "factbase-source-version-metadata", version: "1" }, metadataCanonical: EMPTY, metadataHash: EMPTY_HASH, observedAt: TS, createdAt: TS };
}

function common(statementId, foundation = null, rationale = null) {
  return { statementId, observedAt: TS, validFrom: null, validTo: null, initiator: null, rationale, foundation, supersedesStatementId: null, createdAt: TS };
}

function builderResult({ policyId = POLICY_ID, policyVersion = POLICY_VERSION, foundationTargets = {} } = {}) {
  const foundation = {
    schema: { id: "factbase-provenance-foundation", version: "1" },
    items: [
      { kind: "artifact_version_reference", artifactVersionId: foundationTargets.artifactVersion ?? id(3) },
      { kind: "deterministic_method", methodId: "method", methodVersion: "1", inputReferences: [
        { referenceType: "provenance_snapshot", referenceId: foundationTargets.snapshot ?? id(900) },
        { referenceType: "artifact_version", referenceId: foundationTargets.artifactVersion ?? id(3) },
        { referenceType: "evidence", referenceId: foundationTargets.evidence ?? id(501) },
      ] },
      { kind: "evidence_reference", evidenceId: foundationTargets.evidence ?? id(501) },
      { kind: "imported_assertion", referenceType: "external_record", reference: "free-string-not-a-target" },
    ],
  };
  const sourceA = sourceVersion(20, 2001);
  const sourceB = sourceVersion(21, 2002);
  return buildRcv016ProvenanceSnapshot({
    snapshotIdentity: { snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1", canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" },
    builderIdentity: { builderId: "factbase-provenance-snapshot-builder", builderVersion: "1", builderArtifactHash: "a".repeat(64) },
    traversalPolicy: policy(policyId, policyVersion),
    roots: [id(1)],
    artifactVersions: [artifactVersion(1), artifactVersion(2)],
    sourceVersions: [sourceA, sourceB],
    artifactProvenanceStatements: [
      { family: "ArtifactProvenanceStatement", ...common(id(101)), subjectArtifactVersionId: id(1), relationship: "cites", objectArtifactVersionId: id(2) },
      { family: "ArtifactProvenanceStatement", ...common(id(102)), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(1) },
    ],
    sourceRelationshipStatements: [
      { family: "SourceRelationshipStatement", ...common(id(301)), subjectSourceId: sourceA.sourceId, relationship: "part_of", objectSourceId: sourceB.sourceId },
    ],
    artifactSourceAttributions: [
      { family: "ArtifactSourceAttribution", ...common(id(201)), subjectArtifactVersionId: id(1), relationship: "authored_by", objectSourceVersionId: id(20) },
      { family: "ArtifactSourceAttribution", ...common(id(202)), subjectArtifactVersionId: id(2), relationship: "published_by", objectSourceVersionId: id(21) },
    ],
    evidenceArtifactBindings: [
      { family: "EvidenceArtifactBinding", ...common(id(401)), subjectEvidenceId: id(500), relationship: "bound_to", objectArtifactVersionId: id(1) },
    ],
    knowledgeStateStatements: [
      { family: "KnowledgeStateStatement", ...common(id(501), foundation, "nul:\u0000 literal:\\u0000 é quote:\" slash:\\"), subjectArtifactVersionId: id(1), scope: "upstream_provenance", state: "known" },
    ],
  });
}

async function insertPolicy(client, value) {
  await client.query(
    `INSERT INTO public.provenance_traversal_policies (
      policy_id, policy_version, schema_id, schema_version,
      definition_canonical, definition_hash, max_roots, max_nodes,
      max_edges, max_depth, max_canonical_snapshot_bytes,
      allowed_relationships, deterministic_ordering, visited_semantics
    ) VALUES ($1,$2,'factbase-provenance-traversal-policy','1',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [value.policyId, value.policyVersion, value.definitionCanonical, value.definitionHash, value.maxRoots, value.maxNodes, value.maxEdges, value.maxDepth, value.maxCanonicalSnapshotBytes, value.allowedRelationships, value.deterministicOrdering, value.visitedSemantics],
  );
}

async function insertRawSnapshot(client, snapshotId, canonical = EMPTY, hash = EMPTY_HASH) {
  const value = policy();
  await client.query(
    `INSERT INTO public.provenance_snapshots (
      id, snapshot_schema_id, snapshot_schema_version, builder_id,
      builder_version, builder_artifact_hash, canonicalization_id,
      canonicalization_version, hash_algorithm, policy_id, policy_version,
      definition_hash, max_roots, max_nodes, max_edges, max_depth,
      max_canonical_snapshot_bytes, allowed_relationships,
      deterministic_ordering, visited_semantics, snapshot_canonical, snapshot_hash
    ) VALUES ($1,'factbase-provenance-snapshot','1','factbase-provenance-snapshot-builder','1',$2,
      'jcs-rfc8785','1','sha-256',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [snapshotId, "a".repeat(64), value.policyId, value.policyVersion, value.definitionHash, value.maxRoots, value.maxNodes, value.maxEdges, value.maxDepth, value.maxCanonicalSnapshotBytes, value.allowedRelationships, value.deterministicOrdering, value.visitedSemantics, canonical, hash],
  );
}

async function installFixtures() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identity = await client.query("SELECT current_database() AS database, current_setting('server_version_num')::integer / 10000 AS major, current_setting('server_encoding') AS encoding, inet_server_addr() IS NULL AS local_socket");
    assert.deepEqual(identity.rows[0], { database: TEST_DATABASE, major: 16, encoding: "UTF8", local_socket: true });
    await client.query(
      `INSERT INTO public.provenance_payload_limits (
        limits_id, limits_version, schema_id, schema_version,
        source_metadata_canonical_bytes, source_locator_count,
        display_name_codepoints, display_name_utf8_bytes,
        locator_string_codepoints, locator_string_utf8_bytes,
        artifact_capture_canonical_bytes, artifact_locator_codepoints,
        artifact_locator_utf8_bytes, media_type_codepoints, media_type_utf8_bytes,
        title_codepoints, title_utf8_bytes, rationale_codepoints,
        rationale_utf8_bytes, foundation_canonical_bytes, foundation_item_count,
        foundation_input_reference_count, foundation_reference_codepoints,
        foundation_reference_utf8_bytes, definition_canonical, definition_hash
      ) VALUES ($1,$2,'factbase-provenance-payload-limits','1',
        10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,
        10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,$3,$4)`,
      [LIMITS_ID, LIMITS_VERSION, EMPTY, EMPTY_HASH],
    );
    await insertPolicy(client, policy());
    await insertPolicy(client, policy(POLICY_ID, "2"));
    await client.query("INSERT INTO public.evidence (id,retrieved_at,created_at) VALUES ($1,$2,$2),($3,$2,$2)", [id(500), TS, id(501)]);
    await client.query("INSERT INTO public.provenance_sources (id) VALUES ($1),($2)", [id(2001), id(2002)]);
    await client.query("INSERT INTO public.provenance_artifacts (id) VALUES ($1),($2),($3)", [id(1001), id(1002), id(1003)]);
    await client.query(
      `INSERT INTO public.provenance_source_versions
        (id,source_id,version_number,metadata_schema_id,metadata_schema_version,metadata_canonical,metadata_hash,observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,1,'factbase-source-version-metadata','1',$3,$4,$5,$6,$7),
              ($8,$9,1,'factbase-source-version-metadata','1',$3,$4,$5,$6,$7)`,
      [id(20), id(2001), EMPTY, EMPTY_HASH, TS, LIMITS_ID, LIMITS_VERSION, id(21), id(2002)],
    );
    await client.query(
      `INSERT INTO public.provenance_artifact_versions
        (id,artifact_id,version_number,capture_schema_id,capture_schema_version,capture_canonical,capture_hash,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,1,'factbase-artifact-version-capture','1',$3,$4,$5,$6),
              ($7,$8,1,'factbase-artifact-version-capture','1',$3,$4,$5,$6),
              ($9,$10,1,'factbase-artifact-version-capture','1',$3,$4,$5,$6)`,
      [id(1), id(1001), EMPTY, EMPTY_HASH, LIMITS_ID, LIMITS_VERSION, id(2), id(1002), id(3), id(1003)],
    );
    await client.query(
      `INSERT INTO public.artifact_provenance_statements
        (id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'cites',$3,$4,$5,$6),($7,$3,'quotes',$2,$4,$5,$6)`,
      [id(101), id(1), id(2), TS, LIMITS_ID, LIMITS_VERSION, id(102)],
    );
    await client.query(
      `INSERT INTO public.source_relationship_statements
        (id,subject_source_id,relationship_type,object_source_id,observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'part_of',$3,$4,$5,$6)`,
      [id(301), id(2001), id(2002), TS, LIMITS_ID, LIMITS_VERSION],
    );
    await client.query(
      `INSERT INTO public.artifact_source_attributions
        (id,artifact_version_id,relationship_type,source_version_id,observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'authored_by',$3,$4,$5,$6),($7,$8,'published_by',$9,$4,$5,$6)`,
      [id(201), id(1), id(20), TS, LIMITS_ID, LIMITS_VERSION, id(202), id(2), id(21)],
    );
    await client.query(
      `INSERT INTO public.evidence_artifact_bindings
        (id,evidence_id,artifact_version_id,observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id(401), id(500), id(1), TS, LIMITS_ID, LIMITS_VERSION],
    );
    const foundation = builderResult().snapshot.knowledgeStateStatements[0].foundation;
    const foundationCanonical = canonicalizeRcv016(foundation);
    await client.query(
      `INSERT INTO public.knowledge_state_statements
        (id,artifact_version_id,scope,state,observed_at,rationale,
         foundation_schema_id,foundation_schema_version,foundation_canonical,foundation_hash,
         payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'upstream_provenance','known',$3,$4,
         'factbase-provenance-foundation','1',$5,$6,$7,$8)`,
      [id(501), id(1), TS, "physical fixture", foundationCanonical.canonical, foundationCanonical.hash, LIMITS_ID, LIMITS_VERSION],
    );
    await insertRawSnapshot(client, id(900));
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function tracingPool(basePool, { failPattern = null, beforePattern = null, before = null } = {}) {
  const trace = { connects: 0, processIds: [], queries: [] };
  return {
    trace,
    async connect() {
      trace.connects += 1;
      const client = await basePool.connect();
      const processId = client.processID;
      return {
        processID: processId,
        async query(sql, values) {
          const text = typeof sql === "string" ? sql : sql.text;
          trace.processIds.push(processId);
          trace.queries.push({ text, values });
          if (beforePattern && text.includes(beforePattern)) await before();
          if (failPattern && text.includes(failPattern)) throw new Error(`injected ${failPattern}`);
          return client.query(sql, values);
        },
        release(destroy) { client.release(destroy); },
      };
    },
  };
}

async function write(result, repository, snapshotId) {
  return writeRcv016Snapshot({ builderResult: result, snapshotIdFactory: () => snapshotId, repository });
}

test.before(async () => {
  await installFixtures();
});

test.after(async () => {
  await pool.end();
});

test("physical installation and production API match the closed Phase-3 boundary", async () => {
  const inventory = await pool.query(
    `SELECT
      (SELECT count(*)::integer FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'provenance_%' OR tablename IN ('artifact_provenance_statements','source_relationship_statements','artifact_source_attributions','evidence_artifact_bindings','knowledge_state_statements'))) AS tables,
      (SELECT count(*)::integer FROM pg_proc WHERE proname LIKE 'rcv016_%') AS functions,
      (SELECT count(*)::integer FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg_rcv016_%') AS triggers`,
  );
  assert.deepEqual(inventory.rows[0], { tables: 19, functions: 4, triggers: 26 });
  const api = require("../dist/services/rcv016PostgresRepository");
  assert.deepEqual(Object.keys(api), ["Rcv016PostgresSnapshotRepository"]);
  assert.deepEqual(Object.getOwnPropertyNames(Rcv016PostgresSnapshotRepository.prototype).sort(), ["constructor", "withRcv016WriteTransaction"]);
});

test("real Write-Verifier round-trip is byte-exact, policy-exact, same-context, and preserves 7/7 Membership", async () => {
  const result = builderResult();
  const traced = tracingPool(pool);
  const repository = new Rcv016PostgresSnapshotRepository(traced);
  const snapshotId = id(800);
  const written = await write(result, repository, snapshotId);
  assert.equal(written.snapshotId, snapshotId);
  assert.equal(traced.trace.connects, 1);
  assert.equal(new Set(traced.trace.processIds).size, 1);
  assert.ok(traced.trace.queries.some(({ text }) => text === "SHOW transaction_isolation"));
  const policyQuery = traced.trace.queries.find(({ text }) => text.includes("FROM public.provenance_traversal_policies"));
  assert.deepEqual(policyQuery.values, [POLICY_ID, POLICY_VERSION]);
  assert.ok(!traced.trace.queries.some(({ text }) => text.includes("provenance_payload_limits")));
  assert.deepEqual(
    traced.trace.queries
      .filter(({ text }) => text.includes("FOR KEY SHARE"))
      .map(({ text }) => text.match(/FROM public\.([a-z_]+)/)[1]),
    ["evidence", "provenance_artifact_versions", "provenance_snapshots"],
  );
  const header = await pool.query("SELECT id::text,snapshot_canonical,snapshot_hash,created_at FROM public.provenance_snapshots WHERE id=$1", [snapshotId]);
  assert.equal(header.rows[0].id, snapshotId);
  assert.strictEqual(header.rows[0].snapshot_canonical, result.canonical);
  assert.equal(header.rows[0].snapshot_hash, result.hash);
  assert.ok(header.rows[0].created_at instanceof Date);
  assert.equal(createHash("sha256").update(Buffer.from(header.rows[0].snapshot_canonical, "utf8")).digest("hex"), result.hash);
  assert.ok(result.canonical.includes("\\u0000"));
  assert.ok(result.canonical.includes("\\\\u0000"));
  const tables = [
    ["provenance_snapshot_artifact_versions", "artifact_version_id", result.membership.artifactVersions.length],
    ["provenance_snapshot_source_versions", "source_version_id", result.membership.sourceVersions.length],
    ["provenance_snapshot_artifact_provenance_statements", "artifact_provenance_statement_id", result.membership.artifactProvenanceStatements.length],
    ["provenance_snapshot_source_relationship_statements", "source_relationship_statement_id", result.membership.sourceRelationshipStatements.length],
    ["provenance_snapshot_artifact_source_attributions", "artifact_source_attribution_id", result.membership.artifactSourceAttributions.length],
    ["provenance_snapshot_evidence_artifact_bindings", "evidence_artifact_binding_id", result.membership.evidenceArtifactBindings.length],
    ["provenance_snapshot_knowledge_state_statements", "knowledge_state_statement_id", result.membership.knowledgeStateStatements.length],
  ];
  for (const [table, column, expected] of tables) {
    const rows = await pool.query(`SELECT ${column}::text FROM public.${table} WHERE snapshot_id=$1`, [snapshotId]);
    assert.equal(rows.rowCount, expected, table);
  }
  const dualRole = await pool.query("SELECT membership_role FROM public.provenance_snapshot_artifact_versions WHERE snapshot_id=$1 AND artifact_version_id=$2 ORDER BY membership_role", [snapshotId, id(1)]);
  assert.deepEqual(dualRole.rows.map((row) => row.membership_role), ["included", "root"]);
  await assert.rejects(() => write(result, new Rcv016PostgresSnapshotRepository(pool), snapshotId), Rcv016DatabaseError);
});

test("REPEATABLE READ is physically stable across a concurrent exact-policy commit", async () => {
  const repository = new Rcv016PostgresSnapshotRepository(pool);
  await repository.withRcv016WriteTransaction({ isolation: "repeatable_read" }, async (transaction) => {
    assert.ok(await transaction.loadTraversalPolicyByIdentity(POLICY_ID, POLICY_VERSION));
    const concurrent = policy("phase-4-concurrent-policy", "1");
    await insertPolicy(pool, concurrent);
    assert.equal(await transaction.loadTraversalPolicyByIdentity(concurrent.policyId, concurrent.policyVersion), null);
  });
  const visibleAfter = await pool.query("SELECT count(*)::integer AS count FROM public.provenance_traversal_policies WHERE policy_id='phase-4-concurrent-policy' AND policy_version='1'");
  assert.equal(visibleAfter.rows[0].count, 1);
});

test("typed Foundation locks are real FOR KEY SHARE locks and missing targets fail closed", async () => {
  const trace = tracingPool(pool);
  const repository = new Rcv016PostgresSnapshotRepository(trace);
  await repository.withRcv016WriteTransaction({ isolation: "repeatable_read" }, async (transaction) => {
    assert.equal(await transaction.lockEvidenceForReferenceVerification(id(501)), true);
    assert.equal(await transaction.lockArtifactVersionForReferenceVerification(id(3)), true);
    assert.equal(await transaction.lockProvenanceSnapshotForReferenceVerification(id(900)), true);
    assert.equal(await transaction.lockEvidenceForReferenceVerification(id(9991)), false);
    assert.equal(await transaction.lockArtifactVersionForReferenceVerification(id(9992)), false);
    assert.equal(await transaction.lockProvenanceSnapshotForReferenceVerification(id(9993)), false);
  });
  const locks = trace.trace.queries.filter(({ text }) => text.includes("FOR KEY SHARE")).map(({ text }) => text.replace(/\s+/g, " "));
  assert.equal(locks.length, 6);
  assert.match(locks[0], /public\.evidence/);
  assert.match(locks[1], /public\.provenance_artifact_versions/);
  assert.match(locks[2], /public\.provenance_snapshots/);
  for (const [offset, target] of [
    [0, { evidence: id(9991) }],
    [1, { artifactVersion: id(9992) }],
    [2, { snapshot: id(9993) }],
  ]) {
    const result = builderResult({ foundationTargets: target });
    await assert.rejects(() => write(result, new Rcv016PostgresSnapshotRepository(pool), id(820 + offset)), Rcv016RelationalIntegrityError);
    const absent = await pool.query("SELECT count(*)::integer AS count FROM public.provenance_snapshots WHERE id=$1", [id(820 + offset)]);
    assert.equal(absent.rows[0].count, 0);
  }
});

test("Legacy Evidence deletion is blocked by the transaction lock until the protected window ends", async () => {
  const target = id(599);
  await pool.query("INSERT INTO public.evidence (id,retrieved_at,created_at) VALUES ($1,$2,$2)", [target, TS]);
  let releaseLock;
  const hold = new Promise((resolve) => { releaseLock = resolve; });
  let locked;
  const lockedSignal = new Promise((resolve) => { locked = resolve; });
  const repository = new Rcv016PostgresSnapshotRepository(pool);
  const transaction = repository.withRcv016WriteTransaction({ isolation: "repeatable_read" }, async (tx) => {
    assert.equal(await tx.lockEvidenceForReferenceVerification(target), true);
    locked();
    await hold;
  });
  await lockedSignal;
  let deleteSettled = false;
  const deletion = pool.query("DELETE FROM public.evidence WHERE id=$1", [target]).then(() => { deleteSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(deleteSettled, false);
  releaseLock();
  await transaction;
  await deletion;
  const absent = await pool.query("SELECT count(*)::integer AS count FROM public.evidence WHERE id=$1", [target]);
  assert.equal(absent.rows[0].count, 0);
});

test("ArtifactVersion deletion cannot undermine a locked Foundation reference", async () => {
  const target = id(3);
  let releaseLock;
  const hold = new Promise((resolve) => { releaseLock = resolve; });
  let locked;
  const lockedSignal = new Promise((resolve) => { locked = resolve; });
  const repository = new Rcv016PostgresSnapshotRepository(pool);
  const transaction = repository.withRcv016WriteTransaction({ isolation: "repeatable_read" }, async (tx) => {
    assert.equal(await tx.lockArtifactVersionForReferenceVerification(target), true);
    locked();
    await hold;
  });
  await lockedSignal;
  let deleteSettled = false;
  const deletion = pool.query("DELETE FROM public.provenance_artifact_versions WHERE id=$1", [target])
    .then(() => { deleteSettled = true; return null; }, (error) => { deleteSettled = true; return error; });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(deleteSettled, false);
  releaseLock();
  await transaction;
  const deletionError = await deletion;
  assert.equal(deletionError.message, "RCV-016 historical table provenance_artifact_versions is append-only");
  const retained = await pool.query("SELECT count(*)::integer AS count FROM public.provenance_artifact_versions WHERE id=$1", [target]);
  assert.equal(retained.rows[0].count, 1);
});

test("physical failure injection rolls back header and every one of seven Membership stages", async () => {
  const result = builderResult();
  const failures = [
    "INSERT INTO public.provenance_snapshots",
    "INSERT INTO public.provenance_snapshot_artifact_versions",
    "INSERT INTO public.provenance_snapshot_source_versions",
    "INSERT INTO public.provenance_snapshot_artifact_provenance_statements",
    "INSERT INTO public.provenance_snapshot_source_relationship_statements",
    "INSERT INTO public.provenance_snapshot_artifact_source_attributions",
    "INSERT INTO public.provenance_snapshot_evidence_artifact_bindings",
    "INSERT INTO public.provenance_snapshot_knowledge_state_statements",
    "COMMIT",
  ];
  for (let index = 0; index < failures.length; index += 1) {
    const snapshotId = id(830 + index);
    const fault = tracingPool(pool, { failPattern: failures[index] });
    await assert.rejects(() => write(result, new Rcv016PostgresSnapshotRepository(fault), snapshotId), Rcv016DatabaseError);
    assert.ok(fault.trace.queries.some(({ text }) => text === "ROLLBACK"), failures[index]);
    const counts = await pool.query(
      `SELECT
        (SELECT count(*) FROM public.provenance_snapshots WHERE id=$1)::integer AS header,
        (SELECT count(*) FROM public.provenance_snapshot_artifact_versions WHERE snapshot_id=$1)::integer AS membership`,
      [snapshotId],
    );
    assert.deepEqual(counts.rows[0], { header: 0, membership: 0 }, failures[index]);
  }
  const missingPolicy = builderResult({ policyId: "missing-policy" });
  await assert.rejects(() => write(missingPolicy, new Rcv016PostgresSnapshotRepository(pool), id(845)), Rcv016RelationalIntegrityError);
});

test("a real deferred statement constraint failure rolls back its Snapshot header and Membership", async () => {
  const snapshotId = id(870);
  const statementId = id(199);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertRawSnapshot(client, snapshotId);
    await client.query("INSERT INTO public.provenance_snapshot_artifact_versions (snapshot_id,artifact_version_id,membership_role) VALUES ($1,$2,'root')", [snapshotId, id(1)]);
    await client.query(
      `INSERT INTO public.artifact_provenance_statements
        (id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,observed_at,rationale,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'cites',$3,$4,$5,$6,$7)`,
      [statementId, id(1), id(2), TS, "x".repeat(10001), LIMITS_ID, LIMITS_VERSION],
    );
    await assert.rejects(
      () => client.query("COMMIT"),
      (error) => error.message === "RCV-016 rationale exceeds payload limits",
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
  const rows = await pool.query(
    `SELECT
      (SELECT count(*) FROM public.provenance_snapshots WHERE id=$1)::integer AS snapshots,
      (SELECT count(*) FROM public.provenance_snapshot_artifact_versions WHERE snapshot_id=$1)::integer AS memberships,
      (SELECT count(*) FROM public.artifact_provenance_statements WHERE id=$2)::integer AS statements`,
    [snapshotId, statementId],
  );
  assert.deepEqual(rows.rows[0], { snapshots: 0, memberships: 0, statements: 0 });
});

test("DB hash, append-only, and NO ACTION boundaries remain physically compatible", async () => {
  await assert.rejects(() => insertRawSnapshot(pool, id(880), "changed", EMPTY_HASH), (error) => error.code === "23514");
  for (const sql of [
    "UPDATE public.provenance_snapshots SET snapshot_canonical=snapshot_canonical WHERE id=$1",
    "DELETE FROM public.provenance_snapshots WHERE id=$1",
    "UPDATE public.provenance_snapshot_artifact_versions SET membership_role=membership_role WHERE snapshot_id=$1",
    "DELETE FROM public.provenance_snapshot_artifact_versions WHERE snapshot_id=$1",
  ]) {
    await assert.rejects(
      () => pool.query(sql, [id(800)]),
      (error) => error.message.includes("is append-only"),
    );
  }
  await assert.rejects(() => pool.query("DELETE FROM public.evidence WHERE id=$1", [id(500)]), (error) => error.code === "23503");
});

test("concurrent live Provenance and KnowledgeState inserts cannot alter the finalized Snapshot", async () => {
  const result = builderResult();
  const before = { canonical: result.canonical, hash: result.hash, membership: JSON.stringify(result.membership) };
  let releaseHeader;
  const release = new Promise((resolve) => { releaseHeader = resolve; });
  let headerReached;
  const reached = new Promise((resolve) => { headerReached = resolve; });
  const hooked = tracingPool(pool, {
    beforePattern: "INSERT INTO public.provenance_snapshots",
    before: async () => { headerReached(); await release; },
  });
  const writePromise = write(result, new Rcv016PostgresSnapshotRepository(hooked), id(890));
  await reached;
  await pool.query(
    `INSERT INTO public.knowledge_state_statements
      (id,artifact_version_id,scope,state,observed_at,payload_limits_id,payload_limits_version)
     VALUES ($1,$2,'upstream_provenance','partial',$3,$4,$5)`,
    [id(502), id(2), TS, LIMITS_ID, LIMITS_VERSION],
  );
  await pool.query(
    `INSERT INTO public.artifact_provenance_statements
      (id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,observed_at,payload_limits_id,payload_limits_version)
     VALUES ($1,$2,'derived_from',$3,$4,$5,$6)`,
    [id(103), id(1), id(2), TS, LIMITS_ID, LIMITS_VERSION],
  );
  releaseHeader();
  await writePromise;
  const knowledgeMembership = await pool.query("SELECT knowledge_state_statement_id::text AS id FROM public.provenance_snapshot_knowledge_state_statements WHERE snapshot_id=$1", [id(890)]);
  assert.deepEqual(knowledgeMembership.rows.map((row) => row.id), [id(501)]);
  const provenanceMembership = await pool.query("SELECT artifact_provenance_statement_id::text AS id FROM public.provenance_snapshot_artifact_provenance_statements WHERE snapshot_id=$1 ORDER BY artifact_provenance_statement_id", [id(890)]);
  assert.deepEqual(provenanceMembership.rows.map((row) => row.id), [id(101), id(102)]);
  assert.deepEqual({ canonical: result.canonical, hash: result.hash, membership: JSON.stringify(result.membership) }, before);
  const stored = await pool.query("SELECT snapshot_canonical,snapshot_hash FROM public.provenance_snapshots WHERE id=$1", [id(890)]);
  assert.strictEqual(stored.rows[0].snapshot_canonical, before.canonical);
  assert.equal(stored.rows[0].snapshot_hash, before.hash);
});
