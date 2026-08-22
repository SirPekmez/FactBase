const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const { Pool } = require("pg");

const testDatabase = "factbase_rcv009_test";
const databaseConfig = { database: testDatabase, host: "/tmp", max: 5 };

async function assertTestDatabase(pool) {
  const identity = await pool.query(
    `SELECT
      current_database() AS database_name,
      current_setting('transaction_isolation') AS transaction_isolation,
      inet_server_addr() IS NULL AS uses_local_socket`,
  );
  assert.equal(identity.rows[0].database_name, testDatabase);
  assert.equal(identity.rows[0].transaction_isolation, "read committed");
  assert.equal(identity.rows[0].uses_local_socket, true);
}

async function waitForBlocking(observer, blockedPid, blockerPid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const blocking = await observer.query(
      "SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked",
      [blockedPid, blockerPid],
    );
    if (blocking.rows[0].blocked) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Backend ${blockedPid} was not blocked by backend ${blockerPid}`);
}

async function cleanup(pool, ids) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (ids.assessmentIds.length > 0) {
      await client.query(
        `DELETE FROM public.evidence_assessment_independence_comparisons
        WHERE assessment_id = ANY($1::uuid[])`,
        [ids.assessmentIds],
      );
      await client.query(
        "DELETE FROM public.evidence_assessments WHERE id = ANY($1::uuid[])",
        [ids.assessmentIds],
      );
    }
    if (ids.relationIds.length > 0) {
      await client.query(
        "DELETE FROM public.claim_version_evidence WHERE id = ANY($1::uuid[])",
        [ids.relationIds],
      );
    }
    if (ids.evidenceIds.length > 0) {
      await client.query(
        "DELETE FROM public.evidence WHERE id = ANY($1::uuid[])",
        [ids.evidenceIds],
      );
    }
    if (ids.claimId) {
      await client.query("DELETE FROM public.claim_versions WHERE claim_id = $1", [ids.claimId]);
      await client.query("DELETE FROM public.claims WHERE id = $1", [ids.claimId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function singleClientPool(client) {
  return { async connect() { return client; } };
}

test("assessment writes serialize per evidence relation without globally blocking other relations", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const {
    createEvidenceAssessment,
    createEvidenceForClaimVersion,
  } = require("../dist/services/evidenceService");
  const pool = new Pool(databaseConfig);
  const ids = {
    claimId: undefined,
    evidenceIds: [],
    relationIds: [],
    assessmentIds: [],
  };

  let relationLockClient;
  let independentLockClient;
  try {
    await assertTestDatabase(pool);
    const claim = await createClaimWithInitialVersion(
      {
        title: "ASSESSMENT_LOCKING_INTEGRATION",
        normalizedStatement: "assessment locking integration statement",
        language: "en",
        claimType: "integration_test",
      },
      pool,
    );
    ids.claimId = claim.id;

    const evidence = [];
    for (const suffix of ["one", "two"]) {
      const created = await createEvidenceForClaimVersion(
        {
          claimId: claim.id,
          versionId: claim.version.id,
          sourceUrl: `https://example.test/assessment-lock-${suffix}-${randomUUID()}`,
          retrievedAt: new Date("2026-08-21T12:00:00.000Z"),
          relation: "supports",
        },
        pool,
      );
      evidence.push(created.evidence);
      ids.evidenceIds.push(created.evidence.id);
      ids.relationIds.push(created.evidence.relationId);
    }

    const roots = [];
    for (const item of evidence) {
      const root = await createEvidenceAssessment(
        {
          claimId: claim.id,
          versionId: claim.version.id,
          evidenceId: item.id,
          relevance: 1,
          assessmentMethod: "manual",
          rationale: `Root for relation ${item.relationId}`,
        },
        pool,
      );
      roots.push(root.assessment);
      ids.assessmentIds.push(root.assessment.id);
    }

    relationLockClient = await pool.connect();
    const blockedWriterClient = await pool.connect();
    const blockerPid = Number((await relationLockClient.query(
      "SELECT pg_backend_pid() AS pid",
    )).rows[0].pid);
    const blockedPid = Number((await blockedWriterClient.query(
      "SELECT pg_backend_pid() AS pid",
    )).rows[0].pid);

    await relationLockClient.query("BEGIN");
    await relationLockClient.query(
      "SELECT id FROM public.claim_version_evidence WHERE id = $1 FOR UPDATE",
      [evidence[0].relationId],
    );
    const committedParentId = randomUUID();
    ids.assessmentIds.push(committedParentId);
    await relationLockClient.query(
      `INSERT INTO public.evidence_assessments (
        id, claim_version_evidence_id, relevance, assessment_method,
        rationale, responds_to_assessment_id, response_relation,
        rubric_id, rubric_version, assessed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7,
        'factbase-evidence-assessment', '1', CURRENT_TIMESTAMP)`,
      [
        committedParentId,
        evidence[0].relationId,
        0.9,
        "manual",
        "Parent committed while the competing writer waits.",
        roots[0].id,
        "supports",
      ],
    );

    const serializedWrite = createEvidenceAssessment(
      {
        claimId: claim.id,
        versionId: claim.version.id,
        evidenceId: evidence[0].id,
        directness: 0.8,
        assessmentMethod: "manual",
        rationale: "This write must wait for the shared relation lock.",
        respondsToAssessmentId: committedParentId,
        responseRelation: "supports",
      },
      singleClientPool(blockedWriterClient),
    );

    await waitForBlocking(relationLockClient, blockedPid, blockerPid);
    const lockState = await relationLockClient.query(
      `SELECT mode, granted
      FROM pg_locks
      WHERE pid = $1
        AND locktype = 'transactionid'
        AND granted`,
      [blockerPid],
    );
    assert.equal(lockState.rowCount > 0, true);

    await relationLockClient.query("COMMIT");
    relationLockClient.release();
    relationLockClient = undefined;

    const serializedResult = await serializedWrite;
    ids.assessmentIds.push(serializedResult.assessment.id);
    assert.deepEqual(serializedResult.assessment.responseTo, {
      assessmentId: committedParentId,
      relation: "supports",
    });

    independentLockClient = await pool.connect();
    const independentWriterClient = await pool.connect();
    await independentWriterClient.query("SET statement_timeout = '1500ms'");
    await independentLockClient.query("BEGIN");
    await independentLockClient.query(
      "SELECT id FROM public.claim_version_evidence WHERE id = $1 FOR UPDATE",
      [evidence[0].relationId],
    );

    const independentResult = await createEvidenceAssessment(
      {
        claimId: claim.id,
        versionId: claim.version.id,
        evidenceId: evidence[1].id,
        sourceQuality: 0.7,
        assessmentMethod: "rules_based",
        ruleSetId: "rcv012-locking-rules",
        ruleSetVersion: "1",
        rationale: "A different relation must remain independently writable.",
        respondsToAssessmentId: roots[1].id,
        responseRelation: "contextualizes",
      },
      singleClientPool(independentWriterClient),
    );
    ids.assessmentIds.push(independentResult.assessment.id);

    const stillLocked = await independentLockClient.query(
      "SELECT txid_current_if_assigned() IS NOT NULL AS transaction_open",
    );
    assert.equal(stillLocked.rows[0].transaction_open, true);
    await independentLockClient.query("COMMIT");
    independentLockClient.release();
    independentLockClient = undefined;

    const persisted = await pool.query(
      `SELECT id, claim_version_evidence_id, responds_to_assessment_id
      FROM public.evidence_assessments
      WHERE id = ANY($1::uuid[])
      ORDER BY id`,
      [ids.assessmentIds],
    );
    assert.equal(persisted.rowCount, 5);
    assert.equal(
      persisted.rows.every((row) =>
        ids.relationIds.includes(row.claim_version_evidence_id)),
      true,
    );
  } finally {
    if (relationLockClient) {
      await relationLockClient.query("ROLLBACK").catch(() => {});
      relationLockClient.release();
    }
    if (independentLockClient) {
      await independentLockClient.query("ROLLBACK").catch(() => {});
      independentLockClient.release();
    }
    if (ids.claimId) {
      await cleanup(pool, ids);
      const remaining = await pool.query(
        `SELECT
          (SELECT count(*)::integer FROM public.claims WHERE id = $1) AS claims,
          (SELECT count(*)::integer FROM public.evidence WHERE id = ANY($2::uuid[])) AS evidence,
          (SELECT count(*)::integer FROM public.claim_version_evidence WHERE id = ANY($3::uuid[])) AS relations,
          (SELECT count(*)::integer FROM public.evidence_assessments WHERE id = ANY($4::uuid[])) AS assessments`,
        [ids.claimId, ids.evidenceIds, ids.relationIds, ids.assessmentIds],
      );
      assert.deepEqual(remaining.rows[0], {
        claims: 0, evidence: 0, relations: 0, assessments: 0,
      });
    }
    await pool.end();
  }
});
