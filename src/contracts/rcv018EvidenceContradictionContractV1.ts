import { freezeRcv016 } from "../services/rcv016Validation";

export const RCV018_VALUE_DOMAIN_KIND = "CLOSED_SYMBOLIC_STATE" as const;
export const RCV018_RULE_FAMILY = "EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR" as const;
export const RCV018_STATEMENT_KINDS = [
  "ArtifactProvenanceStatement",
  "SourceRelationshipStatement",
  "ArtifactSourceAttribution",
  "EvidenceArtifactBinding",
  "KnowledgeStateStatement",
] as const;
export const RCV018_BINDING_KINDS = [
  "CLAIM_VERSION",
  "STATEMENT",
  "ARTIFACT_VERSION",
  "RCV016_SNAPSHOT",
  "RCV017_ANALYSIS",
] as const;

declare const UUID: unique symbol;
declare const VERSION: unique symbol;
declare const HASH: unique symbol;
declare const TOKEN: unique symbol;

export type LowercaseUuidV1 = string & { readonly [UUID]: true };
export type VersionV1 = number & { readonly [VERSION]: true };
export type Sha256HexV1 = string & { readonly [HASH]: true };
export type TokenV1 = string & { readonly [TOKEN]: true };
export type StatementKindV1 = (typeof RCV018_STATEMENT_KINDS)[number];
export type BindingKindV1 = (typeof RCV018_BINDING_KINDS)[number];

export interface StatementRefV1 {
  readonly statementKind: StatementKindV1;
  readonly statementId: LowercaseUuidV1;
}

export type AssertionContextEntryV1 =
  | { readonly key: TokenV1; readonly type: "UUID"; readonly uuidValue: LowercaseUuidV1 }
  | { readonly key: TokenV1; readonly type: "TOKEN"; readonly tokenValue: TokenV1 };

export interface EvidenceBasisEntryV1 extends StatementRefV1 {
  readonly evidenceRelationId: LowercaseUuidV1;
  readonly evidenceId: LowercaseUuidV1;
  readonly artifactVersionId: LowercaseUuidV1;
}

export type HistoricalBindingV1 =
  | { readonly kind: "CLAIM_VERSION"; readonly claimVersionId: LowercaseUuidV1 }
  | ({ readonly kind: "STATEMENT" } & StatementRefV1)
  | { readonly kind: "ARTIFACT_VERSION"; readonly artifactVersionId: LowercaseUuidV1 }
  | { readonly kind: "RCV016_SNAPSHOT"; readonly snapshotId: LowercaseUuidV1; readonly snapshotHash: Sha256HexV1 }
  | { readonly kind: "RCV017_ANALYSIS"; readonly analysisId: LowercaseUuidV1; readonly analysisHash: Sha256HexV1 };

export interface ValueDomainV1 {
  readonly valueDomainId: LowercaseUuidV1;
  readonly valueDomainVersion: VersionV1;
  readonly kind: typeof RCV018_VALUE_DOMAIN_KIND;
  readonly allowedValues: readonly TokenV1[];
}

export interface ComparisonKeyDescriptorV1 {
  readonly key: TokenV1;
  readonly type: "UUID" | "TOKEN";
}

export type ComparisonContextEntryV1 = AssertionContextEntryV1;

export interface ComparisonDomainV1 {
  readonly comparisonDomainId: LowercaseUuidV1;
  readonly comparisonDomainVersion: VersionV1;
  readonly propertyId: LowercaseUuidV1;
  readonly valueDomainId: LowercaseUuidV1;
  readonly valueDomainVersion: VersionV1;
  readonly valueDomainHash: Sha256HexV1;
  readonly comparisonKeySchema: readonly ComparisonKeyDescriptorV1[];
  readonly ruleFamily: typeof RCV018_RULE_FAMILY;
  readonly incompatibilityPairs: readonly (readonly [TokenV1, TokenV1])[];
}

export interface EvidenceAssertionV1 {
  readonly assertionId: LowercaseUuidV1;
  readonly subjectId: LowercaseUuidV1;
  readonly propertyId: LowercaseUuidV1;
  readonly comparisonDomainId: LowercaseUuidV1;
  readonly comparisonDomainVersion: VersionV1;
  readonly comparisonDomainHash: Sha256HexV1;
  readonly valueDomainId: LowercaseUuidV1;
  readonly valueDomainVersion: VersionV1;
  readonly valueDomainHash: Sha256HexV1;
  readonly value: TokenV1;
  readonly comparisonContext: readonly ComparisonContextEntryV1[];
  readonly evidenceBasis: readonly EvidenceBasisEntryV1[];
  readonly historicalBindings: readonly HistoricalBindingV1[];
}

