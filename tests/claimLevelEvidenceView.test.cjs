const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Pool } = require("pg");

const {
  ClaimLevelEvidenceViewInputError,
  getClaimLevelEvidenceView,
  prepareClaimLevelEvidenceViewSpec,
} = require("../dist/services/claimLevelEvidenceView");
const { buildClaimIdentityCanonical, buildClaimVersionCanonical } = require("../dist/services/claimHistoricalAuthorityCanonical");

const CLAIM_VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ENVELOPE_A = "22222222-2222-4222-8222-222222222222";
const ENVELOPE_B = "33333333-3333-4333-8333-333333333333";
const ENVELOPE_C = "44444444-4444-4444-8444-444444444444";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function ref(envelopeId, canonicalHash = HASH_A) {
  return { envelopeId, canonicalVersion: 1, canonicalHash };
}

function spec(envelopeManifest = [ref(ENVELOPE_A)]) {
  return {
    claimVersionRef: {
      claimVersionId: CLAIM_VERSION_ID,
      canonicalVersion: 1,
      canonicalHash: HASH_C,
    },
    envelopeManifest,
    contractVersion: 1,
  };
}

function assertStructuralFailure(input, code) {
  assert.throws(
    () => prepareClaimLevelEvidenceViewSpec(input),
    (error) => {
      assert.ok(error instanceof ClaimLevelEvidenceViewInputError);
      assert.equal(error.code, code);
      return true;
    },
  );
}

function assertNoDatabaseReads(action) {
  let reads = 0;
  const originalQuery = Pool.prototype.query;
  Pool.prototype.query = function blockedQuery() {
    reads += 1;
    throw new Error("Wave A structural validation must not query PostgreSQL");
  };
  try {
    action();
  } finally {
    Pool.prototype.query = originalQuery;
  }
  assert.equal(reads, 0);
}

test("valid one- and multi-Envelope specs are structurally prepared", () => {
  const one = prepareClaimLevelEvidenceViewSpec(spec());
  const many = prepareClaimLevelEvidenceViewSpec(
    spec([ref(ENVELOPE_C, HASH_C), ref(ENVELOPE_A), ref(ENVELOPE_B, HASH_B)]),
  );
  assert.equal(one.envelopeManifest.length, 1);
  assert.equal(many.envelopeManifest.length, 3);
  assert.deepEqual(
    many.envelopeManifest.map(({ envelopeId }) => envelopeId),
    [ENVELOPE_A, ENVELOPE_B, ENVELOPE_C],
  );
});

test("empty EnvelopeManifest is accepted structurally without claiming history", () => {
  const prepared = prepareClaimLevelEvidenceViewSpec(spec([]));
  assert.deepEqual(prepared.envelopeManifest, []);
  assert.equal(prepared.contractVersion, 1);
});

test("caller order canonicalizes identically and does not mutate input", () => {
  const first = spec([ref(ENVELOPE_B, HASH_B), ref(ENVELOPE_A), ref(ENVELOPE_C, HASH_C)]);
  const second = spec([ref(ENVELOPE_C, HASH_C), ref(ENVELOPE_B, HASH_B), ref(ENVELOPE_A)]);
  const firstBefore = structuredClone(first);
  const secondBefore = structuredClone(second);
  const preparedFirst = prepareClaimLevelEvidenceViewSpec(first);
  const preparedSecond = prepareClaimLevelEvidenceViewSpec(second);
  assert.deepEqual(preparedFirst, preparedSecond);
  assert.deepEqual(first, firstBefore);
  assert.deepEqual(second, secondBefore);
});

