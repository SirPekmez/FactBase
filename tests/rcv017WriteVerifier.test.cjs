const assert = require("node:assert/strict");
const test = require("node:test");

const { canonicalizeRcv016, sha256Rcv016Text } = require("../dist/services/rcv016Canonical");
const { buildRcv016ProvenanceSnapshot } = require("../dist/services/rcv016SnapshotBuilder");
const { buildRcv017ClaimEvidenceDependencyAnalysis, Rcv017ValidationError } = require("../dist/services/rcv017AnalysisBuilder");
const {
  assertVerifiedRcv017AnalysisWrite,
  verifyRcv017AnalysisForWrite,
} = require("../dist/services/rcv017WriteVerifier");

const TS = "2026-09-02T10:00:00.000000Z";
const EMPTY = "{}";
const EMPTY_HASH = sha256Rcv016Text(EMPTY);
function id(n) { return `30000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`; }
function common(statementId) { return { statementId, observedAt: TS, validFrom: null, validTo: null, initiator: null, rationale: null, foundation: null, supersedesStatementId: null, createdAt: TS }; }
function av(n) { return { artifactVersionId: id(n), artifactId: id(100 + n), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: EMPTY, captureHash: EMPTY_HASH, createdAt: TS }; }

function result() {
  const snapshotPolicyDefinition = { policyId: "rcv017-write", policyVersion: "1", maxRoots: 10, maxNodes: 10, maxEdges: 10, maxDepth: 2, maxCanonicalSnapshotBytes: 1_000_000, allowedRelationships: ["cites", "derived_from", "incorporates", "quotes", "reposts", "syndicated_from", "uses_information_from"], deterministicOrdering: "schema_category_then_canonical_key_lexicographic_v1", visitedSemantics: "expand_node_once_include_statement_once_diagnose_cycles_v1" };
  const sp = canonicalizeRcv016(snapshotPolicyDefinition);
  const snapshotResult = buildRcv016ProvenanceSnapshot({
    snapshotIdentity: { snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1", canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" },
    builderIdentity: { builderId: "factbase-provenance-snapshot-builder", builderVersion: "1", builderArtifactHash: "a".repeat(64) },
    traversalPolicy: { ...snapshotPolicyDefinition, definitionCanonical: sp.canonical, definitionHash: sp.hash }, roots: [id(1)], artifactVersions: [av(1)], sourceVersions: [], artifactProvenanceStatements: [], sourceRelationshipStatements: [], artifactSourceAttributions: [],
    evidenceArtifactBindings: [{ family: "EvidenceArtifactBinding", ...common(id(40)), subjectEvidenceId: id(20), relationship: "bound_to", objectArtifactVersionId: id(1) }],
    knowledgeStateStatements: [],
  });
  const definition = {
    schemaId: "factbase-dependency-analysis-policy", schemaVersion: "1", policyId: id(70), policyVersion: 1,
    relationshipClassificationCatalogId: "factbase-dependency-relationship-classification", relationshipClassificationCatalogVersion: "1",
    enabledDependencyRelationships: ["quotes"], evidenceDirectionPartitionRule: "supports_and_contradicts_separate_contextualizes_excluded", reflexiveClosureRule: "anchor_depth_zero_then_enabled_dependency_edges_minimum_distance", commonUpstreamRule: "same_exact_artifact_version_in_two_or_more_reflexive_branch_closures", negativeFindingRule: "unordered_same_direction_pair_with_disjoint_reflexive_closures", knowledgeLimitationRule: "snapshot_unknown_partial_or_derived_unrecorded_in_reached_set", witnessSelectionRule: "fewest_edges_then_ascii_statement_id_sequence", findingVocabularyRule: "rcv017_closed_four_finding_vocabulary_v1", cycleHandlingRule: "expand_once_per_branch_at_minimum_distance", deterministicOrderingRule: "rcv017_explicit_total_order_v1", maxEvidenceRelations: 10, maxBindings: 10, maxArtifactVersions: 10, maxStatements: 10, maxDependencyDepth: 2, maxFindings: 10, maxCanonicalBytes: 1_000_000, canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256",
  };
  const encoded = canonicalizeRcv016(definition);
  return buildRcv017ClaimEvidenceDependencyAnalysis({
    claimVersionId: id(10),
    evidenceRelations: [{ claimVersionEvidenceRelationId: id(11), evidenceId: id(20), direction: "supports" }],
    selectedBindings: [{ claimVersionEvidenceRelationId: id(11), evidenceArtifactBindingStatementId: id(40), evidenceId: id(20), artifactVersionId: id(1) }],
    provenanceSnapshot: { snapshotId: id(90), builderResult: snapshotResult },
    dependencyAnalysisPolicy: { definition, canonical: encoded.canonical, hash: encoded.hash },
    algorithmIdentity: { algorithmId: "factbase-claim-evidence-dependency-algorithm", algorithmVersion: "1", algorithmArtifactHash: "b".repeat(64) },
  });
}

function writeInput(built, analysisIdFactory, overrides = {}) {
  return {
    builderResult: built,
    provenanceSnapshotIdentity: {
      snapshotId: built.analysis.provenanceSnapshotId,
      snapshotHash: built.analysis.provenanceSnapshotHash,
    },
    dependencyAnalysisPolicyIdentity: {
      policyId: built.analysis.dependencyAnalysisPolicyId,
      policyVersion: built.analysis.dependencyAnalysisPolicyVersion,
      policyHash: built.analysis.dependencyAnalysisPolicyHash,
    },
    analysisIdFactory,
    ...overrides,
  };
}

