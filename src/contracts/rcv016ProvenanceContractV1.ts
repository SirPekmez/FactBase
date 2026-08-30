export const RCV016_PROVENANCE_CONTRACT_ID =
  "factbase-evidence-provenance-contract" as const;
export const RCV016_PROVENANCE_CONTRACT_VERSION = "1" as const;
export const RCV016_CANONICALIZATION_ID = "jcs-rfc8785" as const;
export const RCV016_CANONICALIZATION_VERSION = "1" as const;
export const RCV016_HASH_ALGORITHM = "sha-256" as const;

declare const RCV016_CANONICAL_UUID_V1: unique symbol;
declare const RCV016_CANONICAL_TIMESTAMP_V1: unique symbol;
declare const RCV016_SHA256_HEX_V1: unique symbol;
declare const RCV016_NON_EMPTY_STRING_V1: unique symbol;
declare const RCV016_ABSOLUTE_URL_STRING_V1: unique symbol;
declare const RCV016_MEDIA_TYPE_V1: unique symbol;
declare const RCV016_SOURCE_ID_V1: unique symbol;
declare const RCV016_SOURCE_VERSION_ID_V1: unique symbol;
declare const RCV016_ARTIFACT_ID_V1: unique symbol;
declare const RCV016_ARTIFACT_VERSION_ID_V1: unique symbol;
declare const RCV016_EVIDENCE_ID_V1: unique symbol;
declare const RCV016_ARTIFACT_PROVENANCE_STATEMENT_ID_V1: unique symbol;
declare const RCV016_SOURCE_RELATIONSHIP_STATEMENT_ID_V1: unique symbol;
declare const RCV016_ARTIFACT_SOURCE_ATTRIBUTION_ID_V1: unique symbol;
declare const RCV016_EVIDENCE_ARTIFACT_BINDING_ID_V1: unique symbol;
declare const RCV016_KNOWLEDGE_STATE_STATEMENT_ID_V1: unique symbol;
declare const RCV016_PROVENANCE_SNAPSHOT_ID_V1: unique symbol;

export type Rcv016CanonicalUuidV1 = string & {
  readonly [RCV016_CANONICAL_UUID_V1]: true;
};
export type Rcv016CanonicalTimestampV1 = string & {
  readonly [RCV016_CANONICAL_TIMESTAMP_V1]: true;
};
export type Rcv016Sha256HexV1 = string & {
  readonly [RCV016_SHA256_HEX_V1]: true;
};
export type Rcv016NonEmptyStringV1 = string & {
  readonly [RCV016_NON_EMPTY_STRING_V1]: true;
};
export type Rcv016AbsoluteUrlStringV1 = Rcv016NonEmptyStringV1 & {
  readonly [RCV016_ABSOLUTE_URL_STRING_V1]: true;
};
export type Rcv016MediaTypeV1 = Rcv016NonEmptyStringV1 & {
  readonly [RCV016_MEDIA_TYPE_V1]: true;
};
export type Rcv016SourceIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_SOURCE_ID_V1]: true;
};
export type Rcv016SourceVersionIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_SOURCE_VERSION_ID_V1]: true;
};
export type Rcv016ArtifactIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_ARTIFACT_ID_V1]: true;
};
export type Rcv016ArtifactVersionIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_ARTIFACT_VERSION_ID_V1]: true;
};
export type Rcv016EvidenceIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_EVIDENCE_ID_V1]: true;
};
export type Rcv016ArtifactProvenanceStatementIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_ARTIFACT_PROVENANCE_STATEMENT_ID_V1]: true;
};
export type Rcv016SourceRelationshipStatementIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_SOURCE_RELATIONSHIP_STATEMENT_ID_V1]: true;
};
export type Rcv016ArtifactSourceAttributionIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_ARTIFACT_SOURCE_ATTRIBUTION_ID_V1]: true;
};
export type Rcv016EvidenceArtifactBindingIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_EVIDENCE_ARTIFACT_BINDING_ID_V1]: true;
};
export type Rcv016KnowledgeStateStatementIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_KNOWLEDGE_STATE_STATEMENT_ID_V1]: true;
};
export type Rcv016ProvenanceSnapshotIdV1 = Rcv016CanonicalUuidV1 & {
  readonly [RCV016_PROVENANCE_SNAPSHOT_ID_V1]: true;
};

export const RCV016_PROVENANCE_NODE_TYPES_V1 = [
  "Source",
  "SourceVersion",
  "Artifact",
  "ArtifactVersion",
  "Evidence",
] as const;

export type Rcv016ProvenanceNodeTypeV1 =
  (typeof RCV016_PROVENANCE_NODE_TYPES_V1)[number];

export const RCV016_SOURCE_VERSION_METADATA_SCHEMA_ID =
  "factbase-source-version-metadata" as const;
export const RCV016_SOURCE_VERSION_METADATA_SCHEMA_VERSION = "1" as const;

export const RCV016_SOURCE_LOCATOR_KINDS_V1 = [
  "homepage_url",
  "profile_url",
  "handle",
  "external_identifier",
] as const;
export const RCV016_SOURCE_LOCATOR_ORDERING_V1 = [
  "kind",
  "namespace",
  "value",
] as const;
export const RCV016_SOURCE_LOCATOR_NULL_NAMESPACE_SORTS_FIRST_V1 = true as const;
export const RCV016_SOURCE_LOCATOR_EXACT_DUPLICATES_ALLOWED_V1 = false as const;
export const RCV016_SOURCE_LOCATOR_COMPARISON_V1 =
  "ascii_lexicographic_ascending" as const;
export const RCV016_SOURCE_METADATA_CANONICAL_TRANSFORMS_V1 = {
  urlNormalization: false,
  caseFolding: false,
  unicodeNormalization: false,
  trimming: false,
} as const;

export type Rcv016SourceLocatorKindV1 =
  (typeof RCV016_SOURCE_LOCATOR_KINDS_V1)[number];

export type Rcv016SourceLocatorV1 =
  | {
      readonly kind: "homepage_url" | "profile_url";
      readonly value: Rcv016AbsoluteUrlStringV1;
      readonly namespace: null;
    }
  | {
      readonly kind: "handle" | "external_identifier";
      readonly value: Rcv016NonEmptyStringV1;
      readonly namespace: Rcv016NonEmptyStringV1;
    };

interface Rcv016SourceVersionMetadataBaseV1 {
  readonly schema: {
    readonly id: typeof RCV016_SOURCE_VERSION_METADATA_SCHEMA_ID;
    readonly version: typeof RCV016_SOURCE_VERSION_METADATA_SCHEMA_VERSION;
  };
}

export type Rcv016SourceVersionMetadataV1 =
  | (Rcv016SourceVersionMetadataBaseV1 & {
      readonly displayName: Rcv016NonEmptyStringV1;
      readonly observedLocators: readonly Rcv016SourceLocatorV1[];
    })
  | (Rcv016SourceVersionMetadataBaseV1 & {
      readonly displayName: null;
      readonly observedLocators: readonly [
        Rcv016SourceLocatorV1,
        ...Rcv016SourceLocatorV1[],
      ];
    });

export const RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_ID =
  "factbase-artifact-version-capture" as const;
export const RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_VERSION = "1" as const;
export const RCV016_CAPTURE_TIMESTAMP_FORMAT_V1 =
  "utc_iso_8601_six_fractional_digits" as const;
export const RCV016_MEDIA_TYPE_FORMAT_V1 =
  "lowercase_ascii_without_parameters" as const;
export const RCV016_CAPTURE_CANONICALIZATION_V1 = {
  id: RCV016_CANONICALIZATION_ID,
  version: RCV016_CANONICALIZATION_VERSION,
  hashAlgorithm: RCV016_HASH_ALGORITHM,
} as const;

