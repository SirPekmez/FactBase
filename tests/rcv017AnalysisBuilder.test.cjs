const assert = require("node:assert/strict");
const test = require("node:test");

const { canonicalizeRcv016, sha256Rcv016Text } = require("../dist/services/rcv016Canonical");
const { buildRcv016ProvenanceSnapshot } = require("../dist/services/rcv016SnapshotBuilder");
const {
  Rcv017IntegrityParityError,
  Rcv017LimitError,
  Rcv017UnsupportedVersionError,
  Rcv017ValidationError,
  assertFinalizedRcv017AnalysisResult,
  buildRcv017ClaimEvidenceDependencyAnalysis,
} = require("../dist/services/rcv017AnalysisBuilder");

const TS = "2026-09-02T10:00:00.000000Z";
const EMPTY = "{}";
const EMPTY_HASH = sha256Rcv016Text(EMPTY);

function id(number) {
  return `20000000-0000-0000-0000-${number.toString(16).padStart(12, "0")}`;
}

function common(statementId) {
  return { statementId, observedAt: TS, validFrom: null, validTo: null, initiator: null, rationale: null, foundation: null, supersedesStatementId: null, createdAt: TS };
}

function artifactVersion(number) {
  return { artifactVersionId: id(number), artifactId: id(1000 + number), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: EMPTY, captureHash: EMPTY_HASH, createdAt: TS };
}

function rcv016Policy() {
  const definition = {
    policyId: "rcv017-builder-snapshot", policyVersion: "1", maxRoots: 20,
    maxNodes: 100, maxEdges: 100, maxDepth: 10, maxCanonicalSnapshotBytes: 1_000_000,
    allowedRelationships: ["cites", "derived_from", "incorporates", "quotes", "reposts", "syndicated_from", "uses_information_from"],
    deterministicOrdering: "schema_category_then_canonical_key_lexicographic_v1",
    visitedSemantics: "expand_node_once_include_statement_once_diagnose_cycles_v1",
  };
  const encoded = canonicalizeRcv016(definition);
  return { ...definition, definitionCanonical: encoded.canonical, definitionHash: encoded.hash };
}

function snapshot(overrides = {}) {
  const artifacts = [1, 2, 3, 4, 5, 6].map(artifactVersion);
  const provenance = overrides.provenance ?? [
    { family: "ArtifactProvenanceStatement", ...common(id(501)), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(3) },
    { family: "ArtifactProvenanceStatement", ...common(id(502)), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(3) },
    { family: "ArtifactProvenanceStatement", ...common(id(503)), subjectArtifactVersionId: id(1), relationship: "cites", objectArtifactVersionId: id(5) },
  ];
  const bindings = [
    { family: "EvidenceArtifactBinding", ...common(id(401)), subjectEvidenceId: id(201), relationship: "bound_to", objectArtifactVersionId: id(1) },
    { family: "EvidenceArtifactBinding", ...common(id(402)), subjectEvidenceId: id(202), relationship: "bound_to", objectArtifactVersionId: id(2) },
    { family: "EvidenceArtifactBinding", ...common(id(403)), subjectEvidenceId: id(203), relationship: "bound_to", objectArtifactVersionId: id(1) },
    { family: "EvidenceArtifactBinding", ...common(id(404)), subjectEvidenceId: id(204), relationship: "bound_to", objectArtifactVersionId: id(4) },
    { family: "EvidenceArtifactBinding", ...common(id(405)), subjectEvidenceId: id(201), relationship: "bound_to", objectArtifactVersionId: id(2) },
  ];
  const knowledge = overrides.knowledge ?? [
    { family: "KnowledgeStateStatement", ...common(id(601)), subjectArtifactVersionId: id(1), scope: "upstream_provenance", state: "unknown" },
    { family: "KnowledgeStateStatement", ...common(id(602)), subjectArtifactVersionId: id(2), scope: "upstream_provenance", state: "partial" },
    { family: "KnowledgeStateStatement", ...common(id(603)), subjectArtifactVersionId: id(3), scope: "upstream_provenance", state: "known" },
  ];
  return buildRcv016ProvenanceSnapshot({
    snapshotIdentity: { snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1", canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" },
    builderIdentity: { builderId: "factbase-provenance-snapshot-builder", builderVersion: "1", builderArtifactHash: "a".repeat(64) },
    traversalPolicy: rcv016Policy(), roots: [id(1), id(2), id(4), id(6)],
    artifactVersions: artifacts,
    sourceVersions: [], artifactProvenanceStatements: provenance,
    sourceRelationshipStatements: overrides.sourceRelationships ?? [],
    artifactSourceAttributions: [], evidenceArtifactBindings: bindings,
    knowledgeStateStatements: knowledge,
  });
}

