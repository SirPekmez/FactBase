import { randomUUID } from "node:crypto";
import { Pool, QueryResultRow } from "pg";
import databasePool from "../db";
import {
  ClaimAuthorityTransactionClient,
  persistClaimIdentityAuthorityWithinTransaction,
  persistClaimVersionAuthorityWithinTransaction,
} from "./claimHistoricalAuthorityWriter";

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

export interface ClaimCreationIds {
  claimId: string;
  versionId: string;
  requestId: string;
}

export async function createClaimWithInitialVersionWithinTransaction(
  client: ClaimAuthorityTransactionClient,
  input: CreateClaimInput,
  ids: ClaimCreationIds = {
    claimId: randomUUID(),
    versionId: randomUUID(),
    requestId: randomUUID(),
  },
): Promise<CreatedClaim> {
  await client.query(
    "INSERT INTO public.claims (id) VALUES ($1)",
    [ids.claimId],
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
      based_on_version_id,
      actor_type,
      actor_id,
      source_type,
      source_reference,
      request_id,
      created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP
    )
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
      ids.versionId,
      ids.claimId,
      1,
      input.title,
      input.normalizedStatement,
      input.language,
      input.claimType,
      INITIAL_STATUS,
      INITIAL_PUBLICATION_STATUS,
      INITIAL_CHANGE_REASON,
      null,
      "api",
      null,
      "api",
      null,
      ids.requestId,
    ],
  );

  const version = versionResult.rows[0];
  if (!version) {
    throw new Error("Claim version insert returned no row");
  }

  return {
    id: ids.claimId,
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
}

async function runClaimTransaction<T>(
  pool: ClaimPool,
  work: (client: ClaimAuthorityTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let transactionStarted = false;
  let destroyClient = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await work(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
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

export async function createClaimWithInitialVersion(
  input: CreateClaimInput,
  pool: ClaimPool = databasePool,
): Promise<CreatedClaim> {
  return runClaimTransaction(pool, (client) =>
    createClaimWithInitialVersionWithinTransaction(client, input),
  );
}

export async function createClaimWithInitialVersionAndAuthority(
  input: CreateClaimInput,
  pool: ClaimPool = databasePool,
): Promise<CreatedClaim> {
  return runClaimTransaction(pool, async (client) => {
    const created = await createClaimWithInitialVersionWithinTransaction(
      client,
      input,
    );
    await persistClaimIdentityAuthorityWithinTransaction(client, created.id);
    await persistClaimVersionAuthorityWithinTransaction(
      client,
      created.version.id,
    );
    return created;
  });
}
