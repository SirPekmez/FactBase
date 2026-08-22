const assert = require("node:assert/strict");
const test = require("node:test");

const claimId = "11111111-1111-4111-8111-111111111111";
const versionOneId = "22222222-2222-4222-8222-222222222222";
const versionTwoId = "33333333-3333-4333-8333-333333333333";
const evidenceOneId = "44444444-4444-4444-8444-444444444444";
const evidenceTwoId = "55555555-5555-4555-8555-555555555555";
const evidenceThreeId = "66666666-6666-4666-8666-666666666666";
const assessmentOneId = "77777777-7777-4777-8777-777777777777";
const comparisonRelationId = "aaaaaaaa-1111-4111-8111-111111111111";

function response() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function evidenceBody(overrides = {}) {
  return {
    sourceUrl: "https://example.test/source",
    sourceTitle: "Primary source",
    sourceType: "report",
    locator: "page 7",
    quotedText: "Documented excerpt",
    snapshotHash: "sha256:test-hash",
    retrievedAt: "2026-08-21T08:30:00.000Z",
    relation: "supports",
    ...overrides,
  };
}

function assessmentBody(overrides = {}) {
  return {
    sourceQuality: 0.9,
    relevance: 1,
    directness: 0.8,
    assessmentMethod: "manual",
    rationale: "Exact rationale, including punctuation.",
    ...overrides,
  };
}

test("evidence controller accepts a strict valid request and returns 201", async () => {
  const {
    buildCreateEvidenceController,
  } = require("../dist/controllers/evidenceController");
  const expected = { evidence: { id: evidenceOneId, relation: "supports" } };
  let received;
  const handler = buildCreateEvidenceController(async (input) => {
    received = input;
    return expected;
  });
  const res = response();

  await handler(
    {
      params: { claimId, versionId: versionOneId },
      body: evidenceBody(),
    },
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, expected);
  assert.equal(received.claimId, claimId);
  assert.equal(received.versionId, versionOneId);
  assert.equal(received.relation, "supports");
  assert.equal(received.retrievedAt.toISOString(), "2026-08-21T08:30:00.000Z");
});

test("evidence endpoint is mounted through the existing claims router", async () => {
  const { buildApp } = require("../dist/app");
  const { buildClaimsRouter } = require("../dist/routes/claims");
  const {
    buildCreateEvidenceController,
  } = require("../dist/controllers/evidenceController");
  const expected = { evidence: { id: evidenceOneId, relation: "supports" } };
  const handler = buildCreateEvidenceController(async () => expected);
  const app = buildApp(buildClaimsRouter(undefined, undefined, handler));
  const res = {
    ...response(),
    setHeader() {},
    getHeader() {},
    removeHeader() {},
  };
  const completed = new Promise((resolve, reject) => {
    res.json = function json(body) {
      this.body = body;
      resolve();
      return this;
    };
    app.handle(
      {
        method: "POST",
        url: `/api/claims/${claimId}/versions/${versionOneId}/evidence`,
        headers: {},
        body: evidenceBody(),
      },
      res,
      (error) => reject(error ?? new Error("request was not handled")),
    );
  });

  await completed;
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, expected);
});

async function dispatch(app, method, url, body) {
  const res = {
    ...response(),
    setHeader() {},
    getHeader() {},
    removeHeader() {},
  };
  await new Promise((resolve, reject) => {
    res.json = function json(value) {
      this.body = value;
      resolve();
      return this;
    };
    app.handle(
      { method, url, headers: {}, body },
      res,
      (error) => reject(error ?? new Error("request was not handled")),
    );
  });
  return res;
}

test("assessment, read-model and diff endpoints are mounted", async () => {
  const { buildApp } = require("../dist/app");
  const { buildClaimsRouter } = require("../dist/routes/claims");
  const ok = (name) => (_req, res) => res.status(200).json({ route: name });
  const app = buildApp(buildClaimsRouter(
    undefined,
    undefined,
    undefined,
    ok("assessment"),
    ok("read"),
    ok("diff"),
  ));

  const assessment = await dispatch(
    app,
    "POST",
    `/api/claims/${claimId}/versions/${versionOneId}/evidence/${evidenceOneId}/assessment`,
    assessmentBody(),
  );
  const read = await dispatch(
    app,
    "GET",
    `/api/claims/${claimId}/versions/${versionOneId}`,
  );
  const diff = await dispatch(
    app,
    "GET",
    `/api/claims/${claimId}/versions/${versionOneId}/diff/${versionTwoId}`,
  );

  assert.deepEqual(assessment.body, { route: "assessment" });
  assert.deepEqual(read.body, { route: "read" });
  assert.deepEqual(diff.body, { route: "diff" });
});

