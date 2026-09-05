import {
  RCV016_ARTIFACT_VERSION_CANONICAL_FIELDS_V1,
  RCV016_CANONICALIZATION_ID,
  RCV016_CANONICALIZATION_VERSION,
  RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1,
  RCV016_DETERMINISTIC_ORDERING_V1,
  RCV016_HASH_ALGORITHM,
  RCV016_SNAPSHOT_BUILDER_ID,
  RCV016_SNAPSHOT_BUILDER_VERSION,
  RCV016_SNAPSHOT_CANONICAL_INCLUDED_FIELDS_V1,
  RCV016_SNAPSHOT_CANONICAL_STATEMENT_FIELDS_V1,
  RCV016_SNAPSHOT_SCHEMA_ID,
  RCV016_SNAPSHOT_SCHEMA_VERSION,
  RCV016_SOURCE_VERSION_CANONICAL_FIELDS_V1,
  RCV016_VISITED_SEMANTICS_V1,
  Rcv016FoundationV1,
  Rcv016ProvenanceSnapshotCanonicalV1,
  Rcv016ProvenanceSnapshotIdV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  assertRcv016TextHash,
  canonicalizeRcv016,
  validateRcv016CanonicalTimestamp,
  validateRcv016CanonicalUuid,
  validateRcv016Sha256Hex,
} from "./rcv016Canonical";
import { validateAndCanonicalizeRcv016ArtifactCapture } from "./rcv016ArtifactCapture";
import { buildRcv016CycleDiagnostics } from "./rcv016CycleDiagnostics";
import { validateAndCanonicalizeRcv016Foundation } from "./rcv016Foundation";
import { sortRcv016SnapshotMembershipKeys } from "./rcv016SnapshotMembership";
import { validateRcv016PayloadLimits } from "./rcv016PayloadLimits";
import {
  Rcv016HistoricalObjectReadV1,
  Rcv016HistoricalSnapshotReadRepositoryV1,
  Rcv016HistoricalSnapshotReadV1,
} from "./rcv016ReadRepositoryContract";
import { validateAndCanonicalizeRcv016SourceMetadata } from "./rcv016SourceMetadata";
import { validateRcv016TraversalPolicy } from "./rcv016TraversalPolicy";
import {
  Rcv016HashIntegrityError,
  Rcv016TechnicalError,
  Rcv016UnsupportedContractVersionError,
  Rcv016ValidationError,
  assertRcv016TextLimits,
  expectRcv016Array,
  expectRcv016ExactObject,
  expectRcv016NonEmptyString,
  expectRcv016PositiveSafeInteger,
  expectRcv016String,
  freezeRcv016,
} from "./rcv016Validation";

export type Rcv016ReadIntegrityCode =
  | "snapshot_not_found"
  | "non_jcs_canonical"
  | "closed_schema_violation"
  | "snapshot_membership_mismatch"
  | "derived_state_mismatch"
  | "foundation_corruption"
  | "policy_corruption"
  | "diagnostic_corruption"
  | "missing_historical_object";

export class Rcv016ReadIntegrityError extends Error {
  constructor(
    public readonly code: Rcv016ReadIntegrityCode,
    public readonly path: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`${path}: ${message}`);
    this.name = "Rcv016ReadIntegrityError";
  }
}

export interface Rcv016VerifiedHistoricalSnapshotV1 {
  readonly verified: true;
  readonly snapshotId: Rcv016ProvenanceSnapshotIdV1;
  readonly snapshotHash: string;
  readonly snapshotSchemaId: typeof RCV016_SNAPSHOT_SCHEMA_ID;
  readonly snapshotSchemaVersion: typeof RCV016_SNAPSHOT_SCHEMA_VERSION;
}

const STATEMENT_ARRAYS = [
  "artifactProvenanceStatements",
  "sourceRelationshipStatements",
  "artifactSourceAttributions",
  "evidenceArtifactBindings",
  "knowledgeStateStatements",
] as const;

