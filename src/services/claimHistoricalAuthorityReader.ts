import { createHash } from "node:crypto";
import { Pool, PoolClient, QueryResultRow } from "pg";
import databasePool from "../db";
import {
  buildClaimIdentityCanonical,
  buildClaimVersionCanonical,
  CLAIM_IDENTITY_AUTHORITY_SCHEMA,
  CLAIM_VERSION_AUTHORITY_SCHEMA,
  CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION,
} from "./claimHistoricalAuthorityCanonical";

export const CLAIM_HISTORICAL_AUTHORITY_FAILURE_CODES = [
  "MISSING_SOURCE_CLAIM",
  "MISSING_SOURCE_CLAIMVERSION",
  "UNAUTHENTICATED_LEGACY_CLAIM",
  "UNAUTHENTICATED_LEGACY_CLAIMVERSION",
  "MISSING_CLAIM_AUTHORITY",
  "MISSING_CLAIMVERSION_AUTHORITY",
  "UNSUPPORTED_CLAIM_CANONICAL_VERSION",
  "UNSUPPORTED_CLAIMVERSION_CANONICAL_VERSION",
  "MALFORMED_CLAIM_AUTHORITY",
  "MALFORMED_CLAIMVERSION_AUTHORITY",
  "CLAIM_IDENTITY_MISMATCH",
  "CLAIMVERSION_IDENTITY_MISMATCH",
  "PARENT_CLAIM_MISMATCH",
  "VERSION_NUMBER_MISMATCH",
  "SOURCE_PARITY_MISMATCH",
  "CANONICAL_MISMATCH",
  "HASH_MISMATCH",
  "DUPLICATE_AUTHORITY",
] as const;

export type ClaimHistoricalAuthorityFailureCode =
  (typeof CLAIM_HISTORICAL_AUTHORITY_FAILURE_CODES)[number];

export class ClaimHistoricalAuthorityReadError extends Error {
  constructor(
    public readonly code: ClaimHistoricalAuthorityFailureCode,
    public readonly path: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`${path}: ${message}`);
    this.name = "ClaimHistoricalAuthorityReadError";
  }
}

export type ClaimHistoricalAuthorityReadClient = Pick<PoolClient, "query">;
type ClaimHistoricalAuthorityReadPool = Pick<Pool, "connect">;

interface ClaimSourceRow extends QueryResultRow {
  id: string;
}

interface ClaimAuthorityRow extends QueryResultRow {
  claim_id: string;
  canonical_version: number;
  canonical: string;
  canonical_hash: string;
}

interface ClaimVersionSourceRow extends QueryResultRow {
  id: string;
  claim_id: string;
  version_number: number;
  title: string;
  normalized_statement: string;
  language: string;
  claim_type: string;
}

interface ClaimVersionAuthorityRow extends QueryResultRow {
  claim_version_id: string;
  claim_id: string;
  version_number: number;
  title: string;
  normalized_statement: string;
  language: string;
  claim_type: string;
  canonical_version: number;
  canonical: string;
  canonical_hash: string;
}

export interface VerifiedClaimIdentityAuthority {
  readonly verified: true;
  readonly claimId: string;
  readonly canonicalVersion: 1;
  readonly canonicalHash: string;
}

export interface VerifiedClaimVersionAuthority
  extends VerifiedClaimIdentityAuthority {
  readonly claimVersionId: string;
  readonly versionNumber: number;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function fail(
  code: ClaimHistoricalAuthorityFailureCode,
  path: string,
  message: string,
  cause?: unknown,
): never {
  throw new ClaimHistoricalAuthorityReadError(code, path, message, cause);
}

function requireClient(
  client: ClaimHistoricalAuthorityReadClient,
): ClaimHistoricalAuthorityReadClient {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("A SELECT-capable PostgreSQL client is required");
  }
  return client;
}

function assertSupportedVersion(
  value: unknown,
  path: string,
  code:
    | "UNSUPPORTED_CLAIM_CANONICAL_VERSION"
    | "UNSUPPORTED_CLAIMVERSION_CANONICAL_VERSION",
): asserts value is 1 {
  if (value !== CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION) {
    fail(code, path, `unsupported canonical version: ${String(value)}`);
  }
}

function assertExactObject(
  value: unknown,
  keys: readonly string[],
  path: string,
  code:
    | "MALFORMED_CLAIM_AUTHORITY"
    | "MALFORMED_CLAIMVERSION_AUTHORITY",
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code, path, "canonical value must be a plain object");
  }
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    fail(code, path, "canonical object has missing or unexpected keys");
  }
}

