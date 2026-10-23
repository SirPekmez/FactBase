const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { FailureTransportGroup, throwRetainedFailures } = require("../dist/services/failureTransport");
const { Pool } = require("pg");

const {
  ClaimLevelEvidenceViewInputError,
  getClaimLevelEvidenceView,
  prepareClaimLevelEvidenceViewSpec,
} = require("../dist/services/claimLevelEvidenceView");
const { buildClaimIdentityCanonical, buildClaimVersionCanonical } = require("../dist/services/claimHistoricalAuthorityCanonical");
const { buildClaimEvidenceMatchCanonical, buildEvidenceAssessmentCanonical, buildEvidenceFragmentCanonical, buildSemanticAnalysisEnvelopeCanonical } = require("../dist/services/rcv022Canonical");
const { canonicalizeRcv020Capture } = require("../dist/services/rcv020SemanticCore");

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

test("three same-Envelope failures keep the same winner when local encounter order is reversed", async () => {
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
  const reversed = await run(makePool());
  assert.deepEqual(reversed, first);
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
    (error) => error instanceof Error && !("code" in error) && error.message === "operational capture query failure",
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
