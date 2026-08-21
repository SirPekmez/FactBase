const assert = require("node:assert/strict");
const test = require("node:test");

const claimId = "11111111-1111-4111-8111-111111111111";
const versionOneId = "22222222-2222-4222-8222-222222222222";
const versionTwoId = "33333333-3333-4333-8333-333333333333";
const evidenceOneId = "44444444-4444-4444-8444-444444444444";
const evidenceTwoId = "55555555-5555-4555-8555-555555555555";
const evidenceThreeId = "66666666-6666-4666-8666-666666666666";

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
    recency: 0.7,
    independence: 1,
    assessmentMethod: "manual",
    rationale: "Exact rationale, including punctuation.",
    assessedBy: "reviewer-17",
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

test("assessment validation rejects out-of-range and non-finite values", async (t) => {
  const {
    buildCreateEvidenceAssessmentController,
  } = require("../dist/controllers/evidenceController");
  const invalid = [
    assessmentBody({ sourceQuality: -0.01 }),
    assessmentBody({ relevance: 1.01 }),
    assessmentBody({ directness: Number.NaN }),
    assessmentBody({ recency: Number.POSITIVE_INFINITY }),
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

function writeStage(sql) {
  if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return sql;
  if (sql.includes("SELECT id") && sql.includes("FROM public.claim_versions")) {
    return "VERIFY VERSION";
  }
  if (sql.includes("INSERT INTO public.evidence ")) return "INSERT EVIDENCE";
  if (sql.includes("INSERT INTO public.claim_version_evidence")) {
    return "INSERT RELATION";
  }
  if (sql.includes("SELECT cve.id")) return "VERIFY RELATION";
  if (sql.includes("INSERT INTO public.evidence_assessments")) {
    return "INSERT ASSESSMENT";
  }
  throw new Error(`Unexpected write query: ${sql}`);
}

function writeHarness({ failures = {}, versionExists = true, relationExists = true } = {}) {
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
      if (stage === "VERIFY RELATION") {
        return { rows: relationExists ? [{ id: "77777777-7777-4777-8777-777777777777" }] : [] };
      }
      if (stage === "INSERT ASSESSMENT") {
        return { rows: [{
          id: values[0], claim_version_evidence_id: values[1],
          source_quality: values[2], relevance: values[3], directness: values[4],
          recency: values[5], independence: values[6], assessment_method: values[7],
          rationale: values[8], assessed_by: values[9], assessed_at: now,
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
    "BEGIN", "VERIFY RELATION", "INSERT ASSESSMENT", "COMMIT",
  ]);
  assert.deepEqual(harness.releases, [[]]);
  assert.equal(result.assessment.sourceQuality, 0.9);
  assert.equal(result.assessment.rationale, input.rationale);
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

function readHarness() {
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
      assessed_by: "reviewer", assessed_at: new Date("2026-08-21T06:03:00.000Z"),
    }]],
    [versionTwoId, [{
      id: "b2222222-2222-4222-8222-222222222222",
      relation_id: "a3333333-3333-4333-8333-333333333333",
      source_quality: "0.5", relevance: "1", directness: "0.6", recency: "0.7",
      independence: "1", assessment_method: "manual", rationale: "Reassessed",
      assessed_by: "reviewer", assessed_at: new Date("2026-08-21T06:04:00.000Z"),
    }]],
  ]);
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
      if (sql.includes("FROM public.evidence_assessments")) {
        return { rows: assessments.get(activeVersionId) ?? [] };
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
  assert.equal(result.evidence[0].assessments[0].sourceQuality, 0.5);
  assert.equal(result.evidence[0].assessments[0].rationale, "Reassessed");
  assert.deepEqual(harness.releases, [[]]);
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
    added: ["b2222222-2222-4222-8222-222222222222"],
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
