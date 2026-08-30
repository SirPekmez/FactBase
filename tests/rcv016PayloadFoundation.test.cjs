const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  Rcv016HashIntegrityError,
  Rcv016PayloadLimitError,
  Rcv016UnsupportedContractVersionError,
  Rcv016ValidationError,
} = require("../dist/services/rcv016Canonical");
const {
  RCV016_PAYLOAD_LIMIT_FIELD_NAMES,
  validateRcv016PayloadLimits,
} = require("../dist/services/rcv016PayloadLimits");
const {
  validateAndCanonicalizeRcv016Foundation,
} = require("../dist/services/rcv016Foundation");
const {
  validateRcv016TraversalPolicy,
} = require("../dist/services/rcv016TraversalPolicy");

const MINIMUM_DEFINITION_CANONICAL =
  '{"artifactCaptureCanonicalBytes":1,"artifactLocatorCodepoints":1,"artifactLocatorUtf8Bytes":1,"displayNameCodepoints":1,"displayNameUtf8Bytes":1,"foundationCanonicalBytes":1,"foundationInputReferenceCount":1,"foundationItemCount":1,"foundationReferenceCodepoints":1,"foundationReferenceUtf8Bytes":1,"limitsId":"limits-test","limitsVersion":"1","locatorStringCodepoints":1,"locatorStringUtf8Bytes":1,"mediaTypeCodepoints":1,"mediaTypeUtf8Bytes":1,"rationaleCodepoints":1,"rationaleUtf8Bytes":1,"sourceLocatorCount":1,"sourceMetadataCanonicalBytes":1,"titleCodepoints":1,"titleUtf8Bytes":1}';
const MINIMUM_DEFINITION_HASH =
  "dec3f7ad4f20a4de9d8b74066a510782d246f27d079f282ed1640ec39e23a278";

function independentDefinition(fields) {
  const sorted = {};
  for (const key of Object.keys(fields).sort()) sorted[key] = fields[key];
  const definitionCanonical = JSON.stringify(sorted);
  const definitionHash = createHash("sha256")
    .update(definitionCanonical, "utf8")
    .digest("hex");
  return { definitionCanonical, definitionHash };
}

function payloadLimits(value = 1) {
  const fields = { limitsId: "limits-test", limitsVersion: "1" };
  for (const name of RCV016_PAYLOAD_LIMIT_FIELD_NAMES) fields[name] = value;
  return { ...fields, ...independentDefinition(fields) };
}

function generousLimits(overrides = {}) {
  const fields = { limitsId: "phase-1", limitsVersion: "1" };
  for (const name of RCV016_PAYLOAD_LIMIT_FIELD_NAMES) fields[name] = 10_000;
  Object.assign(fields, overrides);
  return validateRcv016PayloadLimits({ ...fields, ...independentDefinition(fields) });
}

function foundation(items) {
  return {
    schema: { id: "factbase-provenance-foundation", version: "1" },
    items,
  };
}

function traversalPolicy(overrides = {}) {
  const definition = {
    policyId: "policy-test",
    policyVersion: "1",
    maxRoots: 10,
    maxNodes: 100,
    maxEdges: 200,
    maxDepth: 8,
    maxCanonicalSnapshotBytes: 1_000_000,
    allowedRelationships: [
      "cites",
      "derived_from",
      "incorporates",
      "quotes",
      "reposts",
      "syndicated_from",
      "uses_information_from",
    ],
    deterministicOrdering:
      "schema_category_then_canonical_key_lexicographic_v1",
    visitedSemantics:
      "expand_node_once_include_statement_once_diagnose_cycles_v1",
    ...overrides,
  };
  return { ...definition, ...independentDefinition(definition) };
}

