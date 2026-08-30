import {
  RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_ID,
  RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_VERSION,
  RCV016_CANONICALIZATION_ID,
  RCV016_CANONICALIZATION_VERSION,
  RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1,
  RCV016_HASH_ALGORITHM,
  RCV016_KNOWLEDGE_SCOPE_V1,
  RCV016_PERSISTED_KNOWLEDGE_STATES_V1,
  RCV016_SNAPSHOT_BUILDER_ID,
  RCV016_SNAPSHOT_BUILDER_VERSION,
  RCV016_SNAPSHOT_SCHEMA_ID,
  RCV016_SNAPSHOT_SCHEMA_VERSION,
  RCV016_SOURCE_VERSION_METADATA_SCHEMA_ID,
  RCV016_SOURCE_VERSION_METADATA_SCHEMA_VERSION,
  Rcv016ArtifactProvenanceStatementV1,
  Rcv016ArtifactSourceAttributionV1,
  Rcv016ArtifactVersionIdV1,
  Rcv016ArtifactVersionSnapshotCanonicalV1,
  Rcv016EvidenceArtifactBindingV1,
  Rcv016KnowledgeStateStatementV1,
  Rcv016ProvenanceSnapshotCanonicalV1,
  Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1,
  Rcv016Sha256HexV1,
  Rcv016SourceRelationshipStatementV1,
  Rcv016SourceVersionSnapshotCanonicalV1,
  Rcv016TraversalPolicyV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  assertRcv016TextHash,
  canonicalizeRcv016,
  validateRcv016CanonicalTimestamp,
  validateRcv016CanonicalUuid,
  validateRcv016Sha256Hex,
} from "./rcv016Canonical";
import { buildRcv016CycleDiagnostics } from "./rcv016CycleDiagnostics";
import { sortRcv016SnapshotMembershipKeys } from "./rcv016SnapshotMembership";
import { validateRcv016TraversalPolicy } from "./rcv016TraversalPolicy";
import {
  Rcv016PayloadLimitError,
  Rcv016ValidationError,
  expectRcv016Array,
  expectRcv016ExactObject,
  expectRcv016NonEmptyString,
  expectRcv016NullableNonEmptyString,
  expectRcv016PositiveSafeInteger,
  freezeRcv016,
  rcv016Utf8ByteLength,
} from "./rcv016Validation";

const INPUT_KEYS = [
  "snapshotIdentity",
  "builderIdentity",
  "traversalPolicy",
  "roots",
  "artifactVersions",
  "sourceVersions",
  "artifactProvenanceStatements",
  "sourceRelationshipStatements",
  "artifactSourceAttributions",
  "evidenceArtifactBindings",
  "knowledgeStateStatements",
] as const;

const COMMON_STATEMENT_FIELDS = [
  "observedAt",
  "validFrom",
  "validTo",
  "initiator",
  "rationale",
  "foundation",
  "supersedesStatementId",
  "createdAt",
] as const;

const CONTENT_RELATIONSHIPS = new Set<string>(
  RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1,
);
const ATTRIBUTION_RELATIONSHIPS = new Set([
  "authored_by",
  "published_by",
  "hosted_by",
  "issued_by",
]);
const SOURCE_RELATIONSHIPS = new Set([
  "alias_of",
  "successor_of",
  "part_of",
  "controlled_by",
  "operated_by",
]);

export interface Rcv016SnapshotIdentityInputV1 {
  readonly snapshotSchemaId: typeof RCV016_SNAPSHOT_SCHEMA_ID;
  readonly snapshotSchemaVersion: typeof RCV016_SNAPSHOT_SCHEMA_VERSION;
  readonly canonicalizationId: typeof RCV016_CANONICALIZATION_ID;
  readonly canonicalizationVersion: typeof RCV016_CANONICALIZATION_VERSION;
  readonly hashAlgorithm: typeof RCV016_HASH_ALGORITHM;
}

export interface Rcv016SnapshotBuilderInputV1 {
  readonly snapshotIdentity: Rcv016SnapshotIdentityInputV1;
  readonly builderIdentity: {
    readonly builderId: typeof RCV016_SNAPSHOT_BUILDER_ID;
    readonly builderVersion: typeof RCV016_SNAPSHOT_BUILDER_VERSION;
    readonly builderArtifactHash: Rcv016Sha256HexV1;
  };
  readonly traversalPolicy: Rcv016TraversalPolicyV1;
  readonly roots: readonly Rcv016ArtifactVersionIdV1[];
  readonly artifactVersions: readonly Rcv016ArtifactVersionSnapshotCanonicalV1[];
  readonly sourceVersions: readonly Rcv016SourceVersionSnapshotCanonicalV1[];
  readonly artifactProvenanceStatements: readonly Rcv016ArtifactProvenanceStatementV1[];
  readonly sourceRelationshipStatements: readonly Rcv016SourceRelationshipStatementV1[];
  readonly artifactSourceAttributions: readonly Rcv016ArtifactSourceAttributionV1[];
  readonly evidenceArtifactBindings: readonly Rcv016EvidenceArtifactBindingV1[];
  readonly knowledgeStateStatements: readonly Rcv016KnowledgeStateStatementV1[];
}