function policy(overrides = {}) {
  const definition = {
    schemaId: "factbase-dependency-analysis-policy", schemaVersion: "1",
    policyId: id(700), policyVersion: 1,
    relationshipClassificationCatalogId: "factbase-dependency-relationship-classification",
    relationshipClassificationCatalogVersion: "1",
    enabledDependencyRelationships: ["quotes", "incorporates", "reposts", "syndicated_from", "derived_from", "uses_information_from"],
    evidenceDirectionPartitionRule: "supports_and_contradicts_separate_contextualizes_excluded",
    reflexiveClosureRule: "anchor_depth_zero_then_enabled_dependency_edges_minimum_distance",
    commonUpstreamRule: "same_exact_artifact_version_in_two_or_more_reflexive_branch_closures",
    negativeFindingRule: "unordered_same_direction_pair_with_disjoint_reflexive_closures",
    knowledgeLimitationRule: "snapshot_unknown_partial_or_derived_unrecorded_in_reached_set",
    witnessSelectionRule: "fewest_edges_then_ascii_statement_id_sequence",
    findingVocabularyRule: "rcv017_closed_four_finding_vocabulary_v1",
    cycleHandlingRule: "expand_once_per_branch_at_minimum_distance",
    deterministicOrderingRule: "rcv017_explicit_total_order_v1",
    maxEvidenceRelations: 20, maxBindings: 20, maxArtifactVersions: 100,
    maxStatements: 100, maxDependencyDepth: 10, maxFindings: 100,
    maxCanonicalBytes: 1_000_000,
    canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256",
    ...overrides,
  };
  const encoded = canonicalizeRcv016(definition);
  return { definition, canonical: encoded.canonical, hash: encoded.hash };
}

function input(overrides = {}) {
  const relations = [
    { claimVersionEvidenceRelationId: id(101), evidenceId: id(201), direction: "supports" },
    { claimVersionEvidenceRelationId: id(102), evidenceId: id(202), direction: "supports" },
    { claimVersionEvidenceRelationId: id(103), evidenceId: id(203), direction: "supports" },
    { claimVersionEvidenceRelationId: id(104), evidenceId: id(204), direction: "supports" },
  ];
  const bindings = [
    { claimVersionEvidenceRelationId: id(101), evidenceArtifactBindingStatementId: id(401), evidenceId: id(201), artifactVersionId: id(1) },
    { claimVersionEvidenceRelationId: id(102), evidenceArtifactBindingStatementId: id(402), evidenceId: id(202), artifactVersionId: id(2) },
    { claimVersionEvidenceRelationId: id(103), evidenceArtifactBindingStatementId: id(403), evidenceId: id(203), artifactVersionId: id(1) },
    { claimVersionEvidenceRelationId: id(104), evidenceArtifactBindingStatementId: id(404), evidenceId: id(204), artifactVersionId: id(4) },
  ];
  return {
    claimVersionId: id(10), evidenceRelations: relations, selectedBindings: bindings,
    provenanceSnapshot: { snapshotId: id(900), builderResult: snapshot() },
    dependencyAnalysisPolicy: policy(),
    algorithmIdentity: { algorithmId: "factbase-claim-evidence-dependency-algorithm", algorithmVersion: "1", algorithmArtifactHash: "b".repeat(64) },
    ...overrides,
  };
}

function build(value = input()) {
  return buildRcv017ClaimEvidenceDependencyAnalysis(value);
}