test("malformed structural inputs fail before any database read", () => {
  const invalidInputs = [
    [null, "MALFORMED_VIEW_SPEC"],
    [42, "MALFORMED_VIEW_SPEC"],
    [{ ...spec(), claimVersionRef: undefined }, "MALFORMED_VIEW_SPEC"],
    [
      { ...spec(), claimVersionRef: { canonicalVersion: 1, canonicalHash: HASH_C } },
      "MALFORMED_VIEW_SPEC",
    ],
    [
      { ...spec(), claimVersionRef: { claimVersionId: "not-a-uuid", canonicalVersion: 1, canonicalHash: HASH_C } },
      "MALFORMED_VIEW_SPEC",
    ],
    [
      { ...spec(), claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 2, canonicalHash: HASH_C } },
      "MALFORMED_VIEW_SPEC",
    ],
    [
      { ...spec(), claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: HASH_A.toUpperCase() } },
      "MALFORMED_VIEW_SPEC",
    ],
    [{ ...spec(), envelopeManifest: {} }, "MALFORMED_VIEW_SPEC"],
    [{ ...spec(), envelopeManifest: [{ envelopeId: ENVELOPE_A, canonicalVersion: 1 }] }, "MALFORMED_VIEW_SPEC"],
    [{ ...spec(), envelopeManifest: [{ envelopeId: "not-a-uuid", canonicalVersion: 1, canonicalHash: HASH_A }] }, "MALFORMED_VIEW_SPEC"],
    [{ ...spec(), envelopeManifest: [{ envelopeId: ENVELOPE_A, canonicalVersion: 2, canonicalHash: HASH_A }] }, "MALFORMED_VIEW_SPEC"],
    [{ ...spec(), contractVersion: 2 }, "UNSUPPORTED_CONTRACT_VERSION"],
  ];
  for (const [input, code] of invalidInputs) {
    assertNoDatabaseReads(() => assertStructuralFailure(input, code));
  }
});

test("duplicate and conflicting EnvelopeRefs fail without deduplication", () => {
  const exact = spec([ref(ENVELOPE_A), ref(ENVELOPE_A)]);
  const conflictingHash = spec([ref(ENVELOPE_A, HASH_A), ref(ENVELOPE_A, HASH_B)]);
  for (const input of [exact, conflictingHash]) {
    assertNoDatabaseReads(() => assertStructuralFailure(input, "DUPLICATE_ENVELOPE_REF"));
  }
});

test("mixed structural failures select the same failure across manifest permutations", () => {
  const duplicate = ref(ENVELOPE_A);
  const malformed = { envelopeId: "not-a-uuid", canonicalVersion: 1, canonicalHash: HASH_A };
  const permutations = [
    [duplicate, duplicate, malformed],
    [malformed, duplicate, duplicate],
    [duplicate, malformed, duplicate],
  ];
  for (const manifest of permutations) {
    assertNoDatabaseReads(() =>
      assertStructuralFailure(spec(manifest), "DUPLICATE_ENVELOPE_REF"),
    );
  }
});

test("conflicting identity plus malformed reference is permutation-invariant", () => {
  const first = ref(ENVELOPE_A, HASH_A);
  const conflicting = ref(ENVELOPE_A, HASH_B);
  const malformed = { envelopeId: "not-a-uuid", canonicalVersion: 1, canonicalHash: HASH_C };
  const permutations = [
    [first, conflicting, malformed],
    [malformed, first, conflicting],
    [first, malformed, conflicting],
  ];
  for (const manifest of permutations) {
    assertNoDatabaseReads(() =>
      assertStructuralFailure(spec(manifest), "DUPLICATE_ENVELOPE_REF"),
    );
  }
});

test("Wave A has no database or dynamic Envelope discovery path", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "services", "claimLevelEvidenceView.ts"),
    "utf8",
  );
  const waveASource = source.slice(
    source.indexOf("const CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION"),
    source.indexOf("export type ClaimLevelEvidenceViewVerificationCode"),
  );
  const executableSource = waveASource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(executableSource, /Pool|client|query|\bSELECT\s|\bFROM\s+public|database/i);
  assert.doesNotMatch(executableSource, /latest|cutoff|trusted|approved|scheduler|current/i);
  assert.doesNotMatch(executableSource, /rcv022Reader|rcv022Writer|AssessmentManifest|OccurrenceManifest/i);
});