export interface Rcv016SnapshotMembershipCollectionsV1 {
  readonly artifactVersions: readonly Extract<Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1, { targetType: "ArtifactVersion" }>[];
  readonly sourceVersions: readonly Extract<Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1, { targetType: "SourceVersion" }>[];
  readonly artifactProvenanceStatements: readonly Extract<Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1, { targetType: "ArtifactProvenanceStatement" }>[];
  readonly sourceRelationshipStatements: readonly Extract<Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1, { targetType: "SourceRelationshipStatement" }>[];
  readonly artifactSourceAttributions: readonly Extract<Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1, { targetType: "ArtifactSourceAttribution" }>[];
  readonly evidenceArtifactBindings: readonly Extract<Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1, { targetType: "EvidenceArtifactBinding" }>[];
  readonly knowledgeStateStatements: readonly Extract<Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1, { targetType: "KnowledgeStateStatement" }>[];
}

export interface Rcv016SnapshotBuilderResultV1 {
  readonly snapshot: Rcv016ProvenanceSnapshotCanonicalV1;
  readonly canonical: string;
  readonly hash: Rcv016Sha256HexV1;
  readonly membership: Rcv016SnapshotMembershipCollectionsV1;
}

const FINALIZED_SNAPSHOT_BUILDER_RESULTS = new WeakSet<object>();

export function assertFinalizedRcv016SnapshotBuilderResult(
  value: unknown,
): Rcv016SnapshotBuilderResultV1 {
  if (
    typeof value !== "object" ||
    value === null ||
    !FINALIZED_SNAPSHOT_BUILDER_RESULTS.has(value)
  ) {
    throw new Rcv016ValidationError(
      "snapshotBuilderResult",
      "result was not finalized by the RCV-016 Snapshot Builder",
    );
  }
  return value as Rcv016SnapshotBuilderResultV1;
}

function ascii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalizeRcv016(value).canonical) as T;
}

function nullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : validateRcv016CanonicalUuid(value, path);
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : validateRcv016CanonicalTimestamp(value, path);
}

function validateInitiator(value: unknown, path: string): unknown {
  if (value === null) return null;
  const object = expectRcv016ExactObject(value, ["type", "id"], path);
  if (!(["human", "system", "importer", "agent"] as unknown[]).includes(object.type)) {
    throw new Rcv016ValidationError(`${path}.type`, "unexpected initiator type");
  }
  return {
    type: object.type,
    id: object.id === null ? null : expectRcv016NonEmptyString(object.id, `${path}.id`),
  };
}

function validateCommonStatement(
  object: Record<string, unknown>,
  path: string,
  nonTimeBound: boolean,
): {
  observedAt: string;
  validFrom: string | null;
  validTo: string | null;
  initiator: unknown;
  rationale: string | null;
  foundation: unknown;
  supersedesStatementId: string | null;
  createdAt: string;
} {
  const validFrom = nullableTimestamp(object.validFrom, `${path}.validFrom`);
  const validTo = nullableTimestamp(object.validTo, `${path}.validTo`);
  if (nonTimeBound && (validFrom !== null || validTo !== null)) {
    throw new Rcv016ValidationError(path, "non-time-bound statement requires null validity fields");
  }
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    throw new Rcv016ValidationError(path, "validFrom must not be after validTo");
  }
  return {
    observedAt: validateRcv016CanonicalTimestamp(object.observedAt, `${path}.observedAt`),
    validFrom,
    validTo,
    initiator: validateInitiator(object.initiator, `${path}.initiator`),
    rationale: expectRcv016NullableNonEmptyString(object.rationale, `${path}.rationale`),
    foundation: object.foundation === null ? null : cloneJson(object.foundation),
    supersedesStatementId: nullableUuid(object.supersedesStatementId, `${path}.supersedesStatementId`),
    createdAt: validateRcv016CanonicalTimestamp(object.createdAt, `${path}.createdAt`),
  };
}