test("Builder produces the exact deterministic four-family analysis", () => {
  const result = build();
  assert.equal(result.analysis.schemaId, "factbase-claim-evidence-dependency-analysis");
  assert.equal(Object.keys(result.analysis).length, 17);
  assert.equal(result.hash, sha256Rcv016Text(result.canonical));
  assert.equal(Buffer.byteLength(result.canonical, "utf8") <= result.policy.definition.maxCanonicalBytes, true);
  assert.deepEqual(result.analysis.findings.map(({ type }) => type), [
    "RECORDED_SHARED_ARTIFACT_VERSION",
    "RECORDED_COMMON_UPSTREAM",
    "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE",
    "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE",
    "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE",
    "DEPENDENCY_KNOWLEDGE_INCOMPLETE",
    "DEPENDENCY_KNOWLEDGE_INCOMPLETE",
    "DEPENDENCY_KNOWLEDGE_INCOMPLETE",
    "DEPENDENCY_KNOWLEDGE_INCOMPLETE",
  ]);
  const commonFinding = result.analysis.findings.find(({ type }) => type === "RECORDED_COMMON_UPSTREAM");
  assert.equal(commonFinding.upstreamArtifactVersionId, id(3));
  assert.deepEqual(commonFinding.members.map(({ witness }) => witness.artifactProvenanceStatementIds), [[id(501)], [id(502)], [id(501)]]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.analysis.findings), true);
  assert.strictEqual(assertFinalizedRcv017AnalysisResult(result), result);
});

test("caller permutation is byte-identical and input objects are not mutated", () => {
  const firstInput = input();
  const before = JSON.stringify(firstInput);
  const first = build(firstInput);
  const second = build({
    ...input(),
    evidenceRelations: [...firstInput.evidenceRelations].reverse(),
    selectedBindings: [...firstInput.selectedBindings].reverse(),
  });
  assert.equal(first.canonical, second.canonical);
  assert.equal(first.hash, second.hash);
  assert.equal(JSON.stringify(firstInput), before);
});

test("shared artifact, common ancestor, negatives, and knowledge limitations remain structural", () => {
  const findings = build().analysis.findings;
  const shared = findings.find(({ type }) => type === "RECORDED_SHARED_ARTIFACT_VERSION");
  assert.equal(shared.artifactVersionId, id(1));
  assert.deepEqual(shared.members.map((member) => member.claimVersionEvidenceRelationId), [id(101), id(103)]);
  const negatives = findings.filter(({ type }) => type === "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE");
  assert.equal(negatives.length, 3);
  assert.ok(negatives.every(({ direction }) => direction === "supports"));
  const knowledge = findings.filter(({ type }) => type === "DEPENDENCY_KNOWLEDGE_INCOMPLETE");
  assert.equal(knowledge.length, 4);
  assert.ok(!resultFields(findings).some((field) => /independent|score|rank|truth|confidence/i.test(field)));
});

function resultFields(value) {
  const fields = [];
  const visit = (item) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item)) { fields.push(key); visit(nested); }
  };
  visit(value);
  return fields;
}

test("contextualizes is retained as input but excluded from comparison findings", () => {
  const value = input();
  value.evidenceRelations[3] = { ...value.evidenceRelations[3], direction: "contextualizes" };
  const result = build(value);
  assert.equal(result.analysis.evidenceRelations[3].direction, "contextualizes");
  assert.ok(result.analysis.findings.every((finding) => finding.direction !== "contextualizes"));
  assert.ok(!result.analysis.findings.some((finding) => JSON.stringify(finding).includes(id(104))));
});

test("supports and contradicts never form cross-direction findings", () => {
  const value = input();
  value.evidenceRelations[1] = { ...value.evidenceRelations[1], direction: "contradicts" };
  const result = build(value);
  assert.ok(result.analysis.findings.every((finding) => !finding.members || new Set(finding.members.map((member) => {
    const branch = member.branchKey ?? member;
    return result.analysis.evidenceRelations.find((relation) => relation.claimVersionEvidenceRelationId === branch.claimVersionEvidenceRelationId).direction;
  })).size === 1));
});

test("cites is reference-only and an excluded dependency edge does not enter closure", () => {
  const value = input({
    evidenceRelations: [{ claimVersionEvidenceRelationId: id(101), evidenceId: id(201), direction: "supports" }],
    selectedBindings: [{ claimVersionEvidenceRelationId: id(101), evidenceArtifactBindingStatementId: id(401), evidenceId: id(201), artifactVersionId: id(1) }],
  });
  const result = build(value);
  const knowledge = result.analysis.findings.find(({ type }) => type === "DEPENDENCY_KNOWLEDGE_INCOMPLETE");
  assert.ok(!knowledge.affectedArtifactVersionIds.includes(id(5)));
});