function same(left: unknown, right: unknown): boolean {
  return canonicalizeRcv016(left).canonical === canonicalizeRcv016(right).canonical;
}

function parseJcs(text: unknown, path: string): unknown {
  const source = expectRcv016NonEmptyString(text, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Rcv016ReadIntegrityError("non_jcs_canonical", path, "invalid JSON", error);
  }
  let canonical: string;
  try {
    canonical = canonicalizeRcv016(parsed).canonical;
  } catch (error) {
    throw new Rcv016ReadIntegrityError("non_jcs_canonical", path, "not valid RFC-8785/JCS", error);
  }
  if (canonical !== source) {
    throw new Rcv016ReadIntegrityError(
      "non_jcs_canonical",
      path,
      "stored bytes are not their RFC-8785/JCS representation",
    );
  }
  return parsed;
}

function assertSortedUnique(values: readonly string[], path: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] >= values[index]) {
      throw new Rcv016ValidationError(path, "expected strictly ascending unique UUIDs");
    }
  }
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : validateRcv016CanonicalTimestamp(value, path);
}

function nullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : validateRcv016CanonicalUuid(value, path);
}

function validateInitiator(value: unknown, path: string): void {
  if (value === null) return;
  const object = expectRcv016ExactObject(value, ["type", "id"], path);
  if (!(object.type === "human" || object.type === "system" || object.type === "importer" || object.type === "agent")) {
    throw new Rcv016ValidationError(`${path}.type`, "unexpected initiator type");
  }
  if (object.id !== null) expectRcv016NonEmptyString(object.id, `${path}.id`);
}

function validateSourceVersion(value: unknown, path: string): string {
  const object = expectRcv016ExactObject(value, RCV016_SOURCE_VERSION_CANONICAL_FIELDS_V1, path);
  const id = validateRcv016CanonicalUuid(object.sourceVersionId, `${path}.sourceVersionId`);
  validateRcv016CanonicalUuid(object.sourceId, `${path}.sourceId`);
  expectRcv016PositiveSafeInteger(object.versionNumber, `${path}.versionNumber`);
  const schema = expectRcv016ExactObject(object.metadataSchemaIdentity, ["id", "version"], `${path}.metadataSchemaIdentity`);
  if (schema.id !== "factbase-source-version-metadata" || schema.version !== "1") {
    throw new Rcv016UnsupportedContractVersionError(`${path}.metadataSchemaIdentity`, "unsupported Source Metadata identity");
  }
  expectRcv016NonEmptyString(object.metadataCanonical, `${path}.metadataCanonical`);
  validateRcv016Sha256Hex(object.metadataHash, `${path}.metadataHash`);
  validateRcv016CanonicalTimestamp(object.observedAt, `${path}.observedAt`);
  validateRcv016CanonicalTimestamp(object.createdAt, `${path}.createdAt`);
  return id;
}

function validateArtifactVersion(value: unknown, path: string): string {
  const object = expectRcv016ExactObject(value, RCV016_ARTIFACT_VERSION_CANONICAL_FIELDS_V1, path);
  const id = validateRcv016CanonicalUuid(object.artifactVersionId, `${path}.artifactVersionId`);
  validateRcv016CanonicalUuid(object.artifactId, `${path}.artifactId`);
  expectRcv016PositiveSafeInteger(object.versionNumber, `${path}.versionNumber`);
  if (object.captureSchemaId !== "factbase-artifact-version-capture" || object.captureSchemaVersion !== "1") {
    throw new Rcv016UnsupportedContractVersionError(path, "unsupported Artifact Capture identity");
  }
  expectRcv016NonEmptyString(object.captureCanonical, `${path}.captureCanonical`);
  validateRcv016Sha256Hex(object.captureHash, `${path}.captureHash`);
  validateRcv016CanonicalTimestamp(object.createdAt, `${path}.createdAt`);
  return id;
}

