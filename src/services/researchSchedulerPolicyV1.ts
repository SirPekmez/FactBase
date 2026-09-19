import { sha256Rcv021Text } from "./rcv021Canonical";
import { canonicalizeSchedulerPolicyVersion } from "./researchSchedulerCanonical";
import { formatSchedulerTimestamp, parseSchedulerTimestamp } from "./researchSchedulerTime";

export const RESEARCH_SCHEDULER_POLICY_V1_ID = "factbase-research-recheck-universal-24h" as const;
export const RESEARCH_SCHEDULER_POLICY_V1_VERSION = "1" as const;
export const RESEARCH_SCHEDULER_POLICY_V1_FIXED_INTERVAL_MICROS = 86_400_000_000n;

export interface SchedulerPolicyV1Client {
  query(text: string, values?: readonly unknown[]): Promise<{ rows?: readonly Record<string, any>[]; rowCount?: number | null }>;
  release?: () => void;
}

export interface SchedulerPolicyV1Pool {
  connect(): Promise<SchedulerPolicyV1Client>;
}

export interface CreateResearchSchedulerPolicyV1Request {
  readonly operationId: string;
  /** The immutable UUID identity of this Operation-bound Scheduler policy stream. */
  readonly policyId: string;
}

export interface ResearchSchedulerPolicyV1Authority {
  readonly semanticPolicyId: typeof RESEARCH_SCHEDULER_POLICY_V1_ID;
  readonly policyId: string;
  readonly operationId: string;
  readonly version: typeof RESEARCH_SCHEDULER_POLICY_V1_VERSION;
  readonly enabled: true;
  readonly authorizationAt: string;
  readonly effectiveAt: string;
  readonly firstEligibilityAt: string;
  readonly fixedIntervalMicros: string;
  readonly canonicalVersion: "1";
  readonly canonical: string;
  readonly canonicalHash: string;
}

const q = async (client: SchedulerPolicyV1Client, text: string, values: readonly unknown[] = []) => client.query(text, values);
const dbTime = (column: string): string => `(to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(${column} AT TIME ZONE 'UTC', 'HH24:MI:SS.US') || 'Z')`;

function fail(message: string): never {
  throw new Error(`POLICY_V1_AUTHORITY_ERROR: ${message}`);
}

export function buildResearchSchedulerPolicyV1Authority(input: {
  readonly operationId: string;
  readonly policyId: string;
  readonly authorizationAt: string;
}): ResearchSchedulerPolicyV1Authority {
  const authorizationMicros = parseSchedulerTimestamp(input.authorizationAt, "authorizationAt");
  const authorizationAt = formatSchedulerTimestamp(authorizationMicros);
  const encoded = canonicalizeSchedulerPolicyVersion({
    policyId: input.policyId,
    operationId: input.operationId,
    version: RESEARCH_SCHEDULER_POLICY_V1_VERSION,
    enabled: true,
    effectiveAtMicros: authorizationMicros,
    firstEligibilityAtMicros: authorizationMicros,
    fixedIntervalMicros: RESEARCH_SCHEDULER_POLICY_V1_FIXED_INTERVAL_MICROS,
  });
  return Object.freeze({
    semanticPolicyId: RESEARCH_SCHEDULER_POLICY_V1_ID,
    policyId: input.policyId,
    operationId: input.operationId,
    version: RESEARCH_SCHEDULER_POLICY_V1_VERSION,
    enabled: true,
    authorizationAt,
    effectiveAt: authorizationAt,
    firstEligibilityAt: authorizationAt,
    fixedIntervalMicros: RESEARCH_SCHEDULER_POLICY_V1_FIXED_INTERVAL_MICROS.toString(10),
    canonicalVersion: "1",
    canonical: encoded.canonical,
    canonicalHash: encoded.hash,
  });
}

