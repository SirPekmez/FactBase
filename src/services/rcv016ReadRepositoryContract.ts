import { Rcv016ProvenanceSnapshotIdV1 } from "../contracts/rcv016ProvenanceContractV1";

export interface Rcv016HistoricalSnapshotHeaderReadV1 {
  readonly snapshotId: string;
  readonly snapshotCanonical: string;
  readonly snapshotHash: string;
  readonly persistenceCreatedAt: string;
}

export interface Rcv016HistoricalObjectReadV1 {
  /** Exact historical row projected to its frozen Snapshot-canonical object shape. */
  readonly value: unknown;
  /** Exact Payload Limits instance bound by that historical row. */
  readonly payloadLimits: unknown;
  /** Opaque Foundation TEXT/hash from the row; both null when Foundation is absent. */
  readonly foundationCanonical?: string | null;
  readonly foundationHash?: string | null;
}

export interface Rcv016HistoricalSnapshotReadV1 {
  readonly header: Rcv016HistoricalSnapshotHeaderReadV1;
  /** Seven typed rows projected to closed canonical Membership-key shapes. */
  readonly relationalMembershipKeys: readonly unknown[];
  readonly artifactVersions: readonly Rcv016HistoricalObjectReadV1[];
  readonly sourceVersions: readonly Rcv016HistoricalObjectReadV1[];
  readonly artifactProvenanceStatements: readonly Rcv016HistoricalObjectReadV1[];
  readonly sourceRelationshipStatements: readonly Rcv016HistoricalObjectReadV1[];
  readonly artifactSourceAttributions: readonly Rcv016HistoricalObjectReadV1[];
  readonly evidenceArtifactBindings: readonly Rcv016HistoricalObjectReadV1[];
  readonly knowledgeStateStatements: readonly Rcv016HistoricalObjectReadV1[];
  /** Exact versioned policy selected by the Snapshot's explicit identity. */
  readonly traversalPolicy: unknown | null;
  /** Exact typed historical targets visible to this read, never free-text assertions. */
  readonly foundationTargets: {
    readonly evidenceIds: readonly string[];
    readonly artifactVersionIds: readonly string[];
    readonly provenanceSnapshotIds: readonly string[];
  };
}

export interface Rcv016HistoricalSnapshotReadRepositoryV1 {
  loadHistoricalSnapshotById(
    snapshotId: Rcv016ProvenanceSnapshotIdV1,
  ): Promise<Rcv016HistoricalSnapshotReadV1 | null>;
}