test("evidence controller rejects invalid relations and unknown fields", async (t) => {
  const {
    buildCreateEvidenceController,
  } = require("../dist/controllers/evidenceController");
  const invalid = [
    evidenceBody({ relation: "agrees" }),
    evidenceBody({ unexpected: true }),
    evidenceBody({ retrievedAt: "not-a-timestamp" }),
    { retrievedAt: "2026-08-21T08:30:00.000Z", relation: "supports" },
  ];

  for (const body of invalid) {
    await t.test(JSON.stringify(body), async () => {
      let called = false;
      const handler = buildCreateEvidenceController(async () => {
        called = true;
      });
      const res = response();
      await handler({ params: { claimId, versionId: versionOneId }, body }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(called, false);
    });
  }
});

test("evidence controller maps absent claims and mismatched versions to 404", async () => {
  const {
    buildCreateEvidenceController,
  } = require("../dist/controllers/evidenceController");
  const {
    ClaimVersionNotFoundError,
  } = require("../dist/services/evidenceService");
  const handler = buildCreateEvidenceController(async () => {
    throw new ClaimVersionNotFoundError(claimId, versionOneId);
  });
  const res = response();

  await handler(
    { params: { claimId, versionId: versionOneId }, body: evidenceBody() },
    res,
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Claim version not found" });
});

test("assessment validation enforces dimensions, method, rationale and response pairs", async (t) => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const invalid = [
    assessmentBody({ sourceQuality: -0.01 }),
    assessmentBody({ relevance: 1.01 }),
    assessmentBody({ directness: Number.NaN }),
    assessmentBody({ recency: Number.POSITIVE_INFINITY }),
    assessmentBody({ independence: Number.NEGATIVE_INFINITY }),
    assessmentBody({ assessmentMethod: "automatic" }),
    assessmentBody({ rationale: "" }),
    assessmentBody({ rationale: " \n\t " }),
    assessmentBody({ rationale: "x".repeat(4001) }),
    assessmentBody({ respondsToAssessmentId: assessmentOneId }),
    assessmentBody({ responseRelation: "disputes" }),
    assessmentBody({
      respondsToAssessmentId: assessmentOneId,
      responseRelation: "supersedes",
    }),
    assessmentBody({ initiatorType: "human" }),
    assessmentBody({ initiatorId: "client-controlled" }),
    assessmentBody({ assessedBy: "legacy-client-value" }),
    assessmentBody({ assessedAt: "2026-08-21T09:00:00.000Z" }),
    {
      assessmentMethod: "manual",
      rationale: "No dimension was assessed.",
    },
    assessmentBody({ unexpected: true }),
    {},
  ];

  for (const body of invalid) {
    await t.test(JSON.stringify(body), async () => {
      let called = false;
      const handler = buildCreateEvidenceAssessmentController(async () => {
        called = true;
      });
      const res = response();
      await handler(
        {
          params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
          body,
        },
        res,
      );
      assert.equal(res.statusCode, 400);
      assert.equal(called, false);
    });
  }
});

test("assessment validation accepts boundary values, methods and response relations", async (t) => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const cases = [
    assessmentBody({ sourceQuality: 0, relevance: undefined }),
    assessmentBody({ sourceQuality: 1 }),
    assessmentBody({
      assessmentMethod: "rules_based",
      ruleSetId: "rules",
      ruleSetVersion: "1",
    }),
    assessmentBody({
      assessmentMethod: "model_assisted",
      modelId: "model",
      modelVersion: "1",
      modelProcessType: "workflow",
      modelProcessVersion: "1",
    }),
    assessmentBody({
      assessmentMethod: "imported",
      importReferenceType: "external_record",
      importReference: "external:assessment:1",
    }),
    ...["supports", "disputes", "contextualizes"].map((responseRelation) =>
      assessmentBody({
        respondsToAssessmentId: assessmentOneId,
        responseRelation,
      }),
    ),
    assessmentBody({ rationale: "x".repeat(4000) }),
  ];

  for (const body of cases) {
    await t.test(body.assessmentMethod + (body.responseRelation ?? ""), async () => {
      const handler = buildCreateEvidenceAssessmentController(async () => ({ ok: true }));
      const res = response();
      await handler(
        { params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId }, body },
        res,
      );
      assert.equal(res.statusCode, 201);
    });
  }
});

test("RCV-014 validation enforces recency, independence, method provenance and server rubric ownership", async (t) => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const invalid = [
    assessmentBody({ recency: 0.5 }),
    assessmentBody({
      recencyReferenceType: "event_at",
      recencyReferenceAt: "2026-08-21T09:00:00.000Z",
    }),
    assessmentBody({
      recency: 0.5,
      recencyReferenceType: "latest",
      recencyReferenceAt: "2026-08-21T09:00:00.000Z",
    }),
    assessmentBody({ independence: 0.5 }),
    assessmentBody({ independenceComparisonRelationIds: [comparisonRelationId] }),
    assessmentBody({
      independence: 0.5,
      independenceComparisonRelationIds: [],
    }),
    assessmentBody({
      independence: 0.5,
      independenceComparisonRelationIds: [comparisonRelationId, comparisonRelationId],
    }),
    assessmentBody({ assessmentMethod: "rules_based" }),
    assessmentBody({
      assessmentMethod: "model_assisted",
      modelId: "model",
      modelVersion: "1",
      modelProcessType: "workflow",
    }),
    assessmentBody({ assessmentMethod: "imported" }),
    assessmentBody({ ruleSetId: "rules", ruleSetVersion: "1" }),
    assessmentBody({ rubricId: "factbase-evidence-assessment" }),
    assessmentBody({ rubricVersion: "1" }),
  ];

  for (const body of invalid) {
    await t.test(JSON.stringify(body), async () => {
      let called = false;
      const handler = buildCreateEvidenceAssessmentController(async () => {
        called = true;
      });
      const res = response();
      await handler(
        {
          params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
          body,
        },
        res,
      );
      assert.equal(res.statusCode, 400);
      assert.equal(called, false);
    });
  }
});

test("RCV-014 validation accepts calibrated values and complete contexts", async (t) => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const cases = [0, 0.25, 0.5, 0.75, 1].flatMap((value) => [
    assessmentBody({ sourceQuality: value }),
    assessmentBody({ relevance: value }),
    assessmentBody({ directness: value }),
    assessmentBody({
      recency: value,
      recencyReferenceType: "current_state_at",
      recencyReferenceAt: "2026-08-21T09:00:00.000Z",
    }),
    assessmentBody({
      independence: value,
      independenceComparisonRelationIds: [comparisonRelationId],
    }),
  ]);

  for (const body of cases) {
    await t.test(JSON.stringify(body), async () => {
      let received;
      const handler = buildCreateEvidenceAssessmentController(async (input) => {
        received = input;
        return { ok: true };
      });
      const res = response();
      await handler(
        {
          params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
          body,
        },
        res,
      );
      assert.equal(res.statusCode, 201);
      if (body.recencyReferenceAt) {
        assert.equal(received.recencyReferenceAt.toISOString(), body.recencyReferenceAt);
      }
    });
  }
});

test("RCV-014 comparator UUIDs are canonicalized before duplicate checks", async (t) => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const mixedCaseComparisonId = comparisonRelationId
    .split("")
    .map((character, index) =>
      index % 2 === 0 ? character.toUpperCase() : character,
    )
    .join("");

  for (const suppliedId of [
    comparisonRelationId,
    comparisonRelationId.toUpperCase(),
    mixedCaseComparisonId,
  ]) {
    await t.test(suppliedId, async () => {
      let received;
      const handler = buildCreateEvidenceAssessmentController(async (input) => {
        received = input;
        return { ok: true };
      });
      const res = response();
      await handler(
        {
          params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
          body: assessmentBody({
            independence: 0.5,
            independenceComparisonRelationIds: [suppliedId],
          }),
        },
        res,
      );
      assert.equal(res.statusCode, 201);
      assert.deepEqual(received.independenceComparisonRelationIds, [
        comparisonRelationId,
      ]);
    });
  }

  await t.test("case-varied duplicate", async () => {
    let called = false;
    const handler = buildCreateEvidenceAssessmentController(async () => {
      called = true;
    });
    const res = response();
    await handler(
      {
        params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
        body: assessmentBody({
          independence: 0.5,
          independenceComparisonRelationIds: [
            comparisonRelationId,
            comparisonRelationId.toUpperCase(),
          ],
        }),
      },
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  });

  await t.test("case-varied self comparator maps to 400", async () => {
    const {
      IndependenceComparisonError,
    } = require("../dist/services/evidenceService");
    const selfRelationId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    const handler = buildCreateEvidenceAssessmentController(async (input) => {
      assert.deepEqual(input.independenceComparisonRelationIds, [selfRelationId]);
      throw new IndependenceComparisonError("self_comparison", [selfRelationId]);
    });
    const res = response();
    await handler(
      {
        params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
        body: assessmentBody({
          independence: 0.5,
          independenceComparisonRelationIds: [selfRelationId.toUpperCase()],
        }),
      },
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      error: "Invalid independence comparison relations",
      reason: "self_comparison",
    });
  });
});

