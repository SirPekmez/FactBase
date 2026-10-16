import databasePool from "../db";
import { canonicalizeJson } from "./canonicalJson";
import { canonicalizeRcv020Capture } from "./rcv020SemanticCore";
import {
  buildClaimEvidenceMatchCanonical,
  buildEvidenceAssessmentCanonical,
  buildEvidenceFragmentCanonical,
  buildSemanticAnalysisEnvelopeCanonical,
} from "./rcv022Canonical";
import {
  buildClaimIdentityCanonical,
  buildClaimVersionCanonical,
} from "./claimHistoricalAuthorityCanonical";

const CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION = 1 as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type ClaimLevelEvidenceViewInputFailureCode =
  | "MALFORMED_VIEW_SPEC"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "DUPLICATE_ENVELOPE_REF";

export class ClaimLevelEvidenceViewInputError extends Error {
  readonly name = "ClaimLevelEvidenceViewInputError";

  constructor(
    readonly code: ClaimLevelEvidenceViewInputFailureCode,
    readonly path: string,
    readonly detail: string,
  ) {
    super(`${code} at ${path}: ${detail}`);
  }
}

export interface ClaimVersionRef {
  readonly claimVersionId: string;
  readonly canonicalVersion: 1;
  readonly canonicalHash: string;
}

export interface EnvelopeRef {
  readonly envelopeId: string;
  readonly canonicalVersion: 1;
  readonly canonicalHash: string;
}

export interface ClaimLevelEvidenceViewSpec {
  readonly claimVersionRef: ClaimVersionRef;
  readonly envelopeManifest: readonly EnvelopeRef[];
  readonly contractVersion: 1;
}

function fail(
  code: ClaimLevelEvidenceViewInputFailureCode,
  path: string,
  message: string,
): never {
  throw new ClaimLevelEvidenceViewInputError(code, path, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("MALFORMED_VIEW_SPEC", path, "expected a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("MALFORMED_VIEW_SPEC", path, "expected a plain object");
  }
  return value as Record<string, unknown>;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const object = record(value, path);
  const ownKeys = Reflect.ownKeys(object);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail("MALFORMED_VIEW_SPEC", path, "symbol properties are not allowed");
  }
  const actual = (ownKeys as string[]).slice().sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail("MALFORMED_VIEW_SPEC", path, `expected exactly: ${keys.join(", ")}`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !("value" in descriptor)) {
      fail("MALFORMED_VIEW_SPEC", `${path}.${key}`, "accessors are not allowed");
    }
    if (descriptor.value === null || descriptor.value === undefined) {
      fail("MALFORMED_VIEW_SPEC", `${path}.${key}`, "null/undefined is not allowed");
    }
  }
  return object;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    fail("MALFORMED_VIEW_SPEC", path, "expected lowercase canonical UUID");
  }
  return value;
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("MALFORMED_VIEW_SPEC", path, "expected lowercase SHA-256 hash");
  }
  return value;
}

function version(value: unknown, path: string): 1 {
  if (value !== 1) {
    fail("MALFORMED_VIEW_SPEC", path, "expected canonicalVersion 1");
  }
  return 1;
}

function compareBytes(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function compareEnvelopeRefs(left: EnvelopeRef, right: EnvelopeRef): number {
  return (
    compareBytes(left.envelopeId, right.envelopeId) ||
    left.canonicalVersion - right.canonicalVersion ||
    compareBytes(left.canonicalHash, right.canonicalHash)
  );
}

type StructuralFailure = {
  code: ClaimLevelEvidenceViewInputFailureCode;
  path: string;
  detail: string;
  selectionKey: string;
};

function stableStructuralPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

function structuralFailure(
  error: ClaimLevelEvidenceViewInputError,
): StructuralFailure {
  const path = stableStructuralPath(error.path);
  return {
    code: error.code,
    path,
    detail: error.detail,
    selectionKey: `${path}\u0000${error.code}\u0000${error.detail}`,
  };
}

function selectStructuralFailure(failures: StructuralFailure[]): never {
  const winner = failures
    .slice()
    .sort((left, right) => compareBytes(left.selectionKey, right.selectionKey))[0];
  fail(winner.code, winner.path, winner.detail);
}

function cloneClaimVersionRef(value: unknown): ClaimVersionRef {
  const object = exactRecord(
    value,
    ["claimVersionId", "canonicalVersion", "canonicalHash"],
    "claimVersionRef",
  );
  return Object.freeze({
    claimVersionId: uuid(object.claimVersionId, "claimVersionRef.claimVersionId"),
    canonicalVersion: version(
      object.canonicalVersion,
      "claimVersionRef.canonicalVersion",
    ),
    canonicalHash: hash(
      object.canonicalHash,
      "claimVersionRef.canonicalHash",
    ),
  });
}

function cloneEnvelopeRef(value: unknown, path: string): EnvelopeRef {
  const object = exactRecord(
    value,
    ["envelopeId", "canonicalVersion", "canonicalHash"],
    path,
  );
  return Object.freeze({
    envelopeId: uuid(object.envelopeId, `${path}.envelopeId`),
    canonicalVersion: version(
      object.canonicalVersion,
      `${path}.canonicalVersion`,
    ),
    canonicalHash: hash(object.canonicalHash, `${path}.canonicalHash`),
  });
}

function cloneAndCanonicalizeEnvelopeManifest(value: unknown): readonly EnvelopeRef[] {
  if (!Array.isArray(value)) {
    fail("MALFORMED_VIEW_SPEC", "envelopeManifest", "expected an array");
  }

  const refs: EnvelopeRef[] = [];
  const byId = new Map<string, EnvelopeRef>();
  const failures: StructuralFailure[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let ref: EnvelopeRef;
    try {
      ref = cloneEnvelopeRef(value[index], `envelopeManifest[${index}]`);
    } catch (error) {
      if (!(error instanceof ClaimLevelEvidenceViewInputError)) throw error;
      failures.push(structuralFailure(error));
      continue;
    }
    const previous = byId.get(ref.envelopeId);
    if (previous) {
      const detail =
        previous.canonicalVersion === ref.canonicalVersion &&
        previous.canonicalHash === ref.canonicalHash
          ? "duplicate EnvelopeRef"
          : "conflicting references for one envelopeId";
      const path = stableStructuralPath(
        `envelopeManifest[${index}].envelopeId`,
      );
      failures.push({
        code: "DUPLICATE_ENVELOPE_REF",
        path,
        detail,
        selectionKey: `${path}\u0000DUPLICATE_ENVELOPE_REF\u0000${detail}`,
      });
      continue;
    }
    byId.set(ref.envelopeId, ref);
    refs.push(ref);
  }

  if (failures.length > 0) selectStructuralFailure(failures);

  refs.sort(compareEnvelopeRefs);
  return Object.freeze(refs);
}

/**
 * Wave A structural boundary. This function performs no database access and
 * does not authenticate any historical RCV-022 authority.
 */
export function prepareClaimLevelEvidenceViewSpec(
  value: unknown,
): ClaimLevelEvidenceViewSpec {
  const object = exactRecord(
    value,
    ["claimVersionRef", "envelopeManifest", "contractVersion"],
    "viewSpec",
  );
  if (object.contractVersion !== CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION) {
    fail(
      "UNSUPPORTED_CONTRACT_VERSION",
      "contractVersion",
      `expected ${CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION}`,
    );
  }

  return Object.freeze({
    claimVersionRef: cloneClaimVersionRef(object.claimVersionRef),
    envelopeManifest: cloneAndCanonicalizeEnvelopeManifest(
      object.envelopeManifest,
    ),
    contractVersion: CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION,
  });
}

export type ClaimLevelEvidenceViewVerificationCode =
  | "MISSING_AUTHORITY"
  | "UNSUPPORTED_VERSION"
  | "MALFORMED_DATA"
  | "IDENTITY_MISMATCH"
  | "LINEAGE_MISMATCH"
  | "CANONICAL_MISMATCH"
  | "HASH_MISMATCH"
  | "FRAGMENT_BOUNDARY_MISMATCH"
  | "CLAIM_SCOPE_MISMATCH"
  | "TEMPORAL_CONTEXT_MISMATCH"
  | "METHOD_AUTHORITY_MISMATCH"
  | "INVALID_RELATION"
  | "DUPLICATE_CONFLICT";

export class ClaimLevelEvidenceViewVerificationError extends Error {
  readonly name = "ClaimLevelEvidenceViewVerificationError";

  constructor(
    readonly code: ClaimLevelEvidenceViewVerificationCode,
    readonly path: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`${code} at ${path}: ${message}`);
  }
}

