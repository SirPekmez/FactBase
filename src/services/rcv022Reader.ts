import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import databasePool from "../db";
import { canonicalizeJson } from "./canonicalJson";
import { canonicalizeRcv020Capture } from "./rcv020SemanticCore";

/** Failure classes defined by the frozen RCV-022 Contract/Design. */
export const RCV022_READER_FAILURE_CODES = [
  "MISSING_AUTHORITY", "UNSUPPORTED_VERSION", "MALFORMED_DATA",
  "IDENTITY_MISMATCH", "LINEAGE_MISMATCH", "CANONICAL_MISMATCH",
  "HASH_MISMATCH", "FRAGMENT_BOUNDARY_MISMATCH", "CLAIM_SCOPE_MISMATCH",
  "TEMPORAL_CONTEXT_MISMATCH", "METHOD_AUTHORITY_MISMATCH", "INVALID_RELATION",
  "DUPLICATE_CONFLICT", "CONTRADICTION_INPUT_MISMATCH",
  "CURRENT_STATE_SUBSTITUTION", "UNSUPPORTED_SEMANTIC_INPUT", "REPAIR_ATTEMPT",
] as const;
export type Rcv022ReaderFailureCode = (typeof RCV022_READER_FAILURE_CODES)[number];

export class Rcv022HistoricalVerificationError extends Error {
  readonly name = "Rcv022HistoricalVerificationError";
  constructor(
    readonly code: Rcv022ReaderFailureCode,
    readonly path: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`${code} at ${path}: ${message}`);
  }
}

export interface Rcv022FailureCandidate {
  readonly code: Rcv022ReaderFailureCode;
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}

/** Frozen precedence: structural, lineage/identity/canonical/hash, scope/temporal/method, relation/contradiction. */
export const RCV022_FAILURE_PRECEDENCE: Readonly<Record<Rcv022ReaderFailureCode, number>> = Object.freeze({
  MISSING_AUTHORITY: 0, UNSUPPORTED_VERSION: 0, MALFORMED_DATA: 0,
  IDENTITY_MISMATCH: 1, LINEAGE_MISMATCH: 1, CANONICAL_MISMATCH: 1, HASH_MISMATCH: 1,
  FRAGMENT_BOUNDARY_MISMATCH: 2, CLAIM_SCOPE_MISMATCH: 2, TEMPORAL_CONTEXT_MISMATCH: 2, METHOD_AUTHORITY_MISMATCH: 2,
  INVALID_RELATION: 3, DUPLICATE_CONFLICT: 3, CONTRADICTION_INPUT_MISMATCH: 3,
  CURRENT_STATE_SUBSTITUTION: 3, UNSUPPORTED_SEMANTIC_INPUT: 3, REPAIR_ATTEMPT: 3,
});

