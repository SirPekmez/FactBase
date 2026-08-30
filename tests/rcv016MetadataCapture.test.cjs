const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  Rcv016PayloadLimitError,
  Rcv016UnsupportedContractVersionError,
  Rcv016ValidationError,
} = require("../dist/services/rcv016Canonical");
const {
  RCV016_PAYLOAD_LIMIT_FIELD_NAMES,
  validateRcv016PayloadLimits,
} = require("../dist/services/rcv016PayloadLimits");
const {
  validateAndCanonicalizeRcv016SourceMetadata,
} = require("../dist/services/rcv016SourceMetadata");
const {
  validateAndCanonicalizeRcv016ArtifactCapture,
} = require("../dist/services/rcv016ArtifactCapture");

function independentDefinition(fields) {
  const sorted = {};
  for (const key of Object.keys(fields).sort()) sorted[key] = fields[key];
  const definitionCanonical = JSON.stringify(sorted);
  return {
    definitionCanonical,
    definitionHash: createHash("sha256")
      .update(definitionCanonical, "utf8")
      .digest("hex"),
  };
}

function limits(overrides = {}) {
  const fields = { limitsId: "phase-1-limits", limitsVersion: "1" };
  for (const name of RCV016_PAYLOAD_LIMIT_FIELD_NAMES) fields[name] = 10_000;
  Object.assign(fields, overrides);
  return validateRcv016PayloadLimits({ ...fields, ...independentDefinition(fields) });
}

function sourceMetadata(overrides = {}) {
  return {
    schema: { id: "factbase-source-version-metadata", version: "1" },
    displayName: "Source",
    observedLocators: [],
    ...overrides,
  };
}

function capturedBytes(overrides = {}) {
  return {
    schema: { id: "factbase-artifact-version-capture", version: "1" },
    locator: "https://example.test/a",
    mediaType: "text/plain",
    title: "Title",
    publishedAt: null,
    observedAt: "2026-08-30T12:00:00.000001Z",
    retrievedAt: "2026-08-30T12:00:01.000001Z",
    representation: {
      kind: "captured_bytes",
      hashAlgorithm: "sha-256",
      contentHash: "a".repeat(64),
    },
    ...overrides,
  };
}

test("Source Metadata V1 canonicalizes the closed envelope and explicit locator order", () => {
  const input = sourceMetadata({
    observedLocators: [
      { kind: "homepage_url", value: "https://example.test", namespace: null },
      { kind: "handle", value: "@source", namespace: "social" },
      {
        kind: "external_identifier",
        value: "42",
        namespace: "registry",
      },
    ],
  });
  const result = validateAndCanonicalizeRcv016SourceMetadata(input, limits());
  assert.equal(
    result.canonical,
    '{"displayName":"Source","observedLocators":[{"kind":"external_identifier","namespace":"registry","value":"42"},{"kind":"handle","namespace":"social","value":"@source"},{"kind":"homepage_url","namespace":null,"value":"https://example.test"}],"schema":{"id":"factbase-source-version-metadata","version":"1"}}',
  );
  assert.equal(
    result.hash,
    "1aaac227a93827d68d8c0cf867fb8f9f44297c2ccd3bbce3c64efce6cf33fff4",
  );
  assert.deepEqual(
    result.value.observedLocators.map(({ kind }) => kind),
    ["external_identifier", "handle", "homepage_url"],
  );
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.value.observedLocators));
});

test("Source Metadata V1 accepts each locator family and required null semantics", () => {
  const accepted = [
    { kind: "homepage_url", value: "https://example.test/a", namespace: null },
    { kind: "profile_url", value: "urn:example:profile", namespace: null },
    { kind: "handle", value: "@source", namespace: "network" },
    {
      kind: "external_identifier",
      value: "source-42",
      namespace: "registry",
    },
  ];
  for (const locator of accepted) {
    const result = validateAndCanonicalizeRcv016SourceMetadata(
      sourceMetadata({ displayName: null, observedLocators: [locator] }),
      limits(),
    );
    assert.equal(result.value.displayName, null);
  }
  assert.equal(
    validateAndCanonicalizeRcv016SourceMetadata(
      sourceMetadata({ displayName: "Name", observedLocators: [] }),
      limits(),
    ).value.displayName,
    "Name",
  );
});