interface Rcv016ArtifactVersionCaptureBaseV1 {
  readonly schema: {
    readonly id: typeof RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_ID;
    readonly version: typeof RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_VERSION;
  };
  readonly locator: Rcv016NonEmptyStringV1 | null;
  readonly mediaType: Rcv016MediaTypeV1 | null;
  readonly title: Rcv016NonEmptyStringV1 | null;
  readonly publishedAt: Rcv016CanonicalTimestampV1 | null;
  readonly observedAt: Rcv016CanonicalTimestampV1;
}

export type Rcv016ArtifactVersionCaptureV1 =
  | (Rcv016ArtifactVersionCaptureBaseV1 & {
      readonly retrievedAt: Rcv016CanonicalTimestampV1;
      readonly representation: {
        readonly kind: "captured_bytes";
        readonly hashAlgorithm: typeof RCV016_HASH_ALGORITHM;
        readonly contentHash: Rcv016Sha256HexV1;
      };
    })
  | (Rcv016ArtifactVersionCaptureBaseV1 & {
      readonly retrievedAt: Rcv016CanonicalTimestampV1 | null;
      readonly representation: {
        readonly kind: "metadata_only";
        readonly hashAlgorithm: null;
        readonly contentHash: null;
      };
    });

export const RCV016_ARTIFACT_CAPTURE_REPRESENTATION_KINDS_V1 = [
  "captured_bytes",
  "metadata_only",
] as const;

export const RCV016_FOUNDATION_SCHEMA_ID =
  "factbase-provenance-foundation" as const;
export const RCV016_FOUNDATION_SCHEMA_VERSION = "1" as const;
export const RCV016_FOUNDATION_KINDS_V1 = [
  "evidence_reference",
  "artifact_version_reference",
  "imported_assertion",
  "deterministic_method",
] as const;
export const RCV016_DETERMINISTIC_METHOD_INPUT_REFERENCE_TYPES_V1 = [
  "evidence",
  "artifact_version",
  "provenance_snapshot",
] as const;
export const RCV016_FOUNDATION_ORDERING_V1 = [
  "variant_specific_total_sort_key",
] as const;
export const RCV016_FOUNDATION_COMPARISON_V1 =
  "ascii_lexicographic_ascending" as const;
export const RCV016_FOUNDATION_EXACT_DUPLICATES_ALLOWED_V1 = false as const;
export const RCV016_MANUAL_REVIEW_IS_FOUNDATION_KIND_V1 = false as const;
export const RCV016_FOUNDATION_ITEM_SORT_KEYS_V1 = {
  evidence_reference: ["kind", "evidenceId"],
  artifact_version_reference: ["kind", "artifactVersionId"],
  imported_assertion: ["kind", "referenceType", "reference"],
  deterministic_method: [
    "kind",
    "methodId",
    "methodVersion",
    "canonicalizedInputReferences",
  ],
} as const;
export const RCV016_FOUNDATION_INPUT_REFERENCE_SORT_KEYS_V1 = {
  evidence: ["referenceType", "referenceId"],
  artifact_version: ["referenceType", "referenceId"],
  provenance_snapshot: ["referenceType", "referenceId"],
} as const;
export const RCV016_FOUNDATION_INPUT_REFERENCES_EXACT_DUPLICATES_ALLOWED_V1 =
  false as const;
export const RCV016_FOUNDATION_SORT_KEYS_ARE_TOTAL_AND_INJECTIVE_V1 = true as const;

export type Rcv016DeterministicMethodInputReferenceV1 =
  | {
      readonly referenceType: "evidence";
      readonly referenceId: Rcv016EvidenceIdV1;
    }
  | {
      readonly referenceType: "artifact_version";
      readonly referenceId: Rcv016ArtifactVersionIdV1;
    }
  | {
      readonly referenceType: "provenance_snapshot";
      readonly referenceId: Rcv016ProvenanceSnapshotIdV1;
    };

export type Rcv016FoundationItemV1 =
  | {
      readonly kind: "evidence_reference";
      readonly evidenceId: Rcv016EvidenceIdV1;
    }
  | {
      readonly kind: "artifact_version_reference";
      readonly artifactVersionId: Rcv016ArtifactVersionIdV1;
    }
  | {
      readonly kind: "imported_assertion";
      readonly referenceType: "import_run" | "external_record";
      readonly reference: Rcv016NonEmptyStringV1;
    }
  | {
      readonly kind: "deterministic_method";
      readonly methodId: Rcv016NonEmptyStringV1;
      readonly methodVersion: Rcv016NonEmptyStringV1;
      readonly inputReferences: readonly [
        Rcv016DeterministicMethodInputReferenceV1,
        ...Rcv016DeterministicMethodInputReferenceV1[],
      ];
    };

export interface Rcv016FoundationV1 {
  readonly schema: {
    readonly id: typeof RCV016_FOUNDATION_SCHEMA_ID;
    readonly version: typeof RCV016_FOUNDATION_SCHEMA_VERSION;
  };
  readonly items: readonly [Rcv016FoundationItemV1, ...Rcv016FoundationItemV1[]];
}

export const RCV016_STATEMENT_FAMILIES_V1 = [
  "ArtifactProvenanceStatement",
  "SourceRelationshipStatement",
  "ArtifactSourceAttribution",
  "EvidenceArtifactBinding",
  "KnowledgeStateStatement",
] as const;

export type Rcv016ProvenanceStatementFamilyV1 =
  (typeof RCV016_STATEMENT_FAMILIES_V1)[number];

export const RCV016_INITIATOR_TYPES_V1 = [
  "human",
  "system",
  "importer",
  "agent",
] as const;

export interface Rcv016InitiatorV1 {
  readonly type: (typeof RCV016_INITIATOR_TYPES_V1)[number];
  readonly id: Rcv016NonEmptyStringV1 | null;
}

interface Rcv016StatementHistoricalFieldsV1 {
  readonly observedAt: Rcv016CanonicalTimestampV1;
  readonly initiator: Rcv016InitiatorV1 | null;
  readonly rationale: Rcv016NonEmptyStringV1 | null;
  readonly foundation: Rcv016FoundationV1 | null;
  readonly createdAt: Rcv016CanonicalTimestampV1;
}

interface Rcv016NonTimeBoundStatementFieldsV1 {
  readonly validFrom: null;
  readonly validTo: null;
}

interface Rcv016TimeIntervalCapableStatementFieldsV1 {
  readonly validFrom: Rcv016CanonicalTimestampV1 | null;
  readonly validTo: Rcv016CanonicalTimestampV1 | null;
}

type Rcv016RelationshipForFamilyV1<
  Family extends Rcv016ProvenanceStatementFamilyV1,
> = Extract<Rcv016AllowedRelationshipV1, { readonly family: Family }>["relationship"];

export type Rcv016ArtifactProvenanceStatementV1 =
  Rcv016StatementHistoricalFieldsV1 &
    Rcv016NonTimeBoundStatementFieldsV1 & {
      readonly family: "ArtifactProvenanceStatement";
      readonly statementId: Rcv016ArtifactProvenanceStatementIdV1;
      readonly subjectArtifactVersionId: Rcv016ArtifactVersionIdV1;
      readonly relationship: Rcv016RelationshipForFamilyV1<"ArtifactProvenanceStatement">;
      readonly objectArtifactVersionId: Rcv016ArtifactVersionIdV1;
      readonly supersedesStatementId: Rcv016ArtifactProvenanceStatementIdV1 | null;
    };

