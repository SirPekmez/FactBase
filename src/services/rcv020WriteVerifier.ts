import {
  RCV020_ATTEMPT_OUTCOMES, RCV020_FAILURE_CODES, RCV020_OCCURRENCE_OUTCOMES,
  RCV020_RETENTION_EVENTS, Rcv020AttemptResolution, Rcv020Capture, Rcv020CaptureComparison,
  Rcv020LifecycleEvent, Rcv020MonitorConfigurationVersion, Rcv020ObservationOccurrence,
  Rcv020RetentionAvailabilityEvent, Rcv020RetrievalAttempt, Rcv020ValidationError,
  validateRcv020Hash, validateRcv020Timestamp, validateRcv020Uuid,
} from "../contracts/rcv020ObservatoryContractV1";
import { assertRcv020HashMatches, canonicalizeRcv020MonitorConfiguration, validateRcv020BigInt, validateRcv020NonNegativeBigInt } from "./rcv020Canonical";
import { canonicalizeRcv020Capture, canonicalizeRcv020CaptureComparison, canonicalizeRcv020RetentionAvailabilityEvent, deriveLifecycleState, resolveOccurrenceTerminal, validateAttemptSet, validateCapture, validateCaptureComparison, validateObservationOccurrence } from "./rcv020SemanticCore";

export type Rcv020WriteFailureCode =
  | "VERSION_MISMATCH" | "CANONICAL_MISMATCH" | "HASH_MISMATCH" | "IDENTITY_MISMATCH"
  | "CONFIGURATION_OVERLAP" | "INVALID_LIFECYCLE" | "INVALID_OCCURRENCE"
  | "INVALID_ATTEMPT" | "INVALID_RETRY" | "INVALID_TERMINAL_RESOLUTION"
  | "CAPTURE_MISMATCH" | "INVALID_EMPTY" | "INVALID_COMPARISON"
  | "UNSUPPORTED_RETENTION" | "INVALID_RAW_OBJECT" | "INVALID_HANDOFF"
  | "HANDOFF_IDEMPOTENCY_CONFLICT" | "UNSAFE_BIGINT" | "DUPLICATE_IDENTITY";

export class Rcv020WriteVerificationError extends Error {
  constructor(public readonly code: Rcv020WriteFailureCode, public readonly path: string, message: string) {
    super(`${path}: ${message}`); this.name = "Rcv020WriteVerificationError";
  }
}

export interface Rcv020LogicalSourceWrite { readonly logicalSourceId: string; readonly organizationIdentity: string; readonly sourceClass: string; readonly jurisdiction?: string | null; readonly canonical: string; readonly identityHash: string; }
export interface Rcv020MonitorWrite { readonly monitorId: string; readonly logicalSourceId: string; readonly monitorKind: string; readonly canonical: string; readonly identityHash: string; }
export interface Rcv020OccurrenceResolutionWrite { readonly resolutionId: string; readonly occurrenceId: string; readonly outcome: string; readonly evaluationCutoffAt: string; readonly evaluatedAt: string; readonly skipReason?: string | null; readonly skipActorPolicyIdentity?: string | null; readonly terminalizationPolicyVersion: number; readonly canonical: string; readonly canonicalHash: string; }
export interface Rcv020AttemptResolutionWrite extends Rcv020AttemptResolution { readonly attemptResolutionId?: string; readonly failureTaxonomyVersion?: number | null; readonly diagnosticCanonical?: string | null; readonly canonical?: string; readonly canonicalHash?: string; }
export interface Rcv020HandoffWrite { readonly handoffId: string; readonly captureId: string; readonly logicalSourceId: string; readonly monitorId: string; readonly monitorConfigurationVersionId: string; readonly occurrenceId: string; readonly retrievalAttemptId: string; readonly captureHash: string; readonly rawObjectIdentity?: string | null; readonly rawAvailabilitySnapshot: string; readonly observedAt: string; readonly sourcePublishedAt?: string | null; readonly sourceArtifactIdentity?: string | null; readonly derivedExtractionReference?: string | null; readonly derivedExtractionVersion?: string | null; readonly derivedExtractionHash?: string | null; readonly provenanceManifest: string; readonly handoffCanonical: string; readonly handoffHash: string; readonly idempotencyKey: string; }
export interface Rcv020QuarantineWrite { readonly quarantineId: string; readonly attemptId: string; readonly reason: string; readonly policyCanonical: string; readonly objectIdentity?: string | null; readonly payloadHash?: string | null; readonly byteLength?: bigint | string | null; }

