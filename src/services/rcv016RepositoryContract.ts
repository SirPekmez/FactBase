import {
  Rcv016ArtifactProvenanceStatementIdV1,
  Rcv016ArtifactSourceAttributionIdV1,
  Rcv016ArtifactVersionIdV1,
  Rcv016EvidenceArtifactBindingIdV1,
  Rcv016EvidenceIdV1,
  Rcv016KnowledgeStateStatementIdV1,
  Rcv016ProvenanceSnapshotCanonicalV1,
  Rcv016ProvenanceSnapshotIdV1,
  Rcv016Sha256HexV1,
  Rcv016SourceRelationshipStatementIdV1,
  Rcv016SourceVersionIdV1,
} from "../contracts/rcv016ProvenanceContractV1";

export const RCV016_SNAPSHOT_WRITE_ISOLATION = "repeatable_read" as const;

export type Rcv016WriteErrorCode =
  | "relational_integrity_error"
  | "snapshot_membership_mismatch"
  | "database_failure";

abstract class Rcv016WriteTechnicalError extends Error {
  abstract readonly code: Rcv016WriteErrorCode;

  protected constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
  }
}

export class Rcv016RelationalIntegrityError extends Rcv016WriteTechnicalError {
  readonly code = "relational_integrity_error" as const;
  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv016RelationalIntegrityError";
  }
}

export class Rcv016SnapshotMembershipMismatchError extends Rcv016WriteTechnicalError {
  readonly code = "snapshot_membership_mismatch" as const;
  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv016SnapshotMembershipMismatchError";
  }
}

export class Rcv016DatabaseError extends Rcv016WriteTechnicalError {
  readonly code = "database_failure" as const;
  constructor(path: string, message: string, public readonly cause?: unknown) {
    super(path, message);
    this.name = "Rcv016DatabaseError";
  }
}

export interface Rcv016TraversalPolicySnapshotRecordV1 {
  readonly policyId: Rcv016ProvenanceSnapshotCanonicalV1["policyId"];
  readonly policyVersion: Rcv016ProvenanceSnapshotCanonicalV1["policyVersion"];
  readonly definitionHash: Rcv016ProvenanceSnapshotCanonicalV1["definitionHash"];
  readonly maxRoots: Rcv016ProvenanceSnapshotCanonicalV1["maxRoots"];
  readonly maxNodes: Rcv016ProvenanceSnapshotCanonicalV1["maxNodes"];
  readonly maxEdges: Rcv016ProvenanceSnapshotCanonicalV1["maxEdges"];
  readonly maxDepth: Rcv016ProvenanceSnapshotCanonicalV1["maxDepth"];
  readonly maxCanonicalSnapshotBytes: Rcv016ProvenanceSnapshotCanonicalV1["maxCanonicalSnapshotBytes"];
  readonly allowedRelationships: Rcv016ProvenanceSnapshotCanonicalV1["allowedRelationships"];
  readonly deterministicOrdering: Rcv016ProvenanceSnapshotCanonicalV1["deterministicOrdering"];
  readonly visitedSemantics: Rcv016ProvenanceSnapshotCanonicalV1["visitedSemantics"];
}

export interface Rcv016SnapshotHeaderInsertV1 extends Rcv016TraversalPolicySnapshotRecordV1 {
  readonly snapshotId: Rcv016ProvenanceSnapshotIdV1;
  readonly snapshotSchemaId: Rcv016ProvenanceSnapshotCanonicalV1["snapshotSchemaId"];
  readonly snapshotSchemaVersion: Rcv016ProvenanceSnapshotCanonicalV1["snapshotSchemaVersion"];
  readonly builderId: Rcv016ProvenanceSnapshotCanonicalV1["builderId"];
  readonly builderVersion: Rcv016ProvenanceSnapshotCanonicalV1["builderVersion"];
  readonly builderArtifactHash: Rcv016ProvenanceSnapshotCanonicalV1["builderArtifactHash"];
  readonly canonicalizationId: Rcv016ProvenanceSnapshotCanonicalV1["canonicalizationId"];
  readonly canonicalizationVersion: Rcv016ProvenanceSnapshotCanonicalV1["canonicalizationVersion"];
  readonly hashAlgorithm: Rcv016ProvenanceSnapshotCanonicalV1["hashAlgorithm"];
  readonly snapshotCanonical: string;
  readonly snapshotHash: Rcv016Sha256HexV1;
}

