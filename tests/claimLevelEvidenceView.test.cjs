const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Pool } = require("pg");
const { FailureTransportGroup, throwRetainedFailures } = require("../dist/services/failureTransport");
const { buildClaimEvidenceMatchCanonical, buildEvidenceAssessmentCanonical, buildEvidenceFragmentCanonical, buildSemanticAnalysisEnvelopeCanonical } = require("../dist/services/rcv022Canonical");
const { canonicalizeRcv020Capture } = require("../dist/services/rcv020SemanticCore");

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
const MATCH_ID = "55555555-5555-4555-8555-555555555555";
const FRAGMENT_ID = "66666666-6666-4666-8666-666666666666";
const CAPTURE_ID = "77777777-7777-4777-8777-777777777777";
const ASSESSMENT_ID = "88888888-8888-4888-8888-888888888888";
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
  const capture = historicalCaptureCanonical(captureInput);
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
          assert.equal(error.path, entry.path.startsWith("claimVersion.") ? entry.path : `envelope[0].${entry.path}`);
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
  await assert.rejects(async () => { const value = await harness.run(); returned = true; return value; }, error => error.code === "MALFORMED_DATA" && error.path === "envelope[0].assessmentRefs.ordinal");
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
          assert.equal(error.path, `envelope[0].${prefix}[0].canonicalVersion`);
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
        assert.equal(error.path, `envelope[0].${prefix}.${harness.rows[table].id}.canonicalVersion`);
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
  let observed;
  await assert.rejects(async () => { const result = await harness.run(); returned = true; return result; }, error => {
    observed = error;
    assert.equal(error.code, code);
    assert.equal(error.path, `envelope[0].${path}`);
    return true;
  });
  assert.equal(returned, false);
  assertNarrowRejectedCleanup(harness);
  return observed;
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
      await rejectMembershipIdentity(harness, `${prefix}[0].canonical_hash`);
      assertMembershipRawDelivery(harness, table);
      assert.strictEqual(harness.rows[table].canonical_hash, injected);
      assert.equal(conversions, 0);
    });
    const template = narrowTypeHarness().rows[table];
    for (const [field, path, cases] of [
      ["id", "id", [["number", 1], ["null", null], ["undefined", undefined], ["array", [template.id]], ["boxed text", new String(template.id)], ["bad format", "not-a-uuid"], ["uppercase UUID", "A" + template.id.slice(1)]]],
      ["canonical_hash", "canonical_hash", [["number", 1], ["null", null], ["undefined", undefined], ["array", [template.canonical_hash]], ["boxed text", new String(template.canonical_hash)], ["bad length", template.canonical_hash.slice(1)], ["uppercase hash", "A" + template.canonical_hash.slice(1)]]],
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
        const observed = await rejectMembershipIdentity(harness, `${prefix}[0].${field === "id" ? "id" : "canonical_hash"}`);
        if (field === "both") {
          const paths = ["id", "canonical_hash"].map(key => `envelope[0].${prefix}[0].${key}`);
          const candidates = observed.verificationFailures.filter(candidate => paths.includes(candidate.path));
          assert.deepEqual(candidates.map(candidate => candidate.path).sort(), [...paths].sort());
          for (const candidate of candidates) {
            assert.equal(candidate.code, "MALFORMED_DATA");
            assert.equal(candidate.originalError.code, "MALFORMED_DATA");
            assert.ok(candidate.message.endsWith(": expected own data property"));
          }
          assert.ok(candidates.includes(observed.selectedVerificationFailure));
          assert.equal(observed.selectedVerificationFailure.path, `envelope[0].${prefix}[0].canonical_hash`);
        }
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
      if (key === "raw_object_reference") assert.equal(Object.hasOwn(canonical, canonicalKey), false);
      else assert.strictEqual(canonical[canonicalKey], null);
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
        const canonical = JSON.parse(row.canonical);
        if (field === "raw_object_reference") assert.equal(Object.hasOwn(canonical, canonicalKey), false);
        else assert.strictEqual(canonical[canonicalKey], null);
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


function verificationTarget() {
  const claimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const version = buildClaimVersionCanonical({
    claimId,
    claimVersionId: CLAIM_VERSION_ID,
    versionNumber: 1,
    title: "Golden claim",
    normalizedStatement: "A historically authenticated claim",
    language: "en",
    claimType: "fact",
  });
  return {
    claimId,
    claim: buildClaimIdentityCanonical({ claimId }),
    version,
    versionRow: {
      claim_version_id: CLAIM_VERSION_ID,
      claim_id: claimId,
      version_number: 1,
      title: "Golden claim",
      normalized_statement: "A historically authenticated claim",
      language: "en",
      claim_type: "fact",
      canonical_version: 1,
      canonical: version.canonical,
      canonical_hash: version.hash,
    },
  };
}

function validEmptyEnvelope(target, envelopeId, claimCanonicalHash = target.claim.hash, overrides = {}) {
  const input = {
    envelopeId,
    claimId: target.claimId,
    claimCanonicalVersion: 1,
    claimCanonicalHash,
    claimVersionId: CLAIM_VERSION_ID,
    claimVersionCanonicalVersion: 1,
    claimVersionCanonicalHash: target.version.hash,
    analysisCutoffAt: "2026-01-01T00:00:00.000001Z",
    analysisAt: "2026-01-01T00:00:01.000000Z",
    matchRefs: [],
    assessmentRefs: [],
    analysisMethodIdentity: "failure-test-analysis",
    analysisMethodVersion: "1",
    analysisMethodHash: HASH_A,
    ...overrides,
  };
  const built = buildSemanticAnalysisEnvelopeCanonical(input);
  return {
    envelope_id: envelopeId,
    canonical_version: 1,
    canonical: built.canonical,
    canonical_hash: built.hash,
    claim_id: input.claimId,
    claim_canonical_version: input.claimCanonicalVersion,
    claim_canonical_hash: input.claimCanonicalHash,
    claim_version_id: input.claimVersionId,
    claim_version_canonical_version: input.claimVersionCanonicalVersion,
    claim_version_canonical_hash: input.claimVersionCanonicalHash,
    analysis_cutoff_at: input.analysisCutoffAt,
    analysis_at: input.analysisAt,
    match_refs: input.matchRefs,
    assessment_refs: input.assessmentRefs,
    analysis_method_identity: input.analysisMethodIdentity,
    analysis_method_version: input.analysisMethodVersion,
    analysis_method_hash: input.analysisMethodHash,
  };
}

function validMatch(target, overrides = {}) {
  const input = {
    matchId: MATCH_ID,
    claimId: target.claimId,
    claimCanonicalVersion: 1,
    claimCanonicalHash: target.claim.hash,
    claimVersionId: CLAIM_VERSION_ID,
    claimVersionCanonicalVersion: 1,
    claimVersionCanonicalHash: target.version.hash,
    evidenceFragmentId: FRAGMENT_ID,
    evidenceFragmentCanonicalVersion: 1,
    evidenceFragmentCanonicalHash: HASH_A,
    matcherIdentity: "failure-test-matcher",
    matcherVersion: "1",
    matcherHash: HASH_A,
    matcherInputCanonicalHashes: [],
    ...overrides,
  };
  const built = buildClaimEvidenceMatchCanonical(input);
  return {
    match_id: MATCH_ID,
    canonical_version: 1,
    canonical: built.canonical,
    canonical_hash: built.hash,
    claim_id: input.claimId,
    claim_canonical_version: input.claimCanonicalVersion,
    claim_canonical_hash: input.claimCanonicalHash,
    claim_version_id: input.claimVersionId,
    claim_version_canonical_version: input.claimVersionCanonicalVersion,
    claim_version_canonical_hash: input.claimVersionCanonicalHash,
    evidence_fragment_id: input.evidenceFragmentId,
    evidence_fragment_canonical_version: input.evidenceFragmentCanonicalVersion,
    evidence_fragment_canonical_hash: input.evidenceFragmentCanonicalHash,
    matcher_identity: input.matcherIdentity,
    matcher_version: input.matcherVersion,
    matcher_hash: input.matcherHash,
    matcher_input_canonical_hashes: input.matcherInputCanonicalHashes,
  };
}

function validAssessment(target, match, fixture, overrides = {}) {
  const input = {
    assessmentId: ASSESSMENT_ID,
    claimEvidenceMatchId: MATCH_ID,
    claimEvidenceMatchCanonicalVersion: 1,
    claimEvidenceMatchCanonicalHash: match.canonical_hash,
    claimId: target.claimId,
    claimCanonicalVersion: 1,
    claimCanonicalHash: target.claim.hash,
    claimVersionId: CLAIM_VERSION_ID,
    claimVersionCanonicalVersion: 1,
    claimVersionCanonicalHash: target.version.hash,
    evidenceFragmentId: FRAGMENT_ID,
    evidenceFragmentCanonicalVersion: 1,
    evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash,
    assessmentResult: { relation: "SUPPORTS", rationale: "assessment rationale" },
    methodProvenance: {
      methodType: "DETERMINISTIC",
      methodIdentity: "failure-test-assessment",
      methodVersion: "1",
      methodHash: HASH_A,
      inputCanonicalHashes: [],
      structuredOutputHash: HASH_B,
      reviewStatus: "NOT_REVIEWED",
    },
    assessedAt: "2026-01-01T00:00:02.000000Z",
    ...overrides,
  };
  const built = buildEvidenceAssessmentCanonical(input);
  return {
    assessment_id: ASSESSMENT_ID,
    canonical_version: 1,
    canonical: built.canonical,
    canonical_hash: built.hash,
    claim_evidence_match_id: input.claimEvidenceMatchId,
    claim_evidence_match_canonical_version: input.claimEvidenceMatchCanonicalVersion,
    claim_evidence_match_canonical_hash: input.claimEvidenceMatchCanonicalHash,
    claim_id: input.claimId,
    claim_canonical_version: input.claimCanonicalVersion,
    claim_canonical_hash: input.claimCanonicalHash,
    claim_version_id: input.claimVersionId,
    claim_version_canonical_version: input.claimVersionCanonicalVersion,
    claim_version_canonical_hash: input.claimVersionCanonicalHash,
    evidence_fragment_id: input.evidenceFragmentId,
    evidence_fragment_canonical_version: input.evidenceFragmentCanonicalVersion,
    evidence_fragment_canonical_hash: input.evidenceFragmentCanonicalHash,
    assessment_result: input.assessmentResult,
    method_provenance: input.methodProvenance,
    assessed_at: input.assessedAt,
  };
}

function captureRow(input, built) {
  return {
    capture_id: input.captureId,
    logical_source_id: input.logicalSourceId,
    monitor_id: input.monitorId,
    monitor_configuration_version_id: input.monitorConfigurationVersionId,
    occurrence_id: input.occurrenceId,
    retrieval_attempt_id: input.retrievalAttemptId,
    request_hash: input.requestHash,
    requested_target: input.requestedTarget,
    final_url: input.finalUrl,
    redirect_canonical: input.redirectCanonical,
    response_status: input.responseStatus,
    response_metadata_canonical: input.responseMetadataCanonical,
    media_type: input.mediaType,
    byte_length: input.byteLength,
    observed_at: input.observedAt,
    content_hash: input.contentHash,
    canonical: built.canonical,
    capture_hash: built.hash,
    retention_policy: input.retentionPolicy,
    retention_policy_version: input.retentionPolicyVersion,
    raw_object_identity: input.rawObjectIdentity,
    raw_object_reference: input.rawObjectReference,
  };
}

function historicalCaptureCanonical(input) {
  const { rawObjectReference, captureHash, captureCanonical, ...fields } = input;
  return require("../dist/services/rcv020Canonical").canonicalizeRcv020({ schema: "RCV020-CAPTURE-ENVELOPE-V1", ...fields, byteLength: String(input.byteLength) });
}

function fragmentCaptureFixture(writerCapture = null) {
  const captureInput = writerCapture?.input ?? {
    captureId: CAPTURE_ID,
    logicalSourceId: "88888888-8888-4888-8888-888888888888",
    monitorId: "99999999-9999-4999-8999-999999999999",
    monitorConfigurationVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    occurrenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    retrievalAttemptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    requestHash: HASH_A,
    requestedTarget: "https://example.test/capture",
    finalUrl: "https://example.test/capture",
    redirectCanonical: null,
    responseStatus: 200,
    responseMetadataCanonical: "{}",
    mediaType: "text/plain",
    byteLength: "5",
    observedAt: "2026-01-01T00:00:00.000000Z",
    contentHash: HASH_B,
    retentionPolicy: "METADATA_HASH_ONLY",
    retentionPolicyVersion: 1,
    rawObjectIdentity: null,
    rawObjectReference: null,
  };
  const captureBuilt = writerCapture ? { canonical: writerCapture.row.canonical, hash: writerCapture.row.capture_hash } : historicalCaptureCanonical(captureInput);
  const fragmentInput = {
    fragmentId: FRAGMENT_ID,
    captureId: captureInput.captureId,
    captureCanonicalVersion: "RCV020-CANONICAL-V1",
    captureCanonicalHash: captureBuilt.hash,
    captureRepresentationHash: captureInput.contentHash,
    fragmentKind: "TEXT",
    locator: { kind: "WHOLE_TEXT" },
    contentBinding: { kind: "TEXT", utf8Text: "fragment evidence", contentHash: require("node:crypto").createHash("sha256").update("fragment evidence", "utf8").digest("hex") },
    extractionAuthority: { kind: "DIRECT" },
  };
  const fragmentBuilt = buildEvidenceFragmentCanonical(fragmentInput);
  return {
    captureInput,
    captureBuilt,
    fragmentBuilt,
    fragmentRow: {
      fragment_id: FRAGMENT_ID,
      canonical_version: 1,
      canonical: fragmentBuilt.canonical,
      canonical_hash: fragmentBuilt.hash,
      capture_id: captureInput.captureId,
      capture_canonical_version: fragmentInput.captureCanonicalVersion,
      capture_canonical_hash: fragmentInput.captureCanonicalHash,
      capture_representation_hash: fragmentInput.captureRepresentationHash,
      fragment_kind: fragmentInput.fragmentKind,
      locator: fragmentInput.locator,
      content_binding: fragmentInput.contentBinding,
      extraction_authority: fragmentInput.extractionAuthority,
    },
    captureRow: writerCapture?.row ?? captureRow(captureInput, captureBuilt),
  };
}

function fragmentFailurePool(target, envelopeRows, matchRow, fragmentRow, captureRow, operationalCaptureError = false, assessmentRows = [], operationalAssessmentError = false) {
  return {
    async connect() {
      return {
        async query(text, values = []) {
          if (text.startsWith("BEGIN") || text.startsWith("COMMIT") || text.startsWith("ROLLBACK")) return { rows: [] };
          if (text.includes("FROM public.claim_version_authorities")) return { rows: [target.versionRow] };
          if (text.includes("FROM public.claim_identity_authorities")) return { rows: [{ claim_id: target.claimId, canonical_version: 1, canonical: target.claim.canonical, canonical_hash: target.claim.hash }] };
          if (text.includes("FROM public.rcv022_semantic_analysis_envelopes")) return { rows: [envelopeRows.get(values[0])] };
          if (text.includes("FROM public.rcv022_envelope_match_refs")) return { rows: [{ ordinal: 0, id: MATCH_ID, canonical_version: 1, canonical_hash: matchRow.canonical_hash }] };
          if (text.includes("FROM public.rcv022_envelope_assessment_refs")) {
            if (operationalAssessmentError) throw new Error("operational assessment query failure");
            return { rows: assessmentRows };
          }
          if (text.includes("FROM public.rcv022_evidence_assessments")) return { rows: [assessmentRows[0]?.authorityRow] };
          if (text.includes("FROM public.rcv022_claim_evidence_matches")) return { rows: [matchRow] };
          if (text.includes("FROM public.rcv022_evidence_fragments")) return { rows: [fragmentRow] };
          if (text.includes("FROM public.rcv020_captures")) {
            if (operationalCaptureError) throw new Error("operational capture query failure");
            return { rows: [captureRow] };
          }
          throw new Error(`unexpected query: ${text}`);
        },
        release() {},
      };
    },
  };
}

function matchFailurePool(target, envelopeRows, matchRow, operationalMatchError = false, fragmentRow = null, captureRow = null, matchRefsRows = null) {
  const fallbackFixture = fragmentCaptureFixture();
  const effectiveFragmentRow = fragmentRow ?? fallbackFixture.fragmentRow;
  const effectiveCaptureRow = captureRow ?? fallbackFixture.captureRow;
  return {
    async connect() {
      return {
        async query(text, values = []) {
          if (text.startsWith("BEGIN") || text.startsWith("COMMIT") || text.startsWith("ROLLBACK")) return { rows: [] };
          if (text.includes("FROM public.claim_version_authorities")) return { rows: [target.versionRow] };
          if (text.includes("FROM public.claim_identity_authorities")) return { rows: [{ claim_id: target.claimId, canonical_version: 1, canonical: target.claim.canonical, canonical_hash: target.claim.hash }] };
          if (text.includes("FROM public.rcv022_semantic_analysis_envelopes")) return { rows: [envelopeRows.get(values[0])] };
          if (text.includes("FROM public.rcv022_envelope_match_refs")) return { rows: matchRefsRows ?? [{ ordinal: 0, id: MATCH_ID, canonical_version: 1, canonical_hash: matchRow.canonical_hash }] };
          if (text.includes("FROM public.rcv022_envelope_assessment_refs")) return { rows: [] };
          if (text.includes("FROM public.rcv022_claim_evidence_matches")) {
            if (operationalMatchError) throw new Error("operational match query failure");
            return { rows: [matchRow] };
          }
          if (text.includes("FROM public.rcv022_evidence_fragments")) return { rows: [effectiveFragmentRow] };
          if (text.includes("FROM public.rcv020_captures")) return { rows: [effectiveCaptureRow] };
          throw new Error(`unexpected query: ${text}`);
        },
        release() {},
      };
    },
  };
}

function assertHistoricalFailure(error, code, path) {
  assert.equal(error.code, code);
  if (path !== undefined) assert.equal(error.path, path);
}

function failurePool(target, envelopeRows, reverseEnvelopeMap = false, membershipRows = {}) {
  const entries = [...envelopeRows.entries()];
  if (reverseEnvelopeMap) entries.reverse();
  const rows = new Map(entries);
  return {
    async connect() {
      return {
        async query(text, values = []) {
          if (text.startsWith("BEGIN") || text.startsWith("COMMIT") || text.startsWith("ROLLBACK")) return { rows: [] };
          if (text.includes("FROM public.claim_version_authorities")) return { rows: [target.versionRow] };
          if (text.includes("FROM public.claim_identity_authorities")) return { rows: [{ claim_id: target.claimId, canonical_version: 1, canonical: target.claim.canonical, canonical_hash: target.claim.hash }] };
          if (text.includes("FROM public.rcv022_semantic_analysis_envelopes")) return { rows: [rows.get(values[0])] };
          if (text.includes("FROM public.rcv022_envelope_match_refs")) return { rows: membershipRows.match ?? [] };
          if (text.includes("FROM public.rcv022_envelope_assessment_refs")) return { rows: membershipRows.assessment ?? [] };
          if (text.includes("FROM public.rcv022_claim_evidence_matches")) return { rows: [] };
          if (text.includes("FROM public.rcv022_evidence_assessments")) return { rows: [] };
          throw new Error(`unexpected query: ${text}`);
        },
        release() {},
      };
    },
  };
}

function claimVersionFailurePool(target, claimRow = { claim_id: target.claimId, canonical_version: 1, canonical: target.claim.canonical, canonical_hash: target.claim.hash }) {
  return {
    async connect() {
      return {
        async query(text) {
          if (text.startsWith("BEGIN") || text.startsWith("COMMIT") || text.startsWith("ROLLBACK")) return { rows: [] };
          if (text.includes("FROM public.claim_version_authorities")) return { rows: [target.versionRow] };
          if (text.includes("FROM public.claim_identity_authorities")) return { rows: [claimRow] };
          throw new Error(`unexpected query: ${text}`);
        },
        release() {},
      };
    },
  };
}

async function selectedHistoricalFailure(manifest, envelopeRows, reverseEnvelopeMap = false) {
  const target = verificationTarget();
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({
      claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash },
      envelopeManifest: manifest,
      contractVersion: 1,
    }, failurePool(target, envelopeRows, reverseEnvelopeMap)),
    (error) => { observed = error; return true; },
  );
  return { code: observed.code, path: observed.path };
}