export interface Rcv020WriteBundle {
  readonly contractVersion: number;
  readonly sources?: readonly Rcv020LogicalSourceWrite[];
  readonly monitors?: readonly Rcv020MonitorWrite[];
  readonly configurations?: readonly Rcv020MonitorConfigurationVersion[];
  readonly lifecycleEvents?: readonly Rcv020LifecycleEvent[];
  readonly occurrences?: readonly Rcv020ObservationOccurrence[];
  readonly occurrenceResolutions?: readonly Rcv020OccurrenceResolutionWrite[];
  readonly attempts?: readonly Rcv020RetrievalAttempt[];
  readonly attemptResolutions?: readonly Rcv020AttemptResolutionWrite[];
  readonly captures?: readonly Rcv020Capture[];
  readonly comparisons?: readonly Rcv020CaptureComparison[];
  readonly retentionEvents?: readonly Rcv020RetentionAvailabilityEvent[];
  readonly handoffs?: readonly Rcv020HandoffWrite[];
  readonly quarantine?: readonly Rcv020QuarantineWrite[];
}

const fail = (code: Rcv020WriteFailureCode, path: string, message: string): never => { throw new Rcv020WriteVerificationError(code, path, message); };
const text = (v: unknown, p: string): string => typeof v === "string" && v.length > 0 ? v : fail("CANONICAL_MISMATCH", p, "non-empty text required");
const hash = (v: unknown, p: string): string => { try { return validateRcv020Hash(v, p); } catch { return fail("HASH_MISMATCH", p, "invalid SHA-256 hash"); } };
function checkCanonical(value: unknown, canonical: string | undefined, suppliedHash: string | undefined, path: string): void {
  if (canonical == null || suppliedHash == null) return;
  try { assertRcv020HashMatches(canonical, suppliedHash, `${path}.hash`); } catch { fail("HASH_MISMATCH", path, "canonical/hash mismatch"); }
  if (typeof value === "string") return;
}
function duplicateIds(values: readonly unknown[], key: string, path: string): void {
  const seen = new Set<unknown>(); values.forEach((v, i) => { const id = (v as Record<string, unknown>)[key]; if (seen.has(id)) fail("DUPLICATE_IDENTITY", `${path}[${i}].${key}`, "duplicate identity"); seen.add(id); });
}

