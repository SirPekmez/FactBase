import { Rcv021RetainedFailure, throwRcv021RetainedFailures } from "./rcv021WriteFailures";
import { createHash } from "node:crypto";
import { Rcv021PostgresReadRepository, Rcv021HistoricalGraph } from "./rcv021PostgresReadRepository";
import { Rcv021ReadVerificationError, authenticateRcv021DecisionOutputCreation, requireRcv021HistoricalVerification } from "./rcv021ReadVerifier";
import {
  canonicalizeSchedulerDecision,
  canonicalizeSchedulerLifecyclePrefixManifest,
  canonicalizeSchedulerPolicyVersion,
  canonicalizeSchedulerRunNowBinding,
  deriveSchedulerRunId,
  SchedulerCanonicalError,
  SchedulerDecisionIdentityInput,
} from "./researchSchedulerCanonical";
import {
  evaluateScheduler,
  makeSchedulerConsumedSlotSet,
  selectSchedulerPolicyOwner,
  validateSchedulerPolicyHistory,
} from "./researchSchedulerSemanticCore";
import { deriveSchedulerScheduledAt, formatSchedulerTimestamp, parseSchedulerTimestamp, SchedulerTimeError } from "./researchSchedulerTime";

export interface SchedulerReaderClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows?: readonly Record<string, any>[]; rowCount?: number | null }>;
  release: (destroy?: boolean) => void | Promise<void>;
}
export interface SchedulerReaderPool { connect(): Promise<SchedulerReaderClient>; }

export type SchedulerReaderFailureCode =
  | "MISSING_DATA" | "MALFORMED_DATA" | "CANONICAL_MISMATCH" | "HASH_MISMATCH" | "IDENTITY_MISMATCH"
  | "DUPLICATE_CONFLICT" | "POLICY_VERSION_VIOLATION" | "SLOT_ARITHMETIC_VIOLATION" | "RETROACTIVE_SLOT_VIOLATION"
  | "DECISION_PRECEDENCE_VIOLATION" | "LIFECYCLE_PREFIX_VIOLATION" | "NONTERMINAL_RUN_VIOLATION"
  | "RUN_NOW_BINDING_VIOLATION" | "CURRENT_STATE_SUBSTITUTION" | "UNSUPPORTED_STATE";

export class SchedulerReaderVerificationError extends Error {
  readonly name = "SchedulerReaderVerificationError";
  constructor(readonly code: SchedulerReaderFailureCode, readonly path: string, message: string) {
    super(`${code} at ${path}: ${message}`);
  }
}

type Row = Record<string, any>;
const dbTime = (column: string): string => `(to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(${column} AT TIME ZONE 'UTC', 'HH24:MI:SS.US') || 'Z')`;
const hashBytes = (value: unknown): string => Buffer.isBuffer(value) ? value.toString("hex") : value instanceof Uint8Array ? Buffer.from(value).toString("hex") : String(value);
const memberRank: Readonly<Record<string, number>> = Object.freeze({ OPERATION_CREATED: 0, OPERATION_LIFECYCLE_EVENT: 1, RUN_CREATED: 2, RUN_LIFECYCLE_EVENT: 3, RUN_TERMINAL_RESOLUTION: 4 });
const fail = (code: SchedulerReaderFailureCode, path: string, message: string): never => { throw new SchedulerReaderVerificationError(code, path, message); };
const equal = (actual: string, expected: string, path: string): void => { if (actual !== expected) fail("CANONICAL_MISMATCH", path, "persisted authority differs from reconstructed authority"); };