function utf8Compare(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

/** Selects without depending on candidate discovery, row, or object iteration order. */
export function selectRcv022Failure(candidates: readonly Rcv022FailureCandidate[]): Rcv022FailureCandidate | undefined {
  return [...candidates].sort((left, right) =>
    RCV022_FAILURE_PRECEDENCE[left.code] - RCV022_FAILURE_PRECEDENCE[right.code]
    || utf8Compare(left.path, right.path)
    || utf8Compare(left.code, right.code)
    || utf8Compare(left.message, right.message),
  )[0];
}

export interface Rcv022ReadClient { query(text: string, values?: readonly unknown[]): Promise<{ rows?: readonly Record<string, unknown>[] }> }
export interface Rcv022ReadPool { connect(): Promise<PoolClient & Rcv022ReadClient> }

export interface Rcv022VerifiedHistoricalBundle {
  readonly verified: true;
  readonly envelopeId: string;
  readonly claimId: string;
  readonly claimVersionId: string;
  readonly fragmentIds: readonly string[];
  readonly matchIds: readonly string[];
  readonly assessmentIds: readonly string[];
  readonly contradiction: boolean;
}

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const SCHEMAS = {
  fragment: "RCV022-EVIDENCE-FRAGMENT-V1",
  match: "RCV022-CLAIM-EVIDENCE-MATCH-V1",
  assessment: "RCV022-EVIDENCE-ASSESSMENT-V1",
  envelope: "RCV022-SEMANTIC-ANALYSIS-ENVELOPE-V1",
} as const;
const UTC = (column: string): string => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const text = (value: unknown): string => typeof value === "string" ? value : String(value ?? "");
const hash = (value: unknown): string => typeof value === "string" ? value : value instanceof Uint8Array ? Buffer.from(value).toString("hex") : String(value ?? "");

function fail(code: Rcv022ReaderFailureCode, path: string, message: string, cause?: unknown): never {
  throw new Rcv022HistoricalVerificationError(code, path, message, cause);
}
function candidate(error: unknown): Rcv022FailureCandidate {
  if (error instanceof Rcv022HistoricalVerificationError) return { code: error.code, path: error.path, message: error.message, cause: error.cause };
  return { code: "MALFORMED_DATA", path: "reader", message: error instanceof Error ? error.message : String(error) , cause: error };
}
function captureFailure(action: () => void): Rcv022FailureCandidate | undefined {
  try { action(); return undefined; } catch (error) { return candidate(error); }
}
async function captureAsyncFailure(action: () => Promise<unknown>): Promise<Rcv022FailureCandidate | undefined> {
  try { await action(); return undefined; } catch (error) { return candidate(error); }
}
function throwSelected(candidates: readonly Rcv022FailureCandidate[]): void {
  const selected = selectRcv022Failure(candidates);
  if (selected) throw new Rcv022HistoricalVerificationError(selected.code, selected.path, selected.message, selected.cause);
}
function jsonEqual(a: unknown, b: unknown): boolean {
  try { return canonicalizeJson(a) === canonicalizeJson(b); } catch { return false; }
}
function requireRow(rows: readonly Record<string, unknown>[] | undefined, path: string): Record<string, unknown> {
  if (!rows || rows.length === 0) fail("MISSING_AUTHORITY", path, "historical authority row is missing");
  if (rows.length !== 1) fail("DUPLICATE_CONFLICT", path, "multiple historical authority rows exist");
  return rows[0];
}
function compare(actual: unknown, expected: unknown, path: string, code: Rcv022ReaderFailureCode = "LINEAGE_MISMATCH"): void {
  if (typeof actual === "object" && actual !== null || typeof expected === "object" && expected !== null) {
    if (!jsonEqual(actual, expected)) fail(code, path, "persisted projection differs from authenticated authority");
  } else if (String(actual) !== String(expected)) fail(code, path, "persisted projection differs from authenticated authority");
}
function canonicalHash(canonical: string): string { return createHash("sha256").update(canonical, "utf8").digest("hex"); }
function parseCanonical(row: Record<string, unknown>, path: string): Record<string, unknown> {
  if (typeof row.canonical !== "string") fail("MALFORMED_DATA", `${path}.canonical`, "canonical is not text");
  if (typeof row.canonical_hash !== "string" || !SHA256.test(row.canonical_hash)) fail("MALFORMED_DATA", `${path}.canonical_hash`, "canonical hash is not lowercase SHA-256");
  let parsed: unknown;
  try { parsed = JSON.parse(row.canonical); } catch (error) { fail("MALFORMED_DATA", `${path}.canonical`, "canonical is not JSON", error); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) fail("MALFORMED_DATA", `${path}.canonical`, "canonical must be an object");
  return parsed as Record<string, unknown>;
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("MALFORMED_DATA", path, "expected object");
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  const record = object(value, path);
  const actual = Object.keys(record).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) fail("MALFORMED_DATA", path, "unexpected or missing key");
  for (const key of keys) if (record[key] === null || record[key] === undefined) fail("MALFORMED_DATA", `${path}.${key}`, "null/undefined is not allowed");
  return record;
}
function nonEmpty(value: unknown, path: string): string { if (typeof value !== "string" || value.length === 0) fail("MALFORMED_DATA", path, "expected non-empty string"); return value; }
function uuid(value: unknown, path: string): string { const v = nonEmpty(value, path); if (!UUID.test(v)) fail("MALFORMED_DATA", path, "expected lowercase UUID"); return v; }
function version(value: unknown, path: string): 1 { if (value !== 1) fail("UNSUPPORTED_VERSION", path, "unsupported canonical version"); return 1; }
function validHash(value: unknown, path: string): string { const v = nonEmpty(value, path); if (!SHA256.test(v)) fail("MALFORMED_DATA", path, "expected lowercase SHA-256"); return v; }
function timestamp(value: unknown, path: string): string { if (typeof value !== "string" || !TIMESTAMP.test(value)) fail("MALFORMED_DATA", path, "expected canonical UTC timestamp"); return value; }
function hashArray(value: unknown, path: string): string[] { if (!Array.isArray(value)) fail("MALFORMED_DATA", path, "expected array"); return value.map((v, i) => validHash(v, `${path}[${i}]`)); }
function validateLocator(value: unknown, kind: string, path: string): void {
  const v = object(value, path); const k = nonEmpty(v.kind, `${path}.kind`);
  if (kind === "TEXT" && !["WHOLE_TEXT", "UTF8_BYTE_RANGE"].includes(k)) fail("MALFORMED_DATA", path, "TEXT locator mismatch");
  if (kind === "STRUCTURED" && k !== "STRUCTURED_PATH") fail("MALFORMED_DATA", path, "STRUCTURED locator mismatch");
  if (kind === "IMAGE_REGION" && k !== "IMAGE_REGION") fail("MALFORMED_DATA", path, "IMAGE locator mismatch");
  if (k === "WHOLE_TEXT") { exact(v, ["kind"], path); return; }
  if (k === "UTF8_BYTE_RANGE") { const x = exact(v, ["kind", "startByte", "endByteExclusive"], path); if (!Number.isInteger(x.startByte) || !Number.isInteger(x.endByteExclusive) || (x.startByte as number) < 0 || (x.endByteExclusive as number) <= (x.startByte as number)) fail("MALFORMED_DATA", path, "invalid byte range"); return; }
  if (k === "STRUCTURED_PATH") { const x = exact(v, ["kind", "segments"], path); if (!Array.isArray(x.segments)) fail("MALFORMED_DATA", `${path}.segments`, "expected array"); for (const [i, raw] of x.segments.entries()) { const s = object(raw, `${path}.segments[${i}]`); if (s.kind === "KEY") { const q = exact(s, ["kind", "key"], `${path}.segments[${i}]`); nonEmpty(q.key, `${path}.segments[${i}].key`); } else if (s.kind === "INDEX") { const q = exact(s, ["kind", "index"], `${path}.segments[${i}]`); if (!Number.isInteger(q.index) || (q.index as number) < 0) fail("MALFORMED_DATA", `${path}.segments[${i}].index`, "invalid index"); } else fail("MALFORMED_DATA", `${path}.segments[${i}]`, "invalid segment"); } return; }
  if (k === "IMAGE_REGION") { const x = exact(v, ["kind", "coordinateSystemId", "coordinateSystemVersion", "imageWidth", "imageHeight", "x", "y", "width", "height"], path); if (x.coordinateSystemId !== "raw-pixel-v1" || x.coordinateSystemVersion !== 1) fail("MALFORMED_DATA", path, "invalid coordinate system"); for (const key of ["imageWidth", "imageHeight", "width", "height"]) if (!Number.isInteger(x[key]) || (x[key] as number) < 1) fail("MALFORMED_DATA", `${path}.${key}`, "invalid dimension"); for (const key of ["x", "y"]) if (!Number.isInteger(x[key]) || (x[key] as number) < 0) fail("MALFORMED_DATA", `${path}.${key}`, "invalid coordinate"); if ((x.x as number) + (x.width as number) > (x.imageWidth as number) || (x.y as number) + (x.height as number) > (x.imageHeight as number)) fail("MALFORMED_DATA", path, "region outside image"); return; }
  fail("MALFORMED_DATA", path, "unsupported locator kind");
}
function validateContent(value: unknown, kind: string, representationHash: string, path: string): void {
  const v = object(value, path); const k = nonEmpty(v.kind, `${path}.kind`);
  if (k === "TEXT") { const x = exact(v, ["kind", "utf8Text", "contentHash"], path); if (kind !== "TEXT") fail("MALFORMED_DATA", path, "TEXT binding mismatch"); nonEmpty(x.utf8Text, `${path}.utf8Text`); if (canonicalHash(String(x.utf8Text)) !== validHash(x.contentHash, `${path}.contentHash`)) fail("MALFORMED_DATA", path, "content hash mismatch"); return; }
  if (k === "STRUCTURED") { const x = exact(v, ["kind", "canonicalVersion", "canonical", "canonicalHash"], path); if (kind !== "STRUCTURED") fail("MALFORMED_DATA", path, "STRUCTURED binding mismatch"); version(x.canonicalVersion, `${path}.canonicalVersion`); const c = nonEmpty(x.canonical, `${path}.canonical`); if (canonicalHash(c) !== validHash(x.canonicalHash, `${path}.canonicalHash`)) fail("MALFORMED_DATA", path, "structured hash mismatch"); return; }
  if (k === "IMAGE_REGION") { const x = exact(v, ["kind", "sourceRepresentationHash"], path); if (kind !== "IMAGE_REGION" || validHash(x.sourceRepresentationHash, `${path}.sourceRepresentationHash`) !== representationHash) fail("MALFORMED_DATA", path, "image binding mismatch"); return; }
  fail("MALFORMED_DATA", path, "unsupported content binding");
}
function validateExtraction(value: unknown, path: string): void { const v = object(value, path); if (v.kind === "DIRECT") { exact(v, ["kind"], path); return; } if (v.kind === "DERIVED") { const x = exact(v, ["kind", "extractorIdentity", "extractorVersion", "extractorHash"], path); nonEmpty(x.extractorIdentity, `${path}.extractorIdentity`); nonEmpty(x.extractorVersion, `${path}.extractorVersion`); validHash(x.extractorHash, `${path}.extractorHash`); return; } fail("MALFORMED_DATA", path, "unsupported extraction authority"); }
function validateSampling(value: unknown, path: string): void { const x = exact(value, ["schema", "canonicalVersion", "entries"], path); if (x.schema !== "factbase-rcv022-sampling-parameters") fail("MALFORMED_DATA", `${path}.schema`, "unsupported schema"); version(x.canonicalVersion, `${path}.canonicalVersion`); if (!Array.isArray(x.entries)) fail("MALFORMED_DATA", `${path}.entries`, "expected array"); let previous: string | undefined; for (const [i, raw] of x.entries.entries()) { const e = exact(raw, ["name", "value"], `${path}.entries[${i}]`); const name = nonEmpty(e.name, `${path}.entries[${i}].name`); if (previous !== undefined && name <= previous) fail("MALFORMED_DATA", path, "sampling names must be sorted"); previous = name; if (!["string", "number", "boolean"].includes(typeof e.value) || (typeof e.value === "number" && !Number.isFinite(e.value))) fail("MALFORMED_DATA", `${path}.entries[${i}].value`, "expected scalar"); } }
function validateMethod(value: unknown, path: string): void {
  const record = object(value, path); const type = nonEmpty(record.methodType, `${path}.methodType`); const review = (x: Record<string, unknown>) => { nonEmpty(x.methodIdentity, `${path}.methodIdentity`); nonEmpty(x.methodVersion, `${path}.methodVersion`); validHash(x.methodHash, `${path}.methodHash`); hashArray(x.inputCanonicalHashes, `${path}.inputCanonicalHashes`); validHash(x.structuredOutputHash, `${path}.structuredOutputHash`); if (!["NOT_REVIEWED", "REVIEWED"].includes(nonEmpty(x.reviewStatus, `${path}.reviewStatus`))) fail("MALFORMED_DATA", `${path}.reviewStatus`, "unsupported status"); };
  if (type === "DETERMINISTIC") { const x = exact(record, ["methodType", "methodIdentity", "methodVersion", "methodHash", "inputCanonicalHashes", "structuredOutputHash", "reviewStatus"], path); review(x); return; }
  if (type === "HUMAN") { const x = exact(record, ["methodType", "methodIdentity", "methodVersion", "methodHash", "reviewerIdentity", "reviewProcessIdentity", "reviewProcessVersion", "reviewProcessHash", "inputCanonicalHashes", "structuredOutputHash", "reviewStatus"], path); review(x); nonEmpty(x.reviewerIdentity, `${path}.reviewerIdentity`); nonEmpty(x.reviewProcessIdentity, `${path}.reviewProcessIdentity`); nonEmpty(x.reviewProcessVersion, `${path}.reviewProcessVersion`); validHash(x.reviewProcessHash, `${path}.reviewProcessHash`); return; }
  const model = type === "MODEL_ASSISTED"; const mixed = type === "MIXED"; if (!model && !mixed) fail("MALFORMED_DATA", `${path}.methodType`, "unsupported method type");
  const keys = ["methodType", "methodIdentity", "methodVersion", "methodHash", "providerIdentity", "modelIdentity", "modelVersion", "processIdentity", "processVersion", "processHash", "promptTemplateHash", "systemInstructionHash", "samplingParameters", "samplingParametersHash", "inputCanonicalHashes", "rawOutputHash", "structuredOutputHash", "retryIdentity", ...(mixed ? ["reviewerIdentity", "reviewProcessIdentity", "reviewProcessVersion", "reviewProcessHash", "acceptanceStatus"] : []), "reviewStatus", "toolParticipation"];
  const allowed = record.toolContextHash !== undefined ? [...keys, "toolContextHash"] : keys; const x = exact(record, allowed, path); review(x); for (const k of ["providerIdentity", "modelIdentity", "modelVersion", "processIdentity", "processVersion", "retryIdentity", ...(mixed ? ["reviewerIdentity", "reviewProcessIdentity", "reviewProcessVersion"] : [])]) nonEmpty(x[k], `${path}.${k}`); for (const k of ["processHash", "promptTemplateHash", "systemInstructionHash", "samplingParametersHash", "rawOutputHash"]) validHash(x[k], `${path}.${k}`); validateSampling(x.samplingParameters, `${path}.samplingParameters`); if (canonicalHash(canonicalizeJson(x.samplingParameters)) !== x.samplingParametersHash) fail("MALFORMED_DATA", `${path}.samplingParametersHash`, "does not match samplingParameters JCS SHA-256"); if (mixed) { validHash(x.reviewProcessHash, `${path}.reviewProcessHash`); if (!["PENDING", "ACCEPTED", "REJECTED"].includes(nonEmpty(x.acceptanceStatus, `${path}.acceptanceStatus`))) fail("MALFORMED_DATA", `${path}.acceptanceStatus`, "unsupported status"); } const participation = nonEmpty(x.toolParticipation, `${path}.toolParticipation`); if (!["USED", "NOT_USED"].includes(participation)) fail("MALFORMED_DATA", `${path}.toolParticipation`, "unsupported participation"); if (participation === "USED") validHash(x.toolContextHash, `${path}.toolContextHash`); else if ("toolContextHash" in x) fail("MALFORMED_DATA", `${path}.toolContextHash`, "forbidden for NOT_USED");
}
function validateFragmentShape(p: Record<string, unknown>): void { const x = exact(p, ["schema", "canonicalVersion", "fragmentId", "captureId", "captureCanonicalVersion", "captureCanonicalHash", "captureRepresentationHash", "fragmentKind", "locator", "contentBinding", "extractionAuthority"], "evidenceFragment"); if (x.schema !== SCHEMAS.fragment) fail("MALFORMED_DATA", "evidenceFragment.schema", "unsupported schema"); version(x.canonicalVersion, "evidenceFragment.canonicalVersion"); uuid(x.fragmentId, "evidenceFragment.fragmentId"); uuid(x.captureId, "evidenceFragment.captureId"); nonEmpty(x.captureCanonicalVersion, "evidenceFragment.captureCanonicalVersion"); validHash(x.captureCanonicalHash, "evidenceFragment.captureCanonicalHash"); const rep = validHash(x.captureRepresentationHash, "evidenceFragment.captureRepresentationHash"); const kind = nonEmpty(x.fragmentKind, "evidenceFragment.fragmentKind"); if (!["TEXT", "STRUCTURED", "IMAGE_REGION"].includes(kind)) fail("MALFORMED_DATA", "evidenceFragment.fragmentKind", "unsupported kind"); const locator = x.locator as Record<string, unknown>; validateLocator(locator, kind, "evidenceFragment.locator"); validateContent(x.contentBinding, kind, rep, "evidenceFragment.contentBinding"); if (locator.kind === "UTF8_BYTE_RANGE") { const binding = x.contentBinding as Record<string, unknown>; const byteLength = Buffer.byteLength(String(binding.utf8Text), "utf8"); if ((locator.endByteExclusive as number) > byteLength) fail("MALFORMED_DATA", "evidenceFragment.locator", "byte range exceeds authenticated UTF-8 content length"); } validateExtraction(x.extractionAuthority, "evidenceFragment.extractionAuthority"); }
function validateMatchShape(p: Record<string, unknown>): void { const x = exact(p, ["schema", "canonicalVersion", "matchId", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "evidenceFragmentId", "evidenceFragmentCanonicalVersion", "evidenceFragmentCanonicalHash", "matcherIdentity", "matcherVersion", "matcherHash", "matcherInputCanonicalHashes"], "claimEvidenceMatch"); if (x.schema !== SCHEMAS.match) fail("MALFORMED_DATA", "claimEvidenceMatch.schema", "unsupported schema"); version(x.canonicalVersion, "claimEvidenceMatch.canonicalVersion"); for (const k of ["matchId", "claimId", "claimVersionId", "evidenceFragmentId"]) uuid(x[k], `claimEvidenceMatch.${k}`); for (const k of ["claimCanonicalVersion", "claimVersionCanonicalVersion", "evidenceFragmentCanonicalVersion"]) version(x[k], `claimEvidenceMatch.${k}`); for (const k of ["claimCanonicalHash", "claimVersionCanonicalHash", "evidenceFragmentCanonicalHash", "matcherHash"]) validHash(x[k], `claimEvidenceMatch.${k}`); nonEmpty(x.matcherIdentity, "claimEvidenceMatch.matcherIdentity"); nonEmpty(x.matcherVersion, "claimEvidenceMatch.matcherVersion"); hashArray(x.matcherInputCanonicalHashes, "claimEvidenceMatch.matcherInputCanonicalHashes"); }
function validateAssessmentShape(p: Record<string, unknown>): void { const x = exact(p, ["schema", "canonicalVersion", "assessmentId", "claimEvidenceMatchId", "claimEvidenceMatchCanonicalVersion", "claimEvidenceMatchCanonicalHash", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "evidenceFragmentId", "evidenceFragmentCanonicalVersion", "evidenceFragmentCanonicalHash", "assessmentResult", "methodProvenance", "assessedAt"], "evidenceAssessment"); if (x.schema !== SCHEMAS.assessment) fail("MALFORMED_DATA", "evidenceAssessment.schema", "unsupported schema"); version(x.canonicalVersion, "evidenceAssessment.canonicalVersion"); for (const k of ["assessmentId", "claimEvidenceMatchId", "claimId", "claimVersionId", "evidenceFragmentId"]) uuid(x[k], `evidenceAssessment.${k}`); for (const k of ["claimEvidenceMatchCanonicalVersion", "claimCanonicalVersion", "claimVersionCanonicalVersion", "evidenceFragmentCanonicalVersion"]) version(x[k], `evidenceAssessment.${k}`); for (const k of ["claimEvidenceMatchCanonicalHash", "claimCanonicalHash", "claimVersionCanonicalHash", "evidenceFragmentCanonicalHash"]) validHash(x[k], `evidenceAssessment.${k}`); const ar = exact(x.assessmentResult, ["relation", "rationale"], "evidenceAssessment.assessmentResult"); if (!["SUPPORTS", "REFUTES", "INSUFFICIENT", "UNRELATED"].includes(nonEmpty(ar.relation, "evidenceAssessment.assessmentResult.relation"))) fail("INVALID_RELATION", "evidenceAssessment.assessmentResult.relation", "unsupported relation"); nonEmpty(ar.rationale, "evidenceAssessment.assessmentResult.rationale"); validateMethod(x.methodProvenance, "evidenceAssessment.methodProvenance"); timestamp(x.assessedAt, "evidenceAssessment.assessedAt"); }
function validateEnvelopeShape(p: Record<string, unknown>): void { const x = exact(p, ["schema", "canonicalVersion", "envelopeId", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "analysisCutoffAt", "analysisAt", "matchRefs", "assessmentRefs", "analysisMethodIdentity", "analysisMethodVersion", "analysisMethodHash"], "semanticAnalysisEnvelope"); if (x.schema !== SCHEMAS.envelope) fail("MALFORMED_DATA", "semanticAnalysisEnvelope.schema", "unsupported schema"); version(x.canonicalVersion, "semanticAnalysisEnvelope.canonicalVersion"); for (const k of ["envelopeId", "claimId", "claimVersionId"]) uuid(x[k], `semanticAnalysisEnvelope.${k}`); for (const k of ["claimCanonicalVersion", "claimVersionCanonicalVersion"]) version(x[k], `semanticAnalysisEnvelope.${k}`); for (const k of ["claimCanonicalHash", "claimVersionCanonicalHash", "analysisMethodHash"]) validHash(x[k], `semanticAnalysisEnvelope.${k}`); timestamp(x.analysisCutoffAt, "semanticAnalysisEnvelope.analysisCutoffAt"); timestamp(x.analysisAt, "semanticAnalysisEnvelope.analysisAt"); nonEmpty(x.analysisMethodIdentity, "semanticAnalysisEnvelope.analysisMethodIdentity"); nonEmpty(x.analysisMethodVersion, "semanticAnalysisEnvelope.analysisMethodVersion"); const refs = (v: unknown, path: string) => { if (!Array.isArray(v)) fail("MALFORMED_DATA", path, "expected array"); const seen = new Set<string>(); for (const [i, raw] of v.entries()) { const r = exact(raw, ["id", "canonicalVersion", "canonicalHash"], `${path}[${i}]`); uuid(r.id, `${path}[${i}].id`); version(r.canonicalVersion, `${path}[${i}].canonicalVersion`); validHash(r.canonicalHash, `${path}[${i}].canonicalHash`); if (seen.has(String(r.id))) fail("MALFORMED_DATA", path, "duplicate member"); seen.add(String(r.id)); } }; refs(x.matchRefs, "semanticAnalysisEnvelope.matchRefs"); refs(x.assessmentRefs, "semanticAnalysisEnvelope.assessmentRefs"); if ((x.matchRefs as unknown[]).length === 0 && (x.assessmentRefs as unknown[]).length !== 0) fail("MALFORMED_DATA", "semanticAnalysisEnvelope.assessmentRefs", "zero matches require zero assessments"); }
function inspectIndependentCanonical(row: Record<string, unknown>, validator: (value: Record<string, unknown>) => void, path: string): { parsed?: Record<string, unknown>; failures: Rcv022FailureCandidate[] } {
  let parsed: Record<string, unknown>;
  try { parsed = parseCanonical(row, path); validator(parsed); } catch (error) { return { failures: [candidate(error)] }; }
  const failures: Rcv022FailureCandidate[] = [];
  const canonicalFailure = captureFailure(() => { const canonical = canonicalizeJson(parsed); if (row.canonical !== canonical) fail("CANONICAL_MISMATCH", `${path}.canonical`, "stored canonical is not exact JCS"); });
  if (canonicalFailure) failures.push(canonicalFailure);
  const hashFailure = captureFailure(() => { if (hash(row.canonical_hash) !== canonicalHash(text(row.canonical))) fail("HASH_MISMATCH", `${path}.canonical_hash`, "stored hash differs from canonical UTF-8 bytes"); });
  if (hashFailure) failures.push(hashFailure);
  return { parsed, failures };
}
function authenticateIndependentCanonical(row: Record<string, unknown>, validator: (value: Record<string, unknown>) => void, path: string): Record<string, unknown> {
  const inspected = inspectIndependentCanonical(row, validator, path); throwSelected(inspected.failures); return inspected.parsed as Record<string, unknown>;
}
async function one(client: Rcv022ReadClient, sql: string, values: readonly unknown[], path: string): Promise<Record<string, unknown>> {
  const result = await client.query(sql, values); return requireRow(result.rows, path);
}
async function many(client: Rcv022ReadClient, sql: string, values: readonly unknown[] = []): Promise<readonly Record<string, unknown>[]> {
  const result = await client.query(sql, values); return result.rows ?? [];
}
async function authenticateClaim(client: Rcv022ReadClient, id: string, expectedVersion: unknown, expectedHash: unknown, path: string): Promise<void> {
  const row = await one(client, "SELECT claim_id::text AS claim_id, canonical_version, canonical, canonical_hash FROM public.claim_identity_authorities WHERE claim_id=$1", [id], path);
  const parsed = parseCanonical(row, path); const expected = exact(parsed, ["schema", "canonicalVersion", "claimId"], path); if (expected.schema !== "factbase-claim-identity-authority") fail("MALFORMED_DATA", `${path}.schema`, "unsupported schema"); version(expected.canonicalVersion, `${path}.canonicalVersion`); uuid(expected.claimId, `${path}.claimId`);
  const failures: Rcv022FailureCandidate[] = [];
  for (const failure of [
    captureFailure(() => { if (row.canonical !== canonicalizeJson(parsed)) fail("CANONICAL_MISMATCH", `${path}.canonical`, "stored canonical is not exact JCS"); }),
    captureFailure(() => { if (hash(row.canonical_hash) !== canonicalHash(text(row.canonical))) fail("HASH_MISMATCH", `${path}.canonical_hash`, "stored hash differs from canonical UTF-8 bytes"); }),
    captureFailure(() => compare(row.claim_id, id, `${path}.claim_id`, "IDENTITY_MISMATCH")),
    captureFailure(() => compare(row.canonical_version, expectedVersion, `${path}.canonical_version`, "LINEAGE_MISMATCH")),
    captureFailure(() => compare(row.canonical_hash, expectedHash, `${path}.canonical_hash`, "HASH_MISMATCH")),
  ]) if (failure) failures.push(failure);
  throwSelected(failures);
}
async function authenticateClaimVersion(client: Rcv022ReadClient, id: string, expectedVersion: unknown, expectedHash: unknown, path: string): Promise<void> {
  const row = await one(client, "SELECT claim_version_id::text AS claim_version_id, claim_id::text AS claim_id, version_number, title, normalized_statement, language, claim_type, canonical_version, canonical, canonical_hash FROM public.claim_version_authorities WHERE claim_version_id=$1", [id], path);
  const parsed = parseCanonical(row, path); const expected = exact(parsed, ["schema", "canonicalVersion", "claimId", "claimVersionId", "versionNumber", "title", "normalizedStatement", "language", "claimType"], path); if (expected.schema !== "factbase-claim-version-authority") fail("MALFORMED_DATA", `${path}.schema`, "unsupported schema"); version(expected.canonicalVersion, `${path}.canonicalVersion`); uuid(expected.claimId, `${path}.claimId`); uuid(expected.claimVersionId, `${path}.claimVersionId`); if (!Number.isInteger(expected.versionNumber) || (expected.versionNumber as number) < 1) fail("MALFORMED_DATA", `${path}.versionNumber`, "invalid version number"); for (const k of ["title", "normalizedStatement", "language", "claimType"]) nonEmpty(expected[k], `${path}.${k}`);
  const failures: Rcv022FailureCandidate[] = [];
  for (const failure of [
    captureFailure(() => { if (row.canonical !== canonicalizeJson(parsed)) fail("CANONICAL_MISMATCH", `${path}.canonical`, "stored canonical is not exact JCS"); }),
    captureFailure(() => { if (hash(row.canonical_hash) !== canonicalHash(text(row.canonical))) fail("HASH_MISMATCH", `${path}.canonical_hash`, "stored hash differs from canonical UTF-8 bytes"); }),
    captureFailure(() => compare(row.claim_version_id, id, `${path}.claim_version_id`, "IDENTITY_MISMATCH")),
    captureFailure(() => compare(row.canonical_version, expectedVersion, `${path}.canonical_version`, "LINEAGE_MISMATCH")),
    captureFailure(() => compare(row.canonical_hash, expectedHash, `${path}.canonical_hash`, "HASH_MISMATCH")),
  ]) if (failure) failures.push(failure);
  throwSelected(failures);
}