export type Rcv016SourceRelationshipStatementV1 =
  Rcv016StatementHistoricalFieldsV1 &
    {
      readonly family: "SourceRelationshipStatement";
      readonly statementId: Rcv016SourceRelationshipStatementIdV1;
      readonly subjectSourceId: Rcv016SourceIdV1;
      readonly objectSourceId: Rcv016SourceIdV1;
      readonly supersedesStatementId: Rcv016SourceRelationshipStatementIdV1 | null;
    } &
    (
      | (Rcv016NonTimeBoundStatementFieldsV1 & {
          readonly relationship: "alias_of" | "successor_of";
        })
      | (Rcv016TimeIntervalCapableStatementFieldsV1 & {
          readonly relationship: "part_of" | "controlled_by" | "operated_by";
        })
    );

export type Rcv016ArtifactSourceAttributionV1 =
  Rcv016StatementHistoricalFieldsV1 &
    Rcv016NonTimeBoundStatementFieldsV1 & {
      readonly family: "ArtifactSourceAttribution";
      readonly statementId: Rcv016ArtifactSourceAttributionIdV1;
      readonly subjectArtifactVersionId: Rcv016ArtifactVersionIdV1;
      readonly relationship: Rcv016RelationshipForFamilyV1<"ArtifactSourceAttribution">;
      readonly objectSourceVersionId: Rcv016SourceVersionIdV1;
      readonly supersedesStatementId: Rcv016ArtifactSourceAttributionIdV1 | null;
    };

export type Rcv016EvidenceArtifactBindingV1 =
  Rcv016StatementHistoricalFieldsV1 &
    Rcv016NonTimeBoundStatementFieldsV1 & {
      readonly family: "EvidenceArtifactBinding";
      readonly statementId: Rcv016EvidenceArtifactBindingIdV1;
      readonly subjectEvidenceId: Rcv016EvidenceIdV1;
      readonly relationship: Rcv016RelationshipForFamilyV1<"EvidenceArtifactBinding">;
      readonly objectArtifactVersionId: Rcv016ArtifactVersionIdV1;
      readonly supersedesStatementId: Rcv016EvidenceArtifactBindingIdV1 | null;
    };

export type Rcv016KnowledgeStateStatementV1 =
  Rcv016StatementHistoricalFieldsV1 &
    Rcv016NonTimeBoundStatementFieldsV1 & {
      readonly family: "KnowledgeStateStatement";
      readonly statementId: Rcv016KnowledgeStateStatementIdV1;
      readonly subjectArtifactVersionId: Rcv016ArtifactVersionIdV1;
      readonly scope: typeof RCV016_KNOWLEDGE_SCOPE_V1;
      readonly state: Rcv016PersistedKnowledgeStateV1;
      readonly supersedesStatementId: Rcv016KnowledgeStateStatementIdV1 | null;
    };

export type Rcv016ProvenanceStatementV1 =
  | Rcv016ArtifactProvenanceStatementV1
  | Rcv016SourceRelationshipStatementV1
  | Rcv016ArtifactSourceAttributionV1
  | Rcv016EvidenceArtifactBindingV1
  | Rcv016KnowledgeStateStatementV1;

export const RCV016_STATEMENT_TEMPORAL_SEMANTICS_V1 = {
  timeIntervalCapableSourceRelationships: [
    "part_of",
    "controlled_by",
    "operated_by",
  ],
  nonTimeBoundSourceRelationships: ["alias_of", "successor_of"],
  nonTimeBoundFamilies: [
    "ArtifactProvenanceStatement",
    "ArtifactSourceAttribution",
    "EvidenceArtifactBinding",
    "KnowledgeStateStatement",
  ],
  nonTimeBoundValidFrom: null,
  nonTimeBoundValidTo: null,
  timeBoundNullValidFromMeaning: "asserted_validity_start_unknown",
  timeBoundNullValidToMeaning: "asserted_validity_end_unknown_not_currently_active",
  nonTimeBoundNullMeaning: "not_applicable_no_real_world_validity_interval_assertion",
  nonTimeBoundNullDoesNotMean: [
    "unknown_start",
    "unknown_end",
    "currently_active",
    "beginning_of_time",
    "forever",
  ],
  bothValidityBoundsRequireValidFromAtOrBeforeValidTo: true,
} as const;

export const RCV016_KNOWLEDGE_SCOPE_V1 = "upstream_provenance" as const;

export const RCV016_KNOWLEDGE_STATES_V1 = [
  "unrecorded",
  "unknown",
  "partial",
  "known",
] as const;

export type Rcv016KnowledgeStateV1 =
  (typeof RCV016_KNOWLEDGE_STATES_V1)[number];

export const RCV016_PERSISTED_KNOWLEDGE_STATES_V1 = [
  "unknown",
  "partial",
  "known",
] as const;

export type Rcv016PersistedKnowledgeStateV1 =
  (typeof RCV016_PERSISTED_KNOWLEDGE_STATES_V1)[number];
export const RCV016_KNOWLEDGE_STATE_SUBJECT_TYPE_V1 = "ArtifactVersion" as const;
export const RCV016_DERIVED_UNRECORDED_STATE_SCOPE_V1 =
  RCV016_KNOWLEDGE_SCOPE_V1;
export const RCV016_DERIVED_UNRECORDED_STATE_VALUE_V1 = "unrecorded" as const;

export interface Rcv016DerivedUnrecordedStateV1 {
  readonly artifactVersionId: Rcv016ArtifactVersionIdV1;
  readonly scope: typeof RCV016_DERIVED_UNRECORDED_STATE_SCOPE_V1;
  readonly state: typeof RCV016_DERIVED_UNRECORDED_STATE_VALUE_V1;
}

export const RCV016_DERIVED_UNRECORDED_STATE_FIELDS_V1 = [
  "artifactVersionId",
  "scope",
  "state",
] as const;
export const RCV016_DERIVED_UNRECORDED_STATE_ORDER_V1 = [
  "artifactVersionId",
] as const;
export const RCV016_DERIVED_UNRECORDED_STATE_SEMANTICS_V1 = {
  persisted: false,
  subjectDomain:
    "artifact_versions_with_root_or_included_membership_in_finalized_snapshot_model",
  consideredKnowledgeStateStatements:
    "knowledge_state_statements_in_same_finalized_snapshot_model_for_subject_and_upstream_provenance_scope",
  deriveExactlyOneWhenConsideredSetIsEmpty: true,
  deriveNoneWhenConsideredSetIsNonEmpty: true,
  latestCurrentWinnerOrSupersessionResolution: false,
  uniqueSemanticKey: "artifactVersionId",
  exactDuplicatesAllowed: false,
  canonicalIdRepresentation: "lowercase_canonical_uuid",
  canonicalOrder: "artifactVersionId_ascii_lexicographic_ascending",
  canonicalizationId: RCV016_CANONICALIZATION_ID,
  canonicalizationVersion: RCV016_CANONICALIZATION_VERSION,
  liveDatabaseReadsMayAffectFinalizedSnapshot: false,
  requiredSnapshotCanonicalField: true,
  emptyResultRepresentation: "empty_array",
} as const;

export const RCV016_APPEND_ONLY_CONTRACT_OBJECTS_V1 = [
  "Source",
  "SourceVersion",
  "Artifact",
  "ArtifactVersion",
  "ArtifactProvenanceStatement",
  "SourceRelationshipStatement",
  "ArtifactSourceAttribution",
  "EvidenceArtifactBinding",
  "KnowledgeStateStatement",
  "ProvenanceSnapshot",
  "ProvenanceSnapshotMembership",
] as const;

export type Rcv016AppendOnlyContractObjectV1 =
  (typeof RCV016_APPEND_ONLY_CONTRACT_OBJECTS_V1)[number];

