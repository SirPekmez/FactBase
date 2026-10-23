import { assessRcv021DeadlineEvidence } from "./rcv021DeadlineProvenance";
import {
  AttemptResolution, ProviderResult, ResearchAttempt, ResearchOperation, ResearchRun, ResultSelection,
  RunTerminalResolution, SubjectBinding, TriggerBinding, OperationLifecycleEvent, RunLifecycleEvent,
} from "../contracts/rcv021ActiveResearchContractV1";
import { Rcv021ValidationError, RCV021_FAILURE_CODES } from "../contracts/rcv021ActiveResearchContractV1";
import {
  assertRcv021HashMatches, canonicalizeRcv021Authority, deriveProviderResultManifest,
  validateRcv021BigInt, validateRcv021Timestamp, validateRcv021Uuid, validateRcv021Version,
} from "./rcv021Canonical";
import {
  classifyRcv021Failures, deriveOperationLifecycle, validateAttemptResolution, validateAttemptSet, validateOperationCreation,
  validateProviderResult, validateResultSelection, validateRunCreation, validateRunLifecycle,
  validateSubjectBinding, validateTriggerBinding,
} from "./rcv021SemanticCore";
import type { Rcv021HistoricalGraph } from "./rcv021PostgresReadRepository";
import { canonicalizeRcv020 } from "./rcv020Canonical";

export class Rcv021ReadVerificationError extends Error {
  readonly name = "Rcv021ReadVerificationError";
  constructor(readonly code: (typeof RCV021_FAILURE_CODES)[number], readonly path: string, message: string) { super(`${code} at ${path}: ${message}`); }
}
export interface Rcv021VerifiedHistoricalGraph { readonly verified: boolean; readonly canonicalVerified: true; readonly deadlineQualification: "VERIFIED" | "UNKNOWN"; readonly graph: Rcv021HistoricalGraph; readonly replayable: boolean; }

const text = (value: unknown): string => String(value);
const hash = (value: unknown): string => typeof value === "string" ? value : Buffer.from(value as Uint8Array).toString("hex");
const fail = (code: (typeof RCV021_FAILURE_CODES)[number], path: string, message: string): never => { throw new Rcv021ReadVerificationError(code, path, message); };
const runValue = (row: Record<string, unknown>): ResearchRun => ({ ...row, runId: text(row.runId), operationId: text(row.operationId), strategyIdentity: text(row.strategyIdentity), strategyVersion: Number(row.strategyVersion), providerIdentity: text(row.providerIdentity), adapterIdentity: text(row.adapterIdentity), adapterVersion: text(row.adapterVersion), executionParametersCanonical: text(row.executionParametersCanonical), runCreatedAt: text(row.runCreatedAt), deadlineAt: text(row.deadlineAt), predecessorRunId: row.predecessorRunId == null ? null : text(row.predecessorRunId), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) });
const operationValue = (row: Record<string, unknown>): ResearchOperation => ({ ...row, operationId: text(row.operationId), subjectBindingId: text(row.subjectBindingId), triggerBindingId: text(row.triggerBindingId), purpose: text(row.purpose), scopeCanonical: text(row.scopeCanonical), operationCreatedAt: text(row.operationCreatedAt), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) });
const subjectValue = (row: Record<string, unknown>): SubjectBinding => ({ ...row, subjectBindingId: text(row.subjectBindingId), operationId: text(row.operationId), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) }) as SubjectBinding;
const triggerValue = (row: Record<string, unknown>): TriggerBinding => ({ ...row, triggerBindingId: text(row.triggerBindingId), operationId: text(row.operationId), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) }) as TriggerBinding;
const canonicalCheck = (value: { readonly canonicalVersion: number; readonly canonical: string; readonly canonicalHash: string }, path: string): void => {
  try { validateRcv021Version(value.canonicalVersion, `${path}.canonicalVersion`); const expected = canonicalizeRcv021Authority(Object.fromEntries(Object.entries(value).filter(([key]) => !["canonicalVersion", "canonical", "canonicalHash"].includes(key))), path); if (expected.canonical !== value.canonical) fail("CANONICAL_MISMATCH", `${path}.canonical`, "persisted canonical differs from reconstructed authority"); assertRcv021HashMatches(value.canonical, value.canonicalHash, `${path}.canonicalHash`); } catch (error) { if (error instanceof Rcv021ReadVerificationError) throw error; if (error instanceof Rcv021ValidationError) fail(error.code, error.path, error.message); throw error; }
};