export interface ClaimLevelEvidenceViewReadClient {
  query(text: string, values?: readonly unknown[]): Promise<{ readonly rows?: readonly Row[] }>;
  release(): void;
}
export interface ClaimLevelEvidenceViewReadPool {
  connect(): Promise<ClaimLevelEvidenceViewReadClient>;
}

export interface AssessmentReference {
  readonly assessmentId: string;
  readonly canonicalVersion: 1;
  readonly canonicalHash: string;
}

export interface MatchReference {
  readonly matchId: string;
  readonly canonicalVersion: 1;
  readonly canonicalHash: string;
}

export interface FragmentReference {
  readonly fragmentId: string;
  readonly canonicalVersion: 1;
  readonly canonicalHash: string;
}

export interface AssessmentProjection {
  readonly assessmentRef: AssessmentReference;
  readonly claimEvidenceMatchRef: MatchReference;
  readonly evidenceFragmentRef: FragmentReference;
  readonly claimVersionRef: ClaimVersionRef;
  readonly relation: "SUPPORTS" | "REFUTES" | "INSUFFICIENT" | "UNRELATED";
  readonly rationale: string;
  readonly methodProvenance: Readonly<Record<string, unknown>>;
  readonly assessedAt: string;
}

export interface AssessmentOccurrence {
  readonly envelopeRef: EnvelopeRef;
  readonly assessmentRef: AssessmentReference;
  readonly ordinal: number;
}

export interface EnvelopeProvenance {
  readonly envelopeRef: EnvelopeRef;
  readonly claimVersionRef: ClaimVersionRef;
  readonly analysisCutoffAt: string;
  readonly analysisAt: string;
  readonly analysisMethodIdentity: string;
  readonly analysisMethodVersion: string;
  readonly analysisMethodHash: string;
}

export interface ClaimLevelEvidenceViewResult {
  readonly claimVersionRef: ClaimVersionRef;
  readonly envelopeManifest: readonly EnvelopeRef[];
  readonly assessmentManifest: readonly AssessmentProjection[];
  readonly occurrenceManifest: readonly AssessmentOccurrence[];
  readonly envelopeProvenance: readonly EnvelopeProvenance[];
  readonly scopeEnumeration: {
    readonly scopeKind: "EXPLICIT_ENVELOPE_SET";
    readonly status: "ENUMERATED_AND_CONSIDERED";
  };
}

type Row = Record<string, unknown>;

function verifyFail(
  code: ClaimLevelEvidenceViewVerificationCode,
  path: string,
  message: string,
  cause?: unknown,
): never {
  throw new ClaimLevelEvidenceViewVerificationError(code, path, message, cause);
}

function asText(value: unknown, path: string): string {
  if (typeof value !== "string") verifyFail("MALFORMED_DATA", path, "expected text");
  return value;
}

function asObject(value: unknown, path: string): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    verifyFail("MALFORMED_DATA", path, "expected object");
  }
  return value as Row;
}

function parseCanonical(row: Row, path: string): Row {
  const canonical = asText(row.canonical, `${path}.canonical`);
  const suppliedHash = asText(row.canonical_hash, `${path}.canonical_hash`);
  if (!SHA256.test(suppliedHash)) verifyFail("MALFORMED_DATA", `${path}.canonical_hash`, "expected lowercase SHA-256");
  let parsed: unknown;
  try { parsed = JSON.parse(canonical); } catch (error) { verifyFail("MALFORMED_DATA", `${path}.canonical`, "invalid JSON", error); }
  const object = asObject(parsed, `${path}.canonical`);
  let expectedCanonical: string;
  try { expectedCanonical = canonicalizeJson(object); } catch (error) { verifyFail("MALFORMED_DATA", `${path}.canonical`, "canonical JSON is not JCS", error); }
  if (expectedCanonical !== canonical) verifyFail("CANONICAL_MISMATCH", `${path}.canonical`, "stored canonical is not exact JCS");
  const expectedHash = createSha256(canonical);
  if (expectedHash !== suppliedHash) verifyFail("HASH_MISMATCH", `${path}.canonical_hash`, "stored hash differs from canonical UTF-8 bytes");
  return object;
}

function createSha256(value: string): string {
  // Keep the hash primitive local so verification does not depend on Reader state.
  return require("node:crypto").createHash("sha256").update(value, "utf8").digest("hex") as string;
}

function compareValue(actual: unknown, expected: unknown, path: string, code: ClaimLevelEvidenceViewVerificationCode = "LINEAGE_MISMATCH"): void {
  if (typeof actual === "object" || typeof expected === "object") {
    let actualCanonical: string;
    let expectedCanonical: string;
    try { actualCanonical = canonicalizeJson(actual); expectedCanonical = canonicalizeJson(expected); } catch (error) { verifyFail("MALFORMED_DATA", path, "cannot compare JSON projection", error); }
    if (actualCanonical !== expectedCanonical) verifyFail(code, path, "persisted projection differs from authenticated authority");
    return;
  }
  if (String(actual) !== String(expected)) verifyFail(code, path, "persisted projection differs from authenticated authority");
}