function verifyStoredCanonical(
  canonical: unknown,
  storedHash: unknown,
  expectedCanonical: string,
  expectedSchema: string,
  keys: readonly string[],
  path: string,
  malformedCode:
    | "MALFORMED_CLAIM_AUTHORITY"
    | "MALFORMED_CLAIMVERSION_AUTHORITY",
): string {
  if (typeof canonical !== "string") {
    fail(malformedCode, `${path}.canonical`, "canonical value is not text");
  }
  if (typeof storedHash !== "string" || !SHA256_HEX.test(storedHash)) {
    fail(malformedCode, `${path}.canonical_hash`, "canonical hash is not lowercase SHA-256 hex");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch (error) {
    fail(malformedCode, `${path}.canonical`, "canonical value is not valid JSON", error);
  }
  assertExactObject(parsed, keys, `${path}.canonical`, malformedCode);
  if (parsed.schema !== expectedSchema) {
    fail(malformedCode, `${path}.canonical.schema`, "unsupported canonical schema");
  }
  if (parsed.canonicalVersion !== CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION) {
    fail(malformedCode, `${path}.canonical.canonicalVersion`, "canonical version does not match authority version");
  }

  let rebuilt: string;
  try {
    rebuilt = buildCanonicalFromParsed(parsed, expectedSchema);
  } catch (error) {
    fail(malformedCode, `${path}.canonical`, "canonical value is not reconstructible", error);
  }
  if (rebuilt !== canonical) {
    fail("CANONICAL_MISMATCH", `${path}.canonical`, "stored canonical text is not exact JCS");
  }
  if (canonical !== expectedCanonical) {
    fail("CANONICAL_MISMATCH", `${path}.canonical`, "stored canonical differs from source reconstruction");
  }
  const expectedHash = buildHash(canonical);
  if (storedHash !== expectedHash) {
    fail("HASH_MISMATCH", `${path}.canonical_hash`, "stored hash differs from canonical UTF-8 bytes");
  }
  return storedHash;
}

function buildCanonicalFromParsed(
  parsed: Record<string, unknown>,
  schema: string,
): string {
  if (schema === CLAIM_IDENTITY_AUTHORITY_SCHEMA) {
    if (typeof parsed.claimId !== "string") {
      throw new Error("claimId must be a string");
    }
    return buildClaimIdentityCanonical({ claimId: parsed.claimId }).canonical;
  }
  if (schema === CLAIM_VERSION_AUTHORITY_SCHEMA) {
    if (
      typeof parsed.claimId !== "string" ||
      typeof parsed.claimVersionId !== "string" ||
      typeof parsed.versionNumber !== "number" ||
      !Number.isSafeInteger(parsed.versionNumber) ||
      parsed.versionNumber <= 0 ||
      typeof parsed.title !== "string" ||
      typeof parsed.normalizedStatement !== "string" ||
      typeof parsed.language !== "string" ||
      typeof parsed.claimType !== "string"
    ) {
      throw new Error("ClaimVersion canonical fields have invalid types");
    }
    return buildClaimVersionCanonical({
      claimId: parsed.claimId,
      claimVersionId: parsed.claimVersionId,
      versionNumber: parsed.versionNumber,
      title: parsed.title,
      normalizedStatement: parsed.normalizedStatement,
      language: parsed.language,
      claimType: parsed.claimType,
    }).canonical;
  }
  throw new Error("unsupported canonical schema");
}

function buildHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const CLAIM_KEYS = ["schema", "canonicalVersion", "claimId"] as const;
const CLAIM_VERSION_KEYS = [
  "schema",
  "canonicalVersion",
  "claimId",
  "claimVersionId",
  "versionNumber",
  "title",
  "normalizedStatement",
  "language",
  "claimType",
] as const;

export async function verifyClaimIdentityAuthorityWithinClient(
  client: ClaimHistoricalAuthorityReadClient,
  claimId: string,
): Promise<VerifiedClaimIdentityAuthority> {
  const readClient = requireClient(client);
  const source = await readClient.query<ClaimSourceRow>(
    "SELECT id FROM public.claims WHERE id = $1",
    [claimId],
  );
  const sourceRow = source.rows[0];
  if (!sourceRow) {
    fail("MISSING_SOURCE_CLAIM", "claims.id", `source Claim does not exist: ${claimId}`);
  }
  const authority = await readClient.query<ClaimAuthorityRow>(
    `SELECT claim_id, canonical_version, canonical, canonical_hash
     FROM public.claim_identity_authorities
     WHERE claim_id = $1`,
    [claimId],
  );
  const authorityRow = authority.rows[0];
  if (!authorityRow) {
    fail("UNAUTHENTICATED_LEGACY_CLAIM", "claim_identity_authorities", "source Claim has no historical authority");
  }
  assertSupportedVersion(
    authorityRow.canonical_version,
    "claim_identity_authorities.canonical_version",
    "UNSUPPORTED_CLAIM_CANONICAL_VERSION",
  );
  if (authorityRow.claim_id !== sourceRow.id || authorityRow.claim_id !== claimId) {
    fail("CLAIM_IDENTITY_MISMATCH", "claim_identity_authorities.claim_id", "Claim identity differs from source identity");
  }
  const expected = buildClaimIdentityCanonical({ claimId: sourceRow.id });
  const canonicalHash = verifyStoredCanonical(
    authorityRow.canonical,
    authorityRow.canonical_hash,
    expected.canonical,
    CLAIM_IDENTITY_AUTHORITY_SCHEMA,
    CLAIM_KEYS,
    "claim_identity_authorities",
    "MALFORMED_CLAIM_AUTHORITY",
  );
  return Object.freeze({
    verified: true as const,
    claimId,
    canonicalVersion: CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION,
    canonicalHash,
  });
}

export async function verifyClaimVersionAuthorityWithinClient(
  client: ClaimHistoricalAuthorityReadClient,
  claimVersionId: string,
): Promise<VerifiedClaimVersionAuthority> {
  const readClient = requireClient(client);
  const source = await readClient.query<ClaimVersionSourceRow>(
    `SELECT id, claim_id, version_number, title, normalized_statement,
            language, claim_type
     FROM public.claim_versions
     WHERE id = $1`,
    [claimVersionId],
  );
  const sourceRow = source.rows[0];
  if (!sourceRow) {
    fail(
      "MISSING_SOURCE_CLAIMVERSION",
      "claim_versions.id",
      `source ClaimVersion does not exist: ${claimVersionId}`,
    );
  }
  const authority = await readClient.query<ClaimVersionAuthorityRow>(
    `SELECT claim_version_id, claim_id, version_number, title,
            normalized_statement, language, claim_type,
            canonical_version, canonical, canonical_hash
     FROM public.claim_version_authorities
     WHERE claim_version_id = $1`,
    [claimVersionId],
  );
  const authorityRow = authority.rows[0];
  if (!authorityRow) {
    fail(
      "UNAUTHENTICATED_LEGACY_CLAIMVERSION",
      "claim_version_authorities",
      "source ClaimVersion has no historical authority",
    );
  }
  assertSupportedVersion(
    authorityRow.canonical_version,
    "claim_version_authorities.canonical_version",
    "UNSUPPORTED_CLAIMVERSION_CANONICAL_VERSION",
  );
  if (authorityRow.claim_version_id !== sourceRow.id || authorityRow.claim_version_id !== claimVersionId) {
    fail("CLAIMVERSION_IDENTITY_MISMATCH", "claim_version_authorities.claim_version_id", "ClaimVersion identity differs from source identity");
  }
  if (authorityRow.claim_id !== sourceRow.claim_id) {
    fail("PARENT_CLAIM_MISMATCH", "claim_version_authorities.claim_id", "ClaimVersion parent Claim differs from source");
  }
  if (authorityRow.version_number !== sourceRow.version_number) {
    fail("VERSION_NUMBER_MISMATCH", "claim_version_authorities.version_number", "ClaimVersion version number differs from source");
  }
  if (
    authorityRow.title !== sourceRow.title ||
    authorityRow.normalized_statement !== sourceRow.normalized_statement ||
    authorityRow.language !== sourceRow.language ||
    authorityRow.claim_type !== sourceRow.claim_type
  ) {
    fail("SOURCE_PARITY_MISMATCH", "claim_version_authorities.semantic_fields", "ClaimVersion semantic fields differ from source");
  }
  try {
    await verifyClaimIdentityAuthorityWithinClient(readClient, sourceRow.claim_id);
  } catch (error) {
    if (
      error instanceof ClaimHistoricalAuthorityReadError &&
      error.code === "UNAUTHENTICATED_LEGACY_CLAIM"
    ) {
      fail("MISSING_CLAIM_AUTHORITY", "claim_identity_authorities", "parent Claim authority is required");
    }
    throw error;
  }
  const expected = buildClaimVersionCanonical({
    claimId: sourceRow.claim_id,
    claimVersionId: sourceRow.id,
    versionNumber: sourceRow.version_number,
    title: sourceRow.title,
    normalizedStatement: sourceRow.normalized_statement,
    language: sourceRow.language,
    claimType: sourceRow.claim_type,
  });
  const canonicalHash = verifyStoredCanonical(
    authorityRow.canonical,
    authorityRow.canonical_hash,
    expected.canonical,
    CLAIM_VERSION_AUTHORITY_SCHEMA,
    CLAIM_VERSION_KEYS,
    "claim_version_authorities",
    "MALFORMED_CLAIMVERSION_AUTHORITY",
  );
  return Object.freeze({
    verified: true as const,
    claimId: sourceRow.claim_id,
    claimVersionId,
    versionNumber: sourceRow.version_number,
    canonicalVersion: CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION,
    canonicalHash,
  });
}

async function withReaderClient<T>(
  pool: ClaimHistoricalAuthorityReadPool,
  work: (client: ClaimHistoricalAuthorityReadClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export function verifyClaimIdentityAuthority(
  claimId: string,
  pool: ClaimHistoricalAuthorityReadPool = databasePool,
): Promise<VerifiedClaimIdentityAuthority> {
  return withReaderClient(pool, (client) =>
    verifyClaimIdentityAuthorityWithinClient(client, claimId),
  );
}

export function verifyClaimVersionAuthority(
  claimVersionId: string,
  pool: ClaimHistoricalAuthorityReadPool = databasePool,
): Promise<VerifiedClaimVersionAuthority> {
  return withReaderClient(pool, (client) =>
    verifyClaimVersionAuthorityWithinClient(client, claimVersionId),
  );
}