function assessmentFragmentBindingGraph({ wrongHash = false, reverse = false, competing = null, writerCapture = null, faults = {} } = {}) {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture(writerCapture);
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  assert.notEqual(fixture.fragmentBuilt.hash, HASH_C);
  const assessment = validAssessment(target, match, fixture, {
    ...(wrongHash ? { evidenceFragmentCanonicalHash: HASH_C } : {}),
    ...(competing === "hash" ? { claimCanonicalHash: HASH_B } : {}),
  });
  const supportRows = [{ ordinal: 0, id: ASSESSMENT_ID, canonical_version: 1, canonical_hash: assessment.canonical_hash, authorityRow: assessment }];
  const envelopes = [ENVELOPE_A, ENVELOPE_B].map((id) => validEmptyEnvelope(target, id, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }],
  }));
  if (competing === "malformed") envelopes[1].canonical = "not-json";
  const input = {
    claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash },
    envelopeManifest: envelopes.map((row) => ref(row.envelope_id, row.canonical_hash)),
    contractVersion: 1,
  };
  // Reverse caller order, row construction, and Map insertion; the production
  // reader must still use canonical Envelope order and the same dependencies.
  const reverseKeys = (row) => Object.fromEntries(Object.entries(row).reverse());
  const envelopeRows = new Map((reverse ? [...envelopes].reverse() : envelopes).map((row) => [row.envelope_id, reverse ? reverseKeys(row) : row]));
  if (reverse) input.envelopeManifest.reverse();
  const rows = {
    target, fixture,
    match: reverse ? reverseKeys(match) : match,
    fragment: reverse ? reverseKeys(fixture.fragmentRow) : fixture.fragmentRow,
    capture: reverse ? reverseKeys(fixture.captureRow) : fixture.captureRow,
    assessment: reverse ? reverseKeys(assessment) : assessment,
    envelopes: [...envelopeRows.values()],
    supportRows: reverse ? supportRows.map((row) => reverseKeys({ ...row, authorityRow: reverseKeys(assessment) })) : supportRows,
    input,
  };
  const basePool = fragmentFailurePool(target, envelopeRows, rows.match,
    rows.fragment, rows.capture, false, rows.supportRows);
  const queries = [];
  let releases = 0;
  let commitCompleted = false; // Query fulfillment, not physical commit history.
  const allowedTables = new Set([
    "claim_version_authorities", "claim_identity_authorities",
    "rcv022_semantic_analysis_envelopes", "rcv022_envelope_match_refs",
    "rcv022_envelope_assessment_refs", "rcv022_evidence_assessments",
    "rcv022_claim_evidence_matches", "rcv022_evidence_fragments", "rcv020_captures",
  ]);
  const pool = {
    async connect() {
      const client = await basePool.connect();
      return {
        async query(sql, values) {
          queries.push(sql);
          if (!["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "COMMIT", "ROLLBACK"].includes(sql)) {
            assert.match(sql, /^SELECT\b/);
            assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|CALL|NOW)\b|CURRENT_TIMESTAMP/i);
            const table = sql.match(/FROM public\.([a-z_0-9]+)/)?.[1];
            assert.ok(allowedTables.has(table), `unexpected/current-state read: ${sql}`);
          }
          if (sql.includes("FROM public.rcv022_semantic_analysis_envelopes") && Object.hasOwn(faults, "envelope")) throw faults.envelope;
          const measured = await client.query(sql, values);
          if (sql === "COMMIT") commitCompleted = true;
          return measured;
        },
        release() {
          releases += 1;
          client.release();
          if (faults.mutateFixtureOnRelease === true) rows.input.contractVersion = 0;
          if (Object.hasOwn(faults, "release")) throw faults.release;
        },
      };
    },
  };
  return {
    rows,
    async read() {
      const before = JSON.stringify(rows);
      const retained = [];
      let succeeded = false;
      let result;
      try {
        result = await getClaimLevelEvidenceView(input, pool);
        succeeded = true;
      } catch (error) { retained.push({ phase: "primary", error }); }
      try {
        const expectedEnd = commitCompleted ? "COMMIT" : "ROLLBACK";
        if (succeeded) assert.equal(commitCompleted, true);
        assert.equal(JSON.stringify(rows), before, "reader must not repair or normalize fixture authority");
        assert.equal(queries[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        assert.equal(queries.at(-1), expectedEnd);
        assert.equal(releases, 1);
        const commitAttempts = queries.filter((sql) => sql === "COMMIT").length;
        assert.ok(commitAttempts <= 1);
        if (commitCompleted) assert.equal(commitAttempts, 1);
      } catch (error) { retained.push({ phase: "verification", error }); }
      throwRetainedFailures(retained);
      return result;
    },
  };
}



test("transitive Assessment Fragment hash binding: positive control preserves the complete result", async () => {
  const graph = assessmentFragmentBindingGraph();
  const { assessment, match, fixture, input, envelopes } = graph.rows;
  const assessmentRef = { assessmentId: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash };
  const expected = {
    claimVersionRef: input.claimVersionRef,
    envelopeManifest: input.envelopeManifest,
    assessmentManifest: [{
      assessmentRef,
      claimEvidenceMatchRef: { matchId: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash },
      evidenceFragmentRef: { fragmentId: FRAGMENT_ID, canonicalVersion: 1, canonicalHash: fixture.fragmentBuilt.hash },
      claimVersionRef: input.claimVersionRef,
      relation: "SUPPORTS", rationale: "assessment rationale",
      methodProvenance: assessment.method_provenance, assessedAt: assessment.assessed_at,
    }],
    occurrenceManifest: input.envelopeManifest.map((envelopeRef) => ({ envelopeRef, assessmentRef, ordinal: 0 })),
    envelopeProvenance: envelopes.map((row, i) => ({
      envelopeRef: input.envelopeManifest[i], claimVersionRef: input.claimVersionRef,
      analysisCutoffAt: row.analysis_cutoff_at, analysisAt: row.analysis_at,
      analysisMethodIdentity: row.analysis_method_identity, analysisMethodVersion: row.analysis_method_version,
      analysisMethodHash: row.analysis_method_hash,
    })),
    scopeEnumeration: { scopeKind: "EXPLICIT_ENVELOPE_SET", status: "ENUMERATED_AND_CONSIDERED" },
  };
  assert.deepEqual(await graph.read(), expected);
  assert.deepEqual(await assessmentFragmentBindingGraph({ reverse: true }).read(), expected);
});

test("transitive Assessment Fragment hash binding: self-consistent counterexample fails closed", async () => {
  const graph = assessmentFragmentBindingGraph({ wrongHash: true });
  const baseline = assessmentFragmentBindingGraph();
  assert.deepEqual(graph.rows.match, baseline.rows.match);
  assert.deepEqual(graph.rows.fixture, baseline.rows.fixture);
  assert.deepEqual(JSON.parse(graph.rows.assessment.canonical), {
    ...JSON.parse(baseline.rows.assessment.canonical), evidenceFragmentCanonicalHash: HASH_C,
  });
  for (const row of [graph.rows.assessment, ...graph.rows.envelopes]) {
    assert.equal(require("node:crypto").createHash("sha256").update(row.canonical, "utf8").digest("hex"), row.canonical_hash);
  }
  for (const envelope of graph.rows.envelopes) {
    assert.equal(JSON.parse(envelope.canonical).assessmentRefs[0].canonicalHash, graph.rows.assessment.canonical_hash);
    assert.equal(envelope.assessment_refs[0].canonicalHash, graph.rows.assessment.canonical_hash);
  }
  assert.equal(graph.rows.supportRows[0].canonical_hash, graph.rows.assessment.canonical_hash);
  await assert.rejects(() => graph.read(), (error) => {
    assertHistoricalFailure(error, "HASH_MISMATCH", "envelope[0].evidenceAssessment.evidenceFragmentCanonicalHash");
    return true;
  });
});

test("transitive Assessment Fragment hash binding: competing failures retain frozen selection", async () => {
  for (const reverse of [false, true]) {
    for (const [competing, code, path] of [
      ["malformed", "MALFORMED_DATA", "envelope[1].semanticAnalysisEnvelope.canonical"],
      ["hash", "HASH_MISMATCH", "envelope[0].evidenceAssessment.claimCanonicalHash"],
    ]) {
      const graph = assessmentFragmentBindingGraph({ wrongHash: true, reverse, competing });
      await assert.rejects(() => graph.read(), (error) => {
        assertHistoricalFailure(error, code, path);
        return true;
      });
    }
  }
});

test("transitive Assessment Fragment hash binding: reversed construction falsification preserves the exact failure", async () => {
  const failures = [];
  for (const reverse of [false, true]) {
    const graph = assessmentFragmentBindingGraph({ wrongHash: true, reverse });
    await assert.rejects(() => graph.read(), (error) => {
      assertHistoricalFailure(error, "HASH_MISMATCH", "envelope[0].evidenceAssessment.evidenceFragmentCanonicalHash");
      failures.push({ code: error.code, path: error.path, message: error.message });
      return true;
    });
  }
  assert.deepEqual(failures[1], failures[0]);
});

test("historical failure selection uses frozen tier precedence, not first-thrown order", async () => {
  const malformed = { envelope_id: ENVELOPE_B, canonical_version: 1, canonical: "not-json", canonical_hash: HASH_B };
  const hashMismatch = { envelope_id: ENVELOPE_A, canonical_version: 1, canonical: "{}", canonical_hash: HASH_A };
  const rows = new Map([[ENVELOPE_A, hashMismatch], [ENVELOPE_B, malformed]]);
  const manifests = [
    [ref(ENVELOPE_A, HASH_A), ref(ENVELOPE_B, HASH_B)],
    [ref(ENVELOPE_B, HASH_B), ref(ENVELOPE_A, HASH_A)],
  ];
  const results = [];
  for (const manifest of manifests) results.push(await selectedHistoricalFailure(manifest, rows));
  assert.deepEqual(results, [results[0], results[0]]);
  assert.equal(results[0].code, "MALFORMED_DATA");
});

test("same-class historical failures use canonical path tie-break independent of fetch order", async () => {
  const target = verificationTarget();
  const canonicalMismatchBase = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash);
  const canonicalMismatch = { ...canonicalMismatchBase, canonical_hash: HASH_A };
  const claimMismatch = validEmptyEnvelope(target, ENVELOPE_B, HASH_B);
  const rows = new Map([[ENVELOPE_A, canonicalMismatch], [ENVELOPE_B, claimMismatch]]);
  const forward = await selectedHistoricalFailure([ref(ENVELOPE_A, HASH_A), ref(ENVELOPE_B, claimMismatch.canonical_hash)], rows, false);
  const reverse = await selectedHistoricalFailure([ref(ENVELOPE_B, claimMismatch.canonical_hash), ref(ENVELOPE_A, HASH_A)], rows, true);
  assert.deepEqual(reverse, forward);
  assert.equal(forward.code, "HASH_MISMATCH");
  assert.equal(forward.path, "envelope[0].semanticAnalysisEnvelope.canonical_hash");
});

