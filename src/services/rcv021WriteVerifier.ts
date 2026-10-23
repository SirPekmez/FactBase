import { validateRcv021BigInt, validateRcv021NonNegativeBigInt } from "./rcv021Canonical";
import {
  AttemptResolution, OperationLifecycleEvent, ProviderResult, ResearchAttempt, ResearchOperation, ResearchRun,
  ResultSelection, RunLifecycleEvent, RunTerminalResolution, SubjectBinding, TriggerBinding,
} from "../contracts/rcv021ActiveResearchContractV1";
import {
  authenticateRcv021CanonicalFields, validateAttemptResolution, validateAttemptSet, validateOperationCreation, validateProviderResult,
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

/** Proposal authenticity only. Persisted-parent completeness is a separate locked gate. */
export function verifyRcv021WriteProposal(input: Rcv021WriteBundle): Readonly<Rcv021WriteBundle> {
  const entries = [
    ["operations", "operationId"], ["subjects", "subjectBindingId"], ["triggers", "triggerBindingId"],
    ["operationLifecycleEvents", "eventId"], ["runs", "runId"], ["runLifecycleEvents", "eventId"],
    ["runTerminalResolutions", "resolutionId"], ["attempts", "attemptId"], ["attemptResolutions", "resolutionId"],
    ["providerResults", "resultId"], ["resultSelections", "selectionId"],
  ] as const;
  const result: Record<string, readonly unknown[]> = {};
  for (const [key, idKey] of entries) {
    const values = input[key];
    if (values !== undefined && !Array.isArray(values)) throw new Error("MALFORMED_DATA: proposal collection");
    const copy = [...(values ?? [])].map(value => {
      if (value === null || typeof value !== "object") throw new Error("MALFORMED_DATA: proposal record");
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const snapshot: Record<string, unknown> = {};
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (!("value" in descriptor)) throw new Error("MALFORMED_DATA: accessor in proposal authority");
        snapshot[name] = descriptor.value;
      }
      return Object.freeze(snapshot) as unknown as typeof value;
    }); duplicateIds(copy, idKey);
    for (const value of copy) {
      if (key === "attempts") validateRcv021BigInt((value as ResearchAttempt).attemptNumber);
      if (key === "runTerminalResolutions") validateRcv021NonNegativeBigInt((value as RunTerminalResolution).resultCount);
      authenticateRcv021CanonicalFields(value, key);
    }
    result[key] = Object.freeze(copy);
  }
  for (const subject of (result.subjects ?? []) as readonly SubjectBinding[]) validateSubjectBinding(subject);
  for (const trigger of (result.triggers ?? []) as readonly TriggerBinding[]) validateTriggerBinding(trigger);
  for (const operation of (result.operations ?? []) as readonly ResearchOperation[]) {
    const subject = (result.subjects as readonly SubjectBinding[]).find(value => value.operationId === operation.operationId);
    const trigger = (result.triggers as readonly TriggerBinding[]).find(value => value.operationId === operation.operationId);
    if (!subject || !trigger) throw new Error("MISSING_DATA: operation proposal bindings");
    validateOperationCreation(operation, subject, trigger);
  }
  for (const selection of (result.resultSelections ?? []) as readonly ResultSelection[]) validateResultSelection(selection, [{ resultId: selection.providerResultId } as ProviderResult]);
  return Object.freeze(result) as Readonly<Rcv021WriteBundle>;
}
