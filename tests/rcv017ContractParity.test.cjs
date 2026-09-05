const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const contract = require("../dist/contracts/rcv017ClaimEvidenceDependencyContractV1");

const markdownPath = path.join(
  __dirname,
  "..",
  "docs",
  "provenance",
  "rcv017-claim-evidence-dependency-contract-v1.md",
);

test("RCV-017 contract identities and closed catalogs are frozen", () => {
  assert.equal(contract.RCV017_ANALYSIS_SCHEMA_ID, "factbase-claim-evidence-dependency-analysis");
  assert.equal(contract.RCV017_ANALYSIS_SCHEMA_VERSION, "1");
  assert.equal(contract.RCV017_POLICY_SCHEMA_ID, "factbase-dependency-analysis-policy");
  assert.equal(contract.RCV017_POLICY_SCHEMA_VERSION, "1");
  assert.equal(contract.RCV017_ALGORITHM_ID, "factbase-claim-evidence-dependency-algorithm");
  assert.equal(contract.RCV017_ALGORITHM_VERSION, "1");
  assert.equal(contract.RCV017_CANONICALIZATION_ID, "jcs-rfc8785");
  assert.equal(contract.RCV017_CANONICALIZATION_VERSION, "1");
  assert.equal(contract.RCV017_HASH_ALGORITHM, "sha-256");
  assert.deepEqual(contract.RCV017_FINDING_TYPES_V1, [
    "RECORDED_SHARED_ARTIFACT_VERSION",
    "RECORDED_COMMON_UPSTREAM",
    "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE",
    "DEPENDENCY_KNOWLEDGE_INCOMPLETE",
  ]);
});

test("RCV-017 relationship classification is exact and policy cannot enable cites", () => {
  assert.deepEqual(contract.RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_V1, {
    cites: "reference_only",
    quotes: "recorded_informational_dependency",
    incorporates: "recorded_informational_dependency",
    reposts: "recorded_informational_dependency",
    syndicated_from: "recorded_informational_dependency",
    derived_from: "recorded_informational_dependency",
    uses_information_from: "recorded_informational_dependency",
  });
  assert.deepEqual(contract.RCV017_DEPENDENCY_BEARING_RELATIONSHIPS_V1, [
    "quotes",
    "incorporates",
    "reposts",
    "syndicated_from",
    "derived_from",
    "uses_information_from",
  ]);
  assert.deepEqual(contract.RCV017_INPUT_DIRECTIONS_V1, [
    "supports",
    "contradicts",
    "contextualizes",
  ]);
  assert.deepEqual(contract.RCV017_FINDING_DIRECTIONS_V1, [
    "supports",
    "contradicts",
  ]);
});

test("RCV-017 ordering, limits, and duplicate rules mirror the freeze", () => {
  assert.deepEqual(contract.RCV017_DIRECTION_RANK_V1, {
    supports: 1,
    contradicts: 2,
    contextualizes: 3,
  });
  assert.deepEqual(contract.RCV017_FINDING_TYPE_RANK_V1, {
    RECORDED_SHARED_ARTIFACT_VERSION: 1,
    RECORDED_COMMON_UPSTREAM: 2,
    NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE: 3,
    DEPENDENCY_KNOWLEDGE_INCOMPLETE: 4,
  });
  assert.deepEqual(contract.RCV017_LIMIT_FIELDS_V1, [
    "maxEvidenceRelations",
    "maxBindings",
    "maxArtifactVersions",
    "maxStatements",
    "maxDependencyDepth",
    "maxFindings",
    "maxCanonicalBytes",
  ]);
  assert.equal(contract.RCV017_SILENT_DEDUPLICATION_ALLOWED_V1, false);
  assert.equal(contract.RCV017_CALLER_INPUT_ORDER_IS_SEMANTIC_V1, false);
});

test("RCV-017 primitive validation is default-deny and never normalizes", () => {
  const uuid = "00000000-0000-0000-0000-00000000000a";
  const hash = "a".repeat(64);
  assert.equal(contract.isRcv017CanonicalUuidV1(uuid), true);
  assert.equal(contract.isRcv017CanonicalUuidV1(uuid.toUpperCase()), false);
  assert.equal(contract.isRcv017CanonicalUuidV1("not-a-uuid"), false);
  assert.equal(contract.isRcv017Sha256HexV1(hash), true);
  assert.equal(contract.isRcv017Sha256HexV1(hash.toUpperCase()), false);
  assert.equal(contract.isRcv017Sha256HexV1("a".repeat(63)), false);
  assert.equal(contract.isRcv017PositiveSafeIntegerV1(1), true);
  assert.equal(contract.isRcv017PositiveSafeIntegerV1(0), false);
  assert.equal(contract.isRcv017PositiveSafeIntegerV1(-1), false);
  assert.equal(contract.isRcv017PositiveSafeIntegerV1(Number.MAX_SAFE_INTEGER + 1), false);
});