test("PayloadLimits V1 validates all 20 closed positive-safe-integer fields", () => {
  assert.equal(RCV016_PAYLOAD_LIMIT_FIELD_NAMES.length, 20);
  const minimum = validateRcv016PayloadLimits(payloadLimits());
  assert.equal(minimum.definitionCanonical, MINIMUM_DEFINITION_CANONICAL);
  assert.equal(minimum.definitionHash, MINIMUM_DEFINITION_HASH);
  assert.ok(Object.isFrozen(minimum));

  const maximum = validateRcv016PayloadLimits(
    payloadLimits(Number.MAX_SAFE_INTEGER),
  );
  for (const name of RCV016_PAYLOAD_LIMIT_FIELD_NAMES) {
    assert.equal(maximum[name], Number.MAX_SAFE_INTEGER);
  }
});

test("PayloadLimits V1 rejects every invalid numeric domain value on every field", () => {
  for (const name of RCV016_PAYLOAD_LIMIT_FIELD_NAMES) {
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      const value = payloadLimits();
      value[name] = invalid;
      assert.throws(
        () => validateRcv016PayloadLimits(value),
        Rcv016ValidationError,
        `${name}=${String(invalid)}`,
      );
    }
  }
});

test("PayloadLimits V1 is closed and performs no silent coercion", () => {
  const extra = { ...payloadLimits(), productionDefault: 100 };
  assert.throws(() => validateRcv016PayloadLimits(extra), Rcv016ValidationError);

  const missing = payloadLimits();
  delete missing.titleUtf8Bytes;
  assert.throws(() => validateRcv016PayloadLimits(missing), Rcv016ValidationError);

  const numberString = payloadLimits();
  numberString.titleUtf8Bytes = "1";
  assert.throws(
    () => validateRcv016PayloadLimits(numberString),
    Rcv016ValidationError,
  );

  const trimmed = payloadLimits();
  trimmed.limitsId = " limits-test";
  Object.assign(
    trimmed,
    independentDefinition(
      Object.fromEntries(
        Object.entries(trimmed).filter(
          ([key]) => key !== "definitionCanonical" && key !== "definitionHash",
        ),
      ),
    ),
  );
  assert.equal(validateRcv016PayloadLimits(trimmed).limitsId, " limits-test");
});

test("PayloadLimits definitionCanonical and definitionHash bind the exact closed definition", () => {
  const wrongCanonical = payloadLimits();
  wrongCanonical.definitionCanonical = "{}";
  wrongCanonical.definitionHash = createHash("sha256").update("{}").digest("hex");
  assert.throws(
    () => validateRcv016PayloadLimits(wrongCanonical),
    Rcv016ValidationError,
  );

  const wrongHash = payloadLimits();
  wrongHash.definitionHash = "0".repeat(64);
  assert.throws(
    () => validateRcv016PayloadLimits(wrongHash),
    Rcv016HashIntegrityError,
  );

  const uppercaseHash = payloadLimits();
  uppercaseHash.definitionHash = uppercaseHash.definitionHash.toUpperCase();
  assert.throws(
    () => validateRcv016PayloadLimits(uppercaseHash),
    Rcv016ValidationError,
  );
});

