import {
  RCV019_TRANSITION_TYPES,
  Rcv019TemporalEvidencePoint,
  Rcv019TemporalEvidenceState,
  Rcv019TemporalEvidenceTransition,
  Rcv019Uuid,
  Rcv019Hash,
  Rcv019KnowledgeAt,
  Rcv019TransitionType,
  Rcv019ValidationError,
  validateRcv019Hash,
  validateRcv019KnowledgeAt,
  validateRcv019TransitionTypes,
  validateRcv019Uuid,
  validateRcv019Version,
} from "../contracts/rcv019TemporalEvidenceContractV1";
import { canonicalizeRcv019State, canonicalizeRcv019TimelineEnvelope } from "./rcv019Canonical";
import { deriveRcv019Transition } from "./rcv019TransitionDeriver";
import { Rcv019PersistedReadBundle } from "./rcv019PostgresReadRepository";

export type Rcv019ReadFailureCode =
  | "ANALYSIS_NOT_FOUND" | "MISSING_DATA" | "MALFORMED_DATA" | "INCONSISTENT_DATA"
  | "VERSION_MISMATCH" | "HASH_MISMATCH" | "CANONICAL_MISMATCH" | "MEMBERSHIP_MISMATCH"
  | "DUPLICATE_MEMBERSHIP" | "ORDERING_VIOLATION" | "TRANSITION_SET_MISMATCH" | "UNSUPPORTED_STATE"
  | "UNSUPPORTED_TRANSITION";

export class Rcv019ReadVerificationError extends Error {
  readonly name = "Rcv019ReadVerificationError";
  constructor(public readonly code: Rcv019ReadFailureCode, message: string, public readonly cause?: unknown) { super(message); }
}

function fail(code: Rcv019ReadFailureCode, message: string, cause?: unknown): never { throw new Rcv019ReadVerificationError(code, message, cause); }
function uuid(value: unknown, field: string): Rcv019Uuid { try { return validateRcv019Uuid(value, field); } catch (e) { return fail("MALFORMED_DATA", field, e); } }
function hash(value: unknown, field: string): Rcv019Hash { try { return validateRcv019Hash(value, field); } catch (e) { return fail("MALFORMED_DATA", field, e); } }
function version(value: unknown, field: string): number { try { return validateRcv019Version(value, field); } catch (e) { return fail("VERSION_MISMATCH", field, e); } }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export interface Rcv019VerifiedRead {
  readonly analysisId: string;
  readonly claimId: string;
  readonly points: readonly Rcv019TemporalEvidencePoint[];
  readonly transitions: readonly Rcv019TemporalEvidenceTransition[];
  readonly canonical: string;
  readonly timelineHash: string;
}