function validateArtifactVersion(value: unknown, index: number): Rcv016ArtifactVersionSnapshotCanonicalV1 {
  const path = `artifactVersions[${index}]`;
  const object = expectRcv016ExactObject(value, [
    "artifactVersionId", "artifactId", "versionNumber", "captureSchemaId",
    "captureSchemaVersion", "captureCanonical", "captureHash", "createdAt",
  ], path);
  if (
    object.captureSchemaId !== RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_ID ||
    object.captureSchemaVersion !== RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_VERSION
  ) {
    throw new Rcv016ValidationError(path, "unexpected Artifact Capture schema identity");
  }
  const captureCanonical = expectRcv016NonEmptyString(object.captureCanonical, `${path}.captureCanonical`);
  return {
    artifactVersionId: validateRcv016CanonicalUuid(object.artifactVersionId, `${path}.artifactVersionId`) as Rcv016ArtifactVersionSnapshotCanonicalV1["artifactVersionId"],
    artifactId: validateRcv016CanonicalUuid(object.artifactId, `${path}.artifactId`) as Rcv016ArtifactVersionSnapshotCanonicalV1["artifactId"],
    versionNumber: expectRcv016PositiveSafeInteger(object.versionNumber, `${path}.versionNumber`) as Rcv016ArtifactVersionSnapshotCanonicalV1["versionNumber"],
    captureSchemaId: RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_ID,
    captureSchemaVersion: RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_VERSION,
    captureCanonical: captureCanonical as Rcv016ArtifactVersionSnapshotCanonicalV1["captureCanonical"],
    captureHash: assertRcv016TextHash(captureCanonical, object.captureHash, `${path}.captureHash`),
    createdAt: validateRcv016CanonicalTimestamp(object.createdAt, `${path}.createdAt`),
  };
}

function validateSourceVersion(value: unknown, index: number): Rcv016SourceVersionSnapshotCanonicalV1 {
  const path = `sourceVersions[${index}]`;
  const object = expectRcv016ExactObject(value, [
    "sourceVersionId", "sourceId", "versionNumber", "metadataSchemaIdentity",
    "metadataCanonical", "metadataHash", "observedAt", "createdAt",
  ], path);
  const schema = expectRcv016ExactObject(object.metadataSchemaIdentity, ["id", "version"], `${path}.metadataSchemaIdentity`);
  if (
    schema.id !== RCV016_SOURCE_VERSION_METADATA_SCHEMA_ID ||
    schema.version !== RCV016_SOURCE_VERSION_METADATA_SCHEMA_VERSION
  ) {
    throw new Rcv016ValidationError(path, "unexpected Source Metadata schema identity");
  }
  const metadataCanonical = expectRcv016NonEmptyString(object.metadataCanonical, `${path}.metadataCanonical`);
  return {
    sourceVersionId: validateRcv016CanonicalUuid(object.sourceVersionId, `${path}.sourceVersionId`) as Rcv016SourceVersionSnapshotCanonicalV1["sourceVersionId"],
    sourceId: validateRcv016CanonicalUuid(object.sourceId, `${path}.sourceId`) as Rcv016SourceVersionSnapshotCanonicalV1["sourceId"],
    versionNumber: expectRcv016PositiveSafeInteger(object.versionNumber, `${path}.versionNumber`) as Rcv016SourceVersionSnapshotCanonicalV1["versionNumber"],
    metadataSchemaIdentity: {
      id: RCV016_SOURCE_VERSION_METADATA_SCHEMA_ID,
      version: RCV016_SOURCE_VERSION_METADATA_SCHEMA_VERSION,
    },
    metadataCanonical: metadataCanonical as Rcv016SourceVersionSnapshotCanonicalV1["metadataCanonical"],
    metadataHash: assertRcv016TextHash(metadataCanonical, object.metadataHash, `${path}.metadataHash`),
    observedAt: validateRcv016CanonicalTimestamp(object.observedAt, `${path}.observedAt`),
    createdAt: validateRcv016CanonicalTimestamp(object.createdAt, `${path}.createdAt`),
  };
}

function validateArtifactProvenanceStatement(value: unknown, index: number): Rcv016ArtifactProvenanceStatementV1 {
  const path = `artifactProvenanceStatements[${index}]`;
  const object = expectRcv016ExactObject(value, [
    "family", "statementId", "subjectArtifactVersionId", "relationship",
    "objectArtifactVersionId", ...COMMON_STATEMENT_FIELDS,
  ], path);
  if (object.family !== "ArtifactProvenanceStatement" || typeof object.relationship !== "string" || !CONTENT_RELATIONSHIPS.has(object.relationship)) {
    throw new Rcv016ValidationError(path, "unexpected Artifact provenance family or relationship");
  }
  const common = validateCommonStatement(object, path, true);
  return {
    family: "ArtifactProvenanceStatement",
    statementId: validateRcv016CanonicalUuid(object.statementId, `${path}.statementId`) as Rcv016ArtifactProvenanceStatementV1["statementId"],
    subjectArtifactVersionId: validateRcv016CanonicalUuid(object.subjectArtifactVersionId, `${path}.subjectArtifactVersionId`) as Rcv016ArtifactVersionIdV1,
    relationship: object.relationship as Rcv016ArtifactProvenanceStatementV1["relationship"],
    objectArtifactVersionId: validateRcv016CanonicalUuid(object.objectArtifactVersionId, `${path}.objectArtifactVersionId`) as Rcv016ArtifactVersionIdV1,
    ...common,
  } as Rcv016ArtifactProvenanceStatementV1;
}