function authorityFromRow(row: Record<string, any>, request: CreateResearchSchedulerPolicyV1Request): ResearchSchedulerPolicyV1Authority {
  if (String(row.operation_id) !== request.operationId) fail("Operation identity mismatch");
  if (typeof row.canonical !== "string" || typeof row.canonical_hash !== "string") fail("Operation canonical authority is malformed");
  if (sha256Rcv021Text(row.canonical) !== row.canonical_hash) fail("Operation canonical hash mismatch");
  let persistedOperation: Record<string, any>;
  try { persistedOperation = JSON.parse(row.canonical) as Record<string, any>; } catch { fail("Operation canonical authority is not JSON"); }
  if (persistedOperation.operationId !== request.operationId) fail("Operation canonical identity mismatch");
  return buildResearchSchedulerPolicyV1Authority({ operationId: request.operationId, policyId: request.policyId, authorizationAt: String(row.operation_created_at) });
}

function assertExistingPolicy(row: Record<string, any>, authority: ResearchSchedulerPolicyV1Authority): void {
  const same = String(row.policy_id) === authority.policyId &&
    String(row.operation_id) === authority.operationId &&
    String(row.version) === authority.version &&
    Boolean(row.enabled) === authority.enabled &&
    String(row.effective_at) === authority.effectiveAt &&
    String(row.first_eligibility_at) === authority.firstEligibilityAt &&
    String(row.fixed_interval_micros) === authority.fixedIntervalMicros &&
    String(row.canonical_version) === authority.canonicalVersion &&
    String(row.canonical) === authority.canonical &&
    String(row.canonical_hash) === authority.canonicalHash;
  if (!same) fail("existing PolicyVersion authority diverges");
}

/**
 * Creates or authenticates the immutable first PolicyVersion for one existing
 * RCV-021 Operation. The function owns only this short transaction; the
 * Scheduler RUN_NOW transaction remains owned by the Wave-3 Writer.
 */
export async function createResearchSchedulerPolicyV1(
  pool: SchedulerPolicyV1Pool,
  request: CreateResearchSchedulerPolicyV1Request,
): Promise<ResearchSchedulerPolicyV1Authority> {
  const client = await pool.connect();
  try {
    await q(client, "BEGIN");
    const operation = (await q(client, `SELECT operation_id::text AS operation_id,
        ${dbTime("operation_created_at")} AS operation_created_at,
        canonical, encode(canonical_hash,'hex') AS canonical_hash
      FROM public.research_operations WHERE operation_id=$1 FOR UPDATE`, [request.operationId])).rows?.[0];
    if (!operation) fail("authorized Operation is missing");
    const authority = authorityFromRow(operation!, request);
    const stream = (await q(client, `SELECT policy_id::text AS policy_id, operation_id::text AS operation_id
      FROM public.scheduler_policy_streams WHERE operation_id=$1 FOR UPDATE`, [request.operationId])).rows?.[0];
    if (stream && (stream.policy_id !== request.policyId || stream.operation_id !== request.operationId)) fail("Operation already has a different policy stream");
    if (!stream) {
      await q(client, "INSERT INTO public.scheduler_policy_streams(policy_id, operation_id) VALUES($1,$2)", [request.policyId, request.operationId]);
    }
    const existing = (await q(client, `SELECT p.policy_id::text AS policy_id, s.operation_id::text AS operation_id,
        p.version::text AS version, p.enabled, ${dbTime("p.effective_at")} AS effective_at,
        ${dbTime("p.first_eligibility_at")} AS first_eligibility_at,
        p.fixed_interval_micros::text AS fixed_interval_micros,
        p.canonical_version::text AS canonical_version, p.canonical,
        encode(p.canonical_hash,'hex') AS canonical_hash
      FROM public.scheduler_policy_versions p
      JOIN public.scheduler_policy_streams s ON s.policy_id=p.policy_id
      WHERE p.policy_id=$1 AND p.version=1`, [request.policyId])).rows?.[0];
    if (existing) {
      assertExistingPolicy(existing, authority);
    } else {
      await q(client, `INSERT INTO public.scheduler_policy_versions
        (policy_id, version, enabled, effective_at, first_eligibility_at,
         fixed_interval_micros, canonical_version, canonical, canonical_hash)
        VALUES ($1,1,true,$2,$2,$3,1,$4,$5)`, [
        authority.policyId,
        authority.effectiveAt,
        authority.fixedIntervalMicros,
        authority.canonical,
        Buffer.from(authority.canonicalHash, "hex"),
      ]);
    }
    await q(client, "COMMIT");
    return authority;
  } catch (error) {
    try { await q(client, "ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  } finally {
    client.release?.();
  }
}