async function one(client: ClaimLevelEvidenceViewReadClient, sql: string, values: readonly unknown[], path: string): Promise<Row> {
  const result = await client.query(sql, values);
  const rows = result.rows as readonly Row[] | undefined;
  if (!rows || rows.length === 0) verifyFail("MISSING_AUTHORITY", path, "historical authority row is missing");
  if (rows.length !== 1) verifyFail("DUPLICATE_CONFLICT", path, "multiple historical authority rows exist");
  return rows[0];
}

async function many(client: ClaimLevelEvidenceViewReadClient, sql: string, values: readonly unknown[]): Promise<readonly Row[]> {
  const result = await client.query(sql, values);
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Claim-Level membership query result must be an object with a rows array");
  }
  const rows = result.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Claim-Level membership query result must be an object with a rows array");
  }
  return rows;
}

function assertVersion(value: unknown, path: string): 1 {
  if (value !== 1) verifyFail("UNSUPPORTED_VERSION", path, "unsupported canonical version");
  return 1;
}

function assertUuid(value: unknown, path: string): string {
  const result = asText(value, path);
  if (!UUID.test(result)) verifyFail("MALFORMED_DATA", path, "expected lowercase UUID");
  return result;
}

function assertHash(value: unknown, path: string): string {
  const result = asText(value, path);
  if (!SHA256.test(result)) verifyFail("MALFORMED_DATA", path, "expected lowercase SHA-256");
  return result;
}

function assertTimestamp(value: unknown, path: string): string {
  const result = asText(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(result)) verifyFail("MALFORMED_DATA", path, "expected canonical UTC timestamp");
  return result;
}

function reconstruct<T>(path: string, build: () => T): T {
  try {
    return build();
  } catch (error) {
    verifyFail("MALFORMED_DATA", path, "historical authority projection is malformed", error);
  }
}

function canonicalRefs(value: unknown, path: string): readonly { id: string; canonicalVersion: 1; canonicalHash: string }[] {
  if (!Array.isArray(value)) verifyFail("MALFORMED_DATA", path, "expected array");
  return value.map((raw, index) => {
    const ref = asObject(raw, `${path}[${index}]`);
    return {
      id: assertUuid(ref.id, `${path}[${index}].id`),
      canonicalVersion: assertVersion(ref.canonicalVersion, `${path}[${index}].canonicalVersion`),
      canonicalHash: assertHash(ref.canonicalHash, `${path}[${index}].canonicalHash`),
    };
  });
}

async function authenticateClaimAndVersion(client: ClaimLevelEvidenceViewReadClient, ref: ClaimVersionRef): Promise<{ readonly row: Row; readonly claimId: string; readonly claimCanonicalHash: string }> {
  const versionRow = await one(client, `SELECT claim_version_id::text AS claim_version_id, claim_id::text AS claim_id, version_number, title, normalized_statement, language, claim_type, canonical_version, canonical, canonical_hash FROM public.claim_version_authorities WHERE claim_version_id=$1`, [ref.claimVersionId], "claimVersion");
  const parsed = parseCanonical(versionRow, "claimVersion");
  assertVersion(versionRow.canonical_version, "claimVersion.canonical_version");
  assertVersion(parsed.canonicalVersion, "claimVersion.canonicalVersion");
  const claimVersionId = assertUuid(versionRow.claim_version_id, "claimVersion.claim_version_id");
  const claimId = assertUuid(versionRow.claim_id, "claimVersion.claim_id");
  const expectedVersion = reconstruct("claimVersion", () => buildClaimVersionCanonical({
    claimId,
    claimVersionId,
    versionNumber: Number(versionRow.version_number),
    title: asText(versionRow.title, "claimVersion.title"),
    normalizedStatement: asText(versionRow.normalized_statement, "claimVersion.normalized_statement"),
    language: asText(versionRow.language, "claimVersion.language"),
    claimType: asText(versionRow.claim_type, "claimVersion.claim_type"),
  }));
  if (expectedVersion.canonical !== versionRow.canonical) verifyFail("CANONICAL_MISMATCH", "claimVersion.canonical", "ClaimVersion canonical reconstruction differs");
  if (expectedVersion.hash !== versionRow.canonical_hash) verifyFail("HASH_MISMATCH", "claimVersion.canonical_hash", "ClaimVersion canonical hash differs");
  compareValue(claimVersionId, ref.claimVersionId, "claimVersion.claim_version_id", "IDENTITY_MISMATCH");
  compareValue(versionRow.canonical_version, ref.canonicalVersion, "claimVersion.canonical_version", "LINEAGE_MISMATCH");
  compareValue(versionRow.canonical_hash, ref.canonicalHash, "claimVersion.canonical_hash", "HASH_MISMATCH");
  const claimRow = await one(client, "SELECT claim_id::text AS claim_id, canonical_version, canonical, canonical_hash FROM public.claim_identity_authorities WHERE claim_id=$1", [claimId], "claim");
  const claimParsed = parseCanonical(claimRow, "claim");
  assertVersion(claimRow.canonical_version, "claim.canonical_version");
  const expectedClaim = reconstruct("claim", () => buildClaimIdentityCanonical({ claimId }));
  if (expectedClaim.canonical !== claimRow.canonical) verifyFail("CANONICAL_MISMATCH", "claim.canonical", "Claim canonical reconstruction differs");
  if (expectedClaim.hash !== claimRow.canonical_hash) verifyFail("HASH_MISMATCH", "claim.canonical_hash", "Claim canonical hash differs");
  compareValue(claimParsed.claimId, claimId, "claim.claimId", "IDENTITY_MISMATCH");
  return { row: versionRow, claimId, claimCanonicalHash: asText(claimRow.canonical_hash, "claim.canonical_hash") };
}

type AuthenticatedFragment = { row: Row; parsed: Row; ref: FragmentReference };
type AuthenticatedMatch = { row: Row; parsed: Row; ref: MatchReference; fragment: AuthenticatedFragment };
type AuthenticatedAssessment = { row: Row; parsed: Row; ref: AssessmentReference; match: AuthenticatedMatch; projection: AssessmentProjection };

