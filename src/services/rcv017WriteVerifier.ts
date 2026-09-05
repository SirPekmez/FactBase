import {
  RCV017_ALGORITHM_ID,
  RCV017_ALGORITHM_VERSION,
  RCV017_ANALYSIS_SCHEMA_ID,
  RCV017_ANALYSIS_SCHEMA_VERSION,
  RCV017_CANONICALIZATION_ID,
  RCV017_CANONICALIZATION_VERSION,
  RCV017_HASH_ALGORITHM,
} from "../contracts/rcv017ClaimEvidenceDependencyContractV1";
import { canonicalizeRcv016, sha256Rcv016Text } from "./rcv016Canonical";
import { freezeRcv016 } from "./rcv016Validation";
import {
  assertFinalizedRcv017AnalysisResult,
  Rcv017AnalysisBuilderResultV1,
  Rcv017IntegrityParityError,
  Rcv017UnsupportedVersionError,
  Rcv017ValidationError,
} from "./rcv017AnalysisBuilder";
import {
  projectRcv017Persistence,
  Rcv017PersistenceProjectionV1,
} from "./rcv017PersistenceProjection";

export interface Rcv017VerifiedAnalysisWriteV1 {
  readonly analysisId: string;
  readonly analysisSchemaId: typeof RCV017_ANALYSIS_SCHEMA_ID;
  readonly analysisSchemaVersion: typeof RCV017_ANALYSIS_SCHEMA_VERSION;
  readonly analysisHash: string;
  readonly projection: Rcv017PersistenceProjectionV1;
}

export interface Rcv017WriteVerifierInputV1 {
  readonly builderResult: Rcv017AnalysisBuilderResultV1;
  readonly provenanceSnapshotIdentity: {
    readonly snapshotId: string;
    readonly snapshotHash: string;
  };
  readonly dependencyAnalysisPolicyIdentity: {
    readonly policyId: string;
    readonly policyVersion: number;
    readonly policyHash: string;
  };
  readonly analysisIdFactory: () => string;
}

const VERIFIED_WRITES = new WeakSet<object>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const UUID_FIELDS = new Set([
  "claimVersionId",
  "claimVersionEvidenceRelationId",
  "evidenceArtifactBindingStatementId",
  "evidenceId",
  "artifactVersionId",
  "upstreamArtifactVersionId",
  "knowledgeStateStatementId",
  "provenanceSnapshotId",
  "policyId",
  "dependencyAnalysisPolicyId",
]);
const UUID_ARRAY_FIELDS = new Set([
  "artifactVersionIds",
  "artifactProvenanceStatementIds",
  "affectedArtifactVersionIds",
  "knowledgeStateStatementIds",
  "derivedUnrecordedArtifactVersionIds",
]);

function verifyUuidText(value: unknown, path = "analysisBuilderResult"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => verifyUuidText(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (UUID_FIELDS.has(key)) {
      if (typeof item !== "string" || !UUID.test(item)) {
        throw new Rcv017ValidationError(`${path}.${key}`, "expected lowercase canonical UUID text");
      }
    } else if (UUID_ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string" || !UUID.test(entry))) {
        throw new Rcv017ValidationError(`${path}.${key}`, "expected lowercase canonical UUID text array");
      }
    }
    verifyUuidText(item, `${path}.${key}`);
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalizeRcv016(left).canonical === canonicalizeRcv016(right).canonical;
}

function exactIdentity(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    throw new Rcv017ValidationError(path, "expected an exact closed identity object");
  }
  return value as Record<string, unknown>;
}

function verifyFinalizedResult(
  value: unknown,
): Rcv017AnalysisBuilderResultV1 {
  const result = assertFinalizedRcv017AnalysisResult(value);
  const analysis = result.analysis;
  verifyUuidText(analysis);
  verifyUuidText(result.policy.definition, "analysisBuilderResult.policy.definition");
  if (
    analysis.schemaId !== RCV017_ANALYSIS_SCHEMA_ID ||
    analysis.schemaVersion !== RCV017_ANALYSIS_SCHEMA_VERSION ||
    analysis.algorithmId !== RCV017_ALGORITHM_ID ||
    analysis.algorithmVersion !== RCV017_ALGORITHM_VERSION ||
    analysis.canonicalizationId !== RCV017_CANONICALIZATION_ID ||
    analysis.canonicalizationVersion !== RCV017_CANONICALIZATION_VERSION ||
    analysis.hashAlgorithm !== RCV017_HASH_ALGORITHM
  ) {
    throw new Rcv017UnsupportedVersionError(
      "analysisBuilderResult.analysis",
      "unsupported finalized analysis identity",
    );
  }
  const encoded = canonicalizeRcv016(analysis);
  if (
    encoded.canonical !== result.canonical ||
    String(encoded.hash) !== result.hash ||
    String(sha256Rcv016Text(result.canonical)) !== result.hash
  ) {
    throw new Rcv017IntegrityParityError(
      "analysisBuilderResult",
      "Canonical/hash does not bind the exact finalized analysis",
    );
  }
  if (
    !HASH.test(analysis.provenanceSnapshotHash) ||
    !HASH.test(analysis.dependencyAnalysisPolicyHash) ||
    !HASH.test(analysis.algorithmArtifactHash) ||
    !HASH.test(result.hash) ||
    !HASH.test(result.policy.hash) ||
    analysis.dependencyAnalysisPolicyId !== result.policy.definition.policyId ||
    analysis.dependencyAnalysisPolicyVersion !== result.policy.definition.policyVersion ||
    analysis.dependencyAnalysisPolicyHash !== result.policy.hash ||
    canonicalizeRcv016(result.policy.definition).canonical !== result.policy.canonical ||
    String(sha256Rcv016Text(result.policy.canonical)) !== result.policy.hash
  ) {
    throw new Rcv017IntegrityParityError(
      "analysisBuilderResult",
      "Snapshot or Policy identity/hash parity failed",
    );
  }
  if (
    Buffer.byteLength(result.canonical, "utf8") >
    result.policy.definition.maxCanonicalBytes
  ) {
    throw new Rcv017IntegrityParityError(
      "analysisBuilderResult.canonical",
      "exceeds the exact bound maxCanonicalBytes",
    );
  }
  const expectedProjection = projectRcv017Persistence(
    analysis,
    result.canonical,
    result.hash,
    result.policy.definition,
    result.policy.canonical,
    result.policy.hash,
  );
  if (!sameValue(expectedProjection, result.projection)) {
    throw new Rcv017IntegrityParityError(
      "analysisBuilderResult.projection",
      "relational projection does not match exact Canonical content",
    );
  }
  return result;
}

