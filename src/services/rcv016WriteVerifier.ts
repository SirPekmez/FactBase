import {
  RCV016_CANONICALIZATION_ID,
  RCV016_CANONICALIZATION_VERSION,
  RCV016_HASH_ALGORITHM,
  RCV016_SNAPSHOT_BUILDER_ID,
  RCV016_SNAPSHOT_BUILDER_VERSION,
  RCV016_SNAPSHOT_SCHEMA_ID,
  RCV016_SNAPSHOT_SCHEMA_VERSION,
  Rcv016FoundationV1,
  Rcv016ProvenanceSnapshotCanonicalV1,
  Rcv016ProvenanceSnapshotIdV1,
  Rcv016Sha256HexV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  sha256Rcv016Text,
  validateRcv016CanonicalUuid,
} from "./rcv016Canonical";
import {
  assertFinalizedRcv016SnapshotBuilderResult,
  Rcv016SnapshotBuilderResultV1,
} from "./rcv016SnapshotBuilder";
import {
  RCV016_SNAPSHOT_WRITE_ISOLATION,
  Rcv016DatabaseError,
  Rcv016FoundationReferenceTargetV1,
  Rcv016RelationalIntegrityError,
  Rcv016SnapshotMembershipMismatchError,
  Rcv016SnapshotPersistenceBundleV1,
  Rcv016SnapshotRepositoryV1,
  Rcv016SnapshotWriteTransactionV1,
  Rcv016TraversalPolicySnapshotRecordV1,
} from "./rcv016RepositoryContract";
import {
  Rcv016HashIntegrityError,
  Rcv016TechnicalError,
  Rcv016UnsupportedContractVersionError,
  Rcv016ValidationError,
  expectRcv016ExactObject,
  freezeRcv016,
} from "./rcv016Validation";

const MEMBERSHIP_FAMILIES = [
  "artifactVersions",
  "sourceVersions",
  "artifactProvenanceStatements",
  "sourceRelationshipStatements",
  "artifactSourceAttributions",
  "evidenceArtifactBindings",
  "knowledgeStateStatements",
] as const;

const FOUNDATION_TARGET_RANK = {
  evidence: 0,
  artifact_version: 1,
  provenance_snapshot: 2,
} as const;

export type Rcv016SnapshotIdFactoryV1 = () => string;

export interface Rcv016SnapshotWriteDependenciesV1 {
  readonly builderResult: Rcv016SnapshotBuilderResultV1;
  readonly snapshotIdFactory: Rcv016SnapshotIdFactoryV1;
  readonly repository: Rcv016SnapshotRepositoryV1;
}

export interface Rcv016SnapshotWriteResultV1 {
  readonly snapshotId: Rcv016ProvenanceSnapshotIdV1;
  readonly snapshotHash: Rcv016Sha256HexV1;
  readonly snapshotSchemaId: typeof RCV016_SNAPSHOT_SCHEMA_ID;
  readonly snapshotSchemaVersion: typeof RCV016_SNAPSHOT_SCHEMA_VERSION;
}

function ascii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertRcv016SnapshotHashIntegrity(
  canonical: string,
  expectedHash: string,
): void {
  if (sha256Rcv016Text(canonical) !== expectedHash) {
    throw new Rcv016HashIntegrityError(
      "snapshotBuilderResult.hash",
      "does not bind the exact Builder Canonical UTF-8 bytes",
    );
  }
}

function addFoundationTargets(
  foundation: Rcv016FoundationV1 | null,
  targets: Map<string, Rcv016FoundationReferenceTargetV1>,
): void {
  if (foundation === null) return;
  const add = (target: Rcv016FoundationReferenceTargetV1): void => {
    targets.set(`${target.targetType}\u0000${target.targetId}`, target);
  };
  for (const item of foundation.items) {
    if (item.kind === "evidence_reference") {
      add({ targetType: "evidence", targetId: item.evidenceId });
    } else if (item.kind === "artifact_version_reference") {
      add({ targetType: "artifact_version", targetId: item.artifactVersionId });
    } else if (item.kind === "deterministic_method") {
      for (const reference of item.inputReferences) {
        add({ targetType: reference.referenceType, targetId: reference.referenceId } as Rcv016FoundationReferenceTargetV1);
      }
    }
  }
}

export function enumerateRcv016FoundationReferenceTargets(
  value: Rcv016SnapshotBuilderResultV1,
): readonly Rcv016FoundationReferenceTargetV1[] {
  const result = assertFinalizedRcv016SnapshotBuilderResult(value);
  const targets = new Map<string, Rcv016FoundationReferenceTargetV1>();
  const statements = [
    ...result.snapshot.artifactProvenanceStatements,
    ...result.snapshot.sourceRelationshipStatements,
    ...result.snapshot.artifactSourceAttributions,
    ...result.snapshot.evidenceArtifactBindings,
    ...result.snapshot.knowledgeStateStatements,
  ];
  for (const statement of statements) addFoundationTargets(statement.foundation, targets);
  const ordered = [...targets.values()].sort((left, right) =>
    FOUNDATION_TARGET_RANK[left.targetType] - FOUNDATION_TARGET_RANK[right.targetType] ||
    ascii(left.targetId, right.targetId),
  );
  return freezeRcv016(ordered) as readonly Rcv016FoundationReferenceTargetV1[];
}

