const { canonicalizeRcv016, sha256Rcv016Text } = require('../../dist/services/rcv016Canonical');
const { canonicalizeRcv018 } = require('../../dist/services/rcv018Canonical');
const { buildRcv016ProvenanceSnapshot } = require('../../dist/services/rcv016SnapshotBuilder');
const { Rcv016PostgresSnapshotRepository } = require('../../dist/services/rcv016PostgresRepository');
const { writeRcv016Snapshot } = require('../../dist/services/rcv016WriteVerifier');
const { buildRcv017ClaimEvidenceDependencyAnalysis } = require('../../dist/services/rcv017AnalysisBuilder');
const { verifyRcv017AnalysisForWrite } = require('../../dist/services/rcv017WriteVerifier');
const { Rcv017PostgresAnalysisRepository } = require('../../dist/services/rcv017PostgresRepository');
const { buildRcv018Analysis } = require('../../dist/services/rcv018AnalysisBuilder');
const { verifyRcv018Write } = require('../../dist/services/rcv018WriteVerifier');
const { persistRcv018Analysis } = require('../../dist/services/rcv018PostgresRepository');

const TS = '2026-01-02T03:04:05.000000Z';
const EMPTY = '{}';
const EMPTY_HASH = sha256Rcv016Text(EMPTY);
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const IDS = Object.freeze({
  claim: id(101), claimVersion: id(102), artifact: id(201), artifactVersion: id(202),
  evidence: id(301), statement: id(302), snapshot: id(501),
  valueDomain: id(601), comparisonDomain: id(602), subject: id(703), property: id(704),
  assertionA: id(701), assertionB: id(702), analysis: id(705),
  relation: id(403), rcv017Analysis: id(402), rcv017Policy: id(401),
});

function payloadLimits() {
  const value = { limitsId: 'factbase-fixture-limits', limitsVersion: '1' };
  for (const key of ['sourceMetadataCanonicalBytes','sourceLocatorCount','displayNameCodepoints','displayNameUtf8Bytes','locatorStringCodepoints','locatorStringUtf8Bytes','artifactCaptureCanonicalBytes','artifactLocatorCodepoints','artifactLocatorUtf8Bytes','mediaTypeCodepoints','mediaTypeUtf8Bytes','titleCodepoints','titleUtf8Bytes','rationaleCodepoints','rationaleUtf8Bytes','foundationCanonicalBytes','foundationItemCount','foundationInputReferenceCount','foundationReferenceCodepoints','foundationReferenceUtf8Bytes']) value[key] = 10000;
  const c = canonicalizeRcv016(value);
  return { ...value, definitionCanonical: c.canonical, definitionHash: c.hash };
}

function traversalPolicy() {
  const value = { policyId: 'rcv018-r2b-traversal', policyVersion: '1', maxRoots: 10, maxNodes: 20, maxEdges: 20, maxDepth: 4, maxCanonicalSnapshotBytes: 1000000, allowedRelationships: ['cites','derived_from','incorporates','quotes','reposts','syndicated_from','uses_information_from'], deterministicOrdering: 'schema_category_then_canonical_key_lexicographic_v1', visitedSemantics: 'expand_node_once_include_statement_once_diagnose_cycles_v1' };
  const c = canonicalizeRcv016(value);
  return { ...value, definitionCanonical: c.canonical, definitionHash: c.hash };
}

function snapshotInput() {
  const capture = { schema: { id: 'factbase-artifact-version-capture', version: '1' }, locator: null, mediaType: null, title: null, publishedAt: null, observedAt: TS, retrievedAt: null, representation: { kind: 'metadata_only', hashAlgorithm: null, contentHash: null } };
  const captureEncoded = canonicalizeRcv016(capture);
  return {
    snapshotIdentity: { snapshotSchemaId: 'factbase-provenance-snapshot', snapshotSchemaVersion: '1', canonicalizationId: 'jcs-rfc8785', canonicalizationVersion: '1', hashAlgorithm: 'sha-256' },
    builderIdentity: { builderId: 'factbase-provenance-snapshot-builder', builderVersion: '1', builderArtifactHash: 'a'.repeat(64) },
    traversalPolicy: traversalPolicy(), roots: [IDS.artifactVersion],
    artifactVersions: [{ artifactVersionId: IDS.artifactVersion, artifactId: IDS.artifact, versionNumber: 1, captureSchemaId: 'factbase-artifact-version-capture', captureSchemaVersion: '1', captureCanonical: captureEncoded.canonical, captureHash: captureEncoded.hash, createdAt: TS }],
    sourceVersions: [], artifactProvenanceStatements: [], sourceRelationshipStatements: [], artifactSourceAttributions: [], knowledgeStateStatements: [],
    evidenceArtifactBindings: [{ family: 'EvidenceArtifactBinding', statementId: IDS.statement, observedAt: TS, validFrom: null, validTo: null, initiator: null, rationale: null, foundation: null, supersedesStatementId: null, createdAt: TS, subjectEvidenceId: IDS.evidence, relationship: 'bound_to', objectArtifactVersionId: IDS.artifactVersion }],
  };
}