export function assertVerifiedRcv017AnalysisWrite(
  value: unknown,
): Rcv017VerifiedAnalysisWriteV1 {
  if (
    value === null || typeof value !== "object" ||
    !VERIFIED_WRITES.has(value)
  ) {
    throw new Rcv017ValidationError(
      "verifiedAnalysisWrite",
      "value was not authenticated by the RCV-017 Write-Verifier",
    );
  }
  return value as Rcv017VerifiedAnalysisWriteV1;
}

export function verifyRcv017AnalysisForWrite(
  input: Rcv017WriteVerifierInputV1,
): Rcv017VerifiedAnalysisWriteV1 {
  if (
    input === null || typeof input !== "object" || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== 4 ||
    !("builderResult" in input) ||
    !("provenanceSnapshotIdentity" in input) ||
    !("dependencyAnalysisPolicyIdentity" in input) ||
    !("analysisIdFactory" in input) ||
    typeof input.analysisIdFactory !== "function"
  ) {
    throw new Rcv017ValidationError(
      "writeVerifierInput",
      "expected exact builderResult and analysisIdFactory dependencies",
    );
  }
  const result = verifyFinalizedResult(input.builderResult);
  const snapshotIdentity = exactIdentity(
    input.provenanceSnapshotIdentity,
    ["snapshotId", "snapshotHash"],
    "provenanceSnapshotIdentity",
  );
  const policyIdentity = exactIdentity(
    input.dependencyAnalysisPolicyIdentity,
    ["policyId", "policyVersion", "policyHash"],
    "dependencyAnalysisPolicyIdentity",
  );
  if (
    typeof snapshotIdentity.snapshotId !== "string" ||
    !UUID.test(snapshotIdentity.snapshotId) ||
    typeof snapshotIdentity.snapshotHash !== "string" ||
    !HASH.test(snapshotIdentity.snapshotHash) ||
    snapshotIdentity.snapshotId !== result.analysis.provenanceSnapshotId ||
    snapshotIdentity.snapshotHash !== result.analysis.provenanceSnapshotHash
  ) {
    throw new Rcv017IntegrityParityError(
      "provenanceSnapshotIdentity",
      "does not match the exact finalized Snapshot ID/hash binding",
    );
  }
  if (
    typeof policyIdentity.policyId !== "string" ||
    !UUID.test(policyIdentity.policyId) ||
    typeof policyIdentity.policyVersion !== "number" ||
    !Number.isSafeInteger(policyIdentity.policyVersion) ||
    policyIdentity.policyVersion <= 0 ||
    typeof policyIdentity.policyHash !== "string" ||
    !HASH.test(policyIdentity.policyHash) ||
    policyIdentity.policyId !== result.analysis.dependencyAnalysisPolicyId ||
    policyIdentity.policyVersion !== result.analysis.dependencyAnalysisPolicyVersion ||
    policyIdentity.policyHash !== result.analysis.dependencyAnalysisPolicyHash
  ) {
    throw new Rcv017IntegrityParityError(
      "dependencyAnalysisPolicyIdentity",
      "does not match the exact finalized Policy ID/version/hash binding",
    );
  }
  const analysisId = input.analysisIdFactory();
  if (typeof analysisId !== "string" || !UUID.test(analysisId)) {
    throw new Rcv017ValidationError(
      "analysisId",
      "expected a lowercase canonical UUID without normalization",
    );
  }
  const verified = freezeRcv016({
    analysisId,
    analysisSchemaId: result.analysis.schemaId,
    analysisSchemaVersion: result.analysis.schemaVersion,
    analysisHash: result.hash,
    projection: result.projection,
  }) as Rcv017VerifiedAnalysisWriteV1;
  VERIFIED_WRITES.add(verified);
  return verified;
}
