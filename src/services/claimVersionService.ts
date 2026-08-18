import { randomUUID } from "node:crypto";
import { Pool, QueryResultRow } from "pg";
import databasePool from "../db";

const REVISION_STATUS = "draft";
const REVISION_PUBLICATION_STATUS = "unpublished";
const VERSION_NUMBER_CONSTRAINT = "uq_claim_versions_claimid_version";

export interface CreateClaimVersionInput {
  claimId: string;
  basedOnVersionNumber: number;
  title: string;
  normalizedStatement: string;
  language: string;
  claimType: string;
  changeReason: string;
}

export interface CreatedClaimVersion {
  claimId: string;
  version: {
    id: string;
    claimId: string;
    versionNumber: number;
    title: string;
    normalizedStatement: string;
    language: string;
    claimType: string;
    status: string;
    publicationStatus: string;
    changeReason: string;
    createdAt: Date;
  };
}

interface ClaimRow extends QueryResultRow {
  id: string;
}

interface CurrentVersionRow extends QueryResultRow {
  version_number: number;
}

interface ClaimVersionRow extends QueryResultRow {
  id: string;
  claim_id: string;
  version_number: number;
  title: string;
  normalized_statement: string;
  language: string;
  claim_type: string;
  status: string;
  publication_status: string;
  change_reason: string;
  created_at: Date;
}

interface PostgreSqlError extends Error {
  code?: string;
  constraint?: string;
}

type ClaimVersionPool = Pick<Pool, "connect">;

export class ClaimNotFoundError extends Error {
  constructor(public readonly claimId: string) {
    super(`Claim ${claimId} was not found`);
    this.name = "ClaimNotFoundError";
  }
}

export class ClaimVersionConflictError extends Error {
  constructor(public readonly currentVersionNumber?: number) {
    super(
      currentVersionNumber === undefined
        ? "Claim version conflict"
        : `Claim has advanced to version ${currentVersionNumber}`,
    );
    this.name = "ClaimVersionConflictError";
  }
}

export class ClaimVersionInvariantError extends Error {
  constructor(public readonly claimId: string) {
    super(`Claim ${claimId} has no current version`);
    this.name = "ClaimVersionInvariantError";
  }
}

function isVersionNumberConflict(error: unknown): error is PostgreSqlError {
  if (!(error instanceof Error)) {
    return false;
  }

  const databaseError = error as PostgreSqlError;
  return (
    databaseError.code === "23505" &&
    databaseError.constraint === VERSION_NUMBER_CONSTRAINT
  );
}

export async function createClaimVersion(
  input: CreateClaimVersionInput,
  pool: ClaimVersionPool = databasePool,
): Promise<CreatedClaimVersion> {
  const client = await pool.connect();
  const versionId = randomUUID();
  let transactionStarted = false;
  let destroyClient = false;
  let currentVersionNumber: number | undefined;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const claimResult = await client.query<ClaimRow>(
      `SELECT id
      FROM public.claims
      WHERE id = $1
      FOR UPDATE`,
      [input.claimId],
    );

    if (!claimResult.rows[0]) {
      throw new ClaimNotFoundError(input.claimId);
    }

    const currentVersionResult = await client.query<CurrentVersionRow>(
      `SELECT version_number
      FROM public.claim_versions
      WHERE claim_id = $1
      ORDER BY version_number DESC
      LIMIT 1`,
      [input.claimId],
    );

    const currentVersion = currentVersionResult.rows[0];
    if (!currentVersion) {
      throw new ClaimVersionInvariantError(input.claimId);
    }

    currentVersionNumber = currentVersion.version_number;
    if (input.basedOnVersionNumber !== currentVersionNumber) {
      throw new ClaimVersionConflictError(currentVersionNumber);
    }

    const versionResult = await client.query<ClaimVersionRow>(
      `INSERT INTO public.claim_versions (
        id,
        claim_id,
        version_number,
        title,
        normalized_statement,
        language,
        claim_type,
        status,
        publication_status,
        change_reason,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      RETURNING
        id,
        claim_id,
        version_number,
        title,
        normalized_statement,
        language,
        claim_type,
        status,
        publication_status,
        change_reason,
        created_at`,
      [
        versionId,
        input.claimId,
        currentVersionNumber + 1,
        input.title,
        input.normalizedStatement,
        input.language,
        input.claimType,
        REVISION_STATUS,
        REVISION_PUBLICATION_STATUS,
        input.changeReason,
      ],
    );

    const version = versionResult.rows[0];
    if (!version) {
      throw new Error("Claim version insert returned no row");
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      claimId: input.claimId,
      version: {
        id: version.id,
        claimId: version.claim_id,
        versionNumber: version.version_number,
        title: version.title,
        normalizedStatement: version.normalized_statement,
        language: version.language,
        claimType: version.claim_type,
        status: version.status,
        publicationStatus: version.publication_status,
        changeReason: version.change_reason,
        createdAt: version.created_at,
      },
    };
  } catch (error) {
    const versionNumberConflict = isVersionNumberConflict(error);

    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
        transactionStarted = false;
      } catch (rollbackError) {
        destroyClient = true;
        const combinedError = new Error(
          "Claim version creation failed and the transaction could not be rolled back",
        ) as Error & { originalError: unknown; rollbackError: unknown };
        combinedError.originalError = error;
        combinedError.rollbackError = rollbackError;
        throw combinedError;
      }
    }

    if (versionNumberConflict) {
      let refreshedVersionNumber: number | undefined;

      try {
        const refreshedVersionResult = await client.query<CurrentVersionRow>(
          `SELECT version_number
          FROM public.claim_versions
          WHERE claim_id = $1
          ORDER BY version_number DESC
          LIMIT 1`,
          [input.claimId],
        );
        refreshedVersionNumber =
          refreshedVersionResult.rows[0]?.version_number;
      } catch {
        // A failed refresh must not leak a possibly stale version number.
        destroyClient = true;
      }

      throw new ClaimVersionConflictError(refreshedVersionNumber);
    }

    throw error;
  } finally {
    if (destroyClient) {
      client.release(true);
    } else {
      client.release();
    }
  }
}