function assertSupportedIdentity(snapshot: Rcv016ProvenanceSnapshotCanonicalV1): void {
  if (
    snapshot.snapshotSchemaId !== RCV016_SNAPSHOT_SCHEMA_ID ||
    snapshot.snapshotSchemaVersion !== RCV016_SNAPSHOT_SCHEMA_VERSION ||
    snapshot.builderId !== RCV016_SNAPSHOT_BUILDER_ID ||
    snapshot.builderVersion !== RCV016_SNAPSHOT_BUILDER_VERSION ||
    snapshot.canonicalizationId !== RCV016_CANONICALIZATION_ID ||
    snapshot.canonicalizationVersion !== RCV016_CANONICALIZATION_VERSION ||
    snapshot.hashAlgorithm !== RCV016_HASH_ALGORITHM
  ) {
    throw new Rcv016UnsupportedContractVersionError(
      "snapshotBuilderResult.snapshot",
      "unsupported Snapshot, Builder, canonicalization, or hash identity",
    );
  }
}

function assertMembershipFamilies(result: Rcv016SnapshotBuilderResultV1): void {
  const keys = Object.keys(result.membership);
  if (
    keys.length !== MEMBERSHIP_FAMILIES.length ||
    MEMBERSHIP_FAMILIES.some((family) => !keys.includes(family))
  ) {
    throw new Rcv016SnapshotMembershipMismatchError(
      "snapshotBuilderResult.membership",
      "expected exactly seven typed Membership families",
    );
  }
}

function policyMatches(
  stored: Rcv016TraversalPolicySnapshotRecordV1,
  snapshot: Rcv016ProvenanceSnapshotCanonicalV1,
): boolean {
  return stored.policyId === snapshot.policyId &&
    stored.policyVersion === snapshot.policyVersion &&
    stored.definitionHash === snapshot.definitionHash &&
    stored.maxRoots === snapshot.maxRoots &&
    stored.maxNodes === snapshot.maxNodes &&
    stored.maxEdges === snapshot.maxEdges &&
    stored.maxDepth === snapshot.maxDepth &&
    stored.maxCanonicalSnapshotBytes === snapshot.maxCanonicalSnapshotBytes &&
    stored.deterministicOrdering === snapshot.deterministicOrdering &&
    stored.visitedSemantics === snapshot.visitedSemantics &&
    stored.allowedRelationships.length === snapshot.allowedRelationships.length &&
    stored.allowedRelationships.every((value, index) => value === snapshot.allowedRelationships[index]);
}

async function lockFoundationTarget(
  transaction: Rcv016SnapshotWriteTransactionV1,
  target: Rcv016FoundationReferenceTargetV1,
): Promise<void> {
  let locked: boolean;
  if (target.targetType === "evidence") {
    locked = await transaction.lockEvidenceForReferenceVerification(target.targetId);
  } else if (target.targetType === "artifact_version") {
    locked = await transaction.lockArtifactVersionForReferenceVerification(target.targetId);
  } else {
    locked = await transaction.lockProvenanceSnapshotForReferenceVerification(target.targetId);
  }
  if (!locked) {
    throw new Rcv016RelationalIntegrityError(
      "foundation",
      `missing ${target.targetType} target ${target.targetId}`,
    );
  }
}

function prepareBundle(
  result: Rcv016SnapshotBuilderResultV1,
  snapshotId: Rcv016ProvenanceSnapshotIdV1,
): Rcv016SnapshotPersistenceBundleV1 {
  const snapshot = result.snapshot;
  const header = {
    snapshotId,
    snapshotSchemaId: snapshot.snapshotSchemaId,
    snapshotSchemaVersion: snapshot.snapshotSchemaVersion,
    builderId: snapshot.builderId,
    builderVersion: snapshot.builderVersion,
    builderArtifactHash: snapshot.builderArtifactHash,
    canonicalizationId: snapshot.canonicalizationId,
    canonicalizationVersion: snapshot.canonicalizationVersion,
    hashAlgorithm: snapshot.hashAlgorithm,
    policyId: snapshot.policyId,
    policyVersion: snapshot.policyVersion,
    definitionHash: snapshot.definitionHash,
    maxRoots: snapshot.maxRoots,
    maxNodes: snapshot.maxNodes,
    maxEdges: snapshot.maxEdges,
    maxDepth: snapshot.maxDepth,
    maxCanonicalSnapshotBytes: snapshot.maxCanonicalSnapshotBytes,
    allowedRelationships: [...snapshot.allowedRelationships] as unknown as typeof snapshot.allowedRelationships,
    deterministicOrdering: snapshot.deterministicOrdering,
    visitedSemantics: snapshot.visitedSemantics,
    snapshotCanonical: result.canonical,
    snapshotHash: result.hash,
  };
  const membership = {
    artifactVersions: result.membership.artifactVersions.map(({ artifactVersionId, membershipRole }) => ({ snapshotId, artifactVersionId, membershipRole })),
    sourceVersions: result.membership.sourceVersions.map(({ sourceVersionId }) => ({ snapshotId, sourceVersionId })),
    artifactProvenanceStatements: result.membership.artifactProvenanceStatements.map(({ artifactProvenanceStatementId }) => ({ snapshotId, artifactProvenanceStatementId })),
    sourceRelationshipStatements: result.membership.sourceRelationshipStatements.map(({ sourceRelationshipStatementId }) => ({ snapshotId, sourceRelationshipStatementId })),
    artifactSourceAttributions: result.membership.artifactSourceAttributions.map(({ artifactSourceAttributionId }) => ({ snapshotId, artifactSourceAttributionId })),
    evidenceArtifactBindings: result.membership.evidenceArtifactBindings.map(({ evidenceArtifactBindingId }) => ({ snapshotId, evidenceArtifactBindingId })),
    knowledgeStateStatements: result.membership.knowledgeStateStatements.map(({ knowledgeStateStatementId }) => ({ snapshotId, knowledgeStateStatementId })),
  };
  return freezeRcv016({ header, membership }) as Rcv016SnapshotPersistenceBundleV1;
}