export const RCV016_PROVENANCE_ALLOW_MATRIX_V1 = [
  {
    subjectType: "ArtifactVersion",
    relationship: "cites",
    objectType: "ArtifactVersion",
    family: "ArtifactProvenanceStatement",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "quotes",
    objectType: "ArtifactVersion",
    family: "ArtifactProvenanceStatement",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "incorporates",
    objectType: "ArtifactVersion",
    family: "ArtifactProvenanceStatement",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "reposts",
    objectType: "ArtifactVersion",
    family: "ArtifactProvenanceStatement",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "syndicated_from",
    objectType: "ArtifactVersion",
    family: "ArtifactProvenanceStatement",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "derived_from",
    objectType: "ArtifactVersion",
    family: "ArtifactProvenanceStatement",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "uses_information_from",
    objectType: "ArtifactVersion",
    family: "ArtifactProvenanceStatement",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "authored_by",
    objectType: "SourceVersion",
    family: "ArtifactSourceAttribution",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "published_by",
    objectType: "SourceVersion",
    family: "ArtifactSourceAttribution",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "hosted_by",
    objectType: "SourceVersion",
    family: "ArtifactSourceAttribution",
  },
  {
    subjectType: "ArtifactVersion",
    relationship: "issued_by",
    objectType: "SourceVersion",
    family: "ArtifactSourceAttribution",
  },
  {
    subjectType: "Source",
    relationship: "alias_of",
    objectType: "Source",
    family: "SourceRelationshipStatement",
  },
  {
    subjectType: "Source",
    relationship: "successor_of",
    objectType: "Source",
    family: "SourceRelationshipStatement",
  },
  {
    subjectType: "Source",
    relationship: "part_of",
    objectType: "Source",
    family: "SourceRelationshipStatement",
  },
  {
    subjectType: "Source",
    relationship: "controlled_by",
    objectType: "Source",
    family: "SourceRelationshipStatement",
  },
  {
    subjectType: "Source",
    relationship: "operated_by",
    objectType: "Source",
    family: "SourceRelationshipStatement",
  },
  {
    subjectType: "Evidence",
    relationship: "bound_to",
    objectType: "ArtifactVersion",
    family: "EvidenceArtifactBinding",
  },
] as const;

export type Rcv016AllowedRelationshipV1 =
  (typeof RCV016_PROVENANCE_ALLOW_MATRIX_V1)[number];
export type Rcv016RelationshipTypeV1 =
  Rcv016AllowedRelationshipV1["relationship"];

export const RCV016_CONFLICT_SEMANTICS_V1 = {
  representation: "deterministic_read_graph_diagnosis_only",
  positiveRuleExists: false,
  diagnosticsAlwaysEmpty: true,
  semanticIncompatibilityProducesConflict: false,
  explicitDisputeProducesConflict: false,
  multipleUpstreamParentsProduceConflict: false,
  supersessionProducesConflict: false,
  cycleProducesConflict: false,
  knowledgeState: false,
  provenanceRelationship: false,
  persistedStatementRelationship: false,
  changesDeletesSupersedesOrPrioritizesStatements: false,
} as const;

export const RCV016_CONFLICT_DIAGNOSTIC_CATALOG_ID =
  "factbase-provenance-conflict-diagnostics" as const;
export const RCV016_CONFLICT_DIAGNOSTIC_CATALOG_VERSION = "1" as const;
export const RCV016_CONFLICT_DIAGNOSTIC_CODES_V1 = [] as const;
export type Rcv016ConflictDiagnosticCodeV1 =
  (typeof RCV016_CONFLICT_DIAGNOSTIC_CODES_V1)[number];
export type Rcv016ConflictDiagnosticsV1 = readonly [];

export const RCV016_CYCLE_DIAGNOSTIC_CATALOG_ID =
  "factbase-provenance-cycle-diagnostics" as const;
export const RCV016_CYCLE_DIAGNOSTIC_CATALOG_VERSION = "1" as const;
export const RCV016_CYCLE_DIAGNOSTIC_CODES_V1 = [
  "artifact_provenance_cycle_detected",
] as const;
export type Rcv016CycleDiagnosticCodeV1 =
  (typeof RCV016_CYCLE_DIAGNOSTIC_CODES_V1)[number];

export interface Rcv016ArtifactProvenanceCycleDiagnosticV1 {
  readonly code: "artifact_provenance_cycle_detected";
  readonly artifactVersionIds: readonly [
    Rcv016ArtifactVersionIdV1,
    Rcv016ArtifactVersionIdV1,
    ...Rcv016ArtifactVersionIdV1[],
  ];
  readonly statementIds: readonly [
    Rcv016ArtifactProvenanceStatementIdV1,
    ...Rcv016ArtifactProvenanceStatementIdV1[],
  ];
}
export type Rcv016CycleDiagnosticV1 =
  Rcv016ArtifactProvenanceCycleDiagnosticV1;

export const RCV016_CYCLE_DIAGNOSTIC_CANONICALIZATION_V1 = {
  inputRelationships: "all_seven_v1_content_provenance_relationships_only",
  pathMustBeClosed: true,
  statementCountEqualsDirectedEdgeCount: true,
  startSelection:
    "ascii_lexicographically_smallest_jcs_cycle_rotation_preserving_direction",
  reverseDirectionEquivalent: false,
  payloadFields: ["code", "artifactVersionIds", "statementIds"],
  identityKey:
    "sha256_of_jcs_rfc8785_payload_code_artifactVersionIds_statementIds",
  diagnosticSortKey: ["catalog_code_ordinal", "diagnostic_identity_key"],
  exactDuplicateIdentityKeysAllowed: false,
} as const;

export const RCV016_ALIAS_OF_CANONICALIZATION_V1 = {
  relationship: "alias_of",
  readSemantics: "symmetric",
  persistedDirection:
    "lexicographically_smaller_canonical_source_id_to_larger",
  canonicalIdRepresentation: "lowercase_uuid_string",
  comparison: "ascii_lexicographic_ascending",
  selfAlias: "forbidden",
  reverseDuplicate: "forbidden",
  persistedDirectionHasDomainMeaning: false,
} as const;

export const RCV016_SNAPSHOT_MEMBERSHIP_TARGET_TYPES_V1 = [
  "ArtifactVersion",
  "SourceVersion",
  "ArtifactProvenanceStatement",
  "SourceRelationshipStatement",
  "ArtifactSourceAttribution",
  "EvidenceArtifactBinding",
  "KnowledgeStateStatement",
] as const;

export type Rcv016SnapshotMembershipTargetTypeV1 =
  (typeof RCV016_SNAPSHOT_MEMBERSHIP_TARGET_TYPES_V1)[number];

interface Rcv016SnapshotMembershipBaseV1 {
  readonly provenanceSnapshotId: Rcv016ProvenanceSnapshotIdV1;
}

export type Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1 =
  | {
      readonly targetType: "ArtifactVersion";
      readonly artifactVersionId: Rcv016ArtifactVersionIdV1;
      readonly membershipRole: "root" | "included";
    }
  | {
      readonly targetType: "SourceVersion";
      readonly sourceVersionId: Rcv016SourceVersionIdV1;
      readonly membershipRole: "included";
    }
  | {
      readonly targetType: "ArtifactProvenanceStatement";
      readonly artifactProvenanceStatementId: Rcv016ArtifactProvenanceStatementIdV1;
      readonly membershipRole: "included";
    }
  | {
      readonly targetType: "SourceRelationshipStatement";
      readonly sourceRelationshipStatementId: Rcv016SourceRelationshipStatementIdV1;
      readonly membershipRole: "included";
    }
  | {
      readonly targetType: "ArtifactSourceAttribution";
      readonly artifactSourceAttributionId: Rcv016ArtifactSourceAttributionIdV1;
      readonly membershipRole: "included";
    }
  | {
      readonly targetType: "EvidenceArtifactBinding";
      readonly evidenceArtifactBindingId: Rcv016EvidenceArtifactBindingIdV1;
      readonly membershipRole: "included";
    }
  | {
      readonly targetType: "KnowledgeStateStatement";
      readonly knowledgeStateStatementId: Rcv016KnowledgeStateStatementIdV1;
      readonly membershipRole: "included";
    };

