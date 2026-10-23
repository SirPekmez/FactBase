import { verifyRcv021HistoricalGraph } from "./rcv021ReadVerifier";
import { validateRunLifecycle, validateRetry } from "./rcv021SemanticCore";
import { validateRcv021Timestamp, validateRcv021BigInt } from "./rcv021Canonical";
import type { Rcv021PgClient, Rcv021PgResult } from "./rcv021PostgresRepository";
import type { Rcv021WriteBundle } from "./rcv021WriteVerifier";
import type { RunTerminalResolution } from "../contracts/rcv021ActiveResearchContractV1";
import { validateRcv021Uuid } from "./rcv021Canonical";
import { loadRcv021HistoricalGraphWithinTransaction, Rcv021HistoricalGraph } from "./rcv021PostgresReadRepository";
import { requireRcv021HistoricalVerification } from "./rcv021ReadVerifier";

export function measuredRcv021Rows(result: Rcv021PgResult): readonly Record<string, unknown>[] {
  if (!result || !Array.isArray(result.rows)) throw new Error("MISSING_DATA: SQL row set was not measured");
  if (typeof result.rowCount !== "number" || !Number.isSafeInteger(result.rowCount) || result.rowCount < 0 || Object.is(result.rowCount, -0) || result.rowCount !== result.rows.length) throw new Error("MISSING_DATA: SQL count/row completeness was not measured");
  return result.rows;
}
async function one(client: Rcv021PgClient, sql: string, values: readonly unknown[]): Promise<Record<string, unknown> | undefined> {
  const rows = measuredRcv021Rows(await client.query(sql, values));
  if (rows.length > 1) throw new Error("DUPLICATE_CONFLICT: ambiguous parent identity");
  return rows[0];
}
function uuid(value: unknown): string { return validateRcv021Uuid(value, "writeContext.identity"); }

/** Preliminary immutable parent lookup, followed by locks and re-bound graph loads. */
export async function lockRcv021AffectedOperations(client: Rcv021PgClient, input: Readonly<Rcv021WriteBundle>): Promise<ReadonlyMap<string, string>> {
  const owners = new Map<string, string>();
  const operations = new Set<string>();
  for (const operation of input.operations ?? []) operations.add(uuid(operation.operationId));
  for (const event of input.operationLifecycleEvents ?? []) operations.add(uuid(event.operationId));
  for (const binding of [...(input.subjects ?? []), ...(input.triggers ?? [])]) operations.add(uuid(binding.operationId));
  const proposedRuns = new Map((input.runs ?? []).map(run => [uuid(run.runId), uuid(run.operationId)]));
  const runIds = new Set<string>(proposedRuns.keys());
  for (const values of [input.runLifecycleEvents ?? [], input.attempts ?? [], input.providerResults ?? [], input.runTerminalResolutions ?? []]) for (const value of values) runIds.add(uuid(value.runId));
  for (const resolution of input.attemptResolutions ?? []) {
    const attemptId = uuid(resolution.attemptId);
    const stored = await one(client, 'SELECT run_id::text AS "runId" FROM public.research_attempts WHERE attempt_id=$1', [attemptId]);
    const proposed = input.attempts?.find(attempt => attempt.attemptId === attemptId);
    if (stored && proposed && stored.runId !== proposed.runId) throw new Error("IDENTITY_MISMATCH: attempt parent differs");
    const runId = stored?.runId ?? proposed?.runId;
    if (runId === undefined) throw new Error("MISSING_DATA: attempt parent");
    runIds.add(uuid(runId));
  }
  for (const selection of input.resultSelections ?? []) {
    const resultId = uuid(selection.providerResultId);
    const stored = await one(client, 'SELECT run_id::text AS "runId" FROM public.research_provider_results WHERE result_id=$1', [resultId]);
    const proposed = input.providerResults?.find(result => result.resultId === resultId);
    if (stored && proposed && stored.runId !== proposed.runId) throw new Error("IDENTITY_MISMATCH: result parent differs");
    const runId = stored?.runId ?? proposed?.runId;
    if (runId === undefined) throw new Error("MISSING_DATA: selection result parent");
    runIds.add(uuid(runId));
  }
  for (const runId of [...runIds].sort()) {
    const stored = await one(client, 'SELECT operation_id::text AS "operationId" FROM public.research_runs WHERE run_id=$1', [runId]);
    const proposed = proposedRuns.get(runId);
    if (stored && proposed !== undefined && stored.operationId !== proposed) throw new Error("IDENTITY_MISMATCH: Run parent differs");
    const operationId = stored?.operationId ?? proposed;
    if (operationId === undefined) throw new Error("MISSING_DATA: Run parent");
    owners.set(runId, uuid(operationId)); operations.add(uuid(operationId));
  }
  for (const operationId of [...operations].sort()) {
    const locked = await one(client, 'SELECT operation_id::text AS "operationId" FROM public.research_operations WHERE operation_id=$1 FOR UPDATE', [operationId]);
    if (!locked || locked.operationId !== operationId) throw new Error("MISSING_DATA: Operation lock not acquired");
  }
  return owners;
}

