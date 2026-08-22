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
        `DELETE FROM public.evidence_assessment_independence_comparisons
        WHERE assessment_id = ANY($1::uuid[])`,
        [ids.assessmentIds],
      );
      await client.query(
        "DELETE FROM public.evidence_assessments WHERE id = ANY($1::uuid[])",
        [ids.assessmentIds],
      );
    }
    if (ids.versionIds.length > 0) {
      await client.query(
        "DELETE FROM public.claim_version_evidence WHERE claim_version_id = ANY($1::uuid[])",
        [ids.versionIds],
      );
    }
    if (ids.evidenceIds.length > 0) {
      await client.query(
        "DELETE FROM public.evidence WHERE id = ANY($1::uuid[])",
        [ids.evidenceIds],
      );
    }
    if (ids.claimId) {
      await client.query(
        "DELETE FROM public.claim_versions WHERE claim_id = $1",
        [ids.claimId],
      );
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

test("provenance, evidence, assessments and diff remain explicit and reproducible", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const {
    createEvidenceAssessment,
    createEvidenceForClaimVersion,
  } = require("../dist/services/evidenceService");
  const {
    diffClaimVersions,
    getClaimVersionDetails,
  } = require("../dist/services/claimVersionReadService");
  const pool = new Pool(databaseConfig);
  const ids = {
    claimId: undefined,
    versionIds: [],
    evidenceIds: [],
    assessmentIds: [],
  };

  try {
    await assertTestDatabase(pool);

    const initial = await createClaimWithInitialVersion(
      {
        title: "PROVENANCE_INTEGRATION_INITIAL",
        normalizedStatement: "provenance integration statement one",
        language: "en",
        claimType: "integration_test",
      },
      pool,
    );
    ids.claimId = initial.id;
    ids.versionIds.push(initial.version.id);

    const versionTwoRequestId = randomUUID();
    const versionTwo = await createClaimVersion(
      {
        claimId: initial.id,
        basedOnVersionNumber: 1,
        title: "PROVENANCE_INTEGRATION_VERSION_2",
        normalizedStatement: "provenance integration statement two",
        language: "en",
        claimType: "integration_test",
        changeReason: "Primary source was documented",
        actorType: "user",
        actorId: "integration-reviewer",
        sourceType: "manual",
        sourceReference: "integration-case-1",
        requestId: versionTwoRequestId,
      },
      pool,
    );
    ids.versionIds.push(versionTwo.version.id);

    const versionThree = await createClaimVersion(
      {
        claimId: initial.id,
        basedOnVersionNumber: 2,
        title: "PROVENANCE_INTEGRATION_VERSION_3",
        normalizedStatement: "provenance integration statement three",
        language: "en",
        claimType: "integration_test",
        changeReason: "Contradicting evidence was documented",
        actorType: "importer",
        actorId: "integration-importer",
        sourceType: "external_source",
        sourceReference: "integration-case-2",
      },
      pool,
    );
    ids.versionIds.push(versionThree.version.id);

    const provenance = await pool.query(
      `SELECT id, version_number, based_on_version_id, actor_type, actor_id,
        source_type, source_reference, request_id
      FROM public.claim_versions
      WHERE claim_id = $1
      ORDER BY version_number`,
      [initial.id],
    );
    assert.equal(provenance.rowCount, 3);
    assert.equal(provenance.rows[0].based_on_version_id, null);
    assert.equal(provenance.rows[1].based_on_version_id, initial.version.id);
    assert.equal(provenance.rows[2].based_on_version_id, versionTwo.version.id);
    assert.equal(provenance.rows[1].actor_type, "user");
    assert.equal(provenance.rows[1].source_reference, "integration-case-1");
    assert.equal(provenance.rows[1].request_id, versionTwoRequestId);
    assert.match(provenance.rows[2].request_id, /^[0-9a-f-]{36}$/i);

    const rollbackMarker = `https://example.test/atomic-rollback-${randomUUID()}`;
    await assert.rejects(
      createEvidenceForClaimVersion(
        {
          claimId: initial.id,
          versionId: versionTwo.version.id,
          sourceUrl: rollbackMarker,
          retrievedAt: new Date("2026-08-21T09:55:00.000Z"),
          relation: "invalid_relation",
        },
        pool,
      ),
      (error) => error.code === "23514",
    );
    const rolledBackEvidence = await pool.query(
      "SELECT count(*)::integer AS count FROM public.evidence WHERE source_url = $1",
      [rollbackMarker],
    );
    assert.equal(rolledBackEvidence.rows[0].count, 0);

    const supporting = await createEvidenceForClaimVersion(
      {
        claimId: initial.id,
        versionId: versionTwo.version.id,
        sourceUrl: "https://example.test/supporting-report",
        sourceTitle: "Supporting report",
        sourceType: "report",
        locator: "page 4",
        quotedText: "A documented supporting excerpt.",
        snapshotHash: "sha256:integration-support",
        retrievedAt: new Date("2026-08-21T10:00:00.000Z"),
        relation: "supports",
      },
      pool,
    );
    ids.evidenceIds.push(supporting.evidence.id);

    const removedEvidence = await createEvidenceForClaimVersion(
      {
        claimId: initial.id,
        versionId: versionTwo.version.id,
        sourceUrl: "https://example.test/version-two-only",
        retrievedAt: new Date("2026-08-21T10:05:00.000Z"),
        relation: "contextualizes",
      },
      pool,
    );
    ids.evidenceIds.push(removedEvidence.evidence.id);

    const v3BeforeExplicitEvidence = await getClaimVersionDetails(
      initial.id,
      versionThree.version.id,
      pool,
    );
    assert.deepEqual(v3BeforeExplicitEvidence.evidence, []);

    const directRelationId = randomUUID();
    await pool.query(
      `INSERT INTO public.claim_version_evidence (
        id, claim_version_id, evidence_id, relation, created_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [directRelationId, versionThree.version.id, supporting.evidence.id, "contradicts"],
    );

    const addedEvidence = await createEvidenceForClaimVersion(
      {
        claimId: initial.id,
        versionId: versionThree.version.id,
        sourceUrl: "https://example.test/version-three-only",
        retrievedAt: new Date("2026-08-21T10:10:00.000Z"),
        relation: "supports",
      },
      pool,
    );
    ids.evidenceIds.push(addedEvidence.evidence.id);

    const assessment = await createEvidenceAssessment(
      {
        claimId: initial.id,
        versionId: versionThree.version.id,
        evidenceId: supporting.evidence.id,
        sourceQuality: 0.9,
        relevance: 1,
        directness: 0.8,
        recency: 0.7,
        recencyReferenceType: "event_at",
        recencyReferenceAt: new Date("2026-08-21T10:00:00.000Z"),
        independence: 1,
        independenceComparisonRelationIds: [addedEvidence.evidence.relationId],
        assessmentMethod: "manual",
        rationale: "Exact integration rationale: source is direct and independently documented.",
        operationContext: {
          initiator: { type: "human", id: "integration-reviewer" },
        },
      },
      pool,
    );
    ids.assessmentIds.push(assessment.assessment.id);

    const readModel = await getClaimVersionDetails(
      initial.id,
      versionThree.version.id,
      pool,
    );
    assert.equal(readModel.version.basedOnVersionId, versionTwo.version.id);
    assert.equal(readModel.evidence.length, 2);
    const assessedEvidence = readModel.evidence.find(
      (item) => item.id === supporting.evidence.id,
    );
    assert.equal(assessedEvidence.relation, "contradicts");
    assert.equal(assessedEvidence.assessments[0].sourceQuality, 0.9);
    assert.deepEqual(assessedEvidence.assessments[0].initiator, {
      type: "human",
      id: "integration-reviewer",
    });
    assert.equal(assessedEvidence.assessments[0].legacyAssessedBy, null);
    assert.equal(
      assessedEvidence.assessments[0].rationale,
      "Exact integration rationale: source is direct and independently documented.",
    );

    const diff = await diffClaimVersions(
      initial.id,
      versionTwo.version.id,
      versionThree.version.id,
      pool,
    );
    assert.deepEqual(diff.contentChanges.normalizedStatement, {
      from: "provenance integration statement two",
      to: "provenance integration statement three",
    });
    assert.deepEqual(diff.evidenceChanges.added, [addedEvidence.evidence.id]);
    assert.deepEqual(diff.evidenceChanges.removed, [removedEvidence.evidence.id]);
    assert.deepEqual(diff.evidenceChanges.relationChanged, [
      { evidenceId: supporting.evidence.id, from: "supports", to: "contradicts" },
    ]);
    assert.deepEqual(diff.assessmentChanges.added, [assessment.assessment.id]);
    assert.deepEqual(diff.stateChanges, {});
  } finally {
    if (ids.claimId) {
      await cleanup(pool, ids);
      const remaining = await pool.query(
        `SELECT
          (SELECT count(*)::integer FROM public.claims WHERE id = $1) AS claims,
          (SELECT count(*)::integer FROM public.claim_versions WHERE claim_id = $1) AS versions,
          (SELECT count(*)::integer FROM public.evidence WHERE id = ANY($2::uuid[])) AS evidence,
          (SELECT count(*)::integer FROM public.evidence_assessments WHERE id = ANY($3::uuid[])) AS assessments`,
        [ids.claimId, ids.evidenceIds, ids.assessmentIds],
      );
      assert.deepEqual(remaining.rows[0], {
        claims: 0,
        versions: 0,
        evidence: 0,
        assessments: 0,
      });
    }
    await pool.end();
  }
});
