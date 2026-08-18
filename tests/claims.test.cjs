const assert = require("node:assert/strict");
const test = require("node:test");

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

test("create claim controller returns 201 for valid domain input", async () => {
  const { buildCreateClaimController } = require("../dist/controllers/claimController");
  const expectedClaim = {
    id: "claim-id",
    version: {
      id: "version-id",
      claimId: "claim-id",
      versionNumber: 1,
      title: "A title",
      normalizedStatement: "A normalized statement",
      language: "en",
      claimType: "fact",
      status: "draft",
      publicationStatus: "unpublished",
      changeReason: "initial_creation",
      createdAt: new Date("2026-08-18T12:00:00.000Z"),
    },
  };
  let receivedInput;
  const handler = buildCreateClaimController(async (input) => {
    receivedInput = input;
    return expectedClaim;
  });
  const response = createResponse();

  await handler(
    {
      body: {
        title: "A title",
        normalizedStatement: "A normalized statement",
        language: "en",
        claimType: "fact",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, expectedClaim);
  assert.deepEqual(receivedInput, {
    title: "A title",
    normalizedStatement: "A normalized statement",
    language: "en",
    claimType: "fact",
  });
});

test("POST /api/claims is mounted and returns 201 through Express", async () => {
  const { buildApp } = require("../dist/app");
  const { buildCreateClaimController } = require("../dist/controllers/claimController");
  const { buildClaimsRouter } = require("../dist/routes/claims");
  const expectedClaim = {
    id: "mounted-claim-id",
    version: {
      id: "mounted-version-id",
      claimId: "mounted-claim-id",
      versionNumber: 1,
      title: "Mounted route title",
      normalizedStatement: "Mounted route statement",
      language: "en",
      claimType: "fact",
      status: "draft",
      publicationStatus: "unpublished",
      changeReason: "initial_creation",
      createdAt: new Date("2026-08-18T12:00:00.000Z"),
    },
  };
  const handler = buildCreateClaimController(async () => expectedClaim);
  const app = buildApp(buildClaimsRouter(handler));
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
        url: "/api/claims",
        headers: {},
        body: {
          title: "Mounted route title",
          normalizedStatement: "Mounted route statement",
          language: "en",
          claimType: "fact",
        },
      },
      response,
      (error) => reject(error ?? new Error("request was not handled")),
    );
  });

  await completed;

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, expectedClaim);
});

test("create claim controller rejects empty, invalid, and server-owned fields", async (t) => {
  const { buildCreateClaimController } = require("../dist/controllers/claimController");
  const invalidBodies = [
    undefined,
    {},
    {
      title: "",
      normalizedStatement: "statement",
      language: "en",
      claimType: "fact",
    },
    {
      title: "title",
      normalizedStatement: "   ",
      language: "en",
      claimType: "fact",
    },
    {
      title: "title",
      normalizedStatement: "statement",
      language: 42,
      claimType: "fact",
    },
    {
      title: "title",
      normalizedStatement: "statement",
      language: "en",
      claimType: "fact",
      status: "published",
    },
    {
      title: "title",
      normalizedStatement: "statement",
      language: "en",
      claimType: "fact",
      publicationStatus: "published",
    },
    {
      title: "title",
      normalizedStatement: "statement",
      language: "en",
      claimType: "fact",
      changeReason: "client_override",
    },
  ];

  for (const body of invalidBodies) {
    await t.test(`rejects ${JSON.stringify(body)}`, async () => {
      let operationCalled = false;
      const handler = buildCreateClaimController(async () => {
        operationCalled = true;
        throw new Error("must not be called");
      });
      const response = createResponse();

      await handler({ body }, response);

      assert.equal(response.statusCode, 400);
      assert.equal(operationCalled, false);
    });
  }
});

const createClaimInput = {
  title: "A title",
  normalizedStatement: "A normalized statement",
  language: "en",
  claimType: "fact",
};

function queryStage(text) {
  if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
    return text;
  }

  if (text.includes("INSERT INTO public.claim_versions")) {
    return "INSERT CLAIM VERSION";
  }

  if (text.includes("INSERT INTO public.claims")) {
    return "INSERT CLAIM";
  }

  throw new Error(`Unexpected query in test: ${text}`);
}