function rcv017Policy() {
  const definition = { schemaId: 'factbase-dependency-analysis-policy', schemaVersion: '1', policyId: IDS.rcv017Policy, policyVersion: 1, relationshipClassificationCatalogId: 'factbase-dependency-relationship-classification', relationshipClassificationCatalogVersion: '1', enabledDependencyRelationships: ['quotes'], evidenceDirectionPartitionRule: 'supports_and_contradicts_separate_contextualizes_excluded', reflexiveClosureRule: 'anchor_depth_zero_then_enabled_dependency_edges_minimum_distance', commonUpstreamRule: 'same_exact_artifact_version_in_two_or_more_reflexive_branch_closures', negativeFindingRule: 'unordered_same_direction_pair_with_disjoint_reflexive_closures', knowledgeLimitationRule: 'snapshot_unknown_partial_or_derived_unrecorded_in_reached_set', witnessSelectionRule: 'fewest_edges_then_ascii_statement_id_sequence', findingVocabularyRule: 'rcv017_closed_four_finding_vocabulary_v1', cycleHandlingRule: 'expand_once_per_branch_at_minimum_distance', deterministicOrderingRule: 'rcv017_explicit_total_order_v1', maxEvidenceRelations: 20, maxBindings: 20, maxArtifactVersions: 100, maxStatements: 100, maxDependencyDepth: 10, maxFindings: 100, maxCanonicalBytes: 1000000, canonicalizationId: 'jcs-rfc8785', canonicalizationVersion: '1', hashAlgorithm: 'sha-256' };
  const c = canonicalizeRcv016(definition);
  return { definition, canonical: c.canonical, hash: c.hash };
}

async function insert(client, sql, values) { await client.query(sql, values); }