function isKnownTechnicalError(error: unknown): boolean {
  return error instanceof Rcv016TechnicalError ||
    error instanceof Rcv016RelationalIntegrityError ||
    error instanceof Rcv016SnapshotMembershipMismatchError ||
    error instanceof Rcv016DatabaseError;
}

export async function writeRcv016Snapshot(
  rawDependencies: Rcv016SnapshotWriteDependenciesV1,
): Promise<Rcv016SnapshotWriteResultV1> {
  const dependencyObject = expectRcv016ExactObject(
    rawDependencies,
    ["builderResult", "snapshotIdFactory", "repository"],
    "snapshotWriteDependencies",
  );
  if (typeof dependencyObject.snapshotIdFactory !== "function") {
    throw new Rcv016ValidationError(
      "snapshotWriteDependencies.snapshotIdFactory",
      "expected a function",
    );
  }
  if (
    dependencyObject.repository === null ||
    (typeof dependencyObject.repository !== "object" && typeof dependencyObject.repository !== "function") ||
    typeof (dependencyObject.repository as Rcv016SnapshotRepositoryV1).withRcv016WriteTransaction !== "function"
  ) {
    throw new Rcv016ValidationError(
      "snapshotWriteDependencies.repository",
      "expected an RCV-016 Snapshot repository",
    );
  }
  const dependencies = dependencyObject as unknown as Rcv016SnapshotWriteDependenciesV1;
  const result = assertFinalizedRcv016SnapshotBuilderResult(dependencies.builderResult);
  assertSupportedIdentity(result.snapshot);
  assertRcv016SnapshotHashIntegrity(result.canonical, result.hash);
  assertMembershipFamilies(result);
  const snapshotId = validateRcv016CanonicalUuid(
    dependencies.snapshotIdFactory(),
    "snapshotId",
  ) as Rcv016ProvenanceSnapshotIdV1;
  const targets = enumerateRcv016FoundationReferenceTargets(result);
  try {
    return await dependencies.repository.withRcv016WriteTransaction(
      { isolation: RCV016_SNAPSHOT_WRITE_ISOLATION },
      async (transaction) => {
        const storedPolicy = await transaction.loadTraversalPolicyByIdentity(
          result.snapshot.policyId,
          result.snapshot.policyVersion,
        );
        if (storedPolicy === null || !policyMatches(storedPolicy, result.snapshot)) {
          throw new Rcv016RelationalIntegrityError(
            "snapshot.policy",
            "exact Traversal Policy identity and definition are unavailable",
          );
        }
        for (const target of targets) await lockFoundationTarget(transaction, target);
        const bundle = prepareBundle(result, snapshotId);
        await transaction.insertSnapshotHeader(bundle.header);
        await transaction.insertSnapshotArtifactVersions(bundle.membership.artifactVersions);
        await transaction.insertSnapshotSourceVersions(bundle.membership.sourceVersions);
        await transaction.insertSnapshotArtifactProvenanceStatements(bundle.membership.artifactProvenanceStatements);
        await transaction.insertSnapshotSourceRelationshipStatements(bundle.membership.sourceRelationshipStatements);
        await transaction.insertSnapshotArtifactSourceAttributions(bundle.membership.artifactSourceAttributions);
        await transaction.insertSnapshotEvidenceArtifactBindings(bundle.membership.evidenceArtifactBindings);
        await transaction.insertSnapshotKnowledgeStateStatements(bundle.membership.knowledgeStateStatements);
        return freezeRcv016({
          snapshotId,
          snapshotHash: result.hash,
          snapshotSchemaId: RCV016_SNAPSHOT_SCHEMA_ID,
          snapshotSchemaVersion: RCV016_SNAPSHOT_SCHEMA_VERSION,
        }) as Rcv016SnapshotWriteResultV1;
      },
    );
  } catch (error) {
    if (isKnownTechnicalError(error)) throw error;
    throw new Rcv016DatabaseError("snapshotWrite", "repository transaction failed", error);
  }
}
