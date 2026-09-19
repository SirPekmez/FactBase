import { createHash } from "node:crypto";
import {
  canonicalizeRcv021Authority,
  sha256Rcv021Text,
} from "./rcv021Canonical";
import { persistRcv021BundleWithinTransaction } from "./rcv021PostgresRepository";
import { verifyRcv021Write } from "./rcv021WriteVerifier";
import type {
  ResearchOperation,
  ResearchRun,
  SubjectBinding,
  TriggerBinding,
} from "../contracts/rcv021ActiveResearchContractV1";
import {
  canonicalizeSchedulerDecision,
  canonicalizeSchedulerLifecyclePrefixManifest,
  canonicalizeSchedulerPolicyVersion,
  canonicalizeSchedulerRunNowBinding,
  deriveSchedulerRunId,
  SchedulerDecisionIdentityInput,
} from "./researchSchedulerCanonical";
import {
  evaluateScheduler,
  makeSchedulerConsumedSlotSet,
  selectSchedulerPolicyOwner,
  validateSchedulerPolicyHistory,
} from "./researchSchedulerSemanticCore";
import {
  formatSchedulerTimestamp,
  parseSchedulerTimestamp,
} from "./researchSchedulerTime";

export interface SchedulerWriterClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows?: readonly Record<string, any>[]; rowCount?: number | null }>;
  release?: () => void;
}

export interface SchedulerWriterPool {
  connect(): Promise<SchedulerWriterClient>;
}

export interface SchedulerRunNowRequest {
  readonly operationId: string;
  readonly policyId: string;
  readonly evaluationAt: string;
  readonly deadlineAt: string;
  readonly strategyIdentity: string;
  readonly strategyVersion: number;
  readonly providerIdentity: string;
  readonly adapterIdentity: string;
  readonly adapterVersion: string;
  readonly executionParametersCanonical: string;
}

export type SchedulerFailurePoint =
  | "after-locks"
  | "after-run"
  | "after-manifest"
  | "after-member"
  | "after-decision"
  | "before-binding"
  | "after-binding";

export interface SchedulerWriterTestHooks {
  readonly failAfter?: SchedulerFailurePoint;
}

export interface SchedulerRunNowResult {
  readonly status: "COMMITTED" | "IDEMPOTENT";
  readonly operationId: string;
  readonly policyId: string;
  readonly slotIndex: string;
  readonly runId: string;
  readonly manifestId: string;
  readonly decisionHash: string;
  readonly bindingHash: string;
}

type Row = Record<string, any>;
const q = async (client: SchedulerWriterClient, text: string, values: readonly unknown[] = []) => client.query(text, values);
const hex = (value: unknown): string => {
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "string") return value;
  throw new Error("MALFORMED_DATA: expected bytea");
};
const canonicalTime = (value: string): string => formatSchedulerTimestamp(parseSchedulerTimestamp(value));
const canonicalMicros = (value: bigint | string): string => formatSchedulerTimestamp(BigInt(value));
const dbTime = (column: string): string => `(to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(${column} AT TIME ZONE 'UTC', 'HH24:MI:SS.US') || 'Z')`;
const failAt = (hooks: SchedulerWriterTestHooks | undefined, point: SchedulerFailurePoint): void => {
  if (hooks?.failAfter === point) throw new Error(`TEST_INJECTED_FAILURE:${point}`);
};