test("same-Envelope same-tier failures are collected before selecting the canonical path winner", async () => {
  const target = verificationTarget();
  const row = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    claimVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
  const pool = failurePool(target, new Map([[ENVELOPE_A, row]]));
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({
      claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash },
      envelopeManifest: [ref(ENVELOPE_A, row.canonical_hash)],
      contractVersion: 1,
    }, pool),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "CLAIM_SCOPE_MISMATCH", "envelope[0].semanticAnalysisEnvelope.claim_id");
});

test("same-Envelope mixed-tier failures select the higher-precedence hash failure", async () => {
  const target = verificationTarget();
  const wrongClaimId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const row = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, { claimId: wrongClaimId });
  const result = await selectedHistoricalFailure(
    [ref(ENVELOPE_A, HASH_B)],
    new Map([[ENVELOPE_A, row]]),
  );
  assertHistoricalFailure(result, "HASH_MISMATCH", "envelope[0].semanticAnalysisEnvelope.canonical_hash");
});

test("same-Envelope failures select the same expected winner on repeated reads", async () => {
  // Both reads use the Reader's fixed local collection order. This checks
  // repeatability, not selection independence under a different encounter order.
  // Reversing object keys or caller Envelope order would not reverse these checks.
  const target = verificationTarget();
  const row = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    claimVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    analysisCutoffAt: "2026-01-02T00:00:00.000001Z",
  });
  const manifest = [ref(ENVELOPE_A, row.canonical_hash)];
  const makePool = () => failurePool(target, new Map([[ENVELOPE_A, row]]));
  const run = async (pool) => {
    let observed;
    await assert.rejects(
      () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: manifest, contractVersion: 1 }, pool),
      (error) => { observed = error; return true; },
    );
    return { code: observed.code, path: observed.path };
  };
  const first = await run(makePool());
  const repeated = await run(makePool());
  assert.deepEqual(repeated, first);
  assert.deepEqual(first, { code: "CLAIM_SCOPE_MISMATCH", path: "envelope[0].semanticAnalysisEnvelope.claim_id" });
});

test("Assessment collects scope and hash failures before selecting the frozen winner", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const assessment = validAssessment(target, match, fixture, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", claimCanonicalHash: HASH_A });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }],
  });
  const pool = fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, fixture.captureRow, false, [{ ordinal: 0, id: ASSESSMENT_ID, canonical_version: 1, canonical_hash: assessment.canonical_hash, authorityRow: assessment }]);
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, pool),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "envelope[0].evidenceAssessment.claimCanonicalHash");
});

test("Assessment same-tier scope failures use the canonical path tie-break under reversed construction", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const assessment = validAssessment(target, match, fixture, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", claimVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  const reversedAssessment = Object.fromEntries(Object.entries(assessment).reverse());
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }],
  });
  const run = async (row) => {
    let observed;
    await assert.rejects(
      () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, fixture.captureRow, false, [{ ordinal: 0, id: ASSESSMENT_ID, canonical_version: 1, canonical_hash: row.canonical_hash, authorityRow: row }])),
      (error) => { observed = error; return true; },
    );
    return { code: observed.code, path: observed.path };
  };
  const forward = await run(assessment);
  const reversed = await run(reversedAssessment);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward, { code: "CLAIM_SCOPE_MISMATCH", path: "envelope[0].evidenceAssessment.claimId" });
});

test("three Assessment failures keep the same hash winner under reversed construction", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const assessment = validAssessment(target, match, fixture, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", claimVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", claimCanonicalHash: HASH_C });
  const reversedAssessment = Object.fromEntries(Object.entries(assessment).reverse());
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }],
  });
  const run = async (row) => {
    let observed;
    await assert.rejects(
      () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, fixture.captureRow, false, [{ ordinal: 0, id: ASSESSMENT_ID, canonical_version: 1, canonical_hash: row.canonical_hash, authorityRow: row }])),
      (error) => { observed = error; return true; },
    );
    return { code: observed.code, path: observed.path };
  };
  assert.deepEqual(await run(assessment), await run(reversedAssessment));
  assert.deepEqual(await run(assessment), { code: "HASH_MISMATCH", path: "envelope[0].evidenceAssessment.claimCanonicalHash" });
});

test("Assessment-local and outer Envelope failures compose under frozen precedence", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const assessment = validAssessment(target, match, fixture, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", claimCanonicalHash: HASH_A });
  const envelopeA = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }],
  });
  const envelopeB = { envelope_id: ENVELOPE_B, canonical_version: 1, canonical: "not-json", canonical_hash: HASH_B };
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelopeA.canonical_hash), ref(ENVELOPE_B, HASH_B)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelopeA], [ENVELOPE_B, envelopeB]]), match, fixture.fragmentRow, fixture.captureRow, false, [{ ordinal: 0, id: ASSESSMENT_ID, canonical_version: 1, canonical_hash: assessment.canonical_hash, authorityRow: assessment }])),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "MALFORMED_DATA", "envelope[1].semanticAnalysisEnvelope.canonical");
});

test("operational Assessment-membership errors remain unranked", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const assessment = validAssessment(target, match, fixture);
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }],
  });
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, fixture.captureRow, false, [{ ordinal: 0, id: ASSESSMENT_ID, canonical_version: 1, canonical_hash: assessment.canonical_hash, authorityRow: assessment }], true)),
    (error) => error instanceof Error && !("code" in error) && error.message === "operational assessment query failure",
  );
});

test("ClaimVersion identity and hash failures are collected before selecting the hash path", async () => {
  const target = verificationTarget();
  const wrongVersionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: wrongVersionId, canonicalVersion: 1, canonicalHash: HASH_A }, envelopeManifest: [], contractVersion: 1 }, claimVersionFailurePool(target)),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "claimVersion.canonical_hash");
});

test("ClaimVersion and Claim failures share one deterministic selection boundary", async () => {
  const target = verificationTarget();
  const wrongVersion = target.versionRow;
  const wrongClaim = { claim_id: target.claimId, canonical_version: 1, canonical: target.claim.canonical, canonical_hash: HASH_B };
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: HASH_C }, envelopeManifest: [], contractVersion: 1 }, claimVersionFailurePool({ ...target, versionRow: wrongVersion }, wrongClaim)),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "claim.canonical_hash");
});

test("parseCanonical semantic mismatches join ClaimVersion and Claim selection", async () => {
  const target = verificationTarget();
  const wrongVersion = { ...target.versionRow, canonical_hash: HASH_A };
  const wrongClaimCanonical = buildClaimIdentityCanonical({ claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  const wrongClaim = { claim_id: target.claimId, canonical_version: 1, canonical: wrongClaimCanonical.canonical, canonical_hash: wrongClaimCanonical.hash };
  const run = async (versionRow, claimRow) => {
    let observed;
    await assert.rejects(
      () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [], contractVersion: 1 }, claimVersionFailurePool({ ...target, versionRow }, claimRow)),
      (error) => { observed = error; return true; },
    );
    return { code: observed.code, path: observed.path };
  };
  const forward = await run(wrongVersion, wrongClaim);
  const reversed = await run(Object.fromEntries(Object.entries(wrongVersion).reverse()), Object.fromEntries(Object.entries(wrongClaim).reverse()));
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward, { code: "CANONICAL_MISMATCH", path: "claim.canonical" });
});

test("ClaimVersion candidates remain comparable with an explicit Envelope failure", async () => {
  const target = verificationTarget();
  const corruptedTarget = { ...target, versionRow: { ...target.versionRow, canonical_hash: HASH_A } };
  const malformedEnvelope = { envelope_id: ENVELOPE_A, canonical_version: 1, canonical: "not-json", canonical_hash: HASH_B };
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, HASH_B)], contractVersion: 1 }, failurePool(corruptedTarget, new Map([[ENVELOPE_A, malformedEnvelope]]))),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "MALFORMED_DATA", "envelope[0].semanticAnalysisEnvelope.canonical");
});

test("malformed ClaimVersion canonical input still fails before downstream comparison", async () => {
  const target = verificationTarget();
  const malformedVersion = { ...target.versionRow, canonical: "not-json", canonical_hash: HASH_A };
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [], contractVersion: 1 }, claimVersionFailurePool({ ...target, versionRow: malformedVersion })),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "MALFORMED_DATA", "claimVersion.canonical");
});

test("unexpected ClaimVersion canonical errors remain operational", async () => {
  const target = verificationTarget();
  const operationalVersion = { ...target.versionRow };
  Object.defineProperty(operationalVersion, "canonical", { get() { throw new Error("operational canonical failure"); } });
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [], contractVersion: 1 }, claimVersionFailurePool({ ...target, versionRow: operationalVersion })),
    (error) => error instanceof Error && !("code" in error) && error.message === "operational canonical failure",
  );
});

test("Envelope membership cardinality failures are collected independently", async () => {
  const target = verificationTarget();
  const row = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: HASH_A }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: HASH_B }],
  });
  const run = async (membershipRows) => {
    let observed;
    await assert.rejects(
      () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, row.canonical_hash)], contractVersion: 1 }, failurePool(target, new Map([[ENVELOPE_A, row]]), false, membershipRows)),
      (error) => { observed = error; return true; },
    );
    return { code: observed.code, path: observed.path };
  };
  const forward = await run({ match: [], assessment: [] });
  const reversed = await run({ assessment: [], match: [] });
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward, { code: "LINEAGE_MISMATCH", path: "envelope[0].assessmentRefs" });
});

test("membership commitment failures do not preempt Match authentication", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, { matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }] });
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, matchFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, false, fixture.fragmentRow, fixture.captureRow, [{ ordinal: 0, id: MATCH_ID, canonical_version: 1, canonical_hash: HASH_B }])),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "envelope[0].matchRefs.55555555-5555-4555-8555-555555555555.canonicalHash");
});

test("Match candidates remain comparable with an Assessment candidate", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const assessment = { ...validAssessment(target, match, fixture), canonical_hash: HASH_A };
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }],
  });
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, fixture.captureRow, false, [{ ordinal: 0, id: ASSESSMENT_ID, canonical_version: 1, canonical_hash: assessment.canonical_hash, authorityRow: assessment }])),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "envelope[0].evidenceAssessment.canonical_hash");
});

test("Assessment candidates remain comparable with a deeper Match candidate", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const validMatchRow = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const match = { ...validMatchRow, canonical_hash: HASH_A };
  const assessment = validAssessment(target, match, fixture, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }],
  });
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, fixture.captureRow, false, [{ ordinal: 0, id: ASSESSMENT_ID, canonical_version: 1, canonical_hash: assessment.canonical_hash, authorityRow: assessment }])),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "envelope[0].claimEvidenceMatch.canonical_hash");
});

test("Match canonical candidates remain comparable with Fragment/Capture candidates", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const validMatchRow = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const match = { ...validMatchRow, canonical_hash: HASH_A };
  const fragment = { ...fixture.fragmentRow, canonical_hash: HASH_B };
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, { matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }] });
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fragment, fixture.captureRow)),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "envelope[0].claimEvidenceMatch.canonical_hash");
});

test("nested Match collects scope and hash failures before selecting the frozen winner", async () => {
  const target = verificationTarget();
  const match = validMatch(target, {
    claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    claimCanonicalHash: HASH_B,
    claimVersionId: "77777777-7777-4777-8777-777777777777",
  });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
  });
  const pool = matchFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match);
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, pool),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "envelope[0].claimEvidenceMatch.claimCanonicalHash");
});

test("nested Match same-tier scope failures use the canonical path tie-break", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, {
    claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    claimVersionId: "77777777-7777-4777-8777-777777777777",
    evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash,
  });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
  });
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, matchFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, false, fixture.fragmentRow, fixture.captureRow)),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "CLAIM_SCOPE_MISMATCH", "envelope[0].claimEvidenceMatch.claimId");
});

test("nested Match failures compose with outer Envelope failures", async () => {
  const target = verificationTarget();
  const match = validMatch(target, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", claimCanonicalHash: HASH_B });
  const envelopeA = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, { matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }] });
  const envelopeB = { envelope_id: ENVELOPE_B, canonical_version: 1, canonical: "not-json", canonical_hash: HASH_C };
  const pool = matchFailurePool(target, new Map([[ENVELOPE_A, envelopeA], [ENVELOPE_B, envelopeB]]), match);
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelopeA.canonical_hash), ref(ENVELOPE_B, HASH_C)], contractVersion: 1 }, pool),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "MALFORMED_DATA", "envelope[1].semanticAnalysisEnvelope.canonical");
});

test("operational Match errors remain unranked", async () => {
  const target = verificationTarget();
  const match = validMatch(target);
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, { matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }] });
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, matchFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, true)),
    (error) => error instanceof Error && !("code" in error) && error.message === "operational match query failure",
  );
});

test("nested Fragment/Capture collects identity and hash failures before selecting the hash path", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const wrongCaptureInput = { ...fixture.captureInput, captureId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
  const wrongCaptureBuilt = historicalCaptureCanonical(wrongCaptureInput);
  const wrongCapture = { ...captureRow(wrongCaptureInput, wrongCaptureBuilt), capture_hash: HASH_C };
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
  });
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, wrongCapture)),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "HASH_MISMATCH", "envelope[0].evidenceFragment.capture.capture_hash");
});

test("nested Fragment/Capture same-tier failures use the canonical hash path tie-break", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const alteredInput = { ...fixture.captureInput, contentHash: HASH_C };
  const alteredBuilt = historicalCaptureCanonical(alteredInput);
  const alteredCapture = { ...captureRow(alteredInput, alteredBuilt), capture_hash: HASH_A };
  const reversedConstruction = Object.fromEntries(Object.entries(alteredCapture).reverse());
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
  });
  const run = async (capture) => {
    let observed;
    await assert.rejects(
      () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, capture)),
      (error) => { observed = error; return true; },
    );
    return { code: observed.code, path: observed.path };
  };
  const forward = await run(alteredCapture);
  const reversed = await run(reversedConstruction);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward, { code: "HASH_MISMATCH", path: "envelope[0].evidenceFragment.capture.capture_hash" });
});