export type Rcv016ProvenanceSnapshotMembershipV1 =
  Rcv016SnapshotMembershipBaseV1 &
    Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1;

export const RCV016_MEMBERSHIP_CATEGORY_ORDER_V1 =
  RCV016_SNAPSHOT_MEMBERSHIP_TARGET_TYPES_V1;
export const RCV016_ARTIFACT_VERSION_MEMBERSHIP_ROLE_ORDER_V1 = [
  "root",
  "included",
] as const;
export const RCV016_MEMBERSHIP_CANONICALIZATION_V1 = {
  keySchema: "closed_seven_variant_membership_key_union_v1",
  canonicalizationId: RCV016_CANONICALIZATION_ID,
  canonicalizationVersion: RCV016_CANONICALIZATION_VERSION,
  totalOrderKey: ["categoryRank", "roleRankIfApplicable", "canonicalId"],
  idRepresentation: "lowercase_canonical_uuid",
  idComparison: "ascii_lexicographic_ascending",
  distinctKeysMayShareTotalOrderKey: false,
  exactDuplicateKeysAllowed: false,
  physicalSqlRowOrderHasMeaning: false,
} as const;

export const RCV016_DETERMINISTIC_ORDERING_V1 =
  "schema_category_then_canonical_key_lexicographic_v1" as const;
export const RCV016_VISITED_SEMANTICS_V1 =
  "expand_node_once_include_statement_once_diagnose_cycles_v1" as const;

export const RCV016_SNAPSHOT_ROOT_SEMANTICS_V1 = {
  minimumRootCount: 1,
  rootType: "ArtifactVersion",
  idRepresentation: "lowercase_canonical_uuid",
  duplicateRootIdsAllowed: false,
  duplicateRootBehavior: "reject_input",
  maxRootsCountingDomain: "supplied_valid_root_ids_before_canonical_ordering",
  inputOrderHasSemanticMeaning: false,
  canonicalOrder: "canonical_uuid_ascii_lexicographic_ascending",
  everyRootMustResolveInBuilderUniverse: true,
} as const;

export const RCV016_TRAVERSAL_DEPTH_SEMANTICS_V1 = {
  metric: "minimum_eligible_directed_content_edge_distance_from_any_root",
  rootDepth: 0,
  minimumValidMaxDepth: 1,
  zeroMaxDepthBehavior: "invalid_policy_no_snapshot",
  multiplePathRule: "minimum_distance",
  multipleRootRule: "minimum_distance_from_any_root",
  discoveryOrderHasSemanticMeaning: false,
  reachedNodePredicate: "effective_depth_less_than_or_equal_to_maxDepth",
  expandedNodePredicate: "effective_depth_strictly_less_than_maxDepth",
  nodeAtMaxDepth: "included_not_expanded",
  edgeLeavingNodeAtMaxDepth: "outside_scope_not_included",
  upstreamObjectBeyondBoundary: "outside_scope_not_included",
  boundaryOutcome: "successful_bounded_closure",
  cycleInputGraph:
    "included_artifact_provenance_statements_with_subject_depth_strictly_less_than_maxDepth",
  cycleEdgesOutsideScopeDiagnosed: false,
} as const;

export const RCV016_SNAPSHOT_STATEMENT_CLOSURE_V1 = [
  {
    family: "ArtifactProvenanceStatement",
    inclusionPredicate:
      "relationship_is_allowed_and_downstream_subject_effective_depth_strictly_less_than_maxDepth",
    expandsArtifactTraversal: true,
    expandsSourceClosure: false,
    historicalMultiplicityPreservedBy: "statement_id",
    affectsDerivedUnrecordedStates: false,
  },
  {
    family: "SourceRelationshipStatement",
    inclusionPredicate:
      "both_source_endpoints_represented_by_included_source_versions",
    expandsArtifactTraversal: false,
    expandsSourceClosure: false,
    historicalMultiplicityPreservedBy: "statement_id",
    affectsDerivedUnrecordedStates: false,
  },
  {
    family: "ArtifactSourceAttribution",
    inclusionPredicate: "subject_artifact_version_is_reached",
    expandsArtifactTraversal: false,
    expandsSourceClosure: false,
    historicalMultiplicityPreservedBy: "statement_id",
    affectsDerivedUnrecordedStates: false,
  },
  {
    family: "EvidenceArtifactBinding",
    inclusionPredicate: "object_artifact_version_is_reached",
    expandsArtifactTraversal: false,
    expandsSourceClosure: false,
    historicalMultiplicityPreservedBy: "statement_id",
    affectsDerivedUnrecordedStates: false,
  },
  {
    family: "KnowledgeStateStatement",
    inclusionPredicate:
      "subject_artifact_version_is_reached_and_scope_is_upstream_provenance",
    expandsArtifactTraversal: false,
    expandsSourceClosure: false,
    historicalMultiplicityPreservedBy: "statement_id",
    affectsDerivedUnrecordedStates: true,
  },
] as const;

export const RCV016_NON_TRAVERSAL_SNAPSHOT_CLOSURE_V1 = {
  artifactSourceAttributions:
    "all_statements_whose_subject_artifact_version_is_reached",
  sourceVersions:
    "exactly_versions_referenced_by_included_artifact_source_attributions",
  representedSourceIds:
    "distinct_source_ids_carried_by_included_source_versions",
  sourceRelationshipStatements:
    "all_statements_whose_subject_and_object_source_ids_are_both_represented",
  sourceRelationshipTransitiveClosure: false,
  sourceRelationshipsIntroduceSourceVersions: false,
  evidenceArtifactBindings:
    "all_statements_whose_object_artifact_version_is_reached",
  separateEvidenceOrBindingScopeSelector: false,
  knowledgeStateStatements:
    "all_statements_whose_subject_artifact_version_is_reached_and_scope_is_upstream_provenance",
  historicalReduction: "none",
  suppliedUnreachedObjectsBecomeMembers: false,
  liveDatabaseReadsAfterFinalization: false,
} as const;

export const RCV016_ARTIFACT_VERSION_MEMBERSHIP_DERIVATION_V1 = {
  rootRolePredicate: "artifact_version_id_is_a_supplied_valid_root",
  includedRolePredicate:
    "artifact_version_is_upstream_object_of_at_least_one_included_artifact_provenance_statement",
  rootAndIncludedMayCoexistForSameArtifactVersion: true,
  maximumKeysPerArtifactVersionPerRole: 1,
  distinctRolesCollapsed: false,
} as const;

export const RCV016_SNAPSHOT_REQUIRED_REFERENCE_SEMANTICS_V1 = {
  rootsMustResolveToArtifactVersions: true,
  includedArtifactProvenanceEndpointsMustResolveToArtifactVersions: true,
  includedAttributionTargetsMustResolveToSourceVersions: true,
  sourceIdentityMapping: "source_id_carried_by_included_source_version",
  sourceObjectsRequiredForSnapshotClosure: false,
  missingRequiredReferenceBehavior: "reject_build_fail_closed",
  missingReferencesOnObjectsOutsideClosureAffectSnapshot: false,
} as const;