function uuidFromDigest(domain: string, value: string): string {
  const digest = createHash("sha256").update(domain, "utf8").update(value, "utf8").digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface PolicyRow { policyId: string; operationId: string; version: string; enabled: boolean; effectiveAt: string; firstEligibilityAt: string; interval: string; canonicalVersion: string; canonical: string; hash: string; }
interface DecisionRow {
  operationId: string; policyId: string; slotIndex: string; policyVersion: string; policyVersionHash: string;
  scheduledAt: string; evaluationAt: string; decision: any; reason: any; nextEligibleAt: string | null;
  manifestId: string; manifestHash: string; previousOperationId: string | null; previousPolicyId: string | null; previousSlotIndex: string | null; previousHash: string | null;
  activeRunId: string | null; activeRunCreationIdentity: string | null; activeRunCreationHash: string | null; activeRunHistoricalState: any; activeRunRunningEventIdentity: string | null; activeRunRunningEventHash: string | null;
  bindingIdentity: string | null; runId: string | null; canonicalVersion: string; canonical: string; hash: string;
}

async function q(client: SchedulerReaderClient, text: string, values: readonly unknown[] = []) { return client.query(text, values); }

async function loadPolicies(client: SchedulerReaderClient, policyId: string): Promise<PolicyRow[]> {
  const result = await q(client, `SELECT p.policy_id::text AS policy_id, s.operation_id::text AS operation_id, p.version::text AS version, p.enabled,
    ${dbTime("p.effective_at")} AS effective_at, ${dbTime("p.first_eligibility_at")} AS first_eligibility_at,
    p.fixed_interval_micros::text AS interval, p.canonical_version::text AS canonical_version, p.canonical, encode(p.canonical_hash,'hex') AS hash
    FROM public.scheduler_policy_versions p JOIN public.scheduler_policy_streams s ON s.policy_id=p.policy_id
    WHERE p.policy_id=$1 ORDER BY p.version`, [policyId]);
  return (result.rows ?? []).map((row: Row) => ({ policyId, operationId: row.operation_id, version: row.version, enabled: row.enabled, effectiveAt: row.effective_at, firstEligibilityAt: row.first_eligibility_at, interval: row.interval, canonicalVersion: row.canonical_version, canonical: row.canonical, hash: row.hash }));
}

async function loadDecisions(client: SchedulerReaderClient, operationId: string, policyId: string): Promise<DecisionRow[]> {
  const result = await q(client, `SELECT operation_id::text AS operation_id, policy_id::text AS policy_id, slot_index::text AS slot_index,
    policy_version::text AS policy_version, encode(policy_version_canonical_hash,'hex') AS policy_version_hash,
    ${dbTime("scheduled_at")} AS scheduled_at, ${dbTime("evaluation_at")} AS evaluation_at, decision, reason,
    ${dbTime("next_eligible_at")} AS next_eligible_at, manifest_id::text AS manifest_id, encode(operation_manifest_hash,'hex') AS manifest_hash,
    previous_operation_id::text AS previous_operation_id, previous_policy_id::text AS previous_policy_id, previous_slot_index::text AS previous_slot_index,
    encode(previous_decision_canonical_hash,'hex') AS previous_hash, active_run_id::text AS active_run_id,
    active_run_creation_identity::text AS active_run_creation_identity, encode(active_run_creation_hash,'hex') AS active_run_creation_hash,
    active_run_historical_state, active_run_running_event_identity::text AS active_run_running_event_identity,
    encode(active_run_running_event_hash,'hex') AS active_run_running_event_hash, run_now_binding_identity AS binding_identity,
    run_now_run_id::text AS run_id, canonical_version::text AS canonical_version, canonical, encode(canonical_hash,'hex') AS hash
    FROM public.scheduler_decisions WHERE operation_id=$1 AND policy_id=$2 ORDER BY slot_index`, [operationId, policyId]);
  return (result.rows ?? []).map((row: Row) => ({ operationId: row.operation_id, policyId: row.policy_id, slotIndex: row.slot_index, policyVersion: row.policy_version, policyVersionHash: row.policy_version_hash, scheduledAt: row.scheduled_at, evaluationAt: row.evaluation_at, decision: row.decision, reason: row.reason, nextEligibleAt: row.next_eligible_at, manifestId: row.manifest_id, manifestHash: row.manifest_hash, previousOperationId: row.previous_operation_id, previousPolicyId: row.previous_policy_id, previousSlotIndex: row.previous_slot_index, previousHash: row.previous_hash, activeRunId: row.active_run_id, activeRunCreationIdentity: row.active_run_creation_identity, activeRunCreationHash: row.active_run_creation_hash, activeRunHistoricalState: row.active_run_historical_state, activeRunRunningEventIdentity: row.active_run_running_event_identity, activeRunRunningEventHash: row.active_run_running_event_hash, bindingIdentity: row.binding_identity, runId: row.run_id, canonicalVersion: row.canonical_version, canonical: row.canonical, hash: row.hash }));
}

function decisionInput(row: DecisionRow): Parameters<typeof canonicalizeSchedulerDecision>[0] {
  return {
    operationId: row.operationId, policyId: row.policyId, slotIndex: row.slotIndex,
    previousDecisionIdentity: row.previousOperationId === null ? null : { operationId: row.previousOperationId, policyId: row.previousPolicyId!, slotIndex: row.previousSlotIndex! },
    previousDecisionCanonicalHash: row.previousHash, policyVersion: row.policyVersion, policyVersionCanonicalHash: row.policyVersionHash,
    scheduledAtMicros: parseSchedulerTimestamp(row.scheduledAt), evaluationAtMicros: parseSchedulerTimestamp(row.evaluationAt), decision: row.decision, reason: row.reason,
    nextEligibleAtMicros: row.nextEligibleAt === null ? null : parseSchedulerTimestamp(row.nextEligibleAt), operationManifestId: row.manifestId, operationManifestHash: row.manifestHash,
    activeRunId: row.activeRunId, activeRunCreationIdentity: row.activeRunCreationIdentity, activeRunCreationHash: row.activeRunCreationHash, activeRunHistoricalState: row.activeRunHistoricalState,
    activeRunRunningEventIdentity: row.activeRunRunningEventIdentity, activeRunRunningEventHash: row.activeRunRunningEventHash, runNowBindingIdentity: row.bindingIdentity, runNowRunId: row.runId,
  };
}

function authenticateChain(rows: readonly DecisionRow[], operationId: string, policyId: string): { tail: DecisionRow | null; hashes: Map<string, string> } {
  const byId = new Map<string, DecisionRow>(); const hashes = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.operationId}:${row.policyId}:${row.slotIndex}`;
    if (byId.has(key)) fail("DUPLICATE_CONFLICT", `decisions.${key}`, "duplicate Decision identity");
    if (row.operationId !== operationId || row.policyId !== policyId) fail("IDENTITY_MISMATCH", `decisions.${key}`, "Decision belongs to another stream");
    if (row.canonicalVersion !== "1") fail("UNSUPPORTED_STATE", `decisions.${key}.canonicalVersion`, "unsupported canonical version");
    const encoded = canonicalizeSchedulerDecision(decisionInput(row));
    equal(row.canonical, encoded.canonical, `decisions.${key}.canonical`); if (row.hash !== encoded.hash) fail("HASH_MISMATCH", `decisions.${key}.canonicalHash`, "Decision hash mismatch");
    byId.set(key, row); hashes.set(key, row.hash);
  }
  if (rows.length === 0) return { tail: null, hashes };
  const genesis = rows.filter((row) => row.previousOperationId === null);
  if (genesis.length !== 1) fail("LIFECYCLE_PREFIX_VIOLATION", "decisions.genesis", "exactly one genesis is required");
  const successors = new Map<string, DecisionRow>();
  for (const row of rows) {
    if (row.previousOperationId === null) continue;
    if (row.previousPolicyId !== policyId || row.previousOperationId !== operationId || row.previousSlotIndex === null || row.previousHash === null) fail("IDENTITY_MISMATCH", `decisions.${row.slotIndex}.predecessor`, "predecessor stream mismatch");
    const key = `${row.previousOperationId}:${row.previousPolicyId}:${row.previousSlotIndex}`; const predecessor = byId.get(key);
    if (!predecessor) fail("MISSING_DATA", `decisions.${row.slotIndex}.predecessor`, "predecessor is missing");
    if (hashes.get(key) !== row.previousHash) fail("HASH_MISMATCH", `decisions.${row.slotIndex}.predecessorHash`, "predecessor hash mismatch");
    if (successors.has(key)) fail("DUPLICATE_CONFLICT", `decisions.${row.slotIndex}.predecessor`, "predecessor branch");
    if (BigInt(row.slotIndex) <= BigInt(predecessor!.slotIndex)) fail("RETROACTIVE_SLOT_VIOLATION", `decisions.${row.slotIndex}.slotIndex`, "slot does not strictly increase");
    successors.set(key, row);
  }
  const visited = new Set<string>(); let current = genesis[0];
  while (current) { const key = `${current.operationId}:${current.policyId}:${current.slotIndex}`; if (visited.has(key)) fail("LIFECYCLE_PREFIX_VIOLATION", `decisions.${key}`, "cycle detected"); visited.add(key); current = successors.get(key)!; }
  if (visited.size !== rows.length) fail("LIFECYCLE_PREFIX_VIOLATION", "decisions.chain", "disconnected Decision");
  return { tail: [...visited].map((key) => byId.get(key)!).find((row) => !successors.has(`${row.operationId}:${row.policyId}:${row.slotIndex}`))!, hashes };
}

interface Prefix { members: Array<Parameters<typeof canonicalizeSchedulerLifecyclePrefixManifest>[0]["members"][number]>; nonterminal: Array<{ runId: string; state: "PLANNED" | "RUNNING"; creationIdentity: string; creationHash: string; runningEventIdentity: string | null; runningEventHash: string | null }>; operationState: "OPEN" | "CLOSED"; }

function prefixAt(graph: Rcv021HistoricalGraph, evaluationAt: string, excludeRunId: string | null): Prefix {
  const evaluation = parseSchedulerTimestamp(evaluationAt); const members: Prefix["members"] = [];
  const operation = graph.operation; const operationAt = parseSchedulerTimestamp(String(operation.operationCreatedAt));
  if (operationAt > evaluation) fail("LIFECYCLE_PREFIX_VIOLATION", "manifest.members", "Operation creation is after cutoff");
  members.push({ authorityKind: "OPERATION_CREATED", authoritativeTimeMicros: operationAt, authorityIdentity: String(operation.operationId), authorityCanonicalVersion: String(operation.canonicalVersion), authorityCanonicalHash: String(operation.canonicalHash) });
  const events = graph.operationLifecycleEvents.filter((event) => parseSchedulerTimestamp(String(event.eventAt)) <= evaluation);
  for (const event of events) members.push({ authorityKind: "OPERATION_LIFECYCLE_EVENT", authoritativeTimeMicros: parseSchedulerTimestamp(String(event.eventAt)), authorityIdentity: String(event.eventId), authorityCanonicalVersion: String(event.canonicalVersion), authorityCanonicalHash: String(event.canonicalHash) });
  const operationState: "OPEN" | "CLOSED" = events.some((event) => event.eventType === "CLOSED") ? "CLOSED" : "OPEN";
  const nonterminal: Prefix["nonterminal"] = [];
  for (const run of graph.runs) {
    const runAt = parseSchedulerTimestamp(String(run.runCreatedAt)); if (runAt > evaluation || String(run.runId) === excludeRunId) continue;
    members.push({ authorityKind: "RUN_CREATED", authoritativeTimeMicros: runAt, authorityIdentity: String(run.runId), authorityCanonicalVersion: String(run.canonicalVersion), authorityCanonicalHash: String(run.canonicalHash) });
    const starts = graph.runLifecycleEvents.filter((event) => String(event.runId) === String(run.runId) && parseSchedulerTimestamp(String(event.eventAt)) <= evaluation);
    starts.forEach((event) => members.push({ authorityKind: "RUN_LIFECYCLE_EVENT", authoritativeTimeMicros: parseSchedulerTimestamp(String(event.eventAt)), authorityIdentity: String(event.eventId), authorityCanonicalVersion: String(event.canonicalVersion), authorityCanonicalHash: String(event.canonicalHash) }));
    const terminals = graph.terminalResolutions.filter((resolution) => String(resolution.runId) === String(run.runId) && parseSchedulerTimestamp(String(resolution.terminalAt)) <= evaluation);
    terminals.forEach((resolution) => members.push({ authorityKind: "RUN_TERMINAL_RESOLUTION", authoritativeTimeMicros: parseSchedulerTimestamp(String(resolution.terminalAt)), authorityIdentity: String(resolution.resolutionId), authorityCanonicalVersion: String(resolution.canonicalVersion), authorityCanonicalHash: String(resolution.canonicalHash) }));
    if (terminals.length === 0) { const running = starts[starts.length - 1]; nonterminal.push({ runId: String(run.runId), state: running ? "RUNNING" : "PLANNED", creationIdentity: String(run.runId), creationHash: String(run.canonicalHash), runningEventIdentity: running ? String(running.eventId) : null, runningEventHash: running ? String(running.canonicalHash) : null }); }
  }
  if (nonterminal.length > 1) fail("NONTERMINAL_RUN_VIOLATION", "manifest.members", "multiple nonterminal Runs");
  return { members, nonterminal, operationState };
}

function graphRun(graph: Rcv021HistoricalGraph, runId: string): Record<string, unknown> {
  const run = graph.runs.find((candidate) => String(candidate.runId) === runId); if (!run) fail("MISSING_DATA", `run.${runId}`, "RCV-021 Run is missing"); return run!;
}

export function graphAtCutoff(graph: Rcv021HistoricalGraph, evaluationAt: string, excludeDecisionRunIds: readonly string[] = []): Rcv021HistoricalGraph {
  const cutoff = parseSchedulerTimestamp(evaluationAt);
  const runs = graph.runs.filter((run) => !excludeDecisionRunIds.includes(String(run.runId)) && parseSchedulerTimestamp(String(run.runCreatedAt)) <= cutoff);
  const runIds = new Set(runs.map((run) => String(run.runId)));
  const runLifecycleEvents = graph.runLifecycleEvents.filter((event) => runIds.has(String(event.runId)) && parseSchedulerTimestamp(String(event.eventAt)) <= cutoff);
  const terminalResolutions = graph.terminalResolutions.filter((resolution) => runIds.has(String(resolution.runId)) && parseSchedulerTimestamp(String(resolution.terminalAt)) <= cutoff);
  const attempts = graph.attempts.filter((attempt) => runIds.has(String(attempt.runId)) && parseSchedulerTimestamp(String(attempt.startedAt)) <= cutoff);
  const attemptIds = new Set(attempts.map((attempt) => String(attempt.attemptId)));
  const attemptResolutions = graph.attemptResolutions.filter((resolution) => attemptIds.has(String(resolution.attemptId)) && parseSchedulerTimestamp(String(resolution.terminalAt)) <= cutoff);
  const providerResults = graph.providerResults.filter((result) => runIds.has(String(result.runId)) && parseSchedulerTimestamp(String(result.resultObservedAt)) <= cutoff);
  const resultIds = new Set(providerResults.map((result) => String(result.resultId)));
  const resultSelections = graph.resultSelections.filter((selection) => resultIds.has(String(selection.providerResultId)) && parseSchedulerTimestamp(String(selection.selectedAt)) <= cutoff);
  return {
    operation: graph.operation,
    subject: graph.subject,
    trigger: graph.trigger,
    operationLifecycleEvents: graph.operationLifecycleEvents.filter((event) => parseSchedulerTimestamp(String(event.eventAt)) <= cutoff),
    runs,
    runLifecycleEvents,
    terminalResolutions,
    attempts,
    attemptResolutions,
    providerResults,
    resultSelections,
    rcv020Occurrences: graph.rcv020Occurrences,
  };
}

export interface VerifiedSchedulerHistory { readonly verified: true; readonly operationId: string; readonly policyId: string; readonly decisionCount: number; readonly tailSlotIndex: string | null; }

/** SELECT-only historical Scheduler verifier. It reconstructs all authority from persisted rows and never invokes Scheduler Writer code. */
export async function verifySchedulerHistory(pool: SchedulerReaderPool, operationId: string, policyId: string): Promise<VerifiedSchedulerHistory> {
  const streamClient = await pool.connect();
  const failures: Rcv021RetainedFailure[] = [];
  let result: VerifiedSchedulerHistory | undefined;
  try { result = await verifySchedulerHistoryOnClient(pool, streamClient, operationId, policyId); }
  catch (error) { failures.push({ phase: "primary", error }); }
  try {
    if (typeof streamClient.release !== "function") throw new Error("MALFORMED_DATA: Scheduler reader connection release missing");
    await streamClient.release(failures.length !== 0);
  } catch (error) { failures.push({ phase: "connection-release", error }); }
  throwRcv021RetainedFailures(failures);
  if (!result) throw new Error("MISSING_DATA: Scheduler history result missing");
  return result;
}

async function verifySchedulerHistoryOnClient(pool: SchedulerReaderPool, streamClient: SchedulerReaderClient, operationId: string, policyId: string): Promise<VerifiedSchedulerHistory> {
  try {
    const stream = (await q(streamClient, "SELECT policy_id::text AS policy_id, operation_id::text AS operation_id FROM public.scheduler_policy_streams WHERE policy_id=$1", [policyId])).rows?.[0];
    if (!stream) fail("MISSING_DATA", "policyStream", "policy stream is missing");
    if (stream!.operation_id !== operationId) fail("IDENTITY_MISMATCH", "policyStream.operationId", "stream Operation mismatch");
    const policies = await loadPolicies(streamClient, policyId); if (policies.length === 0) fail("MISSING_DATA", "policyVersions", "policy history is empty");
    const policyInputs = policies.map((row) => ({ policyId, operationId, version: row.version, enabled: row.enabled, effectiveAtMicros: parseSchedulerTimestamp(row.effectiveAt).toString(), firstEligibilityAtMicros: parseSchedulerTimestamp(row.firstEligibilityAt).toString(), fixedIntervalMicros: row.interval }));
    const validated = validateSchedulerPolicyHistory(policyInputs);
    policies.forEach((row, index) => { if (row.canonicalVersion !== "1") fail("UNSUPPORTED_STATE", `policyVersions.${row.version}.canonicalVersion`, "unsupported canonical version"); const encoded = canonicalizeSchedulerPolicyVersion(policyInputs[index]); equal(row.canonical, encoded.canonical, `policyVersions.${row.version}.canonical`); if (row.hash !== encoded.hash) fail("HASH_MISMATCH", `policyVersions.${row.version}.canonicalHash`, "policy hash mismatch"); });
    const decisions = await loadDecisions(streamClient, operationId, policyId); const chain = authenticateChain(decisions, operationId, policyId);
    const rcvGraph = await new Rcv021PostgresReadRepository(pool as any).loadByOperationId(operationId);
    if (!rcvGraph) fail("MISSING_DATA", "rcv021", "Operation history is missing");
    const graph = rcvGraph!;
    const initialCutoff = policies[0].effectiveAt;
    const initialOutputs = decisions.filter(row => row.decision === "RUN_NOW" && row.evaluationAt === initialCutoff);
    const initialOutputIds: string[] = [];
    for (const row of initialOutputs) {
      const expected = deriveSchedulerRunId({ operationId, policyId, slotIndex: row.slotIndex });
      if (row.runId !== expected) fail("RUN_NOW_BINDING_VIOLATION", "initialPrefix.run", "decision output identity mismatch");
      authenticateRcv021DecisionOutputCreation(graphAtCutoff(graph, initialCutoff), expected, initialCutoff);
      initialOutputIds.push(expected);
    }
    requireRcv021HistoricalVerification(graphAtCutoff(graph, initialCutoff, initialOutputIds), initialCutoff);
    const slots = decisions.map((row) => row.slotIndex);
    for (const row of decisions) {
      const slot = BigInt(row.slotIndex); const scheduled = parseSchedulerTimestamp(row.scheduledAt); const owner = selectSchedulerPolicyOwner(validated, scheduled);
      const expectedScheduled = deriveSchedulerScheduledAt(validated[0].firstEligibilityAtBigInt, slot, validated[0].fixedIntervalBigInt); if (scheduled !== expectedScheduled) fail("SLOT_ARITHMETIC_VIOLATION", `decisions.${row.slotIndex}.scheduledAt`, "scheduledAt arithmetic mismatch");
      if (row.policyVersion !== owner.versionBigInt.toString() || row.policyVersionHash !== owner.canonicalHash) fail("POLICY_VERSION_VIOLATION", `decisions.${row.slotIndex}.policyVersion`, "policy owner mismatch");
      const excludeRun = row.decision === "RUN_NOW" ? row.runId : null;
      // The decision-created Run is output, not predecision evidence; its exact
      // binding and authority are authenticated separately below.
      if (excludeRun !== null) authenticateRcv021DecisionOutputCreation(graphAtCutoff(graph, row.evaluationAt), excludeRun, row.evaluationAt);
      const historicalGraph = graphAtCutoff(graph, row.evaluationAt, excludeRun === null ? [] : [excludeRun]);
      requireRcv021HistoricalVerification(historicalGraph, row.evaluationAt);
      const prefix = prefixAt(graph, row.evaluationAt, excludeRun);
      const expectedManifestId = uuidFromDigest("factbase/scheduler-manifest/v1\0", `${operationId}:${policyId}:${row.slotIndex}:${parseSchedulerTimestamp(row.evaluationAt).toString()}`);
      if (row.manifestId !== expectedManifestId) fail("IDENTITY_MISMATCH", `decisions.${row.slotIndex}.manifestId`, "manifest identity mismatch");
      const manifestRow = (await q(streamClient, `SELECT manifest_id::text AS manifest_id, operation_id::text AS operation_id, policy_id::text AS policy_id, slot_index::text AS slot_index, ${dbTime("evaluation_at")} AS evaluation_at, canonical_version::text AS canonical_version, canonical, encode(canonical_hash,'hex') AS hash FROM public.scheduler_lifecycle_prefix_manifests WHERE manifest_id=$1`, [row.manifestId])).rows?.[0];
      if (!manifestRow) fail("MISSING_DATA", `decisions.${row.slotIndex}.manifest`, "manifest is missing");
      if (manifestRow!.canonical_version !== "1") fail("UNSUPPORTED_STATE", `decisions.${row.slotIndex}.manifest.canonicalVersion`, "unsupported canonical version");
      if (manifestRow!.operation_id !== operationId || manifestRow!.policy_id !== policyId || manifestRow!.slot_index !== row.slotIndex || manifestRow!.evaluation_at !== row.evaluationAt) fail("IDENTITY_MISMATCH", `decisions.${row.slotIndex}.manifest`, "manifest identity fields mismatch");
      const manifest = canonicalizeSchedulerLifecyclePrefixManifest({ manifestId: row.manifestId, operationId, policyId, slotIndex: row.slotIndex, evaluationAtMicros: parseSchedulerTimestamp(row.evaluationAt), members: prefix.members });
      equal(manifestRow!.canonical, manifest.canonical, `decisions.${row.slotIndex}.manifest.canonical`); if (manifestRow!.hash !== manifest.hash || row.manifestHash !== manifest.hash) fail("HASH_MISMATCH", `decisions.${row.slotIndex}.manifest.hash`, "manifest hash mismatch");
      const memberRows = [...((await q(streamClient, `SELECT authority_kind, ${dbTime("authoritative_time")} AS authoritative_time, authority_identity, authority_canonical_version, encode(authority_canonical_hash,'hex') AS authority_canonical_hash
        FROM public.scheduler_lifecycle_prefix_members WHERE manifest_id=$1`, [row.manifestId])).rows ?? [])];
      memberRows.sort((left: Row, right: Row) => {
        const time = BigInt(parseSchedulerTimestamp(left.authoritative_time)) - BigInt(parseSchedulerTimestamp(right.authoritative_time));
        if (time !== 0n) return time < 0n ? -1 : 1;
        const rank = memberRank[left.authority_kind] - memberRank[right.authority_kind];
        if (rank !== 0) return rank;
        return Buffer.from(String(left.authority_identity), "utf8").compare(Buffer.from(String(right.authority_identity), "utf8"));
      });
      const expectedMembers = [...manifest.value.members];
      if (memberRows.length !== expectedMembers.length) fail("LIFECYCLE_PREFIX_VIOLATION", `decisions.${row.slotIndex}.manifest.members`, "manifest member set differs");
      for (let index = 0; index < expectedMembers.length; index += 1) {
        const actual = memberRows[index] as Row; const expected = expectedMembers[index];
        if (actual.authority_kind !== expected.authorityKind || actual.authoritative_time !== formatSchedulerTimestamp(BigInt(expected.authoritativeTimeMicros)) || actual.authority_identity !== expected.authorityIdentity || String(actual.authority_canonical_version) !== expected.authorityCanonicalVersion || actual.authority_canonical_hash !== expected.authorityCanonicalHash) fail("LIFECYCLE_PREFIX_VIOLATION", `decisions.${row.slotIndex}.manifest.members[${index}]`, "manifest member differs");
      }
      const consumed = makeSchedulerConsumedSlotSet(decisions.filter((candidate) => BigInt(candidate.slotIndex) < slot).map((candidate) => candidate.slotIndex));
      const evaluation = evaluateScheduler({ evaluationAtMicros: parseSchedulerTimestamp(row.evaluationAt), operationState: prefix.operationState, policyVersions: policyInputs, activeRunHistoricalState: prefix.nonterminal[0]?.state ?? null, consumedSlots: consumed });
      if (evaluation.kind !== "DUE_EVALUATION" || evaluation.decision !== row.decision || evaluation.reason !== row.reason || evaluation.slotIndex !== row.slotIndex) fail("DECISION_PRECEDENCE_VIOLATION", `decisions.${row.slotIndex}.reason`, "Decision precedence mismatch");
      const encodedDecision = canonicalizeSchedulerDecision(decisionInput(row)); equal(row.canonical, encodedDecision.canonical, `decisions.${row.slotIndex}.canonical`); if (row.hash !== encodedDecision.hash) fail("HASH_MISMATCH", `decisions.${row.slotIndex}.canonicalHash`, "Decision hash mismatch");
      if (row.decision === "RUN_NOW") {
        if (prefix.nonterminal.length !== 0) fail("NONTERMINAL_RUN_VIOLATION", `decisions.${row.slotIndex}.runNow`, "RUN_NOW has a nonterminal historical Run");
        if (!row.runId || !row.bindingIdentity) fail("RUN_NOW_BINDING_VIOLATION", `decisions.${row.slotIndex}.binding`, "RUN_NOW binding is missing");
        const decisionRunId = row.runId!; const expectedRunId = deriveSchedulerRunId({ operationId, policyId, slotIndex: row.slotIndex }); if (decisionRunId !== expectedRunId) fail("RUN_NOW_BINDING_VIOLATION", `decisions.${row.slotIndex}.runId`, "deterministic Run identity mismatch");
        const run = graphRun(graph, decisionRunId); if (String(run.operationId) !== operationId) fail("IDENTITY_MISMATCH", `decisions.${row.slotIndex}.run`, "Run Operation mismatch");
        const bindingRow = (await q(streamClient, "SELECT operation_id::text AS operation_id, policy_id::text AS policy_id, slot_index::text AS slot_index, run_id::text AS run_id, canonical_version::text AS canonical_version, canonical, encode(canonical_hash,'hex') AS hash FROM public.scheduler_run_now_bindings WHERE operation_id=$1 AND policy_id=$2 AND slot_index=$3", [operationId, policyId, row.slotIndex])).rows?.[0];
        if (!bindingRow || bindingRow.run_id !== decisionRunId) fail("RUN_NOW_BINDING_VIOLATION", `decisions.${row.slotIndex}.binding`, "Binding/Run mismatch");
        if (bindingRow!.operation_id !== operationId || bindingRow!.policy_id !== policyId || bindingRow!.slot_index !== row.slotIndex || bindingRow!.canonical_version !== "1") fail("RUN_NOW_BINDING_VIOLATION", `decisions.${row.slotIndex}.binding`, "Binding identity/version mismatch");
        const binding = canonicalizeSchedulerRunNowBinding({ operationId, policyId, slotIndex: row.slotIndex, runId: decisionRunId }); equal(bindingRow!.canonical, binding.canonical, `decisions.${row.slotIndex}.binding.canonical`); if (bindingRow!.hash !== binding.hash) fail("HASH_MISMATCH", `decisions.${row.slotIndex}.binding.hash`, "binding hash mismatch");
      }
    }
    return { verified: true, operationId, policyId, decisionCount: decisions.length, tailSlotIndex: chain.tail?.slotIndex ?? null };
  } catch (error) {
    // Retain before instanceof or metadata access: hostile failure objects can throw here.
    const retained: Rcv021RetainedFailure[] = [{ phase: "primary", error }];
    let mapped: SchedulerReaderVerificationError | undefined;
    try {
      if (!(error instanceof SchedulerReaderVerificationError)) {
        if (error instanceof Rcv021ReadVerificationError) mapped = new SchedulerReaderVerificationError("LIFECYCLE_PREFIX_VIOLATION", "rcv021", error.message);
        else if (error instanceof SchedulerCanonicalError || error instanceof SchedulerTimeError) mapped = new SchedulerReaderVerificationError("MALFORMED_DATA", error.path, error.message);
      }
    } catch (inspection) {
      retained.push({ phase: "primary", error: inspection });
      throwRcv021RetainedFailures(retained);
    }
    if (mapped) {
      Object.defineProperty(mapped, "cause", { value: error, enumerable: false });
      throw mapped;
    }
    throw error;
  }
}
