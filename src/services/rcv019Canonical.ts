import { canonicalizeAndHash, sha256 } from "./canonicalJson";
import {
  Rcv019Hash,
  Rcv019KnowledgeAt,
  Rcv019TemporalEvidenceState,
  Rcv019ValidationError,
  validateRcv019KnowledgeAt,
  validateRcv019Hash,
  validateRcv019Uuid,
  validateRcv019TransitionTypes,
  validateRcv019Version,
} from "../contracts/rcv019TemporalEvidenceContractV1";

export interface Rcv019CanonicalResult {
  readonly canonical: string;
  readonly hash: Rcv019Hash;
}

function canonical(value: unknown, path: string): Rcv019CanonicalResult {
  try {
    const result = canonicalizeAndHash(value);
    return Object.freeze({ canonical: result.canonical, hash: result.hash as Rcv019Hash });
  } catch (error) {
    throw new Rcv019ValidationError(path, error instanceof Error ? error.message : "canonicalization failed");
  }
}

/** State content excludes occurrence-only pointId and knowledgeAt by Contract. */
export function canonicalizeRcv019State(state: Rcv019TemporalEvidenceState): Rcv019CanonicalResult {
  if (state === null || typeof state !== "object") throw new Rcv019ValidationError("state", "expected object");
  validateRcv019Version(state.contractVersion, "state.contractVersion");
  validateRcv019Uuid(state.claimId, "state.claimId");
  validateRcv019Uuid(state.claimVersionId, "state.claimVersionId");
  if (!Array.isArray(state.evidenceProvenance)) throw new Rcv019ValidationError("state.evidenceProvenance", "expected array");
  if (state.rcv016Snapshot === null || typeof state.rcv016Snapshot !== "object" || Array.isArray(state.rcv016Snapshot)) {
    throw new Rcv019ValidationError("state.rcv016Snapshot", "expected object");
  }
  if (state.evidenceProvenance.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Rcv019ValidationError("state.evidenceProvenance", "malformed historical evidence entry");
  }
  if (state.rcv016Snapshot.snapshotId === undefined || state.rcv016Snapshot.snapshotHash === undefined) {
    throw new Rcv019ValidationError("state.rcv016Snapshot", "incomplete authenticated snapshot identity");
  }
  validateRcv019Uuid(state.rcv016Snapshot.snapshotId, "state.rcv016Snapshot.snapshotId");
  validateRcv019Hash(state.rcv016Snapshot.snapshotHash, "state.rcv016Snapshot.snapshotHash");
  const orderedEvidence = [...state.evidenceProvenance].sort((a, b) => {
    const left = canonicalizeAndHash(a).canonical;
    const right = canonicalizeAndHash(b).canonical;
    return left.localeCompare(right);
  });
  const orderedFacets = state.optionalFacets === undefined ? undefined : [...state.optionalFacets]
    .sort((a, b) => `${a.kind}|${a.id}|${a.version}|${a.hash}`.localeCompare(`${b.kind}|${b.id}|${b.version}|${b.hash}`));
  for (const facet of orderedFacets ?? []) {
    validateRcv019Uuid(facet.id, "state.optionalFacets.id");
    validateRcv019Hash(facet.hash, "state.optionalFacets.hash");
    validateRcv019Version(facet.version, "state.optionalFacets.version");
  }
  const value = {
    contractVersion: state.contractVersion,
    claimId: state.claimId,
    claimVersionId: state.claimVersionId,
    evidenceProvenance: orderedEvidence,
    rcv016Snapshot: state.rcv016Snapshot,
    ...(orderedFacets === undefined ? {} : { optionalFacets: orderedFacets }),
  };
  return canonical(value, "state");
}

export function hashRcv019State(state: Rcv019TemporalEvidenceState): Rcv019Hash {
  return canonicalizeRcv019State(state).hash;
}

export function canonicalizeRcv019KnowledgeAt(value: unknown): Rcv019KnowledgeAt {
  return validateRcv019KnowledgeAt(value);
}

export function canonicalizeRcv019TransitionTypes(types: readonly unknown[]): readonly string[] {
  return validateRcv019TransitionTypes(types);
}

/** Pure occurrence-envelope primitive; it does not sort or authenticate points. */
export function canonicalizeRcv019TimelineEnvelope(value: unknown): Rcv019CanonicalResult {
  return canonical(value, "timeline");
}

export function sha256Rcv019Text(value: string): Rcv019Hash {
  if (typeof value !== "string") throw new Rcv019ValidationError("text", "expected string");
  return sha256(value) as Rcv019Hash;
}
