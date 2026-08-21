const assert = require("node:assert/strict");
const test = require("node:test");

const claimId = "11111111-1111-4111-8111-111111111111";
const uuidVersionSeven = "01890f3e-7b21-7cc2-9a4b-123456789abc";
const postgresIntegerMax = 2_147_483_647;

function createResponse() {
  const headers = {};

  return {
    statusCode: undefined,
    body: undefined,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name) {
      delete headers[name.toLowerCase()];
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequestBody(overrides = {}) {
  return {
    basedOnVersionNumber: 1,
    title: "Revised title",
    normalizedStatement: "Revised normalized statement",
    language: "en",
    claimType: "fact",
    changeReason: "Evidence was clarified",
    ...overrides,
  };
}

function createExpectedVersion(versionNumber = 2) {
  return {
    claimId,
    version: {
      id: "22222222-2222-4222-8222-222222222222",
      claimId,
      versionNumber,
      title: "Revised title",
      normalizedStatement: "Revised normalized statement",
      language: "en",
      claimType: "fact",
      status: "draft",
      publicationStatus: "unpublished",
      changeReason: "Evidence was clarified",
      createdAt: new Date("2026-08-18T12:00:00.000Z"),
    },
  };
}

test("create version controller returns 201 with the path claim id", async () => {
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");
  const expectedVersion = createExpectedVersion();
  let receivedInput;
  const handler = buildCreateClaimVersionController(async (input) => {
    receivedInput = input;
    return expectedVersion;
  });
  const response = createResponse();

  await handler(
    { params: { claimId }, body: createRequestBody() },
    response,
  );

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, expectedVersion);
  assert.deepEqual(receivedInput, {
    claimId,
    ...createRequestBody(),
  });
});

test("POST /api/claims/:claimId/versions is mounted through Express", async () => {
  const { buildApp } = require("../dist/app");
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");
  const { buildClaimsRouter } = require("../dist/routes/claims");
  const expectedVersion = createExpectedVersion();
  const handler = buildCreateClaimVersionController(async () => expectedVersion);
  const app = buildApp(buildClaimsRouter(undefined, handler));
  const response = createResponse();
  const completed = new Promise((resolve, reject) => {
    response.json = function json(body) {
      this.body = body;
      resolve();
      return this;
    };

    app.handle(
      {
        method: "POST",
        url: `/api/claims/${claimId}/versions`,
        headers: {},
        body: createRequestBody(),
      },
      response,
      (error) => reject(error ?? new Error("request was not handled")),
    );
  });

  await completed;

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, expectedVersion);
});

test("create version controller rejects invalid and server-owned fields with 400", async (t) => {
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");
  const invalidRequests = [
    { params: { claimId: "not-a-uuid" }, body: createRequestBody() },
    { params: { claimId }, body: createRequestBody({ basedOnVersionNumber: 0 }) },
    { params: { claimId }, body: createRequestBody({ basedOnVersionNumber: -1 }) },
    { params: { claimId }, body: createRequestBody({ basedOnVersionNumber: 1.5 }) },
    {
      params: { claimId },
      body: createRequestBody({ basedOnVersionNumber: Number.MAX_SAFE_INTEGER + 1 }),
    },
    {
      params: { claimId },
      body: createRequestBody({ basedOnVersionNumber: postgresIntegerMax + 1 }),
    },
    { params: { claimId }, body: createRequestBody({ actorType: "   " }) },
    { params: { claimId }, body: createRequestBody({ requestId: "invalid" }) },
    { params: { claimId }, body: createRequestBody({ changeReason: "   " }) },
    { params: { claimId }, body: createRequestBody({ title: "" }) },
    { params: { claimId }, body: createRequestBody({ versionNumber: 2 }) },
    { params: { claimId }, body: createRequestBody({ status: "published" }) },
    {
      params: { claimId },
      body: createRequestBody({ publicationStatus: "published" }),
    },
    { params: { claimId }, body: createRequestBody({ claimId }) },
    {
      params: { claimId },
      body: createRequestBody({ createdAt: "2026-08-18T12:00:00.000Z" }),
    },
  ];

  for (const request of invalidRequests) {
    await t.test(`rejects ${JSON.stringify(request)}`, async () => {
      let operationCalled = false;
      const handler = buildCreateClaimVersionController(async () => {
        operationCalled = true;
        throw new Error("must not be called");
      });
      const response = createResponse();

      await handler(request, response);

      assert.equal(response.statusCode, 400);
      assert.equal(operationCalled, false);
    });
  }
});