async function verifyFragment(client: Rcv022ReadClient, id: string): Promise<Record<string, unknown>> {
  const row = await one(client, `SELECT fragment_id::text AS fragment_id, canonical_version, canonical, canonical_hash, capture_id::text AS capture_id, capture_canonical_version, capture_canonical_hash, capture_representation_hash, fragment_kind, locator, content_binding, extraction_authority FROM public.rcv022_evidence_fragments WHERE fragment_id=$1`, [id], "evidenceFragment");
  const inspected = inspectIndependentCanonical(row, validateFragmentShape, "evidenceFragment"); const failures: Rcv022FailureCandidate[] = [...inspected.failures]; if (!inspected.parsed) { throwSelected(failures); } const parsed = inspected.parsed as Record<string, unknown>;
  const projections = [[row.canonical_version, parsed.canonicalVersion, "evidenceFragment.canonical_version", "LINEAGE_MISMATCH"], [row.fragment_id, parsed.fragmentId, "evidenceFragment.fragment_id", "LINEAGE_MISMATCH"], [row.capture_id, parsed.captureId, "evidenceFragment.capture_id", "LINEAGE_MISMATCH"], [row.capture_canonical_version, parsed.captureCanonicalVersion, "evidenceFragment.capture_canonical_version", "LINEAGE_MISMATCH"], [row.capture_canonical_hash, parsed.captureCanonicalHash, "evidenceFragment.capture_canonical_hash", "LINEAGE_MISMATCH"], [row.capture_representation_hash, parsed.captureRepresentationHash, "evidenceFragment.capture_representation_hash", "LINEAGE_MISMATCH"], [row.fragment_kind, parsed.fragmentKind, "evidenceFragment.fragment_kind", "LINEAGE_MISMATCH"], [row.locator, parsed.locator, "evidenceFragment.locator", "CANONICAL_MISMATCH"], [row.content_binding, parsed.contentBinding, "evidenceFragment.content_binding", "CANONICAL_MISMATCH"], [row.extraction_authority, parsed.extractionAuthority, "evidenceFragment.extraction_authority", "CANONICAL_MISMATCH"]] as const;
  for (const [actual, expected, path, code] of projections) { const failure = captureFailure(() => compare(actual, expected, path, code)); if (failure) failures.push(failure); }
  const capture = await one(client, "SELECT capture_id::text AS capture_id, logical_source_id::text AS logical_source_id, monitor_id::text AS monitor_id, monitor_configuration_version_id::text AS monitor_configuration_version_id, occurrence_id::text AS occurrence_id, retrieval_attempt_id::text AS retrieval_attempt_id, request_hash, requested_target, final_url, redirect_canonical, response_status, response_metadata_canonical, media_type, byte_length::text AS byte_length, to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS observed_at, content_hash, canonical, capture_hash, retention_policy, retention_policy_version, raw_object_identity, raw_object_reference FROM public.rcv020_captures WHERE capture_id=$1", [parsed.captureId], "evidenceFragment.capture");
  for (const [actual, expected, path, code] of [[capture.capture_id, parsed.captureId, "evidenceFragment.capture.id", "IDENTITY_MISMATCH"], [capture.capture_hash, parsed.captureCanonicalHash, "evidenceFragment.capture.captureHash", "HASH_MISMATCH"], [capture.content_hash, parsed.captureRepresentationHash, "evidenceFragment.capture.contentHash", "HASH_MISMATCH"]] as const) { const failure = captureFailure(() => compare(actual, expected, path, code)); if (failure) failures.push(failure); }
  try {
    const captureBuilt = canonicalizeRcv020Capture({ captureId:text(capture.capture_id), logicalSourceId:text(capture.logical_source_id), monitorId:text(capture.monitor_id), monitorConfigurationVersionId:text(capture.monitor_configuration_version_id), occurrenceId:text(capture.occurrence_id), retrievalAttemptId:text(capture.retrieval_attempt_id), observedAt:text(capture.observed_at), contentHash:text(capture.content_hash), byteLength:text(capture.byte_length), rawObjectIdentity:capture.raw_object_identity == null ? null : text(capture.raw_object_identity), requestHash:text(capture.request_hash), requestedTarget:text(capture.requested_target), finalUrl:capture.final_url == null ? null : text(capture.final_url), redirectCanonical:capture.redirect_canonical == null ? null : text(capture.redirect_canonical), responseStatus:Number(capture.response_status), responseMetadataCanonical:text(capture.response_metadata_canonical), mediaType:text(capture.media_type), retentionPolicy:text(capture.retention_policy), retentionPolicyVersion:Number(capture.retention_policy_version) } as never);
    const captureCanonicalFailure = captureFailure(() => { if (capture.canonical !== captureBuilt.canonical) fail("CANONICAL_MISMATCH", "evidenceFragment.capture.canonical", "Capture canonical differs from exact reconstruction"); }); if (captureCanonicalFailure) failures.push(captureCanonicalFailure);
    const captureHashFailure = captureFailure(() => { if (canonicalHash(text(capture.canonical)) !== captureBuilt.hash) fail("HASH_MISMATCH", "evidenceFragment.capture.canonical_hash", "Capture canonical bytes are not authenticated"); }); if (captureHashFailure) failures.push(captureHashFailure);
  } catch (error) { failures.push(error instanceof Rcv022HistoricalVerificationError ? candidate(error) : { code: "MALFORMED_DATA", path: "evidenceFragment.capture", message: "Capture authority is malformed", cause: error }); }
  throwSelected(failures);
  return row;
}