function createDatabaseHarness({ failures = {}, emptyVersionResult = false } = {}) {
  const calls = [];
  const releases = [];
  const databaseCreatedAt = new Date("2026-08-18T12:00:00.000Z");
  const client = {
    async query(text, values) {
      const stage = queryStage(text);
      calls.push({ stage, text, values });

      if (Object.prototype.hasOwnProperty.call(failures, stage)) {
        throw failures[stage];
      }

      if (stage === "INSERT CLAIM VERSION") {
        return {
          rows: emptyVersionResult
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
                  created_at: databaseCreatedAt,
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
    databaseCreatedAt,
    pool: { async connect() { return client; } },
    releases,
  };
}

function stagesOf(harness) {
  return harness.calls.map(({ stage }) => stage);
}

test("claim service creates claim and explicit version 1 in one transaction", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const harness = createDatabaseHarness();

  const result = await createClaimWithInitialVersion(createClaimInput, harness.pool);

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "INSERT CLAIM",
    "INSERT CLAIM VERSION",
    "COMMIT",
  ]);
  assert.deepEqual(harness.releases, [[]]);

  const claimId = harness.calls[1].values[0];
  const versionValues = harness.calls[2].values;
  assert.match(harness.calls[1].text, /VALUES \(\$1\)/);
  assert.match(harness.calls[2].text, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, CURRENT_TIMESTAMP\)/);
  assert.equal(versionValues[1], claimId);
  assert.equal(versionValues[2], 1);
  assert.equal(versionValues[7], "draft");
  assert.equal(versionValues[8], "unpublished");
  assert.equal(versionValues[9], "initial_creation");
  assert.equal(result.id, claimId);
  assert.equal(result.version.claimId, claimId);
  assert.equal(result.version.versionNumber, 1);
  assert.equal(result.version.status, "draft");
  assert.equal(result.version.publicationStatus, "unpublished");
  assert.equal(result.version.changeReason, "initial_creation");
  assert.equal(result.version.createdAt, harness.databaseCreatedAt);
});

test("claim service rolls back normally when version insert fails", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const versionError = new Error("version insert failed");
  const harness = createDatabaseHarness({
    failures: { "INSERT CLAIM VERSION": versionError },
  });

  await assert.rejects(
    createClaimWithInitialVersion(createClaimInput, harness.pool),
    versionError,
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "INSERT CLAIM",
    "INSERT CLAIM VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim service does not roll back when BEGIN itself fails", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const beginError = new Error("begin failed");
  const harness = createDatabaseHarness({ failures: { BEGIN: beginError } });

  await assert.rejects(
    createClaimWithInitialVersion(createClaimInput, harness.pool),
    beginError,
  );

  assert.deepEqual(stagesOf(harness), ["BEGIN"]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim service rolls back when claim insert fails", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const claimError = new Error("claim insert failed");
  const harness = createDatabaseHarness({
    failures: { "INSERT CLAIM": claimError },
  });

  await assert.rejects(
    createClaimWithInitialVersion(createClaimInput, harness.pool),
    claimError,
  );

  assert.deepEqual(stagesOf(harness), ["BEGIN", "INSERT CLAIM", "ROLLBACK"]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim service rolls back when version insert returns no row", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const harness = createDatabaseHarness({ emptyVersionResult: true });

  await assert.rejects(
    createClaimWithInitialVersion(createClaimInput, harness.pool),
    /Claim version insert returned no row/,
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "INSERT CLAIM",
    "INSERT CLAIM VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim service attempts rollback when COMMIT fails", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const commitError = new Error("commit failed");
  const harness = createDatabaseHarness({ failures: { COMMIT: commitError } });

  await assert.rejects(
    createClaimWithInitialVersion(createClaimInput, harness.pool),
    commitError,
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "INSERT CLAIM",
    "INSERT CLAIM VERSION",
    "COMMIT",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[]]);
});

test("claim service destroys client when rollback fails", async () => {
  const { createClaimWithInitialVersion } = require("../dist/services/claimService");
  const versionError = new Error("version insert failed");
  const rollbackError = new Error("rollback failed");
  const harness = createDatabaseHarness({
    failures: {
      "INSERT CLAIM VERSION": versionError,
      ROLLBACK: rollbackError,
    },
  });

  await assert.rejects(
    createClaimWithInitialVersion(createClaimInput, harness.pool),
    (error) => {
      assert.equal(
        error.message,
        "Claim creation failed and the transaction could not be rolled back",
      );
      assert.equal(error.originalError, versionError);
      assert.equal(error.rollbackError, rollbackError);
      return true;
    },
  );

  assert.deepEqual(stagesOf(harness), [
    "BEGIN",
    "INSERT CLAIM",
    "INSERT CLAIM VERSION",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.releases, [[true]]);
});