export const RCV016_TRAVERSAL_LIMIT_COUNTING_V1 = {
  maxRoots: "supplied_valid_root_ids_before_canonical_ordering",
  maxNodes: "distinct_reached_artifact_version_ids",
  maxEdges:
    "included_traversed_artifact_provenance_statements_by_statement_id",
  maxDepth:
    "minimum_eligible_directed_content_edge_distance_successful_boundary",
  maxCanonicalSnapshotBytes:
    "exact_utf8_byte_length_of_final_jcs_snapshot_canonical",
  nonTraversalStatementFamiliesCountTowardMaxEdges: false,
} as const;

export const RCV016_TRAVERSAL_LIMIT_OUTCOMES_V1 = {
  maxRootsExceeded: "reject_entire_build_technical_error",
  maxNodesExceeded: "reject_entire_build_technical_error",
  maxEdgesExceeded: "reject_entire_build_technical_error",
  maxDepthReached: "successful_bounded_closure",
  maxCanonicalSnapshotBytesExceeded:
    "reject_entire_build_technical_error",
  truncationAllowed: false,
  successfulPartialSnapshotAllowed: false,
  domainStateInferenceAllowed: false,
} as const;

export const RCV016_SNAPSHOT_SCHEMA_ID =
  "factbase-provenance-snapshot" as const;
export const RCV016_SNAPSHOT_SCHEMA_VERSION = "1" as const;
export const RCV016_SNAPSHOT_BUILDER_ID =
  "factbase-provenance-snapshot-builder" as const;
export const RCV016_SNAPSHOT_BUILDER_VERSION = "1" as const;

export interface Rcv016SnapshotBuilderIdentityV1 {
  readonly builderId: typeof RCV016_SNAPSHOT_BUILDER_ID;
  readonly builderVersion: typeof RCV016_SNAPSHOT_BUILDER_VERSION;
  readonly builderArtifactHash: Rcv016Sha256HexV1;
}

export const RCV016_SNAPSHOT_CANONICAL_INCLUDED_FIELDS_V1 = [
  "snapshotSchemaId",
  "snapshotSchemaVersion",
  "builderId",
  "builderVersion",
  "builderArtifactHash",
  "canonicalizationId",
  "canonicalizationVersion",
  "hashAlgorithm",
  "policyId",
  "policyVersion",
  "definitionHash",
  "maxRoots",
  "maxNodes",
  "maxEdges",
  "maxDepth",
  "maxCanonicalSnapshotBytes",
  "allowedRelationships",
  "deterministicOrdering",
  "visitedSemantics",
  "rootArtifactVersionIds",
  "artifactVersions",
  "sourceVersions",
  "artifactProvenanceStatements",
  "sourceRelationshipStatements",
  "artifactSourceAttributions",
  "evidenceArtifactBindings",
  "knowledgeStateStatements",
  "derivedUnrecordedStates",
  "buildTimeCycleDiagnostics",
  "conflictDiagnostics",
  "membershipKeys",
] as const;

export const RCV016_SOURCE_VERSION_CANONICAL_FIELDS_V1 = [
  "sourceVersionId",
  "sourceId",
  "versionNumber",
  "metadataSchemaIdentity",
  "metadataCanonical",
  "metadataHash",
  "observedAt",
  "createdAt",
] as const;

export const RCV016_ARTIFACT_VERSION_CANONICAL_FIELDS_V1 = [
  "artifactVersionId",
  "artifactId",
  "versionNumber",
  "captureSchemaId",
  "captureSchemaVersion",
  "captureCanonical",
  "captureHash",
  "createdAt",
] as const;

export interface Rcv016SourceVersionSnapshotCanonicalV1 {
  readonly sourceVersionId: Rcv016SourceVersionIdV1;
  readonly sourceId: Rcv016SourceIdV1;
  readonly versionNumber: Rcv016PositiveSafeIntegerV1;
  readonly metadataSchemaIdentity: {
    readonly id: typeof RCV016_SOURCE_VERSION_METADATA_SCHEMA_ID;
    readonly version: typeof RCV016_SOURCE_VERSION_METADATA_SCHEMA_VERSION;
  };
  readonly metadataCanonical: Rcv016NonEmptyStringV1;
  readonly metadataHash: Rcv016Sha256HexV1;
  readonly observedAt: Rcv016CanonicalTimestampV1;
  readonly createdAt: Rcv016CanonicalTimestampV1;
}

export interface Rcv016ArtifactVersionSnapshotCanonicalV1 {
  readonly artifactVersionId: Rcv016ArtifactVersionIdV1;
  readonly artifactId: Rcv016ArtifactIdV1;
  readonly versionNumber: Rcv016PositiveSafeIntegerV1;
  readonly captureSchemaId: typeof RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_ID;
  readonly captureSchemaVersion: typeof RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_VERSION;
  readonly captureCanonical: Rcv016NonEmptyStringV1;
  readonly captureHash: Rcv016Sha256HexV1;
  readonly createdAt: Rcv016CanonicalTimestampV1;
}

export interface Rcv016ProvenanceSnapshotCanonicalV1 {
  readonly snapshotSchemaId: typeof RCV016_SNAPSHOT_SCHEMA_ID;
  readonly snapshotSchemaVersion: typeof RCV016_SNAPSHOT_SCHEMA_VERSION;
  readonly builderId: typeof RCV016_SNAPSHOT_BUILDER_ID;
  readonly builderVersion: typeof RCV016_SNAPSHOT_BUILDER_VERSION;
  readonly builderArtifactHash: Rcv016Sha256HexV1;
  readonly canonicalizationId: typeof RCV016_CANONICALIZATION_ID;
  readonly canonicalizationVersion: typeof RCV016_CANONICALIZATION_VERSION;
  readonly hashAlgorithm: typeof RCV016_HASH_ALGORITHM;
  readonly policyId: Rcv016NonEmptyStringV1;
  readonly policyVersion: Rcv016NonEmptyStringV1;
  readonly definitionHash: Rcv016Sha256HexV1;
  readonly maxRoots: Rcv016PositiveSafeIntegerV1;
  readonly maxNodes: Rcv016PositiveSafeIntegerV1;
  readonly maxEdges: Rcv016PositiveSafeIntegerV1;
  readonly maxDepth: Rcv016PositiveSafeIntegerV1;
  readonly maxCanonicalSnapshotBytes: Rcv016PositiveSafeIntegerV1;
  readonly allowedRelationships: typeof RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1;
  readonly deterministicOrdering: typeof RCV016_DETERMINISTIC_ORDERING_V1;
  readonly visitedSemantics: typeof RCV016_VISITED_SEMANTICS_V1;
  readonly rootArtifactVersionIds: readonly Rcv016ArtifactVersionIdV1[];
  readonly artifactVersions: readonly Rcv016ArtifactVersionSnapshotCanonicalV1[];
  readonly sourceVersions: readonly Rcv016SourceVersionSnapshotCanonicalV1[];
  readonly artifactProvenanceStatements: readonly Rcv016ArtifactProvenanceStatementV1[];
  readonly sourceRelationshipStatements: readonly Rcv016SourceRelationshipStatementV1[];
  readonly artifactSourceAttributions: readonly Rcv016ArtifactSourceAttributionV1[];
  readonly evidenceArtifactBindings: readonly Rcv016EvidenceArtifactBindingV1[];
  readonly knowledgeStateStatements: readonly Rcv016KnowledgeStateStatementV1[];
  readonly derivedUnrecordedStates: readonly Rcv016DerivedUnrecordedStateV1[];
  readonly buildTimeCycleDiagnostics: readonly Rcv016CycleDiagnosticV1[];
  readonly conflictDiagnostics: Rcv016ConflictDiagnosticsV1;
  readonly membershipKeys: readonly Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1[];
}