test("assessment controller preserves rationale exactly and maps missing relation to 404", async () => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const {
    EvidenceRelationNotFoundError,
  } = require("../dist/services/evidenceService");
  let received;
  const success = buildCreateEvidenceAssessmentController(async (input) => {
    received = input;
    return { assessment: { rationale: input.rationale } };
  });
  const successResponse = response();
  await success(
    {
      params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
      body: assessmentBody(),
    },
    successResponse,
  );
  assert.equal(successResponse.statusCode, 201);
  assert.equal(received.rationale, "Exact rationale, including punctuation.");
  assert.equal(received.operationContext, undefined);

  const missing = buildCreateEvidenceAssessmentController(async () => {
    throw new EvidenceRelationNotFoundError(versionOneId, evidenceOneId);
  });
  const missingResponse = response();
  await missing(
    {
      params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
      body: assessmentBody(),
    },
    missingResponse,
  );
  assert.equal(missingResponse.statusCode, 404);
});

test("assessment controller only accepts initiator identity from trusted response locals", async () => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  let received;
  const handler = buildCreateEvidenceAssessmentController(async (input) => {
    received = input;
    return { assessment: { initiator: input.operationContext?.initiator ?? null } };
  });
  const res = { ...response(), locals: {
    operationContext: { initiator: { type: "human", id: "verified-user-17" } },
  } };

  await handler(
    {
      params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
      body: assessmentBody(),
    },
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.deepEqual(received.operationContext, {
    initiator: { type: "human", id: "verified-user-17" },
  });
});

test("mounted assessment route rejects client-controlled identity and timestamps", async () => {
  const { buildApp } = require("../dist/app");
  const { buildClaimsRouter } = require("../dist/routes/claims");
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  let called = false;
  const handler = buildCreateEvidenceAssessmentController(async () => {
    called = true;
  });
  const app = buildApp(buildClaimsRouter(undefined, undefined, undefined, handler));
  const forbidden = [
    { initiatorType: "human" },
    { initiatorId: "client-id" },
    { assessedBy: "legacy-label" },
    { assessedAt: "2026-08-21T09:00:00.000Z" },
    { id: assessmentOneId },
  ];

  for (const extra of forbidden) {
    const res = await dispatch(
      app,
      "POST",
      `/api/claims/${claimId}/versions/${versionOneId}/evidence/${evidenceOneId}/assessment`,
      assessmentBody(extra),
    );
    assert.equal(res.statusCode, 400);
  }
  assert.equal(called, false);
});

test("assessment controller maps an absent or cross-relation response target to 404", async () => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const {
    AssessmentResponseTargetNotFoundError,
  } = require("../dist/services/evidenceService");
  const handler = buildCreateEvidenceAssessmentController(async () => {
    throw new AssessmentResponseTargetNotFoundError(assessmentOneId, evidenceOneId);
  });
  const res = response();
  await handler(
    {
      params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
      body: assessmentBody({
        respondsToAssessmentId: assessmentOneId,
        responseRelation: "disputes",
      }),
    },
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Assessment response target not found" });
});

test("assessment controller maps a cyclic parent chain to 409", async () => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const {
    AssessmentGraphConflictError,
  } = require("../dist/services/evidenceService");
  const handler = buildCreateEvidenceAssessmentController(async () => {
    throw new AssessmentGraphConflictError("existing_cycle");
  });
  const res = response();
  await handler(
    {
      params: { claimId, versionId: versionOneId, evidenceId: evidenceOneId },
      body: assessmentBody({
        respondsToAssessmentId: assessmentOneId,
        responseRelation: "disputes",
      }),
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    error: "Assessment response graph conflict",
    reason: "existing_cycle",
  });
});

function writeStage(sql) {
  if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return sql;
  if (sql === "SET TRANSACTION ISOLATION LEVEL READ COMMITTED") {
    return "SET READ COMMITTED";
  }
  if (sql.includes("SELECT id") && sql.includes("FROM public.claim_versions")) {
    return "VERIFY VERSION";
  }
  if (sql.includes("INSERT INTO public.evidence ")) return "INSERT EVIDENCE";
  if (sql.includes("INSERT INTO public.claim_version_evidence")) {
    return "INSERT RELATION";
  }
  if (sql.includes("SELECT cve.id") && sql.includes("FOR UPDATE OF cve")) {
    return "LOCK RELATION";
  }
  if (sql.includes("WITH RECURSIVE ancestry")) return "CHECK RESPONSE CHAIN";
  if (sql.includes("FROM public.claim_version_evidence") && sql.includes("ANY($2::uuid[])")) {
    return "VERIFY COMPARISONS";
  }
  if (sql.includes("FROM public.evidence_assessments") && sql.includes("WHERE id")) {
    return "VERIFY RESPONSE TARGET";
  }
  if (sql.includes("INSERT INTO public.evidence_assessments")) {
    return "INSERT ASSESSMENT";
  }
  if (sql.includes("INSERT INTO public.evidence_assessment_independence_comparisons")) {
    return "INSERT COMPARISONS";
  }
  throw new Error(`Unexpected write query: ${sql}`);
}