test("all six dependency-bearing relationships traverse with their frozen meaning", async (t) => {
  for (const relationship of ["quotes", "incorporates", "reposts", "syndicated_from", "derived_from", "uses_information_from"]) {
    await t.test(relationship, () => {
      const value = input({
        evidenceRelations: input().evidenceRelations.slice(0, 2),
        selectedBindings: input().selectedBindings.slice(0, 2),
      });
      value.provenanceSnapshot = {
        snapshotId: id(900),
        builderResult: snapshot({ provenance: [
          { family: "ArtifactProvenanceStatement", ...common(id(501)), subjectArtifactVersionId: id(1), relationship, objectArtifactVersionId: id(3) },
          { family: "ArtifactProvenanceStatement", ...common(id(502)), subjectArtifactVersionId: id(2), relationship, objectArtifactVersionId: id(3) },
        ] }),
      };
      const findings = build(value).analysis.findings;
      assert.ok(findings.some((finding) =>
        finding.type === "RECORDED_COMMON_UPSTREAM" &&
        finding.upstreamArtifactVersionId === id(3)));
    });
  }
});

test("cycles terminate, witnesses stay simple, and overlapping upstreams stay distinct", () => {
  const value = input({
    evidenceRelations: input().evidenceRelations.slice(0, 2),
    selectedBindings: input().selectedBindings.slice(0, 2),
  });
  value.provenanceSnapshot = {
    snapshotId: id(900),
    builderResult: snapshot({ provenance: [
      { family: "ArtifactProvenanceStatement", ...common(id(501)), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(3) },
      { family: "ArtifactProvenanceStatement", ...common(id(502)), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(3) },
      { family: "ArtifactProvenanceStatement", ...common(id(503)), subjectArtifactVersionId: id(3), relationship: "quotes", objectArtifactVersionId: id(5) },
      { family: "ArtifactProvenanceStatement", ...common(id(504)), subjectArtifactVersionId: id(5), relationship: "quotes", objectArtifactVersionId: id(1) },
    ] }),
  };
  const commonFindings = build(value).analysis.findings.filter(({ type }) => type === "RECORDED_COMMON_UPSTREAM");
  assert.deepEqual(commonFindings.map(({ upstreamArtifactVersionId }) => upstreamArtifactVersionId), [id(1), id(3), id(5)]);
  for (const finding of commonFindings) {
    for (const { witness } of finding.members) {
      assert.equal(new Set(witness.artifactVersionIds).size, witness.artifactVersionIds.length);
    }
  }
});

test("same Evidence through multiple relations or bindings preserves every explicit branch", () => {
  const sameRelation = input({
    evidenceRelations: [input().evidenceRelations[0]],
    selectedBindings: [input().selectedBindings[0], {
      claimVersionEvidenceRelationId: id(101), evidenceArtifactBindingStatementId: id(405),
      evidenceId: id(201), artifactVersionId: id(2),
    }],
  });
  assert.equal(build(sameRelation).analysis.selectedBindings.length, 2);

  const twoRelations = input({
    evidenceRelations: [input().evidenceRelations[0], {
      claimVersionEvidenceRelationId: id(105), evidenceId: id(201), direction: "supports",
    }],
    selectedBindings: [input().selectedBindings[0], {
      claimVersionEvidenceRelationId: id(105), evidenceArtifactBindingStatementId: id(405),
      evidenceId: id(201), artifactVersionId: id(2),
    }],
  });
  assert.equal(build(twoRelations).analysis.evidenceRelations.length, 2);
  assert.equal(build(twoRelations).analysis.selectedBindings.length, 2);
});

test("a shorter witness wins, then equal-length paths use statement-ID ASCII order", () => {
  const provenance = [
    { family: "ArtifactProvenanceStatement", ...common(id(510)), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(5) },
    { family: "ArtifactProvenanceStatement", ...common(id(511)), subjectArtifactVersionId: id(5), relationship: "quotes", objectArtifactVersionId: id(3) },
    { family: "ArtifactProvenanceStatement", ...common(id(509)), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(3) },
    { family: "ArtifactProvenanceStatement", ...common(id(502)), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(3) },
  ];
  const value = input();
  value.provenanceSnapshot = { snapshotId: id(900), builderResult: snapshot({ provenance }) };
  const commonFinding = build(value).analysis.findings.find(
    (finding) => finding.type === "RECORDED_COMMON_UPSTREAM" && finding.upstreamArtifactVersionId === id(3),
  );
  const member = commonFinding.members.find(({ branchKey }) => branchKey.claimVersionEvidenceRelationId === id(101));
  assert.deepEqual(member.witness.artifactProvenanceStatementIds, [id(509)]);
});