async function authenticateFragment(client: ClaimLevelEvidenceViewReadClient, id: string, cache: Map<string, AuthenticatedFragment>): Promise<AuthenticatedFragment> {
  const existing = cache.get(id); if (existing) return existing;
  const row = await one(client, `SELECT fragment_id::text AS fragment_id, canonical_version, canonical, canonical_hash, capture_id::text AS capture_id, capture_canonical_version, capture_canonical_hash, capture_representation_hash, fragment_kind, locator, content_binding, extraction_authority FROM public.rcv022_evidence_fragments WHERE fragment_id=$1`, [id], "evidenceFragment");
  const parsed = parseCanonical(row, "evidenceFragment");
  assertVersion(row.canonical_version, "evidenceFragment.canonical_version");
  const fragmentId = assertUuid(row.fragment_id, "evidenceFragment.fragment_id");
  const input = {
    fragmentId,
    captureId: assertUuid(row.capture_id, "evidenceFragment.capture_id"),
    captureCanonicalVersion: asText(row.capture_canonical_version, "evidenceFragment.capture_canonical_version"),
    captureCanonicalHash: assertHash(row.capture_canonical_hash, "evidenceFragment.capture_canonical_hash"),
    captureRepresentationHash: assertHash(row.capture_representation_hash, "evidenceFragment.capture_representation_hash"),
    fragmentKind: asText(row.fragment_kind, "evidenceFragment.fragment_kind") as "TEXT" | "STRUCTURED" | "IMAGE_REGION",
    locator: row.locator,
    contentBinding: row.content_binding,
    extractionAuthority: row.extraction_authority,
  };
  const built = reconstruct("evidenceFragment", () => buildEvidenceFragmentCanonical(input));
  if (built.canonical !== row.canonical) verifyFail("CANONICAL_MISMATCH", "evidenceFragment.canonical", "Fragment canonical reconstruction differs");
  if (built.hash !== row.canonical_hash) verifyFail("HASH_MISMATCH", "evidenceFragment.canonical_hash", "Fragment canonical hash differs");
  compareValue(parsed.fragmentId, fragmentId, "evidenceFragment.fragmentId");
  const captureRow = await one(client, `SELECT capture_id::text AS capture_id, logical_source_id::text AS logical_source_id, monitor_id::text AS monitor_id, monitor_configuration_version_id::text AS monitor_configuration_version_id, occurrence_id::text AS occurrence_id, retrieval_attempt_id::text AS retrieval_attempt_id, request_hash, requested_target, final_url, redirect_canonical, response_status, response_metadata_canonical, media_type, byte_length::text AS byte_length, to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at, content_hash, canonical, capture_hash, retention_policy, retention_policy_version, raw_object_identity, raw_object_reference FROM public.rcv020_captures WHERE capture_id=$1`, [input.captureId], "evidenceFragment.capture");
  const capture = reconstruct("evidenceFragment.capture", () => canonicalizeRcv020Capture({
    captureId: asText(captureRow.capture_id, "capture.capture_id"), logicalSourceId: asText(captureRow.logical_source_id, "capture.logical_source_id"), monitorId: asText(captureRow.monitor_id, "capture.monitor_id"), monitorConfigurationVersionId: asText(captureRow.monitor_configuration_version_id, "capture.monitor_configuration_version_id"), occurrenceId: asText(captureRow.occurrence_id, "capture.occurrence_id"), retrievalAttemptId: asText(captureRow.retrieval_attempt_id, "capture.retrieval_attempt_id"), observedAt: asText(captureRow.observed_at, "capture.observed_at"), contentHash: asText(captureRow.content_hash, "capture.content_hash"), byteLength: asText(captureRow.byte_length, "capture.byte_length"), rawObjectIdentity: captureRow.raw_object_identity == null ? null : asText(captureRow.raw_object_identity, "capture.raw_object_identity"), requestHash: asText(captureRow.request_hash, "capture.request_hash"), requestedTarget: asText(captureRow.requested_target, "capture.requested_target"), finalUrl: captureRow.final_url == null ? null : asText(captureRow.final_url, "capture.final_url"), redirectCanonical: captureRow.redirect_canonical == null ? null : asText(captureRow.redirect_canonical, "capture.redirect_canonical"), responseStatus: Number(captureRow.response_status), responseMetadataCanonical: asText(captureRow.response_metadata_canonical, "capture.response_metadata_canonical"), mediaType: asText(captureRow.media_type, "capture.media_type"), retentionPolicy: asText(captureRow.retention_policy, "capture.retention_policy"), retentionPolicyVersion: Number(captureRow.retention_policy_version),
    rawObjectReference: captureRow.raw_object_reference == null ? null : asText(captureRow.raw_object_reference, "capture.raw_object_reference"),
  } as never));
  if (capture.canonical !== captureRow.canonical) verifyFail("CANONICAL_MISMATCH", "evidenceFragment.capture.canonical", "Capture canonical reconstruction differs");
  if (capture.hash !== captureRow.capture_hash) verifyFail("HASH_MISMATCH", "evidenceFragment.capture.capture_hash", "Capture canonical hash differs");
  compareValue(captureRow.capture_id, input.captureId, "evidenceFragment.capture.capture_id", "IDENTITY_MISMATCH");
  compareValue(captureRow.capture_hash, input.captureCanonicalHash, "evidenceFragment.capture.capture_hash", "HASH_MISMATCH");
  compareValue(captureRow.content_hash, input.captureRepresentationHash, "evidenceFragment.capture.content_hash", "HASH_MISMATCH");
  for (const [actual, expected, path] of [
    [row.fragment_id, parsed.fragmentId, "evidenceFragment.fragment_id"],
    [row.capture_id, parsed.captureId, "evidenceFragment.capture_id"],
    [row.capture_canonical_version, parsed.captureCanonicalVersion, "evidenceFragment.capture_canonical_version"],
    [row.capture_canonical_hash, parsed.captureCanonicalHash, "evidenceFragment.capture_canonical_hash"],
    [row.capture_representation_hash, parsed.captureRepresentationHash, "evidenceFragment.capture_representation_hash"],
    [row.fragment_kind, parsed.fragmentKind, "evidenceFragment.fragment_kind"],
    [row.locator, parsed.locator, "evidenceFragment.locator"],
    [row.content_binding, parsed.contentBinding, "evidenceFragment.content_binding"],
    [row.extraction_authority, parsed.extractionAuthority, "evidenceFragment.extraction_authority"],
  ] as const) compareValue(actual, expected, path);
  const result = { row, parsed, ref: Object.freeze({ fragmentId, canonicalVersion: 1 as const, canonicalHash: asText(row.canonical_hash, "evidenceFragment.canonical_hash") }) };
  cache.set(id, result); return result;
}

