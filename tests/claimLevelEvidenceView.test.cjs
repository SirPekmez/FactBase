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

// Narrow type probes only. Fixtures follow the base commit's seedUpstream,
// makeEvidence and makeEnvelope forms; existing HEAD fixtures are untouched.
function narrowTypeHarness(edit = null, valid = {}) {
  const { buildEvidenceFragmentCanonical, buildClaimEvidenceMatchCanonical, buildEvidenceAssessmentCanonical, buildSemanticAnalysisEnvelopeCanonical } = require("../dist/services/rcv022Canonical");
  const { canonicalizeRcv020Capture } = require("../dist/services/rcv020SemanticCore");
  const id = n => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const hash = text => require("node:crypto").createHash("sha256").update(text).digest("hex");
  const selected = (field, fallback) => Object.hasOwn(valid, field) ? valid[field] : fallback;
  const claimId = id(1), versionId = CLAIM_VERSION_ID;
  const claim = buildClaimIdentityCanonical({ claimId });
  const versionInput = { claimId, claimVersionId: versionId, versionNumber: selected("version_number", 1), title: "Golden claim", normalizedStatement: "A persisted authenticated claim", language: "en", claimType: "fact" };
  const version = buildClaimVersionCanonical(versionInput);
  const captureInput = {
    captureId: id(3), logicalSourceId: id(13), monitorId: id(23), monitorConfigurationVersionId: id(33), occurrenceId: id(43), retrievalAttemptId: id(53),
    requestHash: "c".repeat(64), requestedTarget: "https://example.test/0", finalUrl: selected("final_url", "https://example.test/0"), redirectCanonical: selected("redirect_canonical", null),
    responseStatus: selected("response_status", 200), responseMetadataCanonical: "{}", mediaType: "text/plain", byteLength: "5", observedAt: "2026-01-01T00:00:00.000000Z", contentHash: "b".repeat(64),
    retentionPolicy: "METADATA_HASH_ONLY", retentionPolicyVersion: selected("retention_policy_version", 1), rawObjectIdentity: selected("raw_object_identity", null), rawObjectReference: selected("raw_object_reference", null),
  };
  const capture = canonicalizeRcv020Capture(captureInput);
  const fragmentInput = { fragmentId: id(100), captureId: captureInput.captureId, captureCanonicalVersion: "RCV020-CANONICAL-V1", captureCanonicalHash: capture.hash, captureRepresentationHash: captureInput.contentHash, fragmentKind: "TEXT", locator: { kind: "WHOLE_TEXT" }, contentBinding: { kind: "TEXT", utf8Text: "evidence-0", contentHash: hash("evidence-0") }, extractionAuthority: { kind: "DIRECT" } };
  const fragment = buildEvidenceFragmentCanonical(fragmentInput);
  const matchInput = { matchId: id(200), claimId, claimCanonicalVersion: 1, claimCanonicalHash: claim.hash, claimVersionId: versionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: version.hash, evidenceFragmentId: fragmentInput.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragment.hash, matcherIdentity: "golden-matcher", matcherVersion: "1", matcherHash: "e".repeat(64), matcherInputCanonicalHashes: [] };
  const match = buildClaimEvidenceMatchCanonical(matchInput);
  const assessmentInput = { assessmentId: id(300), claimEvidenceMatchId: matchInput.matchId, claimEvidenceMatchCanonicalVersion: 1, claimEvidenceMatchCanonicalHash: match.hash, claimId, claimCanonicalVersion: 1, claimCanonicalHash: claim.hash, claimVersionId: versionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: version.hash, evidenceFragmentId: fragmentInput.fragmentId, evidenceFragmentCanonicalVersion: 1, evidenceFragmentCanonicalHash: fragment.hash, assessmentResult: { relation: "SUPPORTS", rationale: "golden rationale 0" }, methodProvenance: { methodType: "DETERMINISTIC", methodIdentity: "golden-method-0", methodVersion: "1", methodHash: "a".repeat(64), inputCanonicalHashes: [], structuredOutputHash: "b".repeat(64), reviewStatus: "NOT_REVIEWED" }, assessedAt: "2026-01-01T00:00:00.123456Z" };
  const assessment = buildEvidenceAssessmentCanonical(assessmentInput);
  const envelopeInput = { envelopeId: ENVELOPE_A, claimId, claimCanonicalVersion: 1, claimCanonicalHash: claim.hash, claimVersionId: versionId, claimVersionCanonicalVersion: 1, claimVersionCanonicalHash: version.hash, analysisCutoffAt: "2026-01-01T00:00:00.000001Z", analysisAt: "2026-01-01T00:00:01.000000Z", matchRefs: [{ id: matchInput.matchId, canonicalVersion: 1, canonicalHash: match.hash }], assessmentRefs: [{ id: assessmentInput.assessmentId, canonicalVersion: 1, canonicalHash: assessment.hash }], analysisMethodIdentity: "golden-analysis", analysisMethodVersion: "1", analysisMethodHash: "d".repeat(64) };
  const envelope = buildSemanticAnalysisEnvelopeCanonical(envelopeInput);
  // Projection only: values retain their original types; no conversion of query
  // responses occurs here or after the single-field injection below.
  const sqlFields = input => Object.fromEntries(Object.entries(input).map(([key, value]) => [key.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase()), value]));
  const authorityRow = (input, built) => ({ ...sqlFields(input), canonical_version: 1, canonical: built.canonical, canonical_hash: built.hash });
  const rows = {
    claim_version_authorities: authorityRow(versionInput, version),
    claim_identity_authorities: { claim_id: claimId, canonical_version: 1, canonical: claim.canonical, canonical_hash: claim.hash },
    rcv020_captures: { ...sqlFields(captureInput), canonical: capture.canonical, capture_hash: capture.hash },
    rcv022_evidence_fragments: authorityRow(fragmentInput, fragment),
    rcv022_claim_evidence_matches: authorityRow(matchInput, match),
    rcv022_evidence_assessments: authorityRow(assessmentInput, assessment),
    rcv022_semantic_analysis_envelopes: authorityRow(envelopeInput, envelope),
    rcv022_envelope_match_refs: { ordinal: 0, id: matchInput.matchId, canonical_version: 1, canonical_hash: match.hash },
    rcv022_envelope_assessment_refs: { ordinal: 0, id: assessmentInput.assessmentId, canonical_version: 1, canonical_hash: assessment.hash },
  };
  const ids = { claim_version_authorities: versionId, claim_identity_authorities: claimId, rcv020_captures: captureInput.captureId, rcv022_evidence_fragments: fragmentInput.fragmentId, rcv022_claim_evidence_matches: matchInput.matchId, rcv022_evidence_assessments: assessmentInput.assessmentId, rcv022_semantic_analysis_envelopes: ENVELOPE_A, rcv022_envelope_match_refs: ENVELOPE_A, rcv022_envelope_assessment_refs: ENVELOPE_A };
  const calls = [], deliveries = [];
  const client = {
    async query(sql, values = []) {
      calls.push(sql);
      if (["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      const table = sql.match(/FROM public\.([a-z_0-9]+)/)?.[1];
      assert.ok(Object.hasOwn(rows, table), `unexpected narrow query: ${sql}`);
      assert.deepEqual(values, [ids[table]]);
      const row = edit?.table === table ? { ...rows[table], [edit.field]: edit.value } : rows[table];
      if (edit?.table === table && edit.descriptor) Object.defineProperty(row, edit.field, edit.descriptor);
      deliveries.push({ table, row });
      return { rows: [row] };
    },
    release() { calls.push("RELEASE"); },
  };
  const spec = { claimVersionRef: { claimVersionId: versionId, canonicalVersion: 1, canonicalHash: version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.hash)], contractVersion: 1 };
  return { calls, deliveries, rows, run: () => getClaimLevelEvidenceView(spec, { connect: async () => client }) };
}