test("Foundation V1 closes and canonically sorts all four variants", () => {
  const value = foundation([
    { kind: "evidence_reference", evidenceId: "00000000-0000-0000-0000-000000000002" },
    { kind: "imported_assertion", referenceType: "external_record", reference: "record" },
    {
      kind: "deterministic_method",
      methodId: "method",
      methodVersion: "1",
      inputReferences: [
        { referenceType: "provenance_snapshot", referenceId: "00000000-0000-0000-0000-000000000004" },
        { referenceType: "evidence", referenceId: "00000000-0000-0000-0000-000000000003" },
        { referenceType: "artifact_version", referenceId: "00000000-0000-0000-0000-000000000002" },
      ],
    },
    { kind: "artifact_version_reference", artifactVersionId: "00000000-0000-0000-0000-000000000001" },
  ]);
  const result = validateAndCanonicalizeRcv016Foundation(value, generousLimits());
  assert.equal(
    result.canonical,
    '{"items":[{"artifactVersionId":"00000000-0000-0000-0000-000000000001","kind":"artifact_version_reference"},{"inputReferences":[{"referenceId":"00000000-0000-0000-0000-000000000002","referenceType":"artifact_version"},{"referenceId":"00000000-0000-0000-0000-000000000003","referenceType":"evidence"},{"referenceId":"00000000-0000-0000-0000-000000000004","referenceType":"provenance_snapshot"}],"kind":"deterministic_method","methodId":"method","methodVersion":"1"},{"evidenceId":"00000000-0000-0000-0000-000000000002","kind":"evidence_reference"},{"kind":"imported_assertion","reference":"record","referenceType":"external_record"}],"schema":{"id":"factbase-provenance-foundation","version":"1"}}',
  );
  assert.equal(
    result.hash,
    "2554724c0b9fd9da93a56acffd604eb6881652a3c83dbdaeef078af52ef1c38d",
  );
  assert.deepEqual(
    result.value.items.map(({ kind }) => kind),
    [
      "artifact_version_reference",
      "deterministic_method",
      "evidence_reference",
      "imported_assertion",
    ],
  );
  assert.deepEqual(
    result.value.items[1].inputReferences.map(({ referenceType }) => referenceType),
    ["artifact_version", "evidence", "provenance_snapshot"],
  );
  assert.ok(Object.isFrozen(result.value.items[1].inputReferences));
});

test("Foundation V1 is optional but present Foundation is closed and non-empty", () => {
  assert.equal(validateAndCanonicalizeRcv016Foundation(null, generousLimits()), null);
  for (const value of [
    foundation([]),
    { ...foundation([{ kind: "evidence_reference", evidenceId: "00000000-0000-0000-0000-000000000001" }]), rationale: "not Foundation" },
    foundation([{ kind: "manual_review", reviewer: "person" }]),
    foundation([{ kind: "future", value: "x" }]),
    foundation([{ kind: "evidence_reference", evidenceId: "00000000-0000-0000-0000-00000000000A" }]),
    foundation([{ kind: "artifact_version_reference", artifactVersionId: "not-a-uuid" }]),
    foundation([{ kind: "imported_assertion", referenceType: "url", reference: "x" }]),
    foundation([{ kind: "deterministic_method", methodId: "m", methodVersion: "1", inputReferences: [] }]),
    foundation([{ kind: "deterministic_method", methodId: "m", methodVersion: "1", inputReferences: [{ referenceType: "source", referenceId: "00000000-0000-0000-0000-000000000001" }] }]),
  ]) {
    assert.throws(
      () => validateAndCanonicalizeRcv016Foundation(value, generousLimits()),
      Rcv016ValidationError,
    );
  }
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016Foundation(
        { schema: { id: "factbase-provenance-foundation", version: "2" }, items: [{ kind: "evidence_reference", evidenceId: "00000000-0000-0000-0000-000000000001" }] },
        generousLimits(),
      ),
    Rcv016UnsupportedContractVersionError,
  );
});