export interface ContradictionFindingV1 {
  readonly type: "CONTRADICTION";
  readonly assertionAId: LowercaseUuidV1;
  readonly assertionAHash: Sha256HexV1;
  readonly assertionBId: LowercaseUuidV1;
  readonly assertionBHash: Sha256HexV1;
  readonly comparisonDomainId: LowercaseUuidV1;
  readonly comparisonDomainVersion: VersionV1;
  readonly comparisonDomainHash: Sha256HexV1;
  readonly incompatibilityLeft: TokenV1;
  readonly incompatibilityRight: TokenV1;
}

export interface AnalysisAssertionBindingV1 {
  readonly assertionId: LowercaseUuidV1;
  readonly assertionHash: Sha256HexV1;
}
export interface AnalysisValueDomainBindingV1 {
  readonly valueDomainId: LowercaseUuidV1;
  readonly valueDomainVersion: VersionV1;
  readonly valueDomainHash: Sha256HexV1;
}
export interface AnalysisComparisonDomainBindingV1 {
  readonly comparisonDomainId: LowercaseUuidV1;
  readonly comparisonDomainVersion: VersionV1;
  readonly comparisonDomainHash: Sha256HexV1;
}
export interface ContractBindingV1 { readonly contractId: string; readonly contractVersion: VersionV1; readonly contractHash: Sha256HexV1 }
export interface AlgorithmBindingV1 { readonly algorithmId: string; readonly algorithmVersion: VersionV1; readonly algorithmHash: Sha256HexV1 }
export interface RCV018AnalysisV1 {
  readonly analysisId: LowercaseUuidV1;
  readonly assertions: readonly AnalysisAssertionBindingV1[];
  readonly valueDomains: readonly AnalysisValueDomainBindingV1[];
  readonly comparisonDomains: readonly AnalysisComparisonDomainBindingV1[];
  readonly contractBinding: ContractBindingV1;
  readonly algorithmBinding: AlgorithmBindingV1;
  readonly contradictionFindingHashes: readonly Sha256HexV1[];
}

export class Rcv018ValidationError extends Error {
  readonly code = "REJECT_UNSUPPORTED" as const;
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "Rcv018ValidationError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_SAFE_VERSION = 9007199254740991;

type ObjectValue = Record<string, unknown>;
function plain(value: unknown, path: string): ObjectValue {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Rcv018ValidationError(path, "expected a plain object");
  return value as ObjectValue;
}
function object(value: unknown, keys: readonly string[], path: string): ObjectValue {
  const target = plain(value, path);
  const actual = Reflect.ownKeys(target);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key))) throw new Rcv018ValidationError(path, "unexpected or missing field");
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new Rcv018ValidationError(path, "fields must be enumerable data properties");
  }
  return value as ObjectValue;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Rcv018ValidationError(path, "expected a string");
  return value;
}
function uuid(value: unknown, path: string): LowercaseUuidV1 {
  const result = text(value, path);
  if (!UUID_PATTERN.test(result)) throw new Rcv018ValidationError(path, "expected lowercase canonical UUID");
  return result as LowercaseUuidV1;
}
function version(value: unknown, path: string): VersionV1 {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_SAFE_VERSION) throw new Rcv018ValidationError(path, "expected VersionV1");
  return value as VersionV1;
}
function hash(value: unknown, path: string): Sha256HexV1 {
  const result = text(value, path);
  if (!HASH_PATTERN.test(result)) throw new Rcv018ValidationError(path, "expected lowercase SHA-256 hex");
  return result as Sha256HexV1;
}
function token(value: unknown, path: string): TokenV1 {
  const result = text(value, path);
  if (result.length < 1 || result.length > 128 || !TOKEN_PATTERN.test(result)) throw new Rcv018ValidationError(path, "expected TokenV1");
  return result as TokenV1;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Rcv018ValidationError(path, "expected an array");
  return value;
}
function uniqueSorted(values: readonly string[], path: string): void {
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] >= values[i]) throw new Rcv018ValidationError(path, "values must be unique and strictly ascending");
  }
}
function freeze<T>(value: T): Readonly<T> { return freezeRcv016(value); }

export function validateLowercaseUuidV1(value: unknown, path = "value"): LowercaseUuidV1 { return uuid(value, path); }
export function validateVersionV1(value: unknown, path = "value"): VersionV1 { return version(value, path); }
export function validateSha256HexV1(value: unknown, path = "value"): Sha256HexV1 { return hash(value, path); }
export function validateTokenV1(value: unknown, path = "value"): TokenV1 { return token(value, path); }