const narrowTypeFields = [
  { name: "version_number", table: "claim_version_authorities", field: "version_number", number: 1, minimum: 1, path: "claimVersion.version_number" },
  { name: "Capture response_status", table: "rcv020_captures", field: "response_status", number: 200, minimum: -2147483648, path: "capture.response_status" },
  { name: "Capture retention_policy_version", table: "rcv020_captures", field: "retention_policy_version", number: 1, minimum: 1, path: "capture.retention_policy_version" },
  { name: "Match Membership ordinal", table: "rcv022_envelope_match_refs", field: "ordinal", number: 0, minimum: 0, path: "matchRefs[0].ordinal" },
  { name: "Assessment Membership ordinal", table: "rcv022_envelope_assessment_refs", field: "ordinal", number: 0, minimum: 0, path: "assessmentRefs[0].ordinal" },
];

function assertNarrowRejectedCleanup(harness) {
  assert.equal(harness.calls.includes("COMMIT"), false);
  assert.equal(harness.calls.filter(sql => sql === "ROLLBACK").length, 1);
  assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
  assert.deepEqual(harness.calls.slice(-2), ["ROLLBACK", "RELEASE"]);
}

for (const entry of narrowTypeFields) {
  test(`narrow Claim-Level type ${entry.name}`, async t => {
    const control = narrowTypeHarness();
    const result = await control.run();
    assert.equal(result.envelopeManifest.length, 1);
    assert.equal(result.assessmentManifest.length, 1);
    assert.equal(result.occurrenceManifest.length, 1);
    assert.equal(result.occurrenceManifest[0].ordinal, 0);
    assert.equal(typeof control.rows[entry.table][entry.field], "number");
    assert.equal(control.calls.filter(sql => sql === "COMMIT").length, 1);
    assert.equal(control.calls.includes("ROLLBACK"), false);
    assert.equal(control.calls.filter(sql => sql === "RELEASE").length, 1);
    const bad = [
      ["coercive decimal text", String(entry.number)],
      ["coercive array", [entry.number]],
      ["coercive boxed number", new Number(entry.number)],
      ["coercive bigint", BigInt(entry.number)],
      ["null", null], ["undefined", undefined], ["plain object", {}],
      ["fraction", 0.5], ["NaN", NaN], ["Infinity", Infinity],
      ["below SQL domain", entry.minimum - 1], ["above int4", 2147483648],
    ];
    if (entry.number === 0 || entry.number === 1) bad.push(["coercive boolean", Boolean(entry.number)]);
    for (const [label, injected] of bad) {
      await t.test(label, async () => {
        const harness = narrowTypeHarness({ table: entry.table, field: entry.field, value: injected });
        let returned = false;
        await assert.rejects(async () => { const value = await harness.run(); returned = true; return value; }, error => {
          assert.equal(error.code, "MALFORMED_DATA");
          assert.equal(error.path, entry.path);
          assert.ok(error.message.endsWith(": expected PostgreSQL int4 number within field domain"));
          return true;
        });
        assert.equal(returned, false);
        const delivered = harness.deliveries.filter(item => item.table === entry.table);
        assert.equal(delivered.length, 1);
        assert.strictEqual(delivered[0].row[entry.field], injected);
        assertNarrowRejectedCleanup(harness);
      });
    }
  });
}