/** Full measured target Run and predecessor ancestry; unrelated Runs are not promoted. */
function targetGraph(graph: Rcv021HistoricalGraph, runId: string): Rcv021HistoricalGraph {
  const wanted = new Set<string>(); let cursor: string | undefined = runId;
  while (cursor !== undefined) {
    if (wanted.has(cursor)) throw new Error("RERUN_LINEAGE_VIOLATION: cyclic Run ancestry");
    wanted.add(cursor);
    const matches = graph.runs.filter(run => run.runId === cursor);
    if (matches.length !== 1) throw new Error("MISSING_DATA: complete Run ancestry");
    const predecessor = matches[0].predecessorRunId;
    cursor = predecessor == null ? undefined : uuid(predecessor);
  }
  const attempts = graph.attempts.filter(attempt => wanted.has(uuid(attempt.runId)));
  const attemptIds = new Set(attempts.map(attempt => uuid(attempt.attemptId)));
  const results = graph.providerResults.filter(result => wanted.has(uuid(result.runId)));
  const resultIds = new Set(results.map(result => uuid(result.resultId)));
  return { ...graph, runs: graph.runs.filter(run => wanted.has(uuid(run.runId))), runLifecycleEvents: graph.runLifecycleEvents.filter(event => wanted.has(uuid(event.runId))), terminalResolutions: graph.terminalResolutions.filter(terminal => wanted.has(uuid(terminal.runId))), attempts, attemptResolutions: graph.attemptResolutions.filter(resolution => attemptIds.has(uuid(resolution.attemptId))), providerResults: results, resultSelections: graph.resultSelections.filter(selection => resultIds.has(uuid(selection.providerResultId))) };
}
export async function verifyRcv021TerminalStoredContext(client: Rcv021PgClient, owners: ReadonlyMap<string, string>, terminal: RunTerminalResolution): Promise<void> {
  const operationId = owners.get(uuid(terminal.runId));
  if (!operationId) throw new Error("MISSING_DATA: locked Run owner");
  const loaded = await loadRcv021HistoricalGraphWithinTransaction(rcv021MeasuredContextClient(client), operationId);
  if (!loaded || loaded.operation.operationId !== operationId) throw new Error("IDENTITY_MISMATCH: locked Operation context");
  strictContextRows(loaded);
  const graph = targetGraph(loaded, terminal.runId);
  const run = graph.runs.find(value => value.runId === terminal.runId);
  if (!run || run.operationId !== operationId) throw new Error("IDENTITY_MISMATCH: Run moved outside locked context");
  const previous = graph.terminalResolutions.filter(value => value.runId === terminal.runId);
  if (previous.length > 1) throw new Error("DUPLICATE_CONFLICT: multiple terminal authorities");
  if (previous.length === 1 && (previous[0].resolutionId !== terminal.resolutionId || previous[0].canonical !== terminal.canonical || previous[0].canonicalHash !== terminal.canonicalHash)) throw new Error("DUPLICATE_CONFLICT: divergent terminal authority");
  const proposed = previous.length === 0 ? [...graph.terminalResolutions, terminal as unknown as Record<string, unknown>] : graph.terminalResolutions;
  requireRcv021HistoricalVerification({ ...graph, terminalResolutions: proposed });
  validateStoredAttemptOrdering(graph, terminal.runId);
}

export function rcv021MeasuredContextClient(client: Rcv021PgClient): Rcv021PgClient {
  return { query: async (sql, values) => {
    const result = await client.query(sql, values);
    if (/^SELECT\b/.test(sql)) measuredRcv021Rows(result);
    return result;
  } };
}