export function verifyRcv020Write(bundle: Rcv020WriteBundle): Readonly<Rcv020WriteBundle> {
  if (bundle == null || typeof bundle !== "object") fail("VERSION_MISMATCH", "bundle", "object required");
  if (bundle.contractVersion !== 1) fail("VERSION_MISMATCH", "contractVersion", "unsupported Contract version");
  const b = bundle;
  duplicateIds(b.sources ?? [], "logicalSourceId", "sources"); duplicateIds(b.monitors ?? [], "monitorId", "monitors");
  duplicateIds(b.configurations ?? [], "monitorConfigurationVersionId", "configurations"); duplicateIds(b.lifecycleEvents ?? [], "eventId", "lifecycleEvents");
  duplicateIds(b.occurrences ?? [], "occurrenceId", "occurrences"); duplicateIds(b.attempts ?? [], "attemptId", "attempts");
  duplicateIds(b.captures ?? [], "captureId", "captures"); duplicateIds(b.comparisons ?? [], "comparisonId", "comparisons");
  duplicateIds(b.occurrenceResolutions ?? [], "occurrenceId", "occurrenceResolutions");
  duplicateIds(b.attemptResolutions ?? [], "attemptId", "attemptResolutions");

  const sources = new Map((b.sources ?? []).map((s) => [s.logicalSourceId, s]));
  const monitors = new Map((b.monitors ?? []).map((m) => [m.monitorId, m]));
  const configs = new Map((b.configurations ?? []).map((c) => [c.monitorConfigurationVersionId, c]));
  const occurrences = new Map((b.occurrences ?? []).map((o) => [o.occurrenceId, o]));
  for (const [i, s] of (b.sources ?? []).entries()) { validateRcv020Uuid(s.logicalSourceId, `sources[${i}].logicalSourceId`); text(s.organizationIdentity, `sources[${i}].organizationIdentity`); text(s.sourceClass, `sources[${i}].sourceClass`); validateRcv020Hash(s.identityHash, `sources[${i}].identityHash`); checkCanonical(s, s.canonical, s.identityHash, `sources[${i}]`); }
  for (const [i, m] of (b.monitors ?? []).entries()) { validateRcv020Uuid(m.monitorId, `monitors[${i}].monitorId`); if (!sources.has(m.logicalSourceId)) fail("IDENTITY_MISMATCH", `monitors[${i}].logicalSourceId`, "unknown LogicalSource"); text(m.monitorKind, `monitors[${i}].monitorKind`); validateRcv020Hash(m.identityHash, `monitors[${i}].identityHash`); }
  for (const [i, c] of (b.configurations ?? []).entries()) { try { const expected = canonicalizeRcv020MonitorConfiguration(c); if (c.canonical != null && c.canonical !== expected.canonical) fail("CANONICAL_MISMATCH", `configurations[${i}]`, "configuration canonical mismatch"); if (c.canonicalHash != null && c.canonicalHash !== expected.hash) fail("HASH_MISMATCH", `configurations[${i}]`, "configuration hash mismatch"); } catch (e) { if (e instanceof Rcv020WriteVerificationError) throw e; fail("CANONICAL_MISMATCH", `configurations[${i}]`, e instanceof Error ? e.message : "invalid configuration"); } if (!monitors.has(c.monitorId)) fail("IDENTITY_MISMATCH", `configurations[${i}].monitorId`, "unknown Monitor"); }
  for (const [i, e] of (b.lifecycleEvents ?? []).entries()) { validateRcv020Uuid(e.eventId, `lifecycleEvents[${i}].eventId`); if (!configs.has(e.monitorConfigurationVersionId)) fail("IDENTITY_MISMATCH", `lifecycleEvents[${i}]`, "unknown configuration"); validateRcv020Timestamp(e.eventAt, `lifecycleEvents[${i}].eventAt`); validateRcv020BigInt(e.eventSequence, `lifecycleEvents[${i}].eventSequence`); text(e.actorPolicyIdentity, `lifecycleEvents[${i}].actorPolicyIdentity`); }
  for (const [i, o] of (b.occurrences ?? []).entries()) { try { validateObservationOccurrence(o); } catch (e) { fail("INVALID_OCCURRENCE", `occurrences[${i}]`, e instanceof Error ? e.message : "invalid occurrence"); } if (!sources.has(o.logicalSourceId) || !monitors.has(o.monitorId) || !configs.has(o.monitorConfigurationVersionId)) fail("IDENTITY_MISMATCH", `occurrences[${i}]`, "unknown parent identity"); }
  if (b.lifecycleEvents?.length && b.configurations?.length) { for (const c of b.configurations) { const events = b.lifecycleEvents.filter((e) => e.monitorConfigurationVersionId === c.monitorConfigurationVersionId); try { deriveLifecycleState(c, events); } catch (e) { fail("INVALID_LIFECYCLE", c.monitorConfigurationVersionId, e instanceof Error ? e.message : "invalid lifecycle"); } } }
  const configsByMonitor = new Map<string, Rcv020MonitorConfigurationVersion[]>();
  for (const c of b.configurations ?? []) configsByMonitor.set(c.monitorId, [...(configsByMonitor.get(c.monitorId) ?? []), c]);
  for (const [monitorId, list] of configsByMonitor) for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = list[i]; const z = list[j]; const aEnd = a.effectiveUntil ?? "9999-12-31T23:59:59.999999Z"; const zEnd = z.effectiveUntil ?? "9999-12-31T23:59:59.999999Z";
    if (a.effectiveFrom < zEnd && z.effectiveFrom < aEnd) fail("CONFIGURATION_OVERLAP", monitorId, "effective intervals overlap");
  }
  const resolutions = new Map((b.attemptResolutions ?? []).map((r) => [r.attemptId, r]));
  try { validateAttemptSet(b.attempts ?? [], occurrences, resolutions); } catch (e) { fail("INVALID_RETRY", "attempts", e instanceof Error ? e.message : "invalid attempts"); }
  for (const [i, r] of (b.attemptResolutions ?? []).entries()) { if (!b.attempts?.some((a) => a.attemptId === r.attemptId)) fail("INVALID_TERMINAL_RESOLUTION", `attemptResolutions[${i}]`, "unknown attempt"); if (!RCV020_ATTEMPT_OUTCOMES.includes(r.outcome)) fail("INVALID_TERMINAL_RESOLUTION", `attemptResolutions[${i}].outcome`, "unsupported outcome"); if (r.outcome === "FAILED" && !RCV020_FAILURE_CODES.includes(r.failureCode as never)) fail("INVALID_TERMINAL_RESOLUTION", `attemptResolutions[${i}].failureCode`, "failure code required"); }
  const captureByAttempt = new Map<string, Rcv020Capture>();
  for (const [i, c] of (b.captures ?? []).entries()) { const a = b.attempts?.find((x) => x.attemptId === c.retrievalAttemptId); const r = a ? resolutions.get(a.attemptId) : undefined; if (!a || !r) fail("CAPTURE_MISMATCH", `captures[${i}]`, "Capture parent missing"); try { validateCapture(c, a!, r!); canonicalizeRcv020Capture(c); } catch (e) { fail("CAPTURE_MISMATCH", `captures[${i}]`, e instanceof Error ? e.message : "invalid Capture"); } if (captureByAttempt.has(c.retrievalAttemptId)) fail("CAPTURE_MISMATCH", `captures[${i}]`, "more than one Capture for attempt"); captureByAttempt.set(c.retrievalAttemptId, c); }
  for (const r of b.attemptResolutions ?? []) if (r.outcome !== "FAILED" && !captureByAttempt.has(r.attemptId)) fail("CAPTURE_MISMATCH", r.attemptId, "capture-producing result lacks Capture");
  for (const [i, c] of (b.comparisons ?? []).entries()) { const current = b.captures?.find((x) => x.captureId === c.currentCaptureId); const prior = c.priorCaptureId == null ? undefined : b.captures?.find((x) => x.captureId === c.priorCaptureId); if (!current) fail("INVALID_COMPARISON", `comparisons[${i}]`, "unknown current Capture"); try { validateCaptureComparison(c, current!, prior); canonicalizeRcv020CaptureComparison(c); } catch (e) { fail("INVALID_COMPARISON", `comparisons[${i}]`, e instanceof Error ? e.message : "invalid comparison"); } }
  const comparisonByCurrent = new Map((b.comparisons ?? []).map((c) => [c.currentCaptureId, c]));
  for (const r of b.attemptResolutions ?? []) {
    const cap = captureByAttempt.get(r.attemptId); const cmp = cap ? comparisonByCurrent.get(cap.captureId) : undefined;
    if (r.outcome === "FAILED" && cmp) fail("INVALID_COMPARISON", r.attemptId, "FAILED attempt cannot have CaptureComparison");
    if (r.outcome === "CAPTURED_CHANGED" && (!cmp || !["CHANGED", "FIRST_OBSERVED"].includes(cmp.result))) fail("INVALID_COMPARISON", r.attemptId, "CHANGED result parity mismatch");
    if (r.outcome === "CAPTURED_UNCHANGED" && (!cmp || cmp.result !== "UNCHANGED")) fail("INVALID_COMPARISON", r.attemptId, "UNCHANGED result parity mismatch");
    if (r.outcome === "CAPTURED_EMPTY" && cmp) fail("INVALID_COMPARISON", r.attemptId, "EMPTY attempt cannot have comparison");
  }
  for (const [i, e] of (b.retentionEvents ?? []).entries()) { try { canonicalizeRcv020RetentionAvailabilityEvent(e); } catch (x) { fail("UNSUPPORTED_RETENTION", `retentionEvents[${i}]`, x instanceof Error ? x.message : "invalid retention event"); } }
  for (const [i, q] of (b.quarantine ?? []).entries()) { validateRcv020Uuid(q.quarantineId, `quarantine[${i}].quarantineId`); validateRcv020Uuid(q.attemptId, `quarantine[${i}].attemptId`); if (!RCV020_FAILURE_CODES.includes(q.reason as never)) fail("INVALID_RAW_OBJECT", `quarantine[${i}].reason`, "unsupported quarantine reason"); if (q.byteLength != null && validateRcv020NonNegativeBigInt(q.byteLength, `quarantine[${i}].byteLength`) < 0n) fail("UNSAFE_BIGINT", `quarantine[${i}].byteLength`, "invalid length"); }
  for (const [i, h] of (b.handoffs ?? []).entries()) { validateRcv020Uuid(h.handoffId, `handoffs[${i}].handoffId`); validateRcv020Uuid(h.captureId, `handoffs[${i}].captureId`); validateRcv020Uuid(h.logicalSourceId, `handoffs[${i}].logicalSourceId`); validateRcv020Uuid(h.monitorId, `handoffs[${i}].monitorId`); validateRcv020Uuid(h.occurrenceId, `handoffs[${i}].occurrenceId`); validateRcv020Uuid(h.retrievalAttemptId, `handoffs[${i}].retrievalAttemptId`); hash(h.captureHash, `handoffs[${i}].captureHash`); text(h.rawAvailabilitySnapshot, `handoffs[${i}].rawAvailabilitySnapshot`); text(h.provenanceManifest, `handoffs[${i}].provenanceManifest`); text(h.idempotencyKey, `handoffs[${i}].idempotencyKey`); hash(h.handoffHash, `handoffs[${i}].handoffHash`); }
  const handoffKeys = new Map<string, string>(); for (const h of b.handoffs ?? []) { const prior = handoffKeys.get(h.idempotencyKey); if (prior != null && prior !== h.handoffCanonical) fail("HANDOFF_IDEMPOTENCY_CONFLICT", h.idempotencyKey, "divergent canonical for idempotency key"); handoffKeys.set(h.idempotencyKey, h.handoffCanonical); }
  for (const o of b.occurrences ?? []) { const ownAttempts = (b.attempts ?? []).filter((a) => a.occurrenceId === o.occurrenceId); const ownCaps = (b.captures ?? []).filter((c) => c.occurrenceId === o.occurrenceId); const ownRes = (b.attemptResolutions ?? []).filter((r) => ownAttempts.some((a) => a.attemptId === r.attemptId)); const requested = b.occurrenceResolutions?.find((r) => r.occurrenceId === o.occurrenceId)?.outcome as any; try { const result = resolveOccurrenceTerminal(o, ownAttempts, ownRes, ownCaps, requested); if (requested != null && !RCV020_OCCURRENCE_OUTCOMES.includes(requested)) fail("INVALID_TERMINAL_RESOLUTION", o.occurrenceId, "unsupported occurrence outcome"); if (result !== requested && requested != null) fail("INVALID_TERMINAL_RESOLUTION", o.occurrenceId, "occurrence resolution mismatch"); } catch (e) { fail("INVALID_TERMINAL_RESOLUTION", o.occurrenceId, e instanceof Error ? e.message : "invalid occurrence resolution"); } }
  return Object.freeze(b);
}

export const authenticateRcv020Write = verifyRcv020Write;