/** Independent persisted-history verifier. It never writes, normalizes, or consults current state. */
export function verifyRcv021HistoricalGraph(graph: Rcv021HistoricalGraph, evaluationAt?: string): Rcv021VerifiedHistoricalGraph {
  if (evaluationAt !== undefined) validateRcv021Timestamp(evaluationAt, "deadlineEvaluationAt");
  if (!graph || !graph.operation || !graph.subject || !graph.trigger) fail("MISSING_DATA", "graph.root", "operation bindings missing");
  const operation = operationValue(graph.operation), subject = subjectValue(graph.subject), trigger = triggerValue(graph.trigger);
  try { canonicalCheck(operation, "operation"); canonicalCheck(subject, "subject"); canonicalCheck(trigger, "trigger"); validateSubjectBinding(subject); validateTriggerBinding(trigger); validateOperationCreation(operation, subject, trigger); } catch (error) { if (error instanceof Rcv021ReadVerificationError) throw error; if (error instanceof Rcv021ValidationError) fail(error.code, error.path, error.message); throw error; }
  const operationEvents = graph.operationLifecycleEvents.map((row) => ({ ...row, eventId: text(row.eventId), operationId: text(row.operationId), eventType: row.eventType as "CLOSED", eventAt: text(row.eventAt), actorIdentity: text(row.actorIdentity), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) })) as OperationLifecycleEvent[];
  operationEvents.forEach((event, index) => canonicalCheck(event, `operationLifecycleEvents[${index}]`));
  const operationState = deriveOperationLifecycle(operation, operationEvents);
  const runs = graph.runs.map(runValue), runById = new Map(runs.map((run) => [run.runId, run]));
  const terminals = graph.terminalResolutions.map((row) => ({ ...row, resolutionId: text(row.resolutionId), runId: text(row.runId), outcome: row.outcome, terminalAt: text(row.terminalAt), completionAuthority: text(row.completionAuthority), resultManifestCanonical: text(row.resultManifestCanonical), resultManifestHash: hash(row.resultManifestHash), resultCount: text(row.resultCount), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) })) as unknown as RunTerminalResolution[];
  const terminalByRun = new Map<string, RunTerminalResolution>();
  for (const [index, terminal] of terminals.entries()) { if (terminalByRun.has(terminal.runId)) fail("DUPLICATE_CONFLICT", `terminalResolutions[${index}].runId`, "duplicate terminal resolution"); terminalByRun.set(terminal.runId, terminal); canonicalCheck(terminal, `terminalResolutions[${index}]`); }
  for (const [index, run] of runs.entries()) { canonicalCheck(run, `runs[${index}]`); const predecessor = run.predecessorRunId == null ? undefined : runById.get(run.predecessorRunId); const predecessorTerminal = predecessor ? terminalByRun.get(predecessor.runId) : undefined; try { const atCreation = deriveOperationLifecycle(operation, operationEvents.filter(event => event.eventAt <= run.runCreatedAt)); validateRunCreation(run, operation, atCreation, predecessor && predecessorTerminal ? { run: predecessor, terminalAt: predecessorTerminal.terminalAt } : undefined); } catch (error) { if (error instanceof Rcv021ValidationError) fail(error.code, error.path, error.message); throw error; } }
  const startsByRun = new Map<string, RunLifecycleEvent[]>();
  for (const [index, row] of graph.runLifecycleEvents.entries()) { const event = { ...row, eventId: text(row.eventId), runId: text(row.runId), eventType: row.eventType as "STARTED", eventAt: text(row.eventAt), executionAuthority: text(row.executionAuthority), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) } as RunLifecycleEvent; canonicalCheck(event, `runLifecycleEvents[${index}]`); startsByRun.set(event.runId, [...(startsByRun.get(event.runId) ?? []), event]); }
  const attempts = graph.attempts.map((row) => ({ ...row, attemptId: text(row.attemptId), runId: text(row.runId), attemptNumber: text(row.attemptNumber), predecessorAttemptId: row.predecessorAttemptId == null ? null : text(row.predecessorAttemptId), startedAt: text(row.startedAt), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) })) as unknown as ResearchAttempt[];
  const attemptResolutions = graph.attemptResolutions.map((row, index) => {
    const value = { ...row, resolutionId: text(row.resolutionId), attemptId: text(row.attemptId), outcome: row.outcome, terminalAt: text(row.terminalAt), failureAuthority: row.failureAuthority == null ? null : text(row.failureAuthority), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) } as Record<string, unknown>;
    // SQL NULL cannot distinguish an omitted optional field from explicit null.
    // Preserve that distinction from the stored canonical payload, then verify
    // the reconstructed fields and the original bytes/hash without rewriting.
    if (row.failureAuthority == null) {
      let payload: unknown;
      try { payload = JSON.parse(text(row.canonical)); } catch { fail("MALFORMED_DATA", `attemptResolutions[${index}].canonical`, "invalid canonical JSON"); }
      if (payload !== null && typeof payload === "object" && !Array.isArray(payload) && !Object.prototype.hasOwnProperty.call(payload, "failureAuthority")) delete value.failureAuthority;
    }
    return value;
  }) as unknown as AttemptResolution[];
  attempts.forEach((attempt, index) => { canonicalCheck(attempt, `attempts[${index}]`); validateRcv021BigInt(attempt.attemptNumber, `attempts[${index}].attemptNumber`); });
  attemptResolutions.forEach((resolution, index) => canonicalCheck(resolution, `attemptResolutions[${index}]`));
  const resolutionTargets = new Set<string>();
  for (const resolution of attemptResolutions) {
    const target = attempts.find(attempt => attempt.attemptId === resolution.attemptId);
    if (!target) fail("MISSING_DATA", "attemptResolution.attemptId", "attempt missing");
    if (resolutionTargets.has(resolution.attemptId)) fail("DUPLICATE_CONFLICT", "attemptResolution.attemptId", "duplicate attempt resolution");
    resolutionTargets.add(resolution.attemptId);
    validateAttemptResolution(target!, resolution);
  }
  const results = graph.providerResults.map((row) => ({ ...row, resultId: text(row.resultId), runId: text(row.runId), providerItemIdentity: text(row.providerItemIdentity), providerEnvelopeCanonical: text(row.providerEnvelopeCanonical), providerIdentity: text(row.providerIdentity), adapterIdentity: text(row.adapterIdentity), adapterVersion: text(row.adapterVersion), resultObservedAt: text(row.resultObservedAt), providerSourceTime: row.providerSourceTime == null ? null : text(row.providerSourceTime), protocolResultStatus: text(row.protocolResultStatus), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) })) as unknown as ProviderResult[];
  results.forEach((result, index) => { canonicalCheck(result, `providerResults[${index}]`); validateProviderResult(result, runById.get(result.runId)); });
  for (const run of runs) { const runAttempts = attempts.filter((attempt) => attempt.runId === run.runId), runResolutions = attemptResolutions.filter((resolution) => runAttempts.some((attempt) => attempt.attemptId === resolution.attemptId)), terminal = terminalByRun.get(run.runId); if (terminal) validateRunLifecycle(run, startsByRun.get(run.runId) ?? [], terminal, runAttempts, runResolutions, results.filter((result) => result.runId === run.runId), "historical"); }
  const selections = graph.resultSelections.map((row) => ({ ...row, selectionId: text(row.selectionId), providerResultId: text(row.providerResultId), selectionAuthorization: text(row.selectionAuthorization), selectedArtifactIdentity: text(row.selectedArtifactIdentity), observationOccurrenceId: text(row.observationOccurrenceId), selectedAt: text(row.selectedAt), canonicalVersion: Number(row.canonicalVersion), canonical: text(row.canonical), canonicalHash: hash(row.canonicalHash) })) as unknown as ResultSelection[];
  const resultById = new Map(results.map((result) => [result.resultId, result]));
  selections.forEach((selection, index) => { canonicalCheck(selection, `resultSelections[${index}]`); validateResultSelection(selection, resultById.size ? results : [{ resultId: selection.providerResultId } as never]); const occurrence = graph.rcv020Occurrences.find((candidate) => text(candidate.occurrenceId) === selection.observationOccurrenceId); if (occurrence) { const occurrenceCanonical = text(occurrence.canonical), occurrenceHash = hash(occurrence.canonicalHash); if (sha256(occurrenceCanonical) !== occurrenceHash) fail("RCV020_BINDING_VIOLATION", `resultSelections[${index}].observationOccurrenceId`, "RCV-020 occurrence canonical/hash mismatch"); const triggerCanonical = text(occurrence.triggerCanonical), triggerHash = text(occurrence.triggerHash); const expectedTrigger = canonicalizeRcv020({ schema: "RCV020-TRIGGER-V1", triggerOrigin: occurrence.triggerOrigin, scheduledAt: occurrence.scheduledAt ?? null, triggerReceivedAt: occurrence.triggerReceivedAt ?? null, requestedAt: occurrence.requestedAt ?? null }, "rcv020.trigger"); if (triggerCanonical !== expectedTrigger.canonical || triggerHash !== expectedTrigger.hash) fail("RCV020_BINDING_VIOLATION", `resultSelections[${index}].observationOccurrenceId`, "RCV-020 trigger canonical/hash mismatch"); } });
  const manifestByRun = new Map<string, ProviderResult[]>(); for (const result of results) manifestByRun.set(result.runId, [...(manifestByRun.get(result.runId) ?? []), result]);
  for (const terminal of terminals) { const manifest = deriveProviderResultManifest(manifestByRun.get(terminal.runId) ?? []); if (manifest.canonical !== terminal.resultManifestCanonical || manifest.hash !== terminal.resultManifestHash || manifest.count !== String(terminal.resultCount)) fail("RESULT_MANIFEST_MISMATCH", `terminalResolutions.${terminal.runId}`, "terminal ProviderResult manifest mismatch"); }
  const deadlineQualification = runs.some(run => {
    const terminal = terminalByRun.get(run.runId);
    const runAttempts = attempts.filter(attempt => attempt.runId === run.runId);
    if (!terminal) {
      // Do not import a later terminal across a historical cutoff or invent an
      // outcome. Recorded activity reaching the deadline needs terminal context.
      if (evaluationAt !== undefined && evaluationAt >= run.deadlineAt) return true;
      return runAttempts.some(attempt => {
        const resolution = attemptResolutions.find(item => item.attemptId === attempt.attemptId);
        return attempt.startedAt >= run.deadlineAt || (resolution ? resolution.terminalAt >= run.deadlineAt : evaluationAt === undefined);
      });
    }
    return assessRcv021DeadlineEvidence(run, terminal, runAttempts, attemptResolutions.filter(resolution => runAttempts.some(attempt => attempt.attemptId === resolution.attemptId))).status === "UNKNOWN";
  }) ? "UNKNOWN" as const : "VERIFIED" as const;
  return Object.freeze({ verified: deadlineQualification === "VERIFIED", canonicalVerified: true as const, deadlineQualification, graph, replayable: graph.rcv020Occurrences.length > 0 });
}

