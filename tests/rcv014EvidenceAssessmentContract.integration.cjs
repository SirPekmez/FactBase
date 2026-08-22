const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const { Pool } = require("pg");

const testDatabase = "factbase_rcv009_test";
const databaseConfig = { database: testDatabase, host: "/tmp", max: 4 };

async function assertTestDatabase(pool) {
  const identity = await pool.query(
    `SELECT
      current_database() AS database_name,
      inet_server_addr() IS NULL AS uses_local_socket`,
  );
  assert.equal(identity.rows[0].database_name, testDatabase);
  assert.equal(identity.rows[0].uses_local_socket, true);
}

async function expectConstraint(operation, expectedConstraint) {
  await assert.rejects(
    operation,
    (error) => error.code === "23514" || error.code === "23503"
      ? error.constraint === expectedConstraint
      : false,
  );
}

async function insertDirectAssessment(pool, relationId, overrides = {}) {
  const values = {
    id: randomUUID(),
    sourceQuality: 0.5,
    recency: null,
    independence: null,
    method: "manual",
    rationale: "RCV-014 direct database constraint test.",
    rubricId: "factbase-evidence-assessment",
    rubricVersion: "1",
    recencyReferenceType: null,
    recencyReferenceAt: null,
    ruleSetId: null,
    ruleSetVersion: null,
    modelId: null,
    modelVersion: null,
    modelProcessType: null,
    modelProcessVersion: null,
    importReferenceType: null,
    importReference: null,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO public.evidence_assessments (
      id, claim_version_evidence_id, source_quality, recency, independence,
      assessment_method, rationale, rubric_id, rubric_version,
      recency_reference_type, recency_reference_at,
      rule_set_id, rule_set_version,
      model_id, model_version, model_process_type, model_process_version,
      import_reference_type, import_reference, assessed_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP
    )`,
    [
      values.id,
      relationId,
      values.sourceQuality,
      values.recency,
      values.independence,
      values.method,
      values.rationale,
      values.rubricId,
      values.rubricVersion,
      values.recencyReferenceType,
      values.recencyReferenceAt,
      values.ruleSetId,
      values.ruleSetVersion,
      values.modelId,
      values.modelVersion,
      values.modelProcessType,
      values.modelProcessVersion,
      values.importReferenceType,
      values.importReference,
    ],
  );
  return values.id;
}

async function insertAssessmentWithComparison(
  pool,
  relationId,
  comparisonRelationId,
  claimVersionId,
) {
  const client = await pool.connect();
  const assessmentId = randomUUID();
  try {
    await client.query("BEGIN");
    await insertDirectAssessment(
      { query: client.query.bind(client) },
      relationId,
      { id: assessmentId, independence: 0.5 },
    );
    await client.query(
      `INSERT INTO public.evidence_assessment_independence_comparisons (
        assessment_id,
        assessed_claim_version_evidence_id,
        comparison_claim_version_evidence_id,
        claim_version_id,
        created_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [assessmentId, relationId, comparisonRelationId, claimVersionId],
    );
    await client.query("COMMIT");
    return assessmentId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertLegacyAssessmentSkipsRcv014Independence(pool, relationId) {
  const client = await pool.connect();
  const legacyAssessmentId = randomUUID();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(
      `ALTER TABLE public.evidence_assessments
      DROP CONSTRAINT chk_evidence_assessments_rcv014_rubric`,
    );
    await client.query(
      `INSERT INTO public.evidence_assessments (
        id, claim_version_evidence_id, independence, assessment_method,
        rationale, rubric_id, rubric_version, assessed_at
      ) VALUES ($1, $2, 0.5, 'manual', $3, NULL, NULL, CURRENT_TIMESTAMP)`,
      [
        legacyAssessmentId,
        relationId,
        "Legacy assessment created before the RCV-014 rubric existed.",
      ],
    );

    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query(
      `ALTER TABLE public.evidence_assessments
      ADD CONSTRAINT chk_evidence_assessments_rcv014_rubric
      CHECK (
        rubric_id IS NOT NULL AND
        rubric_id = 'factbase-evidence-assessment' AND
        rubric_version IS NOT NULL AND
        rubric_version = '1'
      ) NOT VALID`,
    );
    const visibleLegacyAssessment = await client.query(
      `SELECT count(*)::integer AS count
      FROM public.evidence_assessments
      WHERE id = $1`,
      [legacyAssessmentId],
    );
    assert.equal(visibleLegacyAssessment.rows[0].count, 1);

    await client.query("ROLLBACK");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }

  const persistedLegacyAssessment = await pool.query(
    `SELECT count(*)::integer AS count
    FROM public.evidence_assessments
    WHERE id = $1`,
    [legacyAssessmentId],
  );
  assert.equal(persistedLegacyAssessment.rows[0].count, 0);
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
        `DELETE FROM public.evidence_assessments
        WHERE id = ANY($1::uuid[])`,
        [ids.assessmentIds],
      );
    }
    if (ids.relationIds.length > 0) {
      await client.query(
        `DELETE FROM public.claim_version_evidence
        WHERE id = ANY($1::uuid[])`,
        [ids.relationIds],
      );
    }
    if (ids.evidenceIds.length > 0) {
      await client.query(
        `DELETE FROM public.evidence
        WHERE id = ANY($1::uuid[])`,
        [ids.evidenceIds],
      );
    }
    if (ids.claimIds.length > 0) {
      await client.query(
        `DELETE FROM public.claim_versions
        WHERE claim_id = ANY($1::uuid[])`,
        [ids.claimIds],
      );
      await client.query(
        `DELETE FROM public.claims
        WHERE id = ANY($1::uuid[])`,
        [ids.claimIds],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertNoTestRows(pool, ids) {
  const checks = await Promise.all([
    pool.query(
      `SELECT count(*)::integer AS count
      FROM public.evidence_assessment_independence_comparisons
      WHERE assessment_id = ANY($1::uuid[])`,
      [ids.assessmentIds],
    ),
    pool.query(
      `SELECT count(*)::integer AS count
      FROM public.evidence_assessments
      WHERE id = ANY($1::uuid[])`,
      [ids.assessmentIds],
    ),
    pool.query(
      `SELECT count(*)::integer AS count
      FROM public.claim_version_evidence
      WHERE id = ANY($1::uuid[])`,
      [ids.relationIds],
    ),
    pool.query(
      `SELECT count(*)::integer AS count
      FROM public.evidence
      WHERE id = ANY($1::uuid[])`,
      [ids.evidenceIds],
    ),
    pool.query(
      `SELECT count(*)::integer AS count
      FROM public.claims
      WHERE id = ANY($1::uuid[])`,
      [ids.claimIds],
    ),
  ]);
  assert.deepEqual(checks.map((result) => result.rows[0].count), [0, 0, 0, 0, 0]);
}

test("RCV-014 stores a reproducible assessment contract and same-version independence set", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const {
    IndependenceComparisonError,
    createEvidenceAssessment,
    createEvidenceForClaimVersion,
  } = require("../dist/services/evidenceService");
  const { getClaimVersionDetails } = require("../dist/services/claimVersionReadService");
  const pool = new Pool(databaseConfig);
  const ids = {
    claimIds: [],
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
      [[
        "rubric_id", "rubric_version", "recency_reference_type",
        "recency_reference_at", "rule_set_id", "rule_set_version",
        "model_id", "model_version", "model_process_type",
        "model_process_version", "import_reference_type", "import_reference",
      ]],
    );
    assert.equal(columns.rowCount, 12);

    const constraints = await pool.query(
      `SELECT conname, convalidated, condeferrable, condeferred
      FROM pg_constraint
      WHERE conname = ANY($1::text[])
      ORDER BY conname`,
      [[
        "chk_evidence_assessments_rcv014_rubric",
        "chk_evidence_assessments_rcv014_recency_context",
        "chk_evidence_assessments_rcv014_method_provenance",
        "chk_assessment_independence_not_self",
        "fk_assessment_independence_assessment_relation",
        "fk_assessment_independence_assessed_version",
        "fk_assessment_independence_comparison_version",
      ]],
    );
    assert.equal(constraints.rowCount, 7);
    assert.equal(
      constraints.rows
        .filter((row) => row.conname.startsWith("chk_evidence_assessments_rcv014"))
        .every((row) => row.convalidated === false),
      true,
    );

    const initial = await createClaimWithInitialVersion(
      {
        title: "RCV014_CONTRACT_PRIMARY",
        normalizedStatement: "rcv014 primary integration statement",
        language: "en",
        claimType: "integration_test",
      },
      pool,
    );
    ids.claimIds.push(initial.id);
    const versionTwo = await createClaimVersion(
      {
        claimId: initial.id,
        basedOnVersionNumber: 1,
        title: "RCV014_CONTRACT_SECOND_VERSION",
        normalizedStatement: "rcv014 second integration statement",
        language: "en",
        claimType: "integration_test",
        changeReason: "Create a cross-version comparison boundary fixture",
      },
      pool,
    );

    const otherClaim = await createClaimWithInitialVersion(
      {
        title: "RCV014_CONTRACT_OTHER_CLAIM",
        normalizedStatement: "rcv014 other claim integration statement",
        language: "en",
        claimType: "integration_test",
      },
      pool,
    );
    ids.claimIds.push(otherClaim.id);

    async function addEvidence(claimId, versionId, relation) {
      const created = await createEvidenceForClaimVersion(
        {
          claimId,
          versionId,
          sourceUrl: `https://example.test/rcv014/${randomUUID()}`,
          retrievedAt: new Date("2026-08-22T08:00:00.000Z"),
          relation,
        },
        pool,
      );
      ids.evidenceIds.push(created.evidence.id);
      ids.relationIds.push(created.evidence.relationId);
      return created.evidence;
    }

    const target = await addEvidence(initial.id, initial.version.id, "supports");
    const comparatorOne = await addEvidence(
      initial.id,
      initial.version.id,
      "contextualizes",
    );
    const comparatorTwo = await addEvidence(
      initial.id,
      initial.version.id,
      "contradicts",
    );
    const otherVersionEvidence = await addEvidence(
      initial.id,
      versionTwo.version.id,
      "supports",
    );
    const otherClaimEvidence = await addEvidence(
      otherClaim.id,
      otherClaim.version.id,
      "supports",
    );

    await assertLegacyAssessmentSkipsRcv014Independence(
      pool,
      target.relationId,
    );

    const manual = await createEvidenceAssessment(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        evidenceId: target.id,
        sourceQuality: 0,
        assessmentMethod: "manual",
        rationale: " Manual assessment rationale remains unchanged. ",
      },
      pool,
    );
    ids.assessmentIds.push(manual.assessment.id);
    assert.equal(manual.assessment.initiator, null);
    assert.equal(manual.assessment.rationale, " Manual assessment rationale remains unchanged. ");
    assert.deepEqual(manual.assessment.rubric, {
      id: "factbase-evidence-assessment",
      version: "1",
    });

    const rulesBased = await createEvidenceAssessment(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        evidenceId: target.id,
        relevance: 0.25,
        assessmentMethod: "rules_based",
        ruleSetId: "factbase-source-rules",
        ruleSetVersion: "2026-08",
        rationale: "Rules-based provenance remains explicit.",
      },
      pool,
    );
    ids.assessmentIds.push(rulesBased.assessment.id);
    assert.deepEqual(rulesBased.assessment.method.ruleSet, {
      id: "factbase-source-rules",
      version: "2026-08",
    });

    const modelAssisted = await createEvidenceAssessment(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        evidenceId: target.id,
        directness: 0.5,
        assessmentMethod: "model_assisted",
        modelId: "factbase-review-model",
        modelVersion: "2026-08-22",
        modelProcessType: "prompt",
        modelProcessVersion: "assessment-prompt-v1",
        rationale: "Model and prompt provenance are recorded without weighting.",
      },
      pool,
    );
    ids.assessmentIds.push(modelAssisted.assessment.id);
    assert.deepEqual(modelAssisted.assessment.method.model, {
      id: "factbase-review-model",
      version: "2026-08-22",
      processType: "prompt",
      processVersion: "assessment-prompt-v1",
    });

    const imported = await createEvidenceAssessment(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        evidenceId: target.id,
        sourceQuality: 0.75,
        assessmentMethod: "imported",
        importReferenceType: "external_record",
        importReference: "external-assessment-record-42",
        rationale: "The external record reference documents imported provenance.",
      },
      pool,
    );
    ids.assessmentIds.push(imported.assessment.id);
    assert.deepEqual(imported.assessment.method.imported, {
      referenceType: "external_record",
      reference: "external-assessment-record-42",
    });

    const contextual = await createEvidenceAssessment(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        evidenceId: target.id,
        recency: 1,
        recencyReferenceType: "current_state_at",
        recencyReferenceAt: new Date("2026-08-22T09:00:00.000Z"),
        independence: 0.5,
        independenceComparisonRelationIds: [
          comparatorTwo.relationId.toUpperCase(),
          comparatorOne.relationId.toUpperCase(),
        ],
        assessmentMethod: "manual",
        rationale: "Recency and independence have explicit reference contexts.",
      },
      pool,
    );
    ids.assessmentIds.push(contextual.assessment.id);
    assert.deepEqual(contextual.assessment.independenceComparisonRelationIds, [
      comparatorOne.relationId,
      comparatorTwo.relationId,
    ].sort());

    for (const invalidComparator of [
      target.relationId,
      otherVersionEvidence.relationId,
      otherClaimEvidence.relationId,
    ]) {
      await assert.rejects(
        createEvidenceAssessment(
          {
            claimId: initial.id,
            versionId: initial.version.id,
            evidenceId: target.id,
            independence: 0.5,
            independenceComparisonRelationIds: [invalidComparator],
            assessmentMethod: "manual",
            rationale: "This invalid comparison must roll back.",
          },
          pool,
        ),
        IndependenceComparisonError,
      );
    }

    const persistedCount = await pool.query(
      `SELECT count(*)::integer AS count
      FROM public.evidence_assessments
      WHERE claim_version_evidence_id = $1`,
      [target.relationId],
    );
    assert.equal(persistedCount.rows[0].count, 5);

    const manualBeforeSecondCreate = await pool.query(
      `SELECT * FROM public.evidence_assessments WHERE id = $1`,
      [manual.assessment.id],
    );
    const secondManual = await createEvidenceAssessment(
      {
        claimId: initial.id,
        versionId: initial.version.id,
        evidenceId: target.id,
        sourceQuality: 1,
        assessmentMethod: "manual",
        rationale: "A second create remains a separate append-only row.",
      },
      pool,
    );
    ids.assessmentIds.push(secondManual.assessment.id);
    const manualAfterSecondCreate = await pool.query(
      `SELECT * FROM public.evidence_assessments WHERE id = $1`,
      [manual.assessment.id],
    );
    assert.deepEqual(manualAfterSecondCreate.rows, manualBeforeSecondCreate.rows);
    assert.notEqual(secondManual.assessment.id, manual.assessment.id);

    const details = await getClaimVersionDetails(
      initial.id,
      initial.version.id,
      pool,
    );
    const readTarget = details.evidence.find((item) => item.id === target.id);
    assert.ok(readTarget);
    const readContextual = readTarget.assessments.find(
      (item) => item.id === contextual.assessment.id,
    );
    assert.deepEqual(readContextual.rubric, {
      id: "factbase-evidence-assessment",
      version: "1",
    });
    assert.deepEqual(readContextual.recencyContext, {
      referenceType: "current_state_at",
      referenceAt: new Date("2026-08-22T09:00:00.000Z"),
    });
    assert.deepEqual(readContextual.independenceComparisonRelationIds, [
      comparatorOne.relationId,
      comparatorTwo.relationId,
    ].sort());
    assert.equal(readTarget.assessments.length, 6);

    await expectConstraint(
      insertDirectAssessment(pool, target.relationId, {
        rubricId: null,
        rubricVersion: null,
      }),
      "chk_evidence_assessments_rcv014_rubric",
    );
    await expectConstraint(
      insertDirectAssessment(pool, target.relationId, {
        recency: 0.5,
        recencyReferenceAt: new Date("2026-08-22T09:00:00.000Z"),
      }),
      "chk_evidence_assessments_rcv014_recency_context",
    );
    await expectConstraint(
      insertDirectAssessment(pool, target.relationId, {
        method: "rules_based",
      }),
      "chk_evidence_assessments_rcv014_method_provenance",
    );
    await expectConstraint(
      insertDirectAssessment(pool, target.relationId, {
        method: "model_assisted",
        modelId: "model",
        modelVersion: "1",
        modelProcessVersion: "1",
      }),
      "chk_evidence_assessments_rcv014_method_provenance",
    );
    await expectConstraint(
      insertDirectAssessment(pool, target.relationId, {
        method: "imported",
        importReference: "record-1",
      }),
      "chk_evidence_assessments_rcv014_method_provenance",
    );
    await expectConstraint(
      insertDirectAssessment(pool, target.relationId, {
        independence: 0.5,
      }),
      "chk_evidence_assessments_rcv014_independence_context",
    );

    const noIndependenceAssessmentId = await insertDirectAssessment(
      pool,
      target.relationId,
    );
    ids.assessmentIds.push(noIndependenceAssessmentId);
    await expectConstraint(
      pool.query(
        `INSERT INTO public.evidence_assessment_independence_comparisons (
          assessment_id, assessed_claim_version_evidence_id,
          comparison_claim_version_evidence_id, claim_version_id, created_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [
          noIndependenceAssessmentId,
          target.relationId,
          comparatorOne.relationId,
          initial.version.id,
        ],
      ),
      "chk_evidence_assessments_rcv014_independence_context",
    );

    await expectConstraint(
      insertAssessmentWithComparison(
        pool,
        target.relationId,
        target.relationId,
        initial.version.id,
      ),
      "chk_assessment_independence_not_self",
    );
    await expectConstraint(
      insertAssessmentWithComparison(
        pool,
        target.relationId,
        otherVersionEvidence.relationId,
        initial.version.id,
      ),
      "fk_assessment_independence_comparison_version",
    );

    const validDirectAssessmentId = await insertAssessmentWithComparison(
      pool,
      target.relationId,
      comparatorOne.relationId,
      initial.version.id,
    );
    ids.assessmentIds.push(validDirectAssessmentId);
  } finally {
    await cleanup(pool, ids);
    await assertNoTestRows(pool, ids);
    await pool.end();
  }
});
