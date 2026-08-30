const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool } = require("pg");

const { createRcv016ApplicationService } = require("../dist/services/rcv016ApplicationService");
const { validateAndCanonicalizeRcv016ArtifactCapture } = require("../dist/services/rcv016ArtifactCapture");
const { canonicalizeRcv016, sha256Rcv016Text } = require("../dist/services/rcv016Canonical");
const { validateAndCanonicalizeRcv016Foundation } = require("../dist/services/rcv016Foundation");
const { validateRcv016PayloadLimits } = require("../dist/services/rcv016PayloadLimits");
const { Rcv016PostgresHistoricalReadRepository } = require("../dist/services/rcv016PostgresReadRepository");
const { Rcv016PostgresSnapshotRepository } = require("../dist/services/rcv016PostgresRepository");
const { verifyRcv016HistoricalSnapshot } = require("../dist/services/rcv016ReadVerifier");
const { buildRcv016ProvenanceSnapshot } = require("../dist/services/rcv016SnapshotBuilder");
const { validateAndCanonicalizeRcv016SourceMetadata } = require("../dist/services/rcv016SourceMetadata");
const { validateRcv016TraversalPolicy } = require("../dist/services/rcv016TraversalPolicy");
const { writeRcv016Snapshot } = require("../dist/services/rcv016WriteVerifier");
const { RCV016_BOUNDED_PAYLOAD_FIELDS_V1 } = require("../dist/contracts/rcv016ProvenanceContractV1");

const DATABASE = "factbase_rcv016_phase7_20260830_01";
const pool = new Pool({ database: DATABASE, host: "/private/tmp", max: 12 });
const TS = "2026-01-02T03:04:05.000000Z";
const POLICY_ID = "phase-7-policy";
const POLICY_VERSION = "1";
const LIMITS_ID = "phase-7-limits";
const LIMITS_VERSION = "1";
const physicalCreatedAt = new Map();

function id(number) {
  return `00000000-0000-0000-0000-${number.toString(16).padStart(12, "0")}`;
}

function payloadLimits() {
  const definition = { limitsId: LIMITS_ID, limitsVersion: LIMITS_VERSION };
  for (const field of RCV016_BOUNDED_PAYLOAD_FIELDS_V1) definition[field] = 1_000_000;
  const canonical = canonicalizeRcv016(definition);
  return validateRcv016PayloadLimits({ ...definition, definitionCanonical: canonical.canonical, definitionHash: canonical.hash });
}

function policy(version = POLICY_VERSION) {
  const definition = {
    policyId: POLICY_ID, policyVersion: version, maxRoots: 10, maxNodes: 20,
    maxEdges: 20, maxDepth: 4, maxCanonicalSnapshotBytes: 1_000_000,
    allowedRelationships: ["cites", "derived_from", "incorporates", "quotes", "reposts", "syndicated_from", "uses_information_from"],
    deterministicOrdering: "schema_category_then_canonical_key_lexicographic_v1",
    visitedSemantics: "expand_node_once_include_statement_once_diagnose_cycles_v1",
  };
  const canonical = canonicalizeRcv016(definition);
  return validateRcv016TraversalPolicy({ ...definition, definitionCanonical: canonical.canonical, definitionHash: canonical.hash });
}

function common(statementId, foundation = null, rationale = null) {
  return { statementId, observedAt: TS, validFrom: null, validTo: null, initiator: null, rationale, foundation, supersedesStatementId: null, createdAt: physicalCreatedAt.get(statementId) ?? TS };
}