test("create version controller accepts explicit provenance without changing server-owned state", async () => {
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");
  const requestId = "77777777-7777-4777-8777-777777777777";
  let receivedInput;
  const handler = buildCreateClaimVersionController(async (input) => {
    receivedInput = input;
    return createExpectedVersion();
  });
  const response = createResponse();
  const body = createRequestBody({
    actorType: "user",
    actorId: "editor-7",
    sourceType: "manual",
    sourceReference: "review-42",
    requestId,
  });

  await handler({ params: { claimId }, body }, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(receivedInput, { claimId, ...body });
  assert.equal(Object.hasOwn(receivedInput, "status"), false);
  assert.equal(Object.hasOwn(receivedInput, "publicationStatus"), false);
});

test("create version controller accepts generic UUID syntax and int4 boundaries", async (t) => {
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");

  for (const basedOnVersionNumber of [1, postgresIntegerMax]) {
    await t.test(`accepts basedOnVersionNumber ${basedOnVersionNumber}`, async () => {
      let receivedInput;
      const handler = buildCreateClaimVersionController(async (input) => {
        receivedInput = input;
        return createExpectedVersion();
      });
      const response = createResponse();

      await handler(
        {
          params: { claimId: uuidVersionSeven },
          body: createRequestBody({ basedOnVersionNumber }),
        },
        response,
      );

      assert.equal(response.statusCode, 201);
      assert.equal(receivedInput.claimId, uuidVersionSeven);
      assert.equal(receivedInput.basedOnVersionNumber, basedOnVersionNumber);
    });
  }
});

test("create version controller maps missing claims to 404", async () => {
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");
  const { ClaimNotFoundError } = require("../dist/services/claimVersionService");
  const handler = buildCreateClaimVersionController(async () => {
    throw new ClaimNotFoundError(claimId);
  });
  const response = createResponse();

  await handler({ params: { claimId }, body: createRequestBody() }, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Claim not found" });
});

test("create version controller maps stale writes to 409", async () => {
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");
  const {
    ClaimVersionConflictError,
  } = require("../dist/services/claimVersionService");
  const handler = buildCreateClaimVersionController(async () => {
    throw new ClaimVersionConflictError(4);
  });
  const response = createResponse();

  await handler({ params: { claimId }, body: createRequestBody() }, response);

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    error: "Claim version conflict",
    currentVersionNumber: 4,
  });
});

test("create version controller omits the current version when refresh is unavailable", async () => {
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");
  const {
    ClaimVersionConflictError,
  } = require("../dist/services/claimVersionService");
  const handler = buildCreateClaimVersionController(async () => {
    throw new ClaimVersionConflictError();
  });
  const response = createResponse();

  await handler({ params: { claimId }, body: createRequestBody() }, response);

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: "Claim version conflict" });
});

test("claim-without-version invariant maps to the generic 500 response", async () => {
  const {
    buildCreateClaimVersionController,
  } = require("../dist/controllers/claimVersionController");
  const {
    ClaimVersionInvariantError,
  } = require("../dist/services/claimVersionService");
  const handler = buildCreateClaimVersionController(async () => {
    throw new ClaimVersionInvariantError(claimId);
  });
  const response = createResponse();

  await handler({ params: { claimId }, body: createRequestBody() }, response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: "Claim version could not be created",
  });
});

function queryStage(text) {
  if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
    return text;
  }

  if (text.includes("FROM public.claims") && text.includes("FOR UPDATE")) {
    return "LOCK CLAIM";
  }

  if (text.includes("FROM public.claim_versions")) {
    return "SELECT CURRENT VERSION";
  }

  if (text.includes("INSERT INTO public.claim_versions")) {
    return "INSERT CLAIM VERSION";
  }

  throw new Error(`Unexpected query in test: ${text}`);
}

function createDatabaseHarness({
  claimExists = true,
  currentVersionId = "33333333-3333-4333-8333-333333333333",
  currentVersionNumber = 1,
  currentVersionExists = true,
  refreshedVersionNumber = currentVersionNumber,
  refreshedVersionExists = true,
  emptyInsertResult = false,
  failures = {},
} = {}) {
  const calls = [];
  const releases = [];
  const createdAt = new Date("2026-08-18T12:00:00.000Z");
  let versionReadCount = 0;
  const client = {
    async query(text, values) {
      let stage = queryStage(text);
      if (stage === "SELECT CURRENT VERSION") {
        versionReadCount += 1;
        if (versionReadCount > 1) {
          stage = "REFRESH CURRENT VERSION";
        }
      }
      calls.push({ stage, text, values });

      if (Object.prototype.hasOwnProperty.call(failures, stage)) {
        throw failures[stage];
      }

      if (stage === "LOCK CLAIM") {
        return { rows: claimExists ? [{ id: claimId }] : [] };
      }

      if (stage === "SELECT CURRENT VERSION") {
        return {
          rows: currentVersionExists
            ? [{ id: currentVersionId, version_number: currentVersionNumber }]
            : [],
        };
      }

      if (stage === "REFRESH CURRENT VERSION") {
        return {
          rows: refreshedVersionExists
            ? [{ id: currentVersionId, version_number: refreshedVersionNumber }]
            : [],
        };
      }

      if (stage === "INSERT CLAIM VERSION") {
        return {
          rows: emptyInsertResult
            ? []
            : [
                {
                  id: values[0],
                  claim_id: values[1],
                  version_number: values[2],
                  title: values[3],
                  normalized_statement: values[4],
                  language: values[5],
                  claim_type: values[6],
                  status: values[7],
                  publication_status: values[8],
                  change_reason: values[9],
                  created_at: createdAt,
                },
              ],
        };
      }

      return { rows: [] };
    },
    release(...args) {
      releases.push(args);
    },
  };

  return {
    calls,
    createdAt,
    pool: { async connect() { return client; } },
    releases,
  };
}