test("Write-Verifier authenticates once and preserves the exact deterministic projection", () => {
  const built = result();
  let calls = 0;
  const verified = verifyRcv017AnalysisForWrite(writeInput(built, () => { calls += 1; return id(99); }));
  assert.equal(calls, 1);
  assert.equal(verified.analysisId, id(99));
  assert.equal(verified.analysisHash, built.hash);
  assert.strictEqual(verified.projection, built.projection);
  assert.equal(verified.projection.analysisHeader.analysisCanonical, built.canonical);
  assert.equal(verified.projection.analysisHeader.analysisHash, built.hash);
  assert.ok(!("createdAt" in verified.projection.analysisHeader));
  assert.strictEqual(assertVerifiedRcv017AnalysisWrite(verified), verified);
  assert.equal(Object.isFrozen(verified), true);
});

test("forged, cloned, spread, or altered Builder results cannot cross the write boundary", () => {
  const built = result();
  const candidates = [
    { ...built }, JSON.parse(JSON.stringify(built)),
    { ...built, canonical: `${built.canonical}\n` },
    { ...built, hash: "f".repeat(64) },
    { ...built, analysis: { ...built.analysis, provenanceSnapshotHash: "f".repeat(64) } },
    { ...built, analysis: { ...built.analysis, dependencyAnalysisPolicyHash: "f".repeat(64) } },
    { ...built, analysis: { ...built.analysis, algorithmArtifactHash: "f".repeat(64) } },
    { ...built, projection: { ...built.projection, evidenceRelations: [...built.projection.evidenceRelations, built.projection.evidenceRelations[0]] } },
    { ...built, projection: { ...built.projection, bindings: [] } },
    { ...built, projection: { ...built.projection, sharedArtifactFindings: [{}] } },
    { ...built, projection: { ...built.projection, commonUpstreamWitnessSteps: [{ ordinal: 9 }] } },
    { ...built, projection: { ...built.projection, knowledgeAffectedArtifacts: [{}] } },
  ];
  for (const candidate of candidates) {
    let calls = 0;
    assert.throws(() => verifyRcv017AnalysisForWrite(writeInput(candidate, () => { calls += 1; return id(99); })), Rcv017ValidationError);
    assert.equal(calls, 0);
  }
});

test("analysisId is allocated exactly once and rejected rather than normalized", () => {
  for (const candidate of [`A${id(99).slice(1)}`, "bad"]) {
    let calls = 0;
    const built = result();
    assert.throws(() => verifyRcv017AnalysisForWrite(writeInput(built, () => { calls += 1; return candidate; })), Rcv017ValidationError);
    assert.equal(calls, 1);
  }
  let collisionCalls = 0;
  const collision = new Error("technical analysisId collision");
  const built = result();
  assert.throws(() => verifyRcv017AnalysisForWrite(writeInput(built, () => { collisionCalls += 1; throw collision; })), collision);
  assert.equal(collisionCalls, 1);
});

test("exact Snapshot and pre-existing Policy identities cannot be substituted", () => {
  const built = result();
  const attacks = [
    { provenanceSnapshotIdentity: { snapshotId: id(98), snapshotHash: built.analysis.provenanceSnapshotHash } },
    { provenanceSnapshotIdentity: { snapshotId: built.analysis.provenanceSnapshotId, snapshotHash: "f".repeat(64) } },
    { dependencyAnalysisPolicyIdentity: { policyId: id(71), policyVersion: built.analysis.dependencyAnalysisPolicyVersion, policyHash: built.analysis.dependencyAnalysisPolicyHash } },
    { dependencyAnalysisPolicyIdentity: { policyId: built.analysis.dependencyAnalysisPolicyId, policyVersion: 2, policyHash: built.analysis.dependencyAnalysisPolicyHash } },
    { dependencyAnalysisPolicyIdentity: { policyId: built.analysis.dependencyAnalysisPolicyId, policyVersion: built.analysis.dependencyAnalysisPolicyVersion, policyHash: "f".repeat(64) } },
  ];
  for (const attack of attacks) {
    let calls = 0;
    assert.throws(
      () => verifyRcv017AnalysisForWrite(writeInput(built, () => { calls += 1; return id(99); }, attack)),
      /does not match the exact finalized/,
    );
    assert.equal(calls, 0);
  }
});

test("write result authentication is non-forgeable and has no semantic shortcut API", () => {
  const built = result();
  const verified = verifyRcv017AnalysisForWrite(writeInput(built, () => id(99)));
  for (const clone of [{ ...verified }, JSON.parse(JSON.stringify(verified))]) {
    assert.throws(() => assertVerifiedRcv017AnalysisWrite(clone), Rcv017ValidationError);
  }
  const api = require("../dist/services/rcv017WriteVerifier");
  assert.deepEqual(Object.keys(api).sort(), ["assertVerifiedRcv017AnalysisWrite", "verifyRcv017AnalysisForWrite"]);
  assert.ok(!Object.keys(api).some((name) => /latest|current|winner|repair|retry|rank|score|truth/i.test(name)));
});