function deterministicFixture() {
  const limits = payloadLimits();
  const metadataA = validateAndCanonicalizeRcv016SourceMetadata({ schema: { id: "factbase-source-version-metadata", version: "1" }, displayName: "Source é", observedLocators: [] }, limits);
  const metadataB = validateAndCanonicalizeRcv016SourceMetadata({ schema: { id: "factbase-source-version-metadata", version: "1" }, displayName: "Source B", observedLocators: [] }, limits);
  const captureA = validateAndCanonicalizeRcv016ArtifactCapture({ schema: { id: "factbase-artifact-version-capture", version: "1" }, locator: null, mediaType: null, title: "actual nul:\u0000 literal:\\u0000 quote:\" slash:\\ é", publishedAt: null, observedAt: TS, retrievedAt: null, representation: { kind: "metadata_only", hashAlgorithm: null, contentHash: null } }, limits);
  const captureB = validateAndCanonicalizeRcv016ArtifactCapture({ schema: { id: "factbase-artifact-version-capture", version: "1" }, locator: null, mediaType: null, title: "B", publishedAt: null, observedAt: TS, retrievedAt: null, representation: { kind: "metadata_only", hashAlgorithm: null, contentHash: null } }, limits);
  const foundation = validateAndCanonicalizeRcv016Foundation({
    schema: { id: "factbase-provenance-foundation", version: "1" },
    items: [
      { kind: "evidence_reference", evidenceId: id(501) },
      { kind: "artifact_version_reference", artifactVersionId: id(3) },
      { kind: "deterministic_method", methodId: "phase-7-method", methodVersion: "1", inputReferences: [
        { referenceType: "evidence", referenceId: id(501) },
        { referenceType: "artifact_version", referenceId: id(3) },
        { referenceType: "provenance_snapshot", referenceId: id(900) },
      ] },
      { kind: "imported_assertion", referenceType: "external_record", reference: "free-string" },
    ],
  }, limits);
  const sourceVersions = [
    { sourceVersionId: id(20), sourceId: id(2001), versionNumber: 1, metadataSchemaIdentity: { id: "factbase-source-version-metadata", version: "1" }, metadataCanonical: metadataA.canonical, metadataHash: metadataA.hash, observedAt: TS, createdAt: physicalCreatedAt.get(id(20)) ?? TS },
    { sourceVersionId: id(21), sourceId: id(2002), versionNumber: 1, metadataSchemaIdentity: { id: "factbase-source-version-metadata", version: "1" }, metadataCanonical: metadataB.canonical, metadataHash: metadataB.hash, observedAt: TS, createdAt: physicalCreatedAt.get(id(21)) ?? TS },
  ];
  const artifactVersions = [
    { artifactVersionId: id(1), artifactId: id(1001), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: captureA.canonical, captureHash: captureA.hash, createdAt: physicalCreatedAt.get(id(1)) ?? TS },
    { artifactVersionId: id(2), artifactId: id(1002), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: captureB.canonical, captureHash: captureB.hash, createdAt: physicalCreatedAt.get(id(2)) ?? TS },
  ];
  const builderInput = {
    snapshotIdentity: { snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1", canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" },
    builderIdentity: { builderId: "factbase-provenance-snapshot-builder", builderVersion: "1", builderArtifactHash: "a".repeat(64) },
    traversalPolicy: policy(), roots: [id(1)], artifactVersions, sourceVersions,
    artifactProvenanceStatements: [
      { family: "ArtifactProvenanceStatement", ...common(id(101)), subjectArtifactVersionId: id(1), relationship: "cites", objectArtifactVersionId: id(2) },
      { family: "ArtifactProvenanceStatement", ...common(id(102)), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(1) },
    ],
    sourceRelationshipStatements: [{ family: "SourceRelationshipStatement", ...common(id(301)), subjectSourceId: id(2001), relationship: "part_of", objectSourceId: id(2002) }],
    artifactSourceAttributions: [
      { family: "ArtifactSourceAttribution", ...common(id(201)), subjectArtifactVersionId: id(1), relationship: "authored_by", objectSourceVersionId: id(20) },
      { family: "ArtifactSourceAttribution", ...common(id(202)), subjectArtifactVersionId: id(2), relationship: "published_by", objectSourceVersionId: id(21) },
    ],
    evidenceArtifactBindings: [{ family: "EvidenceArtifactBinding", ...common(id(401)), subjectEvidenceId: id(500), relationship: "bound_to", objectArtifactVersionId: id(1) }],
    knowledgeStateStatements: [{ family: "KnowledgeStateStatement", ...common(id(501), foundation.value, "documented only"), subjectArtifactVersionId: id(1), scope: "upstream_provenance", state: "known" }],
  };
  return { limits, foundation, builderInput };
}

