const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const test = require("node:test");
const { Pool } = require("pg");

const testDatabase = "factbase_rcv009_test";
const databaseConfig = { database: testDatabase, host: "/tmp", max: 5 };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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
    if (ids.derivationIds.length > 0) {
      await client.query(
        "DELETE FROM public.derivation_recorded_process_audits WHERE derivation_id = ANY($1::uuid[])",
        [ids.derivationIds],
      );
      await client.query(
        "DELETE FROM public.derivation_assessment_inputs WHERE derivation_id = ANY($1::uuid[])",
        [ids.derivationIds],
      );
      await client.query(
        "DELETE FROM public.derivation_evidence_inputs WHERE derivation_id = ANY($1::uuid[])",
        [ids.derivationIds],
      );
      await client.query(
        "DELETE FROM public.derivations WHERE id = ANY($1::uuid[])",
        [ids.derivationIds],
      );
    }
    if (ids.ruleRevisionIds.length > 0) {
      await client.query(
        "DELETE FROM public.derivation_rule_decision_codes WHERE rule_revision_id = ANY($1::uuid[])",
        [ids.ruleRevisionIds],
      );
      await client.query(
        "DELETE FROM public.derivation_rule_revisions WHERE id = ANY($1::uuid[])",
        [ids.ruleRevisionIds],
      );
    }
    if (ids.assessmentIds.length > 0) {
      await client.query(
        "DELETE FROM public.evidence_assessment_independence_comparisons WHERE assessment_id = ANY($1::uuid[])",
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

function deterministicDefinition() {
  const { getDerivationInterpreterArtifactHash } =
    require("../dist/services/derivationRuleInterpreter");
  const { getDerivationExecutionIdentity } =
    require("../dist/services/derivationExecutionIdentity");
  return {
    dsl: { id: "factbase-derivation-rule-dsl", version: "1" },
    interpreter: {
      id: "factbase-derivation-rule-interpreter",
      version: "1",
      artifactHash: getDerivationInterpreterArtifactHash(),
      execution: getDerivationExecutionIdentity(),
    },
    output: { operation: "input_manifest" },
  };
}

function recordedDefinition() {
  return {
    contract: { id: "factbase-recorded-process-rule", version: "1" },
    audit: {
      schemaId: "factbase-recorded-process-audit",
      schemaVersion: "1",
    },
  };
}

function faultInjectingPool(pool, failingSqlFragment) {
  const releases = [];
  return {
    releases,
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, values) {
          if (sql.includes(failingSqlFragment)) {
            throw new Error(`Injected failure at ${failingSqlFragment}`);
          }
          return client.query(sql, values);
        },
        release(destroy) {
          releases.push(destroy === true);
          client.release(destroy);
        },
      };
    },
  };
}

async function rcv015CountsForClaimVersion(pool, claimVersionId) {
  const result = await pool.query(
    `SELECT
      (SELECT count(*)::integer
        FROM public.derivations
        WHERE claim_version_id = $1) AS derivations,
      (SELECT count(*)::integer
        FROM public.derivation_evidence_inputs dei
        INNER JOIN public.derivations d ON d.id = dei.derivation_id
        WHERE d.claim_version_id = $1) AS evidence_inputs,
      (SELECT count(*)::integer
        FROM public.derivation_assessment_inputs dai
        INNER JOIN public.derivations d ON d.id = dai.derivation_id
        WHERE d.claim_version_id = $1) AS assessment_inputs,
      (SELECT count(*)::integer
        FROM public.derivation_recorded_process_audits drpa
        INNER JOIN public.derivations d ON d.id = drpa.derivation_id
        WHERE d.claim_version_id = $1) AS process_audits`,
    [claimVersionId],
  );
  return result.rows[0];
}

