import {
  ContradictionFindingV1,
  RCV018AnalysisV1,
  Sha256HexV1,
  validateSha256HexV1,
} from "../contracts/rcv018EvidenceContradictionContractV1";
import { assertRcv018TextHash, canonicalizeRcv018 } from "./rcv018Canonical";
import {
  Rcv018AnalysisBuilderInputV1,
  Rcv018AnalysisBuilderResultV1,
  buildRcv018Analysis,
} from "./rcv018AnalysisBuilder";

export type Rcv018WriteVerificationFailureCode =
  | "malformed_builder_result" | "canonical_mismatch" | "hash_mismatch"
  | "version_mismatch" | "c1_family_mismatch" | "historical_prerequisite_missing"
  | "historical_prerequisite_mismatch" | "invalid_historical_binding"
  | "value_domain_mismatch" | "comparison_domain_mismatch"
  | "assertion_membership_mismatch" | "pair_completeness_mismatch"
  | "finding_set_mismatch" | "existing_finding_collision"
  | "duplicate_write_projection" | "unsupported_semantic_state";

export class Rcv018WriteVerificationError extends Error {
  constructor(
    public readonly code: Rcv018WriteVerificationFailureCode,
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "Rcv018WriteVerificationError";
  }
}

export interface Rcv018ExistingFindingInput {
  readonly value: ContradictionFindingV1;
  readonly canonical: string;
  readonly hash: Sha256HexV1;
}

export interface Rcv018WriteVerificationInput {
  readonly builderInput: Rcv018AnalysisBuilderInputV1;
  readonly builderResult: Rcv018AnalysisBuilderResultV1;
  readonly existingFindings?: readonly Rcv018ExistingFindingInput[];
}

export interface Rcv018AuthenticatedWriteProjection {
  readonly analysis: RCV018AnalysisV1;
  readonly analysisCanonical: string;
  readonly analysisHash: Sha256HexV1;
  readonly assertions: RCV018AnalysisV1["assertions"];
  readonly valueDomains: RCV018AnalysisV1["valueDomains"];
  readonly comparisonDomains: RCV018AnalysisV1["comparisonDomains"];
  readonly findingsToInsert: readonly ContradictionFindingV1[];
  readonly findingsToInsertAuthenticated: readonly Rcv018ExistingFindingInput[];
  readonly existingFindings: readonly ContradictionFindingV1[];
  readonly findingHashes: readonly Sha256HexV1[];
}

type Obj = Record<string, unknown>;
const fail = (code: Rcv018WriteVerificationFailureCode, path: string, message: string): never => {
  throw new Rcv018WriteVerificationError(code, path, message);
};
const plain = (value: unknown, path: string): Obj => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("malformed_builder_result", path, "expected plain object");
  return value as Obj;
};
const exact = (value: unknown, keys: readonly string[], path: string): Obj => {
  const item = plain(value, path); const own = Reflect.ownKeys(item);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) fail("malformed_builder_result", path, "unexpected or missing field");
  return item;
};
const list = (value: unknown, path: string): unknown[] => Array.isArray(value) ? value : fail("malformed_builder_result", path, "expected array");
const text = (value: unknown, path: string): string => typeof value === "string" ? value : fail("malformed_builder_result", path, "expected string");
const stable = (value: unknown): string => canonicalizeRcv018(value).canonical;
const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

function authenticatedFinding(value: unknown, index: number): { finding: ContradictionFindingV1; hash: Sha256HexV1 } {
  const path = `existingFindings[${index}]`; const item = exact(value, ["value", "canonical", "hash"], path);
  const canonical = text(item.canonical, `${path}.canonical`); const hash = validateSha256HexV1(item.hash, `${path}.hash`);
  try { assertRcv018TextHash(canonical, hash, `${path}.hash`); } catch { fail("hash_mismatch", path, "Canonical/hash mismatch"); }
  const finding = item.value as ContradictionFindingV1;
  const expected: { canonical: string; hash: Sha256HexV1 } = (() => {
    try { return canonicalizeRcv018(finding); }
    catch { return fail("malformed_builder_result", path, "malformed finding value"); }
  })();
  if (expected.canonical !== canonical || expected.hash !== hash) fail("canonical_mismatch", path, "finding Canonical/hash does not match value");
  return { finding, hash };
}

