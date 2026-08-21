import { Pool, PoolClient } from "pg";

type TransactionPool = Pick<Pool, "connect">;

export async function runInTransaction<T>(
  pool: TransactionPool,
  failureMessage: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let transactionStarted = false;
  let destroyClient = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const result = await operation(client);

    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        destroyClient = true;
        const combinedError = new Error(failureMessage) as Error & {
          originalError: unknown;
          rollbackError: unknown;
        };
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