test("narrow Claim-Level evidenced SQL domains retain valid numeric boundary controls", async t => {
  for (const [field, values] of [["version_number", [1, 2147483647]], ["response_status", [-2147483648, 2147483647]], ["retention_policy_version", [1, 2147483647]]]) {
    for (const value of values) {
      await t.test(`${field}: ${value}`, async () => {
        const harness = narrowTypeHarness(null, { [field]: value });
        const result = await harness.run();
        assert.equal(result.assessmentManifest.length, 1);
        assert.equal(harness.calls.filter(sql => sql === "COMMIT").length, 1);
        assert.equal(harness.calls.includes("ROLLBACK"), false);
        assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
      });
    }
  }
});

test("narrow Claim-Level installed default int4 parser delivers numeric scalar fields without a connection", () => {
  const Result = require("pg/lib/result");
  const types = require("pg-types");
  assert.equal(types.builtins.INT4, 23);
  const result = new Result();
  result.addFields(["version_number", "response_status", "retention_policy_version", "ordinal"].map(name => ({ name, dataTypeID: types.builtins.INT4, format: "text" })));
  assert.deepEqual(result.parseRow(["1", "200", "1", "0"]), { version_number: 1, response_status: 200, retention_policy_version: 1, ordinal: 0 });
});


test("narrow Claim-Level ordinal is revalidated before occurrence conversion", async () => {
  let reads = 0;
  const getter = () => { reads += 1; return reads === 1 ? 0 : "0"; };
  const harness = narrowTypeHarness({ table: "rcv022_envelope_assessment_refs", field: "ordinal", descriptor: { configurable: true, enumerable: true, get: getter } });
  let returned = false;
  await assert.rejects(async () => { const value = await harness.run(); returned = true; return value; }, error => error.code === "MALFORMED_DATA" && error.path === "assessmentRefs.ordinal");
  assert.equal(returned, false);
  assert.equal(reads, 2);
  const delivered = harness.deliveries.filter(item => item.table === "rcv022_envelope_assessment_refs");
  assert.equal(delivered.length, 1);
  assert.strictEqual(Object.getOwnPropertyDescriptor(delivered[0].row, "ordinal").get, getter);
  assertNarrowRejectedCleanup(harness);
});