test("Foundation ordering is permutation-neutral and exact duplicates fail", () => {
  const firstItem = { kind: "evidence_reference", evidenceId: "00000000-0000-0000-0000-000000000001" };
  const secondItem = { kind: "evidence_reference", evidenceId: "00000000-0000-0000-0000-000000000002" };
  const first = validateAndCanonicalizeRcv016Foundation(
    foundation([secondItem, firstItem]),
    generousLimits(),
  );
  const second = validateAndCanonicalizeRcv016Foundation(
    foundation([firstItem, secondItem]),
    generousLimits(),
  );
  assert.equal(first.canonical, second.canonical);
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016Foundation(
        foundation([firstItem, { ...firstItem }]),
        generousLimits(),
      ),
    Rcv016ValidationError,
  );

  const duplicatedInput = foundation([{
    kind: "deterministic_method",
    methodId: "m",
    methodVersion: "1",
    inputReferences: [
      { referenceType: "evidence", referenceId: "00000000-0000-0000-0000-000000000001" },
      { referenceType: "evidence", referenceId: "00000000-0000-0000-0000-000000000001" },
    ],
  }]);
  assert.throws(
    () => validateAndCanonicalizeRcv016Foundation(duplicatedInput, generousLimits()),
    Rcv016ValidationError,
  );

  const methodOne = {
    kind: "deterministic_method",
    methodId: "m",
    methodVersion: "1",
    inputReferences: [
      { referenceType: "evidence", referenceId: "00000000-0000-0000-0000-000000000001" },
    ],
  };
  const methodTwo = {
    ...methodOne,
    inputReferences: [
      { referenceType: "evidence", referenceId: "00000000-0000-0000-0000-000000000002" },
    ],
  };
  const distinct = validateAndCanonicalizeRcv016Foundation(
    foundation([methodTwo, methodOne]),
    generousLimits(),
  );
  assert.equal(distinct.value.items.length, 2);
  assert.notDeepEqual(
    distinct.value.items[0].inputReferences,
    distinct.value.items[1].inputReferences,
  );
});

test("Foundation applies all five Foundation payload limits without rationale semantics", () => {
  const one = { kind: "imported_assertion", referenceType: "import_run", reference: "é" };
  const two = { kind: "evidence_reference", evidenceId: "00000000-0000-0000-0000-000000000001" };
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016Foundation(
      foundation([one, two]),
      generousLimits({ foundationItemCount: 2, foundationReferenceCodepoints: 36, foundationReferenceUtf8Bytes: 36 }),
    ),
  );
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016Foundation(
      foundation([one]),
      generousLimits({ foundationItemCount: 2, foundationReferenceCodepoints: 2, foundationReferenceUtf8Bytes: 2 }),
    ),
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016Foundation(
        foundation([one, two]),
        generousLimits({ foundationItemCount: 1 }),
      ),
    Rcv016PayloadLimitError,
  );
  for (const [reference, expected] of [["a", "accept"], ["ab", "accept"], ["abc", "reject"]]) {
    const operation = () =>
      validateAndCanonicalizeRcv016Foundation(
        foundation([{ kind: "imported_assertion", referenceType: "import_run", reference }]),
        generousLimits({ foundationReferenceCodepoints: 2, foundationReferenceUtf8Bytes: 2 }),
      );
    if (expected === "accept") assert.doesNotThrow(operation);
    else assert.throws(operation, Rcv016PayloadLimitError);
  }
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016Foundation(
        foundation([one]),
        generousLimits({ foundationReferenceCodepoints: 1, foundationReferenceUtf8Bytes: 1 }),
      ),
    Rcv016PayloadLimitError,
  );

  const method = foundation([{
    kind: "deterministic_method",
    methodId: "m",
    methodVersion: "1",
    inputReferences: [
      { referenceType: "evidence", referenceId: "00000000-0000-0000-0000-000000000001" },
      { referenceType: "artifact_version", referenceId: "00000000-0000-0000-0000-000000000002" },
    ],
  }]);
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016Foundation(
      method,
      generousLimits({ foundationInputReferenceCount: 2 }),
    ),
  );
  const oneInput = foundation([{
    kind: "deterministic_method",
    methodId: "m",
    methodVersion: "1",
    inputReferences: [
      { referenceType: "evidence", referenceId: "00000000-0000-0000-0000-000000000001" },
    ],
  }]);
  assert.doesNotThrow(() =>
    validateAndCanonicalizeRcv016Foundation(
      oneInput,
      generousLimits({ foundationInputReferenceCount: 2 }),
    ),
  );
  assert.throws(
    () =>
      validateAndCanonicalizeRcv016Foundation(
        method,
        generousLimits({ foundationInputReferenceCount: 1 }),
      ),
    Rcv016PayloadLimitError,
  );

  const base = validateAndCanonicalizeRcv016Foundation(foundation([two]), generousLimits());
  const bytes = Buffer.byteLength(base.canonical, "utf8");
  assert.throws(
    () => validateAndCanonicalizeRcv016Foundation(foundation([two]), generousLimits({ foundationCanonicalBytes: bytes - 1 })),
    Rcv016PayloadLimitError,
  );
  assert.doesNotThrow(() => validateAndCanonicalizeRcv016Foundation(foundation([two]), generousLimits({ foundationCanonicalBytes: bytes })));
  assert.doesNotThrow(() => validateAndCanonicalizeRcv016Foundation(foundation([two]), generousLimits({ foundationCanonicalBytes: bytes + 1 })));
});