function serviceInput(basedOnVersionNumber) {
  return {
    claimId,
    ...createRequestBody({ basedOnVersionNumber }),
  };
}

function stagesOf(harness) {
  return harness.calls.map(({ stage }) => stage);
}

test("claim version service produces strict version sequence and server states", async (t) => {
  const { createClaimVersion } = require("../dist/services/claimVersionService");

  const bases = [
    { currentVersionNumber: 1, currentVersionId: "33333333-3333-4333-8333-333333333331" },
    { currentVersionNumber: 2, currentVersionId: "33333333-3333-4333-8333-333333333332" },
    { currentVersionNumber: 3, currentVersionId: "33333333-3333-4333-8333-333333333333" },
  ];
  for (const { currentVersionNumber, currentVersionId } of bases) {
    await t.test(`version ${currentVersionNumber + 1}`, async () => {
      const harness = createDatabaseHarness({
        currentVersionNumber,
        currentVersionId,
      });

      const result = await createClaimVersion(
        serviceInput(currentVersionNumber),
        harness.pool,
      );

      assert.deepEqual(stagesOf(harness), [
        "BEGIN",
        "LOCK CLAIM",
        "SELECT CURRENT VERSION",
        "INSERT CLAIM VERSION",
        "COMMIT",
      ]);
      assert.deepEqual(harness.releases, [[]]);
      assert.equal(
        harness.calls.some(({ text }) => /^(?:UPDATE|DELETE)\b/i.test(text.trim())),
        false,
      );

      const insertValues = harness.calls[3].values;
      assert.equal(insertValues[1], claimId);
      assert.equal(insertValues[2], currentVersionNumber + 1);
      assert.equal(insertValues[7], "draft");
      assert.equal(insertValues[8], "unpublished");
      assert.equal(insertValues[9], "Evidence was clarified");
      assert.equal(insertValues[10], currentVersionId);
      assert.equal(insertValues[11], "api");
      assert.equal(insertValues[12], null);
      assert.equal(insertValues[13], "api");
      assert.equal(insertValues[14], null);
      assert.match(insertValues[15], /^[0-9a-f-]{36}$/i);
      assert.equal(result.version.versionNumber, currentVersionNumber + 1);
      assert.equal(result.version.claimId, claimId);
      assert.equal(result.version.status, "draft");
      assert.equal(result.version.publicationStatus, "unpublished");
      assert.equal(result.version.changeReason, "Evidence was clarified");
    });
  }
});