// Membership canonical versions must retain the authenticated numeric type.
for (const [label, table, prefix] of [
  ["Match", "rcv022_envelope_match_refs", "matchRefs"],
  ["Assessment", "rcv022_envelope_assessment_refs", "assessmentRefs"],
]) {
  test(`Membership canonical_version ${label}`, async t => {
    await t.test("numeric 1 control", async () => {
      const harness = narrowTypeHarness({ table, field: "canonical_version", value: 1 });
      const result = await harness.run();
      const deliveries = harness.deliveries.filter(item => item.table === table);
      assert.equal(deliveries.length, 1);
      assert.strictEqual(deliveries[0].row.canonical_version, 1);
      assert.equal(result.envelopeManifest.length, 1);
      assert.equal(result.assessmentManifest.length, 1);
      assert.equal(result.occurrenceManifest.length, 1);
      assert.equal(harness.calls.filter(sql => sql === "COMMIT").length, 1);
      assert.equal(harness.calls.includes("ROLLBACK"), false);
      assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
    });
    for (const [name, injected] of [
      ["text 1", "1"], ["bigint 1", 1n], ["boolean", true],
      ["boxed number", new Number(1)], ["array", [1]], ["object", {}],
      ["null", null], ["undefined", undefined],
      ["numeric 0", 0], ["numeric 2", 2], ["fraction", 1.5],
      ["NaN", NaN], ["Infinity", Infinity],
    ]) {
      await t.test(name, async () => {
        const harness = narrowTypeHarness({ table, field: "canonical_version", value: injected });
        let returned = false;
        await assert.rejects(async () => { const result = await harness.run(); returned = true; return result; }, error => {
          assert.equal(error.code, "UNSUPPORTED_VERSION");
          assert.equal(error.path, `${prefix}[0].canonicalVersion`);
          return true;
        });
        assert.equal(returned, false);
        const deliveries = harness.deliveries.filter(item => item.table === table);
        assert.equal(deliveries.length, 1);
        assert.strictEqual(deliveries[0].row.canonical_version, injected);
        assertNarrowRejectedCleanup(harness);
      });
    }
    await t.test("revalidated at authenticated member comparison", async () => {
      let reads = 0;
      const getter = () => { reads += 1; return reads === 1 ? 1 : "1"; };
      const harness = narrowTypeHarness({ table, field: "canonical_version", descriptor: { configurable: true, enumerable: true, get: getter } });
      let returned = false;
      await assert.rejects(async () => { const result = await harness.run(); returned = true; return result; }, error => {
        assert.equal(error.code, "UNSUPPORTED_VERSION");
        assert.equal(error.path, `${prefix}.${harness.rows[table].id}.canonicalVersion`);
        return true;
      });
      assert.equal(returned, false);
      assert.equal(reads, 2);
      const deliveries = harness.deliveries.filter(item => item.table === table);
      assert.equal(deliveries.length, 1);
      assert.strictEqual(Object.getOwnPropertyDescriptor(deliveries[0].row, "canonical_version").get, getter);
      assertNarrowRejectedCleanup(harness);
    });
  });
}


// ID/hash probes retain the raw Row at the existing query boundary.
function alternateMembershipAuthority(harness, label) {
  const { buildClaimEvidenceMatchCanonical, buildEvidenceAssessmentCanonical } = require("../dist/services/rcv022Canonical");
  const table = label === "Match" ? "rcv022_claim_evidence_matches" : "rcv022_evidence_assessments";
  const { schema, ...input } = JSON.parse(harness.rows[table].canonical);
  const key = label === "Match" ? "matchId" : "assessmentId";
  input[key] = label === "Match" ? "85000000-0000-4000-8000-000000000200" : "85000000-0000-4000-8000-000000000300";
  const built = label === "Match" ? buildClaimEvidenceMatchCanonical(input) : buildEvidenceAssessmentCanonical(input);
  return { id: input[key], canonicalHash: built.hash };
}

function assertMembershipRawDelivery(harness, table, row = harness.rows[table]) {
  const delivered = harness.deliveries.filter(item => item.table === table);
  assert.equal(delivered.length, 1);
  assert.strictEqual(delivered[0].row, row);
}

async function rejectMembershipIdentity(harness, path, code = "MALFORMED_DATA") {
  let returned = false;
  await assert.rejects(async () => { const result = await harness.run(); returned = true; return result; }, error => {
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    return true;
  });
  assert.equal(returned, false);
  assertNarrowRejectedCleanup(harness);
}