test("RCV-017 top-level and policy field manifests are exact", () => {
  assert.deepEqual(contract.RCV017_ANALYSIS_CANONICAL_FIELDS_V1, [
    "schemaId",
    "schemaVersion",
    "claimVersionId",
    "evidenceRelations",
    "selectedBindings",
    "provenanceSnapshotId",
    "provenanceSnapshotHash",
    "dependencyAnalysisPolicyId",
    "dependencyAnalysisPolicyVersion",
    "dependencyAnalysisPolicyHash",
    "algorithmId",
    "algorithmVersion",
    "algorithmArtifactHash",
    "canonicalizationId",
    "canonicalizationVersion",
    "hashAlgorithm",
    "findings",
  ]);
  assert.deepEqual(contract.RCV017_PERSISTENCE_ENVELOPE_FIELDS_V1, [
    "analysisId",
    "createdAt",
    "canonical",
    "canonicalHash",
  ]);
  assert.equal(contract.RCV017_ANALYSIS_ID_INCLUDED_IN_CANONICAL_V1, false);
  assert.equal(contract.RCV017_CREATED_AT_INCLUDED_IN_CANONICAL_V1, false);
});

test("RCV-017 invariant flags exclude independence, RCV-014, source context, live state, and repair", () => {
  assert.equal(contract.RCV017_GRAPH_DERIVED_INDEPENDENCE_ALLOWED_V1, false);
  assert.equal(contract.RCV017_RCV014_ASSESSMENTS_ARE_ANALYSIS_INPUT_V1, false);
  assert.equal(contract.RCV017_SOURCE_RELATIONSHIPS_AFFECT_FINDINGS_V1, false);
  assert.equal(contract.RCV017_LIVE_STATE_MAY_ALTER_FINALIZED_ANALYSIS_V1, false);
  assert.equal(contract.RCV017_REPAIR_OR_REWRITE_ALLOWED_V1, false);
  assert.equal(contract.RCV017_AGGREGATE_COUNTS_IN_CANONICAL_V1, false);
});

test("RCV-017 Markdown and TypeScript expose the same normative literals", () => {
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const literals = [
    contract.RCV017_ANALYSIS_SCHEMA_ID,
    contract.RCV017_POLICY_SCHEMA_ID,
    contract.RCV017_ALGORITHM_ID,
    contract.RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_ID,
    contract.RCV017_CANONICALIZATION_ID,
    contract.RCV017_HASH_ALGORITHM,
    ...contract.RCV017_FINDING_TYPES_V1,
    ...contract.RCV017_LIMIT_FIELDS_V1,
  ];
  for (const literal of literals) assert.ok(markdown.includes(`\`${literal}\``), literal);
  assert.match(markdown, /No graph-derived independence/);
  assert.match(markdown, /RCV-014 separation/);
  assert.match(markdown, /Source organizational context exclusion/);
  assert.match(markdown, /additional properties are invalid/);
});

test("RCV-017 contract source contains no prohibited Canonical or policy field", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "contracts", "rcv017ClaimEvidenceDependencyContractV1.ts"),
    "utf8",
  );
  const manifests = [
    ...contract.RCV017_ANALYSIS_CANONICAL_FIELDS_V1,
    ...contract.RCV017_POLICY_CANONICAL_FIELDS_V1,
  ];
  for (const forbidden of [
    "truth",
    "credibility",
    "quality",
    "trust",
    "independenceScore",
    "confidence",
    "weight",
    "rank",
    "winner",
    "current",
    "latest",
    "supportRatio",
    "corroborationCount",
    "sourceCount",
  ]) {
    assert.ok(!manifests.includes(forbidden), forbidden);
  }
  assert.ok(!source.includes("Rcv014"));
});