test("Source Metadata V1 rejects open shapes, invalid namespaces, URLs, duplicates, and versions", () => {
  const omittedNullable = sourceMetadata();
  delete omittedNullable.displayName;
  const invalid = [
    sourceMetadata({ displayName: null, observedLocators: [] }),
    { ...sourceMetadata(), extra: true },
    { schema: sourceMetadata().schema, observedLocators: [], displayName: undefined },
    sourceMetadata({
      observedLocators: [
        { kind: "homepage_url", value: "/relative", namespace: null },
      ],
    }),
    sourceMetadata({
      observedLocators: [
        { kind: "homepage_url", value: "https://example.test", namespace: "web" },
      ],
    }),
    sourceMetadata({
      observedLocators: [{ kind: "handle", value: "@x", namespace: null }],
    }),
    sourceMetadata({
      observedLocators: [
        { kind: "future", value: "x", namespace: null },
      ],
    }),
    sourceMetadata({
      observedLocators: [
        { kind: "handle", value: "@x", namespace: "n" },
        { kind: "handle", value: "@x", namespace: "n" },
      ],
    }),
    omittedNullable,
  ];
  for (const value of invalid) {
    assert.throws(
      () => validateAndCanonicalizeRcv016SourceMetadata(value, limits()),
      Rcv016ValidationError,
    );
  }

  const wrongVersion = sourceMetadata({
    schema: { id: "factbase-source-version-metadata", version: "2" },
  });
  assert.throws(
    () => validateAndCanonicalizeRcv016SourceMetadata(wrongVersion, limits()),
    Rcv016UnsupportedContractVersionError,
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016SourceMetadata(
        sourceMetadata({ schema: { id: "future-metadata", version: "1" } }),
        limits(),
      ),
    Rcv016UnsupportedContractVersionError,
  );
});

test("Source Metadata preserves whitespace, case, and Unicode normalization form", () => {
  const first = validateAndCanonicalizeRcv016SourceMetadata(
    sourceMetadata({ displayName: " É " }),
    limits(),
  );
  const second = validateAndCanonicalizeRcv016SourceMetadata(
    sourceMetadata({ displayName: " E\u0301 " }),
    limits(),
  );
  assert.equal(first.value.displayName, " É ");
  assert.notEqual(first.canonical, second.canonical);

  const locators = [
    { kind: "handle", value: "B", namespace: "N" },
    { kind: "external_identifier", value: "é", namespace: "Registry" },
  ];
  const ordered = validateAndCanonicalizeRcv016SourceMetadata(
    sourceMetadata({ observedLocators: locators }),
    limits(),
  );
  const permuted = validateAndCanonicalizeRcv016SourceMetadata(
    sourceMetadata({ observedLocators: [...locators].reverse() }),
    limits(),
  );
  assert.equal(ordered.canonical, permuted.canonical);
});

test("Source Metadata enforces every relevant payload boundary", () => {
  const display = sourceMetadata({ displayName: "ab" });
  const locators = [
    { kind: "handle", value: "a", namespace: "n" },
    { kind: "handle", value: "b", namespace: "n" },
  ];
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      display,
      limits({ displayNameCodepoints: 2, displayNameUtf8Bytes: 2 }),
    ),
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      sourceMetadata({ displayName: "a" }),
      limits({ displayNameCodepoints: 2, displayNameUtf8Bytes: 2 }),
    ),
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016SourceMetadata(
        sourceMetadata({ displayName: "abc" }),
        limits({ displayNameCodepoints: 2 }),
      ),
    Rcv016PayloadLimitError,
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      sourceMetadata({ displayName: "é" }),
      limits({ displayNameCodepoints: 1, displayNameUtf8Bytes: 2 }),
    ),
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      sourceMetadata({ observedLocators: [locators[0]] }),
      limits({ sourceLocatorCount: 2 }),
    ),
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016SourceMetadata(
        sourceMetadata({ displayName: "é" }),
        limits({ displayNameCodepoints: 1, displayNameUtf8Bytes: 1 }),
      ),
    Rcv016PayloadLimitError,
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      sourceMetadata({ observedLocators: [{ kind: "handle", value: "a", namespace: "n" }] }),
      limits({ locatorStringCodepoints: 2, locatorStringUtf8Bytes: 2 }),
    ),
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      sourceMetadata({ observedLocators: [{ kind: "handle", value: "ab", namespace: "n" }] }),
      limits({ locatorStringCodepoints: 2, locatorStringUtf8Bytes: 2 }),
    ),
  );

  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      sourceMetadata({ observedLocators: locators }),
      limits({ sourceLocatorCount: 2 }),
    ),
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016SourceMetadata(
        sourceMetadata({ observedLocators: [...locators, { kind: "handle", value: "c", namespace: "n" }] }),
        limits({ sourceLocatorCount: 2 }),
      ),
    Rcv016PayloadLimitError,
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016SourceMetadata(
        sourceMetadata({ observedLocators: [{ kind: "handle", value: "abc", namespace: "n" }] }),
        limits({ locatorStringCodepoints: 2 }),
      ),
    Rcv016PayloadLimitError,
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016SourceMetadata(
        sourceMetadata({ observedLocators: [{ kind: "handle", value: "é", namespace: "n" }] }),
        limits({ locatorStringCodepoints: 1, locatorStringUtf8Bytes: 1 }),
      ),
    Rcv016PayloadLimitError,
  );

  const initial = validateAndCanonicalizeRcv016SourceMetadata(display, limits());
  const bytes = Buffer.byteLength(initial.canonical, "utf8");
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016SourceMetadata(
        display,
        limits({ sourceMetadataCanonicalBytes: bytes - 1 }),
      ),
    Rcv016PayloadLimitError,
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      display,
      limits({ sourceMetadataCanonicalBytes: bytes }),
    ),
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016SourceMetadata(
      display,
      limits({ sourceMetadataCanonicalBytes: bytes + 1 }),
    ),
  );
});