async function authenticateMatch(client: ClaimLevelEvidenceViewReadClient, id: string, target: ClaimVersionRef, targetClaimId: string, targetClaimCanonicalHash: string, cache: Map<string, AuthenticatedMatch>, fragmentCache: Map<string, AuthenticatedFragment>): Promise<AuthenticatedMatch> {
  const existing = cache.get(id); if (existing) return existing;
  const row = await one(client, `SELECT match_id::text AS match_id, canonical_version, canonical, canonical_hash, claim_id::text AS claim_id, claim_canonical_version, claim_canonical_hash, claim_version_id::text AS claim_version_id, claim_version_canonical_version, claim_version_canonical_hash, evidence_fragment_id::text AS evidence_fragment_id, evidence_fragment_canonical_version, evidence_fragment_canonical_hash, matcher_identity, matcher_version, matcher_hash, matcher_input_canonical_hashes FROM public.rcv022_claim_evidence_matches WHERE match_id=$1`, [id], "claimEvidenceMatch");
  const parsed = parseCanonical(row, "claimEvidenceMatch"); assertVersion(row.canonical_version, "claimEvidenceMatch.canonical_version");
  const matchId = assertUuid(row.match_id, "claimEvidenceMatch.match_id");
  const input = { matchId, claimId: assertUuid(row.claim_id, "claimEvidenceMatch.claim_id"), claimCanonicalVersion: assertVersion(row.claim_canonical_version, "claimEvidenceMatch.claim_canonical_version"), claimCanonicalHash: assertHash(row.claim_canonical_hash, "claimEvidenceMatch.claim_canonical_hash"), claimVersionId: assertUuid(row.claim_version_id, "claimEvidenceMatch.claim_version_id"), claimVersionCanonicalVersion: assertVersion(row.claim_version_canonical_version, "claimEvidenceMatch.claim_version_canonical_version"), claimVersionCanonicalHash: assertHash(row.claim_version_canonical_hash, "claimEvidenceMatch.claim_version_canonical_hash"), evidenceFragmentId: assertUuid(row.evidence_fragment_id, "claimEvidenceMatch.evidence_fragment_id"), evidenceFragmentCanonicalVersion: assertVersion(row.evidence_fragment_canonical_version, "claimEvidenceMatch.evidence_fragment_canonical_version"), evidenceFragmentCanonicalHash: assertHash(row.evidence_fragment_canonical_hash, "claimEvidenceMatch.evidence_fragment_canonical_hash"), matcherIdentity: asText(row.matcher_identity, "claimEvidenceMatch.matcher_identity"), matcherVersion: asText(row.matcher_version, "claimEvidenceMatch.matcher_version"), matcherHash: assertHash(row.matcher_hash, "claimEvidenceMatch.matcher_hash"), matcherInputCanonicalHashes: row.matcher_input_canonical_hashes };
  const built = reconstruct("claimEvidenceMatch", () => buildClaimEvidenceMatchCanonical(input));
  if (built.canonical !== row.canonical) verifyFail("CANONICAL_MISMATCH", "claimEvidenceMatch.canonical", "Match canonical reconstruction differs");
  if (built.hash !== row.canonical_hash) verifyFail("HASH_MISMATCH", "claimEvidenceMatch.canonical_hash", "Match canonical hash differs");
  for (const [key, expected] of Object.entries({ matchId: input.matchId, claimId: input.claimId, claimVersionId: input.claimVersionId, evidenceFragmentId: input.evidenceFragmentId })) compareValue(parsed[key], expected, `claimEvidenceMatch.${key}`);
  for (const [actual, expected, path] of [
    [row.claim_id, parsed.claimId, "claimEvidenceMatch.claim_id"],
    [row.claim_canonical_version, parsed.claimCanonicalVersion, "claimEvidenceMatch.claim_canonical_version"],
    [row.claim_canonical_hash, parsed.claimCanonicalHash, "claimEvidenceMatch.claim_canonical_hash"],
    [row.claim_version_id, parsed.claimVersionId, "claimEvidenceMatch.claim_version_id"],
    [row.claim_version_canonical_version, parsed.claimVersionCanonicalVersion, "claimEvidenceMatch.claim_version_canonical_version"],
    [row.claim_version_canonical_hash, parsed.claimVersionCanonicalHash, "claimEvidenceMatch.claim_version_canonical_hash"],
    [row.evidence_fragment_id, parsed.evidenceFragmentId, "claimEvidenceMatch.evidence_fragment_id"],
    [row.evidence_fragment_canonical_version, parsed.evidenceFragmentCanonicalVersion, "claimEvidenceMatch.evidence_fragment_canonical_version"],
    [row.evidence_fragment_canonical_hash, parsed.evidenceFragmentCanonicalHash, "claimEvidenceMatch.evidence_fragment_canonical_hash"],
    [row.matcher_identity, parsed.matcherIdentity, "claimEvidenceMatch.matcher_identity"],
    [row.matcher_version, parsed.matcherVersion, "claimEvidenceMatch.matcher_version"],
    [row.matcher_hash, parsed.matcherHash, "claimEvidenceMatch.matcher_hash"],
    [row.matcher_input_canonical_hashes, parsed.matcherInputCanonicalHashes, "claimEvidenceMatch.matcher_input_canonical_hashes"],
  ] as const) compareValue(actual, expected, path);
  compareValue(input.claimId, targetClaimId, "claimEvidenceMatch.claimId", "CLAIM_SCOPE_MISMATCH");
  compareValue(input.claimCanonicalHash, targetClaimCanonicalHash, "claimEvidenceMatch.claimCanonicalHash", "HASH_MISMATCH");
  compareValue(input.claimVersionId, target.claimVersionId, "claimEvidenceMatch.claimVersionId", "CLAIM_SCOPE_MISMATCH");
  compareValue(input.claimVersionCanonicalVersion, target.canonicalVersion, "claimEvidenceMatch.claimVersionCanonicalVersion", "CLAIM_SCOPE_MISMATCH");
  compareValue(input.claimVersionCanonicalHash, target.canonicalHash, "claimEvidenceMatch.claimVersionCanonicalHash", "HASH_MISMATCH");
  const fragment = await authenticateFragment(client, input.evidenceFragmentId, fragmentCache);
  compareValue(input.evidenceFragmentCanonicalHash, fragment.row.canonical_hash, "claimEvidenceMatch.evidenceFragmentCanonicalHash", "HASH_MISMATCH");
  const result = { row, parsed, ref: Object.freeze({ matchId, canonicalVersion: 1 as const, canonicalHash: asText(row.canonical_hash, "claimEvidenceMatch.canonical_hash") }), fragment };
  cache.set(id, result); return result;
}