function assertMembershipIdentityControl(harness, result) {
  assert.equal(result.envelopeManifest.length, 1);
  assert.equal(result.assessmentManifest.length, 1);
  assert.equal(result.occurrenceManifest.length, 1);
  assert.equal(result.assessmentManifest[0].assessmentRef.assessmentId, harness.rows.rcv022_evidence_assessments.assessment_id);
  assert.equal(result.assessmentManifest[0].claimEvidenceMatchRef.matchId, harness.rows.rcv022_claim_evidence_matches.match_id);
  assert.equal(harness.calls.filter(sql => sql === "COMMIT").length, 1);
  assert.equal(harness.calls.includes("ROLLBACK"), false);
  assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
}

for (const [label, table, prefix] of [
  ["Match", "rcv022_envelope_match_refs", "matchRefs"],
  ["Assessment", "rcv022_envelope_assessment_refs", "assessmentRefs"],
]) {
  test(`Membership ID/hash ${label}`, async t => {
    await t.test("stable own data control", async () => {
      const harness = narrowTypeHarness();
      const result = await harness.run();
      assertMembershipRawDelivery(harness, table);
      assertMembershipIdentityControl(harness, result);
    });
    await t.test("function hash with valid toString is rejected without coercion", async () => {
      const harness = narrowTypeHarness();
      const expectedHash = harness.rows[table].canonical_hash;
      let conversions = 0;
      const injected = function hashValue() {};
      injected.toString = () => { conversions += 1; return expectedHash; };
      harness.rows[table].canonical_hash = injected;
      await rejectMembershipIdentity(harness, `${prefix}[0].canonicalHash`);
      assertMembershipRawDelivery(harness, table);
      assert.strictEqual(harness.rows[table].canonical_hash, injected);
      assert.equal(conversions, 0);
    });
    const template = narrowTypeHarness().rows[table];
    for (const [field, path, cases] of [
      ["id", "id", [["number", 1], ["null", null], ["undefined", undefined], ["array", [template.id]], ["boxed text", new String(template.id)], ["bad format", "not-a-uuid"], ["uppercase UUID", "A" + template.id.slice(1)]]],
      ["canonical_hash", "canonicalHash", [["number", 1], ["null", null], ["undefined", undefined], ["array", [template.canonical_hash]], ["boxed text", new String(template.canonical_hash)], ["bad length", template.canonical_hash.slice(1)], ["uppercase hash", "A" + template.canonical_hash.slice(1)]]],
    ]) {
      for (const [name, injected] of cases) {
        await t.test(`${field}: ${name}`, async () => {
          const harness = narrowTypeHarness({ table, field, value: injected });
          await rejectMembershipIdentity(harness, `${prefix}[0].${path}`);
          const delivered = harness.deliveries.filter(item => item.table === table);
          assert.equal(delivered.length, 1);
          assert.strictEqual(delivered[0].row[field], injected);
        });
      }
    }
    await t.test("function ID with valid toString is rejected without coercion", async () => {
      const harness = narrowTypeHarness();
      const expectedId = harness.rows[table].id;
      let conversions = 0;
      const injected = function idValue() {};
      injected.toString = () => { conversions += 1; return expectedId; };
      harness.rows[table].id = injected;
      await rejectMembershipIdentity(harness, `${prefix}[0].id`);
      assertMembershipRawDelivery(harness, table);
      assert.equal(conversions, 0);
    });
    for (const field of ["id", "canonical_hash", "both"]) {
      await t.test(`switching authority getter: ${field}`, async () => {
        const harness = narrowTypeHarness();
        const row = harness.rows[table];
        const original = { id: row.id, canonical_hash: row.canonical_hash };
        const alternate = alternateMembershipAuthority(harness, label);
        const next = { id: alternate.id, canonical_hash: alternate.canonicalHash };
        assert.notEqual(original.id, next.id);
        assert.notEqual(original.canonical_hash, next.canonical_hash);
        const reads = { id: 0, canonical_hash: 0 };
        const getters = {};
        for (const key of field === "both" ? ["id", "canonical_hash"] : [field]) {
          getters[key] = () => { reads[key] += 1; return reads[key] === 1 ? original[key] : next[key]; };
          Object.defineProperty(row, key, { enumerable: true, configurable: true, get: getters[key] });
        }
        await rejectMembershipIdentity(harness, `${prefix}[0].${field === "canonical_hash" ? "canonicalHash" : "id"}`);
        assertMembershipRawDelivery(harness, table, row);
        assert.deepEqual(reads, { id: 0, canonical_hash: 0 });
        for (const [key, getter] of Object.entries(getters)) assert.strictEqual(Object.getOwnPropertyDescriptor(row, key).get, getter);
      });
    }
    for (const field of ["id", "canonical_hash"]) {
      await t.test(`checked descriptor values only: ${field}`, async () => {
        const harness = narrowTypeHarness();
        const target = harness.rows[table];
        const descriptors = { id: 0, canonical_hash: 0 };
        let rawReads = 0;
        const forbidden = new Error(`FORBIDDEN_RAW_MEMBERSHIP_READ:${label}:${field}`);
        const row = new Proxy(target, {
          getOwnPropertyDescriptor(object, key) {
            if (key === "id" || key === "canonical_hash") descriptors[key] += 1;
            return Reflect.getOwnPropertyDescriptor(object, key);
          },
          get(object, key, receiver) {
            if (key === field) { rawReads += 1; throw forbidden; }
            return Reflect.get(object, key, receiver);
          },
        });
        harness.rows[table] = row;
        const result = await harness.run();
        assertMembershipRawDelivery(harness, table, row);
        assert.deepEqual(descriptors, { id: 1, canonical_hash: 1 });
        assert.equal(rawReads, 0);
        assertMembershipIdentityControl(harness, result);
      });
    }
  });
}