test("nested Fragment/Capture failures compose with an outer Envelope failure", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const alteredInput = { ...fixture.captureInput, contentHash: HASH_C };
  const alteredBuilt = historicalCaptureCanonical(alteredInput);
  const alteredCapture = { ...captureRow(alteredInput, alteredBuilt), capture_hash: HASH_A };
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const envelopeA = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, { matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }] });
  const envelopeB = { envelope_id: ENVELOPE_B, canonical_version: 1, canonical: "not-json", canonical_hash: HASH_B };
  let observed;
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelopeA.canonical_hash), ref(ENVELOPE_B, HASH_B)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelopeA], [ENVELOPE_B, envelopeB]]), match, fixture.fragmentRow, alteredCapture)),
    (error) => { observed = error; return true; },
  );
  assertHistoricalFailure(observed, "MALFORMED_DATA", "envelope[1].semanticAnalysisEnvelope.canonical");
});

test("three nested Fragment/Capture failures keep the same hash winner under reversed construction", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const alteredInput = { ...fixture.captureInput, captureId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", contentHash: HASH_C };
  const alteredBuilt = historicalCaptureCanonical(alteredInput);
  const threeFaults = { ...captureRow(alteredInput, alteredBuilt), capture_hash: HASH_A };
  const reversed = Object.fromEntries(Object.entries(threeFaults).reverse());
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, { matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }] });
  const run = async (capture) => {
    let observed;
    await assert.rejects(
      () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, capture)),
      (error) => { observed = error; return true; },
    );
    return { code: observed.code, path: observed.path };
  };
  assert.deepEqual(await run(threeFaults), await run(reversed));
  assert.deepEqual(await run(threeFaults), { code: "HASH_MISMATCH", path: "envelope[0].evidenceFragment.capture.capture_hash" });
});

test("operational Fragment/Capture errors remain unranked", async () => {
  const target = verificationTarget();
  const fixture = fragmentCaptureFixture();
  const match = validMatch(target, { claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, { matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }] });
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 }, fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, fixture.captureRow, true)),
    error => {
      assert.ok(error instanceof FailureTransportGroup);
      assert.equal(error.failures[0].error.message, "operational capture query failure");
      assert.ok(error.verificationFailures.length > 0);
      assert.equal(error.selectedVerificationFailure.code, "CLAIM_SCOPE_MISMATCH");
      return true;
    },
  );
});

test("inner and outer failure collection compose under frozen precedence", async () => {
  const target = verificationTarget();
  const inner = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    claimVersionId: "55555555-5555-4555-8555-555555555555",
  });
  const outer = { envelope_id: ENVELOPE_B, canonical_version: 1, canonical: "not-json", canonical_hash: HASH_B };
  const rows = new Map([[ENVELOPE_A, inner], [ENVELOPE_B, outer]]);
  const forward = await selectedHistoricalFailure([ref(ENVELOPE_A, inner.canonical_hash), ref(ENVELOPE_B, HASH_B)], rows);
  const reverse = await selectedHistoricalFailure([ref(ENVELOPE_B, HASH_B), ref(ENVELOPE_A, inner.canonical_hash)], rows, true);
  assert.deepEqual(reverse, forward);
  assertHistoricalFailure(forward, "MALFORMED_DATA", "envelope[1].semanticAnalysisEnvelope.canonical");
});

test("operational errors escape rather than entering semantic failure selection", async () => {
  const target = verificationTarget();
  const pool = failurePool(target, new Map([[ENVELOPE_A, validEmptyEnvelope(target, ENVELOPE_A)]]));
  const originalConnect = pool.connect;
  pool.connect = async () => {
    const client = await originalConnect();
    const originalQuery = client.query;
    client.query = async (text, values) => {
      if (text.includes("rcv022_semantic_analysis_envelopes")) throw new Error("operational database failure");
      return originalQuery(text, values);
    };
    return client;
  };
  await assert.rejects(
    () => getClaimLevelEvidenceView({ claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A)], contractVersion: 1 }, pool),
    (error) => error instanceof Error && !("code" in error) && error.message === "operational database failure",
  );
});

// Focused SQL-boundary proof: these rows come from the real production writer's
// INSERT parameters. The sink records values; it does not build canonical bytes
// or claim to enforce PostgreSQL constraints / provide physical persistence.


async function writerProducedCapture(retained = false) {
  const c = require("../dist/services/rcv020Canonical");
  const { persistRcv020Authority } = require("../dist/services/rcv020PersistenceService");
  const { Rcv020InMemoryRawObjectAuthority } = require("../dist/services/rcv020RawObjectAuthority");
  const sha = c.sha256Rcv020Text;
  const ts = n => `2026-01-01T00:00:${String(n).padStart(2, "0")}.000000Z`;
  const input = { ...fragmentCaptureFixture().captureInput, observedAt: ts(3) };
  const bytes = Buffer.from(retained ? "second independently retained capture" : "writer capture");
  input.captureId = retained ? "77777777-7777-4777-8777-777777777778" : CAPTURE_ID;
  input.byteLength = String(bytes.length); input.contentHash = sha(bytes.toString());
  input.retentionPolicy = retained ? "PERMANENT_RAW" : "METADATA_HASH_ONLY";
  const request = { method: "GET", target: input.requestedTarget, parameters: {}, credentialReference: null };
  const req = c.canonicalizeRcv020Request(request); input.requestHash = req.hash;
  const source = { logicalSourceId: input.logicalSourceId, organizationIdentity: "capture-compatibility", sourceClass: "public", jurisdiction: "CH", canonical: "{}", identityHash: sha("{}") };
  const monitor = { monitorId: input.monitorId, logicalSourceId: input.logicalSourceId, monitorKind: "api", canonical: "{}", identityHash: sha("{}") };
  const config = { monitorConfigurationVersionId: input.monitorConfigurationVersionId, monitorId: input.monitorId, versionNumber: "1", endpointRequest: request, retrievalMethod: "GET", authenticationReference: null, expectedMediaConstraints: {}, triggerEligibility: "SCHEDULED", scope: {}, safetyPolicy: {}, adapterId: "compatibility", adapterVersion: "1", parserId: null, parserVersion: null, retentionPolicy: input.retentionPolicy, retentionPolicyVersion: 1, effectiveFrom: ts(0), effectiveUntil: null };
  const occurrence = { occurrenceId: input.occurrenceId, logicalSourceId: input.logicalSourceId, monitorId: input.monitorId, monitorConfigurationVersionId: input.monitorConfigurationVersionId, triggerOrigin: "SCHEDULED", scheduledAt: ts(1), triggerReceivedAt: null, requestedAt: null, dueAt: ts(1), evaluationCutoffAt: ts(20) };
  const attempt = { attemptId: input.retrievalAttemptId, occurrenceId: input.occurrenceId, previousAttemptId: null, retryNumber: "1", retrievalStartedAt: ts(2), attemptDeadlineAt: ts(10), adapterId: "compatibility", adapterVersion: "1", requestCanonical: req.canonical, requestHash: req.hash };
  const resolution = { attemptResolutionId: ENVELOPE_A, attemptId: input.retrievalAttemptId, retrievalCompletedAt: ts(3), outcome: "CAPTURED_CHANGED", failureCode: null };
  const comparison = { comparisonId: ENVELOPE_B, currentCaptureId: input.captureId, priorCaptureId: null, algorithmId: "raw-bytes", algorithmVersion: 1, result: "FIRST_OBSERVED", inputCanonical: "{}", inputHash: sha("{}") };
  const terminal = { resolutionId: ENVELOPE_C, occurrenceId: input.occurrenceId, outcome: "SUCCEEDED", evaluationCutoffAt: ts(20), evaluatedAt: ts(20), skipReason: null, skipActorPolicyIdentity: null, terminalizationPolicyVersion: 1, canonical: "{}", canonicalHash: sha("{}") };
  const lifecycle = { eventId: MATCH_ID, monitorConfigurationVersionId: input.monitorConfigurationVersionId, eventType: "ACTIVATED", eventAt: ts(0), eventSequence: "1", actorPolicyIdentity: "compatibility" };
  const statements = []; const inserts = new Map();
  await persistRcv020Authority({ async query(sql, values = []) {
    statements.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    const match = sql.match(/^INSERT INTO public\.(\w+) \(([^)]+)\) VALUES/);
    assert.ok(match, `unexpected writer SQL: ${sql}`);
    const columns = match[2].split(",").map(x => x.trim());
    assert.equal(columns.length, values.length);
    inserts.set(match[1], Object.fromEntries(columns.map((name, i) => [name, values[i]])));
    return { rows: [], rowCount: 1 };
  } }, { contractVersion: 1, sources: [source], monitors: [monitor], configurations: [config], lifecycleEvents: [lifecycle], occurrences: [occurrence], attempts: [attempt], attemptResolutions: [resolution], captures: [input], comparisons: [comparison], occurrenceResolutions: [terminal], retentionEvents: [], handoffs: [], quarantine: [], rawBytesByCaptureId: new Map([[input.captureId, bytes]]) }, retained ? new Rcv020InMemoryRawObjectAuthority() : undefined);
  assert.equal(statements[0], "BEGIN"); assert.equal(statements.at(-1), "COMMIT");
  const row = inserts.get("rcv020_captures"); assert.ok(row);
  assert.equal(sha(row.canonical), row.capture_hash);
  assert.equal(JSON.parse(row.canonical).schema, "RCV020-CAPTURE-ENVELOPE-V1");
  assert.equal(Object.hasOwn(JSON.parse(row.canonical), "rawObjectReference"), false);
  assert.equal(Object.hasOwn(JSON.parse(row.canonical), "captureHash"), false);
  const effectiveInput = { ...input, rawObjectIdentity: row.raw_object_identity, rawObjectReference: row.raw_object_reference };
  // Independent frozen historical verifier is used only as a legacy-acceptance
  // cross-check, never as the Claim-Level failure-selection oracle.
  const stored = table => inserts.get(`rcv020_${table}`);
  const readBundle = {
    contractVersion: 1, source: { ...source, identityCanonical: {} }, monitor,
    configuration: { ...config, ...{ canonical: stored("monitor_configuration_versions").canonical, canonicalHash: stored("monitor_configuration_versions").canonical_hash.toString("hex"), endpointRequestCanonical: req.canonical, endpointRequestHash: req.hash } },
    lifecycleEvents: [lifecycle], occurrence: { ...occurrence, canonical: stored("observation_occurrences").canonical, canonicalHash: stored("observation_occurrences").canonical_hash },
    attempts: [{ ...attempt, canonical: stored("retrieval_attempts").canonical, canonicalHash: stored("retrieval_attempts").canonical_hash }],
    attemptResolutions: [{ ...resolution, canonical: stored("retrieval_attempt_resolutions").canonical, canonicalHash: stored("retrieval_attempt_resolutions").canonical_hash }],
    captures: [{ ...effectiveInput, captureCanonical: row.canonical, captureHash: row.capture_hash }],
    comparisons: [{ ...comparison, canonical: stored("capture_comparisons").canonical, canonicalHash: stored("capture_comparisons").canonical_hash }],
    occurrenceResolution: terminal, occurrenceResolutions: [terminal], retentionEvents: [], handoffs: [], quarantine: [],
  };
  return { input: effectiveInput, row, readBundle };
}

async function readWithCaptureConstructionTrace(graph) {
  const c = require("../dist/services/rcv020Canonical");
  const original = c.canonicalizeRcv020; const observed = [];
  c.canonicalizeRcv020 = function(value, ...args) {
    const result = original(value, ...args);
    if (value.schema === "RCV020-CAPTURE-ENVELOPE-V1" && !Object.hasOwn(value, "captureHash")) observed.push(result);
    return result;
  };
  try { return { result: await graph.read(), observed }; }
  finally { c.canonicalizeRcv020 = original; }
}

const captureFailurePath = "envelope[0].evidenceFragment.capture.";
async function rejectsCapture(graph, code, suffix) {
  let returned = false;
  await assert.rejects(async () => { const result = await graph.read(); returned = true; return result; }, error => {
    assertHistoricalFailure(error, code, captureFailurePath + suffix); return true;
  });
  assert.equal(returned, false, "no partial ViewResult");
}

test("Capture compatibility: actual writer output authenticates with exact canonical bytes and hash", async t => {
  const writerCapture = await writerProducedCapture();
  const graph = assessmentFragmentBindingGraph({ writerCapture });
  const { result, observed } = await readWithCaptureConstructionTrace(graph);
  assert.equal(result.assessmentManifest.length, 1); assert.equal(result.occurrenceManifest.length, 2);
  assert.ok(observed.length > 0);
  for (const built of observed) { assert.equal(built.canonical, writerCapture.row.canonical); assert.equal(built.hash, writerCapture.row.capture_hash); }
  assert.equal(writerCapture.row.raw_object_reference, null);
  t.diagnostic(`writer/reconstructed SHA256=${writerCapture.row.capture_hash}`);
});

test("Capture compatibility: legacy text follows frozen base-envelope hash semantics", async () => {
  const { canonicalizeRcv020, sha256Rcv020Text } = require("../dist/services/rcv020Canonical");
  const { verifyRcv020ReadBundle } = require("../dist/services/rcv020ReadVerifier");
  const writerCapture = await writerProducedCapture();
  assert.equal(verifyRcv020ReadBundle(writerCapture.readBundle).authenticated, true);
  writerCapture.row.canonical = canonicalizeRcv020({ ...JSON.parse(writerCapture.row.canonical), captureHash: writerCapture.row.capture_hash }).canonical;
  writerCapture.readBundle.captures[0].captureCanonical = writerCapture.row.canonical;
  assert.equal(verifyRcv020ReadBundle(writerCapture.readBundle).authenticated, true);
  const graph = assessmentFragmentBindingGraph({ writerCapture });
  assert.equal((await graph.read()).assessmentManifest.length, 1);
  // Hashing legacy text itself is NOT the frozen commitment rule.
  writerCapture.row.capture_hash = sha256Rcv020Text(writerCapture.row.canonical);
  writerCapture.readBundle.captures[0].captureHash = writerCapture.row.capture_hash;
  assert.throws(() => verifyRcv020ReadBundle(writerCapture.readBundle));
  await rejectsCapture(assessmentFragmentBindingGraph({ writerCapture }), "CANONICAL_MISMATCH", "canonical");
});

test("Capture compatibility: altered canonical bytes fail closed", async () => {
  const writerCapture = await writerProducedCapture(); const graph = assessmentFragmentBindingGraph({ writerCapture });
  graph.rows.capture.canonical += " ";
  await rejectsCapture(graph, "CANONICAL_MISMATCH", "canonical");
});

test("Capture compatibility: wrong stored hash fails closed", async () => {
  const writerCapture = await writerProducedCapture(); const graph = assessmentFragmentBindingGraph({ writerCapture });
  graph.rows.capture.capture_hash = HASH_C;
  await rejectsCapture(graph, "HASH_MISMATCH", "capture_hash");
});

test("Capture compatibility: malformed canonical JSON fails closed", async () => {
  const writerCapture = await writerProducedCapture(); const graph = assessmentFragmentBindingGraph({ writerCapture });
  graph.rows.capture.canonical = "{";
  await rejectsCapture(graph, "MALFORMED_DATA", "canonical");
});

test("Capture compatibility: self-consistent Capture still binds to its Fragment commitment", async () => {
  const writerCapture = await writerProducedCapture();
  const other = await writerProducedCapture(true);
  const graph = assessmentFragmentBindingGraph({ writerCapture });
  Object.assign(graph.rows.capture, other.row);
  await rejectsCapture(graph, "HASH_MISMATCH", "capture_hash");
});

