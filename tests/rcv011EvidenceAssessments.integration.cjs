const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const { Pool } = require("pg");

const testDatabase = "factbase_rcv009_test";
const databaseConfig = { database: testDatabase, host: "/tmp", max: 3 };

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

async function expectConstraint(pool, expectedConstraint, relationId, overrides = {}) {
  const values = {
    id: randomUUID(),
    relationId,
    sourceQuality: 0.5,
    relevance: null,
    directness: null,
    recency: null,
    independence: null,
    method: "manual",
    rationale: "Constraint test rationale",
    assessedBy: null,
    initiatorType: null,
    initiatorId: null,
    respondsToId: null,
    responseRelation: null,
    ...overrides,
  };
  await assert.rejects(
    pool.query(
      `INSERT INTO public.evidence_assessments (
        id, claim_version_evidence_id, source_quality, relevance, directness,
        recency, independence, assessment_method, rationale, assessed_by,
        initiator_type, initiator_id, responds_to_assessment_id,
        response_relation, assessed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        CURRENT_TIMESTAMP
      )`,
      [
        values.id, values.relationId, values.sourceQuality, values.relevance,
        values.directness, values.recency, values.independence, values.method,
        values.rationale, values.assessedBy, values.initiatorType,
        values.initiatorId, values.respondsToId, values.responseRelation,
      ],
    ),
    (error) => error.constraint === expectedConstraint,
  );
}