const nullableCaptureFields = ["final_url", "redirect_canonical", "raw_object_identity", "raw_object_reference"];
function nullableCaptureHarness() {
  return narrowTypeHarness(null, Object.fromEntries(nullableCaptureFields.map(key => [key, null])));
}

test("Capture nullable projection presence", async t => {
  await t.test("present authenticated null control", async () => {
    const harness = nullableCaptureHarness();
    const row = harness.rows.rcv020_captures;
    const canonical = JSON.parse(row.canonical);
    for (const [key, canonicalKey] of [["final_url", "finalUrl"], ["redirect_canonical", "redirectCanonical"], ["raw_object_identity", "rawObjectIdentity"], ["raw_object_reference", "rawObjectReference"]]) {
      assert.equal(Object.hasOwn(row, key), true);
      assert.strictEqual(row[key], null);
      assert.strictEqual(canonical[canonicalKey], null);
    }
    const result = await harness.run();
    assertMembershipRawDelivery(harness, "rcv020_captures", row);
    assertMembershipIdentityControl(harness, result);
  });
  await t.test("present text control retains existing acceptance", async () => {
    const values = { final_url: "https://example.test/0", redirect_canonical: "[]", raw_object_identity: "unit-object-identity", raw_object_reference: "unit-object-reference" };
    const harness = narrowTypeHarness(null, values);
    const row = harness.rows.rcv020_captures;
    for (const [key, value] of Object.entries(values)) { assert.equal(Object.hasOwn(row, key), true); assert.strictEqual(row[key], value); }
    const result = await harness.run();
    assertMembershipRawDelivery(harness, "rcv020_captures", row);
    assertMembershipIdentityControl(harness, result);
  });
  for (const field of nullableCaptureFields) {
    for (const mode of ["missing", "undefined"]) {
      await t.test(`${field}: ${mode}`, async () => {
        const harness = nullableCaptureHarness();
        const row = harness.rows.rcv020_captures;
        const original = { ...row };
        const canonicalKey = { final_url: "finalUrl", redirect_canonical: "redirectCanonical", raw_object_identity: "rawObjectIdentity", raw_object_reference: "rawObjectReference" }[field];
        assert.strictEqual(JSON.parse(row.canonical)[canonicalKey], null);
        if (mode === "missing") delete row[field]; else row[field] = undefined;
        assert.equal(Object.hasOwn(row, field), mode === "undefined");
        assert.strictEqual(row[field], undefined);
        assert.deepEqual(Object.keys(original).filter(key => !Object.hasOwn(row, key) || !Object.is(row[key], original[key])), [field]);
        await rejectMembershipIdentity(harness, `capture.${field}`);
        assertMembershipRawDelivery(harness, "rcv020_captures", row);
        assert.strictEqual(row.canonical, original.canonical);
        assert.strictEqual(row.capture_hash, original.capture_hash);
        for (const key of nullableCaptureFields.filter(key => key !== field)) { assert.equal(Object.hasOwn(row, key), true); assert.strictEqual(row[key], null); }
      });
    }
  }
});