async function authenticateAssessment(client: ClaimLevelEvidenceViewReadClient, id: string, target: ClaimVersionRef, targetClaimId: string, targetClaimCanonicalHash: string, matchCache: Map<string, AuthenticatedMatch>, fragmentCache: Map<string, AuthenticatedFragment>): Promise<AuthenticatedAssessment> {
  const row = await one(client, `SELECT assessment_id::text AS assessment_id, canonical_version, canonical, canonical_hash, claim_evidence_match_id::text AS claim_evidence_match_id, claim_evidence_match_canonical_version, claim_evidence_match_canonical_hash, claim_id::text AS claim_id, claim_canonical_version, claim_canonical_hash, claim_version_id::text AS claim_version_id, claim_version_canonical_version, claim_version_canonical_hash, evidence_fragment_id::text AS evidence_fragment_id, evidence_fragment_canonical_version, evidence_fragment_canonical_hash, assessment_result, method_provenance, to_char(assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS assessed_at FROM public.rcv022_evidence_assessments WHERE assessment_id=$1`, [id], "evidenceAssessment");
  const parsed = parseCanonical(row, "evidenceAssessment"); assertVersion(row.canonical_version, "evidenceAssessment.canonical_version");
  const assessmentId = assertUuid(row.assessment_id, "evidenceAssessment.assessment_id");
  const relationObject = asObject(parsed.assessmentResult, "evidenceAssessment.assessmentResult");
  const methodProvenance = asObject(parsed.methodProvenance, "evidenceAssessment.methodProvenance");
  const input = { assessmentId, claimEvidenceMatchId: assertUuid(row.claim_evidence_match_id, "evidenceAssessment.claim_evidence_match_id"), claimEvidenceMatchCanonicalVersion: assertVersion(row.claim_evidence_match_canonical_version, "evidenceAssessment.claim_evidence_match_canonical_version"), claimEvidenceMatchCanonicalHash: assertHash(row.claim_evidence_match_canonical_hash, "evidenceAssessment.claim_evidence_match_canonical_hash"), claimId: assertUuid(row.claim_id, "evidenceAssessment.claim_id"), claimCanonicalVersion: assertVersion(row.claim_canonical_version, "evidenceAssessment.claim_canonical_version"), claimCanonicalHash: assertHash(row.claim_canonical_hash, "evidenceAssessment.claim_canonical_hash"), claimVersionId: assertUuid(row.claim_version_id, "evidenceAssessment.claim_version_id"), claimVersionCanonicalVersion: assertVersion(row.claim_version_canonical_version, "evidenceAssessment.claim_version_canonical_version"), claimVersionCanonicalHash: assertHash(row.claim_version_canonical_hash, "evidenceAssessment.claim_version_canonical_hash"), evidenceFragmentId: assertUuid(row.evidence_fragment_id, "evidenceAssessment.evidence_fragment_id"), evidenceFragmentCanonicalVersion: assertVersion(row.evidence_fragment_canonical_version, "evidenceAssessment.evidence_fragment_canonical_version"), evidenceFragmentCanonicalHash: assertHash(row.evidence_fragment_canonical_hash, "evidenceAssessment.evidence_fragment_canonical_hash"), assessmentResult: relationObject, methodProvenance, assessedAt: assertTimestamp(row.assessed_at, "evidenceAssessment.assessed_at") };
  const built = reconstruct("evidenceAssessment", () => buildEvidenceAssessmentCanonical(input));
  if (built.canonical !== row.canonical) verifyFail("CANONICAL_MISMATCH", "evidenceAssessment.canonical", "Assessment canonical reconstruction differs");
  if (built.hash !== row.canonical_hash) verifyFail("HASH_MISMATCH", "evidenceAssessment.canonical_hash", "Assessment canonical hash differs");
  for (const [actual, expected, path] of [
    [row.claim_evidence_match_id, parsed.claimEvidenceMatchId, "evidenceAssessment.claim_evidence_match_id"],
    [row.claim_evidence_match_canonical_version, parsed.claimEvidenceMatchCanonicalVersion, "evidenceAssessment.claim_evidence_match_canonical_version"],
    [row.claim_evidence_match_canonical_hash, parsed.claimEvidenceMatchCanonicalHash, "evidenceAssessment.claim_evidence_match_canonical_hash"],
    [row.claim_id, parsed.claimId, "evidenceAssessment.claim_id"],
    [row.claim_canonical_version, parsed.claimCanonicalVersion, "evidenceAssessment.claim_canonical_version"],
    [row.claim_canonical_hash, parsed.claimCanonicalHash, "evidenceAssessment.claim_canonical_hash"],
    [row.claim_version_id, parsed.claimVersionId, "evidenceAssessment.claim_version_id"],
    [row.claim_version_canonical_version, parsed.claimVersionCanonicalVersion, "evidenceAssessment.claim_version_canonical_version"],
    [row.claim_version_canonical_hash, parsed.claimVersionCanonicalHash, "evidenceAssessment.claim_version_canonical_hash"],
    [row.evidence_fragment_id, parsed.evidenceFragmentId, "evidenceAssessment.evidence_fragment_id"],
    [row.evidence_fragment_canonical_version, parsed.evidenceFragmentCanonicalVersion, "evidenceAssessment.evidence_fragment_canonical_version"],
    [row.evidence_fragment_canonical_hash, parsed.evidenceFragmentCanonicalHash, "evidenceAssessment.evidence_fragment_canonical_hash"],
    [row.assessment_result, parsed.assessmentResult, "evidenceAssessment.assessment_result"],
    [row.method_provenance, parsed.methodProvenance, "evidenceAssessment.method_provenance"],
    [row.assessed_at, parsed.assessedAt, "evidenceAssessment.assessed_at"],
  ] as const) compareValue(actual, expected, path);
  const match = await authenticateMatch(client, input.claimEvidenceMatchId, target, targetClaimId, targetClaimCanonicalHash, matchCache, fragmentCache);
  compareValue(input.claimEvidenceMatchCanonicalHash, match.row.canonical_hash, "evidenceAssessment.claimEvidenceMatchCanonicalHash", "HASH_MISMATCH");
  compareValue(input.claimId, match.parsed.claimId, "evidenceAssessment.claimId", "CLAIM_SCOPE_MISMATCH");
  compareValue(input.claimVersionId, match.parsed.claimVersionId, "evidenceAssessment.claimVersionId", "CLAIM_SCOPE_MISMATCH");
  compareValue(input.evidenceFragmentId, match.parsed.evidenceFragmentId, "evidenceAssessment.evidenceFragmentId", "LINEAGE_MISMATCH");
  compareValue(input.claimVersionId, target.claimVersionId, "evidenceAssessment.claimVersionId", "CLAIM_SCOPE_MISMATCH");
  compareValue(input.claimVersionCanonicalHash, target.canonicalHash, "evidenceAssessment.claimVersionCanonicalHash", "HASH_MISMATCH");
  compareValue(input.claimId, targetClaimId, "evidenceAssessment.claimId", "CLAIM_SCOPE_MISMATCH");
  compareValue(input.claimCanonicalHash, targetClaimCanonicalHash, "evidenceAssessment.claimCanonicalHash", "HASH_MISMATCH");
  const relation = asText(relationObject.relation, "evidenceAssessment.relation") as AssessmentProjection["relation"];
  if (!["SUPPORTS", "REFUTES", "INSUFFICIENT", "UNRELATED"].includes(relation)) verifyFail("INVALID_RELATION", "evidenceAssessment.relation", "unsupported relation");
  const result = {
    row, parsed,
    ref: Object.freeze({ assessmentId, canonicalVersion: 1 as const, canonicalHash: asText(row.canonical_hash, "evidenceAssessment.canonical_hash") }),
    match,
    projection: Object.freeze({ assessmentRef: Object.freeze({ assessmentId, canonicalVersion: 1 as const, canonicalHash: asText(row.canonical_hash, "evidenceAssessment.canonical_hash") }), claimEvidenceMatchRef: match.ref, evidenceFragmentRef: match.fragment.ref, claimVersionRef: target, relation, rationale: asText(relationObject.rationale, "evidenceAssessment.rationale"), methodProvenance: Object.freeze({ ...methodProvenance }), assessedAt: input.assessedAt }),
  };
  return result;
}