async function verifyMatch(client: Rcv022ReadClient, id: string): Promise<Record<string, unknown>> {
  const row = await one(client, `SELECT match_id::text AS match_id, canonical_version, canonical, canonical_hash, claim_id::text AS claim_id, claim_canonical_version, claim_canonical_hash, claim_version_id::text AS claim_version_id, claim_version_canonical_version, claim_version_canonical_hash, evidence_fragment_id::text AS evidence_fragment_id, evidence_fragment_canonical_version, evidence_fragment_canonical_hash, matcher_identity, matcher_version, matcher_hash, matcher_input_canonical_hashes FROM public.rcv022_claim_evidence_matches WHERE match_id=$1`, [id], "claimEvidenceMatch");
  const inspected = inspectIndependentCanonical(row, validateMatchShape, "claimEvidenceMatch"); const failures: Rcv022FailureCandidate[] = [...inspected.failures]; if (!inspected.parsed) { throwSelected(failures); } const p = inspected.parsed as Record<string, unknown>;
  for (const [column,key] of [["canonical_version","canonicalVersion"],["match_id","matchId"],["claim_id","claimId"],["claim_canonical_version","claimCanonicalVersion"],["claim_canonical_hash","claimCanonicalHash"],["claim_version_id","claimVersionId"],["claim_version_canonical_version","claimVersionCanonicalVersion"],["claim_version_canonical_hash","claimVersionCanonicalHash"],["evidence_fragment_id","evidenceFragmentId"],["evidence_fragment_canonical_version","evidenceFragmentCanonicalVersion"],["evidence_fragment_canonical_hash","evidenceFragmentCanonicalHash"],["matcher_identity","matcherIdentity"],["matcher_version","matcherVersion"],["matcher_hash","matcherHash"],["matcher_input_canonical_hashes","matcherInputCanonicalHashes"]] as const) { const failure = captureFailure(() => compare(row[column], p[key], `claimEvidenceMatch.${column}`, "LINEAGE_MISMATCH")); if (failure) failures.push(failure); }
  for (const action of [() => authenticateClaim(client,text(p.claimId),p.claimCanonicalVersion,p.claimCanonicalHash,"claimEvidenceMatch.claim"), () => authenticateClaimVersion(client,text(p.claimVersionId),p.claimVersionCanonicalVersion,p.claimVersionCanonicalHash,"claimEvidenceMatch.claimVersion"), () => verifyFragment(client,text(p.evidenceFragmentId))]) { const failure = await captureAsyncFailure(action); if (failure) failures.push(failure); }
  throwSelected(failures);
  return row;
}

