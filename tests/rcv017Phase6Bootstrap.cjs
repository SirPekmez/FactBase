/* One-way, externally gated Phase-6 baseline bootstrap. It owns no database lifecycle. */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { canonicalizeRcv016, sha256Rcv016Text } = require("../dist/services/rcv016Canonical");
const { validateRcv016PayloadLimits } = require("../dist/services/rcv016PayloadLimits");
const { validateAndCanonicalizeRcv016ArtifactCapture } = require("../dist/services/rcv016ArtifactCapture");
const { validateRcv016TraversalPolicy } = require("../dist/services/rcv016TraversalPolicy");
const { buildRcv016ProvenanceSnapshot } = require("../dist/services/rcv016SnapshotBuilder");
const { Rcv016PostgresSnapshotRepository } = require("../dist/services/rcv016PostgresRepository");
const { writeRcv016Snapshot } = require("../dist/services/rcv016WriteVerifier");
const { buildRcv017ClaimEvidenceDependencyAnalysis } = require("../dist/services/rcv017AnalysisBuilder");
const { verifyRcv017AnalysisForWrite } = require("../dist/services/rcv017WriteVerifier");
const { Rcv017PostgresAnalysisRepository } = require("../dist/services/rcv017PostgresRepository");

const DB = "factbase_rcv017_phase6_20260904_01";
if (process.env.RCV017_PHASE6_DATABASE !== DB) {
  throw new Error(`RCV017_PHASE6_DATABASE must equal ${DB}`);
}
const pool = new Pool({ database: DB, host: "/private/tmp", max: 4 });
const TS = "2026-09-04T10:00:00.000000Z";
const EMPTY = "{}";
const EMPTY_HASH = sha256Rcv016Text(EMPTY);
const LIMITS = "rcv017-phase6-limits";
const CLAIM_ID = "40000000-0000-0000-0000-000000000010";
const CLAIM_VERSION_ID = "40000000-0000-0000-0000-000000000011";
const SNAPSHOT_ID = "40000000-0000-0000-0000-000000000090";
const POLICY_ID = "40000000-0000-0000-0000-000000000070";
const ANALYSIS_ID = "40000000-0000-0000-0000-000000000320";
const ALGORITHM_HASH = "b".repeat(64);
const id = (n) => `40000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const common = (statementId, createdAt = TS) => ({ statementId, observedAt: TS, validFrom: null, validTo: null, initiator: null, rationale: null, foundation: null, supersedesStatementId: null, createdAt });

function limits() {
  const value = { limitsId: LIMITS, limitsVersion: "1" };
  for (const field of ["sourceMetadataCanonicalBytes", "sourceLocatorCount", "displayNameCodepoints", "displayNameUtf8Bytes", "locatorStringCodepoints", "locatorStringUtf8Bytes", "artifactCaptureCanonicalBytes", "artifactLocatorCodepoints", "artifactLocatorUtf8Bytes", "mediaTypeCodepoints", "mediaTypeUtf8Bytes", "titleCodepoints", "titleUtf8Bytes", "rationaleCodepoints", "rationaleUtf8Bytes", "foundationCanonicalBytes", "foundationItemCount", "foundationInputReferenceCount", "foundationReferenceCodepoints", "foundationReferenceUtf8Bytes"]) value[field] = 1000000;
  const canonical = canonicalizeRcv016(value);
  return validateRcv016PayloadLimits({ ...value, definitionCanonical: canonical.canonical, definitionHash: canonical.hash });
}

function snapshotPolicy() {
  const value = { policyId: "rcv017-phase6-snapshot-policy", policyVersion: "1", maxRoots: 20, maxNodes: 100, maxEdges: 100, maxDepth: 10, maxCanonicalSnapshotBytes: 1000000, allowedRelationships: ["cites", "derived_from", "incorporates", "quotes", "reposts", "syndicated_from", "uses_information_from"], deterministicOrdering: "schema_category_then_canonical_key_lexicographic_v1", visitedSemantics: "expand_node_once_include_statement_once_diagnose_cycles_v1" };
  const canonical = canonicalizeRcv016(value);
  return validateRcv016TraversalPolicy({ ...value, definitionCanonical: canonical.canonical, definitionHash: canonical.hash });
}

function artifact(n, payloadLimits, createdAt = TS) {
  const capture = validateAndCanonicalizeRcv016ArtifactCapture({ schema: { id: "factbase-artifact-version-capture", version: "1" }, locator: null, mediaType: null, title: `Phase-6 Artifact ${n}`, publishedAt: null, observedAt: TS, retrievedAt: null, representation: { kind: "metadata_only", hashAlgorithm: null, contentHash: null } }, payloadLimits);
  return { artifactVersionId: id(n), artifactId: id(1000 + n), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: capture.canonical, captureHash: capture.hash, createdAt };
}

function policy() {
  const definition = { schemaId: "factbase-dependency-analysis-policy", schemaVersion: "1", policyId: POLICY_ID, policyVersion: 1, relationshipClassificationCatalogId: "factbase-dependency-relationship-classification", relationshipClassificationCatalogVersion: "1", enabledDependencyRelationships: ["quotes"], evidenceDirectionPartitionRule: "supports_and_contradicts_separate_contextualizes_excluded", reflexiveClosureRule: "anchor_depth_zero_then_enabled_dependency_edges_minimum_distance", commonUpstreamRule: "same_exact_artifact_version_in_two_or_more_reflexive_branch_closures", negativeFindingRule: "unordered_same_direction_pair_with_disjoint_reflexive_closures", knowledgeLimitationRule: "snapshot_unknown_partial_or_derived_unrecorded_in_reached_set", witnessSelectionRule: "fewest_edges_then_ascii_statement_id_sequence", findingVocabularyRule: "rcv017_closed_four_finding_vocabulary_v1", cycleHandlingRule: "expand_once_per_branch_at_minimum_distance", deterministicOrderingRule: "rcv017_explicit_total_order_v1", maxEvidenceRelations: 20, maxBindings: 20, maxArtifactVersions: 100, maxStatements: 100, maxDependencyDepth: 10, maxFindings: 100, maxCanonicalBytes: 1000000, canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" };
  const canonical = canonicalizeRcv016(definition);
  return { definition, canonical: canonical.canonical, hash: canonical.hash };
}

function snapshotResult(payloadLimits, createdAtById = new Map()) {
  return buildRcv016ProvenanceSnapshot({
    snapshotIdentity: { snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1", canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" },
    builderIdentity: { builderId: "factbase-provenance-snapshot-builder", builderVersion: "1", builderArtifactHash: "a".repeat(64) },
    traversalPolicy: snapshotPolicy(),
    roots: [id(1), id(2), id(4)],
    artifactVersions: [1, 2, 3, 4].map((n) => artifact(n, payloadLimits, createdAtById.get(id(n)) ?? TS)),
    sourceVersions: [],
    artifactProvenanceStatements: [
      { family: "ArtifactProvenanceStatement", ...common(id(500), createdAtById.get(id(500)) ?? TS), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(2) },
      { family: "ArtifactProvenanceStatement", ...common(id(501), createdAtById.get(id(501)) ?? TS), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(3) },
      { family: "ArtifactProvenanceStatement", ...common(id(502), createdAtById.get(id(502)) ?? TS), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(3) },
      { family: "ArtifactProvenanceStatement", ...common(id(503), createdAtById.get(id(503)) ?? TS), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(3) },
      { family: "ArtifactProvenanceStatement", ...common(id(504), createdAtById.get(id(504)) ?? TS), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(1) },
    ],
    sourceRelationshipStatements: [], artifactSourceAttributions: [],
    evidenceArtifactBindings: [1, 2, 3, 4].map((n) => ({ family: "EvidenceArtifactBinding", ...common(id(400 + n), createdAtById.get(id(400 + n)) ?? TS), subjectEvidenceId: id(200 + n), relationship: "bound_to", objectArtifactVersionId: id(n === 3 ? 1 : n) })),
    knowledgeStateStatements: [
      { family: "KnowledgeStateStatement", ...common(id(601), createdAtById.get(id(601)) ?? TS), subjectArtifactVersionId: id(1), scope: "upstream_provenance", state: "unknown" },
      { family: "KnowledgeStateStatement", ...common(id(602), createdAtById.get(id(602)) ?? TS), subjectArtifactVersionId: id(2), scope: "upstream_provenance", state: "partial" },
      { family: "KnowledgeStateStatement", ...common(id(603), createdAtById.get(id(603)) ?? TS), subjectArtifactVersionId: id(3), scope: "upstream_provenance", state: "known" },
    ],
  });
}

function analysisPolicy() {
  return policy();
}

async function insertPrerequisites(client, payloadLimits, snapshotPolicyValue) {
  await client.query("INSERT INTO public.claims(id) VALUES($1)", [CLAIM_ID]);
  await client.query("INSERT INTO public.claim_versions(id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at) VALUES($1,$2,1,'phase6','phase6','en','fact','active','published','fixture',$3)", [CLAIM_VERSION_ID, CLAIM_ID, TS]);
  for (let n = 1; n <= 4; n += 1) {
    await client.query("INSERT INTO public.evidence(id,retrieved_at,created_at) VALUES($1,$2,$2)", [id(200 + n), TS]);
    await client.query("INSERT INTO public.claim_version_evidence(id,claim_version_id,evidence_id,relation,created_at) VALUES($1,$2,$3,'supports',$4)", [id(100 + n), CLAIM_VERSION_ID, id(200 + n), TS]);
  }
  await client.query("INSERT INTO public.provenance_payload_limits(limits_id,limits_version,schema_id,schema_version,source_metadata_canonical_bytes,source_locator_count,display_name_codepoints,display_name_utf8_bytes,locator_string_codepoints,locator_string_utf8_bytes,artifact_capture_canonical_bytes,artifact_locator_codepoints,artifact_locator_utf8_bytes,media_type_codepoints,media_type_utf8_bytes,title_codepoints,title_utf8_bytes,rationale_codepoints,rationale_utf8_bytes,foundation_canonical_bytes,foundation_item_count,foundation_input_reference_count,foundation_reference_codepoints,foundation_reference_utf8_bytes,definition_canonical,definition_hash) VALUES($1,'1','factbase-provenance-payload-limits','1',1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,1000000,$2,$3)", [LIMITS, payloadLimits.definitionCanonical, payloadLimits.definitionHash]);
  await client.query("INSERT INTO public.provenance_traversal_policies(policy_id,policy_version,schema_id,schema_version,definition_canonical,definition_hash,max_roots,max_nodes,max_edges,max_depth,max_canonical_snapshot_bytes,allowed_relationships,deterministic_ordering,visited_semantics) VALUES($1,$2,'factbase-provenance-traversal-policy','1',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [snapshotPolicyValue.policyId, snapshotPolicyValue.policyVersion, snapshotPolicyValue.definitionCanonical, snapshotPolicyValue.definitionHash, snapshotPolicyValue.maxRoots, snapshotPolicyValue.maxNodes, snapshotPolicyValue.maxEdges, snapshotPolicyValue.maxDepth, snapshotPolicyValue.maxCanonicalSnapshotBytes, snapshotPolicyValue.allowedRelationships, snapshotPolicyValue.deterministicOrdering, snapshotPolicyValue.visitedSemantics]);
  for (let n = 1; n <= 4; n += 1) {
    await client.query("INSERT INTO public.provenance_artifacts(id) VALUES($1)", [id(1000 + n)]);
    await client.query("INSERT INTO public.provenance_artifact_versions(id,artifact_id,version_number,capture_schema_id,capture_schema_version,capture_canonical,capture_hash,payload_limits_id,payload_limits_version,created_at) VALUES($1,$2,1,'factbase-artifact-version-capture','1',$3,$4,$5,'1',$6)", [id(n), id(1000 + n), artifact(n, payloadLimits).captureCanonical, artifact(n, payloadLimits).captureHash, LIMITS, TS]);
  }
  for (const [statementId, downstream, upstream] of [[500, 1, 2], [501, 1, 3], [502, 2, 3], [503, 1, 3], [504, 2, 1]]) await client.query("INSERT INTO public.artifact_provenance_statements(id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,observed_at,payload_limits_id,payload_limits_version) VALUES($1,$2,'quotes',$3,$4,$5,'1')", [id(statementId), id(downstream), id(upstream), TS, LIMITS]);
  for (let n = 1; n <= 4; n += 1) await client.query("INSERT INTO public.evidence_artifact_bindings(id,evidence_id,artifact_version_id,observed_at,payload_limits_id,payload_limits_version) VALUES($1,$2,$3,$4,$5,'1')", [id(400 + n), id(200 + n), id(n === 3 ? 1 : n), TS, LIMITS]);
  await client.query("INSERT INTO public.knowledge_state_statements(id,artifact_version_id,scope,state,observed_at,payload_limits_id,payload_limits_version) VALUES($1,$2,'upstream_provenance','unknown',$3,$4,'1'),($5,$6,'upstream_provenance','partial',$3,$4,'1'),($7,$8,'upstream_provenance','known',$3,$4,'1')", [id(601), id(1), TS, LIMITS, id(602), id(2), id(603), id(3)]);
}

async function preflight(client) {
  const checks = [
    ["claims", "id=$1", [CLAIM_ID], "Claim"],
    ["claim_versions", "id=$1", [CLAIM_VERSION_ID], "ClaimVersion"],
    ...[1, 2, 3, 4].map((n) => ["evidence", "id=$1", [id(200 + n)], `Evidence ${n}`]),
    ...[1, 2, 3, 4].map((n) => ["claim_version_evidence", "id=$1", [id(100 + n)], `ClaimVersion-Evidence relation ${n}`]),
    ...[1, 2, 3, 4].map((n) => ["provenance_artifacts", "id=$1", [id(1000 + n)], `Artifact ${n}`]),
    ...[1, 2, 3, 4].map((n) => ["provenance_artifact_versions", "id=$1", [id(n)], `ArtifactVersion ${n}`]),
    ...[500, 501, 502, 503, 504].map((n) => ["artifact_provenance_statements", "id=$1", [id(n)], `Provenance statement ${n}`]),
    ...[1, 2, 3, 4].map((n) => ["evidence_artifact_bindings", "id=$1", [id(400 + n)], `EvidenceArtifactBinding ${n}`]),
    ...[601, 602, 603].map((n) => ["knowledge_state_statements", "id=$1", [id(n)], `KnowledgeState statement ${n}`]),
    ["provenance_snapshots", "id=$1", [SNAPSHOT_ID], "RCV-016 Snapshot"],
    ["provenance_traversal_policies", "policy_id=$1 AND policy_version=$2", ["rcv017-phase6-snapshot-policy", "1"], "Traversal Policy"],
    ["provenance_payload_limits", "limits_id=$1 AND limits_version=$2", [LIMITS, "1"], "Payload Limits"],
    ["dependency_analysis_policies", "policy_id=$1 AND policy_version=$2", [POLICY_ID, 1], "RCV-017 Policy"],
    ["dependency_analysis_policy_relationships", "policy_id=$1 AND policy_version=$2", [POLICY_ID, 1], "RCV-017 Policy relationships"],
    ["claim_evidence_dependency_analyses", "analysis_id=$1", [ANALYSIS_ID], "RCV-017 Analysis"],
  ];
  for (const [table, where, params, label] of checks) {
    const result = await client.query(`SELECT count(*)::int AS count FROM public.${table} WHERE ${where}`, params);
    if (result.rows[0].count !== 0) {
      const error = new Error(`partial_or_existing_baseline: ${label}`);
      error.code = "partial_or_existing_baseline";
      throw error;
    }
  }
  for (const table of ["provenance_snapshot_artifact_versions", "provenance_snapshot_source_versions", "provenance_snapshot_artifact_provenance_statements", "provenance_snapshot_source_relationship_statements", "provenance_snapshot_artifact_source_attributions", "provenance_snapshot_evidence_artifact_bindings", "provenance_snapshot_knowledge_state_statements"]) {
    const result = await client.query(`SELECT count(*)::int AS count FROM public.${table} WHERE snapshot_id=$1`, [SNAPSHOT_ID]);
    if (result.rows[0].count !== 0) {
      const error = new Error(`partial_or_existing_baseline: Snapshot membership ${table}`);
      error.code = "partial_or_existing_baseline";
      throw error;
    }
  }
}

function assertFixtureTopology(snapshot, bindings) {
  const enabled = new Set(["quotes"]);
  const byId = new Map(snapshot.snapshot.artifactProvenanceStatements.map((statement) => [statement.statementId, statement]));
  const path = (ids) => ids.map((statementId) => byId.get(id(statementId)));
  const paths = [[500, 502], [504, 501]].map(path);
  assert.equal(paths[0].length, 2);
  assert.equal(paths[1].length, 2);
  for (const edges of paths) {
    assert.ok(edges.every((edge) => edge && enabled.has(edge.relationship)));
    assert.equal(edges[0].objectArtifactVersionId, edges[1].subjectArtifactVersionId);
    assert.ok(edges.every((edge) => byId.get(edge.statementId) === edge));
    assert.ok(edges.every((edge) => edge.relationship !== "cites"));
  }
  assert.notDeepEqual(paths[0].map((edge) => edge.statementId), paths[1].map((edge) => edge.statementId));
  assert.equal(paths[0][0].subjectArtifactVersionId, id(1));
  assert.equal(paths[1][0].subjectArtifactVersionId, id(2));
  assert.notEqual(paths[0][0].subjectArtifactVersionId, paths[1][0].subjectArtifactVersionId);
  assert.equal(paths[0][1].objectArtifactVersionId, id(3));
  assert.equal(paths[1][1].objectArtifactVersionId, id(3));
  const anchors = new Set(bindings.map((binding) => binding.artifactVersionId));
  assert.ok(anchors.has(paths[0][0].subjectArtifactVersionId));
  assert.ok(anchors.has(paths[1][0].subjectArtifactVersionId));
  assert.deepEqual(anchors, new Set([id(1), id(2), id(4)]));
  const cycle = path([500, 504]);
  assert.ok(cycle.length === 2 && cycle.every((edge) => edge && enabled.has(edge.relationship)));
  assert.deepEqual(new Set(cycle.flatMap((edge) => [edge.subjectArtifactVersionId, edge.objectArtifactVersionId])), new Set([id(1), id(2)]));
  assert.equal(cycle[0].subjectArtifactVersionId, cycle[1].objectArtifactVersionId);
  assert.equal(cycle[0].objectArtifactVersionId, cycle[1].subjectArtifactVersionId);
  assert.ok(anchors.has(id(1)) && anchors.has(id(2)));
  assert.ok(cycle.every((edge) => snapshot.snapshot.artifactProvenanceStatements.some((candidate) => candidate.statementId === edge.statementId)));
  assert.equal(snapshot.snapshot.artifactProvenanceStatements.some((statement) => statement.relationship === "cites"), false);
}

async function main() {
  const check = await pool.query("SELECT current_database() AS database, current_setting('server_encoding') AS encoding, current_setting('server_version_num')::int / 10000 AS major", []);
  assert.deepEqual(check.rows[0], { database: DB, encoding: "UTF8", major: 16 });
  const requiredTables = ["provenance_snapshots", "provenance_snapshot_artifact_versions", "provenance_snapshot_artifact_provenance_statements", "provenance_snapshot_evidence_artifact_bindings", "provenance_snapshot_knowledge_state_statements", "dependency_analysis_policies", "dependency_analysis_policy_relationships", "claim_evidence_dependency_analyses", "dependency_analysis_evidence_relations", "dependency_analysis_bindings", "dependency_analysis_shared_artifact_findings", "dependency_analysis_shared_artifact_members", "dependency_analysis_common_upstream_findings", "dependency_analysis_common_upstream_members", "dependency_analysis_common_upstream_witness_steps", "dependency_analysis_no_common_upstream_findings", "dependency_analysis_knowledge_incomplete_findings", "dependency_analysis_knowledge_affected_artifacts", "dependency_analysis_knowledge_state_evidence", "dependency_analysis_derived_unrecorded_evidence"];
  const tableCheck = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])", [requiredTables]);
  assert.deepEqual(new Set(tableCheck.rows.map((row) => row.tablename)), new Set(requiredTables));
  const preflightClient = await pool.connect();
  try { await preflight(preflightClient); } finally { preflightClient.release(); }
  const payloadLimits = limits();
  const sp = snapshotPolicy();
  const c = await pool.connect();
  try { await c.query("BEGIN"); await insertPrerequisites(c, payloadLimits, sp); await c.query("COMMIT"); } catch (error) { await c.query("ROLLBACK").catch(() => {}); throw error; } finally { c.release(); }
  const createdAtRows = await pool.query(`
    SELECT id::text, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM public.provenance_artifact_versions WHERE id = ANY($1::uuid[])
    UNION ALL
    SELECT id::text, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM public.artifact_provenance_statements WHERE id = ANY($2::uuid[])
    UNION ALL
    SELECT id::text, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM public.evidence_artifact_bindings WHERE id = ANY($3::uuid[])
    UNION ALL
    SELECT id::text, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM public.knowledge_state_statements WHERE id = ANY($4::uuid[])`,
    [[1, 2, 3, 4].map((n) => id(n)), [500, 501, 502, 503, 504].map((n) => id(n)), [1, 2, 3, 4].map((n) => id(400 + n)), [601, 602, 603].map((n) => id(n))]);
  const createdAtById = new Map(createdAtRows.rows.map((row) => [row.id, row.created_at]));
  assert.equal(createdAtById.size, 16, "all server-controlled historical timestamps must be read before Snapshot construction");
  const snap = snapshotResult(payloadLimits, createdAtById);
  const finalizedStatementIds = snap.snapshot.artifactProvenanceStatements.map((statement) => statement.statementId);
  assert.ok(finalizedStatementIds.some((value, index) => index > 0 && value < finalizedStatementIds[index - 1]), "fixture must produce non-monotonic finalized statement IDs");
  const relations = [1, 2, 3, 4].map((n) => ({ claimVersionEvidenceRelationId: id(100 + n), evidenceId: id(200 + n), direction: "supports" }));
  const bindings = [1, 2, 3, 4].map((n) => ({ claimVersionEvidenceRelationId: id(100 + n), evidenceArtifactBindingStatementId: id(400 + n), evidenceId: id(200 + n), artifactVersionId: id(n === 3 ? 1 : n) }));
  assertFixtureTopology(snap, bindings);
  const snapshotWrite = await writeRcv016Snapshot({ builderResult: snap, snapshotIdFactory: () => SNAPSHOT_ID, repository: new Rcv016PostgresSnapshotRepository(pool) });
  const p = analysisPolicy();
  const policyDefinition = p.definition;
  const policyCanonical = p.canonical;
  const policyHash = p.hash;
  const policyClient = await pool.connect();
  try {
    await policyClient.query("BEGIN");
    await policyClient.query("INSERT INTO public.dependency_analysis_policies(policy_id,policy_version,schema_id,schema_version,relationship_classification_catalog_id,relationship_classification_catalog_version,evidence_direction_partition_rule,reflexive_closure_rule,common_upstream_rule,negative_finding_rule,knowledge_limitation_rule,witness_selection_rule,finding_vocabulary_rule,cycle_handling_rule,deterministic_ordering_rule,max_evidence_relations,max_bindings,max_artifact_versions,max_statements,max_dependency_depth,max_findings,max_canonical_bytes,canonicalization_id,canonicalization_version,hash_algorithm,definition_canonical,definition_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)", [policyDefinition.policyId, policyDefinition.policyVersion, policyDefinition.schemaId, policyDefinition.schemaVersion, policyDefinition.relationshipClassificationCatalogId, policyDefinition.relationshipClassificationCatalogVersion, policyDefinition.evidenceDirectionPartitionRule, policyDefinition.reflexiveClosureRule, policyDefinition.commonUpstreamRule, policyDefinition.negativeFindingRule, policyDefinition.knowledgeLimitationRule, policyDefinition.witnessSelectionRule, policyDefinition.findingVocabularyRule, policyDefinition.cycleHandlingRule, policyDefinition.deterministicOrderingRule, policyDefinition.maxEvidenceRelations, policyDefinition.maxBindings, policyDefinition.maxArtifactVersions, policyDefinition.maxStatements, policyDefinition.maxDependencyDepth, policyDefinition.maxFindings, policyDefinition.maxCanonicalBytes, policyDefinition.canonicalizationId, policyDefinition.canonicalizationVersion, policyDefinition.hashAlgorithm, policyCanonical, policyHash]);
    await policyClient.query("INSERT INTO public.dependency_analysis_policy_relationships(policy_id,policy_version,relationship) VALUES($1,$2,$3)", [POLICY_ID, 1, "quotes"]);
    await policyClient.query("SET CONSTRAINTS ALL IMMEDIATE"); await policyClient.query("COMMIT");
  } catch (error) { await policyClient.query("ROLLBACK").catch(() => {}); throw error; } finally { policyClient.release(); }
  const built = buildRcv017ClaimEvidenceDependencyAnalysis({ claimVersionId: CLAIM_VERSION_ID, evidenceRelations: relations, selectedBindings: bindings, provenanceSnapshot: { snapshotId: SNAPSHOT_ID, builderResult: snap }, dependencyAnalysisPolicy: { definition: policyDefinition, canonical: policyCanonical, hash: policyHash }, algorithmIdentity: { algorithmId: "factbase-claim-evidence-dependency-algorithm", algorithmVersion: "1", algorithmArtifactHash: ALGORITHM_HASH } });
  const findingTypes = new Set(built.analysis.findings.map((finding) => finding.type));
  for (const type of ["RECORDED_SHARED_ARTIFACT_VERSION", "RECORDED_COMMON_UPSTREAM", "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE", "DEPENDENCY_KNOWLEDGE_INCOMPLETE"]) assert.ok(findingTypes.has(type), `missing ${type}`);
  assert.ok(built.projection.commonUpstreamWitnessSteps.length > 0);
  assert.ok(built.projection.sharedArtifactMembers.length > 0);
  assert.ok(built.projection.commonUpstreamMembers.length > 0);
  assert.ok(built.projection.knowledgeAffectedArtifacts.length > 0);
  assert.ok(built.projection.knowledgeStateEvidence.length > 0);
  assert.ok(built.projection.derivedUnrecordedEvidence.length > 0);
  const verified = verifyRcv017AnalysisForWrite({ builderResult: built, provenanceSnapshotIdentity: { snapshotId: SNAPSHOT_ID, snapshotHash: snapshotWrite.snapshotHash }, dependencyAnalysisPolicyIdentity: { policyId: POLICY_ID, policyVersion: 1, policyHash }, analysisIdFactory: () => ANALYSIS_ID });
  await new Rcv017PostgresAnalysisRepository(pool).persistAnalysis(verified);
  const counts = { evidenceRelations: relations.length, bindings: bindings.length, sharedArtifactFindings: built.projection.sharedArtifactFindings.length, sharedArtifactMembers: built.projection.sharedArtifactMembers.length, commonUpstreamFindings: built.projection.commonUpstreamFindings.length, commonUpstreamMembers: built.projection.commonUpstreamMembers.length, noCommonUpstreamFindings: built.projection.noCommonUpstreamFindings.length, knowledgeIncompleteFindings: built.projection.knowledgeIncompleteFindings.length, knowledgeAffectedArtifacts: built.projection.knowledgeAffectedArtifacts.length, witnessSteps: built.projection.commonUpstreamWitnessSteps.length, knowledgeStateEvidence: built.projection.knowledgeStateEvidence.length, derivedUnrecordedEvidence: built.projection.derivedUnrecordedEvidence.length };
  process.stdout.write(JSON.stringify({ database: DB, snapshotId: SNAPSHOT_ID, snapshotHash: snapshotWrite.snapshotHash, policyId: POLICY_ID, policyHash, analysisId: ANALYSIS_ID, analysisHash: verified.analysisHash, ...counts, status: "PASS" }) + "\n");
}

main().catch((error) => { process.stderr.write(`${error.name || "Error"}: ${error.message}\n`); process.exitCode = 1; }).finally(() => pool.end());
