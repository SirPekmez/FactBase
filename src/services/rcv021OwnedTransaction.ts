import { randomUUID } from "node:crypto";
import { Rcv021RetainedFailure, throwRcv021RetainedFailures } from "./rcv021WriteFailures";

export interface Rcv021OwnedClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows?: readonly Record<string, any>[]; rowCount?: number | null; command?: string }>;
  release(destroy?: boolean): void | Promise<void>;
}
export interface Rcv021OwnedPool { connect(): Promise<Rcv021OwnedClient>; }
function acknowledge(result: { command?: string } | undefined, command: string): void {
  if (!result || result.command !== command) throw new Error(`MISSING_DATA: ${command} not acknowledged; transaction outcome is not verified`);
}
/** Native PostgreSQL probe; any unrecognized result fails closed. No caller transaction is committed/rolled back. */
async function requireIdle(client: Rcv021OwnedClient): Promise<void> {
  const scope = `rcv021_idle_${randomUUID().replace(/-/g, "")}`;
  const failures: Rcv021RetainedFailure[] = [];
  let result;
  try { result = await client.query(`SAVEPOINT ${scope}`); }
  catch (error) {
    // Retain first, then inspect only an own data descriptor. No getter/toJSON access.
    failures.push({ phase: "primary", error });
    try {
      const descriptor = error !== null && (typeof error === "object" || typeof error === "function") ? Object.getOwnPropertyDescriptor(error, "code") : undefined;
      if (descriptor && "value" in descriptor && descriptor.value === "25P01") return;
    } catch (inspection) { failures.push({ phase: "primary", error: inspection }); }
    throwRcv021RetainedFailures(failures);
  }
  failures.push({ phase: "primary", error: new Error("TRANSACTION_OWNERSHIP_MISMATCH: acquired connection is not idle") });
  try { acknowledge(result, "SAVEPOINT"); } catch (error) { failures.push({ phase: "primary", error }); }
  try { acknowledge(await client.query(`RELEASE SAVEPOINT ${scope}`), "RELEASE"); } catch (error) { failures.push({ phase: "savepoint-release", error }); }
  throwRcv021RetainedFailures(failures);
}

/** Pool lease only; exclusive access is required until completion. Return only after cleanup succeeds. */
export async function runRcv021OwnedTransaction<T>(pool: Rcv021OwnedPool, operation: (client: Rcv021OwnedClient) => Promise<T>, mode: "write" | "snapshot-read" = "write"): Promise<T> {
  if (!pool || typeof pool.connect !== "function") throw new Error("TRANSACTION_OWNERSHIP_MISMATCH: standalone writes require a pool; use the within-transaction primitive for caller clients");
  const client = await pool.connect();
  const failures: Rcv021RetainedFailure[] = [];
  let attemptedBegin = false, committed = false, destroy = true;
  let value: T | undefined;
  let release: Rcv021OwnedClient["release"] | undefined;
  try {
    if (!client) throw new Error("MALFORMED_DATA: pool did not supply a client");
    release = client.release;
    if (typeof release !== "function" || typeof client.query !== "function") throw new Error("MALFORMED_DATA: pool did not supply a releasable exclusive client");
    await requireIdle(client);
    attemptedBegin = true;
    acknowledge(await client.query(mode === "snapshot-read" ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"), "BEGIN");
    value = await operation(client);
    acknowledge(await client.query("COMMIT"), "COMMIT");
    committed = true; destroy = false;
  } catch (error) {
    failures.push({ phase: "primary", error });
    if (attemptedBegin && !committed) {
      try { acknowledge(await client.query("ROLLBACK"), "ROLLBACK"); } catch (error) { failures.push({ phase: "rollback", error }); }
    }
  }
  if (typeof release === "function") {
    try { await release.call(client, destroy); } catch (error) { failures.push({ phase: "connection-release", error }); }
  }
  throwRcv021RetainedFailures(failures);
  if (!committed) throw new Error("MISSING_DATA: transaction proof incomplete");
  return value as T;
}