function writeHarness({
  failures = {},
  emptyRows = [],
  versionExists = true,
  relationExists = true,
  lockedRelationId = assessmentOneId,
  responseTargetExists = true,
  chainRows,
} = {}) {
  const calls = [];
  const releases = [];
  const now = new Date("2026-08-21T09:00:00.000Z");
  const client = {
    async query(sql, values) {
      const stage = writeStage(sql);
      calls.push({ stage, sql, values });
      if (Object.prototype.hasOwnProperty.call(failures, stage)) {
        throw failures[stage];
      }
      if (emptyRows.includes(stage)) {
        return { rows: [] };
      }
      if (stage === "VERIFY VERSION") {
        return { rows: versionExists ? [{ id: versionOneId }] : [] };
      }
      if (stage === "INSERT EVIDENCE") {
        return {
          rows: [{
            id: values[0], source_url: values[1], source_title: values[2],
            source_type: values[3], locator: values[4], quoted_text: values[5],
            snapshot_hash: values[6], retrieved_at: values[7], created_at: now,
          }],
        };
      }
      if (stage === "INSERT RELATION") {
        return { rows: [{ id: values[0], claim_version_id: values[1], evidence_id: values[2], relation: values[3], created_at: now }] };
      }
      if (stage === "LOCK RELATION") {
        return {
          rows: relationExists
            ? [{ id: lockedRelationId, claim_version_id: versionOneId }]
            : [],
        };
      }
      if (stage === "VERIFY COMPARISONS") {
        return { rows: values[1].map((id) => ({ id })).sort((a, b) => a.id.localeCompare(b.id)) };
      }
      if (stage === "VERIFY RESPONSE TARGET") {
        return { rows: responseTargetExists ? [{ id: values[0] }] : [] };
      }
      if (stage === "CHECK RESPONSE CHAIN") {
        return { rows: chainRows ?? [{
          id: assessmentOneId,
          claim_version_evidence_id: assessmentOneId,
          responds_to_assessment_id: null,
        }] };
      }
      if (stage === "INSERT ASSESSMENT") {
        return { rows: [{
          id: values[0], claim_version_evidence_id: values[1],
          source_quality: values[2], relevance: values[3], directness: values[4],
          recency: values[5], independence: values[6], assessment_method: values[7],
          rationale: values[8], assessed_by: null,
          initiator_type: values[9], initiator_id: values[10],
          responds_to_assessment_id: values[11], response_relation: values[12],
          rubric_id: values[13], rubric_version: values[14],
          recency_reference_type: values[15], recency_reference_at: values[16],
          rule_set_id: values[17], rule_set_version: values[18],
          model_id: values[19], model_version: values[20],
          model_process_type: values[21], model_process_version: values[22],
          import_reference_type: values[23], import_reference: values[24],
          assessed_at: now,
        }] };
      }
      return { rows: [] };
    },
    release(...args) { releases.push(args); },
  };
  return { calls, releases, pool: { async connect() { return client; } } };
}

test("evidence and its version relation are inserted atomically", async () => {
  const { createEvidenceForClaimVersion } = require("../dist/services/evidenceService");
  const harness = writeHarness();
  const result = await createEvidenceForClaimVersion(
    {
      claimId, versionId: versionOneId, sourceUrl: "https://example.test/source",
      retrievedAt: new Date("2026-08-21T08:30:00.000Z"), relation: "supports",
    },
    harness.pool,
  );
  assert.deepEqual(harness.calls.map((call) => call.stage), [
    "BEGIN", "VERIFY VERSION", "INSERT EVIDENCE", "INSERT RELATION", "COMMIT",
  ]);
  assert.deepEqual(harness.releases, [[]]);
  assert.equal(result.evidence.relation, "supports");
});

