export const RCV017_ANALYSIS_SCHEMA_ID =
  "factbase-claim-evidence-dependency-analysis" as const;
export const RCV017_ANALYSIS_SCHEMA_VERSION = "1" as const;
export const RCV017_POLICY_SCHEMA_ID =
  "factbase-dependency-analysis-policy" as const;
export const RCV017_POLICY_SCHEMA_VERSION = "1" as const;
export const RCV017_ALGORITHM_ID =
  "factbase-claim-evidence-dependency-algorithm" as const;
export const RCV017_ALGORITHM_VERSION = "1" as const;
export const RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_ID =
  "factbase-dependency-relationship-classification" as const;
export const RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_VERSION = "1" as const;
export const RCV017_CANONICALIZATION_ID = "jcs-rfc8785" as const;
export const RCV017_CANONICALIZATION_VERSION = "1" as const;
export const RCV017_HASH_ALGORITHM = "sha-256" as const;

declare const RCV017_CANONICAL_UUID_V1: unique symbol;
declare const RCV017_SHA256_HEX_V1: unique symbol;
declare const RCV017_POSITIVE_SAFE_INTEGER_V1: unique symbol;
declare const RCV017_CANONICAL_TIMESTAMP_V1: unique symbol;
declare const RCV017_NON_EMPTY_STRING_V1: unique symbol;

export type Rcv017CanonicalUuidV1 = string & {
  readonly [RCV017_CANONICAL_UUID_V1]: true;
};
export type Rcv017Sha256HexV1 = string & {
  readonly [RCV017_SHA256_HEX_V1]: true;
};
export type Rcv017PositiveSafeIntegerV1 = number & {
  readonly [RCV017_POSITIVE_SAFE_INTEGER_V1]: true;
};
export type Rcv017CanonicalTimestampV1 = string & {
  readonly [RCV017_CANONICAL_TIMESTAMP_V1]: true;
};
export type Rcv017NonEmptyStringV1 = string & {
  readonly [RCV017_NON_EMPTY_STRING_V1]: true;
};

export type Rcv017ClaimVersionIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017ClaimVersionEvidenceRelationIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017EvidenceIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017EvidenceArtifactBindingStatementIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017ArtifactVersionIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017ArtifactProvenanceStatementIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017KnowledgeStateStatementIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017ProvenanceSnapshotIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017DependencyAnalysisPolicyIdV1 = Rcv017CanonicalUuidV1;
export type Rcv017AnalysisIdV1 = Rcv017CanonicalUuidV1;

const RCV017_CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RCV017_SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const RCV017_CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function isRcv017CanonicalUuidV1(
  value: unknown,
): value is Rcv017CanonicalUuidV1 {
  return typeof value === "string" && RCV017_CANONICAL_UUID_PATTERN.test(value);
}

export function isRcv017Sha256HexV1(
  value: unknown,
): value is Rcv017Sha256HexV1 {
  return typeof value === "string" && RCV017_SHA256_HEX_PATTERN.test(value);
}