test("RCV-017 adversarial contract matrix rejects all 60 representation attacks", async (t) => {
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const canonicalFields = new Set(contract.RCV017_ANALYSIS_CANONICAL_FIELDS_V1);
  const policyFields = new Set(contract.RCV017_POLICY_CANONICAL_FIELDS_V1);
  const duplicateRules = contract.RCV017_DUPLICATE_RULES_V1;
  const attacks = [
    ["uppercase UUID", !contract.isRcv017CanonicalUuidV1("00000000-0000-0000-0000-00000000000A")],
    ["malformed UUID", !contract.isRcv017CanonicalUuidV1("not-a-uuid")],
    ["unsupported schema version", /Unsupported schema/.test(markdown)],
    ["unsupported policy version", /Unsupported schema, policy,[\s\S]*identities fail closed/.test(markdown)],
    ["unsupported algorithm version", /algorithm.*fail closed/i.test(markdown)],
    ["unsupported canonicalization", /canonicalization.*fail closed/i.test(markdown)],
    ["unsupported hash algorithm", /hash identities fail closed/i.test(markdown)],
    ["extra top-level key", /additional properties are invalid/.test(markdown)],
    ["missing top-level key", /closed object with exactly[\s\S]{0,40}these 17 fields/.test(markdown)],
    ["extra nested key", /Every object described here is closed/.test(markdown)],
    ["duplicate evidence relation", duplicateRules.evidenceRelationIds === "reject"],
    ["duplicate binding ID", duplicateRules.selectedBindingStatementIds === "reject"],
    ["duplicate branch", duplicateRules.branchKeys === "reject"],
    ["relation Evidence mismatch", /Relation and binding Evidence IDs match/.test(markdown)],
    ["binding Evidence mismatch", /bind that Evidence ID/.test(markdown)],
    ["binding Artifact mismatch", /to that ArtifactVersion ID/.test(markdown)],
    ["binding not Snapshot member", /Binding statements and anchors are bound-Snapshot members/.test(markdown)],
    ["empty evidence input", /evidenceRelations` is a non-empty array/.test(markdown)],
    ["relation with no binding", /Every relation requires one or more selected bindings/.test(markdown)],
    ["contextualizes finding", !contract.RCV017_FINDING_DIRECTIONS_V1.includes("contextualizes")],
    ["cites enabled as dependency", !contract.RCV017_DEPENDENCY_BEARING_RELATIONSHIPS_V1.includes("cites")],
    ["empty dependency relationship set", /non-empty\n\+subset|non-empty\s+subset/.test(markdown)],
    ["unknown relationship", /unknown\n\+relationships|unknown\s+relationships/.test(markdown)],
    ["zero maxDepth", !contract.isRcv017PositiveSafeIntegerV1(0)],
    ["unsafe integer limit", !contract.isRcv017PositiveSafeIntegerV1(Number.MAX_SAFE_INTEGER + 1)],
    ["negative limit", !contract.isRcv017PositiveSafeIntegerV1(-1)],
    ["zero limit", !contract.isRcv017PositiveSafeIntegerV1(0)],
    ["over-limit evidence relations", /maxEvidenceRelations.*whole analysis/.test(markdown)],
    ["over-limit bindings", /maxBindings.*whole analysis/.test(markdown)],
    ["over-limit findings", /maxFindings.*whole analysis/.test(markdown)],
    ["Canonical byte overflow", /maxCanonicalBytes.*Exact UTF-8 byte length/.test(markdown)],
    ["shared artifact with one member", /members` contains at least two/.test(markdown)],
    ["shared members with different anchors", /all having that direction and that exact bound/.test(markdown)],
    ["common upstream with one member", /At least two distinct\n\+member|At least two distinct\s+member/.test(markdown)],
    ["common upstream with no positive witness", /At least one member witness has a positive edge count/.test(markdown)],
    ["witness length mismatch", /length equals statement-ID length plus one/.test(markdown)],
    ["witness wrong start anchor", /first ID is the member branch anchor/.test(markdown)],
    ["witness wrong end upstream", /last ID is the finding's exact common upstream/.test(markdown)],
    ["witness foreign statement", /Every statement and ArtifactVersion is in the bound Snapshot/.test(markdown)],
    ["witness reference-only cites edge", /`cites` is ignored for closure traversal/.test(markdown)],
    ["witness repeated node", duplicateRules.witnessArtifactVersionIds === "reject_repeated_node"],
    ["non-minimal witness", /Choose the fewest-edge witness/.test(markdown)],
    ["negative pair same branch", /exactly\n\+two distinct|exactly\s+two distinct/.test(markdown)],
    ["negative pair reversed order", /canonical branch-key order/.test(markdown)],
    ["negative pair shares anchor", /Their\n\+anchors differ|Their\s+anchors differ/.test(markdown)],
    ["knowledge finding empty evidence", /At least one knowledge\s+statement ID or derived-unrecorded ID is required/.test(markdown)],
    ["knowledge uses known-only statement", /`known` is never included/.test(markdown)],
    ["knowledge foreign ArtifactVersion", /ArtifactVersions in\n\+the branch's reached set|ArtifactVersions in\s+the branch's reached set/.test(markdown)],
    ["duplicate finding identity", duplicateRules.findingIdentities === "reject"],
    ["caller order changes Canonical", contract.RCV017_CALLER_INPUT_ORDER_IS_SEMANTIC_V1 === false],
    ["RCV-014 assessment injected", contract.RCV017_RCV014_ASSESSMENTS_ARE_ANALYSIS_INPUT_V1 === false],
    ["SourceRelationship finding injected", contract.RCV017_SOURCE_CONTEXT_INCLUDED_IN_CANONICAL_V1 === false],
    ["independence field injected", !canonicalFields.has("independence")],
    ["score field injected", !canonicalFields.has("score")],
    ["current/latest field injected", !canonicalFields.has("current") && !canonicalFields.has("latest")],
    ["analysisId inside Canonical", !canonicalFields.has("analysisId")],
    ["createdAt inside Canonical", !canonicalFields.has("createdAt")],
    ["aggregate count inserted", contract.RCV017_AGGREGATE_COUNTS_IN_CANONICAL_V1 === false],
    ["uppercase SHA hex", !contract.isRcv017Sha256HexV1("A".repeat(64))],
    ["wrong hash length", !contract.isRcv017Sha256HexV1("a".repeat(63))],
  ];
  assert.equal(attacks.length, 60);
  assert.ok(policyFields.has("maxDependencyDepth"));
  for (const [name, rejected] of attacks) {
    await t.test(name, () => assert.equal(rejected, true));
  }
});
