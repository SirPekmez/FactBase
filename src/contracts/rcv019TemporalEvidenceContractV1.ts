import {
  validateRcv016CanonicalTimestamp,
  validateRcv016CanonicalUuid,
  validateRcv016Sha256Hex,
} from "../services/rcv016Canonical";

export const RCV019_CONTRACT_VERSION = 1 as const;
export const RCV019_TRANSITION_TYPES = [
  "SUPPORTING_EVIDENCE_ADDED",
  "CONTRADICTING_EVIDENCE_ADDED",
  "DEPENDENCY_GAP_INTRODUCED",
  "DEPENDENCY_GAP_RESOLVED",
  "CONTRADICTION_INTRODUCED",
  "CONTRADICTION_RESOLVED",
  "ASSESSMENT_CHANGED",
  "UNCHANGED",
] as const;

export type Rcv019TransitionType = (typeof RCV019_TRANSITION_TYPES)[number];
export type Rcv019Uuid = ReturnType<typeof validateRcv016CanonicalUuid>;
export type Rcv019Hash = ReturnType<typeof validateRcv016Sha256Hex>;
export type Rcv019KnowledgeAt = ReturnType<typeof validateRcv016CanonicalTimestamp>;

export interface Rcv019HistoricalFacet {
  readonly kind: "RCV011_ASSESSMENT" | "RCV013_READ_PROJECTION" | "RCV014_RUBRIC_COMPARISON" | "RCV015_DERIVATION" | "RCV017_ANALYSIS" | "RCV018_ANALYSIS";
  readonly id: Rcv019Uuid;
  readonly version: number;
  readonly hash: Rcv019Hash;
  readonly content?: Readonly<Record<string, unknown>>;
}

export interface Rcv019TemporalEvidenceState {
  readonly contractVersion: typeof RCV019_CONTRACT_VERSION;
  readonly claimId: Rcv019Uuid;
  readonly claimVersionId: Rcv019Uuid;
  readonly evidenceProvenance: readonly Readonly<Record<string, unknown>>[];
  readonly rcv016Snapshot: Readonly<Record<string, unknown>>;
  readonly optionalFacets?: readonly Rcv019HistoricalFacet[];
}

export interface Rcv019TemporalEvidencePoint {
  readonly pointId: Rcv019Uuid;
  readonly claimId: Rcv019Uuid;
  readonly claimVersionId: Rcv019Uuid;
  readonly knowledgeAt: Rcv019KnowledgeAt;
  readonly state: Rcv019TemporalEvidenceState;
  readonly stateHash: Rcv019Hash;
}

export interface Rcv019TemporalEvidenceTransition {
  readonly fromPointId: Rcv019Uuid;
  readonly toPointId: Rcv019Uuid;
  readonly version: typeof RCV019_CONTRACT_VERSION;
  readonly changeTypes: readonly Rcv019TransitionType[];
}

export interface Rcv019TemporalEvidenceAnalysis {
  readonly analysisId: Rcv019Uuid;
  readonly contractVersion: typeof RCV019_CONTRACT_VERSION;
  readonly claimId: Rcv019Uuid;
  readonly points: readonly Rcv019TemporalEvidencePoint[];
  readonly transitions: readonly Rcv019TemporalEvidenceTransition[];
  readonly canonical: string;
  readonly timelineHash: Rcv019Hash;
}

export class Rcv019ValidationError extends Error {
  readonly code = "REJECT_UNSUPPORTED" as const;
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "Rcv019ValidationError";
  }
}

export function validateRcv019KnowledgeAt(value: unknown, path = "knowledgeAt"): Rcv019KnowledgeAt {
  try {
    return validateRcv016CanonicalTimestamp(value, path);
  } catch {
    throw new Rcv019ValidationError(path, "expected canonical UTC timestamp YYYY-MM-DDTHH:mm:ss.ffffffZ");
  }
}

export function validateRcv019Version(value: unknown, path = "version"): 1 {
  if (value !== 1) throw new Rcv019ValidationError(path, "unsupported RCV-019 version");
  return 1;
}

export function validateRcv019TransitionTypes(types: readonly unknown[], path = "changeTypes"): readonly Rcv019TransitionType[] {
  const seen = new Set<string>();
  let previous = -1;
  for (const type of types) {
    if (typeof type !== "string") throw new Rcv019ValidationError(path, "transition type must be text");
    const index = RCV019_TRANSITION_TYPES.indexOf(type as Rcv019TransitionType);
    if (index < 0 || seen.has(type) || index <= previous) {
      throw new Rcv019ValidationError(path, "transition types must be closed, unique, and canonicalized");
    }
    seen.add(type);
    previous = index;
  }
  if (types.length === 0) throw new Rcv019ValidationError(path, "transition types must not be empty");
  return types as readonly Rcv019TransitionType[];
}

export function validateRcv019Uuid(value: unknown, path = "id"): Rcv019Uuid {
  try { return validateRcv016CanonicalUuid(value, path); }
  catch { throw new Rcv019ValidationError(path, "expected lowercase canonical UUID"); }
}

export function validateRcv019Hash(value: unknown, path = "hash"): Rcv019Hash {
  try { return validateRcv016Sha256Hex(value, path); }
  catch { throw new Rcv019ValidationError(path, "expected lowercase SHA-256 hash"); }
}
