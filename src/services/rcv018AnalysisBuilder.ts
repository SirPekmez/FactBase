import {
  AlgorithmBindingV1,
  AnalysisAssertionBindingV1,
  AnalysisComparisonDomainBindingV1,
  AnalysisValueDomainBindingV1,
  ComparisonDomainV1,
  ContradictionFindingV1,
  EvidenceAssertionV1,
  HistoricalBindingV1,
  RCV018_RULE_FAMILY,
  RCV018_STATEMENT_KINDS,
  RCV018AnalysisV1,
  Rcv018ValidationError,
  Sha256HexV1,
  ValueDomainV1,
  validateAlgorithmBindingV1,
  validateAssertionContextEntryV1,
  validateContractBindingV1,
  validateHistoricalBindingV1,
  validateLowercaseUuidV1,
  validateSha256HexV1,
  validateStatementRefV1,
  validateTokenV1,
  validateValueDomainV1,
  validateVersionV1,
} from "../contracts/rcv018EvidenceContradictionContractV1";
import { assertRcv018TextHash, canonicalizeRcv018 } from "./rcv018Canonical";
import { freezeRcv016 } from "./rcv016Validation";

export type Rcv018BuilderFailureCode =
  | "malformed_input" | "duplicate_assertion_membership" | "invalid_statement_identity"
  | "missing_historical_prerequisite" | "invalid_historical_binding" | "invalid_assertion_context"
  | "missing_value_domain" | "value_domain_version_mismatch" | "invalid_comparison_domain"
  | "comparison_domain_version_mismatch" | "unsupported_rule_family" | "invalid_incompatibility_pair"
  | "invalid_ordinal" | "incomplete_analysis_input" | "integrity_failure";

export class Rcv018BuilderError extends Error {
  constructor(public readonly code: Rcv018BuilderFailureCode, public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "Rcv018BuilderError";
  }
}

export interface Rcv018Authenticated<T> { readonly value: T; readonly canonical: string; readonly hash: Sha256HexV1 }
export interface Rcv018AssertionInputV1 extends Rcv018Authenticated<EvidenceAssertionV1> {}
export interface Rcv018ValueDomainInputV1 extends Rcv018Authenticated<ValueDomainV1> {}
export interface Rcv018ComparisonDomainInputV1 extends Rcv018Authenticated<ComparisonDomainV1> {}
export interface Rcv018AnalysisBuilderInputV1 {
  readonly analysisId: string;
  readonly assertions: readonly Rcv018AssertionInputV1[];
  readonly valueDomains: readonly Rcv018ValueDomainInputV1[];
  readonly comparisonDomains: readonly Rcv018ComparisonDomainInputV1[];
  readonly contractBinding: unknown;
  readonly algorithmBinding: unknown;
}

export type Rcv018PairOutcome = "COMPARABLE" | "NOT_COMPARABLE" | "CONTRADICTION";
export interface Rcv018PairEvaluationV1 {
  readonly assertionAId: string;
  readonly assertionBId: string;
  readonly outcome: Rcv018PairOutcome;
}
export interface Rcv018AnalysisBuilderResultV1 {
  readonly analysis: RCV018AnalysisV1;
  readonly canonical: string;
  readonly hash: Sha256HexV1;
  readonly findings: readonly ContradictionFindingV1[];
  readonly pairEvaluations: readonly Rcv018PairEvaluationV1[];
}

type Obj = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ascii = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const error = (code: Rcv018BuilderFailureCode, path: string, message: string): never => { throw new Rcv018BuilderError(code, path, message); };
function required<T>(value: T | undefined, code: Rcv018BuilderFailureCode, path: string, message: string): T { if (value === undefined) error(code, path, message); return value as T; }
const plain = (value: unknown, path: string): Obj => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) error("malformed_input", path, "expected plain object");
  return value as Obj;
};
const exact = (value: unknown, keys: readonly string[], path: string): Obj => {
  const object = plain(value, path); const own = Reflect.ownKeys(object);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) error("malformed_input", path, "unexpected or missing field");
  return object;
};
const list = (value: unknown, path: string): unknown[] => Array.isArray(value) ? value : error("malformed_input", path, "expected array");
const text = (value: unknown, path: string): string => typeof value === "string" ? value : error("malformed_input", path, "expected string");
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const freeze = <T>(value: T): Readonly<T> => freezeRcv016(value);

