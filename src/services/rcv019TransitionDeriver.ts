import { canonicalizeRcv019State } from "./rcv019Canonical";
import {
  RCV019_TRANSITION_TYPES,
  Rcv019TemporalEvidencePoint,
  Rcv019TemporalEvidenceTransition,
  Rcv019TransitionType,
  Rcv019ValidationError,
  validateRcv019TransitionTypes,
} from "../contracts/rcv019TemporalEvidenceContractV1";

function key(value: unknown): string {
  try { return canonicalizeRcv019State(value as never).canonical; }
  catch { return JSON.stringify(value); }
}
function entries(state: Rcv019TemporalEvidencePoint["state"], relation: string): Set<string> {
  return new Set(state.evidenceProvenance.filter((entry) => entry.relation === relation).map(key));
}
function facetSet(state: Rcv019TemporalEvidencePoint["state"], kind: string): Set<string> {
  return new Set((state.optionalFacets ?? []).filter((facet) => facet.kind === kind).map((facet) => `${facet.id}|${facet.version}|${facet.hash}`));
}
function added(before: Set<string>, after: Set<string>): boolean {
  for (const item of after) if (!before.has(item)) return true;
  return false;
}
function removed(before: Set<string>, after: Set<string>): boolean {
  for (const item of before) if (!after.has(item)) return true;
  return false;
}
function equalSet(before: Set<string>, after: Set<string>): boolean {
  if (before.size !== after.size) return false;
  for (const item of before) if (!after.has(item)) return false;
  return true;
}

export function deriveRcv019Transition(
  from: Rcv019TemporalEvidencePoint,
  to: Rcv019TemporalEvidencePoint,
): Rcv019TemporalEvidenceTransition {
  if (from.claimId !== to.claimId) throw new Rcv019ValidationError("transition", "points belong to different claims");
  const fromState = canonicalizeRcv019State(from.state);
  const toState = canonicalizeRcv019State(to.state);
  if (fromState.hash === toState.hash) {
    return Object.freeze({ fromPointId: from.pointId, toPointId: to.pointId, version: 1, changeTypes: ["UNCHANGED"] as const });
  }
  const beforeSupporting = entries(from.state, "supports");
  const afterSupporting = entries(to.state, "supports");
  const beforeContradicting = entries(from.state, "contradicts");
  const afterContradicting = entries(to.state, "contradicts");
  const beforeDependencies = facetSet(from.state, "RCV017_ANALYSIS");
  const afterDependencies = facetSet(to.state, "RCV017_ANALYSIS");
  const beforeContradictions = facetSet(from.state, "RCV018_ANALYSIS");
  const afterContradictions = facetSet(to.state, "RCV018_ANALYSIS");
  const beforeAssessments = facetSet(from.state, "RCV011_ASSESSMENT");
  const afterAssessments = facetSet(to.state, "RCV011_ASSESSMENT");
  const changes: Rcv019TransitionType[] = [];
  if (added(beforeSupporting, afterSupporting)) changes.push("SUPPORTING_EVIDENCE_ADDED");
  if (added(beforeContradicting, afterContradicting)) changes.push("CONTRADICTING_EVIDENCE_ADDED");
  if (added(beforeDependencies, afterDependencies)) changes.push("DEPENDENCY_GAP_INTRODUCED");
  if (removed(beforeDependencies, afterDependencies)) changes.push("DEPENDENCY_GAP_RESOLVED");
  if (added(beforeContradictions, afterContradictions)) changes.push("CONTRADICTION_INTRODUCED");
  if (removed(beforeContradictions, afterContradictions)) changes.push("CONTRADICTION_RESOLVED");
  if (beforeAssessments.size > 0 && afterAssessments.size > 0 && !equalSet(beforeAssessments, afterAssessments)) changes.push("ASSESSMENT_CHANGED");
  const ordered = RCV019_TRANSITION_TYPES.filter((type): type is Rcv019TransitionType => changes.includes(type) && type !== "UNCHANGED");
  if (ordered.length === 0) throw new Rcv019ValidationError("transition", "UNSUPPORTED_TRANSITION");
  validateRcv019TransitionTypes(ordered);
  return Object.freeze({ fromPointId: from.pointId, toPointId: to.pointId, version: 1, changeTypes: Object.freeze(ordered) });
}
