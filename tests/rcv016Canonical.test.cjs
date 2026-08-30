const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RCV016_TECHNICAL_ERROR_CODES,
  Rcv016CanonicalizationError,
  Rcv016HashIntegrityError,
  Rcv016PayloadLimitError,
  Rcv016UnsupportedContractVersionError,
  Rcv016ValidationError,
  canonicalizeRcv016,
  sha256Rcv016Text,
  validateRcv016CanonicalTimestamp,
  validateRcv016CanonicalUuid,
  validateRcv016SchemaIdentity,
} = require("../dist/services/rcv016Canonical");

const PHASE_1_MODULES = [
  require("../dist/services/rcv016Canonical"),
  require("../dist/services/rcv016Validation"),
  require("../dist/services/rcv016PayloadLimits"),
  require("../dist/services/rcv016SourceMetadata"),
  require("../dist/services/rcv016ArtifactCapture"),
  require("../dist/services/rcv016Foundation"),
  require("../dist/services/rcv016TraversalPolicy"),
];

test("RCV-016 JCS golden vectors preserve the frozen canonical boundary", () => {
  const cases = [
    {
      value: { z: { b: 2, a: 1 }, a: [3, 2, 1] },
      canonical: '{"a":[3,2,1],"z":{"a":1,"b":2}}',
      hash: "f613a572f53e0e577f557af7e41633d7c30546ae97e1e20b8ad0dbea7118d7a6",
    },
    {
      value: { text: 'quote:" slash:\\ controls:\b\f\n\r\t' },
      canonical: '{"text":"quote:\\" slash:\\\\ controls:\\b\\f\\n\\r\\t"}',
      hash: "d6f4c403bd0c967e31f7c1e1e428db7f1effcde2ce8a733c5722ce25439a06e5",
    },
    {
      value: { actualNul: "\u0000", literalEscape: "\\u0000" },
      canonical: '{"actualNul":"\\u0000","literalEscape":"\\\\u0000"}',
      hash: "21de2f5169ff2aad38e55d4315932445964e2b7c4af0525967c14ed328e7a4f2",
    },
    {
      value: { "\u20ac": "BMP", "\ud83d\ude02": "non-BMP", "\ufb33": "BMP-high" },
      canonical: '{"€":"BMP","😂":"non-BMP","דּ":"BMP-high"}',
      hash: "2cb5514c887d0ce90e5a39c7e5b56f8a568bf2335beb95a77eec9af861242415",
    },
    {
      value: { numbers: [-0, 1e30, 1e-27, 0.002] },
      canonical: '{"numbers":[0,1e+30,1e-27,0.002]}',
      hash: "3c17692c80a2d90593b378d95ee45a226f0f5e9b201960756918a8984162be69",
    },
  ];

  for (const fixture of cases) {
    assert.deepEqual(canonicalizeRcv016(fixture.value), {
      canonical: fixture.canonical,
      hash: fixture.hash,
    });
  }
});

test("RCV-016 JCS is insertion-order neutral but preserves semantic string differences", () => {
  const first = canonicalizeRcv016({ b: 2, a: " e\u0301 " });
  const second = canonicalizeRcv016({ a: " e\u0301 ", b: 2 });
  const normalized = canonicalizeRcv016({ a: " é ", b: 2 });
  const trimmed = canonicalizeRcv016({ a: "e\u0301", b: 2 });

  assert.deepEqual(first, second);
  assert.notEqual(first.canonical, normalized.canonical);
  assert.notEqual(first.canonical, trimmed.canonical);
});

test("RCV-016 JCS rejects unsupported values fail-closed", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(
      () => canonicalizeRcv016({ value }),
      Rcv016CanonicalizationError,
    );
  }
  assert.throws(
    () => canonicalizeRcv016({ value: "\ud800" }),
    Rcv016CanonicalizationError,
  );
});

test("RCV-016 SHA-256 hashes exact UTF-8 text without normalization or newline", () => {
  const vectors = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["€", "c4cc90ed3d26f12d4b08a75140970a7904035c31cbb4515a83f19b9003c00d1d"],
    ["\u0000", "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d"],
    ['{"a":"€","b":2}', "87611f1c618f24fb0e319b703fa5833673c620fbc3ba558b79b3ce5da75fac70"],
  ];
  for (const [value, expected] of vectors) {
    assert.equal(sha256Rcv016Text(value), expected);
  }
  assert.notEqual(sha256Rcv016Text("abc"), sha256Rcv016Text("abc\n"));
});