function validateArtifactSourceAttribution(value: unknown, index: number): Rcv016ArtifactSourceAttributionV1 {
  const path = `artifactSourceAttributions[${index}]`;
  const object = expectRcv016ExactObject(value, [
    "family", "statementId", "subjectArtifactVersionId", "relationship",
    "objectSourceVersionId", ...COMMON_STATEMENT_FIELDS,
  ], path);
  if (object.family !== "ArtifactSourceAttribution" || typeof object.relationship !== "string" || !ATTRIBUTION_RELATIONSHIPS.has(object.relationship)) {
    throw new Rcv016ValidationError(path, "unexpected Attribution family or relationship");
  }
  const common = validateCommonStatement(object, path, true);
  return {
    family: "ArtifactSourceAttribution",
    statementId: validateRcv016CanonicalUuid(object.statementId, `${path}.statementId`) as Rcv016ArtifactSourceAttributionV1["statementId"],
    subjectArtifactVersionId: validateRcv016CanonicalUuid(object.subjectArtifactVersionId, `${path}.subjectArtifactVersionId`) as Rcv016ArtifactVersionIdV1,
    relationship: object.relationship as Rcv016ArtifactSourceAttributionV1["relationship"],
    objectSourceVersionId: validateRcv016CanonicalUuid(object.objectSourceVersionId, `${path}.objectSourceVersionId`) as Rcv016ArtifactSourceAttributionV1["objectSourceVersionId"],
    ...common,
  } as Rcv016ArtifactSourceAttributionV1;
}

function validateSourceRelationship(value: unknown, index: number): Rcv016SourceRelationshipStatementV1 {
  const path = `sourceRelationshipStatements[${index}]`;
  const object = expectRcv016ExactObject(value, [
    "family", "statementId", "subjectSourceId", "relationship", "objectSourceId",
    ...COMMON_STATEMENT_FIELDS,
  ], path);
  if (object.family !== "SourceRelationshipStatement" || typeof object.relationship !== "string" || !SOURCE_RELATIONSHIPS.has(object.relationship)) {
    throw new Rcv016ValidationError(path, "unexpected Source relationship family or relationship");
  }
  const common = validateCommonStatement(
    object,
    path,
    object.relationship === "alias_of" || object.relationship === "successor_of",
  );
  return {
    family: "SourceRelationshipStatement",
    statementId: validateRcv016CanonicalUuid(object.statementId, `${path}.statementId`) as Rcv016SourceRelationshipStatementV1["statementId"],
    subjectSourceId: validateRcv016CanonicalUuid(object.subjectSourceId, `${path}.subjectSourceId`) as Rcv016SourceRelationshipStatementV1["subjectSourceId"],
    relationship: object.relationship,
    objectSourceId: validateRcv016CanonicalUuid(object.objectSourceId, `${path}.objectSourceId`) as Rcv016SourceRelationshipStatementV1["objectSourceId"],
    ...common,
  } as Rcv016SourceRelationshipStatementV1;
}

function validateEvidenceBinding(value: unknown, index: number): Rcv016EvidenceArtifactBindingV1 {
  const path = `evidenceArtifactBindings[${index}]`;
  const object = expectRcv016ExactObject(value, [
    "family", "statementId", "subjectEvidenceId", "relationship",
    "objectArtifactVersionId", ...COMMON_STATEMENT_FIELDS,
  ], path);
  if (object.family !== "EvidenceArtifactBinding" || object.relationship !== "bound_to") {
    throw new Rcv016ValidationError(path, "unexpected Evidence binding family or relationship");
  }
  const common = validateCommonStatement(object, path, true);
  return {
    family: "EvidenceArtifactBinding",
    statementId: validateRcv016CanonicalUuid(object.statementId, `${path}.statementId`) as Rcv016EvidenceArtifactBindingV1["statementId"],
    subjectEvidenceId: validateRcv016CanonicalUuid(object.subjectEvidenceId, `${path}.subjectEvidenceId`) as Rcv016EvidenceArtifactBindingV1["subjectEvidenceId"],
    relationship: "bound_to",
    objectArtifactVersionId: validateRcv016CanonicalUuid(object.objectArtifactVersionId, `${path}.objectArtifactVersionId`) as Rcv016ArtifactVersionIdV1,
    ...common,
  } as Rcv016EvidenceArtifactBindingV1;
}

