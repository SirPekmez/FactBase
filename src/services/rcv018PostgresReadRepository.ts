import type { Pool, PoolClient } from "pg";
import { validateLowercaseUuidV1 } from "../contracts/rcv018EvidenceContradictionContractV1";

export class Rcv018ReadRepositoryError extends Error { constructor(public readonly code: "invalid_analysis_id" | "database_error", message: string, cause?: unknown) { super(message); this.name = "Rcv018ReadRepositoryError"; this.cause = cause; } readonly cause?: unknown; }
export interface Rcv018ReadBundle { readonly analysis: Record<string, unknown> | null; readonly assertions: readonly Record<string, unknown>[]; readonly assertionContexts: readonly Record<string, unknown>[]; readonly evidenceBasis: readonly Record<string, unknown>[]; readonly historicalBindings: readonly Record<string, unknown>[]; readonly statementPrerequisites: readonly Record<string, unknown>[]; readonly valueDomains: readonly Record<string, unknown>[]; readonly valueDomainValues: readonly Record<string, unknown>[]; readonly comparisonDomains: readonly Record<string, unknown>[]; readonly comparisonKeys: readonly Record<string, unknown>[]; readonly incompatibilityPairs: readonly Record<string, unknown>[]; readonly findings: readonly Record<string, unknown>[]; readonly analysisAssertions: readonly Record<string, unknown>[]; readonly analysisValueDomains: readonly Record<string, unknown>[]; readonly analysisComparisonDomains: readonly Record<string, unknown>[]; readonly analysisFindings: readonly Record<string, unknown>[]; }
type Queryable = Pick<Pool, "connect">;
const fields = (rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] => Object.freeze(rows.map((r) => Object.freeze({ ...r })));
const BIGINT_FIELDS = new Set(["contract_version", "algorithm_version", "value_domain_version", "comparison_domain_version", "ordinal"]);
function normalizeBigInt(value: unknown, field: string): number {
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Rcv018ReadRepositoryError("database_error", `invalid BIGINT value for ${field}`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Rcv018ReadRepositoryError("database_error", `unsafe BIGINT value for ${field}`);
  return number;
}
export function normalizeRcv018BigIntRows(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map((row) => { const copy: Record<string, unknown> = { ...row }; for (const [key, value] of Object.entries(copy)) if (BIGINT_FIELDS.has(key)) copy[key] = normalizeBigInt(value, key); return copy; });
}

export async function readRcv018Analysis(pool: Queryable, rawId: unknown): Promise<Rcv018ReadBundle | null> {
  let analysisId: string; try { analysisId = validateLowercaseUuidV1(rawId, "analysisId"); } catch { throw new Rcv018ReadRepositoryError("invalid_analysis_id", "analysisId must be lowercase UUID"); }
  let client: PoolClient | undefined;
  try {
    client = await pool.connect(); await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const parent = await client.query("SELECT * FROM public.rcv018_analyses WHERE analysis_id=$1", [analysisId]);
    if (parent.rowCount !== 1) { await client.query("COMMIT"); return null; }
    const q = async (sql: string, params: unknown[] = [analysisId]) => (await client!.query(sql, params)).rows as Record<string, unknown>[];
    const analysisAssertions = await q("SELECT * FROM public.rcv018_analysis_assertions WHERE analysis_id=$1 ORDER BY ordinal");
    const analysisValues = await q("SELECT * FROM public.rcv018_analysis_value_domains WHERE analysis_id=$1 ORDER BY ordinal");
    const analysisComparisons = await q("SELECT * FROM public.rcv018_analysis_comparison_domains WHERE analysis_id=$1 ORDER BY ordinal");
    const analysisFindings = await q("SELECT * FROM public.rcv018_analysis_findings WHERE analysis_id=$1 ORDER BY ordinal");
    const assertionIds = analysisAssertions.map((r) => r.assertion_id); const valueKeys = analysisValues.map((r) => [r.value_domain_id, r.value_domain_version]); const comparisonKeys = analysisComparisons.map((r) => [r.comparison_domain_id, r.comparison_domain_version]); const findingHashes = analysisFindings.map((r) => r.finding_hash);
    const assertions = assertionIds.length ? await q("SELECT * FROM public.rcv018_evidence_assertions WHERE assertion_id = ANY($1::uuid[])", [assertionIds]) : [];
    const assertionContexts = assertionIds.length ? await q("SELECT * FROM public.rcv018_assertion_context WHERE assertion_id = ANY($1::uuid[]) ORDER BY assertion_id, ordinal", [assertionIds]) : [];
    const evidenceBasis = assertionIds.length ? await q("SELECT * FROM public.rcv018_assertion_evidence_basis WHERE assertion_id = ANY($1::uuid[]) ORDER BY assertion_id, ordinal", [assertionIds]) : [];
    const historicalBindings = assertionIds.length ? await q("SELECT * FROM public.rcv018_assertion_historical_bindings WHERE assertion_id = ANY($1::uuid[]) ORDER BY assertion_id, ordinal", [assertionIds]) : [];
    const statementIds = historicalBindings.filter((r) => r.kind === "STATEMENT" && r.statement_kind === "EvidenceArtifactBinding").map((r) => r.statement_id);
    const statementPrerequisites = statementIds.length ? await q("SELECT * FROM public.evidence_artifact_bindings WHERE id = ANY($1::uuid[])", [statementIds]) : [];
    const valueDomains = valueKeys.length ? await q("SELECT * FROM public.rcv018_value_domains WHERE (value_domain_id,value_domain_version) IN (SELECT * FROM unnest($1::uuid[],$2::bigint[]))", [valueKeys.map((k) => k[0]), valueKeys.map((k) => k[1])]) : [];
    const valueDomainValues = valueKeys.length ? await q("SELECT * FROM public.rcv018_value_domain_values WHERE (value_domain_id,value_domain_version) IN (SELECT * FROM unnest($1::uuid[],$2::bigint[])) ORDER BY value_domain_id,value_domain_version,ordinal", [valueKeys.map((k) => k[0]), valueKeys.map((k) => k[1])]) : [];
    const comparisonDomains = comparisonKeys.length ? await q("SELECT * FROM public.rcv018_comparison_domains WHERE (comparison_domain_id,comparison_domain_version) IN (SELECT * FROM unnest($1::uuid[],$2::bigint[]))", [comparisonKeys.map((k) => k[0]), comparisonKeys.map((k) => k[1])]) : [];
    const comparisonDomainKeys = comparisonKeys.length ? await q("SELECT * FROM public.rcv018_comparison_domain_keys WHERE (comparison_domain_id,comparison_domain_version) IN (SELECT * FROM unnest($1::uuid[],$2::bigint[])) ORDER BY comparison_domain_id,comparison_domain_version,ordinal", [comparisonKeys.map((k) => k[0]), comparisonKeys.map((k) => k[1])]) : [];
    const incompatibilityPairs = comparisonKeys.length ? await q("SELECT * FROM public.rcv018_incompatibility_pairs WHERE (comparison_domain_id,comparison_domain_version) IN (SELECT * FROM unnest($1::uuid[],$2::bigint[])) ORDER BY comparison_domain_id,comparison_domain_version,ordinal", [comparisonKeys.map((k) => k[0]), comparisonKeys.map((k) => k[1])]) : [];
    const findings = findingHashes.length ? await q("SELECT * FROM public.rcv018_contradiction_findings WHERE finding_hash = ANY($1::text[])", [findingHashes]) : [];
    await client.query("COMMIT");
    const normalized = [parent.rows[0], ...assertions, ...assertionContexts, ...evidenceBasis, ...historicalBindings, ...statementPrerequisites, ...valueDomains, ...valueDomainValues, ...comparisonDomains, ...comparisonDomainKeys, ...incompatibilityPairs, ...findings, ...analysisAssertions, ...analysisValues, ...analysisComparisons, ...analysisFindings];
    normalizeRcv018BigIntRows(normalized);
    const n = (rows: readonly Record<string, unknown>[]) => fields(normalizeRcv018BigIntRows(rows));
    return Object.freeze({ analysis: Object.freeze(normalizeRcv018BigIntRows([parent.rows[0]])[0]), assertions: n(assertions), assertionContexts: n(assertionContexts), evidenceBasis: n(evidenceBasis), historicalBindings: n(historicalBindings), statementPrerequisites: n(statementPrerequisites), valueDomains: n(valueDomains), valueDomainValues: n(valueDomainValues), comparisonDomains: n(comparisonDomains), comparisonKeys: n(comparisonDomainKeys), incompatibilityPairs: n(incompatibilityPairs), findings: n(findings), analysisAssertions: n(analysisAssertions), analysisValueDomains: n(analysisValues), analysisComparisonDomains: n(analysisComparisons), analysisFindings: n(analysisFindings) });
  } catch (error) { if (client) await client.query("ROLLBACK").catch(() => undefined); if (error instanceof Rcv018ReadRepositoryError) throw error; throw new Rcv018ReadRepositoryError("database_error", "RCV-018 read failed", error); }
  finally { client?.release(); }
}

export class Rcv018PostgresReadRepository { constructor(private readonly pool: Queryable) {} readAnalysis(id: unknown) { return readRcv018Analysis(this.pool, id); } getAnalysis(id: unknown) { return this.readAnalysis(id); } }