/** New Run creation needs the same measured historical parent/ancestry authority. */
export async function verifyRcv021RunCreationStoredContext(client: Rcv021PgClient, run: import("../contracts/rcv021ActiveResearchContractV1").ResearchRun): Promise<void> {
  const loaded = await loadRcv021HistoricalGraphWithinTransaction(rcv021MeasuredContextClient(client), uuid(run.operationId));
  if (!loaded) throw new Error("MISSING_DATA: Run creation parent history");
  strictContextRows(loaded);
  const candidates = { ...loaded, runs: loaded.runs.some(value => value.runId === run.runId) ? loaded.runs : [...loaded.runs, run as unknown as Record<string, unknown>] };
  const graph = targetGraph(candidates, run.runId);
  const targetAttemptIds = new Set(graph.attempts.filter(value => value.runId === run.runId).map(value => value.attemptId));
  const targetResultIds = new Set(graph.providerResults.filter(value => value.runId === run.runId).map(value => value.resultId));
  // Creation proves new authority + completed ancestors, not execution completion of the new Run.
  requireRcv021HistoricalVerification({ ...graph,
    runLifecycleEvents: graph.runLifecycleEvents.filter(value => value.runId !== run.runId),
    terminalResolutions: graph.terminalResolutions.filter(value => value.runId !== run.runId),
    attempts: graph.attempts.filter(value => value.runId !== run.runId),
    attemptResolutions: graph.attemptResolutions.filter(value => !targetAttemptIds.has(value.attemptId)),
    providerResults: graph.providerResults.filter(value => value.runId !== run.runId),
    resultSelections: graph.resultSelections.filter(value => !targetResultIds.has(value.providerResultId)) });
}

function strictContextRows(graph: Rcv021HistoricalGraph): void {
  const collections = [[graph.operation, graph.subject, graph.trigger], graph.operationLifecycleEvents, graph.runs, graph.runLifecycleEvents, graph.terminalResolutions, graph.attempts, graph.attemptResolutions, graph.providerResults, graph.resultSelections];
  for (const rows of collections) for (const row of rows) {
    if (!row || typeof row !== "object") throw new Error("MALFORMED_DATA: context row");
    const descriptors = Object.getOwnPropertyDescriptors(row);
    if (Object.values(descriptors).some(value => !("value" in value))) throw new Error("MALFORMED_DATA: context accessor");
    if (row.canonicalVersion !== 1 || typeof row.canonical !== "string" || typeof row.canonicalHash !== "string" || !/^[0-9a-f]{64}$/.test(row.canonicalHash)) throw new Error("MALFORMED_DATA: context canonical shape");
  }
  for (const run of graph.runs) if (typeof run.strategyVersion !== "number" || !Number.isSafeInteger(run.strategyVersion) || run.strategyVersion < 1) throw new Error("MALFORMED_DATA: context strategy version");
  for (const attempt of graph.attempts) if (typeof attempt.attemptNumber !== "string") throw new Error("MALFORMED_DATA: context attempt integer shape");
  for (const terminal of graph.terminalResolutions) if (typeof terminal.resultCount !== "string") throw new Error("MALFORMED_DATA: context result integer shape");
}

/** Authentic pending records are not a claim that a Run has completed. */
export async function verifyRcv021PendingStoredContexts(client: Rcv021PgClient, owners: ReadonlyMap<string, string>): Promise<void> {
  for (const [runId, operationId] of owners) {
    const loaded = await loadRcv021HistoricalGraphWithinTransaction(rcv021MeasuredContextClient(client), operationId);
    if (!loaded) throw new Error("MISSING_DATA: pending Run context");
    strictContextRows(loaded);
    const graph = targetGraph(loaded, runId);
    const result = verifyRcv021HistoricalGraph(graph);
    validateStoredAttemptOrdering(graph, runId);
    if (graph.terminalResolutions.some(terminal => terminal.runId === runId)) {
      if (!result.verified) throw new Error("DEADLINE_VIOLATION: existing terminal context is UNKNOWN");
      continue;
    }

  }
}

/** A lock cannot refresh a repeatable snapshot. Reject unsupported isolation before reads/writes. */
export async function requireRcv021ReadCommitted(client: Rcv021PgClient): Promise<void> {
  const rows = measuredRcv021Rows(await client.query("SELECT current_setting('transaction_isolation') AS isolation_level"));
  if (rows.length !== 1 || rows[0].isolation_level !== "read committed") throw new Error("UNSUPPORTED_STATE: RCV021 writes require measured READ COMMITTED isolation");
}

