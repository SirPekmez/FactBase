const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool } = require("pg");

const testDatabase = "factbase_rcv009_test";
const databaseConfig = {
  database: testDatabase,
  host: "/tmp",
  max: 1,
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function isClaimLockQuery(text) {
  return text.includes("FROM public.claims") && text.includes("FOR UPDATE");
}

function controlledPool(pool, { beforeClaimLock, afterClaimLock } = {}) {
  return {
    async connect() {
      const client = await pool.connect();

      return {
        async query(text, values) {
          if (isClaimLockQuery(text)) {
            beforeClaimLock?.();
          }

          const result = await client.query(text, values);

          if (isClaimLockQuery(text)) {
            await afterClaimLock?.();
          }

          return result;
        },
        release(error) {
          client.release(error);
        },
      };
    },
  };
}

async function cleanupTestClaim(pool, claimId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM public.claim_versions WHERE claim_id = $1",
      [claimId],
    );
    await client.query("DELETE FROM public.claims WHERE id = $1", [claimId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function waitForClaimLockBlocking(
  observerPool,
  blockedBackendPid,
  expectedBlockerPid,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await observerPool.query(
      "SELECT pg_blocking_pids($1)::integer[] AS blocking_pids",
      [blockedBackendPid],
    );
    const blockingPids = result.rows[0].blocking_pids;

    if (blockingPids.includes(expectedBlockerPid)) {
      return blockingPids;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(
    `PostgreSQL did not report backend ${blockedBackendPid} as blocked by ${expectedBlockerPid}`,
  );
}

test("parallel version requests serialize on the claim and preserve append-only history", async () => {
  const {
    createClaimWithInitialVersion,
  } = require("../dist/services/claimService");
  const {
    ClaimVersionConflictError,
    createClaimVersion,
  } = require("../dist/services/claimVersionService");
  const poolA = new Pool(databaseConfig);
  const poolB = new Pool(databaseConfig);
  const observerPool = new Pool(databaseConfig);
  let createdClaimId;

  try {
    const [identity, observerIdentity] = await Promise.all([
      poolA.query(
      `SELECT
        current_database() AS database_name,
        inet_server_addr() IS NULL AS uses_local_socket`,
      ),
      observerPool.query(
        `SELECT
          current_database() AS database_name,
          inet_server_addr() IS NULL AS uses_local_socket`,
      ),
    ]);
    assert.equal(identity.rows[0].database_name, testDatabase);
    assert.equal(identity.rows[0].uses_local_socket, true);
    assert.equal(observerIdentity.rows[0].database_name, testDatabase);
    assert.equal(observerIdentity.rows[0].uses_local_socket, true);

    const [backendA, backendB] = await Promise.all([
      poolA.query("SELECT pg_backend_pid() AS backend_pid"),
      poolB.query("SELECT pg_backend_pid() AS backend_pid"),
    ]);
    assert.notEqual(
      backendA.rows[0].backend_pid,
      backendB.rows[0].backend_pid,
      "parallel test requires two PostgreSQL connections",
    );

    const initialClaim = await createClaimWithInitialVersion(
      {
        title: "INTEGRATION_TEST_INITIAL_VERSION",
        normalizedStatement: "integration_test_initial_version",
        language: "en",
        claimType: "integration_test",
      },
      poolA,
    );
    createdClaimId = initialClaim.id;

    const initialVersionResult = await poolA.query(
      `SELECT
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
      FROM public.claim_versions
      WHERE claim_id = $1 AND version_number = 1`,
      [createdClaimId],
    );
    assert.equal(initialVersionResult.rowCount, 1);
    const initialVersionBefore = initialVersionResult.rows[0];

    const firstLockAcquired = deferred();
    const allowFirstRequestToContinue = deferred();
    const secondLockAttempted = deferred();
    const firstPool = controlledPool(poolA, {
      afterClaimLock: async () => {
        firstLockAcquired.resolve();
        await allowFirstRequestToContinue.promise;
      },
    });
    const secondPool = controlledPool(poolB, {
      beforeClaimLock: () => secondLockAttempted.resolve(),
    });

    const firstRequest = createClaimVersion(
      {
        claimId: createdClaimId,
        basedOnVersionNumber: 1,
        title: "INTEGRATION_TEST_VERSION_2",
        normalizedStatement: "integration_test_version_2",
        language: "en",
        claimType: "integration_test",
        changeReason: "parallel request A",
      },
      firstPool,
    );
    await firstLockAcquired.promise;

    const secondRequest = createClaimVersion(
      {
        claimId: createdClaimId,
        basedOnVersionNumber: 1,
        title: "INTEGRATION_TEST_STALE_REQUEST",
        normalizedStatement: "integration_test_stale_request",
        language: "en",
        claimType: "integration_test",
        changeReason: "parallel request B based on stale version",
      },
      secondPool,
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await secondLockAttempted.promise;

    let blockingPids;
    let blockingObservationError;
    try {
      blockingPids = await waitForClaimLockBlocking(
        observerPool,
        backendB.rows[0].backend_pid,
        backendA.rows[0].backend_pid,
      );
    } catch (error) {
      blockingObservationError = error;
    } finally {
      allowFirstRequestToContinue.resolve();
    }
    const versionTwo = await firstRequest;
    const staleOutcome = await secondRequest;

    if (blockingObservationError) {
      throw blockingObservationError;
    }
    assert.equal(blockingPids.includes(backendA.rows[0].backend_pid), true);
    assert.equal(versionTwo.version.versionNumber, 2);
    assert.equal(versionTwo.version.status, "draft");
    assert.equal(versionTwo.version.publicationStatus, "unpublished");
    assert.equal(staleOutcome.error instanceof ClaimVersionConflictError, true);
    assert.equal(staleOutcome.error.currentVersionNumber, 2);

    const versionThree = await createClaimVersion(
      {
        claimId: createdClaimId,
        basedOnVersionNumber: 2,
        title: "INTEGRATION_TEST_VERSION_3",
        normalizedStatement: "integration_test_version_3",
        language: "en",
        claimType: "integration_test",
        changeReason: "explicit revision based on version 2",
      },
      poolB,
    );
    assert.equal(versionThree.version.versionNumber, 3);

    const versionsAfter = await poolA.query(
      `SELECT
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
      FROM public.claim_versions
      WHERE claim_id = $1
      ORDER BY version_number`,
      [createdClaimId],
    );

    assert.equal(versionsAfter.rowCount, 3);
    assert.deepEqual(
      versionsAfter.rows.map(({ version_number }) => version_number),
      [1, 2, 3],
    );
    assert.deepEqual(versionsAfter.rows[0], initialVersionBefore);
    assert.equal(versionsAfter.rows[1].claim_id, createdClaimId);
    assert.equal(versionsAfter.rows[1].status, "draft");
    assert.equal(versionsAfter.rows[1].publication_status, "unpublished");
    assert.equal(versionsAfter.rows[1].change_reason, "parallel request A");
    assert.equal(versionsAfter.rows[1].based_on_version_id, initialVersionBefore.id);
    assert.equal(versionsAfter.rows[2].claim_id, createdClaimId);
    assert.equal(versionsAfter.rows[2].status, "draft");
    assert.equal(versionsAfter.rows[2].publication_status, "unpublished");
    assert.equal(
      versionsAfter.rows[2].change_reason,
      "explicit revision based on version 2",
    );
    assert.equal(versionsAfter.rows[2].based_on_version_id, versionsAfter.rows[1].id);
  } finally {
    if (createdClaimId) {
      await cleanupTestClaim(poolA, createdClaimId);
      const remaining = await poolA.query(
        `SELECT
          (SELECT count(*)::integer FROM public.claims WHERE id = $1) AS claims,
          (SELECT count(*)::integer FROM public.claim_versions WHERE claim_id = $1) AS versions`,
        [createdClaimId],
      );
      assert.deepEqual(remaining.rows[0], { claims: 0, versions: 0 });
    }

    await Promise.all([poolA.end(), poolB.end(), observerPool.end()]);
  }
});