function validateKnowledgeState(value: unknown, index: number): Rcv016KnowledgeStateStatementV1 {
  const path = `knowledgeStateStatements[${index}]`;
  const object = expectRcv016ExactObject(value, [
    "family", "statementId", "subjectArtifactVersionId", "scope", "state",
    ...COMMON_STATEMENT_FIELDS,
  ], path);
  if (
    object.family !== "KnowledgeStateStatement" ||
    object.scope !== RCV016_KNOWLEDGE_SCOPE_V1 ||
    typeof object.state !== "string" ||
    !(RCV016_PERSISTED_KNOWLEDGE_STATES_V1 as readonly string[]).includes(object.state)
  ) {
    throw new Rcv016ValidationError(path, "unexpected Knowledge State family, scope, or state");
  }
  const common = validateCommonStatement(object, path, true);
  return {
    family: "KnowledgeStateStatement",
    statementId: validateRcv016CanonicalUuid(object.statementId, `${path}.statementId`) as Rcv016KnowledgeStateStatementV1["statementId"],
    subjectArtifactVersionId: validateRcv016CanonicalUuid(object.subjectArtifactVersionId, `${path}.subjectArtifactVersionId`) as Rcv016ArtifactVersionIdV1,
    scope: RCV016_KNOWLEDGE_SCOPE_V1,
    state: object.state as Rcv016KnowledgeStateStatementV1["state"],
    ...common,
  } as Rcv016KnowledgeStateStatementV1;
}

function uniqueMap<T>(values: readonly T[], id: (value: T) => string, path: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (result.has(key)) throw new Rcv016ValidationError(path, `duplicate identity ${key}`);
    result.set(key, value);
  }
  return result;
}

function validateInput(value: unknown): Rcv016SnapshotBuilderInputV1 {
  const input = expectRcv016ExactObject(value, INPUT_KEYS, "snapshotBuilderInput");
  const snapshotIdentity = expectRcv016ExactObject(input.snapshotIdentity, [
    "snapshotSchemaId", "snapshotSchemaVersion", "canonicalizationId",
    "canonicalizationVersion", "hashAlgorithm",
  ], "snapshotBuilderInput.snapshotIdentity");
  if (
    snapshotIdentity.snapshotSchemaId !== RCV016_SNAPSHOT_SCHEMA_ID ||
    snapshotIdentity.snapshotSchemaVersion !== RCV016_SNAPSHOT_SCHEMA_VERSION ||
    snapshotIdentity.canonicalizationId !== RCV016_CANONICALIZATION_ID ||
    snapshotIdentity.canonicalizationVersion !== RCV016_CANONICALIZATION_VERSION ||
    snapshotIdentity.hashAlgorithm !== RCV016_HASH_ALGORITHM
  ) throw new Rcv016ValidationError("snapshotBuilderInput.snapshotIdentity", "unexpected V1 identity");
  const builderIdentity = expectRcv016ExactObject(input.builderIdentity, [
    "builderId", "builderVersion", "builderArtifactHash",
  ], "snapshotBuilderInput.builderIdentity");
  if (builderIdentity.builderId !== RCV016_SNAPSHOT_BUILDER_ID || builderIdentity.builderVersion !== RCV016_SNAPSHOT_BUILDER_VERSION) {
    throw new Rcv016ValidationError("snapshotBuilderInput.builderIdentity", "unexpected Builder identity");
  }
  const roots = expectRcv016Array(input.roots, "snapshotBuilderInput.roots").map((root, index) =>
    validateRcv016CanonicalUuid(root, `snapshotBuilderInput.roots[${index}]`) as Rcv016ArtifactVersionIdV1);
  if (roots.length === 0) throw new Rcv016ValidationError("snapshotBuilderInput.roots", "at least one root is required");
  if (new Set(roots).size !== roots.length) throw new Rcv016ValidationError("snapshotBuilderInput.roots", "duplicate root ID");
  return {
    snapshotIdentity: {
      snapshotSchemaId: RCV016_SNAPSHOT_SCHEMA_ID,
      snapshotSchemaVersion: RCV016_SNAPSHOT_SCHEMA_VERSION,
      canonicalizationId: RCV016_CANONICALIZATION_ID,
      canonicalizationVersion: RCV016_CANONICALIZATION_VERSION,
      hashAlgorithm: RCV016_HASH_ALGORITHM,
    },
    builderIdentity: {
      builderId: RCV016_SNAPSHOT_BUILDER_ID,
      builderVersion: RCV016_SNAPSHOT_BUILDER_VERSION,
      builderArtifactHash: validateRcv016Sha256Hex(builderIdentity.builderArtifactHash, "snapshotBuilderInput.builderIdentity.builderArtifactHash"),
    },
    traversalPolicy: validateRcv016TraversalPolicy(input.traversalPolicy),
    roots,
    artifactVersions: expectRcv016Array(input.artifactVersions, "artifactVersions").map(validateArtifactVersion),
    sourceVersions: expectRcv016Array(input.sourceVersions, "sourceVersions").map(validateSourceVersion),
    artifactProvenanceStatements: expectRcv016Array(input.artifactProvenanceStatements, "artifactProvenanceStatements").map(validateArtifactProvenanceStatement),
    sourceRelationshipStatements: expectRcv016Array(input.sourceRelationshipStatements, "sourceRelationshipStatements").map(validateSourceRelationship),
    artifactSourceAttributions: expectRcv016Array(input.artifactSourceAttributions, "artifactSourceAttributions").map(validateArtifactSourceAttribution),
    evidenceArtifactBindings: expectRcv016Array(input.evidenceArtifactBindings, "evidenceArtifactBindings").map(validateEvidenceBinding),
    knowledgeStateStatements: expectRcv016Array(input.knowledgeStateStatements, "knowledgeStateStatements").map(validateKnowledgeState),
  };
}