function sha256(value: string): string { const { createHash } = require("node:crypto") as typeof import("node:crypto"); return createHash("sha256").update(value, "utf8").digest("hex"); }

/** Consumers requiring full semantic evidence must explicitly use this boundary. */
export function requireRcv021HistoricalVerification(graph: Rcv021HistoricalGraph, evaluationAt?: string): Rcv021VerifiedHistoricalGraph {
  const result = verifyRcv021HistoricalGraph(graph, evaluationAt);
  if (!result.verified) fail("DEADLINE_VIOLATION", "deadlineQualification", "historical deadline evidence is UNKNOWN");
  return result;
}

/** Authenticates only the decision output's creation, never its execution outcome. */
export function authenticateRcv021DecisionOutputCreation(graph: Rcv021HistoricalGraph, runId: string, evaluationAt: string): void {
  validateRcv021Timestamp(evaluationAt, "decision.evaluationAt");
  const run = graph.runs.find(item => item.runId === runId);
  if (!run) return fail("MISSING_DATA", "decision.run", "decision Run is missing");
  if (run.runCreatedAt !== evaluationAt) return fail("IDENTITY_MISMATCH", "decision.runCreatedAt", "Run is not created by this decision evaluation");
  if (run.predecessorRunId != null) fail("RERUN_LINEAGE_VIOLATION", "decision.run", "Scheduler-created Run is not a Rerun");
  verifyRcv021HistoricalGraph({ ...graph, runs: [run], runLifecycleEvents: [], terminalResolutions: [], attempts: [], attemptResolutions: [], providerResults: [], resultSelections: [], rcv020Occurrences: [] });
}