test("Wave B authenticates an empty explicit scope before returning its real result", async () => {
  const claimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const versionId = CLAIM_VERSION_ID;
  const claim = buildClaimIdentityCanonical({ claimId });
  const version = buildClaimVersionCanonical({
    claimId,
    claimVersionId: versionId,
    versionNumber: 1,
    title: "Golden claim",
    normalizedStatement: "A historically authenticated claim",
    language: "en",
    claimType: "fact",
  });
  const queries = [];
  let released = false;
  const client = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.startsWith("BEGIN")) return { rows: [] };
      if (text.startsWith("COMMIT")) return { rows: [] };
      if (text.includes("FROM public.claim_version_authorities")) {
        return { rows: [{
          claim_version_id: versionId,
          claim_id: claimId,
          version_number: 1,
          title: "Golden claim",
          normalized_statement: "A historically authenticated claim",
          language: "en",
          claim_type: "fact",
          canonical_version: 1,
          canonical: version.canonical,
          canonical_hash: version.hash,
        }] };
      }
      if (text.includes("FROM public.claim_identity_authorities")) {
        return { rows: [{ claim_id: claimId, canonical_version: 1, canonical: claim.canonical, canonical_hash: claim.hash }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() { released = true; },
  };
  const result = await getClaimLevelEvidenceView({
    claimVersionRef: { claimVersionId: versionId, canonicalVersion: 1, canonicalHash: version.hash },
    envelopeManifest: [],
    contractVersion: 1,
  }, { connect: async () => client });
  assert.deepEqual(result.assessmentManifest, []);
  assert.deepEqual(result.occurrenceManifest, []);
  assert.deepEqual(result.envelopeProvenance, []);
  assert.deepEqual(result.scopeEnumeration, { scopeKind: "EXPLICIT_ENVELOPE_SET", status: "ENUMERATED_AND_CONSIDERED" });
  assert.equal(queries[0].text, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(queries.at(-1).text, "COMMIT");
  assert.equal(released, true);
});

test("Wave B rejects malformed scope before acquiring a pool client", async () => {
  let connects = 0;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ envelopeManifest: [], contractVersion: 1 }, { connect: async () => { connects += 1; throw new Error("must not connect"); } }),
    (error) => error instanceof ClaimLevelEvidenceViewInputError && error.code === "MALFORMED_VIEW_SPEC",
  );
  assert.equal(connects, 0);
});

test("Wave B production path is exact-ID SELECT-only and does not import RCV-022 semantic oracles", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "claimLevelEvidenceView.ts"), "utf8");
  assert.doesNotMatch(source, /rcv022Reader|rcv022Writer/);
  assert.doesNotMatch(source, /\b(?:UPDATE|INSERT|DELETE)\b/);
  assert.doesNotMatch(source, /SELECT\s+\*\s+FROM\s+public\.rcv022_(?:semantic_analysis_envelopes|evidence_assessments)/i);
  assert.doesNotMatch(source, /latest|trusted|approved|all\s+Envelopes|cutoff\s+selection|NOW\s*\(/i);
});

// Isolated HEAD probes: fixtures use only dependencies present in the base commit.
let isolatedHeadDatabaseAttempts = 0;
test.before(() => {
  const { Client } = require("pg");
  const blockDatabase = () => {
    isolatedHeadDatabaseAttempts += 1;
    process.exitCode = 1;
    throw new Error("isolated HEAD unit probes must not access PostgreSQL");
  };
  Pool.prototype.connect = blockDatabase;
  Pool.prototype.query = blockDatabase;
  Client.prototype.connect = blockDatabase;
  Client.prototype.query = blockDatabase;
});
test.after(t => {
  assert.equal(isolatedHeadDatabaseAttempts, 0);
  t.diagnostic("isolated HEAD PostgreSQL access attempts: 0");
});