function authenticated<T>(value: unknown, path: string): Rcv018Authenticated<T> {
  const item = exact(value, ["value", "canonical", "hash"], path);
  const canonical = text(item.canonical, `${path}.canonical`);
  const hash = validateSha256HexV1(item.hash, `${path}.hash`);
  try { assertRcv018TextHash(canonical, hash, `${path}.hash`); } catch { error("integrity_failure", path, "Canonical/hash mismatch"); }
  return { value: item.value as T, canonical, hash };
}

function context(value: unknown, path: string): readonly Obj[] {
  try { return list(value, path).map((entry, i) => validateAssertionContextEntryV1(entry, `${path}[${i}]`) as unknown as Obj); }
  catch (e) { if (e instanceof Rcv018ValidationError) error("invalid_assertion_context", path, e.message); throw e; }
}

function statementIdentity(value: unknown, path: string): void {
  try { validateStatementRefV1(value, path); } catch (e) { if (e instanceof Rcv018ValidationError) error("invalid_statement_identity", path, e.message); throw e; }
}

function historical(value: unknown, path: string): readonly HistoricalBindingV1[] {
  try { return list(value, path).map((entry, i) => validateHistoricalBindingV1(entry, `${path}[${i}]`)); }
  catch (e) { if (e instanceof Rcv018ValidationError) error("invalid_historical_binding", path, e.message); throw e; }
}

function validateAssertion(input: Rcv018AssertionInputV1, index: number): { assertion: EvidenceAssertionV1; hash: Sha256HexV1 } {
  const path = `assertions[${index}]`; const auth = authenticated<EvidenceAssertionV1>(input, path);
  const item = exact(auth.value, ["assertionId", "subjectId", "propertyId", "comparisonDomainId", "comparisonDomainVersion", "comparisonDomainHash", "valueDomainId", "valueDomainVersion", "valueDomainHash", "value", "comparisonContext", "evidenceBasis", "historicalBindings"], `${path}.value`);
  const assertion: EvidenceAssertionV1 = freeze({
    assertionId: validateLowercaseUuidV1(item.assertionId, `${path}.assertionId`), subjectId: validateLowercaseUuidV1(item.subjectId, `${path}.subjectId`), propertyId: validateLowercaseUuidV1(item.propertyId, `${path}.propertyId`),
    comparisonDomainId: validateLowercaseUuidV1(item.comparisonDomainId, `${path}.comparisonDomainId`), comparisonDomainVersion: validateVersionV1(item.comparisonDomainVersion, `${path}.comparisonDomainVersion`), comparisonDomainHash: validateSha256HexV1(item.comparisonDomainHash, `${path}.comparisonDomainHash`),
    valueDomainId: validateLowercaseUuidV1(item.valueDomainId, `${path}.valueDomainId`), valueDomainVersion: validateVersionV1(item.valueDomainVersion, `${path}.valueDomainVersion`), valueDomainHash: validateSha256HexV1(item.valueDomainHash, `${path}.valueDomainHash`),
    value: validateTokenV1(item.value, `${path}.value`), comparisonContext: context(item.comparisonContext, `${path}.comparisonContext`) as EvidenceAssertionV1["comparisonContext"],
    evidenceBasis: list(item.evidenceBasis, `${path}.evidenceBasis`).map((entry, i) => { const b = exact(entry, ["evidenceRelationId", "evidenceId", "artifactVersionId", "statementKind", "statementId"], `${path}.evidenceBasis[${i}]`); const ref = validateStatementRefV1({ statementKind: b.statementKind, statementId: b.statementId }, `${path}.evidenceBasis[${i}]`); return freeze({ evidenceRelationId: validateLowercaseUuidV1(b.evidenceRelationId, `${path}.evidenceBasis[${i}].evidenceRelationId`), evidenceId: validateLowercaseUuidV1(b.evidenceId, `${path}.evidenceBasis[${i}].evidenceId`), artifactVersionId: validateLowercaseUuidV1(b.artifactVersionId, `${path}.evidenceBasis[${i}].artifactVersionId`), statementKind: ref.statementKind, statementId: ref.statementId }); }),
    historicalBindings: historical(item.historicalBindings, `${path}.historicalBindings`),
  });
  if (assertion.evidenceBasis.length === 0 || assertion.historicalBindings.length === 0) error("incomplete_analysis_input", path, "evidence basis and historical bindings are non-empty");
  const evidenceKeys = assertion.evidenceBasis.map((entry) => [entry.evidenceRelationId, entry.evidenceId, entry.artifactVersionId, entry.statementKind, entry.statementId].join("\0"));
  uniqueAscending(evidenceKeys, `${path}.evidenceBasis`);
  const bindingKeys = assertion.historicalBindings.map((entry) => {
    if (entry.kind === "CLAIM_VERSION") return [entry.kind, entry.claimVersionId].join("\0");
    if (entry.kind === "STATEMENT") return [entry.kind, entry.statementKind, entry.statementId].join("\0");
    if (entry.kind === "ARTIFACT_VERSION") return [entry.kind, entry.artifactVersionId].join("\0");
    if (entry.kind === "RCV016_SNAPSHOT") return [entry.kind, entry.snapshotId, entry.snapshotHash].join("\0");
    return [entry.kind, entry.analysisId, entry.analysisHash].join("\0");
  });
  uniqueAscending(bindingKeys, `${path}.historicalBindings`);
  const expected = canonicalizeRcv018(assertion);
  if (expected.canonical !== auth.canonical || expected.hash !== auth.hash) error("integrity_failure", path, "assertion Canonical/hash does not match semantic value");
  return { assertion, hash: auth.hash };
}

