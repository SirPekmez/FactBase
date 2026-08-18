import { randomUUID } from "node:crypto";
import { Pool, QueryResultRow } from "pg";
import databasePool from "../db";

const INITIAL_STATUS = "draft";
const INITIAL_PUBLICATION_STATUS = "unpublished";
const INITIAL_CHANGE_REASON = "initial_creation";

export interface CreateClaimInput {
  title: string;
  normalizedStatement: string;
  language: string;
  claimType: string;
}

export interface CreatedClaim {
  id: string;
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

type ClaimPool = Pick<Pool, "connect">;

export async function createClaimWithInitialVersion(
  input: CreateClaimInput,
  pool: ClaimPool = databasePool,
): Promise<CreatedClaim> {
  const client = await pool.connect();
  const claimId = randomUUID();
  const versionId = randomUUID();
  let transactionStarted = false;
  let destroyClient = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    await client.query(
      "INSERT INTO public.claims (id) VALUES ($1)",
      [claimId],
    );

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
        claimId,
        1,
        input.title,
        input.normalizedStatement,
        input.language,
        input.claimType,
        INITIAL_STATUS,
        INITIAL_PUBLICATION_STATUS,
        INITIAL_CHANGE_REASON,
      ],
    );

    const version = versionResult.rows[0];
    if (!version) {
      throw new Error("Claim version insert returned no row");
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      id: claimId,
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
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        destroyClient = true;
        const combinedError = new Error(
          "Claim creation failed and the transaction could not be rolled back",
        ) as Error & { originalError: unknown; rollbackError: unknown };
        combinedError.originalError = error;
        combinedError.rollbackError = rollbackError;
        throw combinedError;
      }
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