function relationshipOrder(
  left: { subject: string; relationship: string; object: string; statementId: string },
  right: { subject: string; relationship: string; object: string; statementId: string },
): number {
  return ascii(left.subject, right.subject) || ascii(left.relationship, right.relationship) || ascii(left.object, right.object) || ascii(left.statementId, right.statementId);
}

function membershipCollections(
  keys: readonly Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1[],
): Rcv016SnapshotMembershipCollectionsV1 {
  return {
    artifactVersions: keys.filter((key): key is Extract<typeof key, { targetType: "ArtifactVersion" }> => key.targetType === "ArtifactVersion"),
    sourceVersions: keys.filter((key): key is Extract<typeof key, { targetType: "SourceVersion" }> => key.targetType === "SourceVersion"),
    artifactProvenanceStatements: keys.filter((key): key is Extract<typeof key, { targetType: "ArtifactProvenanceStatement" }> => key.targetType === "ArtifactProvenanceStatement"),
    sourceRelationshipStatements: keys.filter((key): key is Extract<typeof key, { targetType: "SourceRelationshipStatement" }> => key.targetType === "SourceRelationshipStatement"),
    artifactSourceAttributions: keys.filter((key): key is Extract<typeof key, { targetType: "ArtifactSourceAttribution" }> => key.targetType === "ArtifactSourceAttribution"),
    evidenceArtifactBindings: keys.filter((key): key is Extract<typeof key, { targetType: "EvidenceArtifactBinding" }> => key.targetType === "EvidenceArtifactBinding"),
    knowledgeStateStatements: keys.filter((key): key is Extract<typeof key, { targetType: "KnowledgeStateStatement" }> => key.targetType === "KnowledgeStateStatement"),
  };
}

