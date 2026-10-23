import type { AttemptResolution, ResearchAttempt, ResearchRun, RunTerminalResolution } from "../contracts/rcv021ActiveResearchContractV1";
import { Rcv021ValidationError } from "../contracts/rcv021ActiveResearchContractV1";
import { assertRcv021HashMatches, canonicalizeRcv021Authority, validateRcv021Timestamp, validateRcv021Uuid } from "./rcv021Canonical";

export const RCV021_DEADLINE_PROVENANCE_SCHEMA = "RCV021-DEADLINE-PROVENANCE-V1" as const;
const keys = ["schema", "cause", "runId", "runCanonicalHash", "attemptId", "attemptCanonicalHash", "deadlineAt"] as const;
export interface Rcv021DeadlineEvidence {
  readonly status: "VERIFIED" | "UNKNOWN";
  readonly unknownAttemptIds: readonly string[];
}
function fail(message: string): never { throw new Rcv021ValidationError("DEADLINE_VIOLATION", "deadlineProvenance", message); }
function parent(value: ResearchRun | ResearchAttempt): void {
  const { canonicalVersion, canonical, canonicalHash, ...payload } = value;
  if (canonicalVersion !== 1 || typeof canonical !== "string") fail("unsupported parent authority");
  assertRcv021HashMatches(canonical, canonicalHash, "deadlineProvenance.parentHash");
  if (canonicalizeRcv021Authority(payload).canonical !== canonical) fail("parent fields differ from canonical authority");
}
export function buildRcv021DeadlineProvenance(run: ResearchRun, attempt: ResearchAttempt): string {
  parent(run); parent(attempt);
  validateRcv021Uuid(run.runId); validateRcv021Uuid(attempt.attemptId); validateRcv021Timestamp(run.deadlineAt);
  if (attempt.runId !== run.runId) fail("attempt belongs to another run");
  return canonicalizeRcv021Authority({ schema: RCV021_DEADLINE_PROVENANCE_SCHEMA, cause: "RUN_DEADLINE_EXPIRED", runId: run.runId, runCanonicalHash: run.canonicalHash, attemptId: attempt.attemptId, attemptCanonicalHash: attempt.canonicalHash, deadlineAt: run.deadlineAt }).canonical;
}
/** Reads the recorded cause; never invents one from outcome or text fragments. */
export function qualifyRcv021DeadlineCause(value: unknown, run: ResearchRun, attempt: ResearchAttempt): "VERIFIED" | "UNKNOWN" {
  if (typeof value !== "string" || value.length === 0) fail("deadline cause must be recorded");
  let payload: unknown;
  try { payload = JSON.parse(value); } catch { return "UNKNOWN"; }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return "UNKNOWN";
  const record = payload as Record<string, unknown>;
  if (record.schema !== RCV021_DEADLINE_PROVENANCE_SCHEMA) return "UNKNOWN";
  const actualKeys = Object.keys(record).sort();
  if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== [...keys].sort()[index])) fail("deadline provenance has wrong field set");
  for (const key of keys) if (typeof record[key] !== "string") fail("deadline provenance fields must be strings");
  if (record.cause !== "RUN_DEADLINE_EXPIRED") fail("wrong deadline cause");
  const expected = buildRcv021DeadlineProvenance(run, attempt);
  if (value !== expected) fail("deadline provenance is not exact canonical parent-bound data");
  return "VERIFIED";
}
/** Evidence for a supplied context only; caller must separately prove its completeness. */
export function assessRcv021DeadlineEvidence(run: ResearchRun, terminal: RunTerminalResolution, attempts: readonly ResearchAttempt[], resolutions: readonly AttemptResolution[]): Rcv021DeadlineEvidence {
  parent(run); validateRcv021Timestamp(terminal.terminalAt);
  if (terminal.runId !== run.runId) fail("terminal belongs to another run");
  if (terminal.outcome === "TIMED_OUT" && terminal.terminalAt < run.deadlineAt) fail("timeout before immutable deadline");
  const unknown: string[] = [];
  for (const attempt of attempts) {
    parent(attempt); validateRcv021Timestamp(attempt.startedAt);
    if (attempt.runId !== run.runId) fail("attempt belongs to another run");
    const matches = resolutions.filter(item => item.attemptId === attempt.attemptId);
    if (matches.length !== 1) fail("terminal context lacks exactly one attempt resolution");
    const resolution = matches[0]; validateRcv021Timestamp(resolution.terminalAt);
    if (attempt.startedAt <= run.deadlineAt && resolution.terminalAt > run.deadlineAt) {
      if (terminal.outcome !== "TIMED_OUT" || resolution.outcome !== "FAILED") fail("active deadline expiry requires FAILED attempt and TIMED_OUT run");
      if (qualifyRcv021DeadlineCause(resolution.failureAuthority, run, attempt) === "UNKNOWN") unknown.push(attempt.attemptId);
    } else if (attempt.startedAt <= run.deadlineAt && resolution.terminalAt === run.deadlineAt) {
      // Timestamps alone do not establish which simultaneous event occurred first.
      if (terminal.outcome === "TIMED_OUT" && resolution.outcome === "FAILED" && resolution.failureAuthority != null && qualifyRcv021DeadlineCause(resolution.failureAuthority, run, attempt) === "VERIFIED") continue;
      unknown.push(attempt.attemptId);
    } else if (attempt.startedAt > run.deadlineAt) {
      unknown.push(attempt.attemptId);
    }
  }
  return Object.freeze({ status: unknown.length === 0 ? "VERIFIED" : "UNKNOWN", unknownAttemptIds: Object.freeze(unknown.sort()) });
}