export interface Rcv016SnapshotMembershipInsertCollectionsV1 {
  readonly artifactVersions: readonly { readonly snapshotId: Rcv016ProvenanceSnapshotIdV1; readonly artifactVersionId: Rcv016ArtifactVersionIdV1; readonly membershipRole: "root" | "included" }[];
  readonly sourceVersions: readonly { readonly snapshotId: Rcv016ProvenanceSnapshotIdV1; readonly sourceVersionId: Rcv016SourceVersionIdV1 }[];
  readonly artifactProvenanceStatements: readonly { readonly snapshotId: Rcv016ProvenanceSnapshotIdV1; readonly artifactProvenanceStatementId: Rcv016ArtifactProvenanceStatementIdV1 }[];
  readonly sourceRelationshipStatements: readonly { readonly snapshotId: Rcv016ProvenanceSnapshotIdV1; readonly sourceRelationshipStatementId: Rcv016SourceRelationshipStatementIdV1 }[];
  readonly artifactSourceAttributions: readonly { readonly snapshotId: Rcv016ProvenanceSnapshotIdV1; readonly artifactSourceAttributionId: Rcv016ArtifactSourceAttributionIdV1 }[];
  readonly evidenceArtifactBindings: readonly { readonly snapshotId: Rcv016ProvenanceSnapshotIdV1; readonly evidenceArtifactBindingId: Rcv016EvidenceArtifactBindingIdV1 }[];
  readonly knowledgeStateStatements: readonly { readonly snapshotId: Rcv016ProvenanceSnapshotIdV1; readonly knowledgeStateStatementId: Rcv016KnowledgeStateStatementIdV1 }[];
}

export interface Rcv016SnapshotPersistenceBundleV1 {
  readonly header: Rcv016SnapshotHeaderInsertV1;
  readonly membership: Rcv016SnapshotMembershipInsertCollectionsV1;
}

export type Rcv016FoundationReferenceTargetV1 =
  | { readonly targetType: "evidence"; readonly targetId: Rcv016EvidenceIdV1 }
  | { readonly targetType: "artifact_version"; readonly targetId: Rcv016ArtifactVersionIdV1 }
  | { readonly targetType: "provenance_snapshot"; readonly targetId: Rcv016ProvenanceSnapshotIdV1 };

export interface Rcv016SnapshotWriteTransactionV1 {
  loadTraversalPolicyByIdentity(policyId: string, policyVersion: string): Promise<Rcv016TraversalPolicySnapshotRecordV1 | null>;
  lockEvidenceForReferenceVerification(evidenceId: Rcv016EvidenceIdV1): Promise<boolean>;
  lockArtifactVersionForReferenceVerification(artifactVersionId: Rcv016ArtifactVersionIdV1): Promise<boolean>;
  lockProvenanceSnapshotForReferenceVerification(snapshotId: Rcv016ProvenanceSnapshotIdV1): Promise<boolean>;
  insertSnapshotHeader(header: Rcv016SnapshotHeaderInsertV1): Promise<void>;
  insertSnapshotArtifactVersions(rows: Rcv016SnapshotMembershipInsertCollectionsV1["artifactVersions"]): Promise<void>;
  insertSnapshotSourceVersions(rows: Rcv016SnapshotMembershipInsertCollectionsV1["sourceVersions"]): Promise<void>;
  insertSnapshotArtifactProvenanceStatements(rows: Rcv016SnapshotMembershipInsertCollectionsV1["artifactProvenanceStatements"]): Promise<void>;
  insertSnapshotSourceRelationshipStatements(rows: Rcv016SnapshotMembershipInsertCollectionsV1["sourceRelationshipStatements"]): Promise<void>;
  insertSnapshotArtifactSourceAttributions(rows: Rcv016SnapshotMembershipInsertCollectionsV1["artifactSourceAttributions"]): Promise<void>;
  insertSnapshotEvidenceArtifactBindings(rows: Rcv016SnapshotMembershipInsertCollectionsV1["evidenceArtifactBindings"]): Promise<void>;
  insertSnapshotKnowledgeStateStatements(rows: Rcv016SnapshotMembershipInsertCollectionsV1["knowledgeStateStatements"]): Promise<void>;
}

export interface Rcv016SnapshotRepositoryV1 {
  withRcv016WriteTransaction<T>(
    options: { readonly isolation: typeof RCV016_SNAPSHOT_WRITE_ISOLATION },
    operation: (transaction: Rcv016SnapshotWriteTransactionV1) => Promise<T>,
  ): Promise<T>;
}
