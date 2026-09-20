import { canonicalizeAndHash, sha256, validateCanonicalTimestamp } from "./canonicalJson";

export interface Rcv022CanonicalResult<T = Record<string, unknown>> {
  readonly value: Readonly<T>;
  readonly canonical: string;
  readonly hash: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const SCHEMAS = {
  fragment: "RCV022-EVIDENCE-FRAGMENT-V1",
  match: "RCV022-CLAIM-EVIDENCE-MATCH-V1",
  assessment: "RCV022-EVIDENCE-ASSESSMENT-V1",
  envelope: "RCV022-SEMANTIC-ANALYSIS-ENVELOPE-V1",
} as const;

function fail(path: string, message: string): never {
  throw new Error(`RCV022 ${path}: ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object");
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  const record = object(value, path);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) fail(path, `unexpected or missing key (expected ${keys.join(",")})`);
  for (const key of keys) if (record[key] === null || record[key] === undefined) fail(`${path}.${key}`, "null/undefined is not allowed");
  return record;
}
function rejectInputExtras(value: unknown, keys: readonly string[], path: string): void {
  const record = object(value, path);
  for (const key of Object.keys(record)) if (!keys.includes(key)) fail(path, `unexpected input key ${key}`);
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "expected non-empty string");
  return value;
}
function uuid(value: unknown, path: string): string { const v = text(value, path); if (!UUID.test(v)) fail(path, "expected lowercase canonical UUID"); return v; }
function hash(value: unknown, path: string): string { const v = text(value, path); if (!HASH.test(v)) fail(path, "expected lowercase SHA-256 hash"); return v; }
function version(value: unknown, path: string): 1 { if (value !== 1) fail(path, "expected canonicalVersion 1"); return 1; }
function integer(value: unknown, path: string, min = 0): number { if (typeof value !== "number" || !Number.isInteger(value) || value < min) fail(path, "expected integer in domain"); return value; }
function timestamp(value: unknown, path: string): string { try { return validateCanonicalTimestamp(value); } catch { fail(path, "expected YYYY-MM-DDTHH:mm:ss.ffffffZ"); } }
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) fail(path, "expected array"); return value; }
function finish<T extends Record<string, unknown>>(value: T): Rcv022CanonicalResult<T> {
  const result = canonicalizeAndHash(value);
  return Object.freeze({ value: Object.freeze(value), canonical: result.canonical, hash: result.hash });
}
function validateHashArray(value: unknown, path: string): string[] {
  return array(value, path).map((entry, i) => hash(entry, `${path}[${i}]`));
}

function validateLocator(value: unknown, fragmentKind: string, path = "locator"): Record<string, unknown> {
  const v = object(value, path); const kind = text(v.kind, `${path}.kind`);
  if (fragmentKind === "TEXT" && !["WHOLE_TEXT", "UTF8_BYTE_RANGE"].includes(kind)) fail(path, "TEXT locator mismatch");
  if (fragmentKind === "STRUCTURED" && kind !== "STRUCTURED_PATH") fail(path, "STRUCTURED locator mismatch");
  if (fragmentKind === "IMAGE_REGION" && kind !== "IMAGE_REGION") fail(path, "IMAGE locator mismatch");
  if (kind === "WHOLE_TEXT") exact(v, ["kind"], path);
  else if (kind === "UTF8_BYTE_RANGE") { const x = exact(v, ["kind", "startByte", "endByteExclusive"], path); integer(x.startByte, `${path}.startByte`); integer(x.endByteExclusive, `${path}.endByteExclusive`, 1); if ((x.endByteExclusive as number) <= (x.startByte as number)) fail(path, "invalid byte range"); }
  else if (kind === "STRUCTURED_PATH") { const x = exact(v, ["kind", "segments"], path); const segments = array(x.segments, `${path}.segments`); for (const [i, raw] of segments.entries()) { const s = object(raw, `${path}.segments[${i}]`); const sk = text(s.kind, `${path}.segments[${i}].kind`); if (sk === "KEY") { const q = exact(s, ["kind", "key"], `${path}.segments[${i}]`); text(q.key, `${path}.segments[${i}].key`); } else if (sk === "INDEX") { const q = exact(s, ["kind", "index"], `${path}.segments[${i}]`); integer(q.index, `${path}.segments[${i}].index`); } else fail(path, "invalid segment kind"); } }
  else if (kind === "IMAGE_REGION") { const x = exact(v, ["kind", "coordinateSystemId", "coordinateSystemVersion", "imageWidth", "imageHeight", "x", "y", "width", "height"], path); if (x.coordinateSystemId !== "raw-pixel-v1" || x.coordinateSystemVersion !== 1) fail(path, "invalid coordinate system"); const w = integer(x.imageWidth, `${path}.imageWidth`, 1), h = integer(x.imageHeight, `${path}.imageHeight`, 1), px = integer(x.x, `${path}.x`), py = integer(x.y, `${path}.y`), rw = integer(x.width, `${path}.width`, 1), rh = integer(x.height, `${path}.height`, 1); if (px + rw > w || py + rh > h) fail(path, "image region outside bounds"); }
  else fail(path, "unsupported locator kind");
  return v;
}

function validateContentBinding(value: unknown, fragmentKind: string, representationHash: string, path = "contentBinding"): Record<string, unknown> {
  const v = object(value, path); const kind = text(v.kind, `${path}.kind`);
  if (kind === "TEXT") { const x = exact(v, ["kind", "utf8Text", "contentHash"], path); if (fragmentKind !== "TEXT") fail(path, "TEXT binding mismatch"); const content = text(x.utf8Text, `${path}.utf8Text`); const contentHash = hash(x.contentHash, `${path}.contentHash`); if (sha256(content) !== contentHash) fail(`${path}.contentHash`, "does not match UTF-8 content bytes"); }
  else if (kind === "STRUCTURED") { const x = exact(v, ["kind", "canonicalVersion", "canonical", "canonicalHash"], path); if (fragmentKind !== "STRUCTURED") fail(path, "STRUCTURED binding mismatch"); version(x.canonicalVersion, `${path}.canonicalVersion`); const structured = text(x.canonical, `${path}.canonical`); const structuredHash = hash(x.canonicalHash, `${path}.canonicalHash`); if (sha256(structured) !== structuredHash) fail(`${path}.canonicalHash`, "does not match canonical UTF-8 bytes"); }
  else if (kind === "IMAGE_REGION") { const x = exact(v, ["kind", "sourceRepresentationHash"], path); if (fragmentKind !== "IMAGE_REGION" || x.sourceRepresentationHash !== representationHash) fail(path, "IMAGE_REGION binding mismatch"); hash(x.sourceRepresentationHash, `${path}.sourceRepresentationHash`); }
  else fail(path, "unsupported content binding kind");
  return v;
}
function validateExtraction(value: unknown, path = "extractionAuthority"): Record<string, unknown> {
  const v = object(value, path); const kind = text(v.kind, `${path}.kind`);
  if (kind === "DIRECT") exact(v, ["kind"], path);
  else if (kind === "DERIVED") { const x = exact(v, ["kind", "extractorIdentity", "extractorVersion", "extractorHash"], path); text(x.extractorIdentity, `${path}.extractorIdentity`); text(x.extractorVersion, `${path}.extractorVersion`); hash(x.extractorHash, `${path}.extractorHash`); }
  else fail(path, "unsupported extraction authority kind");
  return v;
}

export function validateLocatorAndContentBinding(value: { locator: unknown; contentBinding: unknown; fragmentKind: string; captureRepresentationHash: string }): void {
  validateLocator(value.locator, value.fragmentKind); validateContentBinding(value.contentBinding, value.fragmentKind, value.captureRepresentationHash);
}

function validateSampling(value: unknown): Record<string, unknown> {
  const x = exact(value, ["schema", "canonicalVersion", "entries"], "samplingParameters");
  if (x.schema !== "factbase-rcv022-sampling-parameters") fail("samplingParameters.schema", "unsupported schema"); version(x.canonicalVersion, "samplingParameters.canonicalVersion");
  const entries = array(x.entries, "samplingParameters.entries"); let prior: string | undefined;
  for (const [i, raw] of entries.entries()) { const e = exact(raw, ["name", "value"], `samplingParameters.entries[${i}]`); const name = text(e.name, `samplingParameters.entries[${i}].name`); if (prior !== undefined && name <= prior) fail("samplingParameters.entries", "names must be sorted and unique"); prior = name; if (!["string", "number", "boolean"].includes(typeof e.value) || (typeof e.value === "number" && !Number.isFinite(e.value as number))) fail(`samplingParameters.entries[${i}].value`, "expected scalar"); }
  return x;
}
export function canonicalizeSamplingParameters(value: unknown): Rcv022CanonicalResult { return finish(validateSampling(value)); }

const COMMON_HASH_FIELDS = ["methodHash", "structuredOutputHash"] as const;
const REVIEW = ["NOT_REVIEWED", "REVIEWED"];
function validateMethod(value: unknown): Record<string, unknown> {
  const record = object(value, "methodProvenance"); const type = text(record.methodType, "methodProvenance.methodType");
  const common = (keys: readonly string[]) => { const x = exact(record, keys, "methodProvenance"); text(x.methodIdentity, "methodProvenance.methodIdentity"); text(x.methodVersion, "methodProvenance.methodVersion"); for (const k of COMMON_HASH_FIELDS) hash(x[k], `methodProvenance.${k}`); validateHashArray(x.inputCanonicalHashes, "methodProvenance.inputCanonicalHashes"); if (!REVIEW.includes(text(x.reviewStatus, "methodProvenance.reviewStatus"))) fail("methodProvenance.reviewStatus", "unsupported status"); return x; };
  if (type === "DETERMINISTIC") return common(["methodType", "methodIdentity", "methodVersion", "methodHash", "inputCanonicalHashes", "structuredOutputHash", "reviewStatus"]);
  if (type === "HUMAN") { const x = common(["methodType", "methodIdentity", "methodVersion", "methodHash", "reviewerIdentity", "reviewProcessIdentity", "reviewProcessVersion", "reviewProcessHash", "inputCanonicalHashes", "structuredOutputHash", "reviewStatus"]); text(x.reviewerIdentity, "methodProvenance.reviewerIdentity"); text(x.reviewProcessIdentity, "methodProvenance.reviewProcessIdentity"); text(x.reviewProcessVersion, "methodProvenance.reviewProcessVersion"); hash(x.reviewProcessHash, "methodProvenance.reviewProcessHash"); return x; }
  const modelKeys = type === "MODEL_ASSISTED" ? ["methodType", "methodIdentity", "methodVersion", "methodHash", "providerIdentity", "modelIdentity", "modelVersion", "processIdentity", "processVersion", "processHash", "promptTemplateHash", "systemInstructionHash", "samplingParameters", "samplingParametersHash", "inputCanonicalHashes", "rawOutputHash", "structuredOutputHash", "retryIdentity", "reviewStatus", "toolParticipation"] : type === "MIXED" ? ["methodType", "methodIdentity", "methodVersion", "methodHash", "providerIdentity", "modelIdentity", "modelVersion", "processIdentity", "processVersion", "processHash", "promptTemplateHash", "systemInstructionHash", "samplingParameters", "samplingParametersHash", "inputCanonicalHashes", "rawOutputHash", "structuredOutputHash", "retryIdentity", "reviewerIdentity", "reviewProcessIdentity", "reviewProcessVersion", "reviewProcessHash", "reviewStatus", "acceptanceStatus", "toolParticipation"] : undefined;
  if (!modelKeys) fail("methodProvenance.methodType", "unsupported method type");
  const x = exact(record, [...modelKeys, ...(record.toolContextHash !== undefined ? ["toolContextHash"] : [])], "methodProvenance");
  for (const k of ["methodIdentity", "methodVersion", "providerIdentity", "modelIdentity", "modelVersion", "processIdentity", "processVersion", "retryIdentity", ...(type === "MIXED" ? ["reviewerIdentity", "reviewProcessIdentity", "reviewProcessVersion"] : [])]) text(x[k], `methodProvenance.${k}`);
  for (const k of ["methodHash", "processHash", "promptTemplateHash", "systemInstructionHash", "samplingParametersHash", "rawOutputHash", "structuredOutputHash", ...(type === "MIXED" ? ["reviewProcessHash"] : [])]) hash(x[k], `methodProvenance.${k}`);
  validateSampling(x.samplingParameters); const samplingDigest = canonicalizeSamplingParameters(x.samplingParameters).hash; if (x.samplingParametersHash !== samplingDigest) fail("methodProvenance.samplingParametersHash", "does not match samplingParameters JCS SHA-256"); validateHashArray(x.inputCanonicalHashes, "methodProvenance.inputCanonicalHashes"); if (!REVIEW.includes(text(x.reviewStatus, "methodProvenance.reviewStatus"))) fail("methodProvenance.reviewStatus", "unsupported status");
  if (type === "MIXED" && !["PENDING", "ACCEPTED", "REJECTED"].includes(text(x.acceptanceStatus, "methodProvenance.acceptanceStatus"))) fail("methodProvenance.acceptanceStatus", "unsupported status");
  const participation = text(x.toolParticipation, "methodProvenance.toolParticipation"); if (!["USED", "NOT_USED"].includes(participation)) fail("methodProvenance.toolParticipation", "unsupported value");
  if (participation === "USED") { if (!("toolContextHash" in x)) fail("methodProvenance.toolContextHash", "required for USED"); hash(x.toolContextHash, "methodProvenance.toolContextHash"); } else if ("toolContextHash" in x) fail("methodProvenance.toolContextHash", "forbidden for NOT_USED");
  return x;
}
export function validateMethodProvenance(value: unknown): Record<string, unknown> { return validateMethod(value); }

export interface EvidenceFragmentInput { fragmentId: string; captureId: string; captureCanonicalVersion: string; captureCanonicalHash: string; captureRepresentationHash: string; fragmentKind: "TEXT" | "STRUCTURED" | "IMAGE_REGION"; locator: unknown; contentBinding: unknown; extractionAuthority: unknown; canonicalVersion?: 1; }
export function buildEvidenceFragmentCanonical(input: EvidenceFragmentInput): Rcv022CanonicalResult {
  rejectInputExtras(input, ["canonicalVersion", "fragmentId", "captureId", "captureCanonicalVersion", "captureCanonicalHash", "captureRepresentationHash", "fragmentKind", "locator", "contentBinding", "extractionAuthority"], "fragment");
  const v = exact({ schema: SCHEMAS.fragment, canonicalVersion: Object.prototype.hasOwnProperty.call(input, "canonicalVersion") ? input.canonicalVersion : 1, fragmentId: input.fragmentId, captureId: input.captureId, captureCanonicalVersion: input.captureCanonicalVersion, captureCanonicalHash: input.captureCanonicalHash, captureRepresentationHash: input.captureRepresentationHash, fragmentKind: input.fragmentKind, locator: input.locator, contentBinding: input.contentBinding, extractionAuthority: input.extractionAuthority }, ["schema", "canonicalVersion", "fragmentId", "captureId", "captureCanonicalVersion", "captureCanonicalHash", "captureRepresentationHash", "fragmentKind", "locator", "contentBinding", "extractionAuthority"], "fragment");
  version(v.canonicalVersion, "canonicalVersion"); uuid(v.fragmentId, "fragmentId"); uuid(v.captureId, "captureId"); text(v.captureCanonicalVersion, "captureCanonicalVersion"); hash(v.captureCanonicalHash, "captureCanonicalHash"); hash(v.captureRepresentationHash, "captureRepresentationHash"); if (!["TEXT", "STRUCTURED", "IMAGE_REGION"].includes(text(v.fragmentKind, "fragmentKind"))) fail("fragmentKind", "unsupported"); validateLocatorAndContentBinding({ locator: v.locator, contentBinding: v.contentBinding, fragmentKind: v.fragmentKind as string, captureRepresentationHash: v.captureRepresentationHash as string }); validateExtraction(v.extractionAuthority); return finish(v);
}

export interface ClaimEvidenceMatchInput { matchId: string; claimId: string; claimCanonicalVersion: 1; claimCanonicalHash: string; claimVersionId: string; claimVersionCanonicalVersion: 1; claimVersionCanonicalHash: string; evidenceFragmentId: string; evidenceFragmentCanonicalVersion: 1; evidenceFragmentCanonicalHash: string; matcherIdentity: string; matcherVersion: string; matcherHash: string; matcherInputCanonicalHashes: unknown; canonicalVersion?: 1; }
export function buildClaimEvidenceMatchCanonical(input: ClaimEvidenceMatchInput): Rcv022CanonicalResult {
  rejectInputExtras(input, ["canonicalVersion", "matchId", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "evidenceFragmentId", "evidenceFragmentCanonicalVersion", "evidenceFragmentCanonicalHash", "matcherIdentity", "matcherVersion", "matcherHash", "matcherInputCanonicalHashes"], "match");
  const v = exact({ schema: SCHEMAS.match, canonicalVersion: Object.prototype.hasOwnProperty.call(input, "canonicalVersion") ? input.canonicalVersion : 1, matchId: input.matchId, claimId: input.claimId, claimCanonicalVersion: input.claimCanonicalVersion, claimCanonicalHash: input.claimCanonicalHash, claimVersionId: input.claimVersionId, claimVersionCanonicalVersion: input.claimVersionCanonicalVersion, claimVersionCanonicalHash: input.claimVersionCanonicalHash, evidenceFragmentId: input.evidenceFragmentId, evidenceFragmentCanonicalVersion: input.evidenceFragmentCanonicalVersion, evidenceFragmentCanonicalHash: input.evidenceFragmentCanonicalHash, matcherIdentity: input.matcherIdentity, matcherVersion: input.matcherVersion, matcherHash: input.matcherHash, matcherInputCanonicalHashes: input.matcherInputCanonicalHashes }, ["schema", "canonicalVersion", "matchId", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "evidenceFragmentId", "evidenceFragmentCanonicalVersion", "evidenceFragmentCanonicalHash", "matcherIdentity", "matcherVersion", "matcherHash", "matcherInputCanonicalHashes"], "match");
  version(v.canonicalVersion, "canonicalVersion"); for (const k of ["matchId", "claimId", "claimVersionId", "evidenceFragmentId"]) uuid(v[k], k); for (const k of ["claimCanonicalVersion", "claimVersionCanonicalVersion", "evidenceFragmentCanonicalVersion"]) version(v[k], k); for (const k of ["claimCanonicalHash", "claimVersionCanonicalHash", "evidenceFragmentCanonicalHash", "matcherHash"]) hash(v[k], k); text(v.matcherIdentity, "matcherIdentity"); text(v.matcherVersion, "matcherVersion"); validateHashArray(v.matcherInputCanonicalHashes, "matcherInputCanonicalHashes"); return finish(v);
}

export interface EvidenceAssessmentInput { assessmentId: string; claimEvidenceMatchId: string; claimEvidenceMatchCanonicalVersion: 1; claimEvidenceMatchCanonicalHash: string; claimId: string; claimCanonicalVersion: 1; claimCanonicalHash: string; claimVersionId: string; claimVersionCanonicalVersion: 1; claimVersionCanonicalHash: string; evidenceFragmentId: string; evidenceFragmentCanonicalVersion: 1; evidenceFragmentCanonicalHash: string; assessmentResult: unknown; methodProvenance: unknown; assessedAt: string; canonicalVersion?: 1; }
export function buildEvidenceAssessmentCanonical(input: EvidenceAssessmentInput): Rcv022CanonicalResult {
  rejectInputExtras(input, ["canonicalVersion", "assessmentId", "claimEvidenceMatchId", "claimEvidenceMatchCanonicalVersion", "claimEvidenceMatchCanonicalHash", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "evidenceFragmentId", "evidenceFragmentCanonicalVersion", "evidenceFragmentCanonicalHash", "assessmentResult", "methodProvenance", "assessedAt"], "assessment");
  const v = exact({ schema: SCHEMAS.assessment, canonicalVersion: Object.prototype.hasOwnProperty.call(input, "canonicalVersion") ? input.canonicalVersion : 1, assessmentId: input.assessmentId, claimEvidenceMatchId: input.claimEvidenceMatchId, claimEvidenceMatchCanonicalVersion: input.claimEvidenceMatchCanonicalVersion, claimEvidenceMatchCanonicalHash: input.claimEvidenceMatchCanonicalHash, claimId: input.claimId, claimCanonicalVersion: input.claimCanonicalVersion, claimCanonicalHash: input.claimCanonicalHash, claimVersionId: input.claimVersionId, claimVersionCanonicalVersion: input.claimVersionCanonicalVersion, claimVersionCanonicalHash: input.claimVersionCanonicalHash, evidenceFragmentId: input.evidenceFragmentId, evidenceFragmentCanonicalVersion: input.evidenceFragmentCanonicalVersion, evidenceFragmentCanonicalHash: input.evidenceFragmentCanonicalHash, assessmentResult: input.assessmentResult, methodProvenance: input.methodProvenance, assessedAt: input.assessedAt }, ["schema", "canonicalVersion", "assessmentId", "claimEvidenceMatchId", "claimEvidenceMatchCanonicalVersion", "claimEvidenceMatchCanonicalHash", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "evidenceFragmentId", "evidenceFragmentCanonicalVersion", "evidenceFragmentCanonicalHash", "assessmentResult", "methodProvenance", "assessedAt"], "assessment");
  version(v.canonicalVersion, "canonicalVersion"); for (const k of ["assessmentId", "claimEvidenceMatchId", "claimId", "claimVersionId", "evidenceFragmentId"]) uuid(v[k], k); for (const k of ["claimEvidenceMatchCanonicalVersion", "claimCanonicalVersion", "claimVersionCanonicalVersion", "evidenceFragmentCanonicalVersion"]) version(v[k], k); for (const k of ["claimEvidenceMatchCanonicalHash", "claimCanonicalHash", "claimVersionCanonicalHash", "evidenceFragmentCanonicalHash"]) hash(v[k], k); const ar = exact(v.assessmentResult, ["relation", "rationale"], "assessmentResult"); if (!["SUPPORTS", "REFUTES", "INSUFFICIENT", "UNRELATED"].includes(text(ar.relation, "assessmentResult.relation"))) fail("assessmentResult.relation", "unsupported"); text(ar.rationale, "assessmentResult.rationale"); validateMethod(v.methodProvenance); timestamp(v.assessedAt, "assessedAt"); return finish(v);
}

export interface EnvelopeRef { id: string; canonicalVersion: 1; canonicalHash: string; }
export interface SemanticAnalysisEnvelopeInput { envelopeId: string; claimId: string; claimCanonicalVersion: 1; claimCanonicalHash: string; claimVersionId: string; claimVersionCanonicalVersion: 1; claimVersionCanonicalHash: string; analysisCutoffAt: string; analysisAt: string; matchRefs: readonly EnvelopeRef[]; assessmentRefs: readonly EnvelopeRef[]; analysisMethodIdentity: string; analysisMethodVersion: string; analysisMethodHash: string; canonicalVersion?: 1; }
function refs(value: unknown, path: string): EnvelopeRef[] { const rows = array(value, path).map((raw, i) => { const x = exact(raw, ["id", "canonicalVersion", "canonicalHash"], `${path}[${i}]`); return { id: uuid(x.id, `${path}[${i}].id`), canonicalVersion: version(x.canonicalVersion, `${path}[${i}].canonicalVersion`), canonicalHash: hash(x.canonicalHash, `${path}[${i}].canonicalHash`) }; }); const seen = new Set<string>(); for (const r of rows) { if (seen.has(r.id)) fail(path, "duplicate member"); seen.add(r.id); } return rows; }
export function buildSemanticAnalysisEnvelopeCanonical(input: SemanticAnalysisEnvelopeInput): Rcv022CanonicalResult {
  rejectInputExtras(input, ["canonicalVersion", "envelopeId", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "analysisCutoffAt", "analysisAt", "matchRefs", "assessmentRefs", "analysisMethodIdentity", "analysisMethodVersion", "analysisMethodHash"], "envelope");
  const v = exact({ schema: SCHEMAS.envelope, canonicalVersion: Object.prototype.hasOwnProperty.call(input, "canonicalVersion") ? input.canonicalVersion : 1, envelopeId: input.envelopeId, claimId: input.claimId, claimCanonicalVersion: input.claimCanonicalVersion, claimCanonicalHash: input.claimCanonicalHash, claimVersionId: input.claimVersionId, claimVersionCanonicalVersion: input.claimVersionCanonicalVersion, claimVersionCanonicalHash: input.claimVersionCanonicalHash, analysisCutoffAt: input.analysisCutoffAt, analysisAt: input.analysisAt, matchRefs: input.matchRefs, assessmentRefs: input.assessmentRefs, analysisMethodIdentity: input.analysisMethodIdentity, analysisMethodVersion: input.analysisMethodVersion, analysisMethodHash: input.analysisMethodHash }, ["schema", "canonicalVersion", "envelopeId", "claimId", "claimCanonicalVersion", "claimCanonicalHash", "claimVersionId", "claimVersionCanonicalVersion", "claimVersionCanonicalHash", "analysisCutoffAt", "analysisAt", "matchRefs", "assessmentRefs", "analysisMethodIdentity", "analysisMethodVersion", "analysisMethodHash"], "envelope");
  version(v.canonicalVersion, "canonicalVersion"); for (const k of ["envelopeId", "claimId", "claimVersionId"]) uuid(v[k], k); for (const k of ["claimCanonicalVersion", "claimVersionCanonicalVersion"]) version(v[k], k); for (const k of ["claimCanonicalHash", "claimVersionCanonicalHash", "analysisMethodHash"]) hash(v[k], k); const mr = refs(v.matchRefs, "matchRefs"), ar = refs(v.assessmentRefs, "assessmentRefs"); if (mr.length === 0 && ar.length !== 0) fail("assessmentRefs", "zero Matches require zero Assessments"); timestamp(v.analysisCutoffAt, "analysisCutoffAt"); timestamp(v.analysisAt, "analysisAt"); text(v.analysisMethodIdentity, "analysisMethodIdentity"); text(v.analysisMethodVersion, "analysisMethodVersion"); return finish({ ...v, matchRefs: mr, assessmentRefs: ar });
}