test("Traversal Policy V1 validates one explicit closed definition", () => {
  const policy = validateRcv016TraversalPolicy(traversalPolicy());
  assert.equal(policy.policyId, "policy-test");
  assert.deepEqual(policy.allowedRelationships, [
    "cites",
    "derived_from",
    "incorporates",
    "quotes",
    "reposts",
    "syndicated_from",
    "uses_information_from",
  ]);
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.allowedRelationships));

  for (const field of ["maxRoots", "maxNodes", "maxEdges", "maxDepth", "maxCanonicalSnapshotBytes"]) {
    assert.equal(
      validateRcv016TraversalPolicy(
        traversalPolicy({ [field]: Number.MAX_SAFE_INTEGER }),
      )[field],
      Number.MAX_SAFE_INTEGER,
    );
  }
});

test("Traversal Policy V1 rejects invalid limits and open/coerced definitions", () => {
  for (const field of ["maxRoots", "maxNodes", "maxEdges", "maxDepth", "maxCanonicalSnapshotBytes"]) {
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1"]) {
      assert.throws(
        () => validateRcv016TraversalPolicy(traversalPolicy({ [field]: invalid })),
        Rcv016ValidationError,
      );
    }
  }
  assert.throws(
    () => validateRcv016TraversalPolicy({ ...traversalPolicy(), current: true }),
    Rcv016ValidationError,
  );
  const missing = traversalPolicy();
  delete missing.maxDepth;
  assert.throws(() => validateRcv016TraversalPolicy(missing), Rcv016ValidationError);
});

test("Traversal Policy relationship set and semantic literals are exact and ordered", () => {
  const valid = traversalPolicy();
  const relationshipAttacks = [
    valid.allowedRelationships.slice(0, 6),
    [...valid.allowedRelationships, "cites"],
    [...valid.allowedRelationships].reverse(),
    [...valid.allowedRelationships.slice(0, 6), "fact_checked_by"],
  ];
  for (const allowedRelationships of relationshipAttacks) {
    assert.throws(
      () => validateRcv016TraversalPolicy(traversalPolicy({ allowedRelationships })),
      Rcv016ValidationError,
    );
  }
  assert.throws(
    () => validateRcv016TraversalPolicy(traversalPolicy({ deterministicOrdering: "latest_first" })),
    Rcv016ValidationError,
  );
  assert.throws(
    () => validateRcv016TraversalPolicy(traversalPolicy({ visitedSemantics: "visit_all" })),
    Rcv016ValidationError,
  );
});

test("Traversal Policy definitionCanonical and hash cannot drift", () => {
  const wrongCanonical = traversalPolicy();
  wrongCanonical.definitionCanonical = "{}";
  wrongCanonical.definitionHash = createHash("sha256").update("{}").digest("hex");
  assert.throws(
    () => validateRcv016TraversalPolicy(wrongCanonical),
    Rcv016ValidationError,
  );
  const wrongHash = traversalPolicy();
  wrongHash.definitionHash = "0".repeat(64);
  assert.throws(
    () => validateRcv016TraversalPolicy(wrongHash),
    Rcv016HashIntegrityError,
  );
});