async function insertPolicy(client, value) {
  await client.query(`INSERT INTO public.provenance_traversal_policies
    (policy_id,policy_version,schema_id,schema_version,definition_canonical,definition_hash,max_roots,max_nodes,max_edges,max_depth,max_canonical_snapshot_bytes,allowed_relationships,deterministic_ordering,visited_semantics)
    VALUES ($1,$2,'factbase-provenance-traversal-policy','1',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [value.policyId, value.policyVersion, value.definitionCanonical, value.definitionHash, value.maxRoots, value.maxNodes, value.maxEdges, value.maxDepth, value.maxCanonicalSnapshotBytes, value.allowedRelationships, value.deterministicOrdering, value.visitedSemantics]);
}

async function insertRawSnapshot(client, snapshotId, canonical = "{}", hash = sha256Rcv016Text(canonical), policyValue = policy()) {
  await client.query(`INSERT INTO public.provenance_snapshots
    (id,snapshot_schema_id,snapshot_schema_version,builder_id,builder_version,builder_artifact_hash,canonicalization_id,canonicalization_version,hash_algorithm,policy_id,policy_version,definition_hash,max_roots,max_nodes,max_edges,max_depth,max_canonical_snapshot_bytes,allowed_relationships,deterministic_ordering,visited_semantics,snapshot_canonical,snapshot_hash)
    VALUES ($1,'factbase-provenance-snapshot','1','factbase-provenance-snapshot-builder','1',$2,'jcs-rfc8785','1','sha-256',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
  [snapshotId, "a".repeat(64), policyValue.policyId, policyValue.policyVersion, policyValue.definitionHash, policyValue.maxRoots, policyValue.maxNodes, policyValue.maxEdges, policyValue.maxDepth, policyValue.maxCanonicalSnapshotBytes, policyValue.allowedRelationships, policyValue.deterministicOrdering, policyValue.visitedSemantics, canonical, hash]);
}

async function installFixtures() {
  const existing = await pool.query("SELECT count(*)::integer AS count FROM public.provenance_traversal_policies WHERE policy_id=$1 AND policy_version=$2", [POLICY_ID, POLICY_VERSION]);
  if (existing.rows[0].count === 0) {
  const fixture = deterministicFixture();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identity = await client.query("SELECT current_database() AS database,current_setting('server_version_num')::integer/10000 AS major,current_setting('server_encoding') AS encoding,inet_server_addr() IS NULL AS local_socket");
    assert.deepEqual(identity.rows[0], { database: DATABASE, major: 16, encoding: "UTF8", local_socket: true });
    const l = fixture.limits;
    await client.query(`INSERT INTO public.provenance_payload_limits
      (limits_id,limits_version,schema_id,schema_version,source_metadata_canonical_bytes,source_locator_count,display_name_codepoints,display_name_utf8_bytes,locator_string_codepoints,locator_string_utf8_bytes,artifact_capture_canonical_bytes,artifact_locator_codepoints,artifact_locator_utf8_bytes,media_type_codepoints,media_type_utf8_bytes,title_codepoints,title_utf8_bytes,rationale_codepoints,rationale_utf8_bytes,foundation_canonical_bytes,foundation_item_count,foundation_input_reference_count,foundation_reference_codepoints,foundation_reference_utf8_bytes,definition_canonical,definition_hash)
      VALUES ($1,$2,'factbase-provenance-payload-limits','1',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [l.limitsId,l.limitsVersion,l.sourceMetadataCanonicalBytes,l.sourceLocatorCount,l.displayNameCodepoints,l.displayNameUtf8Bytes,l.locatorStringCodepoints,l.locatorStringUtf8Bytes,l.artifactCaptureCanonicalBytes,l.artifactLocatorCodepoints,l.artifactLocatorUtf8Bytes,l.mediaTypeCodepoints,l.mediaTypeUtf8Bytes,l.titleCodepoints,l.titleUtf8Bytes,l.rationaleCodepoints,l.rationaleUtf8Bytes,l.foundationCanonicalBytes,l.foundationItemCount,l.foundationInputReferenceCount,l.foundationReferenceCodepoints,l.foundationReferenceUtf8Bytes,l.definitionCanonical,l.definitionHash]);
    await insertPolicy(client, policy());
    await insertPolicy(client, policy("2"));
    await client.query("INSERT INTO public.evidence (id,retrieved_at,created_at) VALUES ($1,$3,$3),($2,$3,$3)", [id(500),id(501),TS]);
    await client.query("INSERT INTO public.provenance_sources (id,created_at) VALUES ($1,$3),($2,$3)", [id(2001),id(2002),TS]);
    await client.query("INSERT INTO public.provenance_artifacts (id,created_at) VALUES ($1,$4),($2,$4),($3,$4)", [id(1001),id(1002),id(1003),TS]);
    for (const value of fixture.builderInput.sourceVersions) await client.query(`INSERT INTO public.provenance_source_versions (id,source_id,version_number,metadata_schema_id,metadata_schema_version,metadata_canonical,metadata_hash,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [value.sourceVersionId,value.sourceId,value.versionNumber,value.metadataSchemaIdentity.id,value.metadataSchemaIdentity.version,value.metadataCanonical,value.metadataHash,value.observedAt,LIMITS_ID,LIMITS_VERSION,value.createdAt]);
    for (const value of fixture.builderInput.artifactVersions) await client.query(`INSERT INTO public.provenance_artifact_versions (id,artifact_id,version_number,capture_schema_id,capture_schema_version,capture_canonical,capture_hash,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [value.artifactVersionId,value.artifactId,value.versionNumber,value.captureSchemaId,value.captureSchemaVersion,value.captureCanonical,value.captureHash,LIMITS_ID,LIMITS_VERSION,value.createdAt]);
    await client.query(`INSERT INTO public.provenance_artifact_versions (id,artifact_id,version_number,capture_schema_id,capture_schema_version,capture_canonical,capture_hash,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9)`, [id(3),id(1003),"factbase-artifact-version-capture","1",fixture.builderInput.artifactVersions[1].captureCanonical,fixture.builderInput.artifactVersions[1].captureHash,LIMITS_ID,LIMITS_VERSION,TS]);
    for (const value of fixture.builderInput.artifactProvenanceStatements) await client.query(`INSERT INTO public.artifact_provenance_statements (id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [value.statementId,value.subjectArtifactVersionId,value.relationship,value.objectArtifactVersionId,value.observedAt,LIMITS_ID,LIMITS_VERSION,value.createdAt]);
    for (const value of fixture.builderInput.sourceRelationshipStatements) await client.query(`INSERT INTO public.source_relationship_statements (id,subject_source_id,relationship_type,object_source_id,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [value.statementId,value.subjectSourceId,value.relationship,value.objectSourceId,value.observedAt,LIMITS_ID,LIMITS_VERSION,value.createdAt]);
    for (const value of fixture.builderInput.artifactSourceAttributions) await client.query(`INSERT INTO public.artifact_source_attributions (id,artifact_version_id,relationship_type,source_version_id,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [value.statementId,value.subjectArtifactVersionId,value.relationship,value.objectSourceVersionId,value.observedAt,LIMITS_ID,LIMITS_VERSION,value.createdAt]);
    const binding = fixture.builderInput.evidenceArtifactBindings[0];
    await client.query(`INSERT INTO public.evidence_artifact_bindings (id,evidence_id,artifact_version_id,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [binding.statementId,binding.subjectEvidenceId,binding.objectArtifactVersionId,binding.observedAt,LIMITS_ID,LIMITS_VERSION,binding.createdAt]);
    const knowledge = fixture.builderInput.knowledgeStateStatements[0];
    await client.query(`INSERT INTO public.knowledge_state_statements (id,artifact_version_id,scope,state,observed_at,rationale,foundation_schema_id,foundation_schema_version,foundation_canonical,foundation_hash,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,'factbase-provenance-foundation','1',$7,$8,$9,$10,$11)`, [knowledge.statementId,knowledge.subjectArtifactVersionId,knowledge.scope,knowledge.state,knowledge.observedAt,knowledge.rationale,fixture.foundation.canonical,fixture.foundation.hash,LIMITS_ID,LIMITS_VERSION,knowledge.createdAt]);
    await insertRawSnapshot(client,id(900));
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
  }
  const created = await pool.query(`
    SELECT id::text AS id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at FROM public.provenance_source_versions WHERE id=ANY($1::uuid[])
    UNION ALL SELECT id::text,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.provenance_artifact_versions WHERE id=ANY($2::uuid[])
    UNION ALL SELECT id::text,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.artifact_provenance_statements WHERE id=ANY($3::uuid[])
    UNION ALL SELECT id::text,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.source_relationship_statements WHERE id=ANY($4::uuid[])
    UNION ALL SELECT id::text,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.artifact_source_attributions WHERE id=ANY($5::uuid[])
    UNION ALL SELECT id::text,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.evidence_artifact_bindings WHERE id=ANY($6::uuid[])
    UNION ALL SELECT id::text,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.knowledge_state_statements WHERE id=ANY($7::uuid[])`,
  [[id(20),id(21)],[id(1),id(2),id(3)],[id(101),id(102)],[id(301)],[id(201),id(202)],[id(401)],[id(501)]]);
  for (const row of created.rows) physicalCreatedAt.set(row.id, row.created_at);
}

function tracingPool(basePool, beforeHeader) {
  return { async connect() { const client = await basePool.connect(); return { async query(sql, values) { if (beforeHeader && typeof sql === "string" && sql.includes("INSERT INTO public.provenance_snapshots")) await beforeHeader(); return client.query(sql, values); }, release(destroy) { client.release(destroy); } }; } };
}

function application(writePool = pool, snapshotId = id(804)) {
  return createRcv016ApplicationService({ builder: buildRcv016ProvenanceSnapshot, writer: writeRcv016Snapshot, verifier: verifyRcv016HistoricalSnapshot, writeRepository: new Rcv016PostgresSnapshotRepository(writePool), readRepository: new Rcv016PostgresHistoricalReadRepository(pool), snapshotIdFactory: () => snapshotId });
}

test.before(installFixtures);
test.after(async () => pool.end());

test("full real Build → Write → PostgreSQL → Read → Verify is exact", async () => {
  const fixture = deterministicFixture();
  const service = application();
  const built = service.buildSnapshot(fixture.builderInput);
  const written = await service.writeSnapshot(built);
  const verified = await service.verifySnapshot(written.snapshotId);
  assert.equal(verified.verified, true);
  assert.equal(verified.snapshotHash, built.hash);
  const raw = await new Rcv016PostgresHistoricalReadRepository(pool).loadHistoricalSnapshotById(written.snapshotId);
  assert.strictEqual(raw.header.snapshotCanonical, built.canonical);
  assert.equal(raw.header.snapshotHash, built.hash);
  assert.equal(raw.relationalMembershipKeys.length, built.snapshot.membershipKeys.length);
  assert.ok(built.canonical.includes("\\u0000"));
  assert.ok(built.canonical.includes("\\\\u0000"));
  assert.deepEqual(built.snapshot.conflictDiagnostics, []);
  assert.equal(built.snapshot.buildTimeCycleDiagnostics.length, 1);
  const roles = raw.relationalMembershipKeys.filter((key) => key.targetType === "ArtifactVersion" && key.artifactVersionId === id(1)).map((key) => key.membershipRole).sort();
  assert.deepEqual(roles, ["included", "root"]);
  assert.equal(raw.traversalPolicy.policyVersion, "1");
});

test("concurrent later KnowledgeState and Provenance plus later Source/Binding stay excluded", async () => {
  const fixture = deterministicFixture();
  const built = buildRcv016ProvenanceSnapshot(fixture.builderInput);
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let reached;
  const signal = new Promise((resolve) => { reached = resolve; });
  const hooked = tracingPool(pool, async () => { reached(); await hold; });
  const service = application(hooked, id(805));
  const writing = service.writeSnapshot(built);
  await signal;
  try {
    await pool.query(`INSERT INTO public.knowledge_state_statements (id,artifact_version_id,scope,state,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,'upstream_provenance','partial',$3,$4,$5,$3)`, [id(503),id(2),TS,LIMITS_ID,LIMITS_VERSION]);
    await pool.query(`INSERT INTO public.artifact_provenance_statements (id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,'derived_from',$3,$4,$5,$6,$4)`, [id(104),id(1),id(2),TS,LIMITS_ID,LIMITS_VERSION]);
    await pool.query(`INSERT INTO public.source_relationship_statements (id,subject_source_id,relationship_type,object_source_id,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,'controlled_by',$3,$4,$5,$6,$4)`, [id(303),id(2001),id(2002),TS,LIMITS_ID,LIMITS_VERSION]);
    await pool.query(`INSERT INTO public.evidence_artifact_bindings (id,evidence_id,artifact_version_id,observed_at,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$4)`, [id(403),id(500),id(2),TS,LIMITS_ID,LIMITS_VERSION]);
  } finally {
    release();
  }
  await writing;
  const raw = await new Rcv016PostgresHistoricalReadRepository(pool).loadHistoricalSnapshotById(id(805));
  assert.equal(raw.knowledgeStateStatements.length, 1);
  assert.equal(raw.artifactProvenanceStatements.length, 2);
  assert.equal(raw.sourceRelationshipStatements.length, 1);
  assert.equal(raw.evidenceArtifactBindings.length, 1);
  assert.equal((await service.verifySnapshot(id(805))).verified, true);
});

test("Evidence, ArtifactVersion, and ProvenanceSnapshot Foundation locks protect the write window", async () => {
  const repository = new Rcv016PostgresSnapshotRepository(pool);
  const cases = [
    ["Evidence", id(597), async () => pool.query("INSERT INTO public.evidence (id,retrieved_at,created_at) VALUES ($1,$2,$2)",[id(597),TS]), (tx) => tx.lockEvidenceForReferenceVerification(id(597)), () => pool.query("DELETE FROM public.evidence WHERE id=$1",[id(597)])],
    ["ArtifactVersion", id(3), async () => {}, (tx) => tx.lockArtifactVersionForReferenceVerification(id(3)), () => pool.query("DELETE FROM public.provenance_artifact_versions WHERE id=$1",[id(3)])],
    ["ProvenanceSnapshot", id(900), async () => {}, (tx) => tx.lockProvenanceSnapshotForReferenceVerification(id(900)), () => pool.query("DELETE FROM public.provenance_snapshots WHERE id=$1",[id(900)])],
  ];
  for (const [name,, setup, lock, remove] of cases) {
    await setup();
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    let locked;
    const signal = new Promise((resolve) => { locked = resolve; });
    const transaction = repository.withRcv016WriteTransaction({ isolation: "repeatable_read" }, async (tx) => { assert.equal(await lock(tx), true); locked(); await hold; });
    await signal;
    let settled = false;
    const deletion = remove().then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(settled, false, name);
    release();
    await transaction;
    const error = await deletion;
    if (name !== "Evidence") assert.match(error.message, /append-only/);
  }
});

async function copyMembership(sourceSnapshotId, targetSnapshotId, options = {}) {
  const definitions = [
    ["provenance_snapshot_artifact_versions", "artifact_version_id,membership_role", options.artifactWhere ?? "TRUE"],
    ["provenance_snapshot_source_versions", "source_version_id", "TRUE"],
    ["provenance_snapshot_artifact_provenance_statements", "artifact_provenance_statement_id", "TRUE"],
    ["provenance_snapshot_source_relationship_statements", "source_relationship_statement_id", "TRUE"],
    ["provenance_snapshot_artifact_source_attributions", "artifact_source_attribution_id", "TRUE"],
    ["provenance_snapshot_evidence_artifact_bindings", "evidence_artifact_binding_id", "TRUE"],
    ["provenance_snapshot_knowledge_state_statements", "knowledge_state_statement_id", options.knowledgeWhere ?? "TRUE"],
  ];
  for (const [table, columns, where] of definitions) {
    await pool.query(`INSERT INTO public.${table} (snapshot_id,${columns}) SELECT $1,${columns} FROM public.${table} WHERE snapshot_id=$2 AND ${where}`, [targetSnapshotId,sourceSnapshotId]);
  }
}

async function corruptSnapshot(sourceId, targetId, mutate, canonicalOverride = null, membershipOptions = {}) {
  const stored = await pool.query("SELECT snapshot_canonical FROM public.provenance_snapshots WHERE id=$1", [sourceId]);
  const snapshot = JSON.parse(stored.rows[0].snapshot_canonical);
  mutate(snapshot);
  const canonical = canonicalOverride === null ? canonicalizeRcv016(snapshot).canonical : canonicalOverride(snapshot);
  await insertRawSnapshot(pool,targetId,canonical,sha256Rcv016Text(canonical));
  await copyMembership(sourceId,targetId,membershipOptions);
  return canonical;
}

test("matching-hash Canonical corruption is detected neutrally and never rewritten", async () => {
  const sourceId = id(804);
  const cases = [
    [id(920), (snapshot) => {}, (snapshot) => JSON.stringify(snapshot, null, 2), "non_jcs_canonical"],
    [id(921), (snapshot) => { snapshot.extra = true; }, null, "closed_schema_violation"],
    [id(922), (snapshot) => { snapshot.snapshotSchemaVersion = "2"; }, null, "unsupported_contract_version"],
    [id(923), (snapshot) => { snapshot.membershipKeys.pop(); }, null, "snapshot_membership_mismatch"],
    [id(924), (snapshot) => { snapshot.derivedUnrecordedStates.pop(); }, null, "derived_state_mismatch"],
    [id(925), (snapshot) => { snapshot.buildTimeCycleDiagnostics.pop(); }, null, "diagnostic_corruption"],
    [id(926), (snapshot) => { snapshot.conflictDiagnostics.push({ code: "invented" }); }, null, "diagnostic_corruption"],
    [id(927), (snapshot) => { snapshot.policyVersion = "2"; }, null, "policy_corruption"],
  ];
  const readRepository = new Rcv016PostgresHistoricalReadRepository(pool);
  for (const [targetId,mutate,override,expected] of cases) {
    const canonical = await corruptSnapshot(sourceId,targetId,mutate,override);
    await assert.rejects(() => verifyRcv016HistoricalSnapshot(targetId,readRepository), (error) => error.code === expected);
    const after = await pool.query("SELECT snapshot_canonical FROM public.provenance_snapshots WHERE id=$1", [targetId]);
    assert.strictEqual(after.rows[0].snapshot_canonical, canonical);
  }
});

test("relational Membership missing, extra, and wrong-role corruption is detected", async () => {
  const sourceId = id(804);
  const readRepository = new Rcv016PostgresHistoricalReadRepository(pool);
  await corruptSnapshot(sourceId,id(930),() => {},null,{ knowledgeWhere: "FALSE" });
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(id(930),readRepository), (error) => error.code === "snapshot_membership_mismatch");

  await corruptSnapshot(sourceId,id(931),() => {});
  await pool.query("INSERT INTO public.provenance_snapshot_artifact_versions (snapshot_id,artifact_version_id,membership_role) VALUES ($1,$2,'included')", [id(931),id(3)]);
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(id(931),readRepository), (error) => error.code === "snapshot_membership_mismatch");

  await corruptSnapshot(sourceId,id(932),() => {},null,{ artifactWhere: "membership_role='root'" });
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(id(932),readRepository), (error) => error.code === "snapshot_membership_mismatch");
});

test("Foundation fifth-variant and missing-target corruption fail closed", async () => {
  const sourceId = id(804);
  const corruptFoundation = { schema: { id: "factbase-provenance-foundation", version: "1" }, items: [{ kind: "manual_review", reviewer: "invented" }] };
  const bound = canonicalizeRcv016(corruptFoundation);
  await pool.query(`INSERT INTO public.knowledge_state_statements
    (id,artifact_version_id,scope,state,observed_at,foundation_schema_id,foundation_schema_version,foundation_canonical,foundation_hash,payload_limits_id,payload_limits_version)
    VALUES ($1,$2,'upstream_provenance','known',$3,'factbase-provenance-foundation','1',$4,$5,$6,$7)`,
  [id(510),id(1),TS,bound.canonical,bound.hash,LIMITS_ID,LIMITS_VERSION]);
  const created = await pool.query("SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS value FROM public.knowledge_state_statements WHERE id=$1", [id(510)]);
  const canonical = await corruptSnapshot(sourceId,id(933),(snapshot) => {
    snapshot.knowledgeStateStatements[0] = { ...snapshot.knowledgeStateStatements[0], statementId: id(510), foundation: corruptFoundation, rationale: null, createdAt: created.rows[0].value };
    const key = snapshot.membershipKeys.find((entry) => entry.targetType === "KnowledgeStateStatement");
    key.knowledgeStateStatementId = id(510);
  },null,{ knowledgeWhere: "FALSE" });
  await pool.query("INSERT INTO public.provenance_snapshot_knowledge_state_statements (snapshot_id,knowledge_state_statement_id) VALUES ($1,$2)", [id(933),id(510)]);
  const readRepository = new Rcv016PostgresHistoricalReadRepository(pool);
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(id(933),readRepository), (error) => error.code === "foundation_corruption" || error.code === "closed_schema_violation");
  const unchanged = await pool.query("SELECT snapshot_canonical FROM public.provenance_snapshots WHERE id=$1", [id(933)]);
  assert.strictEqual(unchanged.rows[0].snapshot_canonical, canonical);

  await pool.query("DELETE FROM public.evidence WHERE id=$1", [id(501)]);
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(sourceId,readRepository), (error) => error.code === "foundation_corruption");
});

test("append-only and NO ACTION boundaries reject destructive mutation", async () => {
  for (const [sql,values] of [
    ["UPDATE public.provenance_snapshots SET snapshot_hash=snapshot_hash WHERE id=$1",[id(804)]],
    ["DELETE FROM public.provenance_snapshots WHERE id=$1",[id(804)]],
    ["UPDATE public.provenance_snapshot_artifact_versions SET membership_role=membership_role WHERE snapshot_id=$1",[id(804)]],
    ["DELETE FROM public.provenance_snapshot_artifact_versions WHERE snapshot_id=$1",[id(804)]],
  ]) await assert.rejects(() => pool.query(sql,values), (error) => /append-only/.test(error.message));
  await assert.rejects(() => pool.query("DELETE FROM public.evidence WHERE id=$1",[id(500)]), (error) => error.code === "23503");
});

test("production SQL/API contains no semantic selection, repair, JCS, or identity inference", () => {
  const postgresWrite = require("node:fs").readFileSync("src/services/rcv016PostgresRepository.ts","utf8");
  const postgresRead = require("node:fs").readFileSync("src/services/rcv016PostgresReadRepository.ts","utf8");
  const applicationSource = require("node:fs").readFileSync("src/services/rcv016ApplicationService.ts","utf8");
  const source = `${postgresWrite}\n${postgresRead}\n${applicationSource}`;
  assert.doesNotMatch(source,/ORDER BY\s+version\s+DESC|MAX\s*\(\s*version|latest|winner|effective|jsonb?_build|to_json|row_to_json|repair|autoBind|inferIndependent|truthScore|qualityScore|independenceScore|ranking/i);
  assert.doesNotMatch(postgresWrite,/provenance_payload_limits/);
});