function validateStatement(value: unknown, family: typeof STATEMENT_ARRAYS[number], path: string): string {
  const expectedFamily = {
    artifactProvenanceStatements: "ArtifactProvenanceStatement",
    sourceRelationshipStatements: "SourceRelationshipStatement",
    artifactSourceAttributions: "ArtifactSourceAttribution",
    evidenceArtifactBindings: "EvidenceArtifactBinding",
    knowledgeStateStatements: "KnowledgeStateStatement",
  } as const;
  const object = expectRcv016ExactObject(
    value,
    RCV016_SNAPSHOT_CANONICAL_STATEMENT_FIELDS_V1[expectedFamily[family]],
    path,
  );
  if (object.family !== expectedFamily[family]) throw new Rcv016ValidationError(`${path}.family`, "wrong Statement family");
  const id = validateRcv016CanonicalUuid(object.statementId, `${path}.statementId`);
  validateRcv016CanonicalTimestamp(object.observedAt, `${path}.observedAt`);
  validateInitiator(object.initiator, `${path}.initiator`);
  if (object.rationale !== null) expectRcv016NonEmptyString(object.rationale, `${path}.rationale`);
  nullableUuid(object.supersedesStatementId, `${path}.supersedesStatementId`);
  validateRcv016CanonicalTimestamp(object.createdAt, `${path}.createdAt`);

  if (family === "artifactProvenanceStatements") {
    validateRcv016CanonicalUuid(object.subjectArtifactVersionId, `${path}.subjectArtifactVersionId`);
    validateRcv016CanonicalUuid(object.objectArtifactVersionId, `${path}.objectArtifactVersionId`);
    if (!(RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1 as readonly unknown[]).includes(object.relationship)) throw new Rcv016ValidationError(`${path}.relationship`, "unexpected relationship");
    if (object.validFrom !== null || object.validTo !== null) throw new Rcv016ValidationError(path, "content provenance is not time-bound");
  } else if (family === "sourceRelationshipStatements") {
    validateRcv016CanonicalUuid(object.subjectSourceId, `${path}.subjectSourceId`);
    validateRcv016CanonicalUuid(object.objectSourceId, `${path}.objectSourceId`);
    if (!("alias_of successor_of part_of controlled_by operated_by".split(" ").includes(object.relationship as string))) throw new Rcv016ValidationError(`${path}.relationship`, "unexpected relationship");
    nullableTimestamp(object.validFrom, `${path}.validFrom`);
    nullableTimestamp(object.validTo, `${path}.validTo`);
  } else if (family === "artifactSourceAttributions") {
    validateRcv016CanonicalUuid(object.subjectArtifactVersionId, `${path}.subjectArtifactVersionId`);
    validateRcv016CanonicalUuid(object.objectSourceVersionId, `${path}.objectSourceVersionId`);
    if (!("authored_by published_by hosted_by issued_by".split(" ").includes(object.relationship as string))) throw new Rcv016ValidationError(`${path}.relationship`, "unexpected relationship");
    if (object.validFrom !== null || object.validTo !== null) throw new Rcv016ValidationError(path, "attribution is not time-bound");
  } else if (family === "evidenceArtifactBindings") {
    validateRcv016CanonicalUuid(object.subjectEvidenceId, `${path}.subjectEvidenceId`);
    validateRcv016CanonicalUuid(object.objectArtifactVersionId, `${path}.objectArtifactVersionId`);
    if (object.relationship !== "bound_to") throw new Rcv016ValidationError(`${path}.relationship`, "unexpected relationship");
    if (object.validFrom !== null || object.validTo !== null) throw new Rcv016ValidationError(path, "binding is not time-bound");
  } else {
    validateRcv016CanonicalUuid(object.subjectArtifactVersionId, `${path}.subjectArtifactVersionId`);
    if (object.scope !== "upstream_provenance" || !(object.state === "unknown" || object.state === "partial" || object.state === "known")) throw new Rcv016ValidationError(path, "invalid Knowledge State");
    if (object.validFrom !== null || object.validTo !== null) throw new Rcv016ValidationError(path, "Knowledge State is not time-bound");
  }
  return id;
}