async function authenticateEnvelope(client: ClaimLevelEvidenceViewReadClient, ref: EnvelopeRef, target: ClaimVersionRef, targetClaimId: string, targetClaimCanonicalHash: string, matchCache: Map<string, AuthenticatedMatch>, fragmentCache: Map<string, AuthenticatedFragment>, assessmentCache: Map<string, AuthenticatedAssessment>): Promise<{ provenance: EnvelopeProvenance; occurrences: AssessmentOccurrence[]; assessments: AuthenticatedAssessment[] }> {
  const row = await one(client, `SELECT envelope_id::text AS envelope_id, canonical_version, canonical, canonical_hash, claim_id::text AS claim_id, claim_canonical_version, claim_canonical_hash, claim_version_id::text AS claim_version_id, claim_version_canonical_version, claim_version_canonical_hash, to_char(analysis_cutoff_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS analysis_cutoff_at, to_char(analysis_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS analysis_at, match_refs, assessment_refs, analysis_method_identity, analysis_method_version, analysis_method_hash FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=$1`, [ref.envelopeId], "semanticAnalysisEnvelope");
  const parsed = parseCanonical(row, "semanticAnalysisEnvelope"); assertVersion(row.canonical_version, "semanticAnalysisEnvelope.canonical_version");
  const input = { envelopeId: assertUuid(row.envelope_id, "semanticAnalysisEnvelope.envelope_id"), claimId: assertUuid(row.claim_id, "semanticAnalysisEnvelope.claim_id"), claimCanonicalVersion: assertVersion(row.claim_canonical_version, "semanticAnalysisEnvelope.claim_canonical_version"), claimCanonicalHash: assertHash(row.claim_canonical_hash, "semanticAnalysisEnvelope.claim_canonical_hash"), claimVersionId: assertUuid(row.claim_version_id, "semanticAnalysisEnvelope.claim_version_id"), claimVersionCanonicalVersion: assertVersion(row.claim_version_canonical_version, "semanticAnalysisEnvelope.claim_version_canonical_version"), claimVersionCanonicalHash: assertHash(row.claim_version_canonical_hash, "semanticAnalysisEnvelope.claim_version_canonical_hash"), analysisCutoffAt: assertTimestamp(row.analysis_cutoff_at, "semanticAnalysisEnvelope.analysis_cutoff_at"), analysisAt: assertTimestamp(row.analysis_at, "semanticAnalysisEnvelope.analysis_at"), matchRefs: canonicalRefs(parsed.matchRefs, "semanticAnalysisEnvelope.matchRefs"), assessmentRefs: canonicalRefs(parsed.assessmentRefs, "semanticAnalysisEnvelope.assessmentRefs"), analysisMethodIdentity: asText(row.analysis_method_identity, "semanticAnalysisEnvelope.analysis_method_identity"), analysisMethodVersion: asText(row.analysis_method_version, "semanticAnalysisEnvelope.analysis_method_version"), analysisMethodHash: assertHash(row.analysis_method_hash, "semanticAnalysisEnvelope.analysis_method_hash") };
  const built = reconstruct("semanticAnalysisEnvelope", () => buildSemanticAnalysisEnvelopeCanonical(input));
  if (built.canonical !== row.canonical) verifyFail("CANONICAL_MISMATCH", "semanticAnalysisEnvelope.canonical", "Envelope canonical reconstruction differs");
  if (built.hash !== row.canonical_hash) verifyFail("HASH_MISMATCH", "semanticAnalysisEnvelope.canonical_hash", "Envelope canonical hash differs");
  compareValue(input.envelopeId, ref.envelopeId, "semanticAnalysisEnvelope.envelope_id", "IDENTITY_MISMATCH"); compareValue(row.canonical_version, ref.canonicalVersion, "semanticAnalysisEnvelope.canonical_version", "LINEAGE_MISMATCH"); compareValue(row.canonical_hash, ref.canonicalHash, "semanticAnalysisEnvelope.canonical_hash", "HASH_MISMATCH"); compareValue(input.claimId, targetClaimId, "semanticAnalysisEnvelope.claim_id", "CLAIM_SCOPE_MISMATCH"); compareValue(input.claimCanonicalHash, targetClaimCanonicalHash, "semanticAnalysisEnvelope.claim_canonical_hash", "HASH_MISMATCH"); compareValue(input.claimVersionId, target.claimVersionId, "semanticAnalysisEnvelope.claim_version_id", "CLAIM_SCOPE_MISMATCH"); compareValue(input.claimVersionCanonicalVersion, target.canonicalVersion, "semanticAnalysisEnvelope.claim_version_canonical_version", "CLAIM_SCOPE_MISMATCH"); compareValue(input.claimVersionCanonicalHash, target.canonicalHash, "semanticAnalysisEnvelope.claim_version_canonical_hash", "HASH_MISMATCH");
  for (const [actual, expected, path] of [
    [row.claim_id, parsed.claimId, "semanticAnalysisEnvelope.claim_id"],
    [row.claim_canonical_version, parsed.claimCanonicalVersion, "semanticAnalysisEnvelope.claim_canonical_version"],
    [row.claim_canonical_hash, parsed.claimCanonicalHash, "semanticAnalysisEnvelope.claim_canonical_hash"],
    [row.claim_version_id, parsed.claimVersionId, "semanticAnalysisEnvelope.claim_version_id"],
    [row.claim_version_canonical_version, parsed.claimVersionCanonicalVersion, "semanticAnalysisEnvelope.claim_version_canonical_version"],
    [row.claim_version_canonical_hash, parsed.claimVersionCanonicalHash, "semanticAnalysisEnvelope.claim_version_canonical_hash"],
    [row.analysis_cutoff_at, parsed.analysisCutoffAt, "semanticAnalysisEnvelope.analysis_cutoff_at"],
    [row.analysis_at, parsed.analysisAt, "semanticAnalysisEnvelope.analysis_at"],
    [row.match_refs, parsed.matchRefs, "semanticAnalysisEnvelope.match_refs"],
    [row.assessment_refs, parsed.assessmentRefs, "semanticAnalysisEnvelope.assessment_refs"],
    [row.analysis_method_identity, parsed.analysisMethodIdentity, "semanticAnalysisEnvelope.analysis_method_identity"],
    [row.analysis_method_version, parsed.analysisMethodVersion, "semanticAnalysisEnvelope.analysis_method_version"],
    [row.analysis_method_hash, parsed.analysisMethodHash, "semanticAnalysisEnvelope.analysis_method_hash"],
  ] as const) compareValue(actual, expected, path);
  const matchRefs = await many(client, "SELECT ordinal, match_id::text AS id, match_canonical_version AS canonical_version, match_canonical_hash AS canonical_hash FROM public.rcv022_envelope_match_refs WHERE envelope_id=$1 ORDER BY ordinal", [ref.envelopeId]);
  const assessmentRefs = await many(client, "SELECT ordinal, assessment_id::text AS id, assessment_canonical_version AS canonical_version, assessment_canonical_hash AS canonical_hash FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=$1 ORDER BY ordinal", [ref.envelopeId]);
  const checkMembership = (rows: readonly Row[], canonicalRefs: unknown, path: string): void => {
    if (!Array.isArray(canonicalRefs) || rows.length !== canonicalRefs.length) verifyFail("LINEAGE_MISMATCH", path, "membership projection cardinality mismatch");
    rows.forEach((membership, ordinal) => { const expected = asObject((canonicalRefs as readonly unknown[])[ordinal], `${path}[${ordinal}]`); compareValue(membership.ordinal, ordinal, `${path}[${ordinal}].ordinal`); compareValue(membership.id, expected.id, `${path}[${ordinal}].id`); compareValue(membership.canonical_version, expected.canonicalVersion, `${path}[${ordinal}].canonicalVersion`); compareValue(membership.canonical_hash, expected.canonicalHash, `${path}[${ordinal}].canonicalHash`, "HASH_MISMATCH"); });
  };
  checkMembership(matchRefs, parsed.matchRefs, "matchRefs"); checkMembership(assessmentRefs, parsed.assessmentRefs, "assessmentRefs");
  const matchIds = new Set<string>();
  for (const membership of matchRefs) {
    const match = await authenticateMatch(client, asText(membership.id, "matchRefs.id"), target, targetClaimId, targetClaimCanonicalHash, matchCache, fragmentCache);
    compareValue(membership.id, match.ref.matchId, `matchRefs.${match.ref.matchId}.id`, "IDENTITY_MISMATCH");
    compareValue(membership.canonical_version, match.ref.canonicalVersion, `matchRefs.${match.ref.matchId}.canonicalVersion`, "LINEAGE_MISMATCH");
    compareValue(membership.canonical_hash, match.ref.canonicalHash, `matchRefs.${match.ref.matchId}.canonicalHash`, "HASH_MISMATCH");
    matchIds.add(match.ref.matchId);
    compareValue(match.parsed.claimVersionId, target.claimVersionId, `matchRefs.${match.ref.matchId}.claimVersionId`, "CLAIM_SCOPE_MISMATCH");
  }
  const occurrences: AssessmentOccurrence[] = []; const assessments: AuthenticatedAssessment[] = [];
  for (const membership of assessmentRefs) {
    const id = asText(membership.id, "assessmentRefs.id"); const assessment = assessmentCache.get(id) ?? await authenticateAssessment(client, id, target, targetClaimId, targetClaimCanonicalHash, matchCache, fragmentCache); assessmentCache.set(id, assessment); if (!matchIds.has(assessment.match.ref.matchId)) verifyFail("LINEAGE_MISMATCH", `assessmentRefs.${id}`, "Assessment Match is not an authenticated Envelope member"); compareValue(membership.canonical_version, assessment.row.canonical_version, `assessmentRefs.${id}.canonicalVersion`); compareValue(membership.canonical_hash, assessment.row.canonical_hash, `assessmentRefs.${id}.canonicalHash`, "HASH_MISMATCH"); occurrences.push({ envelopeRef: ref, assessmentRef: assessment.ref, ordinal: Number(membership.ordinal) }); assessments.push(assessment);
  }
  return { provenance: Object.freeze({ envelopeRef: ref, claimVersionRef: target, analysisCutoffAt: input.analysisCutoffAt, analysisAt: input.analysisAt, analysisMethodIdentity: input.analysisMethodIdentity, analysisMethodVersion: input.analysisMethodVersion, analysisMethodHash: input.analysisMethodHash }), occurrences, assessments };
}