async function verifyAssessment(client: Rcv022ReadClient, id: string): Promise<Record<string, unknown>> {
  const row = await one(client, `SELECT assessment_id::text AS assessment_id, canonical_version, canonical, canonical_hash, claim_evidence_match_id::text AS claim_evidence_match_id, claim_evidence_match_canonical_version, claim_evidence_match_canonical_hash, claim_id::text AS claim_id, claim_canonical_version, claim_canonical_hash, claim_version_id::text AS claim_version_id, claim_version_canonical_version, claim_version_canonical_hash, evidence_fragment_id::text AS evidence_fragment_id, evidence_fragment_canonical_version, evidence_fragment_canonical_hash, assessment_result, method_provenance, relation, method_type, ${UTC("assessed_at")} AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1`, [id], "evidenceAssessment");
  const inspected = inspectIndependentCanonical(row, validateAssessmentShape, "evidenceAssessment"); const failures: Rcv022FailureCandidate[] = [...inspected.failures]; if (!inspected.parsed) { throwSelected(failures); } const p = inspected.parsed as Record<string, unknown>;
  for (const [column,key] of [["canonical_version","canonicalVersion"],["assessment_id","assessmentId"],["claim_evidence_match_id","claimEvidenceMatchId"],["claim_evidence_match_canonical_version","claimEvidenceMatchCanonicalVersion"],["claim_evidence_match_canonical_hash","claimEvidenceMatchCanonicalHash"],["claim_id","claimId"],["claim_canonical_version","claimCanonicalVersion"],["claim_canonical_hash","claimCanonicalHash"],["claim_version_id","claimVersionId"],["claim_version_canonical_version","claimVersionCanonicalVersion"],["claim_version_canonical_hash","claimVersionCanonicalHash"],["evidence_fragment_id","evidenceFragmentId"],["evidence_fragment_canonical_version","evidenceFragmentCanonicalVersion"],["evidence_fragment_canonical_hash","evidenceFragmentCanonicalHash"],["assessment_result","assessmentResult"],["method_provenance","methodProvenance"],["assessed_at","assessedAt"]] as const) { const failure = captureFailure(() => compare(row[column],p[key],`evidenceAssessment.${column}`,"LINEAGE_MISMATCH")); if (failure) failures.push(failure); }
  for (const [actual, expected, path, code] of [[row.relation,(p.assessmentResult as Record<string,unknown>).relation,"evidenceAssessment.relation","INVALID_RELATION"],[row.method_type,(p.methodProvenance as Record<string,unknown>).methodType,"evidenceAssessment.method_type","METHOD_AUTHORITY_MISMATCH"]] as const) { const failure = captureFailure(() => compare(actual, expected, path, code)); if (failure) failures.push(failure); }
  for (const action of [() => verifyMatch(client,text(p.claimEvidenceMatchId)), () => authenticateClaim(client,text(p.claimId),p.claimCanonicalVersion,p.claimCanonicalHash,"evidenceAssessment.claim"), () => authenticateClaimVersion(client,text(p.claimVersionId),p.claimVersionCanonicalVersion,p.claimVersionCanonicalHash,"evidenceAssessment.claimVersion"), () => verifyFragment(client,text(p.evidenceFragmentId))]) { const failure = await captureAsyncFailure(action); if (failure) failures.push(failure); }
  throwSelected(failures);
  return row;
}

