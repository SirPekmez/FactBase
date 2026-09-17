import {
  AttemptResolution, OperationLifecycleEvent, ProviderResult, ResearchAttempt, ResearchOperation, ResearchRun,
  ResultSelection, RunLifecycleEvent, RunTerminalResolution, SubjectBinding, TriggerBinding,
} from "../contracts/rcv021ActiveResearchContractV1";
import {
  validateAttemptResolution, validateAttemptSet, validateOperationCreation, validateProviderResult,
  validateResultSelection, validateRunCreation, validateRunTerminalResolution, validateSubjectBinding,
  validateTriggerBinding, deriveOperationLifecycle,
} from "./rcv021SemanticCore";

export interface Rcv021WriteBundle {
  readonly operations?: ReadonlyArray<ResearchOperation>;
  readonly subjects?: ReadonlyArray<SubjectBinding>;
  readonly triggers?: ReadonlyArray<TriggerBinding>;
  readonly operationLifecycleEvents?: ReadonlyArray<OperationLifecycleEvent>;
  readonly runs?: ReadonlyArray<ResearchRun>;
  readonly runLifecycleEvents?: ReadonlyArray<RunLifecycleEvent>;
  readonly runTerminalResolutions?: ReadonlyArray<RunTerminalResolution>;
  readonly attempts?: ReadonlyArray<ResearchAttempt>;
  readonly attemptResolutions?: ReadonlyArray<AttemptResolution>;
  readonly providerResults?: ReadonlyArray<ProviderResult>;
  readonly resultSelections?: ReadonlyArray<ResultSelection>;
}

function duplicateIds<T>(values: ReadonlyArray<T>, key: string): void {
  const ids = new Set<unknown>();
  for (const value of values) { const item = (value as Record<string, unknown>)[key]; if (ids.has(item)) throw new Error(`DUPLICATE_CONFLICT at ${key}`); ids.add(item); }
}

/** Pure write-boundary authentication. It performs no I/O, clock reads, or mutation. */
export function verifyRcv021Write(input: Rcv021WriteBundle): Readonly<Rcv021WriteBundle> {
  const operations = Object.freeze([...(input.operations ?? [])]); const subjects = Object.freeze([...(input.subjects ?? [])]); const triggers = Object.freeze([...(input.triggers ?? [])]);
  const operationEvents = Object.freeze([...(input.operationLifecycleEvents ?? [])]); const runs = Object.freeze([...(input.runs ?? [])]); const runEvents = Object.freeze([...(input.runLifecycleEvents ?? [])]); const terminals = Object.freeze([...(input.runTerminalResolutions ?? [])]); const attempts = Object.freeze([...(input.attempts ?? [])]); const attemptResolutions = Object.freeze([...(input.attemptResolutions ?? [])]); const results = Object.freeze([...(input.providerResults ?? [])]); const selections = Object.freeze([...(input.resultSelections ?? [])]);
  duplicateIds(operations, "operationId"); duplicateIds(subjects, "subjectBindingId"); duplicateIds(triggers, "triggerBindingId"); duplicateIds(operationEvents, "eventId"); duplicateIds(runs, "runId"); duplicateIds(runEvents, "eventId"); duplicateIds(terminals, "resolutionId"); duplicateIds(attempts, "attemptId"); duplicateIds(attemptResolutions, "resolutionId"); duplicateIds(results, "resultId"); duplicateIds(selections, "selectionId");
  const subjectByOperation = new Map(subjects.map((s) => [s.operationId, s])); const triggerByOperation = new Map(triggers.map((t) => [t.operationId, t]));
  for (const operation of operations) { const subject = subjectByOperation.get(operation.operationId); const trigger = triggerByOperation.get(operation.operationId); if (!subject || !trigger) throw new Error("MISSING_DATA: operation bindings required"); validateOperationCreation(operation, subject, trigger); deriveOperationLifecycle(operation, operationEvents.filter((event) => event.operationId === operation.operationId)); }
  const operationState = new Map(operations.map((operation) => [operation.operationId, deriveOperationLifecycle(operation, operationEvents.filter((event) => event.operationId === operation.operationId))]));
  const runById = new Map(runs.map((run) => [run.runId, run]));
  const terminalByRun = new Map(terminals.map((terminal) => [terminal.runId, terminal]));
  for (const run of runs) {
    const operation = operations.find((op) => op.operationId === run.operationId);
    if (!operation) throw new Error("MISSING_DATA: run operation");
    const predecessor = run.predecessorRunId == null ? undefined : runById.get(run.predecessorRunId);
    const predecessorTerminal = predecessor ? terminalByRun.get(predecessor.runId) : undefined;
    validateRunCreation(run, operation, operationState.get(run.operationId) ?? "CLOSED", predecessor && predecessorTerminal ? { run: predecessor, terminalAt: predecessorTerminal.terminalAt } : undefined);
  }
  for (const result of results) validateProviderResult(result, runById.get(result.runId));
  for (const selection of selections) validateResultSelection(selection, results.length ? results : [{ resultId: selection.providerResultId } as never]);
  for (const resolution of attemptResolutions) { const attempt = attempts.find((item) => item.attemptId === resolution.attemptId); if (!attempt) throw new Error("MISSING_DATA: attempt resolution target"); validateAttemptResolution(attempt, resolution); }
  for (const run of runs) { const runAttempts = attempts.filter((attempt) => attempt.runId === run.runId); const resolutions = attemptResolutions.filter((resolution) => runAttempts.some((attempt) => attempt.attemptId === resolution.attemptId)); validateAttemptSet(runAttempts, resolutions); const terminal = terminals.find((item) => item.runId === run.runId); if (terminal) validateRunTerminalResolution(terminal, run, runAttempts, resolutions, results.filter((result) => result.runId === run.runId)); }
  return Object.freeze({ operations, subjects, triggers, operationLifecycleEvents: operationEvents, runs, runLifecycleEvents: runEvents, runTerminalResolutions: terminals, attempts, attemptResolutions, providerResults: results, resultSelections: selections });
}