test("Capture compatibility: deep hash failure retains global malformed precedence in both caller orders", async () => {
  for (const reverse of [false, true]) {
    const graph = assessmentFragmentBindingGraph({ writerCapture: await writerProducedCapture(), reverse, competing: "malformed" });
    graph.rows.capture.capture_hash = HASH_C;
    await assert.rejects(() => graph.read(), error => { assertHistoricalFailure(error, "MALFORMED_DATA", "envelope[1].semanticAnalysisEnvelope.canonical"); return true; });
  }
});

test("Capture compatibility: retained-object falsification accepts writer bytes then rejects hash-only damage", async t => {
  for (const reverse of [false, true]) {
    const writerCapture = await writerProducedCapture(true);
    assert.ok(writerCapture.row.raw_object_reference); assert.ok(writerCapture.row.raw_object_identity);
    assert.notEqual(canonicalizeRcv020Capture(writerCapture.input).canonical, writerCapture.row.canonical);
    const { result, observed } = await readWithCaptureConstructionTrace(assessmentFragmentBindingGraph({ writerCapture, reverse }));
    assert.equal(result.assessmentManifest.length, 1); assert.ok(observed.length > 0);
    for (const built of observed) { assert.equal(built.canonical, writerCapture.row.canonical); assert.equal(built.hash, writerCapture.row.capture_hash); }
    const graph = assessmentFragmentBindingGraph({ writerCapture, reverse }); graph.rows.capture.capture_hash = HASH_C;
    await rejectsCapture(graph, "HASH_MISMATCH", "capture_hash");
    t.diagnostic(`retained writer/reconstructed SHA256=${writerCapture.row.capture_hash === HASH_C ? observed[0].hash : writerCapture.row.capture_hash}`);
  }
});




// Source-only cleanup probes. Instrumented clients do not prove PostgreSQL lifecycle.

async function cleanupHarness(faults = {}, { withEnvelope = false, membershipResults = {} } = {}) {
  const target = verificationTarget();
  const envelope = validEmptyEnvelope(target, ENVELOPE_A);
  const client = await failurePool(target, new Map(withEnvelope ? [[ENVELOPE_A, envelope]] : [])).connect();
  const calls = [];
  const pool = {
    async connect() {
      return {
        async query(sql, values) {
          calls.push(sql);
          const point = sql.startsWith("BEGIN") ? "begin" : sql === "COMMIT" ? "commit" : sql === "ROLLBACK" ? "rollback" : sql.includes("FROM public.rcv022_semantic_analysis_envelopes") ? "envelope" : "read";
          if (Object.hasOwn(faults, point)) throw faults[point];
          for (const table of ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"]) {
            if (sql.includes(`FROM public.${table} `) && Object.hasOwn(membershipResults, table)) return membershipResults[table];
          }
          return client.query(sql, values);
        },
        async release() {
          calls.push("RELEASE");
          await Promise.resolve();
          if (Object.hasOwn(faults, "release")) throw faults.release;
          client.release();
        },
      };
    },
  };
  const spec = { claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: withEnvelope ? [ref(ENVELOPE_A, envelope.canonical_hash)] : [], contractVersion: 1 };
  return { calls, run: () => getClaimLevelEvidenceView(spec, pool) };
}

function assertRetained(error, expected) {
  if (expected.length === 1) {
    assert.strictEqual(error, expected[0].error);
    return;
  }
  assert.ok(error instanceof FailureTransportGroup);
  assert.equal(error.name, "FailureTransportGroup");
  assert.doesNotMatch(error.message, /RCV-021|RCV021/);
  assert.equal(Object.hasOwn(error, "failureDomain"), false);
  assert.equal(Object.hasOwn(error, "code"), false);
  assert.equal(error.failures.length, expected.length);
  for (const [index, entry] of expected.entries()) {
    assert.equal(error.failures[index].phase, entry.phase);
    assert.strictEqual(error.failures[index].error, entry.error);
  }
}

test("neutral transport preserves primitives, hostile values, nesting and repeated references", () => {
  let inspections = 0;
  const hostile = new Proxy({}, { get() { inspections += 1; throw new Error("unexpected introspection"); }, getPrototypeOf() { inspections += 1; throw new Error("unexpected prototype inspection"); } });
  assert.doesNotThrow(() => throwRetainedFailures([]));
  for (const value of [null, undefined, 0, false, 1n, Symbol("failure"), hostile]) {
    let caught = false;
    try { throwRetainedFailures([{ phase: "primary", error: value }]); }
    catch (error) { caught = true; assert.strictEqual(error, value); }
    assert.equal(caught, true);
  }
  const inner = new FailureTransportGroup([{ phase: "primary", error: hostile }]);
  const expected = [{ phase: "primary", error: inner }, { phase: "rollback", error: hostile }, { phase: "connection-release", error: hostile }];
  const outer = new FailureTransportGroup(expected);
  assertRetained(outer, expected);
  assert.equal(inspections, 0);
  assert.equal(Object.isFrozen(outer.failures), true);
  assert.equal(Object.isFrozen(outer.failures[0]), true);
  assert.equal(Object.getOwnPropertyDescriptor(outer, "failures").enumerable, false);
});

test("Claim-Level cleanup retains every injected failure with its original domain", async t => {
  for (const points of [["read"], ["read", "rollback"], ["read", "release"], ["read", "rollback", "release"], ["release"], ["commit", "rollback", "release"], ["begin", "release"]]) {
    await t.test(points.join(" + "), async () => {
      const domains = { read: "PRIMARY_FAILURE", begin: "RESTORE_FAILURE", commit: "LATE_FAILURE", rollback: "ROLLBACK_FAILURE", release: "CLEANUP_FAILURE" };
      const faults = Object.fromEntries(points.map(point => [point, Object.assign(new Error(point), { failureDomain: domains[point] })]));
      const expected = points.map(point => ({ phase: point === "release" ? "connection-release" : point === "rollback" ? "rollback" : "primary", error: faults[point] }));
      const harness = await cleanupHarness(faults);
      await assert.rejects(harness.run, error => { assertRetained(error, expected); return true; });
      for (const point of points) assert.equal(faults[point].failureDomain, domains[point]);
      assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
      assert.equal(harness.calls.includes("ROLLBACK"), points.includes("read") || points.includes("commit"));
      assert.equal(harness.calls.includes("COMMIT"), !points.includes("read") && !points.includes("begin"));
    });
  }
});

test("Claim-Level cleanup does not introspect a hostile original failure", async () => {
  let inspections = 0;
  const original = new Proxy({}, { get() { inspections += 1; throw new Error("unexpected introspection"); }, getPrototypeOf() { inspections += 1; throw new Error("unexpected prototype inspection"); } });
  const release = new Error("release");
  const harness = await cleanupHarness({ read: original, release });
  await assert.rejects(harness.run, error => { assertRetained(error, [{ phase: "primary", error: original }, { phase: "connection-release", error: release }]); return true; });
  assert.equal(inspections, 0);
});

test("Claim-Level returns the original projection only after successful cleanup", async () => {
  const harness = await cleanupHarness();
  const result = await harness.run();
  assert.deepEqual(result.envelopeManifest, []);
  assert.deepEqual(result.assessmentManifest, []);
  assert.equal(harness.calls.at(-2), "COMMIT");
  assert.equal(harness.calls.at(-1), "RELEASE");
  assert.equal(harness.calls.includes("ROLLBACK"), false);
});


test("Envelope-read inspection failure retains the original Proxy before cleanup", async t => {
  for (const cleanup of [[], ["rollback"], ["release"], ["rollback", "release"]]) {
    await t.test(cleanup.join(" + ") || "inspection only", async () => {
      const inspection = Object.assign(new Error("prototype inspection"), { failureDomain: "LATE_FAILURE" });
      const original = new Proxy({ failureDomain: "PRIMARY_FAILURE" }, { getPrototypeOf() { throw inspection; } });
      const faults = { envelope: original };
      if (cleanup.includes("rollback")) faults.rollback = Object.assign(new Error("rollback"), { failureDomain: "ROLLBACK_FAILURE" });
      if (cleanup.includes("release")) faults.release = Object.assign(new Error("release"), { failureDomain: "CLEANUP_FAILURE" });
      const harness = await cleanupHarness(faults, { withEnvelope: true });
      await assert.rejects(harness.run, error => {
        let primary = error;
        if (cleanup.length > 0) {
          assert.ok(error instanceof FailureTransportGroup);
          primary = error.failures[0].error;
          assertRetained(error, [{ phase: "primary", error: primary }, ...cleanup.map(point => ({ phase: point === "release" ? "connection-release" : "rollback", error: faults[point] }))]);
        }
        assertRetained(primary, [{ phase: "primary", error: original }, { phase: "inspection", error: inspection }]);
        assert.equal(original.failureDomain, "PRIMARY_FAILURE");
        assert.equal(inspection.failureDomain, "LATE_FAILURE");
        if (faults.rollback) assert.equal(faults.rollback.failureDomain, "ROLLBACK_FAILURE");
        if (faults.release) assert.equal(faults.release.failureDomain, "CLEANUP_FAILURE");
        return true;
      });
      assert.equal(harness.calls.some(sql => sql.includes("FROM public.rcv022_semantic_analysis_envelopes")), true);
      assert.equal(harness.calls.includes("COMMIT"), false);
      assert.equal(harness.calls.includes("ROLLBACK"), true);
      assert.equal(harness.calls.at(-1), "RELEASE");
    });
  }
});

test("unit harness retains a primary failure and its later no-repair assertion", async () => {
  const original = Object.assign(new Error("envelope read"), { failureDomain: "PRIMARY_FAILURE" });
  const harness = assessmentFragmentBindingGraph({ faults: { envelope: original, mutateFixtureOnRelease: true } });
  await assert.rejects(() => harness.read(), error => {
    assert.ok(error instanceof FailureTransportGroup);
    assert.equal(error.failures.length, 2);
    assert.strictEqual(error.failures[0].error, original);
    assert.equal(error.failures[0].phase, "primary");
    assert.equal(error.failures[1].phase, "verification");
    assert.equal(error.failures[1].error.code, "ERR_ASSERTION");
    assert.equal(original.failureDomain, "PRIMARY_FAILURE");
    return true;
  });
});

test("unit harness preserves Release failure after COMMIT without demanding ROLLBACK", async () => {
  const release = Object.assign(new Error("release after COMMIT"), { failureDomain: "CLEANUP_FAILURE" });
  const harness = assessmentFragmentBindingGraph({ faults: { release } });
  await assert.rejects(() => harness.read(), error => {
    assert.strictEqual(error, release);
    assert.equal(release.failureDomain, "CLEANUP_FAILURE");
    return true;
  });
});


test("Envelope-read inspection guard preserves the valid nonempty scope control", async () => {
  const harness = await cleanupHarness({}, { withEnvelope: true });
  const result = await harness.run();
  assert.equal(result.envelopeManifest.length, 1);
  assert.equal(result.envelopeManifest[0].envelopeId, ENVELOPE_A);
  assert.deepEqual(result.assessmentManifest, []);
  assert.deepEqual(result.occurrenceManifest, []);
  for (const table of ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"]) {
    assert.equal(harness.calls.filter(sql => sql.includes(`FROM public.${table} `)).length, 1);
  }
  assert.equal(harness.calls.includes("COMMIT"), true);
  assert.equal(harness.calls.includes("ROLLBACK"), false);
  assert.equal(harness.calls.at(-1), "RELEASE");
});


test("Membership queries reject missing rows without proving an empty membership", async t => {
  for (const table of ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"]) {
    for (const [label, response] of [["missing rows", {}], ["undefined rows", { rows: undefined }], ["null rows", { rows: null }]]) {
      await t.test(`${table}: ${label}`, async () => {
        const harness = await cleanupHarness({}, { withEnvelope: true, membershipResults: { [table]: response } });
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
        assert.equal(harness.calls.filter(sql => sql.includes(`FROM public.${table} `)).length, 1);
        assert.equal(harness.calls.includes("COMMIT"), false);
        assert.equal(harness.calls.filter(sql => sql === "ROLLBACK").length, 1);
        assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
        assert.deepEqual(harness.calls.slice(-2), ["ROLLBACK", "RELEASE"]);
      });
    }
  }
});


test("Membership queries reject malformed result containers and rows fail closed", async t => {
  for (const table of ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"]) {
    for (const [label, response] of [["null result", null], ["array result", []], ["object rows", { rows: {} }], ["string rows", { rows: "not-an-array" }]]) {
      await t.test(`${table}: ${label}`, async () => {
        const harness = await cleanupHarness({}, { withEnvelope: true, membershipResults: { [table]: response } });
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
        assert.equal(harness.calls.filter(sql => sql.includes(`FROM public.${table} `)).length, 1);
        assert.equal(harness.calls.includes("COMMIT"), false);
        assert.equal(harness.calls.filter(sql => sql === "ROLLBACK").length, 1);
        assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
        assert.deepEqual(harness.calls.slice(-2), ["ROLLBACK", "RELEASE"]);
      });
    }
  }
});


test("Membership queries reject array result containers with own rows arrays", async t => {
  for (const table of ["rcv022_envelope_match_refs", "rcv022_envelope_assessment_refs"]) {
    await t.test(`${table}: array result with own rows array`, async () => {
      const response = [];
      response.rows = [];
      assert.equal(Array.isArray(response), true);
      assert.equal(Object.hasOwn(response, "rows"), true);
      assert.deepEqual(response.rows, []);
      const harness = await cleanupHarness({}, { withEnvelope: true, membershipResults: { [table]: response } });
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
      assert.equal(harness.calls.filter(sql => sql.includes(`FROM public.${table} `)).length, 1);
      assert.equal(harness.calls.includes("COMMIT"), false);
      assert.equal(harness.calls.filter(sql => sql === "ROLLBACK").length, 1);
      assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
      assert.deepEqual(harness.calls.slice(-2), ["ROLLBACK", "RELEASE"]);
    });
  }
});

// Integration-candidate probes only: all queries below are instrumented calls.
function independentFailureHarness({ versionRow, semanticCount = 0, operation, inspection, rollback, release, envelope = false } = {}) {
  const target = verificationTarget();
  if (versionRow) target.versionRow = versionRow(target);
  const overrides = semanticCount === 0 ? {} : {
    claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ...(semanticCount > 1 ? { claimVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } : {}),
  };
  const row = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, overrides);
  const envelopes = new Map(envelope ? [[ENVELOPE_A, row]] : []);
  const fallback = failurePool(target, envelopes);
  const calls = [];
  const delivered = [];
  const pool = {
    async connect() {
      const client = await fallback.connect();
      return {
        async query(sql, values = []) {
          calls.push(sql);
          if (sql === "ROLLBACK" && rollback) throw rollback;
          if (sql.includes("FROM public.rcv022_envelope_match_refs") && operation) throw operation;
          const result = await client.query(sql, values);
          delivered.push({ sql, result });
          return result;
        },
        async release() {
          calls.push("RELEASE");
          await Promise.resolve();
          if (release) throw release;
          client.release();
        },
      };
    },
  };
  const input = { claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: envelope ? [ref(ENVELOPE_A, row.canonical_hash)] : [], contractVersion: 1 };
  return { target, row, input, calls, delivered, inspection, run: () => getClaimLevelEvidenceView(input, pool) };
}