export const RCV016_SNAPSHOT_CANONICAL_EXCLUDED_NON_CONTENT_V1 = [
  "snapshotId",
  "snapshotPersistenceCreatedAt",
  "databaseTransactionIds",
  "lockInformation",
  "physicalTableAndIndexNames",
  "sqlRowOrder",
  "queryPlans",
  "connectionAndSessionData",
  "readTimeSnapshotCorruptionDiagnostics",
] as const;

export const RCV016_SNAPSHOT_CANONICAL_STATEMENT_FIELDS_V1 = {
  ArtifactProvenanceStatement: [
    "family",
    "statementId",
    "subjectArtifactVersionId",
    "relationship",
    "objectArtifactVersionId",
    "observedAt",
    "validFrom",
    "validTo",
    "initiator",
    "rationale",
    "foundation",
    "supersedesStatementId",
    "createdAt",
  ],
  SourceRelationshipStatement: [
    "family",
    "statementId",
    "subjectSourceId",
    "relationship",
    "objectSourceId",
    "observedAt",
    "validFrom",
    "validTo",
    "initiator",
    "rationale",
    "foundation",
    "supersedesStatementId",
    "createdAt",
  ],
  ArtifactSourceAttribution: [
    "family",
    "statementId",
    "subjectArtifactVersionId",
    "relationship",
    "objectSourceVersionId",
    "observedAt",
    "validFrom",
    "validTo",
    "initiator",
    "rationale",
    "foundation",
    "supersedesStatementId",
    "createdAt",
  ],
  EvidenceArtifactBinding: [
    "family",
    "statementId",
    "subjectEvidenceId",
    "relationship",
    "objectArtifactVersionId",
    "observedAt",
    "validFrom",
    "validTo",
    "initiator",
    "rationale",
    "foundation",
    "supersedesStatementId",
    "createdAt",
  ],
  KnowledgeStateStatement: [
    "family",
    "statementId",
    "subjectArtifactVersionId",
    "scope",
    "state",
    "observedAt",
    "validFrom",
    "validTo",
    "initiator",
    "rationale",
    "foundation",
    "supersedesStatementId",
    "createdAt",
  ],
} as const;

export const RCV016_TRAVERSAL_POLICY_SCHEMA_ID =
  "factbase-provenance-traversal-policy" as const;
export const RCV016_TRAVERSAL_POLICY_SCHEMA_VERSION = "1" as const;
export const RCV016_TRAVERSAL_DIRECTION_V1 = "downstream_to_upstream" as const;
export const RCV016_TRAVERSAL_LIMIT_FIELDS_V1 = [
  "maxRoots",
  "maxNodes",
  "maxEdges",
  "maxDepth",
  "maxCanonicalSnapshotBytes",
] as const;
export const RCV016_POLICY_ID_VERSION_BINDS_ONE_DEFINITION_HASH_V1 = true as const;
export const RCV016_DIFFERENT_LIMITS_REQUIRE_DIFFERENT_POLICY_IDENTITY_OR_VERSION_V1 =
  true as const;

export const RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1 = [
  "cites",
  "derived_from",
  "incorporates",
  "quotes",
  "reposts",
  "syndicated_from",
  "uses_information_from",
] as const;
export const RCV016_ALLOWED_RELATIONSHIPS_REQUIRE_EXACT_COMPLETE_V1_SET = true as const;
export const RCV016_ALLOWED_RELATIONSHIPS_ORDERING_V1 =
  "ascii_lexicographic_ascending" as const;
export const RCV016_ALLOWED_RELATIONSHIPS_EXACT_DUPLICATES_ALLOWED_V1 = false as const;

export type Rcv016ContentProvenanceRelationshipV1 =
  (typeof RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1)[number];

export const RCV016_PAYLOAD_LIMITS_SCHEMA_ID =
  "factbase-provenance-payload-limits" as const;
export const RCV016_PAYLOAD_LIMITS_SCHEMA_VERSION = "1" as const;
export const RCV016_CONCRETE_VERSIONED_PAYLOAD_LIMITS_REQUIRED_BEFORE_WRITES_V1 =
  true as const;
export const RCV016_PAYLOAD_LIMITS_ID_VERSION_BINDS_ONE_DEFINITION_HASH_V1 =
  true as const;
export const RCV016_PAYLOAD_LIMIT_ENFORCEMENT_V1 = {
  inputPreflightRequired: true,
  actualCanonicalUtf8ByteCheckRequired: true,
  oversizeClassification: "technical_error",
  truncationAllowed: false,
  partialPersistenceAllowed: false,
} as const;
export const RCV016_BOUNDED_PAYLOAD_FIELDS_V1 = [
  "sourceMetadataCanonicalBytes",
  "sourceLocatorCount",
  "displayNameCodepoints",
  "displayNameUtf8Bytes",
  "locatorStringCodepoints",
  "locatorStringUtf8Bytes",
  "artifactCaptureCanonicalBytes",
  "artifactLocatorCodepoints",
  "artifactLocatorUtf8Bytes",
  "mediaTypeCodepoints",
  "mediaTypeUtf8Bytes",
  "titleCodepoints",
  "titleUtf8Bytes",
  "rationaleCodepoints",
  "rationaleUtf8Bytes",
  "foundationCanonicalBytes",
  "foundationItemCount",
  "foundationInputReferenceCount",
  "foundationReferenceCodepoints",
  "foundationReferenceUtf8Bytes",
] as const;

export interface Rcv016PayloadLimitsV1 {
  readonly limitsId: Rcv016NonEmptyStringV1;
  readonly limitsVersion: Rcv016NonEmptyStringV1;
  readonly sourceMetadataCanonicalBytes: Rcv016PositiveSafeIntegerV1;
  readonly sourceLocatorCount: Rcv016PositiveSafeIntegerV1;
  readonly displayNameCodepoints: Rcv016PositiveSafeIntegerV1;
  readonly displayNameUtf8Bytes: Rcv016PositiveSafeIntegerV1;
  readonly locatorStringCodepoints: Rcv016PositiveSafeIntegerV1;
  readonly locatorStringUtf8Bytes: Rcv016PositiveSafeIntegerV1;
  readonly artifactCaptureCanonicalBytes: Rcv016PositiveSafeIntegerV1;
  readonly artifactLocatorCodepoints: Rcv016PositiveSafeIntegerV1;
  readonly artifactLocatorUtf8Bytes: Rcv016PositiveSafeIntegerV1;
  readonly mediaTypeCodepoints: Rcv016PositiveSafeIntegerV1;
  readonly mediaTypeUtf8Bytes: Rcv016PositiveSafeIntegerV1;
  readonly titleCodepoints: Rcv016PositiveSafeIntegerV1;
  readonly titleUtf8Bytes: Rcv016PositiveSafeIntegerV1;
  readonly rationaleCodepoints: Rcv016PositiveSafeIntegerV1;
  readonly rationaleUtf8Bytes: Rcv016PositiveSafeIntegerV1;
  readonly foundationCanonicalBytes: Rcv016PositiveSafeIntegerV1;
  readonly foundationItemCount: Rcv016PositiveSafeIntegerV1;
  readonly foundationInputReferenceCount: Rcv016PositiveSafeIntegerV1;
  readonly foundationReferenceCodepoints: Rcv016PositiveSafeIntegerV1;
  readonly foundationReferenceUtf8Bytes: Rcv016PositiveSafeIntegerV1;
  readonly definitionCanonical: Rcv016NonEmptyStringV1;
  readonly definitionHash: Rcv016Sha256HexV1;
}