async function verifyEnvelope(client: Rcv022ReadClient, id: string): Promise<{ row: Record<string, unknown>; matchRefs: readonly Record<string,unknown>[]; assessmentRefs: readonly Record<string,unknown>[] }> {
  const row = await one(client, `SELECT envelope_id::text AS envelope_id, canonical_version, canonical, canonical_hash, claim_id::text AS claim_id, claim_canonical_version, claim_canonical_hash, claim_version_id::text AS claim_version_id, claim_version_canonical_version, claim_version_canonical_hash, ${UTC("analysis_cutoff_at")} AS analysis_cutoff_at, ${UTC("analysis_at")} AS analysis_at, match_refs, assessment_refs, analysis_method_identity, analysis_method_version, analysis_method_hash FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1`, [id], "semanticAnalysisEnvelope");
  const inspected = inspectIndependentCanonical(row, validateEnvelopeShape, "semanticAnalysisEnvelope"); const failures: Rcv022FailureCandidate[] = [...inspected.failures]; if (!inspected.parsed) { throwSelected(failures); } const p = inspected.parsed as Record<string, unknown>;
  for (const [column,key] of [["envelope_id","envelopeId"],["claim_id","claimId"],["claim_canonical_version","claimCanonicalVersion"],["claim_canonical_hash","claimCanonicalHash"],["claim_version_id","claimVersionId"],["claim_version_canonical_version","claimVersionCanonicalVersion"],["claim_version_canonical_hash","claimVersionCanonicalHash"],["analysis_cutoff_at","analysisCutoffAt"],["analysis_at","analysisAt"],["match_refs","matchRefs"],["assessment_refs","assessmentRefs"],["analysis_method_identity","analysisMethodIdentity"],["analysis_method_version","analysisMethodVersion"],["analysis_method_hash","analysisMethodHash"]] as const) {
    const code = key === "analysisCutoffAt" || key === "analysisAt" ? "TEMPORAL_CONTEXT_MISMATCH" : key.startsWith("analysisMethod") ? "METHOD_AUTHORITY_MISMATCH" : "LINEAGE_MISMATCH";
    const failure = captureFailure(() => compare(row[column],p[key],`semanticAnalysisEnvelope.${column}`,code)); if (failure) failures.push(failure);
  }
  for (const action of [() => authenticateClaim(client,text(p.claimId),p.claimCanonicalVersion,p.claimCanonicalHash,"semanticAnalysisEnvelope.claim"), () => authenticateClaimVersion(client,text(p.claimVersionId),p.claimVersionCanonicalVersion,p.claimVersionCanonicalHash,"semanticAnalysisEnvelope.claimVersion")]) { const failure = await captureAsyncFailure(action); if (failure) failures.push(failure); }
  const mr = await many(client,"SELECT ordinal, match_id::text AS id, match_canonical_version AS canonical_version, match_canonical_hash AS canonical_hash FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1 ORDER BY ordinal",[id]); const ar = await many(client,"SELECT ordinal, assessment_id::text AS id, assessment_canonical_version AS canonical_version, assessment_canonical_hash AS canonical_hash FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 ORDER BY ordinal",[id]);
  const checkRefs = (refs: readonly Record<string,unknown>[], canonicalRefs: unknown, name: string) => { if (!Array.isArray(canonicalRefs) || refs.length !== canonicalRefs.length) { failures.push({ code: "LINEAGE_MISMATCH", path: `semanticAnalysisEnvelope.${name}`, message: "support projection cardinality mismatch" }); return; } for (const [i,ref] of refs.entries()) { const expected=(canonicalRefs as readonly Record<string,unknown>[])[i]; for (const [actual, wanted, path, code] of [[ref.ordinal,i,`${name}[${i}].ordinal`,`LINEAGE_MISMATCH`],[ref.id,expected.id,`${name}[${i}].id`,`LINEAGE_MISMATCH`],[ref.canonical_version,expected.canonicalVersion,`${name}[${i}].canonical_version`,`LINEAGE_MISMATCH`],[ref.canonical_hash,expected.canonicalHash,`${name}[${i}].canonical_hash`,`HASH_MISMATCH`]] as const) { const failure = captureFailure(() => compare(actual,wanted,path,code)); if (failure) failures.push(failure); } } };
  checkRefs(mr,p.matchRefs,"matchRefs"); checkRefs(ar,p.assessmentRefs,"assessmentRefs");
  for (const ref of p.matchRefs as readonly Record<string,unknown>[]) { const failure = await captureAsyncFailure(() => verifyMatch(client,text(ref.id))); if (failure) failures.push(failure); }
  for (const ref of p.assessmentRefs as readonly Record<string,unknown>[]) { const result = await captureAsyncFailure(async () => { const assessment = await verifyAssessment(client,text(ref.id)); const matchId = text(assessment.claim_evidence_match_id); const count = (p.matchRefs as readonly Record<string,unknown>[]).filter((m) => text(m.id) === matchId).length; if (count !== 1) fail("LINEAGE_MISMATCH",`semanticAnalysisEnvelope.assessmentRefs.${ref.id}`,"Assessment Match is not present exactly once in this Envelope"); }); if (result) failures.push(result); }
  throwSelected(failures);
  return { row, matchRefs: mr, assessmentRefs: ar };
}