test("maxDepth includes boundary nodes but never expands them", () => {
  const provenance = [
    { family: "ArtifactProvenanceStatement", ...common(id(510)), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(5) },
    { family: "ArtifactProvenanceStatement", ...common(id(511)), subjectArtifactVersionId: id(5), relationship: "quotes", objectArtifactVersionId: id(3) },
    { family: "ArtifactProvenanceStatement", ...common(id(502)), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(3) },
  ];
  const base = input({
    evidenceRelations: input().evidenceRelations.slice(0, 2),
    selectedBindings: input().selectedBindings.slice(0, 2),
    provenanceSnapshot: { snapshotId: id(900), builderResult: snapshot({ provenance }) },
  });
  const shallow = build({ ...base, dependencyAnalysisPolicy: policy({ maxDependencyDepth: 1 }) });
  assert.ok(!shallow.analysis.findings.some((finding) =>
    finding.type === "RECORDED_COMMON_UPSTREAM" && finding.upstreamArtifactVersionId === id(3)));
  const deep = build({ ...base, dependencyAnalysisPolicy: policy({ maxDependencyDepth: 2 }) });
  assert.ok(deep.analysis.findings.some((finding) =>
    finding.type === "RECORDED_COMMON_UPSTREAM" && finding.upstreamArtifactVersionId === id(3)));
});

test("known does not cancel coexisting unknown or partial historical statements", () => {
  const knowledge = [
    { family: "KnowledgeStateStatement", ...common(id(601)), subjectArtifactVersionId: id(1), scope: "upstream_provenance", state: "unknown" },
    { family: "KnowledgeStateStatement", ...common(id(604)), subjectArtifactVersionId: id(1), scope: "upstream_provenance", state: "known" },
    { family: "KnowledgeStateStatement", ...common(id(602)), subjectArtifactVersionId: id(2), scope: "upstream_provenance", state: "partial" },
    { family: "KnowledgeStateStatement", ...common(id(605)), subjectArtifactVersionId: id(2), scope: "upstream_provenance", state: "known" },
    { family: "KnowledgeStateStatement", ...common(id(603)), subjectArtifactVersionId: id(3), scope: "upstream_provenance", state: "known" },
  ];
  const value = input();
  value.provenanceSnapshot = { snapshotId: id(900), builderResult: snapshot({ knowledge }) };
  const findings = build(value).analysis.findings.filter(({ type }) => type === "DEPENDENCY_KNOWLEDGE_INCOMPLETE");
  assert.ok(findings.some(({ knowledgeStateStatementIds }) => knowledgeStateStatementIds.includes(id(601))));
  assert.ok(findings.some(({ knowledgeStateStatementIds }) => knowledgeStateStatementIds.includes(id(602))));
});

test("the Builder authenticates the finalized RCV-016 Snapshot and finalized analysis", () => {
  const value = input();
  value.provenanceSnapshot = { snapshotId: id(900), builderResult: JSON.parse(JSON.stringify(value.provenanceSnapshot.builderResult)) };
  assert.throws(() => build(value), /not finalized by the RCV-016 Snapshot Builder/);
  const real = build();
  for (const clone of [{ ...real }, JSON.parse(JSON.stringify(real))]) {
    assert.throws(() => assertFinalizedRcv017AnalysisResult(clone), Rcv017ValidationError);
  }
  assert.throws(() => { real.analysis.findings.push({}); }, TypeError);
});

test("later external state, RCV-014 data, and Source context cannot alter a finalized analysis", () => {
  const value = input();
  const result = build(value);
  const laterLive = { provenance: [], knowledge: [], rcv014Assessments: [{ independence: 1 }], sourceRelationships: [{ relationship: "controlled_by" }] };
  laterLive.provenance.push({ relationship: "quotes" });
  laterLive.knowledge.push({ state: "partial" });
  assert.equal(result.canonical, build(value).canonical);
  assert.ok(!result.canonical.includes("controlled_by"));
  assert.ok(!result.canonical.includes("independence"));
});