test("RCV-011 assessments are append-only, attributable and explicitly related", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const {
    AssessmentResponseTargetNotFoundError,
    createEvidenceAssessment,
    createEvidenceForClaimVersion,
  } = require("../dist/services/evidenceService");
  const { getClaimVersionDetails } = require("../dist/services/claimVersionReadService");
  const pool = new Pool(databaseConfig);
  const ids = {
    claimId: undefined,
    versionIds: [],
    evidenceIds: [],
    relationIds: [],
    assessmentIds: [],
  };

  try {
    await assertTestDatabase(pool);

    const columns = await pool.query(
      `SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'evidence_assessments'
        AND column_name = ANY($1::text[])
      ORDER BY column_name`,
      [["initiator_type", "initiator_id", "responds_to_assessment_id", "response_relation"]],
    );
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      "initiator_id", "initiator_type", "responds_to_assessment_id", "response_relation",
    ]);

    const legacyChecks = await pool.query(
      `SELECT conname, convalidated
      FROM pg_constraint
      WHERE conrelid = 'public.evidence_assessments'::regclass
        AND conname = ANY($1::text[])
      ORDER BY conname`,
      [[
        "chk_evidence_assessments_has_dimension",
        "chk_evidence_assessments_method",
        "chk_evidence_assessments_rationale",
      ]],
    );
    assert.equal(legacyChecks.rowCount, 3);
    assert.equal(legacyChecks.rows.every((row) => row.convalidated === false), true);

    const initial = await createClaimWithInitialVersion(
      {
        title: "RCV011_ASSESSMENT_INTEGRATION",
        normalizedStatement: "rcv011 assessment integration statement",
        language: "en",
        claimType: "integration_test",
      },
      pool,
    );
    ids.claimId = initial.id;
    ids.versionIds.push(initial.version.id);

    const firstEvidence = await createEvidenceForClaimVersion(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        sourceUrl: `https://example.test/rcv011/${randomUUID()}`,
        retrievedAt: new Date("2026-08-21T10:00:00.000Z"),
        relation: "supports",
      },
      pool,
    );
    ids.evidenceIds.push(firstEvidence.evidence.id);
    ids.relationIds.push(firstEvidence.evidence.relationId);

    const secondEvidence = await createEvidenceForClaimVersion(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        sourceUrl: `https://example.test/rcv011/${randomUUID()}`,
        retrievedAt: new Date("2026-08-21T10:05:00.000Z"),
        relation: "contextualizes",
      },
      pool,
    );
    ids.evidenceIds.push(secondEvidence.evidence.id);
    ids.relationIds.push(secondEvidence.evidence.relationId);

    const root = await createEvidenceAssessment(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        evidenceId: firstEvidence.evidence.id,
        sourceQuality: 0,
        relevance: 1,
        assessmentMethod: "manual",
        rationale: " Root rationale remains byte-for-byte unchanged. ",
      },
      pool,
    );
    ids.assessmentIds.push(root.assessment.id);
    assert.equal(root.assessment.initiator, null);
    assert.equal(root.assessment.responseTo, null);

    const rootBeforeResponses = await pool.query(
      "SELECT * FROM public.evidence_assessments WHERE id = $1",
      [root.assessment.id],
    );

    for (const relation of ["supports", "disputes", "contextualizes"]) {
      const response = await createEvidenceAssessment(
        {
          claimId: initial.id,
          versionId: initial.version.id,
          evidenceId: firstEvidence.evidence.id,
          directness: relation === "supports" ? 1 : 0.5,
          assessmentMethod: relation === "contextualizes" ? "model_assisted" : "manual",
          rationale: `Explicit ${relation} response`,
          respondsToAssessmentId: root.assessment.id,
          responseRelation: relation,
          operationContext: {
            initiator: { type: "agent", id: "rcv011-integration-agent" },
          },
        },
        pool,
      );
      ids.assessmentIds.push(response.assessment.id);
      assert.deepEqual(response.assessment.responseTo, {
        assessmentId: root.assessment.id,
        relation,
      });
    }

    const rootAfterResponses = await pool.query(
      "SELECT * FROM public.evidence_assessments WHERE id = $1",
      [root.assessment.id],
    );
    assert.deepEqual(rootAfterResponses.rows, rootBeforeResponses.rows);

    const countBeforeRejectedResponse = ids.assessmentIds.length;
    await assert.rejects(
      createEvidenceAssessment(
        {
          claimId: initial.id,
          versionId: initial.version.id,
          evidenceId: secondEvidence.evidence.id,
          relevance: 0.5,
          assessmentMethod: "manual",
          rationale: "This response targets an assessment on another relation.",
          respondsToAssessmentId: root.assessment.id,
          responseRelation: "disputes",
        },
        pool,
      ),
      AssessmentResponseTargetNotFoundError,
    );
    const assessmentCount = await pool.query(
      "SELECT count(*)::integer AS count FROM public.evidence_assessments WHERE id = ANY($1::uuid[])",
      [ids.assessmentIds],
    );
    assert.equal(assessmentCount.rows[0].count, countBeforeRejectedResponse);

    const legacyId = randomUUID();
    await pool.query(
      `INSERT INTO public.evidence_assessments (
        id, claim_version_evidence_id, source_quality, assessment_method,
        rationale, assessed_by, assessed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [
        legacyId,
        firstEvidence.evidence.relationId,
        0.5,
        "manual",
        "Legacy identity remains explicitly legacy.",
        "unverified-legacy-label",
      ],
    );
    ids.assessmentIds.push(legacyId);

    const readModel = await getClaimVersionDetails(
      initial.id,
      initial.version.id,
      pool,
    );
    const assessments = readModel.evidence.find(
      (item) => item.id === firstEvidence.evidence.id,
    ).assessments;
    assert.equal(assessments.length, 5);
    assert.equal(assessments.find((item) => item.id === root.assessment.id).rationale,
      " Root rationale remains byte-for-byte unchanged. ");
    assert.equal(assessments.find((item) => item.id === legacyId).legacyAssessedBy,
      "unverified-legacy-label");
    assert.equal(assessments.find((item) => item.id === legacyId).initiator, null);

    const selfId = randomUUID();
    await expectConstraint(
      pool,
      "chk_evidence_assessments_no_self_response",
      firstEvidence.evidence.relationId,
      { id: selfId, respondsToId: selfId, responseRelation: "disputes" },
    );
    await expectConstraint(
      pool,
      "chk_evidence_assessments_response_pair",
      firstEvidence.evidence.relationId,
      { respondsToId: root.assessment.id },
    );
    await expectConstraint(
      pool,
      "chk_evidence_assessments_response_relation",
      firstEvidence.evidence.relationId,
      { respondsToId: root.assessment.id, responseRelation: "supersedes" },
    );
    await expectConstraint(
      pool,
      "fk_evidence_assessments_response_same_relation",
      secondEvidence.evidence.relationId,
      { respondsToId: root.assessment.id, responseRelation: "disputes" },
    );
    await expectConstraint(
      pool,
      "chk_evidence_assessments_has_dimension",
      firstEvidence.evidence.relationId,
      { sourceQuality: null },
    );
    await expectConstraint(
      pool,
      "chk_evidence_assessments_method",
      firstEvidence.evidence.relationId,
      { method: "automatic" },
    );
    await expectConstraint(
      pool,
      "chk_evidence_assessments_rationale",
      firstEvidence.evidence.relationId,
      { rationale: "   " },
    );
    await expectConstraint(
      pool,
      "chk_evidence_assessments_rationale",
      firstEvidence.evidence.relationId,
      { rationale: "x".repeat(4001) },
    );
    await expectConstraint(
      pool,
      "chk_evidence_assessments_initiator_type",
      firstEvidence.evidence.relationId,
      { initiatorType: "api" },
    );
    for (const sourceQuality of ["NaN", "Infinity", -0.01, 1.01]) {
      await expectConstraint(
        pool,
        "chk_evidence_assessments_source_quality",
        firstEvidence.evidence.relationId,
        { sourceQuality },
      );
    }
  } finally {
    if (ids.claimId) {
      await cleanup(pool, ids);
      const remaining = await pool.query(
        `SELECT
          (SELECT count(*)::integer FROM public.claims WHERE id = $1) AS claims,
          (SELECT count(*)::integer FROM public.claim_versions WHERE claim_id = $1) AS versions,
          (SELECT count(*)::integer FROM public.evidence WHERE id = ANY($2::uuid[])) AS evidence,
          (SELECT count(*)::integer FROM public.claim_version_evidence WHERE id = ANY($3::uuid[])) AS relations,
          (SELECT count(*)::integer FROM public.evidence_assessments WHERE id = ANY($4::uuid[])) AS assessments`,
        [ids.claimId, ids.evidenceIds, ids.relationIds, ids.assessmentIds],
      );
      assert.deepEqual(remaining.rows[0], {
        claims: 0, versions: 0, evidence: 0, relations: 0, assessments: 0,
      });
    }
    await pool.end();
  }
});