function assertVerificationInventory(error, paths, winner) {
  const inventory = error.verificationFailures;
  assert.ok(Array.isArray(inventory));
  assert.equal(Object.isFrozen(inventory), true);
  for (const candidate of inventory) assert.equal(Object.isFrozen(candidate), true);
  assert.deepEqual(inventory.map(candidate => candidate.path).sort(), [...paths].sort());
  assert.ok(inventory.includes(error.selectedVerificationFailure));
  assert.equal(error.selectedVerificationFailure.code, winner.code);
  assert.equal(error.selectedVerificationFailure.path, winner.path);
  return inventory;
}

async function captureIndependentRejection(harness) {
  let returned = false;
  let observed;
  await assert.rejects(async () => {
    const result = await harness.run();
    returned = true;
    return result;
  }, error => { observed = error; return true; });
  assert.equal(returned, false);
  assert.equal(harness.calls.includes("COMMIT"), false);
  assert.equal(harness.calls.filter(sql => sql === "ROLLBACK").length, 1);
  assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
  assert.deepEqual(harness.calls.slice(-2), ["ROLLBACK", "RELEASE"]);
  return observed;
}

test("independent canonical checks retain hash-format and JSON failures", async t => {
  const invalidJSON = "{";
  const sha = text => require("node:crypto").createHash("sha256").update(text, "utf8").digest("hex");
  for (const mode of ["hash only", "JSON only", "hash and JSON"]) {
    await t.test(mode, async () => {
      const harness = independentFailureHarness({ versionRow: target => ({
        ...target.versionRow,
        canonical: mode === "hash only" ? target.version.canonical : invalidJSON,
        canonical_hash: mode === "JSON only" ? sha(invalidJSON) : "not-a-hash",
      }) });
      const error = await captureIndependentRejection(harness);
      const malformed = error.verificationFailures.filter(candidate => candidate.code === "MALFORMED_DATA");
      const paths = mode === "hash only" ? ["claimVersion.canonical_hash"] : mode === "JSON only" ? ["claimVersion.canonical"] : ["claimVersion.canonical_hash", "claimVersion.canonical"];
      assert.deepEqual(malformed.map(candidate => candidate.path).sort(), paths.sort());
      const winner = mode === "hash only" ? "claimVersion.canonical_hash" : "claimVersion.canonical";
      assert.equal(error.code, "MALFORMED_DATA");
      assert.equal(error.path, winner);
      assert.equal(error.selectedVerificationFailure.path, winner);
      assert.equal(error.selectedVerificationFailure.code, "MALFORMED_DATA");
      for (const candidate of malformed) {
        assert.strictEqual(candidate.originalError.code, candidate.code);
        assert.equal(candidate.originalError.path, candidate.path);
        if (candidate.path === "claimVersion.canonical") {
          assert.ok(candidate.cause instanceof SyntaxError, "JSON.parse was actually attempted");
          assert.strictEqual(candidate.originalError.cause, candidate.cause);
        } else assert.match(candidate.message, /expected lowercase SHA-256$/);
      }
      assert.equal(Object.isFrozen(error.verificationFailures), true);
      assert.ok(error.verificationFailures.includes(error.selectedVerificationFailure));
      const delivery = harness.delivered.find(item => item.sql.includes("FROM public.claim_version_authorities"));
      assert.strictEqual(delivery.result.rows[0], harness.target.versionRow);
      assert.equal(harness.calls.some(sql => sql.includes("FROM public.claim_identity_authorities")), mode === "hash only");
    });
  }
});

test("semantic inventory survives later operational query and cleanup failures", async t => {
  for (const count of [1, 2]) {
    await t.test(`${count} semantic candidates plus query rollback and release`, async () => {
      const operation = Object.assign(new Error("query after semantic candidates"), { failureDomain: "PRIMARY_FAILURE" });
      const rollback = Object.assign(new Error("rollback"), { failureDomain: "ROLLBACK_FAILURE" });
      const release = Object.assign(new Error("release"), { failureDomain: "CLEANUP_FAILURE" });
      const harness = independentFailureHarness({ semanticCount: count, operation, rollback, release, envelope: true });
      const error = await captureIndependentRejection(harness);
      assert.ok(error instanceof FailureTransportGroup);
      const expectedPaths = ["envelope[0].semanticAnalysisEnvelope.claim_id", ...(count === 2 ? ["envelope[0].semanticAnalysisEnvelope.claim_version_id"] : [])];
      const inventory = assertVerificationInventory(error, expectedPaths, { code: "CLAIM_SCOPE_MISMATCH", path: expectedPaths[0] });
      assert.equal(error.failures.length, 3 + count);
      for (const [index, original] of [operation, rollback, release].entries()) assert.strictEqual(error.failures[index].error, original);
      assert.deepEqual(error.failures.slice(0, 3).map(item => item.phase), ["primary", "rollback", "connection-release"]);
      inventory.forEach((candidate, index) => {
        assert.strictEqual(error.failures[index + 3].error, candidate);
        assert.equal(error.failures[index + 3].phase, "verification");
        assert.equal(candidate.originalError.code, "CLAIM_SCOPE_MISMATCH");
        assert.strictEqual(candidate.originalError.cause, candidate.cause);
      });
      assert.equal(operation.failureDomain, "PRIMARY_FAILURE");
      assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
      assert.equal(release.failureDomain, "CLEANUP_FAILURE");
      assert.equal(Object.hasOwn(error, "failureDomain"), false);
      assert.equal(Object.hasOwn(error, "code"), false);
      assert.doesNotMatch(error.message, /RCV-021|RCV021/);
      assert.equal(harness.calls.some(sql => sql.includes("FROM public.rcv022_envelope_match_refs")), true);
    });
  }
});

test("semantic inventory survives a later Inspection failure with original references", async () => {
  const inspection = Object.assign(new Error("prototype inspection"), { failureDomain: "LATE_FAILURE" });
  const original = new Proxy({ failureDomain: "PRIMARY_FAILURE" }, { getPrototypeOf() { throw inspection; } });
  const rollback = Object.assign(new Error("rollback"), { failureDomain: "ROLLBACK_FAILURE" });
  const release = Object.assign(new Error("release"), { failureDomain: "CLEANUP_FAILURE" });
  const harness = independentFailureHarness({ semanticCount: 2, operation: original, rollback, release, envelope: true });
  const error = await captureIndependentRejection(harness);
  const paths = ["envelope[0].semanticAnalysisEnvelope.claim_id", "envelope[0].semanticAnalysisEnvelope.claim_version_id"];
  assertVerificationInventory(error, paths, { code: "CLAIM_SCOPE_MISMATCH", path: paths[0] });
  assert.ok(error.failures[0].error instanceof FailureTransportGroup);
  assertRetained(error.failures[0].error, [{ phase: "primary", error: original }, { phase: "inspection", error: inspection }]);
  assert.strictEqual(error.failures[1].error, rollback);
  assert.strictEqual(error.failures[2].error, release);
  assert.equal(original.failureDomain, "PRIMARY_FAILURE");
  assert.equal(inspection.failureDomain, "LATE_FAILURE");
  assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
  assert.equal(release.failureDomain, "CLEANUP_FAILURE");
});

test("semantic inventory survives cleanup failures without a query failure", async () => {
  const rollback = Object.assign(new Error("rollback"), { failureDomain: "ROLLBACK_FAILURE" });
  const release = Object.assign(new Error("release"), { failureDomain: "CLEANUP_FAILURE" });
  const harness = independentFailureHarness({ semanticCount: 2, rollback, release, envelope: true });
  const error = await captureIndependentRejection(harness);
  const paths = ["envelope[0].semanticAnalysisEnvelope.claim_id", "envelope[0].semanticAnalysisEnvelope.claim_version_id"];
  const inventory = assertVerificationInventory(error, paths, { code: "CLAIM_SCOPE_MISMATCH", path: paths[0] });
  assert.strictEqual(error.failures[0].error, rollback);
  assert.strictEqual(error.failures[1].error, release);
  inventory.forEach((candidate, index) => assert.strictEqual(error.failures[index + 2].error, candidate));
  assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
  assert.equal(release.failureDomain, "CLEANUP_FAILURE");
});

test("semantic-only inventory keeps the historical winner and every candidate", async () => {
  const harness = independentFailureHarness({ semanticCount: 2, envelope: true });
  const error = await captureIndependentRejection(harness);
  assert.equal(error.code, "CLAIM_SCOPE_MISMATCH");
  assert.equal(error.path, "envelope[0].semanticAnalysisEnvelope.claim_id");
  assert.equal(error instanceof FailureTransportGroup, false);
  const paths = ["envelope[0].semanticAnalysisEnvelope.claim_id", "envelope[0].semanticAnalysisEnvelope.claim_version_id"];
  assertVerificationInventory(error, paths, { code: "CLAIM_SCOPE_MISMATCH", path: paths[0] });
  for (const candidate of error.verificationFailures) assert.equal(candidate.originalError.code, candidate.code);
  assert.equal(Object.keys(error).includes("verificationFailures"), false);
  assert.equal(Object.keys(error).includes("selectedVerificationFailure"), false);
});

test("integration candidate valid read keeps COMMIT then awaited Release", async () => {
  const harness = independentFailureHarness({ envelope: true });
  const result = await harness.run();
  assert.equal(result.envelopeManifest.length, 1);
  assert.deepEqual(result.assessmentManifest, []);
  assert.equal(harness.calls.includes("ROLLBACK"), false);
  assert.deepEqual(harness.calls.slice(-2), ["COMMIT", "RELEASE"]);
  const release = Object.assign(new Error("release after COMMIT"), { failureDomain: "CLEANUP_FAILURE" });
  const failed = independentFailureHarness({ envelope: true, release });
  let returned = false;
  await assert.rejects(async () => { const value = await failed.run(); returned = true; return value; }, error => error === release);
  assert.equal(returned, false);
  assert.equal(failed.calls.includes("ROLLBACK"), false);
  assert.deepEqual(failed.calls.slice(-2), ["COMMIT", "RELEASE"]);
  assert.equal(release.failureDomain, "CLEANUP_FAILURE");
});

test("semantic original references and Domains survive a later operational Envelope error", async t => {
  const { ClaimLevelEvidenceViewVerificationError } = require("../dist/services/claimLevelEvidenceView");
  for (const count of [1, 2]) {
    await t.test(`${count} original semantic failures`, async () => {
      const target = verificationTarget();
      const ids = [ENVELOPE_A, ENVELOPE_B, ENVELOPE_C];
      const originals = ids.slice(0, count).map((id, index) => Object.assign(
        new ClaimLevelEvidenceViewVerificationError("MALFORMED_DATA", index === 0 ? "semanticAnalysisEnvelope.canonical_hash" : "semanticAnalysisEnvelope.canonical", `semantic original ${index}`),
        { failureDomain: "PRIMARY_FAILURE" },
      ));
      const operation = Object.assign(new Error("later Envelope query"), { failureDomain: "LATE_FAILURE" });
      const calls = [];
      const fallback = await failurePool(target, new Map()).connect();
      const pool = { async connect() { return {
        async query(sql, values = []) {
          calls.push(sql);
          if (sql.includes("FROM public.rcv022_semantic_analysis_envelopes")) {
            const index = ids.indexOf(values[0]);
            if (index < count) throw originals[index];
            throw operation;
          }
          return fallback.query(sql, values);
        },
        release() { calls.push("RELEASE"); fallback.release(); },
      }; } };
      const input = { claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: ids.slice(0, count + 1).reverse().map(id => ref(id, HASH_A)), contractVersion: 1 };
      let returned = false;
      await assert.rejects(async () => { const result = await getClaimLevelEvidenceView(input, pool); returned = true; return result; }, error => {
        assert.ok(error instanceof FailureTransportGroup);
        assert.strictEqual(error.failures[0].error, operation);
        assert.equal(error.failures[0].phase, "primary");
        assert.equal(error.failures.length, count + 1);
        assert.equal(error.verificationFailures.length, count);
        originals.forEach((original, index) => {
          const candidate = error.verificationFailures[index];
          assert.strictEqual(candidate.originalError, original);
          assert.strictEqual(error.failures[index + 1].error, candidate);
          assert.equal(original.failureDomain, "PRIMARY_FAILURE");
          assert.equal(candidate.path, `envelope[${index}].${original.path}`);
        });
        assert.strictEqual(error.selectedVerificationFailure, error.verificationFailures[0]);
        assert.equal(error.selectedVerificationFailure.code, "MALFORMED_DATA");
        assert.equal(error.selectedVerificationFailure.path, "envelope[0].semanticAnalysisEnvelope.canonical_hash");
        assert.equal(operation.failureDomain, "LATE_FAILURE");
        assert.equal(Object.hasOwn(error, "failureDomain"), false);
        return true;
      });
      assert.equal(returned, false);
      assert.equal(calls.includes("COMMIT"), false);
      assert.equal(calls.filter(sql => sql === "ROLLBACK").length, 1);
      assert.equal(calls.filter(sql => sql === "RELEASE").length, 1);
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "RELEASE"]);
    });
  }
});


// Two-gap correction probes: one selected member, unmodified query delivery,
// and no database. Existing fixtures supply all non-target authority fields.
function membershipCollectionHarness(kind, { badHash = false, badJSON = false, membershipEdit, fixture = fragmentCaptureFixture(), faults = {} } = {}) {
  const target = verificationTarget();
  const match = validMatch(target, { evidenceFragmentCanonicalHash: fixture.fragmentBuilt.hash });
  const assessment = kind === "Assessment" ? validAssessment(target, match, fixture) : null;
  const authority = assessment ?? match;
  if (badJSON) {
    authority.canonical = "{";
    authority.canonical_hash = require("node:crypto").createHash("sha256").update(authority.canonical, "utf8").digest("hex");
  }
  const memberId = kind === "Match" ? MATCH_ID : ASSESSMENT_ID;
  const membership = { ordinal: 0, id: memberId, canonical_version: 1, canonical_hash: authority.canonical_hash };
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: [{ id: MATCH_ID, canonicalVersion: 1, canonicalHash: match.canonical_hash }],
    assessmentRefs: assessment ? [{ id: ASSESSMENT_ID, canonicalVersion: 1, canonicalHash: assessment.canonical_hash }] : [],
  });
  if (badHash) membership.canonical_hash = "not-a-hash";
  if (membershipEdit) Object.assign(membership, membershipEdit);
  const support = assessment ? [{ ...membership, authorityRow: assessment }] : [];
  const fallback = fragmentFailurePool(target, new Map([[ENVELOPE_A, envelope]]), match, fixture.fragmentRow, fixture.captureRow, false, support);
  const membershipTable = kind === "Match" ? "rcv022_envelope_match_refs" : "rcv022_envelope_assessment_refs";
  const authorityTable = kind === "Match" ? "rcv022_claim_evidence_matches" : "rcv022_evidence_assessments";
  const calls = [], deliveries = [];
  const pool = { async connect() {
    const client = await fallback.connect();
    return {
      async query(sql, values = []) {
        calls.push(sql);
        if (sql === "ROLLBACK" && Object.hasOwn(faults, "rollback")) throw faults.rollback;
        const table = sql.match(/FROM public\.([a-z_0-9]+)/)?.[1];
        const result = table === membershipTable ? { rows: [membership] } : await client.query(sql, values);
        deliveries.push({ table, values, result });
        return result;
      },
      async release() {
        calls.push("RELEASE");
        if (Object.hasOwn(faults, "release")) throw faults.release;
        await client.release();
      },
    };
  } };
  const spec = { claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 };
  return { kind, calls, deliveries, membership, authority, memberId, membershipTable, authorityTable, fixture, run: () => getClaimLevelEvidenceView(spec, pool) };
}