/** Complete Wave B read-time projector. Structural validation always precedes pool acquisition. */
export async function getClaimLevelEvidenceView(spec: unknown, pool: ClaimLevelEvidenceViewReadPool = databasePool): Promise<ClaimLevelEvidenceViewResult> {
  const normalized = prepareClaimLevelEvidenceViewSpec(spec);
  const client = await pool.connect();
  let active = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); active = true;
    const target = await authenticateClaimAndVersion(client, normalized.claimVersionRef);
    const matchCache = new Map<string, AuthenticatedMatch>(); const fragmentCache = new Map<string, AuthenticatedFragment>(); const assessmentCache = new Map<string, AuthenticatedAssessment>();
    const provenance: EnvelopeProvenance[] = []; const occurrences: AssessmentOccurrence[] = []; const uniqueAssessments = new Map<string, AuthenticatedAssessment>();
    for (const envelopeRef of normalized.envelopeManifest) { const verified = await authenticateEnvelope(client, envelopeRef, normalized.claimVersionRef, target.claimId, target.claimCanonicalHash, matchCache, fragmentCache, assessmentCache); provenance.push(verified.provenance); occurrences.push(...verified.occurrences); for (const assessment of verified.assessments) { const prior = uniqueAssessments.get(assessment.ref.assessmentId); if (prior && (prior.ref.canonicalVersion !== assessment.ref.canonicalVersion || prior.ref.canonicalHash !== assessment.ref.canonicalHash)) verifyFail("DUPLICATE_CONFLICT", `assessment.${assessment.ref.assessmentId}`, "conflicting Assessment commitments"); uniqueAssessments.set(assessment.ref.assessmentId, prior ?? assessment); } }
    const assessmentManifest = [...uniqueAssessments.values()].sort((left, right) => compareBytes(left.ref.assessmentId, right.ref.assessmentId) || left.ref.canonicalVersion - right.ref.canonicalVersion || compareBytes(left.ref.canonicalHash, right.ref.canonicalHash)).map((entry) => entry.projection);
    const result: ClaimLevelEvidenceViewResult = Object.freeze({ claimVersionRef: normalized.claimVersionRef, envelopeManifest: normalized.envelopeManifest, assessmentManifest: Object.freeze(assessmentManifest), occurrenceManifest: Object.freeze(occurrences), envelopeProvenance: Object.freeze(provenance), scopeEnumeration: Object.freeze({ scopeKind: "EXPLICIT_ENVELOPE_SET", status: "ENUMERATED_AND_CONSIDERED" }) });
    await client.query("COMMIT"); active = false; return result;
  } catch (error) { if (active) await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}