test("failure of the evidence relation insert rolls back the evidence insert", async () => {
  const { createEvidenceForClaimVersion } = require("../dist/services/evidenceService");
  const relationError = new Error("relation insert failed");
  const harness = writeHarness({ failures: { "INSERT RELATION": relationError } });
  await assert.rejects(
    createEvidenceForClaimVersion(
      {
        claimId, versionId: versionOneId, sourceUrl: "https://example.test/source",
        retrievedAt: new Date(), relation: "supports",
      },
      harness.pool,
    ),
    relationError,
  );
  assert.deepEqual(harness.calls.map((call) => call.stage), [
    "BEGIN", "VERIFY VERSION", "INSERT EVIDENCE", "INSERT RELATION", "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("evidence transaction destroys the client when rollback itself fails", async () => {
  const { createEvidenceForClaimVersion } = require("../dist/services/evidenceService");
  const relationError = new Error("relation insert failed");
  const rollbackError = new Error("rollback failed");
  const harness = writeHarness({
    failures: { "INSERT RELATION": relationError, ROLLBACK: rollbackError },
  });
  await assert.rejects(
    createEvidenceForClaimVersion(
      {
        claimId, versionId: versionOneId, sourceUrl: "https://example.test/source",
        retrievedAt: new Date(), relation: "supports",
      },
      harness.pool,
    ),
    (error) => {
      assert.equal(error.originalError, relationError);
      assert.equal(error.rollbackError, rollbackError);
      return true;
    },
  );
  assert.deepEqual(harness.releases, [[true]]);
});

test("assessment is append-inserted with exact dimensions and rationale", async () => {
  const { createEvidenceAssessment } = require("../dist/services/evidenceService");
  const harness = writeHarness();
  const input = {
    claimId, versionId: versionOneId, evidenceId: evidenceOneId,
    ...assessmentBody(),
  };
  const result = await createEvidenceAssessment(input, harness.pool);
  assert.deepEqual(harness.calls.map((call) => call.stage), [
    "BEGIN", "SET READ COMMITTED", "LOCK RELATION", "INSERT ASSESSMENT", "COMMIT",
  ]);
  assert.deepEqual(harness.releases, [[]]);
  assert.equal(result.assessment.sourceQuality, 0.9);
  assert.equal(result.assessment.rationale, input.rationale);
  assert.equal(result.assessment.initiator, null);
  assert.equal(result.assessment.legacyAssessedBy, null);
  assert.deepEqual(result.assessment.rubric, {
    id: "factbase-evidence-assessment",
    version: "1",
  });
});

test("RCV-014 assessment stores recency and same-version independence context atomically", async () => {
  const { createEvidenceAssessment } = require("../dist/services/evidenceService");
  const harness = writeHarness();
  const referenceAt = new Date("2026-08-21T09:00:00.000Z");
  const result = await createEvidenceAssessment(
    {
      claimId,
      versionId: versionOneId,
      evidenceId: evidenceOneId,
      relevance: 0.75,
      recency: 0.5,
      recencyReferenceType: "event_at",
      recencyReferenceAt: referenceAt,
      independence: 1,
      independenceComparisonRelationIds: [comparisonRelationId],
      assessmentMethod: "rules_based",
      ruleSetId: "factbase-rules",
      ruleSetVersion: "2",
      rationale: "Every populated RCV-014 dimension is explicitly justified.",
    },
    harness.pool,
  );

  assert.deepEqual(harness.calls.map((call) => call.stage), [
    "BEGIN",
    "SET READ COMMITTED",
    "LOCK RELATION",
    "VERIFY COMPARISONS",
    "INSERT ASSESSMENT",
    "INSERT COMPARISONS",
    "COMMIT",
  ]);
  assert.deepEqual(result.assessment.recencyContext, {
    referenceType: "event_at",
    referenceAt,
  });
  assert.deepEqual(result.assessment.independenceComparisonRelationIds, [
    comparisonRelationId,
  ]);
  assert.deepEqual(result.assessment.method.ruleSet, {
    id: "factbase-rules",
    version: "2",
  });
});

test("RCV-014 comparison insert failure rolls back the assessment atomically", async () => {
  const { createEvidenceAssessment } = require("../dist/services/evidenceService");
  const comparisonError = new Error("comparison insert failed");
  const harness = writeHarness({
    failures: { "INSERT COMPARISONS": comparisonError },
  });

  await assert.rejects(
    createEvidenceAssessment(
      {
        claimId,
        versionId: versionOneId,
        evidenceId: evidenceOneId,
        independence: 0.5,
        independenceComparisonRelationIds: [comparisonRelationId],
        assessmentMethod: "manual",
        rationale: "The assessment and comparison set must commit together.",
      },
      harness.pool,
    ),
    comparisonError,
  );

  assert.deepEqual(harness.calls.map((call) => call.stage), [
    "BEGIN",
    "SET READ COMMITTED",
    "LOCK RELATION",
    "VERIFY COMPARISONS",
    "INSERT ASSESSMENT",
    "INSERT COMPARISONS",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("RCV-014 service detects a differently-cased self comparator", async () => {
  const {
    IndependenceComparisonError,
    createEvidenceAssessment,
  } = require("../dist/services/evidenceService");
  const selfRelationId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const harness = writeHarness({ lockedRelationId: selfRelationId });

  await assert.rejects(
    createEvidenceAssessment(
      {
        claimId,
        versionId: versionOneId,
        evidenceId: evidenceOneId,
        independence: 0.5,
        independenceComparisonRelationIds: [selfRelationId.toUpperCase()],
        assessmentMethod: "manual",
        rationale: "Self comparison is independent of UUID letter casing.",
      },
      harness.pool,
    ),
    (error) =>
      error instanceof IndependenceComparisonError &&
      error.reason === "self_comparison",
  );
  assert.deepEqual(harness.calls.map((call) => call.stage), [
    "BEGIN",
    "SET READ COMMITTED",
    "LOCK RELATION",
    "ROLLBACK",
  ]);
});

test("assessment response is inserted against the verified same evidence relation", async () => {
  const { createEvidenceAssessment } = require("../dist/services/evidenceService");
  const harness = writeHarness();
  const result = await createEvidenceAssessment(
    {
      claimId, versionId: versionOneId, evidenceId: evidenceOneId,
      ...assessmentBody({
        respondsToAssessmentId: assessmentOneId,
        responseRelation: "disputes",
      }),
      operationContext: {
        initiator: { type: "agent", id: "assessment-agent" },
      },
    },
    harness.pool,
  );
  assert.deepEqual(harness.calls.map((call) => call.stage), [
    "BEGIN", "SET READ COMMITTED", "LOCK RELATION", "VERIFY RESPONSE TARGET", "CHECK RESPONSE CHAIN",
    "INSERT ASSESSMENT", "COMMIT",
  ]);
  assert.deepEqual(result.assessment.initiator, {
    type: "agent", id: "assessment-agent",
  });
  assert.deepEqual(result.assessment.responseTo, {
    assessmentId: assessmentOneId, relation: "disputes",
  });
});

test("assessment response to another relation returns the dedicated not-found error and rolls back", async () => {
  const {
    AssessmentResponseTargetNotFoundError,
    createEvidenceAssessment,
  } = require("../dist/services/evidenceService");
  const harness = writeHarness({ responseTargetExists: false });
  await assert.rejects(
    createEvidenceAssessment(
      {
        claimId, versionId: versionOneId, evidenceId: evidenceOneId,
        ...assessmentBody({
          respondsToAssessmentId: assessmentOneId,
          responseRelation: "supports",
        }),
      },
      harness.pool,
    ),
    AssessmentResponseTargetNotFoundError,
  );
  assert.deepEqual(harness.calls.map((call) => call.stage), [
    "BEGIN", "SET READ COMMITTED", "LOCK RELATION", "VERIFY RESPONSE TARGET", "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("assessment insert failures roll back and a failed rollback destroys the client", async () => {
  const { createEvidenceAssessment } = require("../dist/services/evidenceService");
  const insertError = new Error("assessment insert failed");
  const rollbackError = new Error("assessment rollback failed");

  const normal = writeHarness({ failures: { "INSERT ASSESSMENT": insertError } });
  await assert.rejects(
    createEvidenceAssessment(
      { claimId, versionId: versionOneId, evidenceId: evidenceOneId, ...assessmentBody() },
      normal.pool,
    ),
    insertError,
  );
  assert.deepEqual(normal.calls.map((call) => call.stage), [
    "BEGIN", "SET READ COMMITTED", "LOCK RELATION", "INSERT ASSESSMENT", "ROLLBACK",
  ]);
  assert.deepEqual(normal.releases, [[]]);

  const broken = writeHarness({
    failures: { "INSERT ASSESSMENT": insertError, ROLLBACK: rollbackError },
  });
  await assert.rejects(
    createEvidenceAssessment(
      { claimId, versionId: versionOneId, evidenceId: evidenceOneId, ...assessmentBody() },
      broken.pool,
    ),
    (error) => {
      assert.equal(error.originalError, insertError);
      assert.equal(error.rollbackError, rollbackError);
      return true;
    },
  );
  assert.deepEqual(broken.releases, [[true]]);
});

test("assessment transaction handles begin, verification, empty returning and commit failures", async (t) => {
  const { createEvidenceAssessment } = require("../dist/services/evidenceService");
  const input = {
    claimId, versionId: versionOneId, evidenceId: evidenceOneId, ...assessmentBody(),
  };
  const cases = [
    {
      name: "BEGIN failure does not roll back",
      harness: writeHarness({ failures: { BEGIN: new Error("begin failed") } }),
      expected: ["BEGIN"],
    },
    {
      name: "isolation setup failure rolls back",
      harness: writeHarness({ failures: { "SET READ COMMITTED": new Error("isolation failed") } }),
      expected: ["BEGIN", "SET READ COMMITTED", "ROLLBACK"],
    },
    {
      name: "relation verification failure rolls back",
      harness: writeHarness({ failures: { "LOCK RELATION": new Error("verify failed") } }),
      expected: ["BEGIN", "SET READ COMMITTED", "LOCK RELATION", "ROLLBACK"],
    },
    {
      name: "response verification failure rolls back",
      harness: writeHarness({ failures: { "VERIFY RESPONSE TARGET": new Error("response verify failed") } }),
      input: {
        ...input,
        respondsToAssessmentId: assessmentOneId,
        responseRelation: "supports",
      },
      expected: ["BEGIN", "SET READ COMMITTED", "LOCK RELATION", "VERIFY RESPONSE TARGET", "ROLLBACK"],
    },
    {
      name: "parent-chain inspection failure rolls back",
      harness: writeHarness({ failures: { "CHECK RESPONSE CHAIN": new Error("chain failed") } }),
      input: {
        ...input,
        respondsToAssessmentId: assessmentOneId,
        responseRelation: "supports",
      },
      expected: [
        "BEGIN", "SET READ COMMITTED", "LOCK RELATION",
        "VERIFY RESPONSE TARGET", "CHECK RESPONSE CHAIN", "ROLLBACK",
      ],
    },
    {
      name: "empty returning rolls back",
      harness: writeHarness({ emptyRows: ["INSERT ASSESSMENT"] }),
      expected: ["BEGIN", "SET READ COMMITTED", "LOCK RELATION", "INSERT ASSESSMENT", "ROLLBACK"],
    },
    {
      name: "commit failure rolls back",
      harness: writeHarness({ failures: { COMMIT: new Error("commit failed") } }),
      expected: ["BEGIN", "SET READ COMMITTED", "LOCK RELATION", "INSERT ASSESSMENT", "COMMIT", "ROLLBACK"],
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      await assert.rejects(createEvidenceAssessment(item.input ?? input, item.harness.pool));
      assert.deepEqual(item.harness.calls.map((call) => call.stage), item.expected);
      assert.deepEqual(item.harness.releases, [[]]);
    });
  }
});

test("assessment service rejects damaged parent chains before insert", async (t) => {
  const {
    AssessmentGraphConflictError,
    createEvidenceAssessment,
  } = require("../dist/services/evidenceService");
  const secondAssessmentId = "88888888-8888-4888-8888-888888888888";
  const thirdAssessmentId = "99999999-9999-4999-8999-999999999999";
  const otherRelationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const missingAssessmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const row = (id, parent, relationId = assessmentOneId) => ({
    id,
    claim_version_evidence_id: relationId,
    responds_to_assessment_id: parent,
  });
  const cases = [
    ["self cycle", [row(assessmentOneId, assessmentOneId)], "existing_cycle"],
    ["two-node cycle", [
      row(assessmentOneId, secondAssessmentId),
      row(secondAssessmentId, assessmentOneId),
    ], "existing_cycle"],
    ["multi-node cycle", [
      row(assessmentOneId, secondAssessmentId),
      row(secondAssessmentId, thirdAssessmentId),
      row(thirdAssessmentId, assessmentOneId),
    ], "existing_cycle"],
    ["cross-relation ancestor", [
      row(assessmentOneId, secondAssessmentId),
      row(secondAssessmentId, null, otherRelationId),
    ], "cross_relation_ancestor"],
    ["missing ancestor", [
      row(assessmentOneId, missingAssessmentId),
    ], "missing_ancestor"],
  ];

  for (const [name, chainRows, reason] of cases) {
    await t.test(name, async () => {
      const harness = writeHarness({ chainRows });
      await assert.rejects(
        createEvidenceAssessment(
          {
            claimId, versionId: versionOneId, evidenceId: evidenceOneId,
            ...assessmentBody({
              respondsToAssessmentId: assessmentOneId,
              responseRelation: "disputes",
            }),
          },
          harness.pool,
        ),
        (error) => error instanceof AssessmentGraphConflictError && error.reason === reason,
      );
      assert.deepEqual(harness.calls.map((call) => call.stage), [
        "BEGIN", "SET READ COMMITTED", "LOCK RELATION", "VERIFY RESPONSE TARGET",
        "CHECK RESPONSE CHAIN", "ROLLBACK",
      ]);
      assert.equal(
        harness.calls.some((call) => call.stage === "INSERT ASSESSMENT"),
        false,
      );
    });
  }
});

test("parent-chain inspection detects a defensive path back to the new id", () => {
  const {
    inspectAssessmentParentChain,
  } = require("../dist/services/evidenceService");
  const newAssessmentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const rows = [
    {
      id: assessmentOneId,
      claim_version_evidence_id: assessmentOneId,
      responds_to_assessment_id: newAssessmentId,
    },
    {
      id: newAssessmentId,
      claim_version_evidence_id: assessmentOneId,
      responds_to_assessment_id: null,
    },
  ];
  assert.equal(
    inspectAssessmentParentChain(
      rows,
      assessmentOneId,
      newAssessmentId,
      assessmentOneId,
    ),
    "would_create_cycle",
  );
});

function versionRow(id, overrides = {}) {
  return {
    id, claim_id: claimId, version_number: id === versionOneId ? 1 : 2,
    title: "Same title", normalized_statement: "Statement one", language: "en",
    claim_type: "fact", status: "published", publication_status: "published",
    change_reason: "initial_creation", based_on_version_id: null,
    actor_type: "api", actor_id: null, source_type: "api",
    source_reference: null, request_id: "88888888-8888-4888-8888-888888888888",
    created_at: new Date("2026-08-21T07:00:00.000Z"), ...overrides,
  };
}

function evidenceRow(relationId, id, relation) {
  return {
    relation_id: relationId, evidence_id: id, relation,
    source_url: `https://example.test/${id}`, source_title: "Source",
    source_type: "report", locator: "p. 1", quoted_text: null,
    snapshot_hash: null, retrieved_at: new Date("2026-08-21T06:00:00.000Z"),
    evidence_created_at: new Date("2026-08-21T06:01:00.000Z"),
    relation_created_at: new Date("2026-08-21T06:02:00.000Z"),
  };
}

function readHarness(options = {}) {
  const releases = [];
  const versions = new Map([
    [versionOneId, versionRow(versionOneId)],
    [versionTwoId, versionRow(versionTwoId, {
      normalized_statement: "Statement two", status: "draft",
      publication_status: "unpublished", change_reason: "Evidence changed",
      based_on_version_id: versionOneId, actor_id: "editor-1",
      source_reference: "case-42",
      request_id: "99999999-9999-4999-8999-999999999999",
    })],
  ]);
  const evidence = new Map([
    [versionOneId, [
      evidenceRow("a1111111-1111-4111-8111-111111111111", evidenceOneId, "supports"),
      evidenceRow("a2222222-2222-4222-8222-222222222222", evidenceTwoId, "contextualizes"),
    ]],
    [versionTwoId, [
      evidenceRow("a3333333-3333-4333-8333-333333333333", evidenceOneId, "contradicts"),
      evidenceRow("a4444444-4444-4444-8444-444444444444", evidenceThreeId, "supports"),
    ]],
  ]);
  const assessments = new Map([
    [versionOneId, [{
      id: "b1111111-1111-4111-8111-111111111111",
      relation_id: "a1111111-1111-4111-8111-111111111111",
      source_quality: "0.9", relevance: "1", directness: "0.8", recency: "0.7",
      independence: "1", assessment_method: "manual", rationale: "Original",
      assessed_by: "legacy-reviewer", initiator_type: null, initiator_id: null,
      responds_to_assessment_id: null, response_relation: null,
      parent_assessment_id: null, parent_relation_id: null,
      assessed_at: new Date("2026-08-21T06:03:00.000Z"),
    }]],
    [versionTwoId, [
      {
        id: "b2000000-0000-4000-8000-000000000000",
        relation_id: "a3333333-3333-4333-8333-333333333333",
        source_quality: null, relevance: "0", directness: "1", recency: null,
        independence: null, assessment_method: "manual", rationale: "Basis",
        assessed_by: null, initiator_type: null, initiator_id: null,
        responds_to_assessment_id: null, response_relation: null,
        parent_assessment_id: null, parent_relation_id: null,
        assessed_at: new Date("2026-08-21T06:03:30.000Z"),
      },
      {
        id: "b2222222-2222-4222-8222-222222222222",
        relation_id: "a3333333-3333-4333-8333-333333333333",
        source_quality: "0.5", relevance: "1", directness: "0.6", recency: "0.7",
        independence: "1", assessment_method: "rules_based", rationale: "Reassessed",
        assessed_by: null, initiator_type: "human", initiator_id: "verified-reviewer",
        responds_to_assessment_id: "b2000000-0000-4000-8000-000000000000",
        response_relation: "disputes",
        parent_assessment_id: "b2000000-0000-4000-8000-000000000000",
        parent_relation_id: "a3333333-3333-4333-8333-333333333333",
        rubric_id: "factbase-evidence-assessment", rubric_version: "1",
        recency_reference_type: "event_at",
        recency_reference_at: new Date("2026-08-21T05:00:00.000Z"),
        rule_set_id: "read-rules", rule_set_version: "4",
        assessed_at: new Date("2026-08-21T06:04:00.000Z"),
      },
    ]],
  ]);
  if (options.versionTwoAssessments) {
    assessments.set(versionTwoId, options.versionTwoAssessments);
  }
  const assessmentDefaults = {
    rubric_id: null,
    rubric_version: null,
    recency_reference_type: null,
    recency_reference_at: null,
    rule_set_id: null,
    rule_set_version: null,
    model_id: null,
    model_version: null,
    model_process_type: null,
    model_process_version: null,
    import_reference_type: null,
    import_reference: null,
  };
  let activeVersionId;
  const client = {
    async query(sql, values) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("SET TRANSACTION")) {
        return { rows: [] };
      }
      if (sql.includes("FROM public.claim_versions") && sql.includes("WHERE id")) {
        activeVersionId = values[0];
        const row = versions.get(activeVersionId);
        return { rows: row && row.claim_id === values[1] ? [row] : [] };
      }
      if (sql.includes("FROM public.claim_version_evidence cve") && sql.includes("INNER JOIN public.evidence e")) {
        return { rows: evidence.get(activeVersionId) ?? [] };
      }
      if (sql.includes("FROM public.evidence_assessment_independence_comparisons")) {
        const defaultComparisons = activeVersionId === versionTwoId
          ? [{
              assessment_id: "b2222222-2222-4222-8222-222222222222",
              comparison_claim_version_evidence_id:
                "a4444444-4444-4444-8444-444444444444",
            }]
          : [];
        return { rows: options.comparisons?.get(activeVersionId) ?? defaultComparisons };
      }
      if (sql.includes("FROM public.evidence_assessments")) {
        return {
          rows: (assessments.get(activeVersionId) ?? []).map((row) => ({
            ...assessmentDefaults,
            ...row,
          })),
        };
      }
      throw new Error(`Unexpected read query: ${sql}`);
    },
    release(...args) { releases.push(args); },
  };
  return { pool: { async connect() { return client; } }, releases };
}

test("read model joins explicit provenance, evidence and assessments", async () => {
  const { getClaimVersionDetails } = require("../dist/services/claimVersionReadService");
  const harness = readHarness();
  const result = await getClaimVersionDetails(claimId, versionTwoId, harness.pool);
  assert.equal(result.version.basedOnVersionId, versionOneId);
  assert.deepEqual(result.version.actor, { type: "api", id: "editor-1" });
  assert.equal(result.evidence[0].relation, "contradicts");
  const base = result.evidence[0].assessments[0];
  const response = result.evidence[0].assessments[1];
  assert.equal(base.sourceQuality, null);
  assert.equal(base.relevance, 0);
  assert.equal(base.directness, 1);
  assert.equal(response.sourceQuality, 0.5);
  assert.equal(response.rationale, "Reassessed");
  assert.equal(response.claimVersionEvidenceId, result.evidence[0].relationId);
  assert.deepEqual(response.initiator, {
    type: "human", id: "verified-reviewer",
  });
  assert.deepEqual(response.responseTo, {
    assessmentId: "b2000000-0000-4000-8000-000000000000",
    relation: "disputes",
  });
  assert.deepEqual(response.rubric, {
    id: "factbase-evidence-assessment",
    version: "1",
  });
  assert.deepEqual(response.recencyContext, {
    referenceType: "event_at",
    referenceAt: new Date("2026-08-21T05:00:00.000Z"),
  });
  assert.deepEqual(response.independenceComparisonRelationIds, [
    "a4444444-4444-4444-8444-444444444444",
  ]);
  assert.deepEqual(response.method.ruleSet, {
    id: "read-rules",
    version: "4",
  });
  assert.deepEqual(result.evidence[0].assessmentGraph, {
    unparentedAssessmentIds: ["b2000000-0000-4000-8000-000000000000"],
    integrity: { status: "valid", anomalies: [] },
  });
  const legacy = await getClaimVersionDetails(claimId, versionOneId, readHarness().pool);
  assert.equal(
    legacy.evidence[0].assessments[0].legacyAssessedBy,
    "legacy-reviewer",
  );
  assert.equal(legacy.evidence[0].assessments[0].initiator, null);
  assert.equal(legacy.evidence[0].assessments[0].rubric, null);
  assert.deepEqual(harness.releases, [[]]);
});

function graphAssessment(id, parentId, options = {}) {
  const relationId = options.relationId ?? "graph-relation";
  const parentExists = options.parentExists ?? parentId !== null;
  return {
    id,
    relation_id: relationId,
    responds_to_assessment_id: parentId,
    response_relation:
      options.responseRelation === undefined
        ? parentId === null ? null : "supports"
        : options.responseRelation,
    parent_assessment_id: parentExists ? parentId : null,
    parent_relation_id:
      parentExists
        ? options.parentRelationId ?? relationId
        : null,
  };
}

test("assessment graph reports every controlled anomaly deterministically", () => {
  const { buildAssessmentGraph } = require("../dist/services/claimVersionReadService");
  const rows = [
    graphAssessment("unparented", null),
    graphAssessment("missing-z", "absent-z", { parentExists: false }),
    graphAssessment("missing-a", "absent-a", { parentExists: false }),
    graphAssessment("cross", "external", { parentRelationId: "other-relation" }),
    graphAssessment("incomplete", null, { responseRelation: "disputes" }),
    graphAssessment("invalid", "unparented", { responseRelation: "rebuts" }),
    graphAssessment("self", "self"),
    graphAssessment("cycle-b", "cycle-a"),
    graphAssessment("cycle-a", "cycle-b"),
  ];

  const graph = buildAssessmentGraph(rows, "graph-relation");
  assert.deepEqual(graph.unparentedAssessmentIds, ["unparented", "incomplete"]);
  assert.deepEqual(
    graph.integrity.anomalies.map((anomaly) => anomaly.code),
    [
      "missing_parent",
      "missing_parent",
      "cross_relation_parent",
      "incomplete_response_pair",
      "invalid_response_relation",
      "self_response",
      "cycle",
    ],
  );
  assert.deepEqual(
    graph.integrity.anomalies.slice(0, 2).map((anomaly) => anomaly.assessmentIds),
    [["missing-a"], ["missing-z"]],
  );
  assert.deepEqual(
    graph.integrity.anomalies.at(-1).assessmentIds,
    ["cycle-a", "cycle-b"],
  );
  assert.equal(graph.integrity.status, "anomalies_detected");
});

test("assessment graph handles a deep chain and multiple children without duplication", () => {
  const { buildAssessmentGraph } = require("../dist/services/claimVersionReadService");
  const rows = [graphAssessment("node-0000", null)];
  for (let index = 1; index <= 2000; index += 1) {
    rows.push(
      graphAssessment(
        `node-${String(index).padStart(4, "0")}`,
        `node-${String(index - 1).padStart(4, "0")}`,
      ),
    );
  }
  rows.push(graphAssessment("sibling-a", "node-0000"));
  rows.push(graphAssessment("sibling-b", "node-0000"));

  const graph = buildAssessmentGraph(rows, "graph-relation");
  assert.deepEqual(graph, {
    unparentedAssessmentIds: ["node-0000"],
    integrity: { status: "valid", anomalies: [] },
  });
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
});

test("read model preserves incomplete response raw values", async () => {
  const { getClaimVersionDetails } = require("../dist/services/claimVersionReadService");
  const malformedId = "b9000000-0000-4000-8000-000000000000";
  const malformed = {
    id: malformedId,
    relation_id: "a3333333-3333-4333-8333-333333333333",
    source_quality: "0", relevance: null, directness: "1", recency: null,
    independence: null, assessment_method: null, rationale: null,
    assessed_by: "legacy-label", initiator_type: null, initiator_id: null,
    responds_to_assessment_id: null, response_relation: "disputes",
    parent_assessment_id: null, parent_relation_id: null,
    assessed_at: new Date("2026-08-21T06:05:00.000Z"),
  };
  const result = await getClaimVersionDetails(
    claimId,
    versionTwoId,
    readHarness({ versionTwoAssessments: [malformed] }).pool,
  );
  const assessment = result.evidence[0].assessments[0];
  assert.equal(assessment.id, malformedId);
  assert.deepEqual(assessment.responseTo, {
    assessmentId: null,
    relation: "disputes",
  });
  assert.equal(assessment.legacyAssessedBy, "legacy-label");
  assert.deepEqual(result.evidence[0].assessmentGraph.unparentedAssessmentIds, [
    malformedId,
  ]);
  assert.deepEqual(
    result.evidence[0].assessmentGraph.integrity.anomalies.map(({ code }) => code),
    ["incomplete_response_pair"],
  );
});

test("claim-version controller returns graph anomalies with HTTP 200", async () => {
  const {
    buildGetClaimVersionController,
  } = require("../dist/controllers/claimVersionReadController");
  const expected = {
    claimId,
    evidence: [{
      assessments: [],
      assessmentGraph: {
        unparentedAssessmentIds: [],
        integrity: {
          status: "anomalies_detected",
          anomalies: [{
            code: "missing_parent",
            assessmentIds: [assessmentOneId],
            relatedAssessmentId: "missing",
            relatedClaimVersionEvidenceId: null,
            rawResponseRelation: "disputes",
          }],
        },
      },
    }],
  };
  const handler = buildGetClaimVersionController(async () => expected);
  const res = response();

  await handler(
    { params: { claimId, versionId: versionOneId } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.strictEqual(res.body, expected);
});

test("version diff reports only deterministic content, provenance, evidence, assessment and state changes", async () => {
  const { diffClaimVersions } = require("../dist/services/claimVersionReadService");
  const result = await diffClaimVersions(claimId, versionOneId, versionTwoId, readHarness().pool);
  assert.deepEqual(result.contentChanges, {
    normalizedStatement: { from: "Statement one", to: "Statement two" },
  });
  assert.equal(Object.hasOwn(result.contentChanges, "title"), false);
  assert.deepEqual(result.evidenceChanges, {
    added: [evidenceThreeId],
    removed: [evidenceTwoId],
    relationChanged: [{ evidenceId: evidenceOneId, from: "supports", to: "contradicts" }],
  });
  assert.deepEqual(result.assessmentChanges, {
    added: [
      "b2000000-0000-4000-8000-000000000000",
      "b2222222-2222-4222-8222-222222222222",
    ],
  });
  assert.deepEqual(result.stateChanges, {
    status: { from: "published", to: "draft" },
    publicationStatus: { from: "published", to: "unpublished" },
  });
  assert.equal(result.provenanceChanges.basedOnVersionId.to, versionOneId);
});

test("versions from different claims cannot be compared", async () => {
  const { diffClaimVersions } = require("../dist/services/claimVersionReadService");
  const { ClaimVersionNotFoundError } = require("../dist/services/evidenceService");
  const otherClaimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await assert.rejects(
    diffClaimVersions(otherClaimId, versionOneId, versionTwoId, readHarness().pool),
    ClaimVersionNotFoundError,
  );
});