function assertCollectionLookup(harness) {
  const members = harness.deliveries.filter(entry => entry.table === harness.membershipTable);
  assert.equal(members.length, 1);
  assert.strictEqual(members[0].result.rows[0], harness.membership);
  const authorities = harness.deliveries.filter(entry => entry.table === harness.authorityTable);
  assert.equal(authorities.length, 1, "the selected Authority read must be reached exactly once");
  assert.deepEqual(authorities[0].values, [harness.memberId]);
  assert.strictEqual(authorities[0].result.rows[0], harness.authority);
}

for (const kind of ["Match", "Assessment"]) {
  const membershipRoot = kind === "Match" ? "matchRefs" : "assessmentRefs";
  const canonicalRoot = kind === "Match" ? "claimEvidenceMatch" : "evidenceAssessment";
  const hashPath = `envelope[0].${membershipRoot}[0].canonical_hash`;
  const jsonPath = `envelope[0].${canonicalRoot}.canonical`;
  test(`${kind} Membership hash does not suppress independent Authority JSON verification`, async t => {
    for (const mode of ["valid", "hash only", "JSON only", "hash and JSON"]) {
      await t.test(mode, async () => {
        const badHash = mode === "hash only" || mode === "hash and JSON";
        const badJSON = mode === "JSON only" || mode === "hash and JSON";
        const harness = membershipCollectionHarness(kind, { badHash, badJSON });
        if (mode === "valid") {
          const result = await harness.run();
          assert.equal(result.assessmentManifest.length, kind === "Assessment" ? 1 : 0);
          assert.equal(harness.calls.filter(sql => sql === "COMMIT").length, 1);
          assert.equal(harness.calls.includes("ROLLBACK"), false);
          assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
          assert.deepEqual(harness.calls.slice(-2), ["COMMIT", "RELEASE"]);
        } else {
          const error = await captureIndependentRejection(harness);
          const paths = [...(badHash ? [hashPath] : []), ...(badJSON ? [jsonPath] : [])];
          // Both have rank MALFORMED_DATA=0. Existing UTF-8 order puts
          // claimEvidenceMatch before matchRefs, but assessmentRefs before evidenceAssessment.
          const winner = badJSON && (!badHash || kind === "Match") ? jsonPath : hashPath;
          const inventory = assertVerificationInventory(error, paths, { code: "MALFORMED_DATA", path: winner });
          assert.equal(error.code, "MALFORMED_DATA");
          assert.equal(error.path, winner);
          for (const candidate of inventory) assert.equal(candidate.code, "MALFORMED_DATA");
          if (badJSON) assert.ok(inventory.find(candidate => candidate.path === jsonPath).cause instanceof SyntaxError);
          if (badHash) assert.equal(harness.membership.canonical_hash, "not-a-hash");
        }
        assertCollectionLookup(harness);
      });
    }
  });
  test(`${kind} Membership invalid lookup prerequisites do not read the Authority`, async t => {
    for (const [field, value, suffix, code] of [
      ["id", "not-a-uuid", "id", "MALFORMED_DATA"],
      ["canonical_version", "1", "canonicalVersion", "UNSUPPORTED_VERSION"],
      ["ordinal", "0", "ordinal", "MALFORMED_DATA"],
    ]) {
      await t.test(field, async () => {
        const harness = membershipCollectionHarness(kind, { badHash: true, membershipEdit: { [field]: value } });
        const error = await captureIndependentRejection(harness);
        assert.equal(harness.calls.some(sql => sql.includes(`FROM public.${harness.authorityTable} `)), false);
        const delivered = harness.deliveries.find(entry => entry.table === harness.membershipTable);
        assert.strictEqual(delivered.result.rows[0], harness.membership);
        assert.ok(error.verificationFailures.some(candidate => candidate.path === `envelope[0].${membershipRoot}[0].${suffix}` && candidate.code === code));
        assert.ok(error.verificationFailures.some(candidate => candidate.path === hashPath && candidate.code === "MALFORMED_DATA"));
      });
    }
  });
  test(`${kind} combined Membership findings survive Rollback and Release failures`, async () => {
    const rollback = Object.assign(new Error("rollback after independent Membership findings"), { failureDomain: "ROLLBACK_FAILURE" });
    const release = Object.assign(new Error("release after independent Membership findings"), { failureDomain: "CLEANUP_FAILURE" });
    const harness = membershipCollectionHarness(kind, { badHash: true, badJSON: true, faults: { rollback, release } });
    const error = await captureIndependentRejection(harness);
    assert.ok(error instanceof FailureTransportGroup);
    const winner = kind === "Match" ? jsonPath : hashPath;
    const inventory = assertVerificationInventory(error, [hashPath, jsonPath], { code: "MALFORMED_DATA", path: winner });
    assert.equal(error.failures.length, 4);
    assert.strictEqual(error.failures[0].error, rollback);
    assert.equal(error.failures[0].phase, "rollback");
    assert.strictEqual(error.failures[1].error, release);
    assert.equal(error.failures[1].phase, "connection-release");
    inventory.forEach((candidate, index) => { assert.strictEqual(error.failures[index + 2].error, candidate); assert.equal(error.failures[index + 2].phase, "verification"); });
    assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
    assert.equal(release.failureDomain, "CLEANUP_FAILURE");
    assert.equal(Object.hasOwn(error, "failureDomain"), false);
    assertCollectionLookup(harness);
  });
}

function captureCollectionHarness(values = {}, faults = {}) {
  const input = { ...fragmentCaptureFixture().captureInput, finalUrl: null, ...values };
  const built = historicalCaptureCanonical(input);
  const fixture = fragmentCaptureFixture({ input, row: captureRow(input, built) });
  return membershipCollectionHarness("Match", { fixture, faults });
}

test("Capture independent field findings precede dependent reconstruction", async t => {
  for (const mode of ["missing final_url", "invalid response_status", "both"]) {
    await t.test(mode, async () => {
      const harness = captureCollectionHarness();
      const row = harness.fixture.captureRow;
      const canonical = row.canonical, hash = row.capture_hash;
      assert.strictEqual(JSON.parse(canonical).finalUrl, null);
      const missing = mode !== "invalid response_status";
      const invalid = mode !== "missing final_url";
      if (missing) delete row.final_url;
      if (invalid) row.response_status = "200";
      const error = await captureIndependentRejection(harness);
      const paths = [...(missing ? ["envelope[0].capture.final_url"] : []), ...(invalid ? ["envelope[0].capture.response_status"] : [])];
      const winner = missing ? "envelope[0].capture.final_url" : "envelope[0].capture.response_status";
      assertVerificationInventory(error, paths, { code: "MALFORMED_DATA", path: winner });
      assert.equal(error.code, "MALFORMED_DATA");
      assert.equal(error.path, winner);
      assert.equal(row.canonical, canonical);
      assert.equal(row.capture_hash, hash);
      const delivery = harness.deliveries.filter(entry => entry.table === "rcv020_captures");
      assert.equal(delivery.length, 1);
      assert.strictEqual(delivery[0].result.rows[0], row);
      if (missing) assert.equal(Object.hasOwn(row, "final_url"), false);
      if (invalid) assert.strictEqual(row.response_status, "200");
    });
  }
  for (const [mode, values] of [
    ["present nulls", {}],
    ["present text", { finalUrl: "https://example.test/capture", redirectCanonical: "[]", rawObjectIdentity: "unit-object-identity", rawObjectReference: "unit-object-reference" }],
  ]) {
    await t.test(mode, async () => {
      const harness = captureCollectionHarness(values);
      const row = harness.fixture.captureRow;
      const canonical = JSON.parse(row.canonical);
      assert.equal(Object.hasOwn(canonical, "rawObjectReference"), false);
      for (const field of nullableCaptureFields) assert.equal(Object.hasOwn(row, field), true);
      if (mode === "present nulls") for (const field of nullableCaptureFields) assert.strictEqual(row[field], null);
      const result = await harness.run();
      assert.equal(result.envelopeManifest.length, 1);
      assert.equal(harness.calls.filter(sql => sql === "COMMIT").length, 1);
      assert.equal(harness.calls.includes("ROLLBACK"), false);
      assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
      assert.deepEqual(harness.calls.slice(-2), ["COMMIT", "RELEASE"]);
      assertCollectionLookup(harness);
    });
  }
});

test("Capture combined field findings survive Rollback and Release failures", async () => {
  const rollback = Object.assign(new Error("rollback after Capture findings"), { failureDomain: "ROLLBACK_FAILURE" });
  const release = Object.assign(new Error("release after Capture findings"), { failureDomain: "CLEANUP_FAILURE" });
  const harness = captureCollectionHarness({}, { rollback, release });
  delete harness.fixture.captureRow.final_url;
  harness.fixture.captureRow.response_status = "200";
  const error = await captureIndependentRejection(harness);
  const paths = ["envelope[0].capture.response_status", "envelope[0].capture.final_url"];
  const inventory = assertVerificationInventory(error, paths, { code: "MALFORMED_DATA", path: "envelope[0].capture.final_url" });
  assert.ok(error instanceof FailureTransportGroup);
  assert.equal(error.failures.length, 4);
  assert.strictEqual(error.failures[0].error, rollback);
  assert.equal(error.failures[0].phase, "rollback");
  assert.strictEqual(error.failures[1].error, release);
  assert.equal(error.failures[1].phase, "connection-release");
  inventory.forEach((candidate, index) => { assert.strictEqual(error.failures[index + 2].error, candidate); assert.equal(error.failures[index + 2].phase, "verification"); });
  assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
  assert.equal(release.failureDomain, "CLEANUP_FAILURE");
  assert.equal(Object.hasOwn(error, "failureDomain"), false);
});


test("Capture all six boundary guards collect before reconstruction is blocked", async () => {
  const harness = captureCollectionHarness();
  const row = harness.fixture.captureRow;
  row.response_status = "200";
  row.retention_policy_version = "1";
  delete row.final_url;
  row.redirect_canonical = undefined;
  row.raw_object_identity = {};
  row.raw_object_reference = 7;
  const error = await captureIndependentRejection(harness);
  const paths = ["response_status", "retention_policy_version", "final_url", "redirect_canonical", "raw_object_identity", "raw_object_reference"].map(field => `envelope[0].capture.${field}`);
  const inventory = assertVerificationInventory(error, paths, { code: "MALFORMED_DATA", path: "envelope[0].capture.final_url" });
  assert.equal(error.path, "envelope[0].capture.final_url");
  for (const candidate of inventory) assert.equal(candidate.code, "MALFORMED_DATA");
  const delivery = harness.deliveries.filter(entry => entry.table === "rcv020_captures");
  assert.equal(delivery.length, 1);
  assert.strictEqual(delivery[0].result.rows[0], row);
});


// Capture-observation probes. Query offers intentionally allow a second answer;
// the harness does not itself enforce the reader's one-observation requirement.
function captureObservationHarness({ differentCaptureIds = false, conflictingSecond = false, faults = {}, captureQueryRows } = {}) {
  const target = verificationTarget();
  const firstInput = { ...fragmentCaptureFixture().captureInput, finalUrl: null };
  const secondInput = {
    ...firstInput,
    captureId: differentCaptureIds ? "97000000-0000-4000-8000-000000000002" : firstInput.captureId,
    finalUrl: differentCaptureIds || conflictingSecond ? "https://example.test/second-capture" : null,
  };
  const inputs = [firstInput, secondInput];
  const built = inputs.map(input => historicalCaptureCanonical(input));
  const captureRows = inputs.map((input, index) => captureRow(input, built[index]));
  const fragmentIds = [FRAGMENT_ID, "97000000-0000-4000-8000-000000000102"];
  const matchIds = [MATCH_ID, "97000000-0000-4000-8000-000000000202"];
  const fragments = inputs.map((input, index) => {
    const fixture = fragmentCaptureFixture({ input, row: captureRows[index] });
    const { schema, canonicalVersion, ...fragmentInput } = JSON.parse(fixture.fragmentRow.canonical);
    const canonical = buildEvidenceFragmentCanonical({ ...fragmentInput, fragmentId: fragmentIds[index] });
    return { ...fixture.fragmentRow, fragment_id: fragmentIds[index], canonical: canonical.canonical, canonical_hash: canonical.hash };
  });
  const matches = fragments.map((fragment, index) => {
    const row = validMatch(target, { matchId: matchIds[index], evidenceFragmentId: fragment.fragment_id, evidenceFragmentCanonicalHash: fragment.canonical_hash });
    // validMatch's original single-member fixture fixes its projection ID.
    // This local two-member fixture supplies the corresponding second ID.
    row.match_id = matchIds[index];
    assert.equal(JSON.parse(row.canonical).matchId, row.match_id);
    return row;
  });
  const memberships = matches.map((row, ordinal) => ({ ordinal, id: row.match_id, canonical_version: 1, canonical_hash: row.canonical_hash }));
  const envelope = validEmptyEnvelope(target, ENVELOPE_A, target.claim.hash, {
    matchRefs: memberships.map(row => ({ id: row.id, canonicalVersion: row.canonical_version, canonicalHash: row.canonical_hash })),
  });
  const offers = new Map();
  inputs.forEach((input, index) => {
    if (!offers.has(input.captureId)) offers.set(input.captureId, []);
    offers.get(input.captureId).push(captureRows[index]);
  });
  const matchRows = new Map(matches.map(row => [row.match_id, row]));
  const fragmentRows = new Map(fragments.map(row => [row.fragment_id, row]));
  const calls = [], deliveries = [], captureAttempts = [];
  let connections = 0;
  const pool = { async connect() {
    const run = connections++;
    const cursors = new Map();
    return {
      async query(sql, values = []) {
        calls.push(sql);
        if (sql === "ROLLBACK" && Object.hasOwn(faults, "rollback")) throw faults.rollback;
        if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        const table = sql.match(/FROM public\.([a-z_0-9]+)/)?.[1];
        let rows;
        if (table === "claim_version_authorities") { assert.deepEqual(values, [CLAIM_VERSION_ID]); rows = [target.versionRow]; }
        else if (table === "claim_identity_authorities") { assert.deepEqual(values, [target.claimId]); rows = [{ claim_id: target.claimId, canonical_version: 1, canonical: target.claim.canonical, canonical_hash: target.claim.hash }]; }
        else if (table === "rcv022_semantic_analysis_envelopes") { assert.deepEqual(values, [ENVELOPE_A]); rows = [envelope]; }
        else if (table === "rcv022_envelope_match_refs") { assert.deepEqual(values, [ENVELOPE_A]); rows = memberships; }
        else if (table === "rcv022_envelope_assessment_refs") { assert.deepEqual(values, [ENVELOPE_A]); rows = []; }
        else if (table === "rcv022_claim_evidence_matches") { assert.equal(matchRows.has(values[0]), true); rows = [matchRows.get(values[0])]; }
        else if (table === "rcv022_evidence_fragments") { assert.equal(fragmentRows.has(values[0]), true); rows = [fragmentRows.get(values[0])]; }
        else if (table === "rcv020_captures") {
          assert.equal(offers.has(values[0]), true);
          const attempt = cursors.get(values[0]) ?? 0;
          cursors.set(values[0], attempt + 1);
          const available = offers.get(values[0]);
          const row = available[Math.min(attempt, available.length - 1)];
          captureAttempts.push({ run, captureId: values[0], attempt: attempt + 1, row });
          if (Object.hasOwn(faults, "capture")) throw faults.capture;
          rows = captureQueryRows === undefined ? [row] : captureQueryRows(row);
        } else throw new Error(`unexpected Capture-observation query: ${sql}`);
        deliveries.push({ run, table, values, rows });
        return { rows };
      },
      async release() {
        calls.push("RELEASE");
        await Promise.resolve();
        if (Object.hasOwn(faults, "release")) throw faults.release;
      },
    };
  } };
  const spec = { claimVersionRef: { claimVersionId: CLAIM_VERSION_ID, canonicalVersion: 1, canonicalHash: target.version.hash }, envelopeManifest: [ref(ENVELOPE_A, envelope.canonical_hash)], contractVersion: 1 };
  return { calls, deliveries, captureAttempts, captureRows, fragments, fragmentIds, matches, matchIds, inputs, offers, run: () => getClaimLevelEvidenceView(spec, pool) };
}