/** Independently authenticates a raw persisted bundle; it never calls the write verifier. */
export function verifyRcv019ReadBundle(bundle: Rcv019PersistedReadBundle): Rcv019VerifiedRead {
  if (!bundle || !bundle.analysis || !Array.isArray(bundle.points) || !Array.isArray(bundle.facets) || !Array.isArray(bundle.transitions)) fail("MISSING_DATA", "incomplete persisted bundle");
  const analysis = bundle.analysis;
  const analysisId = uuid(analysis.analysisId, "analysisId");
  const claimId = uuid(analysis.claimId, "claimId");
  if (version(analysis.contractVersion, "contractVersion") !== 1) fail("VERSION_MISMATCH", "contractVersion");
  const storedCanonical = typeof analysis.canonical === "string" ? analysis.canonical : fail("MALFORMED_DATA", "analysis.canonical");
  const storedTimelineHash = hash(analysis.timelineHash, "timelineHash");
  if (bundle.points.length === 0) fail("MISSING_DATA", "points");
  const seenPoints = new Set<string>();
  const points: Rcv019TemporalEvidencePoint[] = [];
  for (let i = 0; i < bundle.points.length; i += 1) {
    const row = bundle.points[i];
    const pointId = uuid(row.pointId, `points[${i}].pointId`);
    if (seenPoints.has(pointId)) fail("DUPLICATE_MEMBERSHIP", "duplicate pointId");
    seenPoints.add(pointId);
    if (uuid(row.analysisId, `points[${i}].analysisId`) !== analysisId) fail("MEMBERSHIP_MISMATCH", "point analysis membership");
    const rowClaim = uuid(row.claimId, `points[${i}].claimId`);
    const claimVersionId = uuid(row.claimVersionId, `points[${i}].claimVersionId`);
    if (rowClaim !== claimId) fail("MEMBERSHIP_MISMATCH", "point Claim membership");
    const ordinal = row.ordinal;
    if (!Number.isSafeInteger(ordinal) || ordinal !== i || ordinal < 0) fail("ORDERING_VIOLATION", "point ordinal");
    let knowledgeAt: Rcv019KnowledgeAt; try { knowledgeAt = validateRcv019KnowledgeAt(row.knowledgeAt); } catch (e) { return fail("MALFORMED_DATA", "knowledgeAt", e); }
    if (i > 0 && points[i - 1].knowledgeAt >= knowledgeAt) fail("ORDERING_VIOLATION", "knowledgeAt order");
    const stateVersion = version(row.stateVersion, `points[${i}].stateVersion`);
    if (typeof row.stateCanonical !== "string") fail("MALFORMED_DATA", "stateCanonical");
    let state: Rcv019TemporalEvidenceState;
    try { state = JSON.parse(row.stateCanonical) as Rcv019TemporalEvidenceState; } catch (e) { return fail("MALFORMED_DATA", "stateCanonical", e); }
    if (state.claimId !== rowClaim || state.claimVersionId !== claimVersionId) fail("MEMBERSHIP_MISMATCH", "state ClaimVersion membership");
    const stateCanonical = canonicalizeRcv019State(state);
    if (stateCanonical.canonical !== row.stateCanonical) fail("CANONICAL_MISMATCH", "state canonical");
    if (stateCanonical.hash !== hash(row.stateHash, `points[${i}].stateHash`)) fail("HASH_MISMATCH", "state hash");
    if (stateVersion !== 1) fail("VERSION_MISMATCH", "state version");
    points.push(Object.freeze({ pointId, claimId: rowClaim, claimVersionId, knowledgeAt, state, stateHash: stateCanonical.hash }));
  }
  const pointById = new Map(points.map(p => [p.pointId, p]));
  const facetKeys = new Set<string>();
  const facetsByPoint = new Map<string, Readonly<Record<string, unknown>>[]>();
  for (const facet of bundle.facets) {
    const pointId = uuid(facet.pointId, "facet.pointId"); if (!pointById.has(pointId)) fail("MEMBERSHIP_MISMATCH", "facet point");
    const ordinal = facet.ordinal; if (!Number.isSafeInteger(ordinal) || ordinal < 0) fail("ORDERING_VIOLATION", "facet ordinal");
    const kind = facet.facetKind; const facetId = uuid(facet.facetId, "facet.facetId"); const facetVersion = version(facet.facetVersion, "facet.version"); const facetHash = hash(facet.facetHash, "facet.hash");
    const key = `${pointId}|${kind}|${facetId}|${facetVersion}`; if (facetKeys.has(key)) fail("DUPLICATE_MEMBERSHIP", "duplicate facet membership"); facetKeys.add(key);
    const list = facetsByPoint.get(pointId) ?? []; list.push({ kind, id: facetId, version: facetVersion, hash: facetHash, ordinal }); facetsByPoint.set(pointId, list);
  }
  for (const point of points) {
    const declared = (point.state.optionalFacets ?? []).map(f => ({ kind: f.kind, id: f.id, version: f.version, hash: f.hash }));
    const stored = (facetsByPoint.get(point.pointId) ?? []).sort((a,b)=>Number(a.ordinal)-Number(b.ordinal)).map(f=>({kind:f.kind,id:f.id,version:f.version,hash:f.hash}));
    if (!same(declared, stored)) fail("MEMBERSHIP_MISMATCH", "facet membership");
  }
  if (bundle.transitions.length !== Math.max(points.length - 1, 0)) fail("TRANSITION_SET_MISMATCH", "transition cardinality");
  const transitions: Rcv019TemporalEvidenceTransition[] = [];
  const seenTransitions = new Set<string>();
  for (let i = 0; i < bundle.transitions.length; i += 1) {
    const row = bundle.transitions[i]; const ordinal = row.ordinal;
    if (!Number.isSafeInteger(ordinal) || ordinal !== i || ordinal < 0) fail("ORDERING_VIOLATION", "transition ordinal");
    if (uuid(row.analysisId, "transition.analysisId") !== analysisId) fail("MEMBERSHIP_MISMATCH", "transition analysis");
    const from = uuid(row.fromPointId, "transition.fromPointId"); const to = uuid(row.toPointId, "transition.toPointId");
    if (!pointById.has(from) || !pointById.has(to) || from !== points[i].pointId || to !== points[i + 1].pointId) fail("MEMBERSHIP_MISMATCH", "transition adjacency");
    const key = `${from}|${to}`; if (seenTransitions.has(key)) fail("DUPLICATE_MEMBERSHIP", "duplicate transition"); seenTransitions.add(key);
    const transitionVersion = version(row.transitionVersion, "transition.version");
    if (!Array.isArray(row.changeTypes)) fail("MALFORMED_DATA", "transition changeTypes");
    let changeTypes: readonly Rcv019TransitionType[]; try { changeTypes = validateRcv019TransitionTypes(row.changeTypes); } catch (e) { return fail("UNSUPPORTED_TRANSITION", "transition changeTypes", e); }
    const derived = deriveRcv019Transition(points[i], points[i + 1]);
    if (!same(changeTypes, derived.changeTypes)) fail("TRANSITION_SET_MISMATCH", "transition semantics");
    transitions.push(Object.freeze({ fromPointId: from, toPointId: to, version: transitionVersion as 1, changeTypes }));
  }
  const envelope = { contractVersion: 1, analysisId, claimId, points: points.map(p=>({pointId:p.pointId,claimId:p.claimId,claimVersionId:p.claimVersionId,knowledgeAt:p.knowledgeAt,stateHash:p.stateHash})), transitions };
  const canonical = canonicalizeRcv019TimelineEnvelope(envelope);
  if (canonical.canonical !== storedCanonical) fail("CANONICAL_MISMATCH", "timeline canonical");
  if (canonical.hash !== storedTimelineHash) fail("HASH_MISMATCH", "timeline hash");
  return Object.freeze({ analysisId, claimId, points: Object.freeze(points), transitions: Object.freeze(transitions), canonical: canonical.canonical, timelineHash: canonical.hash });
}

export const verifyRcv019Read = verifyRcv019ReadBundle;