test("Artifact Capture V1 canonicalizes captured bytes and separates envelope and content hashes", () => {
  const result = validateAndCanonicalizeRcv016ArtifactCapture(
    capturedBytes(),
    limits(),
  );
  assert.equal(
    result.canonical,
    '{"locator":"https://example.test/a","mediaType":"text/plain","observedAt":"2026-08-30T12:00:00.000001Z","publishedAt":null,"representation":{"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hashAlgorithm":"sha-256","kind":"captured_bytes"},"retrievedAt":"2026-08-30T12:00:01.000001Z","schema":{"id":"factbase-artifact-version-capture","version":"1"},"title":"Title"}',
  );
  assert.equal(
    result.hash,
    "266c6fe5943e788c3d7a52514e841668cc82f85be04250c6219794453cc908a1",
  );
  assert.notEqual(result.hash, result.value.representation.contentHash);
  const changedTitle = validateAndCanonicalizeRcv016ArtifactCapture(
    capturedBytes({ title: "Different" }),
    limits(),
  );
  assert.equal(
    changedTitle.value.representation.contentHash,
    result.value.representation.contentHash,
  );
  assert.notEqual(changedTitle.hash, result.hash);
});

test("Artifact Capture V1 accepts only the two closed representations", () => {
  const metadataOnly = validateAndCanonicalizeRcv016ArtifactCapture(
    capturedBytes({
      locator: null,
      mediaType: null,
      title: null,
      retrievedAt: null,
      representation: {
        kind: "metadata_only",
        hashAlgorithm: null,
        contentHash: null,
      },
    }),
    limits(),
  );
  assert.equal(metadataOnly.value.retrievedAt, null);

  const omittedNullable = capturedBytes();
  delete omittedNullable.publishedAt;
  const invalid = [
    capturedBytes({ retrievedAt: null }),
    capturedBytes({
      representation: {
        kind: "captured_bytes",
        hashAlgorithm: "SHA-256",
        contentHash: "a".repeat(64),
      },
    }),
    capturedBytes({
      representation: {
        kind: "captured_bytes",
        hashAlgorithm: "sha-256",
        contentHash: "A".repeat(64),
      },
    }),
    capturedBytes({
      representation: {
        kind: "metadata_only",
        hashAlgorithm: "sha-256",
        contentHash: "a".repeat(64),
      },
    }),
    capturedBytes({
      representation: { kind: "future", hashAlgorithm: null, contentHash: null },
    }),
    { ...capturedBytes(), externalObservedAt: capturedBytes().observedAt },
    omittedNullable,
  ];
  for (const value of invalid) {
    assert.throws(
      () => validateAndCanonicalizeRcv016ArtifactCapture(value, limits()),
      Rcv016ValidationError,
    );
  }
});