/** Operation-only mutations must prove lifecycle even when no Run is affected. */
export async function verifyRcv021OperationStoredContexts(client: Rcv021PgClient, input: Readonly<Rcv021WriteBundle>, owners: ReadonlyMap<string, string>): Promise<void> {
  const ids = new Set([...owners.values(), ...(input.operations ?? []).map(row => row.operationId), ...(input.operationLifecycleEvents ?? []).map(row => row.operationId), ...(input.subjects ?? []).map(row => row.operationId), ...(input.triggers ?? []).map(row => row.operationId)]);
  for (const operationId of [...ids].sort()) {
    const loaded = await loadRcv021HistoricalGraphWithinTransaction(rcv021MeasuredContextClient(client), operationId);
    if (!loaded || loaded.operation.operationId !== operationId) throw new Error("MISSING_DATA: affected Operation context");
    const root = { ...loaded, runs: [], runLifecycleEvents: [], terminalResolutions: [], attempts: [], attemptResolutions: [], providerResults: [], resultSelections: [] };
    strictContextRows(root);
    requireRcv021HistoricalVerification(root);
  }
}

function validateStoredAttemptOrdering(graph: Rcv021HistoricalGraph, runId: string): void {
    const decode = <T>(row: Record<string, unknown>): T => ({ ...JSON.parse(row.canonical as string), canonicalVersion: row.canonicalVersion, canonical: row.canonical, canonicalHash: row.canonicalHash }) as T;
    const run = decode<import("../contracts/rcv021ActiveResearchContractV1").ResearchRun>(graph.runs.find(value => value.runId === runId)!);
    const starts = graph.runLifecycleEvents.filter(event => event.runId === runId).map(row => decode<import("../contracts/rcv021ActiveResearchContractV1").RunLifecycleEvent>(row));
    validateRunLifecycle(run, starts, undefined, [], []);
    const seen = new Set<string>();
    for (const row of graph.attempts.filter(attempt => attempt.runId === runId)) {
      const attempt = decode<import("../contracts/rcv021ActiveResearchContractV1").ResearchAttempt>(row);
      uuid(attempt.attemptId); uuid(attempt.runId);
      if (seen.has(attempt.attemptId)) throw new Error("DUPLICATE_CONFLICT: pending Attempt identity");
      seen.add(attempt.attemptId);
      validateRcv021Timestamp(attempt.startedAt);
      if (starts.length !== 1 || attempt.startedAt < starts[0].eventAt) throw new Error("LIFECYCLE_VIOLATION: Attempt before authenticated Run start");
      if (attempt.predecessorAttemptId != null) {
        const predecessorRow = graph.attempts.find(value => value.attemptId === attempt.predecessorAttemptId);
        const resolutionRow = graph.attemptResolutions.find(value => value.attemptId === attempt.predecessorAttemptId);
        validateRetry(attempt, predecessorRow && decode(predecessorRow), resolutionRow && decode(resolutionRow));
      } else if (validateRcv021BigInt(attempt.attemptNumber) !== 1n) throw new Error("RETRY_LINEAGE_VIOLATION: first Attempt number");
    }
}

/** Predecessor terminals must be admitted before descendant terminals regardless of input order. */
export async function orderRcv021Terminals(client: Rcv021PgClient, owners: ReadonlyMap<string, string>, terminals: readonly RunTerminalResolution[]): Promise<readonly RunTerminalResolution[]> {
  const terminalRunIds = new Set<string>();
  for (const terminal of terminals) {
    const runId = uuid(terminal.runId);
    if (terminalRunIds.has(runId)) throw new Error("DUPLICATE_CONFLICT: multiple terminal proposals for one Run");
    terminalRunIds.add(runId);
  }
  const runs = new Map<string, Record<string, unknown>>();
  for (const operationId of [...new Set(terminals.map(row => owners.get(row.runId)))].sort()) {
    if (!operationId) throw new Error("MISSING_DATA: terminal ordering owner");
    const graph = await loadRcv021HistoricalGraphWithinTransaction(rcv021MeasuredContextClient(client), operationId);
    if (!graph) throw new Error("MISSING_DATA: terminal ordering graph");
    strictContextRows(graph);
    for (const run of graph.runs) runs.set(uuid(run.runId), run);
  }
  const proposed = new Map(terminals.map(row => [row.runId, row]));
  const done = new Set<string>(), active = new Set<string>(), ordered: RunTerminalResolution[] = [];
  const visit = (runId: string): void => {
    if (done.has(runId)) return;
    if (active.has(runId)) throw new Error("RERUN_LINEAGE_VIOLATION: cyclic terminal ancestry");
    active.add(runId);
    const run = runs.get(runId);
    if (!run) throw new Error("MISSING_DATA: terminal ordering Run");
    if (run.predecessorRunId != null) visit(uuid(run.predecessorRunId));
    active.delete(runId); done.add(runId);
    const terminal = proposed.get(runId); if (terminal) ordered.push(terminal);
  };
  for (const runId of [...proposed.keys()].sort()) visit(runId);
  return ordered;
}