export function validateStatementRefV1(value: unknown, path = "statementRef"): StatementRefV1 {
  const item = object(value, ["statementKind", "statementId"], path);
  if (!(RCV018_STATEMENT_KINDS as readonly string[]).includes(text(item.statementKind, `${path}.statementKind`))) throw new Rcv018ValidationError(`${path}.statementKind`, "unsupported statement kind");
  return freeze({ statementKind: item.statementKind as StatementKindV1, statementId: uuid(item.statementId, `${path}.statementId`) });
}

export function validateAssertionContextEntryV1(value: unknown, path = "context"): AssertionContextEntryV1 {
  const raw = plain(value, path);
  if (raw.type === "UUID") {
    const item = object(value, ["key", "type", "uuidValue"], path);
    return freeze({ key: token(item.key, `${path}.key`), type: "UUID", uuidValue: uuid(item.uuidValue, `${path}.uuidValue`) });
  }
  if (raw.type === "TOKEN") {
    const item = object(value, ["key", "type", "tokenValue"], path);
    return freeze({ key: token(item.key, `${path}.key`), type: "TOKEN", tokenValue: token(item.tokenValue, `${path}.tokenValue`) });
  }
  throw new Rcv018ValidationError(path, "invalid UUID/TOKEN context union");
}

export function validateHistoricalBindingV1(value: unknown, path = "binding"): HistoricalBindingV1 {
  const base = plain(value, path);
  const kind = text(base.kind, `${path}.kind`);
  if (kind === "CLAIM_VERSION") { const item = object(value, ["kind", "claimVersionId"], path); return freeze({ kind, claimVersionId: uuid(item.claimVersionId, `${path}.claimVersionId`) }); }
  if (kind === "STATEMENT") { const item = object(value, ["kind", "statementKind", "statementId"], path); const ref = validateStatementRefV1({ statementKind: item.statementKind, statementId: item.statementId }, `${path}.statement`); return freeze({ kind, ...ref }); }
  if (kind === "ARTIFACT_VERSION") { const item = object(value, ["kind", "artifactVersionId"], path); return freeze({ kind, artifactVersionId: uuid(item.artifactVersionId, `${path}.artifactVersionId`) }); }
  if (kind === "RCV016_SNAPSHOT") { const item = object(value, ["kind", "snapshotId", "snapshotHash"], path); return freeze({ kind, snapshotId: uuid(item.snapshotId, `${path}.snapshotId`), snapshotHash: hash(item.snapshotHash, `${path}.snapshotHash`) }); }
  if (kind === "RCV017_ANALYSIS") { const item = object(value, ["kind", "analysisId", "analysisHash"], path); return freeze({ kind, analysisId: uuid(item.analysisId, `${path}.analysisId`), analysisHash: hash(item.analysisHash, `${path}.analysisHash`) }); }
  throw new Rcv018ValidationError(`${path}.kind`, "unsupported historical binding kind");
}

export function validateValueDomainV1(value: unknown, path = "valueDomain"): ValueDomainV1 {
  const item = object(value, ["valueDomainId", "valueDomainVersion", "kind", "allowedValues"], path);
  if (item.kind !== RCV018_VALUE_DOMAIN_KIND) throw new Rcv018ValidationError(`${path}.kind`, "unsupported value-domain kind");
  const values = array(item.allowedValues, `${path}.allowedValues`).map((entry, i) => token(entry, `${path}.allowedValues[${i}]`));
  if (values.length === 0) throw new Rcv018ValidationError(`${path}.allowedValues`, "must be non-empty");
  uniqueSorted(values, `${path}.allowedValues`);
  return freeze({ valueDomainId: uuid(item.valueDomainId, `${path}.valueDomainId`), valueDomainVersion: version(item.valueDomainVersion, `${path}.valueDomainVersion`), kind: RCV018_VALUE_DOMAIN_KIND, allowedValues: values });
}

export function validateContractBindingV1(value: unknown, path = "contractBinding"): ContractBindingV1 {
  const item = object(value, ["contractId", "contractVersion", "contractHash"], path); const id = text(item.contractId, `${path}.contractId`); if (!id.length) throw new Rcv018ValidationError(`${path}.contractId`, "must be non-empty"); return freeze({ contractId: id, contractVersion: version(item.contractVersion, `${path}.contractVersion`), contractHash: hash(item.contractHash, `${path}.contractHash`) });
}
export function validateAlgorithmBindingV1(value: unknown, path = "algorithmBinding"): AlgorithmBindingV1 {
  const item = object(value, ["algorithmId", "algorithmVersion", "algorithmHash"], path); const id = text(item.algorithmId, `${path}.algorithmId`); if (!id.length) throw new Rcv018ValidationError(`${path}.algorithmId`, "must be non-empty"); return freeze({ algorithmId: id, algorithmVersion: version(item.algorithmVersion, `${path}.algorithmVersion`), algorithmHash: hash(item.algorithmHash, `${path}.algorithmHash`) });
}