function validateComparison(input: Rcv018ComparisonDomainInputV1, index: number): { domain: ComparisonDomainV1; hash: Sha256HexV1 } {
  const path = `comparisonDomains[${index}]`; const auth = authenticated<ComparisonDomainV1>(input, path); const item = exact(auth.value, ["comparisonDomainId", "comparisonDomainVersion", "propertyId", "valueDomainId", "valueDomainVersion", "valueDomainHash", "comparisonKeySchema", "ruleFamily", "incompatibilityPairs"], `${path}.value`);
  if (item.ruleFamily !== RCV018_RULE_FAMILY) error("unsupported_rule_family", `${path}.ruleFamily`, "unsupported rule family");
  const schema = list(item.comparisonKeySchema, `${path}.comparisonKeySchema`).map((entry, i) => { const d = exact(entry, ["key", "type"], `${path}.comparisonKeySchema[${i}]`); const key = validateTokenV1(d.key, `${path}.comparisonKeySchema[${i}].key`); if (d.type !== "UUID" && d.type !== "TOKEN") error("invalid_comparison_domain", `${path}.comparisonKeySchema[${i}].type`, "unsupported context type"); return freeze({ key, type: d.type as "UUID" | "TOKEN" }); });
  uniqueAscending(schema.map((d) => d.key), `${path}.comparisonKeySchema`);
  const pairs = list(item.incompatibilityPairs, `${path}.incompatibilityPairs`).map((rawPair, i) => { if (!Array.isArray(rawPair) || rawPair.length !== 2) error("invalid_incompatibility_pair", `${path}.incompatibilityPairs[${i}]`, "pair must contain exactly two values"); const pair = rawPair as unknown[]; const left = validateTokenV1(pair[0], `${path}.incompatibilityPairs[${i}][0]`); const right = validateTokenV1(pair[1], `${path}.incompatibilityPairs[${i}][1]`); if (left >= right) error("invalid_incompatibility_pair", `${path}.incompatibilityPairs[${i}]`, "pair must be distinct and lexically ordered"); return [left, right] as const; });
  uniqueAscending(pairs.map((pair) => `${pair[0]}\0${pair[1]}`), `${path}.incompatibilityPairs`);
  const domain: ComparisonDomainV1 = freeze({ comparisonDomainId: validateLowercaseUuidV1(item.comparisonDomainId, `${path}.comparisonDomainId`), comparisonDomainVersion: validateVersionV1(item.comparisonDomainVersion, `${path}.comparisonDomainVersion`), propertyId: validateLowercaseUuidV1(item.propertyId, `${path}.propertyId`), valueDomainId: validateLowercaseUuidV1(item.valueDomainId, `${path}.valueDomainId`), valueDomainVersion: validateVersionV1(item.valueDomainVersion, `${path}.valueDomainVersion`), valueDomainHash: validateSha256HexV1(item.valueDomainHash, `${path}.valueDomainHash`), comparisonKeySchema: schema, ruleFamily: RCV018_RULE_FAMILY, incompatibilityPairs: pairs });
  const expected = canonicalizeRcv018(domain); if (expected.canonical !== auth.canonical || expected.hash !== auth.hash) error("integrity_failure", path, "comparison-domain Canonical/hash mismatch");
  return { domain, hash: auth.hash };
}