export function buildRcv016ProvenanceSnapshot(value: unknown): Rcv016SnapshotBuilderResultV1 {
  const input = validateInput(value);
  const policy = input.traversalPolicy;
  if (input.roots.length > policy.maxRoots) {
    throw new Rcv016PayloadLimitError("roots", "exceeds maxRoots");
  }
  const artifacts = uniqueMap(input.artifactVersions, (item) => item.artifactVersionId, "artifactVersions");
  const sources = uniqueMap(input.sourceVersions, (item) => item.sourceVersionId, "sourceVersions");
  uniqueMap(input.artifactProvenanceStatements, (item) => item.statementId, "artifactProvenanceStatements");
  uniqueMap(input.sourceRelationshipStatements, (item) => item.statementId, "sourceRelationshipStatements");
  uniqueMap(input.artifactSourceAttributions, (item) => item.statementId, "artifactSourceAttributions");
  uniqueMap(input.evidenceArtifactBindings, (item) => item.statementId, "evidenceArtifactBindings");
  uniqueMap(input.knowledgeStateStatements, (item) => item.statementId, "knowledgeStateStatements");
  const roots = [...input.roots].sort(ascii);
  for (const root of roots) if (!artifacts.has(root)) throw new Rcv016ValidationError("roots", `missing ArtifactVersion ${root}`);

  const provenance = [...input.artifactProvenanceStatements].sort((left, right) => relationshipOrder(
    { subject: left.subjectArtifactVersionId, relationship: left.relationship, object: left.objectArtifactVersionId, statementId: left.statementId },
    { subject: right.subjectArtifactVersionId, relationship: right.relationship, object: right.objectArtifactVersionId, statementId: right.statementId },
  ));
  const bySubject = new Map<string, Rcv016ArtifactProvenanceStatementV1[]>();
  for (const statement of provenance) {
    const outgoing = bySubject.get(statement.subjectArtifactVersionId) ?? [];
    outgoing.push(statement);
    bySubject.set(statement.subjectArtifactVersionId, outgoing);
  }
  const depths = new Map<string, number>();
  const queue: string[] = [];
  for (const root of roots) {
    depths.set(root, 0);
    queue.push(root);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const subject = queue[cursor];
    const depth = depths.get(subject) as number;
    if (depth >= policy.maxDepth) continue;
    for (const statement of bySubject.get(subject) ?? []) {
      if (!artifacts.has(statement.objectArtifactVersionId)) {
        throw new Rcv016ValidationError("artifactProvenanceStatements", `missing upstream ArtifactVersion ${statement.objectArtifactVersionId}`);
      }
      const candidateDepth = depth + 1;
      const previous = depths.get(statement.objectArtifactVersionId);
      if (previous === undefined || candidateDepth < previous) {
        depths.set(statement.objectArtifactVersionId, candidateDepth);
        queue.push(statement.objectArtifactVersionId);
      }
    }
  }
  const reached = new Set(depths.keys());
  const includedProvenance = provenance.filter((statement) => {
    const depth = depths.get(statement.subjectArtifactVersionId);
    return depth !== undefined && depth < policy.maxDepth;
  });
  if (reached.size > policy.maxNodes) throw new Rcv016PayloadLimitError("artifactVersions", "exceeds maxNodes");
  if (includedProvenance.length > policy.maxEdges) throw new Rcv016PayloadLimitError("artifactProvenanceStatements", "exceeds maxEdges");

  const includedAttributions = input.artifactSourceAttributions
    .filter((item) => reached.has(item.subjectArtifactVersionId))
    .sort((left, right) => relationshipOrder(
      { subject: left.subjectArtifactVersionId, relationship: left.relationship, object: left.objectSourceVersionId, statementId: left.statementId },
      { subject: right.subjectArtifactVersionId, relationship: right.relationship, object: right.objectSourceVersionId, statementId: right.statementId },
    ));
  const includedSourceIds = new Set<string>();
  const includedSourceVersionsMap = new Map<string, Rcv016SourceVersionSnapshotCanonicalV1>();
  for (const attribution of includedAttributions) {
    const source = sources.get(attribution.objectSourceVersionId);
    if (!source) throw new Rcv016ValidationError("artifactSourceAttributions", `missing SourceVersion ${attribution.objectSourceVersionId}`);
    includedSourceVersionsMap.set(source.sourceVersionId, source);
    includedSourceIds.add(source.sourceId);
  }
  const includedSourceVersions = [...includedSourceVersionsMap.values()].sort((left, right) => ascii(left.sourceVersionId, right.sourceVersionId));
  const includedSourceRelationships = input.sourceRelationshipStatements
    .filter((item) => includedSourceIds.has(item.subjectSourceId) && includedSourceIds.has(item.objectSourceId))
    .sort((left, right) => relationshipOrder(
      { subject: left.subjectSourceId, relationship: left.relationship, object: left.objectSourceId, statementId: left.statementId },
      { subject: right.subjectSourceId, relationship: right.relationship, object: right.objectSourceId, statementId: right.statementId },
    ));
  const includedBindings = input.evidenceArtifactBindings
    .filter((item) => reached.has(item.objectArtifactVersionId))
    .sort((left, right) => relationshipOrder(
      { subject: left.subjectEvidenceId, relationship: left.relationship, object: left.objectArtifactVersionId, statementId: left.statementId },
      { subject: right.subjectEvidenceId, relationship: right.relationship, object: right.objectArtifactVersionId, statementId: right.statementId },
    ));
  const includedKnowledge = input.knowledgeStateStatements
    .filter((item) => reached.has(item.subjectArtifactVersionId))
    .sort((left, right) => ascii(left.statementId, right.statementId));
  const includedArtifacts = [...reached]
    .sort(ascii)
    .map((artifactVersionId) => artifacts.get(artifactVersionId) as Rcv016ArtifactVersionSnapshotCanonicalV1);

  const membershipInput: Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1[] = [];
  for (const artifactVersionId of roots) membershipInput.push({ targetType: "ArtifactVersion", membershipRole: "root", artifactVersionId: artifactVersionId as Rcv016ArtifactVersionIdV1 });
  const includedArtifactIds = new Set(includedProvenance.map((statement) => statement.objectArtifactVersionId));
  for (const artifactVersionId of includedArtifactIds) membershipInput.push({ targetType: "ArtifactVersion", membershipRole: "included", artifactVersionId });
  for (const item of includedSourceVersions) membershipInput.push({ targetType: "SourceVersion", membershipRole: "included", sourceVersionId: item.sourceVersionId });
  for (const item of includedProvenance) membershipInput.push({ targetType: "ArtifactProvenanceStatement", membershipRole: "included", artifactProvenanceStatementId: item.statementId });
  for (const item of includedSourceRelationships) membershipInput.push({ targetType: "SourceRelationshipStatement", membershipRole: "included", sourceRelationshipStatementId: item.statementId });
  for (const item of includedAttributions) membershipInput.push({ targetType: "ArtifactSourceAttribution", membershipRole: "included", artifactSourceAttributionId: item.statementId });
  for (const item of includedBindings) membershipInput.push({ targetType: "EvidenceArtifactBinding", membershipRole: "included", evidenceArtifactBindingId: item.statementId });
  for (const item of includedKnowledge) membershipInput.push({ targetType: "KnowledgeStateStatement", membershipRole: "included", knowledgeStateStatementId: item.statementId });
  const membershipKeys = sortRcv016SnapshotMembershipKeys(membershipInput);

  const knowledgeSubjects = new Set<string>(includedKnowledge.map((item) => item.subjectArtifactVersionId));
  const derivedSubjects = new Set<string>();
  for (const key of membershipKeys) if (key.targetType === "ArtifactVersion") derivedSubjects.add(key.artifactVersionId);
  const derivedUnrecordedStates = [...derivedSubjects]
    .filter((artifactVersionId) => !knowledgeSubjects.has(artifactVersionId))
    .sort(ascii)
    .map((artifactVersionId) => ({ artifactVersionId: artifactVersionId as Rcv016ArtifactVersionIdV1, scope: RCV016_KNOWLEDGE_SCOPE_V1, state: "unrecorded" as const }));
  const cycleDiagnostics = buildRcv016CycleDiagnostics(includedProvenance);

  const snapshot: Rcv016ProvenanceSnapshotCanonicalV1 = {
    snapshotSchemaId: RCV016_SNAPSHOT_SCHEMA_ID,
    snapshotSchemaVersion: RCV016_SNAPSHOT_SCHEMA_VERSION,
    builderId: RCV016_SNAPSHOT_BUILDER_ID,
    builderVersion: RCV016_SNAPSHOT_BUILDER_VERSION,
    builderArtifactHash: input.builderIdentity.builderArtifactHash,
    canonicalizationId: RCV016_CANONICALIZATION_ID,
    canonicalizationVersion: RCV016_CANONICALIZATION_VERSION,
    hashAlgorithm: RCV016_HASH_ALGORITHM,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    definitionHash: policy.definitionHash,
    maxRoots: policy.maxRoots,
    maxNodes: policy.maxNodes,
    maxEdges: policy.maxEdges,
    maxDepth: policy.maxDepth,
    maxCanonicalSnapshotBytes: policy.maxCanonicalSnapshotBytes,
    allowedRelationships: [...policy.allowedRelationships] as unknown as typeof RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1,
    deterministicOrdering: policy.deterministicOrdering,
    visitedSemantics: policy.visitedSemantics,
    rootArtifactVersionIds: roots,
    artifactVersions: includedArtifacts,
    sourceVersions: includedSourceVersions,
    artifactProvenanceStatements: includedProvenance,
    sourceRelationshipStatements: includedSourceRelationships,
    artifactSourceAttributions: includedAttributions,
    evidenceArtifactBindings: includedBindings,
    knowledgeStateStatements: includedKnowledge,
    derivedUnrecordedStates,
    buildTimeCycleDiagnostics: cycleDiagnostics,
    conflictDiagnostics: [],
    membershipKeys,
  };
  const canonical = canonicalizeRcv016(snapshot);
  if (rcv016Utf8ByteLength(canonical.canonical) > policy.maxCanonicalSnapshotBytes) {
    throw new Rcv016PayloadLimitError("snapshotCanonical", "exceeds maxCanonicalSnapshotBytes");
  }
  const result = freezeRcv016({
    snapshot,
    canonical: canonical.canonical,
    hash: canonical.hash,
    membership: membershipCollections(membershipKeys),
  }) as Rcv016SnapshotBuilderResultV1;
  FINALIZED_SNAPSHOT_BUILDER_RESULTS.add(result);
  return result;
}