/** Verify a persisted Envelope and its complete historical closure in a caller-owned read-only transaction. */
export async function verifyRcv022HistoricalEnvelopeWithinTransaction(client: Rcv022ReadClient, envelopeId: string): Promise<Rcv022VerifiedHistoricalBundle> {
  const envelope = await verifyEnvelope(client,envelopeId);
  const p = parseCanonical(envelope.row,"semanticAnalysisEnvelope");
  const relations: string[] = [];
  const fragmentIds = new Set<string>();
  for (const ref of p.matchRefs as readonly Record<string,unknown>[]) {
    const match = await one(client, "SELECT evidence_fragment_id::text AS evidence_fragment_id FROM public.rcv022_claim_evidence_matches WHERE match_id=$1", [ref.id], "claimEvidenceMatch");
    fragmentIds.add(text(match.evidence_fragment_id));
  }
  for (const ref of p.assessmentRefs as readonly Record<string,unknown>[]) {
    const row = await one(client,"SELECT assessment_result,evidence_fragment_id::text AS evidence_fragment_id FROM public.rcv022_evidence_assessments WHERE assessment_id=$1",[ref.id],"evidenceAssessment"); const result=row.assessment_result as Record<string,unknown>; relations.push(text(result.relation)); fragmentIds.add(text(row.evidence_fragment_id));
  }
  const contradiction = relations.includes("SUPPORTS") && relations.includes("REFUTES");
  return Object.freeze({ verified:true as const, envelopeId:text(p.envelopeId), claimId:text(p.claimId), claimVersionId:text(p.claimVersionId), fragmentIds:[...fragmentIds], matchIds:(p.matchRefs as readonly Record<string,unknown>[]).map((r)=>text(r.id)), assessmentIds:(p.assessmentRefs as readonly Record<string,unknown>[]).map((r)=>text(r.id)), contradiction });
}

/** Opens the Design-mandated repeatable-read, read-only transaction. */
export async function verifyRcv022HistoricalEnvelope(envelopeId: string, pool: Rcv022ReadPool | Pool = databasePool): Promise<Rcv022VerifiedHistoricalBundle> {
  const client = await pool.connect(); let active = false;
  try { await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); active=true; const result=await verifyRcv022HistoricalEnvelopeWithinTransaction(client,envelopeId); await client.query("COMMIT"); active=false; return result; }
  catch (error) { if (active) await client.query("ROLLBACK").catch(()=>{}); throw error; }
  finally { client.release(); }
}

export const verifyRcv022HistoricalBundle = verifyRcv022HistoricalEnvelope;
