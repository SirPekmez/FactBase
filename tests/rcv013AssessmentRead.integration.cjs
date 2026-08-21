const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const { Pool } = require("pg");

const testDatabase = "factbase_rcv009_test";
const databaseConfig = { database: testDatabase, host: "/tmp", max: 5 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function assertTestDatabase(pool) {
  const identity = await pool.query(
    `SELECT
      current_database() AS database_name,
      inet_server_addr() IS NULL AS uses_local_socket`,
  );
  assert.equal(identity.rows[0].database_name, testDatabase);
  assert.equal(identity.rows[0].uses_local_socket, true);
}

async function cleanup(pool, ids) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (ids.assessmentIds.length > 0) {
      await client.query(
        "DELETE FROM public.evidence_assessments WHERE id = ANY($1::uuid[])",
        [ids.assessmentIds],
      );
    }
    if (ids.relationId) {
      await client.query(
        "DELETE FROM public.claim_version_evidence WHERE id = $1",
        [ids.relationId],
      );
    }
    if (ids.evidenceId) {
      await client.query("DELETE FROM public.evidence WHERE id = $1", [ids.evidenceId]);
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

test("claim-version read uses one repeatable read-only snapshot", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const {
    createEvidenceAssessment,
    createEvidenceForClaimVersion,
  } = require("../dist/services/evidenceService");
  const { getClaimVersionDetails } = require("../dist/services/claimVersionReadService");
  const pool = new Pool(databaseConfig);
  const ids = {
    claimId: undefined,
    evidenceId: undefined,
    relationId: undefined,
    assessmentIds: [],
  };
  let readerClient;
  let writerClient;

  try {
    await assertTestDatabase(pool);
    const claim = await createClaimWithInitialVersion(
      {
        title: "RCV013_READ_SNAPSHOT_INTEGRATION",
        normalizedStatement: "rcv013 snapshot integration statement",
        language: "en",
        claimType: "integration_test",
      },
      pool,
    );
    ids.claimId = claim.id;

    const evidence = await createEvidenceForClaimVersion(
      {
        claimId: claim.id,
        versionId: claim.version.id,
        sourceUrl: `https://example.test/rcv013/${randomUUID()}`,
        retrievedAt: new Date("2026-08-21T13:00:00.000Z"),
        relation: "supports",
      },
      pool,
    );
    ids.evidenceId = evidence.evidence.id;
    ids.relationId = evidence.evidence.relationId;

    const root = await createEvidenceAssessment(
      {
        claimId: claim.id,
        versionId: claim.version.id,
        evidenceId: evidence.evidence.id,
        sourceQuality: 0,
        relevance: 1,
        assessmentMethod: "manual",
        rationale: "The unparented assessment has explicit zero and one values.",
      },
      pool,
    );
    ids.assessmentIds.push(root.assessment.id);

    const siblingIds = [
      "01300000-0000-4000-8000-000000000010",
      "01300000-0000-4000-8000-000000000011",
    ];
    ids.assessmentIds.push(...siblingIds);
    await pool.query(
      `INSERT INTO public.evidence_assessments (
        id, claim_version_evidence_id, source_quality, relevance,
        assessment_method, rationale, assessed_by, initiator_type,
        initiator_id, responds_to_assessment_id, response_relation, assessed_at
      ) VALUES
        ($1, $3, 0, NULL, 'manual', 'Legacy-labelled child.',
          'legacy-reviewer', NULL, NULL, $4, 'supports',
          (SELECT assessed_at FROM public.evidence_assessments WHERE id = $4)),
        ($2, $3, NULL, 1, 'manual', 'Trusted child.',
          NULL, 'human', 'verified-reader', $4, 'contextualizes',
          (SELECT assessed_at FROM public.evidence_assessments WHERE id = $4))`,
      [
        siblingIds[0],
        siblingIds[1],
        evidence.evidence.relationId,
        root.assessment.id,
      ],
    );

    readerClient = await pool.connect();
    writerClient = await pool.connect();
    const readerPid = Number(
      (await readerClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
    const writerPid = Number(
      (await writerClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
    assert.notEqual(readerPid, writerPid);

    const snapshotEstablished = deferred();
    const continueRead = deferred();
    let paused = false;
    const readerPool = {
      async connect() {
        return {
          async query(sql, values) {
            const result = await readerClient.query(sql, values);
            if (
              !paused &&
              sql.includes("FROM public.claim_versions") &&
              sql.includes("WHERE id = $1")
            ) {
              paused = true;
              snapshotEstablished.resolve();
              await continueRead.promise;
            }
            return result;
          },
          release(destroy) {
            readerClient.release(destroy);
            readerClient = undefined;
          },
        };
      },
    };

    const readPromise = getClaimVersionDetails(
      claim.id,
      claim.version.id,
      readerPool,
    );
    await snapshotEstablished.promise;
    const readSettings = await readerClient.query(
      `SELECT
        current_setting('transaction_isolation') AS isolation,
        current_setting('transaction_read_only') AS read_only`,
    );
    assert.deepEqual(readSettings.rows[0], {
      isolation: "repeatable read",
      read_only: "on",
    });

    let writerReleased = false;
    const writerPool = {
      async connect() {
        return {
          query: writerClient.query.bind(writerClient),
          release(destroy) {
            writerClient.release(destroy);
            writerClient = undefined;
            writerReleased = true;
          },
        };
      },
    };
    const committedDuringRead = await createEvidenceAssessment(
      {
        claimId: claim.id,
        versionId: claim.version.id,
        evidenceId: evidence.evidence.id,
        directness: 0.5,
        assessmentMethod: "rules_based",
        rationale: "Committed after the reader established its snapshot.",
        respondsToAssessmentId: siblingIds[0],
        responseRelation: "disputes",
      },
      writerPool,
    );
    ids.assessmentIds.push(committedDuringRead.assessment.id);
    assert.equal(writerReleased, true);

    continueRead.resolve();
    const snapshotRead = await readPromise;
    const snapshotEvidence = snapshotRead.evidence[0];
    assert.deepEqual(
      snapshotEvidence.assessments.map((assessment) => assessment.id),
      [...siblingIds, root.assessment.id].sort(),
    );
    assert.equal(
      snapshotEvidence.assessments.some(
        (assessment) => assessment.id === committedDuringRead.assessment.id,
      ),
      false,
    );
    assert.equal(new Set(snapshotEvidence.assessments.map(({ id }) => id)).size, 3);
    assert.deepEqual(snapshotEvidence.assessmentGraph, {
      unparentedAssessmentIds: [root.assessment.id],
      integrity: { status: "valid", anomalies: [] },
    });
    const legacyChild = snapshotEvidence.assessments.find(
      (assessment) => assessment.id === siblingIds[0],
    );
    const trustedChild = snapshotEvidence.assessments.find(
      (assessment) => assessment.id === siblingIds[1],
    );
    assert.equal(legacyChild.sourceQuality, 0);
    assert.equal(legacyChild.relevance, null);
    assert.equal(trustedChild.sourceQuality, null);
    assert.equal(trustedChild.relevance, 1);
    assert.equal(legacyChild.legacyAssessedBy, "legacy-reviewer");
    assert.deepEqual(trustedChild.initiator, {
      type: "human",
      id: "verified-reader",
    });

    const followingRead = await getClaimVersionDetails(
      claim.id,
      claim.version.id,
      pool,
    );
    const followingAssessments = followingRead.evidence[0].assessments;
    assert.equal(followingAssessments.length, 4);
    const visibleResponse = followingAssessments.find(
      (assessment) => assessment.id === committedDuringRead.assessment.id,
    );
    assert.deepEqual(visibleResponse.responseTo, {
      assessmentId: siblingIds[0],
      relation: "disputes",
    });
    assert.equal(
      new Set(followingAssessments.map((assessment) => assessment.id)).size,
      followingAssessments.length,
    );
    assert.equal(followingRead.evidence[0].assessmentGraph.integrity.status, "valid");
  } finally {
    if (readerClient) {
      await readerClient.query("ROLLBACK").catch(() => {});
      readerClient.release();
    }
    if (writerClient) {
      await writerClient.query("ROLLBACK").catch(() => {});
      writerClient.release();
    }
    if (ids.claimId) {
      await cleanup(pool, ids);
      const remaining = await pool.query(
        `SELECT
          (SELECT count(*)::integer FROM public.claims WHERE id = $1) AS claims,
          (SELECT count(*)::integer FROM public.claim_versions WHERE claim_id = $1) AS versions,
          (SELECT count(*)::integer FROM public.evidence WHERE id = $2) AS evidence,
          (SELECT count(*)::integer FROM public.claim_version_evidence WHERE id = $3) AS relations,
          (SELECT count(*)::integer FROM public.evidence_assessments WHERE id = ANY($4::uuid[])) AS assessments`,
        [ids.claimId, ids.evidenceId, ids.relationId, ids.assessmentIds],
      );
      assert.deepEqual(remaining.rows[0], {
        claims: 0,
        versions: 0,
        evidence: 0,
        relations: 0,
        assessments: 0,
      });
    }
    await pool.end();
  }
});