function validateOrderedArray(
  value: unknown,
  path: string,
  validate: (entry: unknown, path: string) => string,
): unknown[] {
  const array = expectRcv016Array(value, path);
  const ids = array.map((entry, index) => validate(entry, `${path}[${index}]`));
  assertSortedUnique(ids, path);
  return array;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function statementOrderingKey(
  value: unknown,
  family: typeof STATEMENT_ARRAYS[number],
): readonly string[] {
  const statement = value as Record<string, string>;
  if (family === "artifactProvenanceStatements") {
    return [statement.subjectArtifactVersionId, statement.relationship, statement.objectArtifactVersionId, statement.statementId];
  }
  if (family === "sourceRelationshipStatements") {
    return [statement.subjectSourceId, statement.relationship, statement.objectSourceId, statement.statementId];
  }
  if (family === "artifactSourceAttributions") {
    return [statement.subjectArtifactVersionId, statement.relationship, statement.objectSourceVersionId, statement.statementId];
  }
  if (family === "evidenceArtifactBindings") {
    return [statement.subjectEvidenceId, statement.relationship, statement.objectArtifactVersionId, statement.statementId];
  }
  return [statement.statementId];
}

function validateOrderedStatementArray(
  value: unknown,
  family: typeof STATEMENT_ARRAYS[number],
  path: string,
): unknown[] {
  const array = expectRcv016Array(value, path);
  const statementIds = array.map((entry, index) => validateStatement(entry, family, `${path}[${index}]`));
  if (new Set(statementIds).size !== statementIds.length) {
    throw new Rcv016ValidationError(path, "duplicate statementId");
  }
  for (let index = 1; index < array.length; index += 1) {
    const left = statementOrderingKey(array[index - 1], family);
    const right = statementOrderingKey(array[index], family);
    let comparison = 0;
    for (let part = 0; part < left.length && comparison === 0; part += 1) {
      comparison = compareAscii(left[part], right[part]);
    }
    if (comparison >= 0) {
      throw new Rcv016ValidationError(path, "expected frozen canonical statement tuple order");
    }
  }
  return array;
}

function validateSnapshot(value: unknown): Rcv016ProvenanceSnapshotCanonicalV1 {
  const snapshot = expectRcv016ExactObject(value, RCV016_SNAPSHOT_CANONICAL_INCLUDED_FIELDS_V1, "snapshotCanonical");
  if (snapshot.snapshotSchemaId !== RCV016_SNAPSHOT_SCHEMA_ID || snapshot.snapshotSchemaVersion !== RCV016_SNAPSHOT_SCHEMA_VERSION) throw new Rcv016UnsupportedContractVersionError("snapshotCanonical", "unsupported Snapshot identity");
  if (snapshot.builderId !== RCV016_SNAPSHOT_BUILDER_ID || snapshot.builderVersion !== RCV016_SNAPSHOT_BUILDER_VERSION) throw new Rcv016UnsupportedContractVersionError("snapshotCanonical", "unsupported Builder identity");
  validateRcv016Sha256Hex(snapshot.builderArtifactHash, "snapshotCanonical.builderArtifactHash");
  if (snapshot.canonicalizationId !== RCV016_CANONICALIZATION_ID || snapshot.canonicalizationVersion !== RCV016_CANONICALIZATION_VERSION || snapshot.hashAlgorithm !== RCV016_HASH_ALGORITHM) throw new Rcv016UnsupportedContractVersionError("snapshotCanonical", "unsupported canonicalization/hash identity");
  expectRcv016NonEmptyString(snapshot.policyId, "snapshotCanonical.policyId");
  expectRcv016NonEmptyString(snapshot.policyVersion, "snapshotCanonical.policyVersion");
  validateRcv016Sha256Hex(snapshot.definitionHash, "snapshotCanonical.definitionHash");
  for (const field of ["maxRoots", "maxNodes", "maxEdges", "maxDepth", "maxCanonicalSnapshotBytes"]) expectRcv016PositiveSafeInteger(snapshot[field], `snapshotCanonical.${field}`);
  if (!same(snapshot.allowedRelationships, RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1) || snapshot.deterministicOrdering !== RCV016_DETERMINISTIC_ORDERING_V1 || snapshot.visitedSemantics !== RCV016_VISITED_SEMANTICS_V1) throw new Rcv016ValidationError("snapshotCanonical.policy", "invalid bound Policy values");

  const roots = expectRcv016Array(snapshot.rootArtifactVersionIds, "snapshotCanonical.rootArtifactVersionIds").map((root, index) => validateRcv016CanonicalUuid(root, `snapshotCanonical.rootArtifactVersionIds[${index}]`));
  if (roots.length === 0) throw new Rcv016ValidationError("snapshotCanonical.rootArtifactVersionIds", "expected at least one root");
  assertSortedUnique(roots, "snapshotCanonical.rootArtifactVersionIds");
  validateOrderedArray(snapshot.artifactVersions, "snapshotCanonical.artifactVersions", validateArtifactVersion);
  validateOrderedArray(snapshot.sourceVersions, "snapshotCanonical.sourceVersions", validateSourceVersion);
  for (const family of STATEMENT_ARRAYS) validateOrderedStatementArray(snapshot[family], family, `snapshotCanonical.${family}`);
  const membershipKeys = expectRcv016Array(snapshot.membershipKeys, "snapshotCanonical.membershipKeys");
  try {
    const orderedMembershipKeys = sortRcv016SnapshotMembershipKeys(membershipKeys);
    if (!same(membershipKeys, orderedMembershipKeys)) {
      throw new Rcv016ValidationError("snapshotCanonical.membershipKeys", "keys are not in the frozen total order");
    }
  } catch (error) {
    throw new Rcv016ReadIntegrityError(
      "snapshot_membership_mismatch",
      "snapshotCanonical.membershipKeys",
      "malformed or non-canonical Membership keys",
      error,
    );
  }

  const derived = expectRcv016Array(snapshot.derivedUnrecordedStates, "snapshotCanonical.derivedUnrecordedStates");
  const derivedIds = derived.map((entry, index) => {
    const object = expectRcv016ExactObject(entry, ["artifactVersionId", "scope", "state"], `snapshotCanonical.derivedUnrecordedStates[${index}]`);
    const id = validateRcv016CanonicalUuid(object.artifactVersionId, `snapshotCanonical.derivedUnrecordedStates[${index}].artifactVersionId`);
    if (object.scope !== "upstream_provenance" || object.state !== "unrecorded") throw new Rcv016ValidationError("snapshotCanonical.derivedUnrecordedStates", "invalid derived state");
    return id;
  });
  assertSortedUnique(derivedIds, "snapshotCanonical.derivedUnrecordedStates");
  if (expectRcv016Array(snapshot.conflictDiagnostics, "snapshotCanonical.conflictDiagnostics").length !== 0) throw new Rcv016ReadIntegrityError("diagnostic_corruption", "snapshotCanonical.conflictDiagnostics", "V1 requires []");
  expectRcv016Array(snapshot.buildTimeCycleDiagnostics, "snapshotCanonical.buildTimeCycleDiagnostics");
  return snapshot as unknown as Rcv016ProvenanceSnapshotCanonicalV1;
}

function exactHistorical(
  canonicalValues: readonly unknown[],
  records: readonly Rcv016HistoricalObjectReadV1[],
  path: string,
): void {
  if (canonicalValues.length !== records.length) throw new Rcv016ReadIntegrityError("missing_historical_object", path, "historical row count differs from Snapshot");
  const expected = canonicalValues.map((value) => canonicalizeRcv016(value).canonical).sort();
  const actual = records.map((record) => canonicalizeRcv016(record.value).canonical).sort();
  if (!same(expected, actual)) throw new Rcv016ReadIntegrityError("missing_historical_object", path, "historical rows differ from Snapshot content");
}

function verifyFoundation(
  record: Rcv016HistoricalObjectReadV1,
  statement: Record<string, unknown>,
  read: Rcv016HistoricalSnapshotReadV1,
  path: string,
): void {
  const limits = validateRcv016PayloadLimits(record.payloadLimits);
  if (statement.rationale !== null) assertRcv016TextLimits(statement.rationale as string, limits.rationaleCodepoints, limits.rationaleUtf8Bytes, `${path}.rationale`, "rationaleCodepoints", "rationaleUtf8Bytes");
  if (statement.foundation === null) {
    if (record.foundationCanonical !== null || record.foundationHash !== null) throw new Rcv016ReadIntegrityError("foundation_corruption", path, "Foundation nullability drift");
    return;
  }
  if (typeof record.foundationCanonical !== "string" || typeof record.foundationHash !== "string") throw new Rcv016ReadIntegrityError("foundation_corruption", path, "missing Foundation TEXT/hash");
  try {
    assertRcv016TextHash(record.foundationCanonical, record.foundationHash, `${path}.foundationHash`);
    const parsed = parseJcs(record.foundationCanonical, `${path}.foundationCanonical`);
    const validated = validateAndCanonicalizeRcv016Foundation(parsed, limits);
    if (validated === null || validated.canonical !== record.foundationCanonical || !same(validated.value, statement.foundation)) throw new Error("Foundation parity mismatch");
    const targets = {
      evidence: new Set(read.foundationTargets.evidenceIds),
      artifact_version: new Set(read.foundationTargets.artifactVersionIds),
      provenance_snapshot: new Set(read.foundationTargets.provenanceSnapshotIds),
    };
    for (const item of (validated.value as Rcv016FoundationV1).items) {
      if (item.kind === "evidence_reference" && !targets.evidence.has(item.evidenceId)) throw new Error("missing Evidence target");
      if (item.kind === "artifact_version_reference" && !targets.artifact_version.has(item.artifactVersionId)) throw new Error("missing ArtifactVersion target");
      if (item.kind === "deterministic_method") for (const reference of item.inputReferences) if (!targets[reference.referenceType].has(reference.referenceId)) throw new Error(`missing ${reference.referenceType} target`);
    }
  } catch (error) {
    if (error instanceof Rcv016ReadIntegrityError && error.code === "non_jcs_canonical") throw error;
    throw new Rcv016ReadIntegrityError("foundation_corruption", path, "Foundation verification failed", error);
  }
}

function verifyHistorical(read: Rcv016HistoricalSnapshotReadV1, snapshot: Rcv016ProvenanceSnapshotCanonicalV1): void {
  exactHistorical(snapshot.artifactVersions, read.artifactVersions, "historical.artifactVersions");
  exactHistorical(snapshot.sourceVersions, read.sourceVersions, "historical.sourceVersions");
  for (const family of STATEMENT_ARRAYS) exactHistorical(snapshot[family], read[family], `historical.${family}`);

  for (const record of read.sourceVersions) {
    const value = record.value as Rcv016ProvenanceSnapshotCanonicalV1["sourceVersions"][number];
    const limits = validateRcv016PayloadLimits(record.payloadLimits);
    assertRcv016TextHash(value.metadataCanonical, value.metadataHash, "historical.sourceVersion.metadataHash");
    const parsed = parseJcs(value.metadataCanonical, "historical.sourceVersion.metadataCanonical");
    const validated = validateAndCanonicalizeRcv016SourceMetadata(parsed, limits);
    if (validated.canonical !== value.metadataCanonical) throw new Rcv016ReadIntegrityError("closed_schema_violation", "historical.sourceVersion", "Metadata canonical drift");
  }
  for (const record of read.artifactVersions) {
    const value = record.value as Rcv016ProvenanceSnapshotCanonicalV1["artifactVersions"][number];
    const limits = validateRcv016PayloadLimits(record.payloadLimits);
    assertRcv016TextHash(value.captureCanonical, value.captureHash, "historical.artifactVersion.captureHash");
    const parsed = parseJcs(value.captureCanonical, "historical.artifactVersion.captureCanonical");
    const validated = validateAndCanonicalizeRcv016ArtifactCapture(parsed, limits);
    if (validated.canonical !== value.captureCanonical) throw new Rcv016ReadIntegrityError("closed_schema_violation", "historical.artifactVersion", "Capture canonical drift");
  }
  for (const family of STATEMENT_ARRAYS) {
    for (let index = 0; index < read[family].length; index += 1) verifyFoundation(read[family][index], read[family][index].value as Record<string, unknown>, read, `historical.${family}[${index}]`);
  }
}

function verifyPolicy(read: Rcv016HistoricalSnapshotReadV1, snapshot: Rcv016ProvenanceSnapshotCanonicalV1): void {
  if (read.traversalPolicy === null) throw new Rcv016ReadIntegrityError("policy_corruption", "traversalPolicy", "exact bound Policy is missing");
  try {
    const policy = validateRcv016TraversalPolicy(read.traversalPolicy);
    const bound = {
      policyId: snapshot.policyId,
      policyVersion: snapshot.policyVersion,
      definitionHash: snapshot.definitionHash,
      maxRoots: snapshot.maxRoots,
      maxNodes: snapshot.maxNodes,
      maxEdges: snapshot.maxEdges,
      maxDepth: snapshot.maxDepth,
      maxCanonicalSnapshotBytes: snapshot.maxCanonicalSnapshotBytes,
      allowedRelationships: snapshot.allowedRelationships,
      deterministicOrdering: snapshot.deterministicOrdering,
      visitedSemantics: snapshot.visitedSemantics,
    };
    const actual = {
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      definitionHash: policy.definitionHash,
      maxRoots: policy.maxRoots,
      maxNodes: policy.maxNodes,
      maxEdges: policy.maxEdges,
      maxDepth: policy.maxDepth,
      maxCanonicalSnapshotBytes: policy.maxCanonicalSnapshotBytes,
      allowedRelationships: policy.allowedRelationships,
      deterministicOrdering: policy.deterministicOrdering,
      visitedSemantics: policy.visitedSemantics,
    };
    if (!same(bound, actual)) throw new Error("bound Policy parity mismatch");
  } catch (error) {
    throw new Rcv016ReadIntegrityError("policy_corruption", "traversalPolicy", "Policy verification failed", error);
  }
}

function verifyMembership(read: Rcv016HistoricalSnapshotReadV1, snapshot: Rcv016ProvenanceSnapshotCanonicalV1): void {
  let canonical;
  let relational;
  try {
    canonical = sortRcv016SnapshotMembershipKeys(snapshot.membershipKeys);
    relational = sortRcv016SnapshotMembershipKeys(read.relationalMembershipKeys);
  } catch (error) {
    throw new Rcv016ReadIntegrityError("snapshot_membership_mismatch", "membership", "malformed Membership key", error);
  }
  if (!same(canonical, relational)) throw new Rcv016ReadIntegrityError("snapshot_membership_mismatch", "membership", "Canonical and relational Membership differ");
}

function verifyDerived(snapshot: Rcv016ProvenanceSnapshotCanonicalV1): void {
  const subjects = new Set<string>();
  for (const key of snapshot.membershipKeys) if (key.targetType === "ArtifactVersion") subjects.add(key.artifactVersionId);
  const withState = new Set<string>(snapshot.knowledgeStateStatements.filter((statement) => statement.scope === "upstream_provenance").map((statement) => statement.subjectArtifactVersionId));
  const expected = [...subjects].filter((id) => !withState.has(id)).sort().map((artifactVersionId) => ({ artifactVersionId, scope: "upstream_provenance", state: "unrecorded" }));
  if (!same(expected, snapshot.derivedUnrecordedStates)) throw new Rcv016ReadIntegrityError("derived_state_mismatch", "snapshotCanonical.derivedUnrecordedStates", "does not reproduce from Snapshot Membership");
}

function verifyDiagnostics(snapshot: Rcv016ProvenanceSnapshotCanonicalV1): void {
  const expected = buildRcv016CycleDiagnostics(snapshot.artifactProvenanceStatements.map((statement) => ({
    statementId: statement.statementId,
    subjectArtifactVersionId: statement.subjectArtifactVersionId,
    objectArtifactVersionId: statement.objectArtifactVersionId,
    relationship: statement.relationship,
  })));
  if (!same(expected, snapshot.buildTimeCycleDiagnostics)) throw new Rcv016ReadIntegrityError("diagnostic_corruption", "snapshotCanonical.buildTimeCycleDiagnostics", "Cycle Diagnostics do not reproduce from Snapshot-contained statements");
}

function verifyRead(read: Rcv016HistoricalSnapshotReadV1, requestedId: Rcv016ProvenanceSnapshotIdV1): Rcv016VerifiedHistoricalSnapshotV1 {
  const headerId = validateRcv016CanonicalUuid(read.header.snapshotId, "header.snapshotId");
  if (headerId !== requestedId) throw new Rcv016ReadIntegrityError("missing_historical_object", "header.snapshotId", "repository returned another Snapshot");
  validateRcv016CanonicalTimestamp(read.header.persistenceCreatedAt, "header.persistenceCreatedAt");
  assertRcv016TextHash(read.header.snapshotCanonical, read.header.snapshotHash, "header.snapshotHash");
  const parsed = parseJcs(read.header.snapshotCanonical, "header.snapshotCanonical");
  let snapshot: Rcv016ProvenanceSnapshotCanonicalV1;
  try {
    snapshot = validateSnapshot(parsed);
  } catch (error) {
    if (error instanceof Rcv016UnsupportedContractVersionError || error instanceof Rcv016ReadIntegrityError) throw error;
    throw new Rcv016ReadIntegrityError("closed_schema_violation", "snapshotCanonical", "closed Snapshot schema verification failed", error);
  }
  verifyMembership(read, snapshot);
  verifyDerived(snapshot);
  verifyDiagnostics(snapshot);
  verifyPolicy(read, snapshot);
  try {
    verifyHistorical(read, snapshot);
  } catch (error) {
    if (error instanceof Rcv016ReadIntegrityError || error instanceof Rcv016HashIntegrityError) throw error;
    if (error instanceof Rcv016TechnicalError) throw new Rcv016ReadIntegrityError("closed_schema_violation", error.path, "historical object verification failed", error);
    throw error;
  }
  return freezeRcv016({ verified: true, snapshotId: headerId, snapshotHash: read.header.snapshotHash, snapshotSchemaId: RCV016_SNAPSHOT_SCHEMA_ID, snapshotSchemaVersion: RCV016_SNAPSHOT_SCHEMA_VERSION }) as Rcv016VerifiedHistoricalSnapshotV1;
}

export async function verifyRcv016HistoricalSnapshot(
  snapshotId: unknown,
  repository: Rcv016HistoricalSnapshotReadRepositoryV1,
): Promise<Rcv016VerifiedHistoricalSnapshotV1> {
  const id = validateRcv016CanonicalUuid(snapshotId, "snapshotId") as Rcv016ProvenanceSnapshotIdV1;
  const read = await repository.loadHistoricalSnapshotById(id);
  if (read === null) throw new Rcv016ReadIntegrityError("snapshot_not_found", "snapshotId", "exact historical Snapshot not found");
  return verifyRead(read, id);
}