test("RCV-015 persists reproducible derivations without introducing proof semantics", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const {
    createEvidenceAssessment,
    createEvidenceForClaimVersion,
  } = require("../dist/services/evidenceService");
  const {
    createDerivationRuleRevision,
  } = require("../dist/services/derivationRuleService");
  const { createDerivation } = require("../dist/services/derivationService");
  const { getDerivationDetails } = require("../dist/services/derivationReadService");

  const pool = new Pool(databaseConfig);
  const writerPool = new Pool(databaseConfig);
  const timezonePools = [];
  const ids = {
    claimId: undefined,
    evidenceIds: [],
    relationIds: [],
    assessmentIds: [],
    ruleRevisionIds: [],
    derivationIds: [],
  };

  try {
    await assertTestDatabase(pool);
    await assertTestDatabase(writerPool);

    const tables = await pool.query(
      `SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name`,
      [[
        "derivation_assessment_inputs",
        "derivation_evidence_inputs",
        "derivation_recorded_process_audits",
        "derivation_rule_decision_codes",
        "derivation_rule_revisions",
        "derivations",
      ]],
    );
    assert.equal(tables.rowCount, 6);

    const claim = await createClaimWithInitialVersion(
      {
        title: "RCV015_REPRODUCIBLE_DERIVATION",
        normalizedStatement: "rcv015 reproducible derivation test",
        language: "en",
        claimType: "integration_test",
      },
      pool,
    );
    ids.claimId = claim.id;

    const evidenceOne = await createEvidenceForClaimVersion(
      {
        claimId: claim.id,
        versionId: claim.version.id,
        sourceUrl: `https://example.test/rcv015/${randomUUID()}`,
        retrievedAt: new Date("2026-08-22T14:00:00.123Z"),
        relation: "supports",
      },
      pool,
    );
    const evidenceTwo = await createEvidenceForClaimVersion(
      {
        claimId: claim.id,
        versionId: claim.version.id,
        sourceUrl: `https://example.test/rcv015/${randomUUID()}`,
        retrievedAt: new Date("2026-08-22T14:01:00.456Z"),
        relation: "contradicts",
      },
      pool,
    );
    for (const evidence of [evidenceOne, evidenceTwo]) {
      ids.evidenceIds.push(evidence.evidence.id);
      ids.relationIds.push(evidence.evidence.relationId);
    }
    await pool.query(
      "UPDATE public.claim_versions SET created_at = $1::timestamptz WHERE id = $2",
      ["2026-08-22T13:59:59.000001Z", claim.version.id],
    );
    await pool.query(
      "UPDATE public.evidence SET retrieved_at = $1::timestamptz WHERE id = $2",
      ["2026-08-22T14:00:00.123456Z", evidenceOne.evidence.id],
    );
    await pool.query(
      "UPDATE public.claim_version_evidence SET created_at = $1::timestamptz WHERE id = $2",
      ["2026-08-22T14:00:01.000001Z", evidenceOne.evidence.relationId],
    );

    const preciseAssessmentId = randomUUID();
    ids.assessmentIds.push(preciseAssessmentId);
    await pool.query(
      `INSERT INTO public.evidence_assessments (
        id, claim_version_evidence_id, source_quality,
        assessment_method, rationale, rubric_id, rubric_version, assessed_at
      ) VALUES (
        $1, $2, 0.7500000000000001, 'manual', $3,
        'factbase-evidence-assessment', '1', $4::timestamptz
      )`,
      [
        preciseAssessmentId,
        evidenceOne.evidence.relationId,
        "High-precision NUMERIC must remain a decimal string.",
        "2026-08-22T14:00:02.123456Z",
      ],
    );

    const mismatchedArtifactDefinition = deterministicDefinition();
    mismatchedArtifactDefinition.interpreter.artifactHash = "0".repeat(64);
    await assert.rejects(
      createDerivationRuleRevision(
        {
          ruleId: `rcv015-wrong-artifact-${randomUUID()}`,
          ruleVersion: "1",
          derivationType: "input_manifest",
          inputSchemaId: "factbase-derivation-input",
          inputSchemaVersion: "1",
          outputSchemaId: "factbase-input-manifest",
          outputSchemaVersion: "1",
          reproducibilityMode: "deterministic_rules",
          definition: mismatchedArtifactDefinition,
        },
        pool,
      ),
      /interpreter artifact hash mismatch/,
    );
    const mismatchedExecutionDefinition = deterministicDefinition();
    mismatchedExecutionDefinition.interpreter.execution.contractHash = "0".repeat(64);
    await assert.rejects(
      createDerivationRuleRevision(
        {
          ruleId: `rcv015-wrong-execution-${randomUUID()}`,
          ruleVersion: "1",
          derivationType: "input_manifest",
          inputSchemaId: "factbase-derivation-input",
          inputSchemaVersion: "1",
          outputSchemaId: "factbase-input-manifest",
          outputSchemaVersion: "1",
          reproducibilityMode: "deterministic_rules",
          definition: mismatchedExecutionDefinition,
        },
        pool,
      ),
      /interpreter artifact hash mismatch/,
    );

    const deterministicRule = await createDerivationRuleRevision(
      {
        ruleId: `rcv015-neutral-manifest-${randomUUID()}`,
        ruleVersion: "1",
        derivationType: "input_manifest",
        inputSchemaId: "factbase-derivation-input",
        inputSchemaVersion: "1",
        outputSchemaId: "factbase-input-manifest",
        outputSchemaVersion: "1",
        reproducibilityMode: "deterministic_rules",
        definition: deterministicDefinition(),
      },
      pool,
    );
    ids.ruleRevisionIds.push(deterministicRule.id);
    assert.match(deterministicRule.interpreterArtifactHash, /^[0-9a-f]{64}$/);
    assert.equal(
      deterministicRule.interpreterExecutionContractId,
      "factbase-derivation-interpreter-execution",
    );
    assert.equal(deterministicRule.interpreterExecutionContractVersion, "1");
    assert.match(deterministicRule.interpreterExecutionContractHash, /^[0-9a-f]{64}$/);
    assert.equal(deterministicRule.interpreterRuntimeId, "node-v8");
    assert.match(deterministicRule.interpreterRuntimeVersion, /^node:.+;v8:.+$/);
    assert.equal(
      deterministicRule.snapshotBuilderId,
      "factbase-derivation-snapshot-builder",
    );
    assert.equal(deterministicRule.snapshotBuilderVersion, "1");
    assert.match(deterministicRule.snapshotBuilderArtifactHash, /^[0-9a-f]{64}$/);
    await pool.query(
      `UPDATE public.derivation_rule_revisions
      SET interpreter_artifact_hash = repeat('0', 64)
      WHERE id = $1`,
      [deterministicRule.id],
    );
    await assert.rejects(
      createDerivation(
        { claimVersionId: claim.version.id, ruleRevisionId: deterministicRule.id },
        pool,
      ),
      /interpreter artifact hash mismatch/,
    );
    await pool.query(
      `UPDATE public.derivation_rule_revisions
      SET interpreter_artifact_hash = $1
      WHERE id = $2`,
      [deterministicRule.interpreterArtifactHash, deterministicRule.id],
    );
    await pool.query(
      `UPDATE public.derivation_rule_revisions
      SET interpreter_execution_contract_hash = repeat('0', 64)
      WHERE id = $1`,
      [deterministicRule.id],
    );
    await assert.rejects(
      createDerivation(
        { claimVersionId: claim.version.id, ruleRevisionId: deterministicRule.id },
        pool,
      ),
      /interpreter artifact hash mismatch/,
    );
    await pool.query(
      `UPDATE public.derivation_rule_revisions
      SET interpreter_execution_contract_hash = $1
      WHERE id = $2`,
      [deterministicRule.interpreterExecutionContractHash, deterministicRule.id],
    );
    await pool.query(
      `UPDATE public.derivation_rule_revisions
      SET snapshot_builder_artifact_hash = repeat('0', 64)
      WHERE id = $1`,
      [deterministicRule.id],
    );
    await assert.rejects(
      createDerivation(
        { claimVersionId: claim.version.id, ruleRevisionId: deterministicRule.id },
        pool,
      ),
      /snapshot builder artifact hash mismatch/,
    );
    await pool.query(
      `UPDATE public.derivation_rule_revisions
      SET snapshot_builder_artifact_hash = $1
      WHERE id = $2`,
      [deterministicRule.snapshotBuilderArtifactHash, deterministicRule.id],
    );
    const manifestCodes = await pool.query(
      `SELECT input_kind, usage, decision_code
      FROM public.derivation_rule_decision_codes
      WHERE rule_revision_id = $1
      ORDER BY input_kind`,
      [deterministicRule.id],
    );
    assert.deepEqual(manifestCodes.rows, [
      { input_kind: "assessment", usage: "used", decision_code: "included_in_manifest" },
      { input_kind: "evidence_relation", usage: "used", decision_code: "included_in_manifest" },
    ]);
    await assert.rejects(
      pool.query(
        `INSERT INTO public.derivation_rule_decision_codes (
          rule_revision_id, input_kind, usage, decision_code, created_at
        ) VALUES ($1, 'assessment', 'not_used', 'included_in_manifest', CURRENT_TIMESTAMP)`,
        [deterministicRule.id],
      ),
      (error) =>
        error.code === "23514" &&
        error.constraint === "chk_derivation_rule_decision_codes_usage",
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.derivation_rule_decision_codes (
          rule_revision_id, input_kind, usage, decision_code, created_at
        ) VALUES ($1, 'assessment', 'used', 'free_business_code', CURRENT_TIMESTAMP)`,
        [deterministicRule.id],
      ),
      (error) =>
        error.code === "23514" &&
        error.constraint === "chk_derivation_rule_decision_codes_manifest",
    );
    await assert.rejects(
      createDerivationRuleRevision(
        {
          ruleId: deterministicRule.ruleId,
          ruleVersion: deterministicRule.ruleVersion,
          derivationType: "input_manifest",
          inputSchemaId: "factbase-derivation-input",
          inputSchemaVersion: "1",
          outputSchemaId: "factbase-input-manifest",
          outputSchemaVersion: "1",
          reproducibilityMode: "deterministic_rules",
          definition: deterministicDefinition(),
        },
        pool,
      ),
      (error) =>
        error.code === "23505" &&
        error.constraint === "uq_derivation_rule_revisions_rule",
    );

    const snapshotEstablished = deferred();
    const continueRead = deferred();
    let paused = false;
    const snapshotPool = {
      async connect() {
        const client = await pool.connect();
        return {
          async query(sql, values) {
            const result = await client.query(sql, values);
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
          release(destroy) { client.release(destroy); },
        };
      },
    };

    const firstDerivationPromise = createDerivation(
      {
        claimVersionId: claim.version.id,
        ruleRevisionId: deterministicRule.id,
        operationContext: { initiator: { type: "system", id: "rcv015-test" } },
      },
      snapshotPool,
    );
    await snapshotEstablished.promise;

    const concurrentAssessment = await createEvidenceAssessment(
      {
        claimId: claim.id,
        versionId: claim.version.id,
        evidenceId: evidenceOne.evidence.id,
        relevance: 1,
        assessmentMethod: "manual",
        rationale: "Committed after the derivation snapshot was established.",
      },
      writerPool,
    );
    ids.assessmentIds.push(concurrentAssessment.assessment.id);
    continueRead.resolve();

    const firstDerivation = await firstDerivationPromise;
    ids.derivationIds.push(firstDerivation.id);
    const firstRead = await getDerivationDetails(firstDerivation.id, pool);
    const firstSnapshotAssessments = firstRead.input.value.evidenceRelations
      .flatMap((relation) => relation.assessments);
    assert.equal(firstSnapshotAssessments.length, 1);
    assert.equal(firstSnapshotAssessments[0].sourceQuality, "0.7500000000000001");
    assert.equal(firstSnapshotAssessments[0].relevance, null);
    assert.equal(firstSnapshotAssessments[0].assessedAt, "2026-08-22T14:00:02.123456Z");
    assert.equal(
      firstRead.input.value.claimVersion.createdAt,
      "2026-08-22T13:59:59.000001Z",
    );
    const firstEvidenceSnapshot = firstRead.input.value.evidenceRelations.find(
      ({ relationId }) => relationId === evidenceOne.evidence.relationId,
    );
    assert.equal(firstEvidenceSnapshot.evidence.retrievedAt, "2026-08-22T14:00:00.123456Z");
    assert.equal(firstEvidenceSnapshot.relationCreatedAt, "2026-08-22T14:00:01.000001Z");
    assert.equal(
      firstSnapshotAssessments.some(({ id }) => id === concurrentAssessment.assessment.id),
      false,
    );
    assert.equal(firstRead.input.evidenceRelations.length, 2);
    assert.equal(firstRead.input.assessments.length, 1);
    assert.deepEqual(firstRead.initiator, { type: "system", id: "rcv015-test" });
    assert.deepEqual(firstRead.reproducibility, { status: "valid", anomalies: [] });
    assert.equal(firstRead.historicalRuleBinding.definitionHash, deterministicRule.definitionHash);
    assert.equal(
      firstRead.historicalRuleBinding.interpreterArtifactHash,
      deterministicRule.interpreterArtifactHash,
    );
    assert.equal(
      firstRead.historicalRuleBinding.interpreterExecutionIdentity.contractHash,
      deterministicRule.interpreterExecutionContractHash,
    );
    assert.deepEqual(firstRead.historicalRuleBinding.snapshotBuilder, {
      id: deterministicRule.snapshotBuilderId,
      version: deterministicRule.snapshotBuilderVersion,
      artifactHash: deterministicRule.snapshotBuilderArtifactHash,
    });
    assert.equal("score" in firstRead.output.value.result, false);
    await assert.rejects(
      pool.query(
        `UPDATE public.derivation_evidence_inputs
        SET decision_code = 'undeclared-code'
        WHERE derivation_id = $1`,
        [firstDerivation.id],
      ),
      (error) =>
        error.code === "23503" &&
        error.constraint === "fk_derivation_evidence_inputs_decision",
    );
    const nonCanonicalRuleDefinition = JSON.stringify(deterministicDefinition(), null, 2);
    await pool.query(
      "UPDATE public.derivation_rule_revisions SET definition_canonical = $1 WHERE id = $2",
      [nonCanonicalRuleDefinition, deterministicRule.id],
    );
    const changedDefinitionRead = await getDerivationDetails(firstDerivation.id, pool);
    assert.deepEqual(
      changedDefinitionRead.reproducibility.anomalies.map(({ code }) => code),
      ["rule_definition_not_canonical", "rule_definition_hash_mismatch"],
    );
    assert.equal(changedDefinitionRead.ruleRevision.definitionCanonical, nonCanonicalRuleDefinition);

    const invalidJson = "{";
    await pool.query(
      "UPDATE public.derivation_rule_revisions SET definition_canonical = $1 WHERE id = $2",
      [invalidJson, deterministicRule.id],
    );
    const invalidDefinitionRead = await getDerivationDetails(firstDerivation.id, pool);
    assert.equal(invalidDefinitionRead.ruleRevision.definitionCanonical, invalidJson);
    assert.equal(invalidDefinitionRead.ruleRevision.definition, null);
    assert.ok(
      invalidDefinitionRead.reproducibility.anomalies.some(
        ({ code }) => code === "rule_definition_parse_error",
      ),
    );
    assert.ok(
      invalidDefinitionRead.reproducibility.anomalies.some(
        ({ code }) => code === "rule_definition_hash_mismatch",
      ),
    );
    await pool.query(
      "UPDATE public.derivation_rule_revisions SET definition_canonical = $1 WHERE id = $2",
      [deterministicRule.definitionCanonical, deterministicRule.id],
    );

    for (const target of ["input", "output"]) {
      const column = `${target}_canonical`;
      const hashColumn = `${target}_hash`;
      const originalCanonical = firstRead[target].canonical;
      const originalHash = firstRead[target].hash;
      const parsed = JSON.parse(originalCanonical);
      const validNonCanonical = JSON.stringify(parsed, null, 2);
      const validNonCanonicalHash = createHash("sha256")
        .update(validNonCanonical)
        .digest("hex");
      await pool.query(
        `UPDATE public.derivations SET ${column} = $1, ${hashColumn} = $2 WHERE id = $3`,
        [validNonCanonical, validNonCanonicalHash, firstDerivation.id],
      );
      const nonCanonicalRead = await getDerivationDetails(firstDerivation.id, pool);
      assert.equal(nonCanonicalRead[target].canonical, validNonCanonical);
      assert.ok(
        nonCanonicalRead.reproducibility.anomalies.some(
          ({ code }) => code === `${target}_canonical_not_canonical`,
        ),
      );

      const invalidHash = createHash("sha256").update(invalidJson).digest("hex");
      await pool.query(
        `UPDATE public.derivations SET ${column} = $1, ${hashColumn} = $2 WHERE id = $3`,
        [invalidJson, invalidHash, firstDerivation.id],
      );
      const parseErrorRead = await getDerivationDetails(firstDerivation.id, pool);
      assert.equal(parseErrorRead[target].canonical, invalidJson);
      assert.equal(parseErrorRead[target].value, null);
      assert.ok(
        parseErrorRead.reproducibility.anomalies.some(
          ({ code }) => code === `${target}_canonical_parse_error`,
        ),
      );
      assert.equal(
        parseErrorRead.reproducibility.anomalies.some(
          ({ code }) => code === `${target}_hash_mismatch`,
        ),
        false,
      );

      await pool.query(
        `UPDATE public.derivations SET ${hashColumn} = repeat('f', 64) WHERE id = $1`,
        [firstDerivation.id],
      );
      const parseAndHashRead = await getDerivationDetails(firstDerivation.id, pool);
      assert.ok(
        parseAndHashRead.reproducibility.anomalies.some(
          ({ code }) => code === `${target}_canonical_parse_error`,
        ),
      );
      assert.ok(
        parseAndHashRead.reproducibility.anomalies.some(
          ({ code }) => code === `${target}_hash_mismatch`,
        ),
      );
      await pool.query(
        `UPDATE public.derivations SET ${column} = $1, ${hashColumn} = $2 WHERE id = $3`,
        [originalCanonical, originalHash, firstDerivation.id],
      );
    }

    const structurallyDamagedInputs = [
      { evidenceRelations: {} },
      { evidenceRelations: null },
      { evidenceRelations: "broken" },
      (() => {
        const value = JSON.parse(firstRead.input.canonical);
        value.evidenceRelations[0].assessments = {};
        return value;
      })(),
      (() => {
        const value = JSON.parse(firstRead.input.canonical);
        delete value.evidenceRelations;
        return value;
      })(),
    ];
    for (const damagedValue of structurallyDamagedInputs) {
      const damagedCanonical = JSON.stringify(damagedValue);
      const damagedHash = createHash("sha256")
        .update(damagedCanonical)
        .digest("hex");
      await pool.query(
        `UPDATE public.derivations
        SET input_canonical = $1, input_hash = $2
        WHERE id = $3`,
        [damagedCanonical, damagedHash, firstDerivation.id],
      );
      const damagedRead = await getDerivationDetails(firstDerivation.id, pool);
      assert.equal(damagedRead.input.canonical, damagedCanonical);
      assert.ok(
        damagedRead.reproducibility.anomalies.some(
          ({ code }) => code === "input_canonical_structure_error",
        ),
      );
    }

    const damagedCanonical = JSON.stringify({ evidenceRelations: {} });
    await pool.query(
      `UPDATE public.derivations
      SET input_canonical = $1, input_hash = repeat('f', 64)
      WHERE id = $2`,
      [damagedCanonical, firstDerivation.id],
    );
    const damagedAndMismatchedRead = await getDerivationDetails(
      firstDerivation.id,
      pool,
    );
    assert.equal(damagedAndMismatchedRead.input.canonical, damagedCanonical);
    assert.ok(
      damagedAndMismatchedRead.reproducibility.anomalies.some(
        ({ code }) => code === "input_canonical_structure_error",
      ),
    );
    assert.ok(
      damagedAndMismatchedRead.reproducibility.anomalies.some(
        ({ code }) => code === "input_hash_mismatch",
      ),
    );
    await pool.query(
      `UPDATE public.derivations
      SET input_canonical = $1, input_hash = $2
      WHERE id = $3`,
      [firstRead.input.canonical, firstRead.input.hash, firstDerivation.id],
    );
    await assert.rejects(
      pool.query(
        `UPDATE public.derivation_rule_revisions
        SET definition_hash = repeat('f', 64)
        WHERE id = $1`,
        [deterministicRule.id],
      ),
      (error) =>
        error.code === "23503" &&
        error.constraint === "fk_derivations_rule_contract",
    );
    await assert.rejects(
      pool.query(
        `UPDATE public.derivation_rule_revisions
        SET interpreter_artifact_hash = repeat('f', 64)
        WHERE id = $1`,
        [deterministicRule.id],
      ),
      (error) =>
        error.code === "23503" &&
        error.constraint === "fk_derivations_interpreter_execution",
    );
    await assert.rejects(
      pool.query(
        `UPDATE public.derivation_rule_revisions
        SET interpreter_execution_contract_hash = repeat('f', 64)
        WHERE id = $1`,
        [deterministicRule.id],
      ),
      (error) =>
        error.code === "23503" &&
        error.constraint === "fk_derivations_interpreter_execution",
    );
    await assert.rejects(
      pool.query(
        `UPDATE public.derivation_rule_revisions
        SET snapshot_builder_artifact_hash = repeat('f', 64)
        WHERE id = $1`,
        [deterministicRule.id],
      ),
      (error) =>
        error.code === "23503" &&
        error.constraint === "fk_derivations_snapshot_builder",
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.derivation_evidence_inputs (
          derivation_id, rule_revision_id, claim_version_id,
          claim_version_evidence_id, input_kind, usage, decision_code, created_at
        ) SELECT
          derivation_id, rule_revision_id, claim_version_id,
          claim_version_evidence_id, input_kind, usage, decision_code, CURRENT_TIMESTAMP
        FROM public.derivation_evidence_inputs
        WHERE derivation_id = $1
        LIMIT 1`,
        [firstDerivation.id],
      ),
      (error) =>
        error.code === "23505" &&
        error.constraint === "pk_derivation_evidence_inputs",
    );

    const secondDerivation = await createDerivation(
      { claimVersionId: claim.version.id, ruleRevisionId: deterministicRule.id },
      pool,
    );
    ids.derivationIds.push(secondDerivation.id);
    const secondRead = await getDerivationDetails(secondDerivation.id, pool);
    assert.equal(secondRead.input.assessments.length, 2);
    assert.equal(
      secondRead.input.value.evidenceRelations
        .flatMap((relation) => relation.assessments)
        .some(({ id }) => id === concurrentAssessment.assessment.id),
      true,
    );
    assert.notEqual(firstDerivation.inputHash, secondDerivation.inputHash);

    const timezoneReads = [];
    for (const timezone of ["UTC", "Pacific/Auckland", "America/Los_Angeles"]) {
      const timezonePool = new Pool({
        ...databaseConfig,
        max: 1,
        options: `-c timezone=${timezone}`,
      });
      timezonePools.push(timezonePool);
      await assertTestDatabase(timezonePool);
      const setting = await timezonePool.query(
        "SELECT current_setting('TimeZone') AS timezone",
      );
      assert.equal(setting.rows[0].timezone, timezone);
      const timezoneDerivation = await createDerivation(
        { claimVersionId: claim.version.id, ruleRevisionId: deterministicRule.id },
        timezonePool,
      );
      ids.derivationIds.push(timezoneDerivation.id);
      const timezoneRead = await getDerivationDetails(
        timezoneDerivation.id,
        timezonePool,
      );
      const preciseEvidence = timezoneRead.input.value.evidenceRelations.find(
        ({ relationId }) => relationId === evidenceOne.evidence.relationId,
      );
      const preciseAssessment = timezoneRead.input.value.evidenceRelations
        .flatMap((relation) => relation.assessments)
        .find(({ id }) => id === preciseAssessmentId);
      timezoneReads.push({
        timezone,
        canonical: timezoneRead.input.canonical,
        hash: timezoneRead.input.hash,
        claimCreatedAt: timezoneRead.input.value.claimVersion.createdAt,
        evidenceRetrievedAt: preciseEvidence.evidence.retrievedAt,
        assessmentAssessedAt: preciseAssessment.assessedAt,
      });
    }
    for (const timezoneRead of timezoneReads) {
      assert.equal(timezoneRead.canonical, timezoneReads[0].canonical);
      assert.equal(timezoneRead.hash, timezoneReads[0].hash);
      assert.equal(timezoneRead.claimCreatedAt, "2026-08-22T13:59:59.000001Z");
      assert.equal(timezoneRead.evidenceRetrievedAt, "2026-08-22T14:00:00.123456Z");
      assert.equal(timezoneRead.assessmentAssessedAt, "2026-08-22T14:00:02.123456Z");
    }

    const duplicateDerivation = await createDerivation(
      { claimVersionId: claim.version.id, ruleRevisionId: deterministicRule.id },
      pool,
    );
    ids.derivationIds.push(duplicateDerivation.id);
    assert.equal(duplicateDerivation.inputHash, secondDerivation.inputHash);
    assert.equal(duplicateDerivation.outputHash, secondDerivation.outputHash);
    assert.notEqual(duplicateDerivation.id, secondDerivation.id);
    const secondBeforeDivergence = await pool.query(
      "SELECT * FROM public.derivations WHERE id = $1",
      [secondDerivation.id],
    );

    const divergentOutput = JSON.stringify({ result: { operation: "corrupt-test-output" } });
    const divergentHash = createHash("sha256").update(divergentOutput).digest("hex");
    await pool.query(
      `UPDATE public.derivations
      SET output_canonical = $1, output_hash = $2
      WHERE id = $3`,
      [divergentOutput, divergentHash, duplicateDerivation.id],
    );
    const mismatchRead = await getDerivationDetails(secondDerivation.id, pool);
    assert.deepEqual(
      mismatchRead.reproducibility.anomalies.map(({ code }) => code),
      ["deterministic_output_mismatch"],
    );
    const retained = await pool.query(
      "SELECT id FROM public.derivations WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[secondDerivation.id, duplicateDerivation.id]],
    );
    assert.equal(retained.rowCount, 2);
    const secondAfterDivergence = await pool.query(
      "SELECT * FROM public.derivations WHERE id = $1",
      [secondDerivation.id],
    );
    assert.deepEqual(secondAfterDivergence.rows, secondBeforeDivergence.rows);

    const recordedRule = await createDerivationRuleRevision(
      {
        ruleId: `rcv015-recorded-${randomUUID()}`,
        ruleVersion: "1",
        derivationType: "recorded_manifest",
        inputSchemaId: "factbase-derivation-input",
        inputSchemaVersion: "1",
        outputSchemaId: "factbase-recorded-output",
        outputSchemaVersion: "1",
        reproducibilityMode: "recorded_process",
        definition: recordedDefinition(),
      },
      pool,
    );
    ids.ruleRevisionIds.push(recordedRule.id);
    const allDecisions = [
      ...ids.relationIds.map((inputId) => ({
        inputKind: "evidence_relation", inputId, usage: "used",
        decisionCode: "included_in_manifest",
      })),
      ...ids.assessmentIds.map((inputId) => ({
        inputKind: "assessment", inputId, usage: "used",
        decisionCode: "included_in_manifest",
      })),
    ];
    const recordedProcess = {
      usageDecisions: allDecisions,
      output: { operation: "recorded_manifest", note: "No score is calculated." },
      audit: {
        processId: "rcv015-recorded-process",
        processVersion: "1",
        implementationId: "rcv015-test-implementation",
        implementationVersion: "1",
        parameters: { mode: "audit_only" },
        modelReference: { id: "documented-model-label", version: "1" },
        randomSeed: "documented-seed",
        runtimeEnvironment: [
          { id: "node", version: process.version },
          { id: "factbase", version: "rcv015" },
        ],
        startedAt: "2026-08-22T15:00:00.000001Z",
        completedAt: "2026-08-22T15:00:01.123456Z",
      },
    };
    const recorded = await createDerivation(
      {
        claimVersionId: claim.version.id,
        ruleRevisionId: recordedRule.id,
        recordedProcess,
      },
      pool,
    );
    ids.derivationIds.push(recorded.id);
    const recordedRead = await getDerivationDetails(recorded.id, pool);
    assert.equal(recordedRead.processAudit.process.id, "rcv015-recorded-process");
    assert.equal(recordedRead.processAudit.modelReference.referentiallyVerified, false);
    assert.equal(recordedRead.processAudit.randomSeed, "documented-seed");
    assert.equal(recordedRead.processAudit.startedAt, "2026-08-22T15:00:00.000001Z");
    assert.equal(recordedRead.processAudit.completedAt, "2026-08-22T15:00:01.123456Z");
    assert.equal(
      JSON.parse(recordedRead.processAudit.canonical).outputHash,
      recordedRead.output.hash,
    );
    assert.equal(recordedRead.reproducibility.status, "valid");

    const originalAuditCanonical = recordedRead.processAudit.canonical;
    const originalAuditHash = recordedRead.processAudit.hash;
    const nonCanonicalAudit = JSON.stringify(
      JSON.parse(originalAuditCanonical),
      null,
      2,
    );
    const nonCanonicalAuditHash = createHash("sha256")
      .update(nonCanonicalAudit)
      .digest("hex");
    await pool.query(
      `UPDATE public.derivation_recorded_process_audits
      SET audit_canonical = $1, audit_hash = $2
      WHERE derivation_id = $3`,
      [nonCanonicalAudit, nonCanonicalAuditHash, recorded.id],
    );
    const nonCanonicalAuditRead = await getDerivationDetails(recorded.id, pool);
    assert.equal(nonCanonicalAuditRead.processAudit.canonical, nonCanonicalAudit);
    assert.ok(
      nonCanonicalAuditRead.reproducibility.anomalies.some(
        ({ code }) => code === "recorded_process_audit_not_canonical",
      ),
    );

    const invalidAuditHash = createHash("sha256").update(invalidJson).digest("hex");
    await pool.query(
      `UPDATE public.derivation_recorded_process_audits
      SET audit_canonical = $1, audit_hash = $2
      WHERE derivation_id = $3`,
      [invalidJson, invalidAuditHash, recorded.id],
    );
    const invalidAuditRead = await getDerivationDetails(recorded.id, pool);
    assert.equal(invalidAuditRead.processAudit.canonical, invalidJson);
    assert.equal(invalidAuditRead.processAudit.value, null);
    assert.ok(
      invalidAuditRead.reproducibility.anomalies.some(
        ({ code }) => code === "recorded_process_audit_parse_error",
      ),
    );
    assert.equal(
      invalidAuditRead.reproducibility.anomalies.some(
        ({ code }) => code === "recorded_process_audit_hash_mismatch",
      ),
      true,
    );

    await pool.query(
      `UPDATE public.derivation_recorded_process_audits
      SET audit_hash = repeat('f', 64)
      WHERE derivation_id = $1`,
      [recorded.id],
    );
    const invalidAuditAndHashRead = await getDerivationDetails(recorded.id, pool);
    assert.ok(
      invalidAuditAndHashRead.reproducibility.anomalies.some(
        ({ code }) => code === "recorded_process_audit_parse_error",
      ),
    );
    assert.ok(
      invalidAuditAndHashRead.reproducibility.anomalies.some(
        ({ code }) => code === "recorded_process_audit_hash_mismatch",
      ),
    );
    await pool.query(
      `UPDATE public.derivation_recorded_process_audits
      SET audit_canonical = $1, audit_hash = $2
      WHERE derivation_id = $3`,
      [originalAuditCanonical, originalAuditHash, recorded.id],
    );

    for (const failure of [
      {
        fragment: "INSERT INTO public.derivation_evidence_inputs",
        ruleRevisionId: deterministicRule.id,
      },
      {
        fragment: "INSERT INTO public.derivation_assessment_inputs",
        ruleRevisionId: deterministicRule.id,
      },
      {
        fragment: "INSERT INTO public.derivation_recorded_process_audits",
        ruleRevisionId: recordedRule.id,
        recordedProcess,
      },
    ]) {
      const beforeFailure = await rcv015CountsForClaimVersion(
        pool,
        claim.version.id,
      );
      const failurePool = faultInjectingPool(pool, failure.fragment);
      await assert.rejects(
        createDerivation(
          {
            claimVersionId: claim.version.id,
            ruleRevisionId: failure.ruleRevisionId,
            ...(failure.recordedProcess
              ? { recordedProcess: failure.recordedProcess }
              : {}),
          },
          failurePool,
        ),
        new RegExp(`Injected failure at ${failure.fragment}`),
      );
      assert.deepEqual(
        await rcv015CountsForClaimVersion(pool, claim.version.id),
        beforeFailure,
      );
      assert.deepEqual(failurePool.releases, [false]);
    }

    const missingAuditId = randomUUID();
    await assert.rejects(
      (async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `INSERT INTO public.derivations (
              id, claim_version_id, rule_revision_id, rule_definition_hash,
              snapshot_builder_id, snapshot_builder_version,
              snapshot_builder_artifact_hash,
              execution_method,
              input_schema_id, input_schema_version, input_canonical, input_hash,
              output_schema_id, output_schema_version, output_canonical, output_hash,
              canonicalization_id, canonicalization_version, hash_algorithm,
              created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, 'recorded_process',
              $8, $9, '{}', repeat('0', 64), $10, $11, '{}', repeat('0', 64),
              'jcs-rfc8785', '1', 'sha-256', CURRENT_TIMESTAMP
            )`,
            [
              missingAuditId, claim.version.id, recordedRule.id,
              recordedRule.definitionHash,
              recordedRule.snapshotBuilderId, recordedRule.snapshotBuilderVersion,
              recordedRule.snapshotBuilderArtifactHash,
              recordedRule.inputSchemaId, recordedRule.inputSchemaVersion,
              recordedRule.outputSchemaId, recordedRule.outputSchemaVersion,
            ],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      })(),
      (error) =>
        error.code === "23514" &&
        error.constraint === "chk_derivations_recorded_process_audit",
    );
  } finally {
    if (ids.claimId) {
      await cleanup(pool, ids);
      const remaining = await pool.query(
        `SELECT
          (SELECT count(*)::integer FROM public.claims WHERE id = $1) AS claims,
          (SELECT count(*)::integer FROM public.claim_versions WHERE claim_id = $1) AS versions,
          (SELECT count(*)::integer FROM public.evidence WHERE id = ANY($2::uuid[])) AS evidence,
          (SELECT count(*)::integer FROM public.claim_version_evidence WHERE id = ANY($3::uuid[])) AS relations,
          (SELECT count(*)::integer FROM public.evidence_assessments WHERE id = ANY($4::uuid[])) AS assessments,
          (SELECT count(*)::integer FROM public.derivations WHERE id = ANY($5::uuid[])) AS derivations,
          (SELECT count(*)::integer FROM public.derivation_rule_revisions WHERE id = ANY($6::uuid[])) AS rules`,
        [
          ids.claimId, ids.evidenceIds, ids.relationIds, ids.assessmentIds,
          ids.derivationIds, ids.ruleRevisionIds,
        ],
      );
      assert.deepEqual(remaining.rows[0], {
        claims: 0, versions: 0, evidence: 0, relations: 0,
        assessments: 0, derivations: 0, rules: 0,
      });
    }
    await Promise.all([
      pool.end(),
      writerPool.end(),
      ...timezonePools.map((timezonePool) => timezonePool.end()),
    ]);
  }
});