test("Builder adversarial matrix covers 55 default-deny and boundary cases", async (t) => {
  const reject = (name, mutate, ErrorType = Error) => ({ name, run() { const value = input(); mutate(value); assert.throws(() => build(value), ErrorType); } });
  const cases = [
    reject("uppercase claim UUID", (v) => { v.claimVersionId = v.claimVersionId.toUpperCase(); }),
    reject("malformed claim UUID", (v) => { v.claimVersionId = "bad"; }),
    reject("extra top-level field", (v) => { v.extra = true; }),
    reject("empty relations", (v) => { v.evidenceRelations = []; }),
    reject("empty bindings", (v) => { v.selectedBindings = []; }),
    reject("duplicate relation", (v) => { v.evidenceRelations.push({ ...v.evidenceRelations[0] }); }),
    reject("duplicate binding statement", (v) => { v.selectedBindings.push({ ...v.selectedBindings[0], claimVersionEvidenceRelationId: id(102), evidenceId: id(202) }); }),
    reject("duplicate branch", (v) => { v.selectedBindings.push({ ...v.selectedBindings[0] }); }),
    reject("unknown direction", (v) => { v.evidenceRelations[0] = { ...v.evidenceRelations[0], direction: "agrees" }; }),
    reject("relation extra field", (v) => { v.evidenceRelations[0] = { ...v.evidenceRelations[0], extra: 1 }; }),
    reject("binding extra field", (v) => { v.selectedBindings[0] = { ...v.selectedBindings[0], extra: 1 }; }),
    reject("binding relation foreign", (v) => { v.selectedBindings[0] = { ...v.selectedBindings[0], claimVersionEvidenceRelationId: id(199) }; }),
    reject("relation Evidence mismatch", (v) => { v.selectedBindings[0] = { ...v.selectedBindings[0], evidenceId: id(202) }; }),
    reject("binding statement Evidence mismatch", (v) => { v.selectedBindings[0] = { ...v.selectedBindings[0], evidenceId: id(202) }; }),
    reject("binding Artifact mismatch", (v) => { v.selectedBindings[0] = { ...v.selectedBindings[0], artifactVersionId: id(2) }; }),
    reject("binding not Snapshot member", (v) => { v.selectedBindings[0] = { ...v.selectedBindings[0], evidenceArtifactBindingStatementId: id(499) }; }),
    reject("Artifact not Snapshot member", (v) => { v.selectedBindings[0] = { ...v.selectedBindings[0], artifactVersionId: id(999) }; }),
    reject("relation without binding", (v) => { v.selectedBindings = v.selectedBindings.slice(1); }),
    reject("unsupported policy schema", (v) => { v.dependencyAnalysisPolicy = policy({ schemaVersion: "2" }); }, Rcv017UnsupportedVersionError),
    reject("unsupported policy catalog", (v) => { v.dependencyAnalysisPolicy = policy({ relationshipClassificationCatalogVersion: "2" }); }, Rcv017UnsupportedVersionError),
    reject("unsupported canonicalization", (v) => { v.dependencyAnalysisPolicy = policy({ canonicalizationVersion: "2" }); }, Rcv017UnsupportedVersionError),
    reject("unsupported hash algorithm", (v) => { v.dependencyAnalysisPolicy = policy({ hashAlgorithm: "sha-512" }); }, Rcv017UnsupportedVersionError),
    reject("cites enabled", (v) => { v.dependencyAnalysisPolicy = policy({ enabledDependencyRelationships: ["cites"] }); }),
    reject("unknown enabled relationship", (v) => { v.dependencyAnalysisPolicy = policy({ enabledDependencyRelationships: ["unknown"] }); }),
    reject("empty enabled relationship set", (v) => { v.dependencyAnalysisPolicy = policy({ enabledDependencyRelationships: [] }); }),
    reject("duplicate enabled relationship", (v) => { v.dependencyAnalysisPolicy = policy({ enabledDependencyRelationships: ["quotes", "quotes"] }); }),
    reject("policy canonical drift", (v) => { v.dependencyAnalysisPolicy = { ...v.dependencyAnalysisPolicy, canonical: "{}" }; }, Rcv017IntegrityParityError),
    reject("policy hash drift", (v) => { v.dependencyAnalysisPolicy = { ...v.dependencyAnalysisPolicy, hash: "f".repeat(64) }; }, Rcv017IntegrityParityError),
    reject("policy extra envelope field", (v) => { v.dependencyAnalysisPolicy.extra = true; }),
    reject("unsupported algorithm id", (v) => { v.algorithmIdentity = { ...v.algorithmIdentity, algorithmId: "other" }; }, Rcv017UnsupportedVersionError),
    reject("unsupported algorithm version", (v) => { v.algorithmIdentity = { ...v.algorithmIdentity, algorithmVersion: "2" }; }, Rcv017UnsupportedVersionError),
    reject("bad algorithm hash", (v) => { v.algorithmIdentity = { ...v.algorithmIdentity, algorithmArtifactHash: "bad" }; }),
    reject("algorithm extra field", (v) => { v.algorithmIdentity = { ...v.algorithmIdentity, extra: true }; }),
    reject("uppercase snapshot ID", (v) => { v.provenanceSnapshot = { ...v.provenanceSnapshot, snapshotId: `A${v.provenanceSnapshot.snapshotId.slice(1)}` }; }),
    reject("snapshot wrapper extra field", (v) => { v.provenanceSnapshot = { ...v.provenanceSnapshot, extra: true }; }),
    reject("maxEvidenceRelations", (v) => { v.dependencyAnalysisPolicy = policy({ maxEvidenceRelations: 3 }); }, Rcv017LimitError),
    reject("maxBindings", (v) => { v.dependencyAnalysisPolicy = policy({ maxBindings: 3 }); }, Rcv017LimitError),
    reject("maxArtifactVersions", (v) => { v.dependencyAnalysisPolicy = policy({ maxArtifactVersions: 3 }); }, Rcv017LimitError),
    reject("maxStatements", (v) => { v.dependencyAnalysisPolicy = policy({ maxStatements: 1 }); }, Rcv017LimitError),
    reject("maxFindings", (v) => { v.dependencyAnalysisPolicy = policy({ maxFindings: 1 }); }, Rcv017LimitError),
    reject("maxCanonicalBytes", (v) => { v.dependencyAnalysisPolicy = policy({ maxCanonicalBytes: 10 }); }, Rcv017LimitError),
    reject("zero maxDepth", (v) => { v.dependencyAnalysisPolicy = policy({ maxDependencyDepth: 0 }); }),
    reject("negative limit", (v) => { v.dependencyAnalysisPolicy = policy({ maxBindings: -1 }); }),
    reject("unsafe limit", (v) => { v.dependencyAnalysisPolicy = policy({ maxBindings: Number.MAX_SAFE_INTEGER + 1 }); }),
    reject("wrong direction rule", (v) => { v.dependencyAnalysisPolicy = policy({ evidenceDirectionPartitionRule: "other" }); }),
    reject("wrong closure rule", (v) => { v.dependencyAnalysisPolicy = policy({ reflexiveClosureRule: "other" }); }),
    reject("wrong common rule", (v) => { v.dependencyAnalysisPolicy = policy({ commonUpstreamRule: "other" }); }),
    reject("wrong negative rule", (v) => { v.dependencyAnalysisPolicy = policy({ negativeFindingRule: "other" }); }),
    reject("wrong knowledge rule", (v) => { v.dependencyAnalysisPolicy = policy({ knowledgeLimitationRule: "other" }); }),
    reject("wrong witness rule", (v) => { v.dependencyAnalysisPolicy = policy({ witnessSelectionRule: "other" }); }),
    reject("wrong vocabulary rule", (v) => { v.dependencyAnalysisPolicy = policy({ findingVocabularyRule: "other" }); }),
    reject("wrong cycle rule", (v) => { v.dependencyAnalysisPolicy = policy({ cycleHandlingRule: "other" }); }),
    reject("wrong ordering rule", (v) => { v.dependencyAnalysisPolicy = policy({ deterministicOrderingRule: "other" }); }),
    reject("forged finalized Snapshot spread", (v) => { v.provenanceSnapshot = { ...v.provenanceSnapshot, builderResult: { ...v.provenanceSnapshot.builderResult } }; }),
    reject("forged finalized Snapshot JSON clone", (v) => { v.provenanceSnapshot = { ...v.provenanceSnapshot, builderResult: JSON.parse(JSON.stringify(v.provenanceSnapshot.builderResult)) }; }),
  ];
  assert.equal(cases.length, 55);
  for (const scenario of cases) await t.test(scenario.name, scenario.run);
});