export const RCV016_PAYLOAD_LIMITS_DEFINITION_CANONICAL_FIELDS_V1 = [
  "limitsId",
  "limitsVersion",
  ...RCV016_BOUNDED_PAYLOAD_FIELDS_V1,
] as const;
export const RCV016_PAYLOAD_LIMITS_DEFINITION_HASH_INPUT_V1 =
  "sha256_of_jcs_rfc8785_definitionCanonical_over_declared_definition_fields" as const;

export const RCV016_MEMBERSHIP_PARITY_DIAGNOSTIC_CODE =
  "snapshot_membership_mismatch" as const;
export const RCV016_MEMBERSHIP_MANIFEST_HASH_V1 = false as const;
export const RCV016_MEMBERSHIP_CONSTRUCTION_V1 = {
  sourceOfTruth: "finalized_deeply_immutable_in_memory_snapshot_model",
  constructionFlow: [
    "derive_closed_canonical_membership_key_objects",
    "sort_membership_keys_by_v1_total_order",
    "build_jcs_snapshot_canonical",
    "hash_snapshot_sha256",
    "derive_typed_membership_inserts_from_same_model",
  ],
  outputs: [
    "canonical_bytes",
    "snapshot_sha256",
    "typed_membership_inserts",
  ],
  readVerification: [
    "read_persisted_canonical_unchanged",
    "verify_syntax_jcs_sha256",
    "extract_canonical_membership_keys",
    "project_typed_membership_to_same_seven_canonical_key_variants",
    "sort_projected_membership_keys_by_v1_total_order",
    "compare_membership_key_sets_order_neutrally",
  ],
  mismatchDiagnostic: RCV016_MEMBERSHIP_PARITY_DIAGNOSTIC_CODE,
  automaticRepair: false,
  canonicalRewrite: false,
  membershipRewrite: false,
} as const;

export const RCV016_SOURCE_VERSION_CHANGE_DIMENSIONS_V1 = {
  displayNameChange: ["displayName"],
  locatorAdditionOrRemoval: ["observedLocators"],
  locatorKindChange: ["observedLocators.kind"],
  locatorValueChange: ["observedLocators.value"],
  locatorNamespaceChange: ["observedLocators.namespace"],
} as const;
export const RCV016_IDENTICAL_SOURCE_METADATA_REOBSERVATION_REQUIRES_NEW_VERSION_V1 =
  false as const;

export const RCV016_ARTIFACT_VERSION_CHANGE_DIMENSIONS_V1 = {
  concreteCaptureEvent: { kind: "event", event: "newConcreteCaptureEvent" },
  locatorChange: { kind: "field", fields: ["locator"] },
  mediaTypeChange: { kind: "field", fields: ["mediaType"] },
  titleChange: { kind: "field", fields: ["title"] },
  publicationTimeChange: { kind: "field", fields: ["publishedAt"] },
  observationTimeChange: { kind: "field", fields: ["observedAt"] },
  retrievalTimeChange: { kind: "field", fields: ["retrievedAt"] },
  representationKindChange: {
    kind: "field",
    fields: ["representation.kind"],
  },
  contentHashChange: {
    kind: "field",
    fields: ["representation.contentHash"],
  },
  capturedBytesChange: {
    kind: "capture_event_input",
    event: "capturedBytesChanged",
    envelopeBindingFields: [
      "representation.hashAlgorithm",
      "representation.contentHash",
    ],
  },
} as const;
export const RCV016_EVERY_CONCRETE_CAPTURE_EVENT_REQUIRES_NEW_ARTIFACT_VERSION_V1 =
  true as const;
export const RCV016_CAPTURE_EVENT_AUTOMATICALLY_CREATES_ARTIFACT_IDENTITY_V1 =
  false as const;

export const RCV016_AVAILABILITY_INCLUDED_V1 = false as const;

export const RCV016_LEGACY_BINDING_READ_STATES_V1 = ["legacy_unbound"] as const;
export type Rcv016LegacyBindingReadStateV1 =
  (typeof RCV016_LEGACY_BINDING_READ_STATES_V1)[number];
export const RCV016_LEGACY_UNBOUND_READ_SEMANTICS_V1 = {
  persisted: false,
  migrationState: false,
  knowledgeState: false,
  unknown: false,
  independent: false,
  provenanceStatement: false,
  relationship: false,
  snapshotRelationship: false,
  automaticProvenanceAssertion: false,
  derivedWhen:
    "legacy_evidence_has_zero_evidence_artifact_bindings_in_relevant_read_or_snapshot_scope",
  anyHistoricalBindingInScopeSuppressesLegacyUnbound: true,
  latestOrWinnerBindingResolution: false,
  includedInSnapshotCanonicalV1: false,
} as const;

export const RCV016_DIAGNOSTIC_CATEGORIES_V1 = [
  "conflict",
  "cycle",
  "integrity",
  "limit",
  "legacy_binding",
] as const;

export type Rcv016DiagnosticCategoryV1 =
  (typeof RCV016_DIAGNOSTIC_CATEGORIES_V1)[number];
export const RCV016_DIAGNOSTIC_SEPARATION_V1 = {
  cycleIsConflict: false,
  limitIsUnknown: false,
  integrityIsConflictingProvenance: false,
  legacyUnboundIsKnowledgeState: false,
  missingKnowledgeStateStatementIsUnknown: false,
  missingApplicableKnowledgeStateStatementYields: "unrecorded",
  readTimeIntegrityDiagnosticsAreInOriginalSnapshotCanonical: false,
  buildTimeGraphDiagnosticsAreInSnapshotCanonical: true,
} as const;

declare const RCV016_POSITIVE_SAFE_INTEGER_V1: unique symbol;

export type Rcv016PositiveSafeIntegerV1 = number & {
  readonly [RCV016_POSITIVE_SAFE_INTEGER_V1]: true;
};

export function isRcv016PositiveSafeIntegerV1(
  value: unknown,
): value is Rcv016PositiveSafeIntegerV1 {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

const RCV016_ALLOW_MATRIX_KEYS_V1: ReadonlySet<string> = new Set(
  RCV016_PROVENANCE_ALLOW_MATRIX_V1.map(
    ({ subjectType, relationship, objectType }) =>
      `${subjectType}\u0000${relationship}\u0000${objectType}`,
  ),
);

export function isRcv016RelationshipAllowedV1(
  subjectType: unknown,
  relationship: unknown,
  objectType: unknown,
): boolean {
  if (
    typeof subjectType !== "string" ||
    typeof relationship !== "string" ||
    typeof objectType !== "string"
  ) {
    return false;
  }

  return RCV016_ALLOW_MATRIX_KEYS_V1.has(
    `${subjectType}\u0000${relationship}\u0000${objectType}`,
  );
}

export interface Rcv016TraversalPolicyV1 {
  readonly policyId: Rcv016NonEmptyStringV1;
  readonly policyVersion: Rcv016NonEmptyStringV1;
  readonly maxRoots: Rcv016PositiveSafeIntegerV1;
  readonly maxNodes: Rcv016PositiveSafeIntegerV1;
  readonly maxEdges: Rcv016PositiveSafeIntegerV1;
  readonly maxDepth: Rcv016PositiveSafeIntegerV1;
  readonly maxCanonicalSnapshotBytes: Rcv016PositiveSafeIntegerV1;
  readonly allowedRelationships: typeof RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1;
  readonly deterministicOrdering: typeof RCV016_DETERMINISTIC_ORDERING_V1;
  readonly visitedSemantics: typeof RCV016_VISITED_SEMANTICS_V1;
  readonly definitionCanonical: Rcv016NonEmptyStringV1;
  readonly definitionHash: Rcv016Sha256HexV1;
}