test("RCV-016 canonical UUID validation rejects rather than normalizes", () => {
  const valid = "00000000-0000-0000-0000-000000000000";
  assert.equal(validateRcv016CanonicalUuid(valid, "id"), valid);
  assert.equal(
    validateRcv016CanonicalUuid("00000000-0000-0000-0000-00000000000a", "id"),
    "00000000-0000-0000-0000-00000000000a",
  );
  for (const invalid of [
    "00000000-0000-0000-0000-00000000000A",
    "00000000000000000000000000000000",
    " 00000000-0000-0000-0000-000000000000",
    "not-a-uuid",
  ]) {
    assert.throws(
      () => validateRcv016CanonicalUuid(invalid, "id"),
      Rcv016ValidationError,
    );
  }
  assert.ok(
    "00000000-0000-0000-0000-000000000009" <
      "00000000-0000-0000-0000-00000000000a",
  );
});

test("RCV-016 timestamps require exact UTC microsecond form without repair", () => {
  const valid = "2026-08-30T12:34:56.000001Z";
  assert.equal(validateRcv016CanonicalTimestamp(valid, "observedAt"), valid);
  for (const invalid of [
    "2026-08-30T12:34:56Z",
    "2026-08-30T12:34:56.123Z",
    "2026-08-30T12:34:56.1234567Z",
    "2026-08-30T12:34:56.123456+00:00",
    "2026-08-30T12:34:56.123456",
    "2026-02-30T12:34:56.123456Z",
    " 2026-08-30T12:34:56.123456Z",
  ]) {
    assert.throws(
      () => validateRcv016CanonicalTimestamp(invalid, "observedAt"),
      Rcv016ValidationError,
    );
  }
});

test("RCV-016 schema identities reject unknown versions and open shapes", () => {
  assert.deepEqual(
    validateRcv016SchemaIdentity(
      { id: "factbase-source-version-metadata", version: "1" },
      "factbase-source-version-metadata",
      "1",
      "schema",
    ),
    { id: "factbase-source-version-metadata", version: "1" },
  );
  assert.throws(
    () =>
      validateRcv016SchemaIdentity(
        { id: "factbase-source-version-metadata", version: "2" },
        "factbase-source-version-metadata",
        "1",
        "schema",
      ),
    Rcv016UnsupportedContractVersionError,
  );
  assert.throws(
    () =>
      validateRcv016SchemaIdentity(
        { id: "factbase-source-version-metadata", version: "1", future: true },
        "factbase-source-version-metadata",
        "1",
        "schema",
      ),
    Rcv016ValidationError,
  );
});

test("RCV-016 phase-1 technical error taxonomy is closed and never a domain state", () => {
  assert.deepEqual(RCV016_TECHNICAL_ERROR_CODES, [
    "validation_error",
    "canonicalization_error",
    "payload_limit_error",
    "unsupported_contract_version",
    "hash_integrity_error",
  ]);
  const errors = [
    new Rcv016ValidationError("x", "x"),
    new Rcv016CanonicalizationError("x", "x"),
    new Rcv016PayloadLimitError("x", "x"),
    new Rcv016UnsupportedContractVersionError("x", "x"),
    new Rcv016HashIntegrityError("x", "x"),
  ];
  assert.deepEqual(
    errors.map(({ code }) => code),
    RCV016_TECHNICAL_ERROR_CODES,
  );
  for (const error of errors) {
    assert.ok(!["unknown", "partial", "known", "unrecorded", "conflict", "independent"].includes(error.code));
  }
});

test("RCV-016 phase-1 public API introduces no truth, ranking, independence, or winner output", () => {
  const forbidden = new Set([
    "truth",
    "credibility",
    "quality",
    "independence",
    "weight",
    "ranking",
    "winner",
    "isCurrent",
    "effectiveStatement",
  ]);
  for (const moduleExports of PHASE_1_MODULES) {
    for (const exportedName of Object.keys(moduleExports)) {
      assert.ok(!forbidden.has(exportedName), exportedName);
    }
  }
});