function uuidFromDigest(domain: string, canonical: string): string {
  const digest = createHash("sha256").update(domain, "utf8").update(canonical, "utf8").digest();
  const value = Buffer.from(digest.subarray(0, 16));
  value[6] = (value[6] & 0x0f) | 0x40;
  value[8] = (value[8] & 0x3f) | 0x80;
  const h = value.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sameAuthority(actualCanonical: string, actualHash: string, expectedCanonical: string, expectedHash: string): void {
  if (actualCanonical !== expectedCanonical || actualHash !== expectedHash) throw new Error("DUPLICATE_CONFLICT: divergent immutable authority");
}

interface PolicyRow {
  policyId: string;
  operationId: string;
  version: string;
  enabled: boolean;
  effectiveAtMicros: string;
  firstEligibilityAtMicros: string;
  fixedIntervalMicros: string;
  canonicalVersion: string;
  canonical: string;
  canonicalHash: string;
}

async function loadPolicyVersions(client: SchedulerWriterClient, policyId: string): Promise<PolicyRow[]> {
  const result = await q(client, `SELECT p.policy_id::text AS policy_id, s.operation_id::text AS operation_id, version::text AS version, enabled,
      ${dbTime("effective_at")} AS effective_at, ${dbTime("first_eligibility_at")} AS first_eligibility_at,
      fixed_interval_micros::text AS fixed_interval_micros, canonical_version::text AS canonical_version,
      canonical, encode(canonical_hash,'hex') AS canonical_hash
    FROM public.scheduler_policy_versions p JOIN public.scheduler_policy_streams s ON s.policy_id = p.policy_id WHERE p.policy_id = $1 ORDER BY version`, [policyId]);
  return (result.rows ?? []).map((row: Row) => {
    const value = {
      policyId,
      operationId: row.operation_id,
      version: row.version,
      enabled: row.enabled,
      effectiveAtMicros: parseSchedulerTimestamp(row.effective_at).toString(),
      firstEligibilityAtMicros: parseSchedulerTimestamp(row.first_eligibility_at).toString(),
      fixedIntervalMicros: row.fixed_interval_micros,
    };
    return {
      policyId,
      operationId: row.operation_id,
      version: row.version,
      enabled: row.enabled,
      effectiveAtMicros: parseSchedulerTimestamp(row.effective_at).toString(),
      firstEligibilityAtMicros: parseSchedulerTimestamp(row.first_eligibility_at).toString(),
      fixedIntervalMicros: row.fixed_interval_micros,
      canonicalVersion: row.canonical_version,
      canonical: row.canonical,
      canonicalHash: row.canonical_hash,
    };
  });
}

interface OperationBundle {
  operation: ResearchOperation;
  subject: SubjectBinding;
  trigger: TriggerBinding;
  state: "OPEN" | "CLOSED";
}

async function loadOperationBundle(client: SchedulerWriterClient, operationId: string): Promise<OperationBundle> {
  const result = await q(client, `SELECT o.operation_id::text AS operation_id, o.subject_binding_id::text AS subject_binding_id,
      o.trigger_binding_id::text AS trigger_binding_id, o.purpose, o.scope_canonical,
      ${dbTime("o.operation_created_at")} AS operation_created_at, o.canonical_version, o.canonical, encode(o.canonical_hash,'hex') AS canonical_hash,
      s.subject_type, s.capture_id::text AS capture_id, s.observation_occurrence_id::text AS observation_occurrence_id,
      s.research_trigger_request_id::text AS research_trigger_request_id, s.operator_request_id::text AS operator_request_id,
      s.historical_claim_id::text AS historical_claim_id, s.canonical_version AS subject_canonical_version, s.canonical AS subject_canonical, encode(s.canonical_hash,'hex') AS subject_canonical_hash,
      t.trigger_type, t.initiator_identity, t.authorization_canonical,
      t.execution_owner, t.trigger_request_id::text AS trigger_request_id,
      t.originating_capture_id::text AS originating_capture_id, t.originating_occurrence_id::text AS originating_occurrence_id,
      t.rule_identity, t.rule_version, t.canonical_version AS trigger_canonical_version, t.canonical AS trigger_canonical, encode(t.canonical_hash,'hex') AS trigger_canonical_hash,
      (SELECT count(*) FROM public.research_operation_lifecycle_events e WHERE e.operation_id = o.operation_id AND e.event_type = 'CLOSED') AS close_count
    FROM public.research_operations o
    JOIN public.research_operation_subject_bindings s ON s.subject_binding_id = o.subject_binding_id
    JOIN public.research_operation_trigger_bindings t ON t.trigger_binding_id = o.trigger_binding_id
    WHERE o.operation_id = $1`, [operationId]);
  const row = (result.rows ?? [])[0];
  if (!row) throw new Error("MISSING_DATA: operation");
  let subjectValue: SubjectBinding;
  let triggerValue: TriggerBinding;
  let operationValue: ResearchOperation;
  try {
    subjectValue = JSON.parse(row.subject_canonical) as SubjectBinding;
    triggerValue = JSON.parse(row.trigger_canonical) as TriggerBinding;
    operationValue = JSON.parse(row.canonical) as ResearchOperation;
  } catch { throw new Error("MALFORMED_DATA: persisted RCV-021 canonical envelope"); }
  if (subjectValue.subjectBindingId !== row.subject_binding_id || subjectValue.operationId !== operationId || triggerValue.triggerBindingId !== row.trigger_binding_id || triggerValue.operationId !== operationId || operationValue.operationId !== operationId || operationValue.subjectBindingId !== row.subject_binding_id || operationValue.triggerBindingId !== row.trigger_binding_id) throw new Error("IDENTITY_MISMATCH: RCV-021 operation bundle");
  const subject = { ...subjectValue, canonicalVersion: Number(row.subject_canonical_version), canonical: row.subject_canonical, canonicalHash: row.subject_canonical_hash };
  const trigger = { ...triggerValue, canonicalVersion: Number(row.trigger_canonical_version), canonical: row.trigger_canonical, canonicalHash: row.trigger_canonical_hash };
  const operation = { ...operationValue, canonicalVersion: Number(row.canonical_version), canonical: row.canonical, canonicalHash: row.canonical_hash };
  if (sha256Rcv021Text(row.subject_canonical) !== row.subject_canonical_hash || sha256Rcv021Text(row.trigger_canonical) !== row.trigger_canonical_hash || sha256Rcv021Text(row.canonical) !== row.canonical_hash) throw new Error("HASH_MISMATCH: RCV-021 operation bundle");
  verifyRcv021Write({ operations: [operation], subjects: [subject], triggers: [trigger] });
  return { operation, subject, trigger, state: Number(row.close_count) === 0 ? "OPEN" : "CLOSED" };
}

interface DecisionRow {
  operationId: string; policyId: string; slotIndex: string; policyVersion: string; policyVersionCanonicalHash: string;
  scheduledAt: string; evaluationAt: string; decision: any; reason: any; nextEligibleAt: string | null;
  manifestId: string; operationManifestHash: string; previousOperationId: string | null; previousPolicyId: string | null;
  previousSlotIndex: string | null; previousDecisionCanonicalHash: string | null; activeRunId: string | null;
  activeRunCreationIdentity: string | null; activeRunCreationHash: string | null; activeRunHistoricalState: any;
  activeRunRunningEventIdentity: string | null; activeRunRunningEventHash: string | null; runNowBindingIdentity: string | null;
  runNowRunId: string | null; canonicalVersion: number; canonical: string; canonicalHash: string;
}

async function loadDecisions(client: SchedulerWriterClient, operationId: string, policyId: string): Promise<DecisionRow[]> {
  const result = await q(client, `SELECT operation_id::text AS operation_id, policy_id::text AS policy_id, slot_index::text AS slot_index,
      policy_version::text AS policy_version, encode(policy_version_canonical_hash,'hex') AS policy_version_canonical_hash,
      ${dbTime("scheduled_at")} AS scheduled_at, ${dbTime("evaluation_at")} AS evaluation_at, decision, reason,
      ${dbTime("next_eligible_at")} AS next_eligible_at, manifest_id::text AS manifest_id, encode(operation_manifest_hash,'hex') AS operation_manifest_hash,
      previous_operation_id::text AS previous_operation_id, previous_policy_id::text AS previous_policy_id, previous_slot_index::text AS previous_slot_index,
      encode(previous_decision_canonical_hash,'hex') AS previous_decision_canonical_hash, active_run_id::text AS active_run_id,
      active_run_creation_identity::text AS active_run_creation_identity, encode(active_run_creation_hash,'hex') AS active_run_creation_hash,
      active_run_historical_state, active_run_running_event_identity::text AS active_run_running_event_identity,
      encode(active_run_running_event_hash,'hex') AS active_run_running_event_hash, run_now_binding_identity, run_now_run_id::text AS run_now_run_id,
      canonical_version, canonical, encode(canonical_hash,'hex') AS canonical_hash
    FROM public.scheduler_decisions WHERE operation_id=$1 AND policy_id=$2 ORDER BY slot_index`, [operationId, policyId]);
  return (result.rows ?? []).map((row: Row) => ({
    operationId: row.operation_id, policyId: row.policy_id, slotIndex: row.slot_index, policyVersion: row.policy_version,
    policyVersionCanonicalHash: row.policy_version_canonical_hash, scheduledAt: row.scheduled_at, evaluationAt: row.evaluation_at,
    decision: row.decision, reason: row.reason, nextEligibleAt: row.next_eligible_at,
    manifestId: row.manifest_id, operationManifestHash: row.operation_manifest_hash, previousOperationId: row.previous_operation_id,
    previousPolicyId: row.previous_policy_id, previousSlotIndex: row.previous_slot_index, previousDecisionCanonicalHash: row.previous_decision_canonical_hash,
    activeRunId: row.active_run_id, activeRunCreationIdentity: row.active_run_creation_identity, activeRunCreationHash: row.active_run_creation_hash,
    activeRunHistoricalState: row.active_run_historical_state, activeRunRunningEventIdentity: row.active_run_running_event_identity,
    activeRunRunningEventHash: row.active_run_running_event_hash, runNowBindingIdentity: row.run_now_binding_identity, runNowRunId: row.run_now_run_id,
    canonicalVersion: Number(row.canonical_version), canonical: row.canonical, canonicalHash: row.canonical_hash,
  }));
}

function decisionInput(row: DecisionRow): Parameters<typeof canonicalizeSchedulerDecision>[0] {
  return {
    operationId: row.operationId, policyId: row.policyId, slotIndex: row.slotIndex,
    previousDecisionIdentity: row.previousOperationId === null ? null : { operationId: row.previousOperationId, policyId: row.previousPolicyId!, slotIndex: row.previousSlotIndex! },
    previousDecisionCanonicalHash: row.previousDecisionCanonicalHash,
    policyVersion: row.policyVersion, policyVersionCanonicalHash: row.policyVersionCanonicalHash,
    scheduledAtMicros: parseSchedulerTimestamp(row.scheduledAt), evaluationAtMicros: parseSchedulerTimestamp(row.evaluationAt),
    decision: row.decision, reason: row.reason, nextEligibleAtMicros: row.nextEligibleAt === null ? null : parseSchedulerTimestamp(row.nextEligibleAt),
    operationManifestId: row.manifestId, operationManifestHash: row.operationManifestHash, activeRunId: row.activeRunId,
    activeRunCreationIdentity: row.activeRunCreationIdentity, activeRunCreationHash: row.activeRunCreationHash,
    activeRunHistoricalState: row.activeRunHistoricalState, activeRunRunningEventIdentity: row.activeRunRunningEventIdentity,
    activeRunRunningEventHash: row.activeRunRunningEventHash, runNowBindingIdentity: row.runNowBindingIdentity, runNowRunId: row.runNowRunId,
  };
}

function authenticateChain(rows: readonly DecisionRow[], operationId: string, policyId: string): { tail: DecisionRow | null; slots: string[]; hashes: Map<string, string> } {
  const byId = new Map<string, DecisionRow>();
  const hashes = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.operationId}:${row.policyId}:${row.slotIndex}`;
    if (byId.has(key)) throw new Error("DUPLICATE_CONFLICT: duplicate decision identity");
    if (row.operationId !== operationId || row.policyId !== policyId) throw new Error("IDENTITY_MISMATCH: decision stream");
    const encoded = canonicalizeSchedulerDecision(decisionInput(row));
    sameAuthority(row.canonical, row.canonicalHash, encoded.canonical, encoded.hash);
    byId.set(key, row); hashes.set(key, row.canonicalHash);
  }
  const genesis = rows.filter((row) => row.previousOperationId === null);
  if (rows.length === 0) return { tail: null, slots: [], hashes };
  if (genesis.length !== 1) throw new Error("LIFECYCLE_PREFIX_VIOLATION: genesis count");
  const successors = new Map<string, DecisionRow>();
  for (const row of rows) {
    if (row.previousOperationId === null) continue;
    if (row.previousPolicyId !== policyId || row.previousOperationId !== operationId || row.previousSlotIndex === null || row.previousDecisionCanonicalHash === null) throw new Error("IDENTITY_MISMATCH: predecessor stream");
    const predecessorKey = `${row.previousOperationId}:${row.previousPolicyId}:${row.previousSlotIndex}`;
    const predecessor = byId.get(predecessorKey);
    if (!predecessor) throw new Error("MISSING_DATA: predecessor");
    if (hashes.get(predecessorKey) !== row.previousDecisionCanonicalHash) throw new Error("HASH_MISMATCH: predecessor");
    if (successors.has(predecessorKey)) throw new Error("DUPLICATE_CONFLICT: predecessor branch");
    if (BigInt(row.slotIndex) <= BigInt(predecessor.slotIndex)) throw new Error("RETROACTIVE_SLOT_VIOLATION: non-increasing predecessor edge");
    successors.set(predecessorKey, row);
  }
  const visited = new Set<string>(); let current = genesis[0];
  while (true) {
    const key = `${current.operationId}:${current.policyId}:${current.slotIndex}`;
    if (visited.has(key)) throw new Error("LIFECYCLE_PREFIX_VIOLATION: decision cycle");
    visited.add(key);
    const next = successors.get(key);
    if (!next) break;
    current = next;
  }
  if (visited.size !== rows.length) throw new Error("LIFECYCLE_PREFIX_VIOLATION: disconnected decision");
  return { tail: current, slots: rows.map((row) => row.slotIndex), hashes };
}

interface PrefixResult {
  members: Array<Parameters<typeof canonicalizeSchedulerLifecyclePrefixManifest>[0]["members"][number]>;
  nonterminal: Array<{ runId: string; state: "PLANNED" | "RUNNING"; creationHash: string; creationIdentity: string; runningEventIdentity: string | null; runningEventHash: string | null }>;
}

async function loadPrefix(client: SchedulerWriterClient, operationId: string, evaluationAt: string): Promise<PrefixResult> {
  const members: PrefixResult["members"] = [];
  const operation = (await q(client, `SELECT operation_id::text AS id, ${dbTime("operation_created_at")} AS at, canonical_version, canonical, encode(canonical_hash,'hex') AS hash FROM public.research_operations WHERE operation_id=$1`, [operationId])).rows?.[0];
  if (!operation || operation.at > evaluationAt) throw new Error("LIFECYCLE_PREFIX_VIOLATION: operation creation outside prefix");
  if (sha256Rcv021Text(operation.canonical) !== operation.hash) throw new Error("HASH_MISMATCH: operation canonical");
    members.push({ authorityKind: "OPERATION_CREATED", authoritativeTimeMicros: parseSchedulerTimestamp(operation.at), authorityIdentity: operation.id, authorityCanonicalVersion: String(operation.canonical_version), authorityCanonicalHash: operation.hash });
  const events = (await q(client, `SELECT event_id::text AS id, ${dbTime("event_at")} AS at, canonical_version, canonical, encode(canonical_hash,'hex') AS hash FROM public.research_operation_lifecycle_events WHERE operation_id=$1 AND event_at <= $2 ORDER BY event_at,event_id`, [operationId, evaluationAt])).rows ?? [];
  for (const event of events) {
    if (sha256Rcv021Text(event.canonical) !== event.hash) throw new Error("HASH_MISMATCH: operation event");
    members.push({ authorityKind: "OPERATION_LIFECYCLE_EVENT", authoritativeTimeMicros: parseSchedulerTimestamp(event.at), authorityIdentity: event.id, authorityCanonicalVersion: String(event.canonical_version), authorityCanonicalHash: event.hash });
  }
  const runs = (await q(client, `SELECT run_id::text AS id, ${dbTime("run_created_at")} AS created_at, canonical_version, canonical, encode(canonical_hash,'hex') AS hash FROM public.research_runs WHERE operation_id=$1 AND run_created_at <= $2 ORDER BY run_created_at,run_id`, [operationId, evaluationAt])).rows ?? [];
  const nonterminal: PrefixResult["nonterminal"] = [];
  for (const run of runs) {
    if (sha256Rcv021Text(run.canonical) !== run.hash) throw new Error("HASH_MISMATCH: run canonical");
    members.push({ authorityKind: "RUN_CREATED", authoritativeTimeMicros: parseSchedulerTimestamp(run.created_at), authorityIdentity: run.id, authorityCanonicalVersion: String(run.canonical_version), authorityCanonicalHash: run.hash });
    const runEvents = (await q(client, `SELECT event_id::text AS id, ${dbTime("event_at")} AS at, canonical_version, canonical, encode(canonical_hash,'hex') AS hash FROM public.research_run_lifecycle_events WHERE run_id=$1 AND event_at <= $2 ORDER BY event_at,event_id`, [run.id, evaluationAt])).rows ?? [];
    for (const event of runEvents) {
      if (sha256Rcv021Text(event.canonical) !== event.hash) throw new Error("HASH_MISMATCH: run event");
      members.push({ authorityKind: "RUN_LIFECYCLE_EVENT", authoritativeTimeMicros: parseSchedulerTimestamp(event.at), authorityIdentity: event.id, authorityCanonicalVersion: String(event.canonical_version), authorityCanonicalHash: event.hash });
    }
    const terminal = (await q(client, `SELECT resolution_id::text AS id, ${dbTime("terminal_at")} AS at, canonical_version, canonical, encode(canonical_hash,'hex') AS hash FROM public.research_run_terminal_resolutions WHERE run_id=$1 AND terminal_at <= $2`, [run.id, evaluationAt])).rows ?? [];
    for (const item of terminal) {
      if (sha256Rcv021Text(item.canonical) !== item.hash) throw new Error("HASH_MISMATCH: terminal resolution");
      members.push({ authorityKind: "RUN_TERMINAL_RESOLUTION", authoritativeTimeMicros: parseSchedulerTimestamp(item.at), authorityIdentity: item.id, authorityCanonicalVersion: String(item.canonical_version), authorityCanonicalHash: item.hash });
    }
    if (terminal.length === 0) {
      const state = runEvents.length === 0 ? "PLANNED" : "RUNNING";
      const running = runEvents[runEvents.length - 1];
      nonterminal.push({ runId: run.id, state, creationHash: run.hash, creationIdentity: run.id, runningEventIdentity: running?.id ?? null, runningEventHash: running?.hash ?? null });
    }
  }
  if (nonterminal.length > 1) throw new Error("NONTERMINAL_RUN_VIOLATION: multiple nonterminal Runs");
  return { members, nonterminal };
}

export async function createSchedulerRunNow(pool: SchedulerWriterPool, request: SchedulerRunNowRequest, hooks?: SchedulerWriterTestHooks): Promise<SchedulerRunNowResult> {
  const client = await pool.connect();
  try {
    await q(client, "BEGIN");
    const stream = (await q(client, "SELECT policy_id::text AS policy_id, operation_id::text AS operation_id FROM public.scheduler_policy_streams WHERE policy_id=$1 FOR UPDATE", [request.policyId])).rows?.[0];
    if (!stream || stream.operation_id !== request.operationId) throw new Error("IDENTITY_MISMATCH: policy stream");
    await q(client, "SELECT operation_id FROM public.research_operations WHERE operation_id=$1 FOR UPDATE", [request.operationId]);
    const operationBundle = await loadOperationBundle(client, request.operationId);
    const policyRows = await loadPolicyVersions(client, request.policyId);
    if (policyRows.length === 0) throw new Error("MISSING_DATA: policy versions");
    const policyInputs = policyRows.map((row) => ({ policyId: request.policyId, operationId: request.operationId, version: row.version, enabled: row.enabled, effectiveAtMicros: row.effectiveAtMicros, firstEligibilityAtMicros: row.firstEligibilityAtMicros, fixedIntervalMicros: row.fixedIntervalMicros }));
    for (const [index, row] of policyRows.entries()) {
      const encoded = canonicalizeSchedulerPolicyVersion(policyInputs[index]);
      sameAuthority(row.canonical, row.canonicalHash, encoded.canonical, encoded.hash);
    }
    const decisions = await loadDecisions(client, request.operationId, request.policyId);
    const chain = authenticateChain(decisions, request.operationId, request.policyId);
    failAt(hooks, "after-locks");
    const evaluationMicros = parseSchedulerTimestamp(request.evaluationAt);
    if (operationBundle.state === "CLOSED") throw new Error("LIFECYCLE_VIOLATION: Operation closed");
    const evaluation = evaluateScheduler({ evaluationAtMicros: evaluationMicros, operationState: "OPEN", policyVersions: policyInputs, consumedSlots: makeSchedulerConsumedSlotSet(chain.slots) });
    if (evaluation.kind !== "DUE_EVALUATION" || evaluation.decision !== "RUN_NOW") throw new Error("UNSUPPORTED_STATE: Wave 3 vertical slice requires RUN_NOW");
    const owner = selectSchedulerPolicyOwner(validateSchedulerPolicyHistory(policyInputs), evaluation.scheduledAtMicros);
    const slotIndex = evaluation.slotIndex;
    const existing = decisions.find((row) => row.slotIndex === slotIndex);
    const runId = deriveSchedulerRunId({ operationId: request.operationId, policyId: request.policyId, slotIndex });
    const bindingIdentity = `scheduler-run-now:${request.operationId}:${request.policyId}:${slotIndex}`;
    const runValue = { runId, operationId: request.operationId, strategyIdentity: request.strategyIdentity, strategyVersion: request.strategyVersion, providerIdentity: request.providerIdentity, adapterIdentity: request.adapterIdentity, adapterVersion: request.adapterVersion, executionParametersCanonical: request.executionParametersCanonical, runCreatedAt: canonicalTime(request.evaluationAt), deadlineAt: canonicalTime(request.deadlineAt), predecessorRunId: null } as ResearchRun;
    const runEncoded = canonicalizeRcv021Authority(runValue);
    const run: ResearchRun = { ...runValue, canonicalVersion: 1, canonical: runEncoded.canonical, canonicalHash: runEncoded.hash };
    if (existing) {
      if (existing.evaluationAt !== canonicalTime(request.evaluationAt) || existing.scheduledAt !== canonicalMicros(evaluation.scheduledAtMicros) || existing.policyVersion !== owner.version || existing.policyVersionCanonicalHash !== owner.canonicalHash || existing.decision !== "RUN_NOW" || existing.runNowBindingIdentity !== bindingIdentity || existing.runNowRunId !== runId) throw new Error("DUPLICATE_CONFLICT: divergent immutable authority");
      const existingRun = (await q(client, "SELECT canonical, encode(canonical_hash,'hex') AS canonical_hash FROM public.research_runs WHERE run_id=$1", [runId])).rows?.[0];
      if (!existingRun) throw new Error("MISSING_DATA: existing Run");
      sameAuthority(existingRun.canonical, existingRun.canonical_hash, run.canonical, run.canonicalHash);
      const existingManifest = (await q(client, `SELECT ${dbTime("evaluation_at")} AS evaluation_at, canonical, encode(canonical_hash,'hex') AS canonical_hash FROM public.scheduler_lifecycle_prefix_manifests WHERE manifest_id=$1`, [existing.manifestId])).rows?.[0];
      if (!existingManifest || existingManifest.evaluation_at !== canonicalTime(request.evaluationAt)) throw new Error("DUPLICATE_CONFLICT: divergent manifest authority");
      const existingBinding = (await q(client, "SELECT canonical, encode(canonical_hash,'hex') AS canonical_hash FROM public.scheduler_run_now_bindings WHERE operation_id=$1 AND policy_id=$2 AND slot_index=$3", [request.operationId, request.policyId, slotIndex])).rows?.[0];
      if (!existingBinding) throw new Error("MISSING_DATA: existing binding");
      const binding = canonicalizeSchedulerRunNowBinding({ operationId: request.operationId, policyId: request.policyId, slotIndex, runId });
      sameAuthority(existingBinding.canonical, existingBinding.canonical_hash, binding.canonical, binding.hash);
      await q(client, "COMMIT");
      return { status: "IDEMPOTENT", operationId: request.operationId, policyId: request.policyId, slotIndex, runId, manifestId: existing.manifestId, decisionHash: existing.canonicalHash, bindingHash: binding.hash };
    }
    const prefix = await loadPrefix(client, request.operationId, canonicalTime(request.evaluationAt));
    if (prefix.nonterminal.length > 0) throw new Error("NONTERMINAL_RUN_VIOLATION: RUN_NOW blocked by historical nonterminal Run");
    const manifestId = uuidFromDigest("factbase/scheduler-manifest/v1\0", `${request.operationId}:${request.policyId}:${slotIndex}:${evaluation.evaluationAtMicros}`);
    const manifest = canonicalizeSchedulerLifecyclePrefixManifest({ manifestId, operationId: request.operationId, policyId: request.policyId, slotIndex, evaluationAtMicros: evaluation.evaluationAtMicros, members: prefix.members });
    const predecessor: SchedulerDecisionIdentityInput | null = chain.tail === null ? null : { operationId: request.operationId, policyId: request.policyId, slotIndex: chain.tail.slotIndex };
    const predecessorHash = chain.tail === null ? null : chain.hashes.get(`${request.operationId}:${request.policyId}:${chain.tail.slotIndex}`)!;
    const decision = canonicalizeSchedulerDecision({ operationId: request.operationId, policyId: request.policyId, slotIndex, previousDecisionIdentity: predecessor, previousDecisionCanonicalHash: predecessorHash, policyVersion: owner.version, policyVersionCanonicalHash: owner.canonicalHash, scheduledAtMicros: evaluation.scheduledAtMicros, evaluationAtMicros: evaluation.evaluationAtMicros, decision: "RUN_NOW", reason: evaluation.reason, nextEligibleAtMicros: evaluation.nextEligibleAtMicros, operationManifestId: manifestId, operationManifestHash: manifest.hash, activeRunId: null, activeRunCreationIdentity: null, activeRunCreationHash: null, activeRunHistoricalState: null, activeRunRunningEventIdentity: null, activeRunRunningEventHash: null, runNowBindingIdentity: bindingIdentity, runNowRunId: runId });
    const binding = canonicalizeSchedulerRunNowBinding({ operationId: request.operationId, policyId: request.policyId, slotIndex, runId });
    if (chain.tail !== null && BigInt(slotIndex) <= BigInt(chain.tail.slotIndex)) throw new Error("RETROACTIVE_SLOT_VIOLATION: new slot is not after tail");
    await persistRcv021BundleWithinTransaction(client, { operations: [operationBundle.operation], subjects: [operationBundle.subject], triggers: [operationBundle.trigger], runs: [run] });
    failAt(hooks, "after-run");
    await q(client, `INSERT INTO public.scheduler_lifecycle_prefix_manifests (manifest_id,operation_id,policy_id,slot_index,evaluation_at,canonical_version,canonical,canonical_hash) VALUES ($1,$2,$3,$4,$5,1,$6,$7)`, [manifestId, request.operationId, request.policyId, slotIndex, canonicalTime(request.evaluationAt), manifest.canonical, Buffer.from(manifest.hash, "hex")]);
    failAt(hooks, "after-manifest");
    for (const member of manifest.value.members) {
      await q(client, `INSERT INTO public.scheduler_lifecycle_prefix_members (manifest_id,authority_kind,authoritative_time,authority_identity,authority_canonical_version,authority_canonical_hash) VALUES ($1,$2,$3,$4,$5,$6)`, [manifestId, member.authorityKind, formatSchedulerTimestamp(BigInt(member.authoritativeTimeMicros)), member.authorityIdentity, Number(member.authorityCanonicalVersion), Buffer.from(member.authorityCanonicalHash, "hex")]);
      failAt(hooks, "after-member");
    }
    await q(client, `INSERT INTO public.scheduler_decisions (operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,previous_decision_canonical_hash,active_run_id,active_run_creation_identity,active_run_creation_hash,active_run_historical_state,active_run_running_event_identity,active_run_running_event_hash,run_now_binding_identity,run_now_run_id,canonical_version,canonical,canonical_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,1,$25,$26)`, [request.operationId, request.policyId, slotIndex, owner.version, Buffer.from(owner.canonicalHash, "hex"), canonicalMicros(evaluation.scheduledAtMicros), canonicalMicros(evaluation.evaluationAtMicros), decision.value.decision, decision.value.reason, evaluation.nextEligibleAtMicros === null ? null : canonicalMicros(evaluation.nextEligibleAtMicros), manifestId, Buffer.from(manifest.hash, "hex"), predecessor?.operationId ?? null, predecessor?.policyId ?? null, predecessor === null ? null : predecessor.slotIndex, predecessorHash === null ? null : Buffer.from(predecessorHash, "hex"), null, null, null, null, null, null, bindingIdentity, runId, decision.canonical, Buffer.from(decision.hash, "hex")]);
    failAt(hooks, "after-decision");
    failAt(hooks, "before-binding");
    await q(client, `INSERT INTO public.scheduler_run_now_bindings (operation_id,policy_id,slot_index,run_id,canonical_version,canonical,canonical_hash) VALUES ($1,$2,$3,$4,1,$5,$6)`, [request.operationId, request.policyId, slotIndex, runId, binding.canonical, Buffer.from(binding.hash, "hex")]);
    failAt(hooks, "after-binding");
    await q(client, "COMMIT");
    return { status: "COMMITTED", operationId: request.operationId, policyId: request.policyId, slotIndex, runId, manifestId, decisionHash: decision.hash, bindingHash: binding.hash };
  } catch (error) {
    try { await q(client, "ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  } finally { client.release?.(); }
}
