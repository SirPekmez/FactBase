import { Rcv016ProvenanceSnapshotIdV1 } from "../contracts/rcv016ProvenanceContractV1";
import {
  Rcv016HistoricalSnapshotReadRepositoryV1,
} from "./rcv016ReadRepositoryContract";
import {
  Rcv016VerifiedHistoricalSnapshotV1,
} from "./rcv016ReadVerifier";
import { Rcv016SnapshotRepositoryV1 } from "./rcv016RepositoryContract";
import {
  Rcv016SnapshotBuilderResultV1,
} from "./rcv016SnapshotBuilder";
import {
  Rcv016SnapshotIdFactoryV1,
  Rcv016SnapshotWriteDependenciesV1,
  Rcv016SnapshotWriteResultV1,
} from "./rcv016WriteVerifier";

export type Rcv016SnapshotBuilderCommandV1 = (
  input: unknown,
) => Rcv016SnapshotBuilderResultV1;

export type Rcv016SnapshotWriterCommandV1 = (
  dependencies: Rcv016SnapshotWriteDependenciesV1,
) => Promise<Rcv016SnapshotWriteResultV1>;

export type Rcv016SnapshotVerifierCommandV1 = (
  snapshotId: unknown,
  repository: Rcv016HistoricalSnapshotReadRepositoryV1,
) => Promise<Rcv016VerifiedHistoricalSnapshotV1>;

export interface Rcv016ApplicationServiceDependenciesV1 {
  /** CONTRACT-MAPPED owner of Snapshot construction. */
  readonly builder: Rcv016SnapshotBuilderCommandV1;
  /** CONTRACT-MAPPED owner of authenticated, atomic Snapshot persistence. */
  readonly writer: Rcv016SnapshotWriterCommandV1;
  /** CONTRACT-MAPPED owner of neutral historical integrity verification. */
  readonly verifier: Rcv016SnapshotVerifierCommandV1;
  /** PURE TECHNICAL dependency used only by the delegated Write-Verifier. */
  readonly writeRepository: Rcv016SnapshotRepositoryV1;
  /** CONTRACT-MAPPED exact historical read boundary. */
  readonly readRepository: Rcv016HistoricalSnapshotReadRepositoryV1;
  /** PURE TECHNICAL persistence-identity factory. */
  readonly snapshotIdFactory: Rcv016SnapshotIdFactoryV1;
}

export interface Rcv016ApplicationServiceV1 {
  /** Builds one authenticated finalized Snapshot; it performs no persistence. */
  buildSnapshot(input: unknown): Rcv016SnapshotBuilderResultV1;
  /** Persists exactly one authenticated finalized Builder result. */
  writeSnapshot(result: Rcv016SnapshotBuilderResultV1): Promise<Rcv016SnapshotWriteResultV1>;
  /** Verifies exactly the requested persisted historical Snapshot. */
  verifySnapshot(snapshotId: Rcv016ProvenanceSnapshotIdV1): Promise<Rcv016VerifiedHistoricalSnapshotV1>;
}

/**
 * Thin RCV-016 command orchestration. It deliberately owns no canonical,
 * traversal, persistence, or read-verification semantics.
 */
export function createRcv016ApplicationService(
  dependencies: Rcv016ApplicationServiceDependenciesV1,
): Rcv016ApplicationServiceV1 {
  const builder = dependencies.builder;
  const writer = dependencies.writer;
  const verifier = dependencies.verifier;
  const writeRepository = dependencies.writeRepository;
  const readRepository = dependencies.readRepository;
  const snapshotIdFactory = dependencies.snapshotIdFactory;

  return Object.freeze({
    buildSnapshot(input: unknown): Rcv016SnapshotBuilderResultV1 {
      return builder(input);
    },

    writeSnapshot(result: Rcv016SnapshotBuilderResultV1): Promise<Rcv016SnapshotWriteResultV1> {
      return writer(Object.freeze({
        builderResult: result,
        repository: writeRepository,
        snapshotIdFactory,
      }));
    },

    verifySnapshot(
      snapshotId: Rcv016ProvenanceSnapshotIdV1,
    ): Promise<Rcv016VerifiedHistoricalSnapshotV1> {
      return verifier(snapshotId, readRepository);
    },
  });
}