function validateResult(result: unknown): Rcv018AnalysisBuilderResultV1 {
  const item = exact(result, ["analysis", "canonical", "hash", "findings", "pairEvaluations"], "builderResult");
  const analysis = exact(item.analysis, ["analysisId", "assertions", "valueDomains", "comparisonDomains", "contractBinding", "algorithmBinding", "contradictionFindingHashes"], "builderResult.analysis");
  const canonical = text(item.canonical, "builderResult.canonical"); const hash = validateSha256HexV1(item.hash, "builderResult.hash");
  try { assertRcv018TextHash(canonical, hash, "builderResult.hash"); } catch { fail("hash_mismatch", "builderResult", "analysis Canonical/hash mismatch"); }
  list(item.findings, "builderResult.findings"); list(item.pairEvaluations, "builderResult.pairEvaluations");
  return item as unknown as Rcv018AnalysisBuilderResultV1;
}

function findingHash(finding: ContradictionFindingV1): Sha256HexV1 { return canonicalizeRcv018(finding).hash; }

/** Pure write authentication. It performs no I/O and returns only an authenticated projection. */
export function verifyRcv018Write(input: unknown): Rcv018AuthenticatedWriteProjection {
  const root = exact(input, ["builderInput", "builderResult", "existingFindings"], "input");
  const result: Rcv018AnalysisBuilderResultV1 = (() => {
    try { return validateResult(root.builderResult); }
    catch (error) {
      if (error instanceof Rcv018WriteVerificationError) throw error;
      return fail("malformed_builder_result", "builderResult", error instanceof Error ? error.message : "invalid Builder result");
    }
  })();
  const expected: Rcv018AnalysisBuilderResultV1 = (() => {
    try { return buildRcv018Analysis(root.builderInput); }
    catch (error) { return fail("unsupported_semantic_state", "builderInput", error instanceof Error ? error.message : "builder input rejected"); }
  })();
  if (!same(result.analysis, expected.analysis) || result.canonical !== expected.canonical) fail("canonical_mismatch", "builderResult.analysis", "analysis differs from recomputed projection");
  if (result.hash !== expected.hash) fail("hash_mismatch", "builderResult.hash", "analysis hash differs from recomputed projection");
  if (!same(result.findings, expected.findings)) fail("finding_set_mismatch", "builderResult.findings", "finding set differs from recomputed projection");
  if (!same(result.pairEvaluations, expected.pairEvaluations) || result.pairEvaluations.length !== expected.pairEvaluations.length) fail("pair_completeness_mismatch", "builderResult.pairEvaluations", "pair replay differs from recomputed projection");

  const expectedHashes = expected.findings.map(findingHash).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const resultHashes = result.analysis.contradictionFindingHashes.slice().sort();
  if (!same(resultHashes, expectedHashes)) fail("finding_set_mismatch", "builderResult.analysis.contradictionFindingHashes", "analysis finding membership differs");

  const existing = list(root.existingFindings ?? [], "existingFindings").map((value, index) => authenticatedFinding(value, index));
  const existingByHash = new Map<string, ContradictionFindingV1>();
  for (const entry of existing) {
    if (existingByHash.has(entry.hash)) fail("duplicate_write_projection", "existingFindings", "duplicate finding hash");
    existingByHash.set(entry.hash, entry.finding);
  }
  const findingsToInsert: ContradictionFindingV1[] = []; const existingFindings: ContradictionFindingV1[] = [];
  const findingsToInsertAuthenticated: Rcv018ExistingFindingInput[] = [];
  for (const finding of expected.findings) {
    const hash = findingHash(finding); const found = existingByHash.get(hash);
    if (found) {
      if (!same(found, finding)) fail("existing_finding_collision", "existingFindings", "existing finding does not match expected semantic projection");
      existingFindings.push(found);
    } else { findingsToInsert.push(finding); const encoded = canonicalizeRcv018(finding); findingsToInsertAuthenticated.push(Object.freeze({ value: finding, canonical: encoded.canonical, hash: encoded.hash })); }
  }
  for (const hash of existingByHash.keys()) if (!expectedHashes.some((expectedHash) => expectedHash === hash)) fail("finding_set_mismatch", "existingFindings", "unexpected existing finding");
  return Object.freeze({
    analysis: result.analysis,
    analysisCanonical: result.canonical,
    analysisHash: result.hash,
    assertions: result.analysis.assertions,
    valueDomains: result.analysis.valueDomains,
    comparisonDomains: result.analysis.comparisonDomains,
    findingsToInsert: Object.freeze(findingsToInsert),
    findingsToInsertAuthenticated: Object.freeze(findingsToInsertAuthenticated),
    existingFindings: Object.freeze(existingFindings),
    findingHashes: Object.freeze(expectedHashes),
  });
}

export const authenticateRcv018Write = verifyRcv018Write;
