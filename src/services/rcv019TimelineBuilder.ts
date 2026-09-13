import {
  Rcv019TemporalEvidenceAnalysis,
  Rcv019TemporalEvidencePoint,
  Rcv019ValidationError,
  validateRcv019KnowledgeAt,
  validateRcv019Uuid,
} from "../contracts/rcv019TemporalEvidenceContractV1";
import { canonicalizeRcv019State, canonicalizeRcv019TimelineEnvelope, hashRcv019State } from "./rcv019Canonical";
import { deriveRcv019Transition } from "./rcv019TransitionDeriver";

function freezePoint(point: Rcv019TemporalEvidencePoint): Rcv019TemporalEvidencePoint {
  validateRcv019Uuid(point.pointId, "pointId");
  validateRcv019Uuid(point.claimId, "claimId");
  validateRcv019Uuid(point.claimVersionId, "claimVersionId");
  validateRcv019KnowledgeAt(point.knowledgeAt);
  const stateHash = hashRcv019State(point.state);
  if (point.stateHash !== stateHash) throw new Rcv019ValidationError("stateHash", "HASH_MISMATCH");
  if (point.state.claimId !== point.claimId || point.state.claimVersionId !== point.claimVersionId) throw new Rcv019ValidationError("point", "INVALID_CLAIM_VERSION_BINDING");
  return Object.freeze({ ...point, state: Object.freeze(point.state), stateHash });
}

export interface BuildRcv019TimelineInput {
  readonly analysisId: unknown;
  readonly claimId: unknown;
  readonly points: readonly Rcv019TemporalEvidencePoint[];
}

export function buildRcv019Timeline(input: BuildRcv019TimelineInput): Rcv019TemporalEvidenceAnalysis {
  const analysisId = validateRcv019Uuid(input.analysisId, "analysisId");
  const claimId = validateRcv019Uuid(input.claimId, "claimId");
  if (!Array.isArray(input.points) || input.points.length === 0) throw new Rcv019ValidationError("points", "POINT_NOT_FOUND");
  const points = input.points.map(freezePoint).map((point) => {
    if (point.claimId !== claimId) throw new Rcv019ValidationError("claimId", "INVALID_CLAIM_VERSION_BINDING");
    return point;
  }).sort((a, b) => a.knowledgeAt.localeCompare(b.knowledgeAt));
  const pointIds = new Set<string>();
  for (let index = 0; index < points.length; index += 1) {
    if (pointIds.has(points[index].pointId)) throw new Rcv019ValidationError("pointId", "DUPLICATE_POINT_ID");
    pointIds.add(points[index].pointId);
    if (index > 0 && points[index - 1].knowledgeAt >= points[index].knowledgeAt) throw new Rcv019ValidationError("knowledgeAt", "AMBIGUOUS_TEMPORAL_ORDER");
  }
  const transitions = points.slice(1).map((point, index) => deriveRcv019Transition(points[index], point));
  const envelope = {
    contractVersion: 1,
    analysisId,
    claimId,
    points: points.map((point) => ({ pointId: point.pointId, claimId: point.claimId, claimVersionId: point.claimVersionId, knowledgeAt: point.knowledgeAt, stateHash: point.stateHash })),
    transitions,
  };
  const result = canonicalizeRcv019TimelineEnvelope(envelope);
  return Object.freeze({ analysisId, contractVersion: 1, claimId, points: Object.freeze(points), transitions: Object.freeze(transitions), canonical: result.canonical, timelineHash: result.hash });
}
