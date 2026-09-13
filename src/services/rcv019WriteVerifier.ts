import {
  Rcv019TemporalEvidenceAnalysis,
  Rcv019TemporalEvidencePoint,
  Rcv019ValidationError,
  validateRcv019Version,
  validateRcv019Uuid,
} from "../contracts/rcv019TemporalEvidenceContractV1";
import { canonicalizeRcv019State, canonicalizeRcv019TimelineEnvelope, hashRcv019State } from "./rcv019Canonical";
import { deriveRcv019Transition } from "./rcv019TransitionDeriver";

export interface Rcv019VerifiedWrite {
  readonly analysis: Rcv019TemporalEvidenceAnalysis;
  readonly pointRows: readonly Readonly<Record<string, unknown>>[];
  readonly facetRows: readonly Readonly<Record<string, unknown>>[];
  readonly transitionRows: readonly Readonly<Record<string, unknown>>[];
}

function fail(path: string, message: string): never { throw new Rcv019ValidationError(path, message); }

/** Independently authenticates a completed Wave-2 timeline before persistence. */
export function verifyRcv019Write(analysis: unknown): Rcv019VerifiedWrite {
  if (analysis === null || typeof analysis !== "object" || Array.isArray(analysis)) fail("analysis", "malformed analysis identity");
  const value = analysis as Rcv019TemporalEvidenceAnalysis;
  validateRcv019Version(value.contractVersion, "contractVersion");
  const analysisId = validateRcv019Uuid(value.analysisId, "analysisId");
  const claimId = validateRcv019Uuid(value.claimId, "claimId");
  if (!Array.isArray(value.points) || value.points.length === 0) fail("points", "POINT_NOT_FOUND");
  if (!Array.isArray(value.transitions)) fail("transitions", "malformed transition membership");
  const seen = new Set<string>();
  const points = value.points.map((point: Rcv019TemporalEvidencePoint, index) => {
    if (point === null || typeof point !== "object") fail(`points[${index}]`, "UNAUTHENTICATED_POINT");
    validateRcv019Uuid(point.pointId, `points[${index}].pointId`);
    validateRcv019Uuid(point.claimId, `points[${index}].claimId`);
    validateRcv019Uuid(point.claimVersionId, `points[${index}].claimVersionId`);
    if (point.claimId !== claimId || point.state.claimId !== claimId || point.state.claimVersionId !== point.claimVersionId) fail(`points[${index}]`, "INVALID_CLAIM_VERSION_BINDING");
    if (seen.has(point.pointId)) fail(`points[${index}].pointId`, "DUPLICATE_POINT_ID");
    seen.add(point.pointId);
    const computedStateHash = hashRcv019State(point.state);
    if (computedStateHash !== point.stateHash) fail(`points[${index}].stateHash`, "HASH_MISMATCH");
    return Object.freeze({ ...point, stateHash: computedStateHash });
  });
  for (let i = 1; i < points.length; i += 1) {
    if (points[i - 1].knowledgeAt >= points[i].knowledgeAt) fail("points.knowledgeAt", "AMBIGUOUS_TEMPORAL_ORDER");
  }
  const transitions = points.slice(1).map((point, index) => deriveRcv019Transition(points[index], point));
  if (value.transitions.length !== transitions.length) fail("transitions", "transition membership mismatch");
  for (let i = 0; i < transitions.length; i += 1) {
    if (JSON.stringify(value.transitions[i]) !== JSON.stringify(transitions[i])) fail(`transitions[${i}]`, "UNSUPPORTED_TRANSITION");
  }
  const envelope = {
    contractVersion: 1,
    analysisId,
    claimId,
    points: points.map((point) => ({ pointId: point.pointId, claimId: point.claimId, claimVersionId: point.claimVersionId, knowledgeAt: point.knowledgeAt, stateHash: point.stateHash })),
    transitions,
  };
  const canonical = canonicalizeRcv019TimelineEnvelope(envelope);
  if (value.canonical !== canonical.canonical) fail("canonical", "CANONICAL_MISMATCH");
  if (value.timelineHash !== canonical.hash) fail("timelineHash", "HASH_MISMATCH");
  const pointRows = points.map((point, ordinal) => Object.freeze({
    pointId: point.pointId, analysisId, ordinal, claimId: point.claimId,
    claimVersionId: point.claimVersionId, knowledgeAt: point.knowledgeAt,
    stateVersion: point.state.contractVersion,
    stateCanonical: canonicalizeRcv019State(point.state).canonical,
    stateHash: point.stateHash,
  }));
  const facetRows = points.flatMap((point) => (point.state.optionalFacets ?? []).map((facet, ordinal) => Object.freeze({
    pointId: point.pointId, ordinal, facetKind: facet.kind, facetId: facet.id,
    facetVersion: facet.version, facetHash: facet.hash,
  })));
  const transitionRows = transitions.map((transition, ordinal) => Object.freeze({
    analysisId, ordinal, fromPointId: transition.fromPointId, toPointId: transition.toPointId,
    transitionVersion: transition.version, changeTypes: transition.changeTypes,
  }));
  return Object.freeze({ analysis: Object.freeze({ ...value, points: Object.freeze(points), transitions: Object.freeze(transitions), canonical: canonical.canonical, timelineHash: canonical.hash }), pointRows: Object.freeze(pointRows), facetRows: Object.freeze(facetRows), transitionRows: Object.freeze(transitionRows) });
}

export const verifyRcv019WriteProjection = verifyRcv019Write;