test("Artifact Capture V1 rejects invalid media types, timestamps, and schema versions", () => {
  for (const mediaType of [
    "Text/Plain",
    "text/plain; charset=utf-8",
    "téxt/plain",
    "text plain",
    "text",
  ]) {
    assert.throws(
      () =>
        validateAndCanonicalizeRcv016ArtifactCapture(
          capturedBytes({ mediaType }),
          limits(),
        ),
      Rcv016ValidationError,
    );
  }
  for (const observedAt of [
    null,
    "2026-08-30T12:00:00.001Z",
    "2026-08-30T12:00:00.000001+00:00",
  ]) {
    assert.throws(
      () =>
        validateAndCanonicalizeRcv016ArtifactCapture(
          capturedBytes({ observedAt }),
          limits(),
        ),
      Rcv016ValidationError,
    );
  }
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016ArtifactCapture(
        capturedBytes({
          schema: { id: "factbase-artifact-version-capture", version: "2" },
        }),
        limits(),
      ),
    Rcv016UnsupportedContractVersionError,
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016ArtifactCapture(
        capturedBytes({ schema: { id: "future-capture", version: "1" } }),
        limits(),
      ),
    Rcv016UnsupportedContractVersionError,
  );
});

test("Artifact Capture enforces all seven applicable payload dimensions", () => {
  const textFields = [
    ["locator", "artifactLocatorCodepoints", "artifactLocatorUtf8Bytes"],
    ["mediaType", "mediaTypeCodepoints", "mediaTypeUtf8Bytes"],
    ["title", "titleCodepoints", "titleUtf8Bytes"],
  ];
  for (const [field, codepointLimit, byteLimit] of textFields) {
    const asciiValue = field === "mediaType" ? "a/b" : "ab";
    const codepoints = Array.from(asciiValue).length;
    assert.doesNotThrow(() =>
      validateAndCanonicalizeRcv016ArtifactCapture(
        capturedBytes({ [field]: asciiValue }),
        limits({ [codepointLimit]: codepoints, [byteLimit]: codepoints }),
      ),
    );
    assert.throws(
      () =>
        validateAndCanonicalizeRcv016ArtifactCapture(
          capturedBytes({ [field]: asciiValue }),
          limits({ [codepointLimit]: codepoints - 1 }),
        ),
      Rcv016PayloadLimitError,
    );
  }

  for (const [field, below, exact, above, codepointLimit, byteLimit] of [
    ["locator", "a", "ab", "abc", "artifactLocatorCodepoints", "artifactLocatorUtf8Bytes"],
    ["title", "a", "ab", "abc", "titleCodepoints", "titleUtf8Bytes"],
    ["mediaType", "a/b", "aa/b", "aaa/b", "mediaTypeCodepoints", "mediaTypeUtf8Bytes"],
  ]) {
    const boundary = Array.from(exact).length;
    assert.doesNotThrow(() =>
      validateAndCanonicalizeRcv016ArtifactCapture(
        capturedBytes({ [field]: below }),
        limits({ [codepointLimit]: boundary, [byteLimit]: boundary }),
      ),
    );
    assert.doesNotThrow(() =>
      validateAndCanonicalizeRcv016ArtifactCapture(
        capturedBytes({ [field]: exact }),
        limits({ [codepointLimit]: boundary, [byteLimit]: boundary }),
      ),
    );
    assert.throws(
      () =>
        validateAndCanonicalizeRcv016ArtifactCapture(
          capturedBytes({ [field]: above }),
          limits({ [codepointLimit]: boundary, [byteLimit]: boundary }),
        ),
      Rcv016PayloadLimitError,
    );
  }

  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016ArtifactCapture(
      capturedBytes({ title: "é" }),
      limits({ titleCodepoints: 1, titleUtf8Bytes: 2 }),
    ),
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016ArtifactCapture(
        capturedBytes({ title: "é" }),
        limits({ titleCodepoints: 1, titleUtf8Bytes: 1 }),
      ),
    Rcv016PayloadLimitError,
  );

  const base = capturedBytes();
  const canonical = validateAndCanonicalizeRcv016ArtifactCapture(base, limits());
  const bytes = Buffer.byteLength(canonical.canonical, "utf8");
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016ArtifactCapture(
        base,
        limits({ artifactCaptureCanonicalBytes: bytes - 1 }),
      ),
    Rcv016PayloadLimitError,
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016ArtifactCapture(
      base,
      limits({ artifactCaptureCanonicalBytes: bytes }),
    ),
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016ArtifactCapture(
      base,
      limits({ artifactCaptureCanonicalBytes: bytes + 1 }),
    ),
  );
});