function assertCaptureObservationPaths(harness) {
  for (const [table, ids] of [["rcv022_claim_evidence_matches", harness.matchIds], ["rcv022_evidence_fragments", harness.fragmentIds]]) {
    const observed = harness.deliveries.filter(entry => entry.table === table).map(entry => entry.values[0]);
    assert.deepEqual(observed, ids, `${table}: both production dependency paths must be reached`);
  }
}

function assertCaptureObservationSuccess(harness, result) {
  assert.equal(result.envelopeManifest.length, 1);
  assert.deepEqual(result.assessmentManifest, []);
  assert.equal(harness.calls.filter(sql => sql === "COMMIT").length, 1);
  assert.equal(harness.calls.includes("ROLLBACK"), false);
  assert.equal(harness.calls.filter(sql => sql === "RELEASE").length, 1);
  assert.deepEqual(harness.calls.slice(-2), ["COMMIT", "RELEASE"]);
  assertCaptureObservationPaths(harness);
}

test("Capture observation shares one valid projection across two distinct Fragments", async () => {
  const harness = captureObservationHarness();
  assert.notEqual(harness.fragmentIds[0], harness.fragmentIds[1]);
  assert.equal(harness.inputs[0].captureId, harness.inputs[1].captureId);
  assert.notStrictEqual(harness.captureRows[0], harness.captureRows[1]);
  const result = await harness.run();
  assertCaptureObservationSuccess(harness, result);
  assert.equal(harness.captureAttempts.length, 1);
  assert.strictEqual(harness.captureAttempts[0].row, harness.captureRows[0]);
});

test("Capture observation rejects incompatible same-ID commitments without consuming the second offer", async () => {
  const harness = captureObservationHarness({ conflictingSecond: true });
  assert.equal(harness.captureRows[0].capture_id, harness.captureRows[1].capture_id);
  assert.notEqual(harness.captureRows[0].capture_hash, harness.captureRows[1].capture_hash);
  for (const [index, row] of harness.captureRows.entries()) {
    assert.equal(JSON.parse(row.canonical).finalUrl, harness.inputs[index].finalUrl);
    assert.equal(row.capture_hash, historicalCaptureCanonical(harness.inputs[index]).hash);
    assert.equal(harness.fragments[index].capture_canonical_hash, row.capture_hash);
  }
  const error = await captureIndependentRejection(harness);
  const path = "envelope[0].evidenceFragment.capture.capture_hash";
  assertVerificationInventory(error, [path], { code: "HASH_MISMATCH", path });
  assert.equal(error.code, "HASH_MISMATCH");
  assert.equal(error.path, path);
  assertCaptureObservationPaths(harness);
  assert.equal(harness.captureAttempts.length, 1);
  assert.strictEqual(harness.captureAttempts[0].row, harness.captureRows[0]);
  assert.equal(harness.deliveries.some(entry => entry.table === "rcv020_captures" && entry.rows[0] === harness.captureRows[1]), false);
});

test("Capture observation never replaces failed fields canonical or hash with a later valid offer", async t => {
  for (const mode of ["status", "missing final_url", "both fields", "canonical", "hash"]) {
    await t.test(mode, async () => {
      const harness = captureObservationHarness();
      const first = harness.captureRows[0], second = harness.captureRows[1];
      if (mode === "status" || mode === "both fields") first.response_status = "200";
      if (mode === "missing final_url" || mode === "both fields") delete first.final_url;
      if (mode === "canonical") first.canonical = "{";
      if (mode === "hash") first.capture_hash = HASH_C;
      assert.equal(second.response_status, 200);
      assert.strictEqual(second.final_url, null);
      assert.equal(second.capture_hash, historicalCaptureCanonical(harness.inputs[1]).hash);
      const error = await captureIndependentRejection(harness);
      assertCaptureObservationPaths(harness);
      assert.equal(harness.captureAttempts.length, 1);
      assert.strictEqual(harness.captureAttempts[0].row, first);
      const fieldPaths = mode === "both fields" ? ["capture.response_status", "capture.final_url"] : mode === "status" ? ["capture.response_status"] : mode === "missing final_url" ? ["capture.final_url"] : mode === "canonical" ? ["evidenceFragment.capture.canonical"] : ["evidenceFragment.capture.capture_hash"];
      const code = mode === "hash" ? "HASH_MISMATCH" : "MALFORMED_DATA";
      const expectedWinner = mode === "both fields" ? "capture.final_url" : fieldPaths[0];
      assert.equal(error.code, code);
      assert.equal(error.path, `envelope[0].${expectedWinner}`);
      for (const localPath of fieldPaths) {
        const candidates = error.verificationFailures.filter(candidate => candidate.path === `envelope[0].${localPath}` && candidate.code === code && (mode !== "hash" || candidate.message.endsWith(": Capture canonical hash differs")));
        assert.equal(candidates.length, 2, "both Fragment paths retain the observed failure");
        assert.strictEqual(candidates[0].originalError, candidates[1].originalError, "reused observation preserves its original failure identity");
        assert.ok(candidates[0].originalError);
      }
    });
  }
});

test("Capture observations keep distinct Capture IDs independent", async () => {
  const harness = captureObservationHarness({ differentCaptureIds: true });
  assert.notEqual(harness.inputs[0].captureId, harness.inputs[1].captureId);
  assert.notEqual(harness.captureRows[0].capture_hash, harness.captureRows[1].capture_hash);
  const result = await harness.run();
  assertCaptureObservationSuccess(harness, result);
  assert.equal(harness.captureAttempts.length, 2);
  assert.deepEqual(harness.captureAttempts.map(entry => entry.captureId), harness.inputs.map(input => input.captureId));
  assert.deepEqual(harness.captureAttempts.map(entry => entry.attempt), [1, 1]);
  harness.captureAttempts.forEach((entry, index) => assert.strictEqual(entry.row, harness.captureRows[index]));
});

test("Capture observations end with their Reader call including a failed first call", async () => {
  const harness = captureObservationHarness();
  harness.captureRows[0].response_status = "200";
  const firstError = await captureIndependentRejection(harness);
  const priorFailures = [...firstError.verificationFailures];
  assert.equal(harness.captureAttempts.length, 1);
  const boundary = harness.calls.length;
  // A new adapter projection in a new Reader invocation, not a repair by the Reader.
  harness.captureRows[0].response_status = 200;
  const result = await harness.run();
  assert.equal(result.envelopeManifest.length, 1);
  assert.equal(harness.captureAttempts.length, 2);
  assert.deepEqual(harness.captureAttempts.map(entry => entry.run), [0, 1]);
  assert.deepEqual(harness.captureAttempts.map(entry => entry.attempt), [1, 1]);
  assert.equal(harness.calls.slice(boundary).filter(sql => sql === "COMMIT").length, 1);
  assert.equal(harness.calls.slice(boundary).includes("ROLLBACK"), false);
  assert.equal(harness.calls.slice(boundary).filter(sql => sql === "RELEASE").length, 1);
  assert.deepEqual(firstError.verificationFailures, priorFailures);
});

test("Capture observed failures and operational Cleanup originals remain together", async () => {
  const rollback = Object.assign(new Error("rollback after observed Capture failure"), { failureDomain: "ROLLBACK_FAILURE" });
  const release = Object.assign(new Error("release after observed Capture failure"), { failureDomain: "CLEANUP_FAILURE" });
  const harness = captureObservationHarness({ faults: { rollback, release } });
  harness.captureRows[0].response_status = "200";
  delete harness.captureRows[0].final_url;
  const error = await captureIndependentRejection(harness);
  assert.ok(error instanceof FailureTransportGroup);
  assertCaptureObservationPaths(harness);
  assert.equal(harness.captureAttempts.length, 1);
  assert.strictEqual(error.failures[0].error, rollback);
  assert.strictEqual(error.failures[1].error, release);
  assert.equal(error.failures[0].phase, "rollback");
  assert.equal(error.failures[1].phase, "connection-release");
  const inventory = error.verificationFailures;
  assert.equal(inventory.length, 4);
  for (const path of ["envelope[0].capture.response_status", "envelope[0].capture.final_url"]) {
    const candidates = inventory.filter(candidate => candidate.path === path);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].code, "MALFORMED_DATA");
    assert.strictEqual(candidates[0].originalError, candidates[1].originalError);
  }
  assert.equal(error.selectedVerificationFailure.path, "envelope[0].capture.final_url");
  assert.equal(error.failures.length, 2 + inventory.length);
  inventory.forEach((candidate, index) => assert.strictEqual(error.failures[index + 2].error, candidate));
  assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
  assert.equal(release.failureDomain, "CLEANUP_FAILURE");
  assert.equal(Object.hasOwn(error, "failureDomain"), false);
});

test("Capture query failure keeps its original identity with Rollback and Release failures", async () => {
  const original = Object.assign(new Error("Capture query"), { failureDomain: "PRIMARY_FAILURE" });
  const rollback = Object.assign(new Error("rollback"), { failureDomain: "ROLLBACK_FAILURE" });
  const release = Object.assign(new Error("release"), { failureDomain: "CLEANUP_FAILURE" });
  const harness = captureObservationHarness({ faults: { capture: original, rollback, release } });
  const error = await captureIndependentRejection(harness);
  assertRetained(error, [{ phase: "primary", error: original }, { phase: "rollback", error: rollback }, { phase: "connection-release", error: release }]);
  assert.equal(harness.captureAttempts.length, 1);
  assert.equal(original.failureDomain, "PRIMARY_FAILURE");
  assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
  assert.equal(release.failureDomain, "CLEANUP_FAILURE");
});


test("Capture observation preserves a semantic field finding before a later operational access error", async () => {
  const original = Object.assign(new Error("Capture field access"), { failureDomain: "LATE_FAILURE" });
  const rollback = Object.assign(new Error("rollback"), { failureDomain: "ROLLBACK_FAILURE" });
  const release = Object.assign(new Error("release"), { failureDomain: "CLEANUP_FAILURE" });
  const harness = captureObservationHarness({ faults: { rollback, release } });
  harness.captureRows[0].response_status = "200";
  Object.defineProperty(harness.captureRows[0], "final_url", { enumerable: true, configurable: true, get() { throw original; } });
  const error = await captureIndependentRejection(harness);
  const path = "envelope[0].capture.response_status";
  const inventory = assertVerificationInventory(error, [path], { code: "MALFORMED_DATA", path });
  assert.ok(error instanceof FailureTransportGroup);
  assert.equal(error.failures.length, 4);
  assert.strictEqual(error.failures[0].error, original);
  assert.strictEqual(error.failures[1].error, rollback);
  assert.strictEqual(error.failures[2].error, release);
  assert.strictEqual(error.failures[3].error, inventory[0]);
  assert.equal(harness.captureAttempts.length, 1);
  assert.equal(original.failureDomain, "LATE_FAILURE");
  assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
  assert.equal(release.failureDomain, "CLEANUP_FAILURE");
});

test("Capture observation inspection retains the original query failure and Cleanup errors", async () => {
  const inspection = Object.assign(new Error("Capture failure inspection"), { failureDomain: "LATE_FAILURE" });
  const original = new Proxy({ failureDomain: "PRIMARY_FAILURE" }, { getPrototypeOf() { throw inspection; } });
  const rollback = Object.assign(new Error("rollback"), { failureDomain: "ROLLBACK_FAILURE" });
  const release = Object.assign(new Error("release"), { failureDomain: "CLEANUP_FAILURE" });
  const harness = captureObservationHarness({ faults: { capture: original, rollback, release } });
  const error = await captureIndependentRejection(harness);
  assert.ok(error instanceof FailureTransportGroup);
  assert.equal(error.failures.length, 3);
  assertRetained(error.failures[0].error, [{ phase: "primary", error: original }, { phase: "inspection", error: inspection }]);
  assert.strictEqual(error.failures[1].error, rollback);
  assert.strictEqual(error.failures[2].error, release);
  assert.equal(harness.captureAttempts.length, 1);
  assert.equal(original.failureDomain, "PRIMARY_FAILURE");
  assert.equal(inspection.failureDomain, "LATE_FAILURE");
  assert.equal(rollback.failureDomain, "ROLLBACK_FAILURE");
  assert.equal(release.failureDomain, "CLEANUP_FAILURE");
});

test("Capture authority query rejects array-like rows through the production reader", async () => {
  let offeredRows;
  const harness = captureObservationHarness({ captureQueryRows(row) {
    offeredRows = { 0: row, length: 1 };
    return offeredRows;
  } });
  const error = await captureIndependentRejection(harness);
  assert.ok(error instanceof Error);
  assert.equal(error.message, "Claim-Level authority query result must contain a rows array");
  assert.equal(Object.hasOwn(error, "code"), false);
  const delivered = harness.deliveries.filter(entry => entry.table === "rcv020_captures");
  assert.equal(delivered.length, 1);
  assert.equal(harness.captureAttempts.length, 1);
  assert.strictEqual(delivered[0].rows, offeredRows);
  assert.equal(Array.isArray(offeredRows), false);
  assert.equal(offeredRows.length, 1);
  assert.strictEqual(offeredRows[0], harness.captureRows[0]);
});

test("Capture authority query accepts genuine rows arrays through the same production path", async () => {
  let offeredRows;
  const harness = captureObservationHarness({ captureQueryRows(row) {
    offeredRows = [row];
    return offeredRows;
  } });
  const result = await harness.run();
  assertCaptureObservationSuccess(harness, result);
  const delivered = harness.deliveries.filter(entry => entry.table === "rcv020_captures");
  assert.equal(delivered.length, 1);
  assert.equal(harness.captureAttempts.length, 1);
  assert.strictEqual(delivered[0].rows, offeredRows);
  assert.equal(Array.isArray(offeredRows), true);
  assert.strictEqual(offeredRows[0], harness.captureRows[0]);
});