// Sole transaction owner for fixture materialization. Child routines receive the
// client and are forbidden from acquiring connections or controlling transactions.
async function withAtomicFixtureTransaction(client, insertAll) {
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    await insertAll(client);
    await client.query('COMMIT');
    began = false;
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function insertRoots(client) {
  const limits = payloadLimits(); const policy = traversalPolicy();
  await insert(client, 'INSERT INTO claims(id) VALUES($1)', [IDS.claim]);
  await insert(client, "INSERT INTO claim_versions(id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at) VALUES($1,$2,1,'fixture','fixture','en','fact','active','published','fixture',$3)", [IDS.claimVersion, IDS.claim, TS]);
  await insert(client, 'INSERT INTO evidence(id,retrieved_at,created_at) VALUES($1,$2,$2)', [IDS.evidence, TS]);
  await insert(client, "INSERT INTO claim_version_evidence(id,claim_version_id,evidence_id,relation,created_at) VALUES($1,$2,$3,'supports',$4)", [IDS.relation, IDS.claimVersion, IDS.evidence, TS]);
  await insert(client, "INSERT INTO provenance_payload_limits(limits_id,limits_version,schema_id,schema_version,source_metadata_canonical_bytes,source_locator_count,display_name_codepoints,display_name_utf8_bytes,locator_string_codepoints,locator_string_utf8_bytes,artifact_capture_canonical_bytes,artifact_locator_codepoints,artifact_locator_utf8_bytes,media_type_codepoints,media_type_utf8_bytes,title_codepoints,title_utf8_bytes,rationale_codepoints,rationale_utf8_bytes,foundation_canonical_bytes,foundation_item_count,foundation_input_reference_count,foundation_reference_codepoints,foundation_reference_utf8_bytes,definition_canonical,definition_hash) VALUES($1,'1','factbase-provenance-payload-limits','1',10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,$2,$3)", [limits.limitsId, limits.definitionCanonical, limits.definitionHash]);
  await insert(client, "INSERT INTO provenance_traversal_policies(policy_id,policy_version,schema_id,schema_version,definition_canonical,definition_hash,max_roots,max_nodes,max_edges,max_depth,max_canonical_snapshot_bytes,allowed_relationships,deterministic_ordering,visited_semantics) VALUES($1,$2,'factbase-provenance-traversal-policy','1',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [policy.policyId, policy.policyVersion, policy.definitionCanonical, policy.definitionHash, policy.maxRoots, policy.maxNodes, policy.maxEdges, policy.maxDepth, policy.maxCanonicalSnapshotBytes, policy.allowedRelationships, policy.deterministicOrdering, policy.visitedSemantics]);
  await insert(client, 'INSERT INTO provenance_artifacts(id) VALUES($1)', [IDS.artifact]);
  await insert(client, "INSERT INTO provenance_artifact_versions(id,artifact_id,version_number,capture_schema_id,capture_schema_version,capture_canonical,capture_hash,payload_limits_id,payload_limits_version,created_at) VALUES($1,$2,1,'factbase-artifact-version-capture','1',$3,$4,$5,'1',$6)", [IDS.artifactVersion, IDS.artifact, EMPTY, EMPTY_HASH, limits.limitsId, TS]);
  await insert(client, "INSERT INTO evidence_artifact_bindings(id,evidence_id,artifact_version_id,observed_at,payload_limits_id,payload_limits_version) VALUES($1,$2,$3,$4,$5,'1')", [IDS.statement, IDS.evidence, IDS.artifactVersion, TS, limits.limitsId]);
}

const BASELINE_PHASE_ROWS = Object.freeze({
  roots: Object.freeze(['CLM-1','CV-1','PL-1','PA-1','AV-1','E-1','S-1']),
  rcv016: Object.freeze(['TRAVERSAL-POLICY-016','SNAP-016-1','SNAP-AV-1','SNAP-S-1']),
  rcv017: Object.freeze(['CVE-017-1','DAP-017-1','DAPR-017-1','RCA-017-1','DAR-017-1','DAB-017-1','KIF-017-1','KAA-017-1','DUE-017-1']),
  rcv018: Object.freeze(['VD-1','VDV-A','VDV-B','CD-1','IP-1','ASSERTION-A','ASSERTION-B','EB-A','EB-B','HB-A-CLAIM','HB-A-STATEMENT','HB-A-ARTIFACT','HB-A-RCV016','HB-A-RCV017','HB-B-CLAIM','HB-B-STATEMENT','HB-B-ARTIFACT','HB-B-RCV016','HB-B-RCV017','FINDING-1','RCA-018-1','AA-A','AA-B','AVD-1','ACD-1','AF-1']),
});

async function insertFixturePhase(client, labels) {
  for (const label of labels) await client.query('SELECT $1::text AS fixture_row', [label]);
}
async function insertFixtureRoots(client, fixture = {}) {
  const limits = payloadLimits();
  const ts = TS;
  // Fixture-only: preserve the frozen historical timestamp instead of the
  // migration trigger's transaction_timestamp() projection.
  await client.query("SET LOCAL session_replication_role = 'replica'");
  await insert(client, 'INSERT INTO claims (id) VALUES ($1)', [IDS.claim]);
  await insert(client, 'INSERT INTO claim_versions (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [IDS.claimVersion, IDS.claim, 1, 'RCV018 fixture claim', 'Fixture statement', 'en', 'fact', 'draft', 'unpublished', 'fixture', ts]);
  await insert(client, 'INSERT INTO provenance_payload_limits (limits_id,limits_version,schema_id,schema_version,source_metadata_canonical_bytes,source_locator_count,display_name_codepoints,display_name_utf8_bytes,locator_string_codepoints,locator_string_utf8_bytes,artifact_capture_canonical_bytes,artifact_locator_codepoints,artifact_locator_utf8_bytes,media_type_codepoints,media_type_utf8_bytes,title_codepoints,title_utf8_bytes,rationale_codepoints,rationale_utf8_bytes,foundation_canonical_bytes,foundation_item_count,foundation_input_reference_count,foundation_reference_codepoints,foundation_reference_utf8_bytes,definition_canonical,definition_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)', [limits.limitsId, limits.limitsVersion, 'factbase-provenance-payload-limits', '1', 10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000, limits.definitionCanonical, limits.definitionHash, ts]);
  await insert(client, 'INSERT INTO provenance_artifacts (id,created_at) VALUES ($1,$2)', [IDS.artifact, ts]);
  const capture = { schema: { id: 'factbase-artifact-version-capture', version: '1' }, locator: null, mediaType: null, title: null, publishedAt: null, observedAt: ts, retrievedAt: null, representation: { kind: 'metadata_only', hashAlgorithm: null, contentHash: null } };
  const captureEncoded = canonicalizeRcv016(capture);
  await insert(client, 'INSERT INTO provenance_artifact_versions (id,artifact_id,version_number,capture_schema_id,capture_schema_version,capture_canonical,capture_hash,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [IDS.artifactVersion, IDS.artifact, 1, capture.schema.id, capture.schema.version, captureEncoded.canonical, captureEncoded.hash, limits.limitsId, limits.limitsVersion, ts]);
  await insert(client, 'INSERT INTO evidence (id,source_url,source_title,source_type,locator,quoted_text,snapshot_hash,retrieved_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [IDS.evidence, null, null, null, null, null, null, ts, ts]);
  await insert(client, 'INSERT INTO evidence_artifact_bindings (id,evidence_id,artifact_version_id,observed_at,valid_from,valid_to,initiator_type,initiator_id,rationale,foundation_schema_id,foundation_schema_version,foundation_canonical,foundation_hash,supersedes_statement_id,payload_limits_id,payload_limits_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)', [IDS.statement, IDS.evidence, IDS.artifactVersion, ts, null, null, null, null, null, null, null, null, null, null, limits.limitsId, limits.limitsVersion, ts]);
}
async function insertFixtureRcv016(client, fixture = {}) {
  const policy = traversalPolicy();
  const snapshot = buildRcv016ProvenanceSnapshot(snapshotInput());
  fixture.rcv016Derived = { policy, snapshot };
  await insert(client, 'INSERT INTO provenance_traversal_policies (policy_id,policy_version,schema_id,schema_version,definition_canonical,definition_hash,max_roots,max_nodes,max_edges,max_depth,max_canonical_snapshot_bytes,allowed_relationships,deterministic_ordering,visited_semantics,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [policy.policyId, policy.policyVersion, 'factbase-provenance-traversal-policy', '1', policy.definitionCanonical, policy.definitionHash, policy.maxRoots, policy.maxNodes, policy.maxEdges, policy.maxDepth, policy.maxCanonicalSnapshotBytes, policy.allowedRelationships, policy.deterministicOrdering, policy.visitedSemantics, TS]);
  const s = snapshot.snapshot;
  await insert(client, 'INSERT INTO provenance_snapshots (id,snapshot_schema_id,snapshot_schema_version,builder_id,builder_version,builder_artifact_hash,canonicalization_id,canonicalization_version,hash_algorithm,policy_id,policy_version,definition_hash,max_roots,max_nodes,max_edges,max_depth,max_canonical_snapshot_bytes,allowed_relationships,deterministic_ordering,visited_semantics,snapshot_canonical,snapshot_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)', [IDS.snapshot, s.snapshotSchemaId, s.snapshotSchemaVersion, s.builderId, s.builderVersion, s.builderArtifactHash, s.canonicalizationId, s.canonicalizationVersion, s.hashAlgorithm, s.policyId, s.policyVersion, s.definitionHash, s.maxRoots, s.maxNodes, s.maxEdges, s.maxDepth, s.maxCanonicalSnapshotBytes, s.allowedRelationships, s.deterministicOrdering, s.visitedSemantics, snapshot.canonical, snapshot.hash, TS]);
  await insert(client, 'INSERT INTO provenance_snapshot_artifact_versions (snapshot_id,artifact_version_id,membership_role,created_at) VALUES ($1,$2,$3,$4)', [IDS.snapshot, IDS.artifactVersion, 'root', TS]);
  await insert(client, 'INSERT INTO provenance_snapshot_evidence_artifact_bindings (snapshot_id,evidence_artifact_binding_id,created_at) VALUES ($1,$2,$3)', [IDS.snapshot, IDS.statement, TS]);
}
async function insertFixtureRcv017(client, fixture = {}) {
  const snapshot = fixture.rcv016Derived?.snapshot || buildRcv016ProvenanceSnapshot(snapshotInput());
  const policy = rcv017Policy();
  const input = {
    claimVersionId: IDS.claimVersion,
    evidenceRelations: [{ claimVersionEvidenceRelationId: IDS.relation, evidenceId: IDS.evidence, direction: 'supports' }],
    selectedBindings: [{ claimVersionEvidenceRelationId: IDS.relation, evidenceArtifactBindingStatementId: IDS.statement, evidenceId: IDS.evidence, artifactVersionId: IDS.artifactVersion }],
    provenanceSnapshot: { snapshotId: IDS.snapshot, builderResult: snapshot },
    dependencyAnalysisPolicy: policy,
    algorithmIdentity: { algorithmId: 'factbase-claim-evidence-dependency-algorithm', algorithmVersion: '1', algorithmArtifactHash: 'b'.repeat(64) },
  };
  const built = buildRcv017ClaimEvidenceDependencyAnalysis(input);
  if (built.analysis.findings.length !== 1 || built.analysis.findings[0].type !== 'DEPENDENCY_KNOWLEDGE_INCOMPLETE') throw new Error('unexpected RCV017 replay');
  const verified = verifyRcv017AnalysisForWrite({ builderResult: built, provenanceSnapshotIdentity: { snapshotId: IDS.snapshot, snapshotHash: snapshot.hash }, dependencyAnalysisPolicyIdentity: { policyId: policy.definition.policyId, policyVersion: policy.definition.policyVersion, policyHash: policy.hash }, analysisIdFactory: () => IDS.rcv017Analysis });
  fixture.rcv017Derived = { policy, snapshot, verified };
  const p = verified.projection;
  const h = p.policyHeader;
  const d = policy.definition;
  await insert(client, 'INSERT INTO claim_version_evidence (id,claim_version_id,evidence_id,relation,created_at) VALUES ($1,$2,$3,$4,$5)', [IDS.relation, IDS.claimVersion, IDS.evidence, 'supports', TS]);
  await insert(client, 'INSERT INTO dependency_analysis_policies (policy_id,policy_version,schema_id,schema_version,relationship_classification_catalog_id,relationship_classification_catalog_version,evidence_direction_partition_rule,reflexive_closure_rule,common_upstream_rule,negative_finding_rule,knowledge_limitation_rule,witness_selection_rule,finding_vocabulary_rule,cycle_handling_rule,deterministic_ordering_rule,max_evidence_relations,max_bindings,max_artifact_versions,max_statements,max_dependency_depth,max_findings,max_canonical_bytes,canonicalization_id,canonicalization_version,hash_algorithm,definition_canonical,definition_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)', [d.policyId,d.policyVersion,d.schemaId,d.schemaVersion,d.relationshipClassificationCatalogId,d.relationshipClassificationCatalogVersion,d.evidenceDirectionPartitionRule,d.reflexiveClosureRule,d.commonUpstreamRule,d.negativeFindingRule,d.knowledgeLimitationRule,d.witnessSelectionRule,d.findingVocabularyRule,d.cycleHandlingRule,d.deterministicOrderingRule,d.maxEvidenceRelations,d.maxBindings,d.maxArtifactVersions,d.maxStatements,d.maxDependencyDepth,d.maxFindings,d.maxCanonicalBytes,d.canonicalizationId,d.canonicalizationVersion,d.hashAlgorithm,p.policyHeader.definitionCanonical,p.policyHeader.definitionHash]);
  await insert(client, 'INSERT INTO dependency_analysis_policy_relationships (policy_id,policy_version,relationship) VALUES ($1,$2,$3)', [d.policyId,d.policyVersion,'quotes']);
  const a = p.analysisHeader;
  await insert(client, 'INSERT INTO claim_evidence_dependency_analyses (analysis_id,analysis_schema_id,analysis_schema_version,claim_version_id,provenance_snapshot_id,provenance_snapshot_hash,dependency_analysis_policy_id,dependency_analysis_policy_version,dependency_analysis_policy_hash,algorithm_id,algorithm_version,algorithm_artifact_hash,canonicalization_id,canonicalization_version,hash_algorithm,analysis_canonical,analysis_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)', [IDS.rcv017Analysis,a.analysisSchemaId,a.analysisSchemaVersion,a.claimVersionId,a.provenanceSnapshotId,a.provenanceSnapshotHash,a.dependencyAnalysisPolicyId,a.dependencyAnalysisPolicyVersion,a.dependencyAnalysisPolicyHash,a.algorithmId,a.algorithmVersion,a.algorithmArtifactHash,a.canonicalizationId,a.canonicalizationVersion,a.hashAlgorithm,a.analysisCanonical,a.analysisHash]);
  await insert(client, 'INSERT INTO dependency_analysis_evidence_relations (analysis_id,claim_version_evidence_relation_id,evidence_id,direction) VALUES ($1,$2,$3,$4)', [IDS.rcv017Analysis,IDS.relation,IDS.evidence,'supports']);
  await insert(client, 'INSERT INTO dependency_analysis_bindings (analysis_id,provenance_snapshot_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,evidence_id,artifact_version_id) VALUES ($1,$2,$3,$4,$5,$6)', [IDS.rcv017Analysis,IDS.snapshot,IDS.relation,IDS.statement,IDS.evidence,IDS.artifactVersion]);
  for (const row of p.knowledgeIncompleteFindings) await insert(client, 'INSERT INTO dependency_analysis_knowledge_incomplete_findings (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id) VALUES ($1,$2,$3)', [IDS.rcv017Analysis,row.claimVersionEvidenceRelationId,row.evidenceArtifactBindingStatementId]);
  for (const row of p.knowledgeAffectedArtifacts) await insert(client, 'INSERT INTO dependency_analysis_knowledge_affected_artifacts (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,artifact_version_id) VALUES ($1,$2,$3,$4)', [IDS.rcv017Analysis,row.claimVersionEvidenceRelationId,row.evidenceArtifactBindingStatementId,row.artifactVersionId]);
  for (const row of p.derivedUnrecordedEvidence) await insert(client, 'INSERT INTO dependency_analysis_derived_unrecorded_evidence (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,artifact_version_id) VALUES ($1,$2,$3,$4)', [IDS.rcv017Analysis,row.claimVersionEvidenceRelationId,row.evidenceArtifactBindingStatementId,row.artifactVersionId]);
}
async function insertFixtureRcv018(client, fixture = {}) {
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const vd = { valueDomainId: IDS.valueDomain, valueDomainVersion: 1, kind: 'CLOSED_SYMBOLIC_STATE', allowedValues: ['A', 'B'] };
  const vi = canonicalizeRcv018(vd);
  const cd = { comparisonDomainId: IDS.comparisonDomain, comparisonDomainVersion: 1, propertyId: IDS.property, valueDomainId: IDS.valueDomain, valueDomainVersion: 1, valueDomainHash: vi.hash, comparisonKeySchema: [], ruleFamily: 'EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR', incompatibilityPairs: [['A', 'B']] };
  const ci = canonicalizeRcv018(cd);
  const bindings = [
    { kind: 'ARTIFACT_VERSION', artifactVersionId: IDS.artifactVersion },
    { kind: 'CLAIM_VERSION', claimVersionId: IDS.claimVersion },
    { kind: 'RCV016_SNAPSHOT', snapshotId: IDS.snapshot, snapshotHash: fixture.rcv016Derived?.snapshot?.hash || '1d14881039399ac3ea7ffb63708dd07da8352a82eb31a8708e2493a6eb10230b' },
    { kind: 'RCV017_ANALYSIS', analysisId: IDS.rcv017Analysis, analysisHash: fixture.rcv017Derived?.verified?.analysisHash || '92eb334dc90a81d8b2cb13baea1b0c6348f309c98f301b69c07dacc0007ba164' },
    { kind: 'STATEMENT', statementKind: 'EvidenceArtifactBinding', statementId: IDS.statement },
  ];
  const makeAssertion = (assertionId, value) => ({ assertionId, subjectId: IDS.subject, propertyId: IDS.property, comparisonDomainId: IDS.comparisonDomain, comparisonDomainVersion: 1, comparisonDomainHash: ci.hash, valueDomainId: IDS.valueDomain, valueDomainVersion: 1, valueDomainHash: vi.hash, value, comparisonContext: [], evidenceBasis: [{ evidenceRelationId: IDS.relation, evidenceId: IDS.evidence, artifactVersionId: IDS.artifactVersion, statementKind: 'EvidenceArtifactBinding', statementId: IDS.statement }], historicalBindings: bindings });
  const assertions = [makeAssertion(IDS.assertionA, 'A'), makeAssertion(IDS.assertionB, 'B')].map((value) => ({ value, ...canonicalizeRcv018(value) }));
  const input = { analysisId: IDS.analysis, assertions, valueDomains: [{ value: vd, ...vi }], comparisonDomains: [{ value: cd, ...ci }], contractBinding: { contractId: 'factbase-rcv018-contract', contractVersion: 1, contractHash: 'c'.repeat(64) }, algorithmBinding: { algorithmId: 'factbase-rcv018-algorithm', algorithmVersion: 1, algorithmHash: 'd'.repeat(64) } };
  const built = buildRcv018Analysis(input);
  const projection = verifyRcv018Write({ builderInput: input, builderResult: built, existingFindings: [] });
  fixture.rcv018Derived = { built, projection, valueDomain: vi, comparisonDomain: ci };
  await insert(client, 'INSERT INTO rcv018_value_domains (value_domain_id,value_domain_version,kind,canonical,value_domain_hash) VALUES ($1,$2,$3,$4,$5)', [IDS.valueDomain, 1, vd.kind, vi.canonical, vi.hash]);
  await insert(client, 'INSERT INTO rcv018_value_domain_values (value_domain_id,value_domain_version,ordinal,value) VALUES ($1,$2,$3,$4)', [IDS.valueDomain, 1, 0, 'A']);
  await insert(client, 'INSERT INTO rcv018_value_domain_values (value_domain_id,value_domain_version,ordinal,value) VALUES ($1,$2,$3,$4)', [IDS.valueDomain, 1, 1, 'B']);
  await insert(client, 'INSERT INTO rcv018_comparison_domains (comparison_domain_id,comparison_domain_version,property_id,value_domain_id,value_domain_version,value_domain_hash,rule_family,canonical,comparison_domain_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [IDS.comparisonDomain, 1, IDS.property, IDS.valueDomain, 1, vi.hash, cd.ruleFamily, ci.canonical, ci.hash]);
  await insert(client, 'INSERT INTO rcv018_incompatibility_pairs (comparison_domain_id,comparison_domain_version,ordinal,left_value,right_value) VALUES ($1,$2,$3,$4,$5)', [IDS.comparisonDomain, 1, 0, 'A', 'B']);
  for (const assertion of assertions) {
    const a = assertion.value;
    await insert(client, 'INSERT INTO rcv018_evidence_assertions (assertion_id,subject_id,property_id,comparison_domain_id,comparison_domain_version,comparison_domain_hash,value_domain_id,value_domain_version,value_domain_hash,value,canonical,assertion_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [a.assertionId,a.subjectId,a.propertyId,a.comparisonDomainId,a.comparisonDomainVersion,a.comparisonDomainHash,a.valueDomainId,a.valueDomainVersion,a.valueDomainHash,a.value,assertion.canonical,assertion.hash]);
    await insert(client, 'INSERT INTO rcv018_assertion_evidence_basis (assertion_id,ordinal,evidence_relation_id,evidence_id,artifact_version_id,statement_kind,statement_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [a.assertionId,0,IDS.relation,IDS.evidence,IDS.artifactVersion,'EvidenceArtifactBinding',IDS.statement]);
    for (const [ordinal, binding] of bindings.entries()) await insert(client, 'INSERT INTO rcv018_assertion_historical_bindings (assertion_id,ordinal,kind,claim_version_id,statement_kind,statement_id,artifact_version_id,rcv016_snapshot_id,rcv016_snapshot_hash,rcv017_analysis_id,rcv017_analysis_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [a.assertionId,ordinal,binding.kind,binding.claimVersionId || null,binding.statementKind || null,binding.statementId || null,binding.artifactVersionId || null,binding.snapshotId || null,binding.snapshotHash || null,binding.analysisId || null,binding.analysisHash || null]);
  }
  for (const finding of projection.findingsToInsertAuthenticated) {
    const f = finding.value;
    await insert(client, 'INSERT INTO rcv018_contradiction_findings (finding_hash,assertion_a_id,assertion_a_hash,assertion_b_id,assertion_b_hash,comparison_domain_id,comparison_domain_version,comparison_domain_hash,incompatibility_left,incompatibility_right,canonical) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [finding.hash,f.assertionAId,f.assertionAHash,f.assertionBId,f.assertionBHash,f.comparisonDomainId,f.comparisonDomainVersion,f.comparisonDomainHash,f.incompatibilityLeft,f.incompatibilityRight,finding.canonical]);
  }
  const ah = projection.analysis;
  await insert(client, 'INSERT INTO rcv018_analyses (analysis_id,contract_id,contract_version,contract_hash,algorithm_id,algorithm_version,algorithm_hash,canonical,analysis_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [IDS.analysis,ah.contractBinding.contractId,ah.contractBinding.contractVersion,ah.contractBinding.contractHash,ah.algorithmBinding.algorithmId,ah.algorithmBinding.algorithmVersion,ah.algorithmBinding.algorithmHash,projection.analysisCanonical,projection.analysisHash]);
  await insert(client, 'INSERT INTO rcv018_analysis_assertions (analysis_id,ordinal,assertion_id,assertion_hash) VALUES ($1,$2,$3,$4)', [IDS.analysis,0,IDS.assertionA,assertions[0].hash]);
  await insert(client, 'INSERT INTO rcv018_analysis_assertions (analysis_id,ordinal,assertion_id,assertion_hash) VALUES ($1,$2,$3,$4)', [IDS.analysis,1,IDS.assertionB,assertions[1].hash]);
  await insert(client, 'INSERT INTO rcv018_analysis_value_domains (analysis_id,ordinal,value_domain_id,value_domain_version,value_domain_hash) VALUES ($1,$2,$3,$4,$5)', [IDS.analysis,0,IDS.valueDomain,1,vi.hash]);
  await insert(client, 'INSERT INTO rcv018_analysis_comparison_domains (analysis_id,ordinal,comparison_domain_id,comparison_domain_version,comparison_domain_hash) VALUES ($1,$2,$3,$4,$5)', [IDS.analysis,0,IDS.comparisonDomain,1,ci.hash]);
  await insert(client, 'INSERT INTO rcv018_analysis_findings (analysis_id,ordinal,finding_hash) VALUES ($1,$2,$3)', [IDS.analysis,0,projection.findingHashes[0]]);
}

async function materializeHistoricalFixture(pool, fixture = {}) {
  const client = await pool.connect();
  try {
    return await withAtomicFixtureTransaction(client, async (sameClient) => {
      if (typeof fixture === 'function') return fixture(sameClient);
      await insertFixtureRoots(sameClient, fixture);
      await insertFixtureRcv016(sameClient, fixture);
      await insertFixtureRcv017(sameClient, fixture);
      await insertFixtureRcv018(sameClient, fixture);
    });
  } finally { client.release(); }
}

async function materialize(pool) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await insertRoots(client); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  const snapshot = buildRcv016ProvenanceSnapshot(snapshotInput());
  const snapshotWrite = await writeRcv016Snapshot({ builderResult: snapshot, snapshotIdFactory: () => IDS.snapshot, repository: new Rcv016PostgresSnapshotRepository(pool) });
  const policy = rcv017Policy();
  const pc = await pool.connect();
  try { await pc.query('BEGIN'); const d = policy.definition; await pc.query('INSERT INTO dependency_analysis_policies(policy_id,policy_version,schema_id,schema_version,relationship_classification_catalog_id,relationship_classification_catalog_version,evidence_direction_partition_rule,reflexive_closure_rule,common_upstream_rule,negative_finding_rule,knowledge_limitation_rule,witness_selection_rule,finding_vocabulary_rule,cycle_handling_rule,deterministic_ordering_rule,max_evidence_relations,max_bindings,max_artifact_versions,max_statements,max_dependency_depth,max_findings,max_canonical_bytes,canonicalization_id,canonicalization_version,hash_algorithm,definition_canonical,definition_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)', [d.policyId,d.policyVersion,d.schemaId,d.schemaVersion,d.relationshipClassificationCatalogId,d.relationshipClassificationCatalogVersion,d.evidenceDirectionPartitionRule,d.reflexiveClosureRule,d.commonUpstreamRule,d.negativeFindingRule,d.knowledgeLimitationRule,d.witnessSelectionRule,d.findingVocabularyRule,d.cycleHandlingRule,d.deterministicOrderingRule,d.maxEvidenceRelations,d.maxBindings,d.maxArtifactVersions,d.maxStatements,d.maxDependencyDepth,d.maxFindings,d.maxCanonicalBytes,d.canonicalizationId,d.canonicalizationVersion,d.hashAlgorithm,policy.canonical,policy.hash]); await pc.query('INSERT INTO dependency_analysis_policy_relationships(policy_id,policy_version,relationship) VALUES($1,$2,$3)', [d.policyId,d.policyVersion,'quotes']); await pc.query('COMMIT'); } catch (error) { await pc.query('ROLLBACK').catch(() => {}); throw error; } finally { pc.release(); }
  const built = buildRcv017ClaimEvidenceDependencyAnalysis({ claimVersionId: IDS.claimVersion, evidenceRelations: [{ claimVersionEvidenceRelationId: IDS.relation, evidenceId: IDS.evidence, direction: 'supports' }], selectedBindings: [{ claimVersionEvidenceRelationId: IDS.relation, evidenceArtifactBindingStatementId: IDS.statement, evidenceId: IDS.evidence, artifactVersionId: IDS.artifactVersion }], provenanceSnapshot: { snapshotId: IDS.snapshot, builderResult: snapshot }, dependencyAnalysisPolicy: policy, algorithmIdentity: { algorithmId: 'factbase-claim-evidence-dependency-algorithm', algorithmVersion: '1', algorithmArtifactHash: 'b'.repeat(64) } });
  if (built.analysis.findings.length !== 1 || built.analysis.findings[0].type !== 'DEPENDENCY_KNOWLEDGE_INCOMPLETE') throw new Error('unexpected RCV017 replay');
  const verified = verifyRcv017AnalysisForWrite({ builderResult: built, provenanceSnapshotIdentity: { snapshotId: IDS.snapshot, snapshotHash: snapshotWrite.snapshotHash }, dependencyAnalysisPolicyIdentity: { policyId: policy.definition.policyId, policyVersion: 1, policyHash: policy.hash }, analysisIdFactory: () => IDS.rcv017Analysis });
  await new Rcv017PostgresAnalysisRepository(pool).persistAnalysis(verified);
  return { snapshot, snapshotWrite, rcv017: verified };
}

async function materializeRcv018(pool, historical) {
  const vd = { valueDomainId: IDS.valueDomain, valueDomainVersion: 1, kind: 'CLOSED_SYMBOLIC_STATE', allowedValues: ['A', 'B'] };
  const vi = canonicalizeRcv018(vd);
  const cd = { comparisonDomainId: IDS.comparisonDomain, comparisonDomainVersion: 1, propertyId: id(704), valueDomainId: IDS.valueDomain, valueDomainVersion: 1, valueDomainHash: vi.hash, comparisonKeySchema: [], ruleFamily: 'EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR', incompatibilityPairs: [['A', 'B']] };
  const ci = canonicalizeRcv018(cd);
  const a = (assertionId, value) => ({ assertionId, subjectId: id(703), propertyId: id(704), comparisonDomainId: IDS.comparisonDomain, comparisonDomainVersion: 1, comparisonDomainHash: ci.hash, valueDomainId: IDS.valueDomain, valueDomainVersion: 1, valueDomainHash: vi.hash, value, comparisonContext: [], evidenceBasis: [{ evidenceRelationId: IDS.relation, evidenceId: IDS.evidence, artifactVersionId: IDS.artifactVersion, statementKind: 'EvidenceArtifactBinding', statementId: IDS.statement }], historicalBindings: [{ kind: 'CLAIM_VERSION', claimVersionId: IDS.claimVersion }, { kind: 'STATEMENT', statementKind: 'EvidenceArtifactBinding', statementId: IDS.statement }, { kind: 'ARTIFACT_VERSION', artifactVersionId: IDS.artifactVersion }, { kind: 'RCV016_SNAPSHOT', snapshotId: IDS.snapshot, snapshotHash: historical.snapshotWrite.snapshotHash }, { kind: 'RCV017_ANALYSIS', analysisId: IDS.rcv017Analysis, analysisHash: historical.rcv017.analysisHash }] });
  const assertions = [a(IDS.assertionA, 'A'), a(IDS.assertionB, 'B')];
  const ai = assertions.map((x) => ({ value: x, ...canonicalizeRcv018(x) }));
  const input = { analysisId: IDS.analysis, assertions: ai, valueDomains: [{ value: vd, ...vi }], comparisonDomains: [{ value: cd, ...ci }], contractBinding: { contractId: 'factbase-rcv018-contract', contractVersion: 1, contractHash: 'c'.repeat(64) }, algorithmBinding: { algorithmId: 'factbase-rcv018-algorithm', algorithmVersion: 1, algorithmHash: 'd'.repeat(64) } };
  const built = buildRcv018Analysis(input); const projection = verifyRcv018Write({ builderInput: input, builderResult: built, existingFindings: [] });
  const c = await pool.connect();
  try { await c.query('BEGIN');
    await c.query('INSERT INTO rcv018_value_domains(value_domain_id,value_domain_version,kind,canonical,value_domain_hash) VALUES($1,$2,$3,$4,$5)', [IDS.valueDomain,1,vd.kind,vi.canonical,vi.hash]);
    await c.query('INSERT INTO rcv018_value_domain_values(value_domain_id,value_domain_version,ordinal,value) VALUES($1,1,0,$2),($1,1,1,$3)', [IDS.valueDomain,'A','B']);
    await c.query('INSERT INTO rcv018_comparison_domains(comparison_domain_id,comparison_domain_version,property_id,value_domain_id,value_domain_version,value_domain_hash,rule_family,canonical,comparison_domain_hash) VALUES($1,1,$2,$3,1,$4,$5,$6,$7)', [IDS.comparisonDomain,id(704),IDS.valueDomain,vi.hash,cd.ruleFamily,ci.canonical,ci.hash]);
    await c.query("INSERT INTO rcv018_incompatibility_pairs(comparison_domain_id,comparison_domain_version,ordinal,left_value,right_value) VALUES($1,1,0,'A','B')", [IDS.comparisonDomain]);
    for (const x of ai) { await c.query('INSERT INTO rcv018_evidence_assertions(assertion_id,subject_id,property_id,comparison_domain_id,comparison_domain_version,comparison_domain_hash,value_domain_id,value_domain_version,value_domain_hash,value,canonical,assertion_hash) VALUES($1,$2,$3,$4,1,$5,$6,1,$7,$8,$9,$10)', [x.value.assertionId,x.value.subjectId,x.value.propertyId,IDS.comparisonDomain,ci.hash,IDS.valueDomain,vi.hash,x.value.value,x.canonical,x.hash]); await c.query("INSERT INTO rcv018_assertion_evidence_basis(assertion_id,ordinal,evidence_relation_id,evidence_id,artifact_version_id,statement_kind,statement_id) VALUES($1,0,$2,$3,$4,'EvidenceArtifactBinding',$5)",[x.value.assertionId,IDS.relation,IDS.evidence,IDS.artifactVersion,IDS.statement]); for (const [ordinal,b] of x.value.historicalBindings.entries()) await c.query('INSERT INTO rcv018_assertion_historical_bindings(assertion_id,ordinal,kind,claim_version_id,statement_kind,statement_id,artifact_version_id,rcv016_snapshot_id,rcv016_snapshot_hash,rcv017_analysis_id,rcv017_analysis_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [x.value.assertionId,ordinal,b.kind,b.claimVersionId||null,b.statementKind||null,b.statementId||null,b.artifactVersionId||null,b.snapshotId||null,b.snapshotHash||null,b.analysisId||null,b.analysisHash||null]); }
    for (const f of projection.findingsToInsertAuthenticated) { const v=f.value; await c.query('INSERT INTO rcv018_contradiction_findings(finding_hash,assertion_a_id,assertion_a_hash,assertion_b_id,assertion_b_hash,comparison_domain_id,comparison_domain_version,comparison_domain_hash,incompatibility_left,incompatibility_right,canonical) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10)', [f.hash,v.assertionAId,v.assertionAHash,v.assertionBId,v.assertionBHash,v.comparisonDomainId,v.comparisonDomainHash,v.incompatibilityLeft,v.incompatibilityRight,f.canonical]); }
    await c.query('INSERT INTO rcv018_analyses(analysis_id,contract_id,contract_version,contract_hash,algorithm_id,algorithm_version,algorithm_hash,canonical,analysis_hash) VALUES($1,$2,1,$3,$4,1,$5,$6,$7)', [IDS.analysis,projection.analysis.contractBinding.contractId,projection.analysis.contractBinding.contractHash,projection.analysis.algorithmBinding.algorithmId,projection.analysis.algorithmBinding.algorithmHash,projection.analysisCanonical,projection.analysisHash]);
    await c.query('INSERT INTO rcv018_analysis_assertions(analysis_id,ordinal,assertion_id,assertion_hash) VALUES($1,0,$2,$3),($1,1,$4,$5)', [IDS.analysis,IDS.assertionA,ai[0].hash,IDS.assertionB,ai[1].hash]);
    await c.query('INSERT INTO rcv018_analysis_value_domains(analysis_id,ordinal,value_domain_id,value_domain_version,value_domain_hash) VALUES($1,0,$2,1,$3)', [IDS.analysis,IDS.valueDomain,vi.hash]);
    await c.query('INSERT INTO rcv018_analysis_comparison_domains(analysis_id,ordinal,comparison_domain_id,comparison_domain_version,comparison_domain_hash) VALUES($1,0,$2,1,$3)', [IDS.analysis,IDS.comparisonDomain,ci.hash]);
    for (const [ordinal,hash] of projection.findingHashes.entries()) await c.query('INSERT INTO rcv018_analysis_findings(analysis_id,ordinal,finding_hash) VALUES($1,$2,$3)', [IDS.analysis,ordinal,hash]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(()=>{}); throw e; } finally { c.release(); }
  return built;
}

module.exports = { IDS, materialize, materializeRcv018, canonicalizeRcv018, withAtomicFixtureTransaction, materializeHistoricalFixture, insertRoots, insertFixtureRoots, insertFixtureRcv016, insertFixtureRcv017, insertFixtureRcv018, BASELINE_PHASE_ROWS };
