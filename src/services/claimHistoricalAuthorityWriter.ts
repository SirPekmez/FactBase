import { PoolClient, QueryResultRow } from "pg";
import {
  buildClaimIdentityCanonical,
  buildClaimVersionCanonical,
} from "./claimHistoricalAuthorityCanonical";

export type ClaimAuthorityTransactionClient = Pick<PoolClient, "query">;

export type ClaimAuthorityWriterErrorCode =
  | "TRANSACTION_REQUIRED"
  | "MISSING_SOURCE_CLAIM"
  | "MISSING_SOURCE_CLAIMVERSION"
  | "MISSING_PARENT_CLAIM_AUTHORITY"
  | "SOURCE_PARITY_MISMATCH"
  | "UNSUPPORTED_CANONICAL_VERSION"
  | "DUPLICATE_DIVERGENCE";

export class ClaimAuthorityWriterError extends Error {
  constructor(
    public readonly code: ClaimAuthorityWriterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClaimAuthorityWriterError";
  }
}

interface ClaimRow extends QueryResultRow {
  id: string;
}

interface ClaimIdentityAuthorityRow extends QueryResultRow {
  claim_id: string;
  canonical_version: number;
  canonical: string;
  canonical_hash: string;
}

interface ClaimVersionRow extends QueryResultRow {
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

export interface PersistedClaimIdentityAuthority {
  claimId: string;
  canonicalVersion: number;
  canonical: string;
  canonicalHash: string;
}

export interface PersistedClaimVersionAuthority
  extends PersistedClaimIdentityAuthority {
  claimVersionId: string;
  versionNumber: number;
  title: string;
  normalizedStatement: string;
  language: string;
  claimType: string;
}

function requireClient(
  client: ClaimAuthorityTransactionClient | undefined,
): ClaimAuthorityTransactionClient {
  if (!client || typeof client.query !== "function") {
    throw new ClaimAuthorityWriterError(
      "TRANSACTION_REQUIRED",
      "A caller-owned PostgreSQL transaction client is required",
    );
  }
  return client;
}

function assertSupportedCanonicalVersion(version: number): void {
  if (version !== 1) {
    throw new ClaimAuthorityWriterError(
      "UNSUPPORTED_CANONICAL_VERSION",
      `Unsupported Claim Historical Authority canonical version: ${version}`,
    );
  }
}

function assertClaimIdentityAuthorityParity(
  row: ClaimIdentityAuthorityRow,
  expected: PersistedClaimIdentityAuthority,
): void {
  assertSupportedCanonicalVersion(row.canonical_version);
  if (
    row.claim_id !== expected.claimId ||
    row.canonical_version !== expected.canonicalVersion ||
    row.canonical !== expected.canonical ||
    row.canonical_hash !== expected.canonicalHash
  ) {
    throw new ClaimAuthorityWriterError(
      "DUPLICATE_DIVERGENCE",
      `Claim authority diverges for ${expected.claimId}`,
    );
  }
}

function assertClaimVersionAuthorityParity(
  row: ClaimVersionAuthorityRow,
  expected: PersistedClaimVersionAuthority,
): void {
  assertSupportedCanonicalVersion(row.canonical_version);
  if (
    row.claim_version_id !== expected.claimVersionId ||
    row.claim_id !== expected.claimId ||
    row.version_number !== expected.versionNumber ||
    row.title !== expected.title ||
    row.normalized_statement !== expected.normalizedStatement ||
    row.language !== expected.language ||
    row.claim_type !== expected.claimType ||
    row.canonical_version !== expected.canonicalVersion ||
    row.canonical !== expected.canonical ||
    row.canonical_hash !== expected.canonicalHash
  ) {
    throw new ClaimAuthorityWriterError(
      "DUPLICATE_DIVERGENCE",
      `ClaimVersion authority diverges for ${expected.claimVersionId}`,
    );
  }
}

async function requireExistingClaimIdentityAuthority(
  client: ClaimAuthorityTransactionClient,
  claimId: string,
): Promise<PersistedClaimIdentityAuthority> {
  const result = await client.query<ClaimIdentityAuthorityRow>(
    `SELECT claim_id, canonical_version, canonical, canonical_hash
     FROM public.claim_identity_authorities
     WHERE claim_id = $1`,
    [claimId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ClaimAuthorityWriterError(
      "MISSING_PARENT_CLAIM_AUTHORITY",
      `Claim authority is required for ${claimId}`,
    );
  }
  const expected = buildClaimIdentityCanonical({ claimId });
  assertSupportedCanonicalVersion(row.canonical_version);
  if (
    row.claim_id !== claimId ||
    row.canonical_version !== 1 ||
    row.canonical !== expected.canonical ||
    row.canonical_hash !== expected.hash
  ) {
    throw new ClaimAuthorityWriterError(
      "SOURCE_PARITY_MISMATCH",
      `Claim authority does not authenticate ${claimId}`,
    );
  }
  return {
    claimId,
    canonicalVersion: row.canonical_version,
    canonical: row.canonical,
    canonicalHash: row.canonical_hash,
  };
}

export async function requireClaimIdentityAuthorityWithinTransaction(
  client: ClaimAuthorityTransactionClient,
  claimId: string,
): Promise<PersistedClaimIdentityAuthority> {
  return requireExistingClaimIdentityAuthority(requireClient(client), claimId);
}

export async function persistClaimIdentityAuthorityWithinTransaction(
  client: ClaimAuthorityTransactionClient,
  claimId: string,
): Promise<PersistedClaimIdentityAuthority> {
  const transactionClient = requireClient(client);
  const source = await transactionClient.query<ClaimRow>(
    "SELECT id FROM public.claims WHERE id = $1",
    [claimId],
  );
  const sourceRow = source.rows[0];
  if (!sourceRow) {
    throw new ClaimAuthorityWriterError(
      "MISSING_SOURCE_CLAIM",
      `Claim ${claimId} does not exist`,
    );
  }
  const built = buildClaimIdentityCanonical({ claimId: sourceRow.id });
  const expected: PersistedClaimIdentityAuthority = {
    claimId: sourceRow.id,
    canonicalVersion: 1,
    canonical: built.canonical,
    canonicalHash: built.hash,
  };
  const inserted = await transactionClient.query<ClaimIdentityAuthorityRow>(
    `INSERT INTO public.claim_identity_authorities
      (claim_id, canonical_version, canonical, canonical_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (claim_id) DO NOTHING
     RETURNING claim_id, canonical_version, canonical, canonical_hash`,
    [expected.claimId, expected.canonicalVersion, expected.canonical, expected.canonicalHash],
  );
  if (inserted.rows[0]) {
    return expected;
  }
  const existing = await transactionClient.query<ClaimIdentityAuthorityRow>(
    `SELECT claim_id, canonical_version, canonical, canonical_hash
     FROM public.claim_identity_authorities
     WHERE claim_id = $1`,
    [expected.claimId],
  );
  const existingRow = existing.rows[0];
  if (!existingRow) {
    throw new ClaimAuthorityWriterError(
      "DUPLICATE_DIVERGENCE",
      `Claim authority insertion lost for ${expected.claimId}`,
    );
  }
  assertClaimIdentityAuthorityParity(existingRow, expected);
  return expected;
}

export async function persistClaimVersionAuthorityWithinTransaction(
  client: ClaimAuthorityTransactionClient,
  claimVersionId: string,
): Promise<PersistedClaimVersionAuthority> {
  const transactionClient = requireClient(client);
  const source = await transactionClient.query<ClaimVersionRow>(
    `SELECT id, claim_id, version_number, title, normalized_statement,
            language, claim_type
     FROM public.claim_versions
     WHERE id = $1`,
    [claimVersionId],
  );
  const sourceRow = source.rows[0];
  if (!sourceRow) {
    throw new ClaimAuthorityWriterError(
      "MISSING_SOURCE_CLAIMVERSION",
      `ClaimVersion ${claimVersionId} does not exist`,
    );
  }
  await requireExistingClaimIdentityAuthority(transactionClient, sourceRow.claim_id);
  const built = buildClaimVersionCanonical({
    claimId: sourceRow.claim_id,
    claimVersionId: sourceRow.id,
    versionNumber: sourceRow.version_number,
    title: sourceRow.title,
    normalizedStatement: sourceRow.normalized_statement,
    language: sourceRow.language,
    claimType: sourceRow.claim_type,
  });
  const expected: PersistedClaimVersionAuthority = {
    claimId: sourceRow.claim_id,
    claimVersionId: sourceRow.id,
    versionNumber: sourceRow.version_number,
    title: sourceRow.title,
    normalizedStatement: sourceRow.normalized_statement,
    language: sourceRow.language,
    claimType: sourceRow.claim_type,
    canonicalVersion: 1,
    canonical: built.canonical,
    canonicalHash: built.hash,
  };
  const inserted = await transactionClient.query<ClaimVersionAuthorityRow>(
    `INSERT INTO public.claim_version_authorities
      (claim_version_id, claim_id, version_number, title, normalized_statement,
       language, claim_type, canonical_version, canonical, canonical_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING
     RETURNING claim_version_id, claim_id, version_number, title,
       normalized_statement, language, claim_type, canonical_version,
       canonical, canonical_hash`,
    [
      expected.claimVersionId,
      expected.claimId,
      expected.versionNumber,
      expected.title,
      expected.normalizedStatement,
      expected.language,
      expected.claimType,
      expected.canonicalVersion,
      expected.canonical,
      expected.canonicalHash,
    ],
  );
  if (inserted.rows[0]) {
    return expected;
  }
  const existing = await transactionClient.query<ClaimVersionAuthorityRow>(
    `SELECT claim_version_id, claim_id, version_number, title,
            normalized_statement, language, claim_type,
            canonical_version, canonical, canonical_hash
     FROM public.claim_version_authorities
     WHERE claim_version_id = $1`,
    [expected.claimVersionId],
  );
  const existingRow = existing.rows[0];
  if (!existingRow) {
    const conflictingVersion = await transactionClient.query<ClaimVersionAuthorityRow>(
      `SELECT claim_version_id, claim_id, version_number, title,
              normalized_statement, language, claim_type,
              canonical_version, canonical, canonical_hash
       FROM public.claim_version_authorities
       WHERE claim_id = $1 AND version_number = $2`,
      [expected.claimId, expected.versionNumber],
    );
    if (conflictingVersion.rows[0]) {
      throw new ClaimAuthorityWriterError(
        "DUPLICATE_DIVERGENCE",
        `ClaimVersion logical version diverges for ${expected.claimId}:${expected.versionNumber}`,
      );
    }
    throw new ClaimAuthorityWriterError(
      "DUPLICATE_DIVERGENCE",
      `ClaimVersion authority insertion lost for ${expected.claimVersionId}`,
    );
  }
  assertClaimVersionAuthorityParity(existingRow, expected);
  return expected;
}