export function isRcv017PositiveSafeIntegerV1(
  value: unknown,
): value is Rcv017PositiveSafeIntegerV1 {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isRcv017CanonicalTimestampV1(
  value: unknown,
): value is Rcv017CanonicalTimestampV1 {
  if (
    typeof value !== "string" ||
    !RCV017_CANONICAL_TIMESTAMP_PATTERN.test(value)
  ) {
    return false;
  }
  const milliseconds = `${value.slice(0, 23)}Z`;
  const parsed = new Date(milliseconds);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === milliseconds;
}

export const RCV017_INPUT_DIRECTIONS_V1 = [
  "supports",
  "contradicts",
  "contextualizes",
] as const;
export const RCV017_FINDING_DIRECTIONS_V1 = [
  "supports",
  "contradicts",
] as const;
export const RCV017_DIRECTION_RANK_V1 = {
  supports: 1,
  contradicts: 2,
  contextualizes: 3,
} as const;

export type Rcv017InputDirectionV1 =
  (typeof RCV017_INPUT_DIRECTIONS_V1)[number];
export type Rcv017FindingDirectionV1 =
  (typeof RCV017_FINDING_DIRECTIONS_V1)[number];

export const RCV017_RELATIONSHIP_CLASSIFICATIONS_V1 = [
  "reference_only",
  "recorded_informational_dependency",
] as const;
export type Rcv017RelationshipClassificationV1 =
  (typeof RCV017_RELATIONSHIP_CLASSIFICATIONS_V1)[number];

export const RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_V1 = {
  cites: "reference_only",
  quotes: "recorded_informational_dependency",
  incorporates: "recorded_informational_dependency",
  reposts: "recorded_informational_dependency",
  syndicated_from: "recorded_informational_dependency",
  derived_from: "recorded_informational_dependency",
  uses_information_from: "recorded_informational_dependency",
} as const;

export const RCV017_DEPENDENCY_BEARING_RELATIONSHIPS_V1 = [
  "quotes",
  "incorporates",
  "reposts",
  "syndicated_from",
  "derived_from",
  "uses_information_from",
] as const;
export type Rcv017DependencyBearingRelationshipV1 =
  (typeof RCV017_DEPENDENCY_BEARING_RELATIONSHIPS_V1)[number];

export interface Rcv017EvidenceRelationInputV1 {
  readonly claimVersionEvidenceRelationId: Rcv017ClaimVersionEvidenceRelationIdV1;
  readonly evidenceId: Rcv017EvidenceIdV1;
  readonly direction: Rcv017InputDirectionV1;
}

export interface Rcv017SelectedBindingInputV1 {
  readonly claimVersionEvidenceRelationId: Rcv017ClaimVersionEvidenceRelationIdV1;
  readonly evidenceArtifactBindingStatementId: Rcv017EvidenceArtifactBindingStatementIdV1;
  readonly evidenceId: Rcv017EvidenceIdV1;
  readonly artifactVersionId: Rcv017ArtifactVersionIdV1;
}

export interface Rcv017BranchKeyV1 {
  readonly claimVersionEvidenceRelationId: Rcv017ClaimVersionEvidenceRelationIdV1;
  readonly evidenceArtifactBindingStatementId: Rcv017EvidenceArtifactBindingStatementIdV1;
}

export interface Rcv017NormalizedWitnessV1 {
  readonly artifactVersionIds: readonly [
    Rcv017ArtifactVersionIdV1,
    ...Rcv017ArtifactVersionIdV1[],
  ];
  readonly artifactProvenanceStatementIds: readonly Rcv017ArtifactProvenanceStatementIdV1[];
}

export interface Rcv017RecordedSharedArtifactVersionFindingV1 {
  readonly type: "RECORDED_SHARED_ARTIFACT_VERSION";
  readonly direction: Rcv017FindingDirectionV1;
  readonly artifactVersionId: Rcv017ArtifactVersionIdV1;
  readonly members: readonly [
    Rcv017BranchKeyV1,
    Rcv017BranchKeyV1,
    ...Rcv017BranchKeyV1[],
  ];
}

export interface Rcv017CommonUpstreamMemberV1 {
  readonly branchKey: Rcv017BranchKeyV1;
  readonly witness: Rcv017NormalizedWitnessV1;
}

export interface Rcv017RecordedCommonUpstreamFindingV1 {
  readonly type: "RECORDED_COMMON_UPSTREAM";
  readonly direction: Rcv017FindingDirectionV1;
  readonly upstreamArtifactVersionId: Rcv017ArtifactVersionIdV1;
  readonly members: readonly [
    Rcv017CommonUpstreamMemberV1,
    Rcv017CommonUpstreamMemberV1,
    ...Rcv017CommonUpstreamMemberV1[],
  ];
}

export interface Rcv017NoRecordedCommonUpstreamWithinScopeFindingV1 {
  readonly type: "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE";
  readonly direction: Rcv017FindingDirectionV1;
  readonly lowerBranchKey: Rcv017BranchKeyV1;
  readonly upperBranchKey: Rcv017BranchKeyV1;
}

export interface Rcv017DependencyKnowledgeIncompleteFindingV1 {
  readonly type: "DEPENDENCY_KNOWLEDGE_INCOMPLETE";
  readonly branchKey: Rcv017BranchKeyV1;
  readonly affectedArtifactVersionIds: readonly [
    Rcv017ArtifactVersionIdV1,
    ...Rcv017ArtifactVersionIdV1[],
  ];
  readonly knowledgeStateStatementIds: readonly Rcv017KnowledgeStateStatementIdV1[];
  readonly derivedUnrecordedArtifactVersionIds: readonly Rcv017ArtifactVersionIdV1[];
}

export const RCV017_FINDING_TYPES_V1 = [
  "RECORDED_SHARED_ARTIFACT_VERSION",
  "RECORDED_COMMON_UPSTREAM",
  "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE",
  "DEPENDENCY_KNOWLEDGE_INCOMPLETE",
] as const;
export const RCV017_FINDING_TYPE_RANK_V1 = {
  RECORDED_SHARED_ARTIFACT_VERSION: 1,
  RECORDED_COMMON_UPSTREAM: 2,
  NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE: 3,
  DEPENDENCY_KNOWLEDGE_INCOMPLETE: 4,
} as const;

export type Rcv017FindingTypeV1 = (typeof RCV017_FINDING_TYPES_V1)[number];
export type Rcv017FindingV1 =
  | Rcv017RecordedSharedArtifactVersionFindingV1
  | Rcv017RecordedCommonUpstreamFindingV1
  | Rcv017NoRecordedCommonUpstreamWithinScopeFindingV1
  | Rcv017DependencyKnowledgeIncompleteFindingV1;

export const RCV017_POLICY_RULES_V1 = {
  evidenceDirectionPartitionRule: "supports_and_contradicts_separate_contextualizes_excluded",
  reflexiveClosureRule: "anchor_depth_zero_then_enabled_dependency_edges_minimum_distance",
  commonUpstreamRule: "same_exact_artifact_version_in_two_or_more_reflexive_branch_closures",
  negativeFindingRule: "unordered_same_direction_pair_with_disjoint_reflexive_closures",
  knowledgeLimitationRule: "snapshot_unknown_partial_or_derived_unrecorded_in_reached_set",
  witnessSelectionRule: "fewest_edges_then_ascii_statement_id_sequence",
  findingVocabularyRule: "rcv017_closed_four_finding_vocabulary_v1",
  cycleHandlingRule: "expand_once_per_branch_at_minimum_distance",
  deterministicOrderingRule: "rcv017_explicit_total_order_v1",
} as const;

export const RCV017_LIMIT_FIELDS_V1 = [
  "maxEvidenceRelations",
  "maxBindings",
  "maxArtifactVersions",
  "maxStatements",
  "maxDependencyDepth",
  "maxFindings",
  "maxCanonicalBytes",
] as const;

export interface Rcv017DependencyAnalysisPolicyCanonicalV1 {
  readonly schemaId: typeof RCV017_POLICY_SCHEMA_ID;
  readonly schemaVersion: typeof RCV017_POLICY_SCHEMA_VERSION;
  readonly policyId: Rcv017DependencyAnalysisPolicyIdV1;
  readonly policyVersion: Rcv017PositiveSafeIntegerV1;
  readonly relationshipClassificationCatalogId: typeof RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_ID;
  readonly relationshipClassificationCatalogVersion: typeof RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_VERSION;
  readonly enabledDependencyRelationships: readonly [
    Rcv017DependencyBearingRelationshipV1,
    ...Rcv017DependencyBearingRelationshipV1[],
  ];
  readonly evidenceDirectionPartitionRule: typeof RCV017_POLICY_RULES_V1.evidenceDirectionPartitionRule;
  readonly reflexiveClosureRule: typeof RCV017_POLICY_RULES_V1.reflexiveClosureRule;
  readonly commonUpstreamRule: typeof RCV017_POLICY_RULES_V1.commonUpstreamRule;
  readonly negativeFindingRule: typeof RCV017_POLICY_RULES_V1.negativeFindingRule;
  readonly knowledgeLimitationRule: typeof RCV017_POLICY_RULES_V1.knowledgeLimitationRule;
  readonly witnessSelectionRule: typeof RCV017_POLICY_RULES_V1.witnessSelectionRule;
  readonly findingVocabularyRule: typeof RCV017_POLICY_RULES_V1.findingVocabularyRule;
  readonly cycleHandlingRule: typeof RCV017_POLICY_RULES_V1.cycleHandlingRule;
  readonly deterministicOrderingRule: typeof RCV017_POLICY_RULES_V1.deterministicOrderingRule;
  readonly maxEvidenceRelations: Rcv017PositiveSafeIntegerV1;
  readonly maxBindings: Rcv017PositiveSafeIntegerV1;
  readonly maxArtifactVersions: Rcv017PositiveSafeIntegerV1;
  readonly maxStatements: Rcv017PositiveSafeIntegerV1;
  readonly maxDependencyDepth: Rcv017PositiveSafeIntegerV1;
  readonly maxFindings: Rcv017PositiveSafeIntegerV1;
  readonly maxCanonicalBytes: Rcv017PositiveSafeIntegerV1;
  readonly canonicalizationId: typeof RCV017_CANONICALIZATION_ID;
  readonly canonicalizationVersion: typeof RCV017_CANONICALIZATION_VERSION;
  readonly hashAlgorithm: typeof RCV017_HASH_ALGORITHM;
}

export interface Rcv017DependencyAnalysisPolicyEnvelopeV1 {
  readonly canonical: Rcv017NonEmptyStringV1;
  readonly canonicalHash: Rcv017Sha256HexV1;
}

export interface Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1 {
  readonly schemaId: typeof RCV017_ANALYSIS_SCHEMA_ID;
  readonly schemaVersion: typeof RCV017_ANALYSIS_SCHEMA_VERSION;
  readonly claimVersionId: Rcv017ClaimVersionIdV1;
  readonly evidenceRelations: readonly [
    Rcv017EvidenceRelationInputV1,
    ...Rcv017EvidenceRelationInputV1[],
  ];
  readonly selectedBindings: readonly [
    Rcv017SelectedBindingInputV1,
    ...Rcv017SelectedBindingInputV1[],
  ];
  readonly provenanceSnapshotId: Rcv017ProvenanceSnapshotIdV1;
  readonly provenanceSnapshotHash: Rcv017Sha256HexV1;
  readonly dependencyAnalysisPolicyId: Rcv017DependencyAnalysisPolicyIdV1;
  readonly dependencyAnalysisPolicyVersion: Rcv017PositiveSafeIntegerV1;
  readonly dependencyAnalysisPolicyHash: Rcv017Sha256HexV1;
  readonly algorithmId: typeof RCV017_ALGORITHM_ID;
  readonly algorithmVersion: typeof RCV017_ALGORITHM_VERSION;
  readonly algorithmArtifactHash: Rcv017Sha256HexV1;
  readonly canonicalizationId: typeof RCV017_CANONICALIZATION_ID;
  readonly canonicalizationVersion: typeof RCV017_CANONICALIZATION_VERSION;
  readonly hashAlgorithm: typeof RCV017_HASH_ALGORITHM;
  readonly findings: readonly Rcv017FindingV1[];
}

export interface Rcv017ClaimEvidenceDependencyAnalysisPersistenceEnvelopeV1 {
  readonly analysisId: Rcv017AnalysisIdV1;
  readonly createdAt: Rcv017CanonicalTimestampV1;
  readonly canonical: Rcv017NonEmptyStringV1;
  readonly canonicalHash: Rcv017Sha256HexV1;
}

export const RCV017_ANALYSIS_CANONICAL_FIELDS_V1 = [
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
] as const;

export const RCV017_POLICY_CANONICAL_FIELDS_V1 = [
  "schemaId",
  "schemaVersion",
  "policyId",
  "policyVersion",
  "relationshipClassificationCatalogId",
  "relationshipClassificationCatalogVersion",
  "enabledDependencyRelationships",
  "evidenceDirectionPartitionRule",
  "reflexiveClosureRule",
  "commonUpstreamRule",
  "negativeFindingRule",
  "knowledgeLimitationRule",
  "witnessSelectionRule",
  "findingVocabularyRule",
  "cycleHandlingRule",
  "deterministicOrderingRule",
  ...RCV017_LIMIT_FIELDS_V1,
  "canonicalizationId",
  "canonicalizationVersion",
  "hashAlgorithm",
] as const;

export const RCV017_PERSISTENCE_ENVELOPE_FIELDS_V1 = [
  "analysisId",
  "createdAt",
  "canonical",
  "canonicalHash",
] as const;

export const RCV017_ORDERING_V1 = {
  comparison: "ascii_lexicographic_ascending",
  evidenceRelations: ["claimVersionEvidenceRelationId"],
  selectedBindings: [
    "claimVersionEvidenceRelationId",
    "evidenceArtifactBindingStatementId",
  ],
  branches: [
    "claimVersionEvidenceRelationId",
    "evidenceArtifactBindingStatementId",
  ],
  directionsByRank: RCV017_INPUT_DIRECTIONS_V1,
  findingsByRank: RCV017_FINDING_TYPES_V1,
  findingMembers: [
    "claimVersionEvidenceRelationId",
    "evidenceArtifactBindingStatementId",
  ],
  uuidSets: "ascii_lexicographic_ascending",
} as const;

export const RCV017_DUPLICATE_RULES_V1 = {
  evidenceRelationIds: "reject",
  selectedBindingStatementIds: "reject",
  branchKeys: "reject",
  findingIdentities: "reject",
  findingMemberBranchKeys: "reject",
  commonUpstreamMemberBranchKeys: "reject",
  affectedArtifactVersionIds: "reject",
  knowledgeStateStatementIds: "reject",
  derivedUnrecordedArtifactVersionIds: "reject",
  witnessArtifactVersionIds: "reject_repeated_node",
  enabledDependencyRelationships: "reject",
} as const;

export const RCV017_LIMIT_COUNTING_V1 = {
  maxEvidenceRelations: "selected_evidence_relation_records_whole_analysis",
  maxBindings: "selected_binding_records_whole_analysis",
  maxArtifactVersions: "distinct_reached_artifact_version_ids_whole_analysis",
  maxStatements: "distinct_considered_dependency_bearing_statement_ids_whole_analysis",
  maxDependencyDepth: "minimum_edge_distance_per_branch_inclusive_boundary_not_expanded",
  maxFindings: "final_canonical_finding_count_whole_analysis",
  maxCanonicalBytes: "exact_final_jcs_canonical_utf8_bytes",
  violation: "technical_whole_analysis_failure",
  truncationAllowed: false,
} as const;

export const RCV017_WITNESS_RULES_V1 = {
  direction: "downstream_to_upstream",
  artifactVersionLengthEqualsStatementLengthPlusOne: true,
  anchorWitnessIsDependencyPath: false,
  repeatedArtifactVersionAllowed: false,
  selection: "fewest_edges_then_ascii_lexicographic_ordered_statement_id_sequence",
  alternatePathCountCanonicalized: false,
} as const;

export const RCV017_KNOWLEDGE_SOURCE_RULE_V1 = {
  source: "bound_finalized_rcv016_provenance_snapshot_only",
  statementScope: "upstream_provenance",
  includedStates: ["unknown", "partial"],
  knownCancelsUnknownOrPartial: false,
  usesSnapshotDerivedUnrecordedStates: true,
  liveReadAllowed: false,
  latestOrWinnerResolution: false,
} as const;

export const RCV017_GRAPH_DERIVED_INDEPENDENCE_ALLOWED_V1 = false as const;
export const RCV017_RCV014_ASSESSMENTS_ARE_ANALYSIS_INPUT_V1 = false as const;
export const RCV017_SOURCE_RELATIONSHIPS_AFFECT_FINDINGS_V1 = false as const;
export const RCV017_SOURCE_CONTEXT_INCLUDED_IN_CANONICAL_V1 = false as const;
export const RCV017_LIVE_STATE_MAY_ALTER_FINALIZED_ANALYSIS_V1 = false as const;
export const RCV017_REPAIR_OR_REWRITE_ALLOWED_V1 = false as const;
export const RCV017_AGGREGATE_COUNTS_IN_CANONICAL_V1 = false as const;
export const RCV017_ANALYSIS_ID_INCLUDED_IN_CANONICAL_V1 = false as const;
export const RCV017_CREATED_AT_INCLUDED_IN_CANONICAL_V1 = false as const;
export const RCV017_CALLER_INPUT_ORDER_IS_SEMANTIC_V1 = false as const;
export const RCV017_SILENT_DEDUPLICATION_ALLOWED_V1 = false as const;
export const RCV017_BUILDER_IDENTITY_SEPARATE_FROM_ALGORITHM_V1 = false as const;
export const RCV017_SEPARATE_TRAVERSAL_DIAGNOSTICS_V1 = false as const;
export const RCV017_HISTORICAL_SUPERSESSION_WINNER_RESOLUTION_V1 = false as const;

export const RCV017_TECHNICAL_FAILURE_CATEGORIES_V1 = [
  "validation_failure",
  "unsupported_version",
  "limit_failure",
  "integrity_parity_failure",
] as const;

export type Rcv017TechnicalFailureCategoryV1 =
  (typeof RCV017_TECHNICAL_FAILURE_CATEGORIES_V1)[number];