function isolatedHeadMembershipHarness(injectedTable, injectedResponse) {
  const claimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const claim = buildClaimIdentityCanonical({ claimId });
  const versionInput = {
    claimId, claimVersionId: CLAIM_VERSION_ID, versionNumber: 1,
    title: "Golden claim", normalizedStatement: "A historically authenticated claim",
    language: "en", claimType: "fact",
  };
  const version = buildClaimVersionCanonical(versionInput);
  const envelopeInput = {
    envelopeId: ENVELOPE_A, claimId, claimCanonicalVersion: 1,
    claimCanonicalHash: claim.hash, claimVersionId: CLAIM_VERSION_ID,
    claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: version.hash,
    analysisCutoffAt: "2026-01-01T00:00:00.000001Z",
    analysisAt: "2026-01-01T00:00:01.000000Z",
    matchRefs: [], assessmentRefs: [], analysisMethodIdentity: "isolated-head-analysis",
    analysisMethodVersion: "1", analysisMethodHash: HASH_A,
  };
  const { buildSemanticAnalysisEnvelopeCanonical } = require("../dist/services/rcv022Canonical");
  const envelope = buildSemanticAnalysisEnvelopeCanonical(envelopeInput);
  const envelopeRow = {
    envelope_id: ENVELOPE_A, canonical_version: 1,
    canonical: envelope.canonical, canonical_hash: envelope.hash,
    claim_id: claimId, claim_canonical_version: 1, claim_canonical_hash: claim.hash,
    claim_version_id: CLAIM_VERSION_ID, claim_version_canonical_version: 1,
    claim_version_canonical_hash: version.hash,
    analysis_cutoff_at: envelopeInput.analysisCutoffAt, analysis_at: envelopeInput.analysisAt,
    match_refs: [], assessment_refs: [], analysis_method_identity: envelopeInput.analysisMethodIdentity,
    analysis_method_version: "1", analysis_method_hash: HASH_A,
  };
  const calls = [];
  const deliveries = [];
  const membershipTables = ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"];
  const client = {
    async query(sql, values = []) {
      calls.push(sql);
      if (sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM public.claim_version_authorities ")) return { rows: [{
        claim_version_id: CLAIM_VERSION_ID, claim_id: claimId, version_number: 1,
        title: versionInput.title, normalized_statement: versionInput.normalizedStatement,
        language: "en", claim_type: "fact", canonical_version: 1,
        canonical: version.canonical, canonical_hash: version.hash,
      }] };
      if (sql.includes("FROM public.claim_identity_authorities ")) return { rows: [{
        claim_id: claimId, canonical_version: 1, canonical: claim.canonical, canonical_hash: claim.hash,
      }] };
      if (sql.includes("FROM public.rcv022_semantic_analysis_envelopes ")) {
        assert.deepEqual(values, [ENVELOPE_A]);
        return { rows: [envelopeRow] };
      }
      const table = membershipTables.find(name => sql.includes(`FROM public.${name} `));
      if (table !== undefined) {
        assert.deepEqual(values, [ENVELOPE_A]);
        const response = table === injectedTable ? injectedResponse : { rows: [] };
        deliveries.push({ table, response });
        return response;
      }
      throw new Error(`unexpected isolated HEAD query: ${sql}`);
    },
    release() { calls.push("RELEASE"); },
  };
  const viewSpec = {
    claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: version.hash },
    envelopeManifest: [ref(ENVELOPE_A, envelope.hash)], contractVersion: 1,
  };
  return { calls, deliveries, run: () => getClaimLevelEvidenceView(viewSpec, { connect: async () => client }) };
}

test("isolated HEAD many guard accepts actual empty membership arrays", async () => {
  const harness = isolatedHeadMembershipHarness();
  const result = await harness.run();
  assert.equal(result.envelopeManifest.length, 1);
  assert.equal(result.envelopeManifest[0].envelopeId, ENVELOPE_A);
  assert.deepEqual(result.assessmentManifest, []);
  assert.deepEqual(result.occurrenceManifest, []);
  for (const table of ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"]) {
    const delivered = harness.deliveries.filter(entry => entry.table === table);
    assert.equal(delivered.length, 1);
    assert.deepEqual(delivered[0].response, { rows: [] });
  }
  assert.equal(harness.calls.filter(sql => sql === "COMMIT").length, 1);
  assert.equal(harness.calls.includes("ROLLBACK"), false);
  assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
  assert.deepEqual(harness.calls.slice(-2), ["COMMIT", "RELEASE"]);
});

test("isolated HEAD many guard rejects invalid query containers", async t => {
  for (const table of ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"]) {
    for (const label of ["missing rows", "array with own rows"]) {
      await t.test(`${table}: ${label}`, async () => {
        const response = label === "missing rows" ? {} : Object.assign([], { rows: [] });
        if (label === "missing rows") assert.equal(Object.hasOwn(response, "rows"), false);
        else {
          assert.equal(Array.isArray(response), true);
          assert.equal(Object.hasOwn(response, "rows"), true);
          assert.deepEqual(response.rows, []);
        }
        const harness = isolatedHeadMembershipHarness(table, response);
        let returned = false;
        await assert.rejects(async () => {
          const result = await harness.run();
          returned = true;
          return result;
        }, error => {
          assert.equal(error.constructor, Error);
          assert.equal(error.message, "Claim-Level membership query result must be an object with a rows array");
          return true;
        });
        assert.equal(returned, false);
        const delivered = harness.deliveries.filter(entry => entry.table === table);
        assert.equal(delivered.length, 1);
        assert.strictEqual(delivered[0].response, response);
        assert.equal(harness.calls.filter(sql => sql.includes(`FROM public.${table} `)).length, 1);
        assert.equal(harness.calls.includes("COMMIT"), false);
        assert.equal(harness.calls.filter(sql => sql === "ROLLBACK").length, 1);
        assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
        assert.deepEqual(harness.calls.slice(-2), ["ROLLBACK", "RELEASE"]);
      });
    }
  }
});
