const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Pool } = require("pg");

const {
  ClaimLevelEvidenceViewInputError,
  prepareClaimLevelEvidenceViewSpec,
} = require("../dist/services/claimLevelEvidenceView");

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
  const executableSource = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(executableSource, /Pool|client|query|\bSELECT\s|\bFROM\s+public|database/i);
  assert.doesNotMatch(executableSource, /latest|cutoff|trusted|approved|scheduler|current/i);
  assert.doesNotMatch(executableSource, /rcv022Reader|rcv022Writer|AssessmentManifest|OccurrenceManifest/i);
});