test("claim version service rejects stale writes before insert and rolls back", async () => {
  const {
    ClaimVersionConflictError,
    createClaimVersion,
  } = require("../dist/services/claimVersionService");
  const harness = createDatabaseHarness({ currentVersionNumber: 4 });

  await assert.rejects(
    createClaimVersion(serviceInput(3), harness.pool),
    (error) => {
      assert.equal(error instanceof ClaimVersionConflictError, true);
      assert.equal(error.currentVersionNumber, 4);
      return true;
    },
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim version service reports missing claim and rolls back", async () => {
  const {
    ClaimNotFoundError,
    createClaimVersion,
  } = require("../dist/services/claimVersionService");
  const harness = createDatabaseHarness({ claimExists: false });

  await assert.rejects(
    createClaimVersion(serviceInput(1), harness.pool),
    ClaimNotFoundError,
  );

  assert.deepEqual(stagesOf(harness), ["BEGIN", "LOCK CLAIM", "ROLLBACK"]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim version service does not roll back when BEGIN fails", async () => {
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const beginError = new Error("begin failed");
  const harness = createDatabaseHarness({ failures: { BEGIN: beginError } });

  await assert.rejects(createClaimVersion(serviceInput(1), harness.pool), beginError);

  assert.deepEqual(stagesOf(harness), ["BEGIN"]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim version service rolls back when the claim lock query fails", async () => {
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const lockError = new Error("claim lock failed");
  const harness = createDatabaseHarness({
    failures: { "LOCK CLAIM": lockError },
  });

  await assert.rejects(createClaimVersion(serviceInput(1), harness.pool), lockError);

  assert.deepEqual(stagesOf(harness), ["BEGIN", "LOCK CLAIM", "ROLLBACK"]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim version service rolls back when reading the current version fails", async () => {
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const readError = new Error("current version read failed");
  const harness = createDatabaseHarness({
    failures: { "SELECT CURRENT VERSION": readError },
  });

  await assert.rejects(createClaimVersion(serviceInput(1), harness.pool), readError);

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim version service rejects an existing claim without a version", async () => {
  const {
    ClaimVersionInvariantError,
    createClaimVersion,
  } = require("../dist/services/claimVersionService");
  const harness = createDatabaseHarness({ currentVersionExists: false });

  await assert.rejects(
    createClaimVersion(serviceInput(1), harness.pool),
    ClaimVersionInvariantError,
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim version service rolls back when append-only insert fails", async () => {
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const insertError = new Error("version insert failed");
  const harness = createDatabaseHarness({
    failures: { "INSERT CLAIM VERSION": insertError },
  });

  await assert.rejects(
    createClaimVersion(serviceInput(1), harness.pool),
    insertError,
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "INSERT CLAIM VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim version service rolls back when the insert returns no row", async () => {
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const harness = createDatabaseHarness({ emptyInsertResult: true });

  await assert.rejects(
    createClaimVersion(serviceInput(1), harness.pool),
    /Claim version insert returned no row/,
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "INSERT CLAIM VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim version service rolls back when COMMIT fails", async () => {
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const commitError = new Error("commit failed");
  const harness = createDatabaseHarness({ failures: { COMMIT: commitError } });

  await assert.rejects(createClaimVersion(serviceInput(1), harness.pool), commitError);

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "INSERT CLAIM VERSION",
    "COMMIT",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("unique version conflict is refreshed after rollback instead of reporting stale state", async () => {
  const {
    ClaimVersionConflictError,
    createClaimVersion,
  } = require("../dist/services/claimVersionService");
  const uniqueError = Object.assign(new Error("duplicate version"), {
    code: "23505",
    constraint: "uq_claim_versions_claimid_version",
  });
  const harness = createDatabaseHarness({
    currentVersionNumber: 3,
    refreshedVersionNumber: 4,
    failures: { "INSERT CLAIM VERSION": uniqueError },
  });

  await assert.rejects(
    createClaimVersion(serviceInput(3), harness.pool),
    (error) => {
      assert.equal(error instanceof ClaimVersionConflictError, true);
      assert.equal(error.currentVersionNumber, 4);
      return true;
    },
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "INSERT CLAIM VERSION",
    "ROLLBACK",
    "REFRESH CURRENT VERSION",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("unique version conflict omits the version and destroys the client when refresh fails", async () => {
  const {
    ClaimVersionConflictError,
    createClaimVersion,
  } = require("../dist/services/claimVersionService");
  const uniqueError = Object.assign(new Error("duplicate version"), {
    code: "23505",
    constraint: "uq_claim_versions_claimid_version",
  });
  const refreshError = new Error("refresh failed");
  const harness = createDatabaseHarness({
    currentVersionNumber: 3,
    failures: {
      "INSERT CLAIM VERSION": uniqueError,
      "REFRESH CURRENT VERSION": refreshError,
    },
  });

  await assert.rejects(
    createClaimVersion(serviceInput(3), harness.pool),
    (error) => {
      assert.equal(error instanceof ClaimVersionConflictError, true);
      assert.equal(error.currentVersionNumber, undefined);
      return true;
    },
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "INSERT CLAIM VERSION",
    "ROLLBACK",
    "REFRESH CURRENT VERSION",
  ]);
  assert.deepEqual(harness.releases, [[true]]);
});

test("claim version service destroys the client when rollback fails", async () => {
  const { createClaimVersion } = require("../dist/services/claimVersionService");
  const insertError = new Error("version insert failed");
  const rollbackError = new Error("rollback failed");
  const harness = createDatabaseHarness({
    failures: {
      "INSERT CLAIM VERSION": insertError,
      ROLLBACK: rollbackError,
    },
  });

  await assert.rejects(
    createClaimVersion(serviceInput(1), harness.pool),
    (error) => {
      assert.equal(error.originalError, insertError);
      assert.equal(error.rollbackError, rollbackError);
      return true;
    },
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "LOCK CLAIM",
    "SELECT CURRENT VERSION",
    "INSERT CLAIM VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[true]]);
});