function uniqueAscending(values: readonly string[], path: string): void { for (let i = 1; i < values.length; i += 1) if (values[i - 1] >= values[i]) error("invalid_ordinal", path, "values must be unique and strictly ascending"); }
function bindingKey(id: string, version: number): string { return `${id}\0${version}`; }
function contextEqual(a: readonly Obj[], b: readonly Obj[]): boolean { return same(a, b); }

export function buildRcv018Analysis(input: unknown): Rcv018AnalysisBuilderResultV1 {
  const root = exact(input, ["analysisId", "assertions", "valueDomains", "comparisonDomains", "contractBinding", "algorithmBinding"], "input");
  const analysisId = validateLowercaseUuidV1(root.analysisId, "analysisId");
  const assertions = list(root.assertions, "assertions").map((v, i) => validateAssertion(authenticated<EvidenceAssertionV1>(v, `assertions[${i}]`) as Rcv018AssertionInputV1, i));
  const assertionIds = assertions.map((v) => String(v.assertion.assertionId)); unique(assertionIds, "assertions");
  const domains = list(root.valueDomains, "valueDomains").map((v, i) => { const auth = authenticated<ValueDomainV1>(v, `valueDomains[${i}]`); let domain: ValueDomainV1; try { domain = validateValueDomainV1(auth.value, `valueDomains[${i}].value`); } catch (e) { if (e instanceof Rcv018ValidationError) error("missing_value_domain", `valueDomains[${i}]`, e.message); throw e; } const expected = canonicalizeRcv018(domain); if (expected.canonical !== auth.canonical || expected.hash !== auth.hash) error("integrity_failure", `valueDomains[${i}]`, "ValueDomain Canonical/hash mismatch"); return { domain, hash: auth.hash }; });
  const comparisons = list(root.comparisonDomains, "comparisonDomains").map((v, i) => validateComparison(authenticated<ComparisonDomainV1>(v, `comparisonDomains[${i}]`) as Rcv018ComparisonDomainInputV1, i));
  unique(domains.map((v) => bindingKey(String(v.domain.valueDomainId), Number(v.domain.valueDomainVersion))), "valueDomains"); unique(comparisons.map((v) => bindingKey(String(v.domain.comparisonDomainId), Number(v.domain.comparisonDomainVersion))), "comparisonDomains");
  const domainMap = new Map(domains.map((v) => [bindingKey(String(v.domain.valueDomainId), Number(v.domain.valueDomainVersion)), v])); const comparisonMap = new Map(comparisons.map((v) => [bindingKey(String(v.domain.comparisonDomainId), Number(v.domain.comparisonDomainVersion)), v]));
  const usedValues = new Set<string>(); const usedComparisons = new Set<string>();
  for (const { assertion } of assertions) {
    const valueKey = bindingKey(String(assertion.valueDomainId), Number(assertion.valueDomainVersion)); const value = required(domainMap.get(valueKey), "missing_value_domain", "valueDomains", `missing ${valueKey}`); usedValues.add(valueKey); if (assertion.valueDomainHash !== value.hash || !value.domain.allowedValues.includes(assertion.value)) error("value_domain_version_mismatch", "assertions", "ValueDomain binding or value membership mismatch");
    const comparisonKey = bindingKey(String(assertion.comparisonDomainId), Number(assertion.comparisonDomainVersion)); const comparison = required(comparisonMap.get(comparisonKey), "invalid_comparison_domain", "comparisonDomains", `missing ${comparisonKey}`); usedComparisons.add(comparisonKey); const d = comparison.domain; if (assertion.propertyId !== d.propertyId || assertion.valueDomainId !== d.valueDomainId || assertion.valueDomainVersion !== d.valueDomainVersion || assertion.valueDomainHash !== d.valueDomainHash || assertion.comparisonDomainHash !== comparison.hash) error("comparison_domain_version_mismatch", "assertions", "cross-object domain parity mismatch");
    const expectedContext = d.comparisonKeySchema.map((key) => assertion.comparisonContext.find((entry) => entry.key === key.key)); if (expectedContext.some((entry) => !entry) || assertion.comparisonContext.length !== d.comparisonKeySchema.length || !assertion.comparisonContext.every((entry, i) => entry.key === d.comparisonKeySchema[i]?.key && entry.type === d.comparisonKeySchema[i]?.type)) error("invalid_assertion_context", "assertions.comparisonContext", "context does not match schema");
  }
  if (usedValues.size !== domainMap.size || usedComparisons.size !== comparisonMap.size) error("incomplete_analysis_input", "input", "unreferenced domain supplied");
  const contractBinding = validateContractBindingV1(root.contractBinding); const algorithmBinding = validateAlgorithmBindingV1(root.algorithmBinding);
  const pairEvaluations: Rcv018PairEvaluationV1[] = []; const findings: ContradictionFindingV1[] = [];
  const ordered = [...assertions].sort((a, b) => ascii(String(a.assertion.assertionId), String(b.assertion.assertionId)));
  for (let i = 0; i < ordered.length; i += 1) for (let j = i + 1; j < ordered.length; j += 1) {
    const left = ordered[i].assertion; const right = ordered[j].assertion; const sameDomain = left.subjectId === right.subjectId && left.propertyId === right.propertyId && left.comparisonDomainId === right.comparisonDomainId && left.comparisonDomainVersion === right.comparisonDomainVersion && left.comparisonDomainHash === right.comparisonDomainHash && left.valueDomainId === right.valueDomainId && left.valueDomainVersion === right.valueDomainVersion && left.valueDomainHash === right.valueDomainHash && contextEqual(left.comparisonContext as readonly Obj[], right.comparisonContext as readonly Obj[]);
    if (!sameDomain) { pairEvaluations.push(freeze({ assertionAId: String(left.assertionId), assertionBId: String(right.assertionId), outcome: "NOT_COMPARABLE" })); continue; }
    const comparison = comparisonMap.get(bindingKey(String(left.comparisonDomainId), Number(left.comparisonDomainVersion))) as { domain: ComparisonDomainV1; hash: Sha256HexV1 }; const pair = left.value < right.value ? [left.value, right.value] : [right.value, left.value]; const incompatible = comparison.domain.incompatibilityPairs.some((candidate) => candidate[0] === pair[0] && candidate[1] === pair[1]);
    if (incompatible) { const finding = freeze({ type: "CONTRADICTION", assertionAId: left.assertionId, assertionAHash: ordered[i].hash, assertionBId: right.assertionId, assertionBHash: ordered[j].hash, comparisonDomainId: comparison.domain.comparisonDomainId, comparisonDomainVersion: comparison.domain.comparisonDomainVersion, comparisonDomainHash: comparison.hash, incompatibilityLeft: pair[0], incompatibilityRight: pair[1] }) as ContradictionFindingV1; findings.push(finding); pairEvaluations.push(freeze({ assertionAId: String(left.assertionId), assertionBId: String(right.assertionId), outcome: "CONTRADICTION" })); }
    else pairEvaluations.push(freeze({ assertionAId: String(left.assertionId), assertionBId: String(right.assertionId), outcome: "COMPARABLE" }));
  }
  findings.sort((a, b) => ascii(String(a.assertionAId), String(b.assertionAId)) || ascii(String(a.assertionBId), String(b.assertionBId)));
  const analysis: RCV018AnalysisV1 = freeze({ analysisId, assertions: ordered.map((v) => freeze({ assertionId: v.assertion.assertionId, assertionHash: v.hash })), valueDomains: [...domains].sort((a, b) => ascii(String(a.domain.valueDomainId), String(b.domain.valueDomainId)) || Number(a.domain.valueDomainVersion) - Number(b.domain.valueDomainVersion)).map((v) => freeze({ valueDomainId: v.domain.valueDomainId, valueDomainVersion: v.domain.valueDomainVersion, valueDomainHash: v.hash })), comparisonDomains: [...comparisons].sort((a, b) => ascii(String(a.domain.comparisonDomainId), String(b.domain.comparisonDomainId)) || Number(a.domain.comparisonDomainVersion) - Number(b.domain.comparisonDomainVersion)).map((v) => freeze({ comparisonDomainId: v.domain.comparisonDomainId, comparisonDomainVersion: v.domain.comparisonDomainVersion, comparisonDomainHash: v.hash })), contractBinding, algorithmBinding, contradictionFindingHashes: findings.map((finding) => canonicalizeRcv018(finding).hash).sort(ascii) });
  const encoded = canonicalizeRcv018(analysis);
  return freeze({ analysis, canonical: encoded.canonical, hash: encoded.hash, findings, pairEvaluations });
}

function unique(values: readonly string[], path: string): void { if (new Set(values).size !== values.length) error("duplicate_assertion_membership", path, "duplicate identity"); }
