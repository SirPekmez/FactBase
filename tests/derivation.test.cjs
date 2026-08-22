const assert = require("node:assert/strict");
const {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const {
  executeDeterministicRule,
  getDerivationInterpreterArtifactHash,
  interpretDeterministicRule,
} = require("../dist/services/derivationRuleInterpreter");
const {
  getDerivationExecutionIdentity,
} = require("../dist/services/derivationExecutionIdentity");
const {
  createDerivationRuleRevision,
  validateRuleDefinition,
} = require("../dist/services/derivationRuleService");
const {
  canonicalizeAndHash,
} = require("../dist/services/canonicalJson");
const {
  getDerivationSnapshotBuilderIdentity,
  loadDerivationInputSnapshot,
} = require("../dist/services/derivationInputSnapshotService");
const {
  assertDerivationInputSchemaV1,
} = require("../dist/services/derivationInputSchemaV1");

function definition(overrides = {}) {
  return {
    dsl: { id: "factbase-derivation-rule-dsl", version: "1" },
    interpreter: {
      id: "factbase-derivation-rule-interpreter",
      version: "1",
      artifactHash: getDerivationInterpreterArtifactHash(),
      execution: getDerivationExecutionIdentity(),
    },
    output: { operation: "input_manifest" },
    ...overrides,
  };
}

test("interpreter artifact hash identifies the initialized loaded implementation", () => {
  const first = getDerivationInterpreterArtifactHash();
  const second = getDerivationInterpreterArtifactHash();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(second, first);
});

test("replacing the module file after loading cannot change its implementation hash", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "factbase-rcv015-interpreter-"));
  const copiedTree = join(temporaryDirectory, "dist");
  const copiedArtifact = join(
    copiedTree,
    "services",
    "derivationRuleInterpreter.js",
  );
  const sourceArtifact = require.resolve("../dist/services/derivationRuleInterpreter");
  try {
    symlinkSync(
      join(__dirname, "..", "node_modules"),
      join(temporaryDirectory, "node_modules"),
      "dir",
    );
    cpSync(join(__dirname, "..", "dist"), copiedTree, { recursive: true });
    const loadedInterpreter = require(copiedArtifact);
    const hashBeforeReplacement = loadedInterpreter.getDerivationInterpreterArtifactHash();
    assert.match(hashBeforeReplacement, /^[0-9a-f]{64}$/);

    const definition = {
      dsl: { id: "factbase-derivation-rule-dsl", version: "1" },
      interpreter: {
        id: "factbase-derivation-rule-interpreter",
        version: "1",
        artifactHash: hashBeforeReplacement,
        execution: getDerivationExecutionIdentity(),
      },
      output: { operation: "input_manifest" },
    };
    const snapshot = {
      claimVersion: { id: "version-id" },
      evidenceRelations: [],
    };
    const outputBeforeReplacement = loadedInterpreter.interpretDeterministicRule(
      definition,
      snapshot,
      "input-hash",
    );

    const replacement = "module.exports = { replacement: true };\n";
    assert.notEqual(readFileSync(sourceArtifact, "utf8"), replacement);
    writeFileSync(copiedArtifact, replacement, "utf8");

    assert.equal(
      loadedInterpreter.getDerivationInterpreterArtifactHash(),
      hashBeforeReplacement,
    );
    assert.deepEqual(
      loadedInterpreter.interpretDeterministicRule(definition, snapshot, "input-hash"),
      outputBeforeReplacement,
    );
  } finally {
    delete require.cache[copiedArtifact];
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("post-load canonicalizer export replacement cannot alter deterministic output bytes", () => {
  const canonicalJsonModule = require("../dist/services/canonicalJson");
  const parsed = validateRuleDefinition(definition(), "deterministic_rules");
  const snapshot = {
    claimVersion: { id: "version-id" },
    evidenceRelations: [],
  };
  const artifactHash = getDerivationInterpreterArtifactHash();
  const expected = executeDeterministicRule(
    parsed,
    snapshot,
    "input-hash",
    "factbase-input-manifest",
    "1",
  );
  const originalCanonicalizeAndHash = canonicalJsonModule.canonicalizeAndHash;
  try {
    canonicalJsonModule.canonicalizeAndHash = () => ({
      canonical: '{"attackerControlled":true}',
      hash: "f".repeat(64),
    });
    const actual = executeDeterministicRule(
      parsed,
      snapshot,
      "input-hash",
      "factbase-input-manifest",
      "1",
    );
    assert.equal(getDerivationInterpreterArtifactHash(), artifactHash);
    assert.equal(actual.outputCanonical, expected.outputCanonical);
    assert.equal(actual.outputHash, expected.outputHash);
  } finally {
    canonicalJsonModule.canonicalizeAndHash = originalCanonicalizeAndHash;
  }
});

test("interpreter artifact binds capture initialization semantics", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "factbase-rcv015-capture-"));
  const originalTree = join(temporaryDirectory, "original");
  const changedTree = join(temporaryDirectory, "changed");
  try {
    symlinkSync(
      join(__dirname, "..", "node_modules"),
      join(temporaryDirectory, "node_modules"),
      "dir",
    );
    cpSync(join(__dirname, "..", "dist"), originalTree, { recursive: true });
    cpSync(join(__dirname, "..", "dist"), changedTree, { recursive: true });
    const originalPath = join(originalTree, "services", "derivationRuleInterpreter.js");
    const changedPath = join(changedTree, "services", "derivationRuleInterpreter.js");
    const originalSource = readFileSync(changedPath, "utf8");
    const changedSource = originalSource.replace(
      "canonicalizeAndHash: canonicalJson_1.canonicalizeAndHash,",
      "canonicalizeAndHash: (...args) => canonicalJson_1.canonicalizeAndHash(...args),",
    );
    assert.notEqual(changedSource, originalSource);
    writeFileSync(changedPath, changedSource, "utf8");

    const original = require(originalPath);
    const changed = require(changedPath);
    assert.notEqual(
      changed.getDerivationInterpreterArtifactHash(),
      original.getDerivationInterpreterArtifactHash(),
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("prototype mutation cannot alter deterministic interpreter output", () => {
  const parsed = validateRuleDefinition(definition(), "deterministic_rules");
  const snapshot = {
    claimVersion: { id: "version-id" },
    evidenceRelations: [{
      relationId: "relation-1",
      assessments: [{ id: "assessment-1" }],
      assessmentGraph: {
        integrity: {
          anomalies: [{ code: "cycle", assessmentIds: ["assessment-1"] }],
        },
      },
    }],
  };
  const expected = interpretDeterministicRule(parsed, snapshot, "input-hash");
  const originals = {
    map: Array.prototype.map,
    flatMap: Array.prototype.flatMap,
    sort: Array.prototype.sort,
    push: Array.prototype.push,
    objectKeys: Object.keys,
    jsonStringify: JSON.stringify,
    Map: globalThis.Map,
    Set: globalThis.Set,
  };
  let actual;
  try {
    Array.prototype.map = () => { throw new Error("map must not be used"); };
    Array.prototype.flatMap = () => { throw new Error("flatMap must not be used"); };
    Array.prototype.sort = () => { throw new Error("sort must not be used"); };
    Array.prototype.push = () => { throw new Error("push must not be used"); };
    Object.keys = () => { throw new Error("Object.keys must not be used"); };
    JSON.stringify = () => { throw new Error("JSON.stringify must not be used"); };
    globalThis.Map = class { constructor() { throw new Error("Map must not be used"); } };
    globalThis.Set = class { constructor() { throw new Error("Set must not be used"); } };
    actual = interpretDeterministicRule(parsed, snapshot, "input-hash");
  } finally {
    Array.prototype.map = originals.map;
    Array.prototype.flatMap = originals.flatMap;
    Array.prototype.sort = originals.sort;
    Array.prototype.push = originals.push;
    Object.keys = originals.objectKeys;
    JSON.stringify = originals.jsonStringify;
    globalThis.Map = originals.Map;
    globalThis.Set = originals.Set;
  }
  assert.deepEqual(actual, expected);
  assert.deepEqual(getDerivationExecutionIdentity(), parsed.interpreter.execution);
});

test("inherited numeric Array accessors cannot alter deterministic interpreter output", () => {
  const parsed = validateRuleDefinition(definition(), "deterministic_rules");
  const snapshot = {
    claimVersion: { id: "version-id" },
    evidenceRelations: [{
      relationId: "relation-1",
      assessments: [{ id: "assessment-1" }],
      assessmentGraph: { integrity: { anomalies: [] } },
    }],
  };
  const expected = interpretDeterministicRule(parsed, snapshot, "input-hash");
  const hashBefore = getDerivationInterpreterArtifactHash();
  let actual;
  Object.defineProperty(Array.prototype, "0", {
    configurable: true,
    get() { return undefined; },
    set(_) {},
  });
  try {
    actual = interpretDeterministicRule(parsed, snapshot, "input-hash");
  } finally {
    delete Array.prototype[0];
  }
  assert.deepEqual(actual, expected);
  assert.equal(getDerivationInterpreterArtifactHash(), hashBefore);
});

function snapshotClient() {
  const version = {
    id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
    claim_id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
    version_number: 1,
    title: "title",
    normalized_statement: "statement",
    language: "en",
    claim_type: "fact",
    status: "draft",
    publication_status: "unpublished",
    change_reason: "initial",
    based_on_version_id: null,
    actor_type: null,
    actor_id: null,
    source_type: null,
    source_reference: null,
    request_id: null,
    created_at_canonical: "2026-01-01T00:00:00.000001Z",
  };
  const evidence = [
    {
      relation_id: "00000000-0000-0000-0000-000000000001",
      evidence_id: "10000000-0000-0000-0000-000000000001",
      relation: "supports",
      relation_created_at_canonical: "2026-01-01T00:00:01.000001Z",
    },
    {
      relation_id: "00000000-0000-0000-0000-000000000002",
      evidence_id: "10000000-0000-0000-0000-000000000002",
      relation: "contradicts",
      relation_created_at_canonical: "2026-01-01T00:00:02.000001Z",
    },
  ];
  for (let index = 0; index < evidence.length; index += 1) {
    evidence[index].source_url = null;
    evidence[index].source_title = null;
    evidence[index].source_type = null;
    evidence[index].locator = null;
    evidence[index].quoted_text = null;
    evidence[index].snapshot_hash = null;
    evidence[index].retrieved_at_canonical = "2026-01-01T00:00:00.123456Z";
    evidence[index].evidence_created_at_canonical = "2026-01-01T00:00:00.000001Z";
  }
  const assessments = [
    {
      id: "20000000-0000-0000-0000-000000000001",
      relation_id: evidence[0].relation_id,
      responds_to_assessment_id: "20000000-0000-0000-0000-000000000002",
      response_relation: "disputes",
      parent_assessment_id: "20000000-0000-0000-0000-000000000002",
      parent_relation_id: evidence[0].relation_id,
      source_quality_decimal: "0.7500",
    },
    {
      id: "20000000-0000-0000-0000-000000000002",
      relation_id: evidence[0].relation_id,
      responds_to_assessment_id: "20000000-0000-0000-0000-000000000001",
      response_relation: "supports",
      parent_assessment_id: "20000000-0000-0000-0000-000000000001",
      parent_relation_id: evidence[0].relation_id,
      source_quality_decimal: "1",
    },
  ];
  for (let index = 0; index < assessments.length; index += 1) {
    assessments[index].relevance_decimal = null;
    assessments[index].directness_decimal = null;
    assessments[index].recency_decimal = null;
    assessments[index].independence_decimal = index === 0 ? "0.5" : null;
    assessments[index].assessment_method = "manual";
    assessments[index].rationale = `rationale-${index}`;
    assessments[index].assessed_by = null;
    assessments[index].initiator_type = null;
    assessments[index].initiator_id = null;
    assessments[index].rubric_id = "factbase-evidence-assessment";
    assessments[index].rubric_version = "1";
    assessments[index].recency_reference_type = null;
    assessments[index].recency_reference_at_canonical = null;
    assessments[index].rule_set_id = null;
    assessments[index].rule_set_version = null;
    assessments[index].model_id = null;
    assessments[index].model_version = null;
    assessments[index].model_process_type = null;
    assessments[index].model_process_version = null;
    assessments[index].import_reference_type = null;
    assessments[index].import_reference = null;
    assessments[index].assessed_at_canonical = `2026-01-01T00:00:0${index + 3}.000001Z`;
  }
  const comparisons = [{
    assessment_id: assessments[0].id,
    comparison_claim_version_evidence_id: evidence[1].relation_id,
  }];
  let call = 0;
  const rows = [[version], evidence, assessments, comparisons];
  return { async query() { const result = { rows: rows[call] }; call += 1; return result; } };
}

test("post-load canonicalizer export replacement cannot alter snapshot bytes", async () => {
  const canonicalJsonModule = require("../dist/services/canonicalJson");
  const identity = getDerivationSnapshotBuilderIdentity();
  const expected = await loadDerivationInputSnapshot(snapshotClient());
  const originalCanonicalizeAndHash = canonicalJsonModule.canonicalizeAndHash;
  try {
    canonicalJsonModule.canonicalizeAndHash = () => ({
      canonical: '{"attackerControlled":true}',
      hash: "e".repeat(64),
    });
    const actual = await loadDerivationInputSnapshot(snapshotClient());
    assert.deepEqual(getDerivationSnapshotBuilderIdentity(), identity);
    assert.equal(actual.inputCanonical, expected.inputCanonical);
    assert.equal(actual.inputHash, expected.inputHash);
  } finally {
    canonicalJsonModule.canonicalizeAndHash = originalCanonicalizeAndHash;
  }
});

test("post-load transitive module export replacement cannot alter bound artifacts", async () => {
  const canonicalJsonModule = require("../dist/services/canonicalJson");
  const decimalModule = require("../dist/services/canonicalDecimal");
  const graphModule = require("../dist/services/derivationAssessmentGraph");
  const schemaModule = require("../dist/services/derivationInputSchemaV1");
  const safeRuntimeModule = require("../dist/services/derivationSafeRuntime");
  const originalExports = {
    canonicalizeAndHash: canonicalJsonModule.canonicalizeAndHash,
    canonicalizePostgreSqlNumeric: decimalModule.canonicalizePostgreSqlNumeric,
    buildDerivationAssessmentGraph: graphModule.buildDerivationAssessmentGraph,
    assertDerivationInputSchemaV1: schemaModule.assertDerivationInputSchemaV1,
    appendArrayElement: safeRuntimeModule.appendArrayElement,
    safeLowerCase: safeRuntimeModule.safeLowerCase,
    safeSha256: safeRuntimeModule.safeSha256,
  };
  const interpreterIdentity = getDerivationInterpreterArtifactHash();
  const builderIdentity = getDerivationSnapshotBuilderIdentity();
  const parsed = validateRuleDefinition(definition(), "deterministic_rules");
  const neutralSnapshot = { claimVersion: { id: "version-id" }, evidenceRelations: [] };
  const expectedOutput = executeDeterministicRule(
    parsed,
    neutralSnapshot,
    "input-hash",
    "factbase-input-manifest",
    "1",
  );
  const expectedInput = await loadDerivationInputSnapshot(snapshotClient());
  try {
    canonicalJsonModule.canonicalizeAndHash = () => ({
      canonical: '{"changed":true}',
      hash: "a".repeat(64),
    });
    decimalModule.canonicalizePostgreSqlNumeric = () => "0";
    graphModule.buildDerivationAssessmentGraph = () => ({
      unparentedAssessmentIds: [],
      integrity: { status: "valid", anomalies: [] },
    });
    schemaModule.assertDerivationInputSchemaV1 = () => {};
    safeRuntimeModule.appendArrayElement = () => {};
    safeRuntimeModule.safeLowerCase = () => "changed";
    safeRuntimeModule.safeSha256 = () => "b".repeat(64);

    const actualOutput = executeDeterministicRule(
      parsed,
      neutralSnapshot,
      "input-hash",
      "factbase-input-manifest",
      "1",
    );
    const actualInput = await loadDerivationInputSnapshot(snapshotClient());
    assert.equal(getDerivationInterpreterArtifactHash(), interpreterIdentity);
    assert.deepEqual(getDerivationSnapshotBuilderIdentity(), builderIdentity);
    assert.equal(actualOutput.outputCanonical, expectedOutput.outputCanonical);
    assert.equal(actualOutput.outputHash, expectedOutput.outputHash);
    assert.equal(actualInput.inputCanonical, expectedInput.inputCanonical);
    assert.equal(actualInput.inputHash, expectedInput.inputHash);
  } finally {
    canonicalJsonModule.canonicalizeAndHash = originalExports.canonicalizeAndHash;
    decimalModule.canonicalizePostgreSqlNumeric =
      originalExports.canonicalizePostgreSqlNumeric;
    graphModule.buildDerivationAssessmentGraph =
      originalExports.buildDerivationAssessmentGraph;
    schemaModule.assertDerivationInputSchemaV1 =
      originalExports.assertDerivationInputSchemaV1;
    safeRuntimeModule.appendArrayElement = originalExports.appendArrayElement;
    safeRuntimeModule.safeLowerCase = originalExports.safeLowerCase;
    safeRuntimeModule.safeSha256 = originalExports.safeSha256;
  }
});

function recordedDefinition() {
  return {
    contract: { id: "factbase-recorded-process-rule", version: "1" },
    audit: {
      schemaId: "factbase-recorded-process-audit",
      schemaVersion: "1",
    },
  };
}

function derivationTransactionHarness({ mode, failAt, rollbackFails = false }) {
  const snapshot = snapshotClient();
  const execution = getDerivationExecutionIdentity();
  const builder = getDerivationSnapshotBuilderIdentity();
  const ruleDefinition = mode === "deterministic_rules"
    ? definition()
    : recordedDefinition();
  const definitionRecord = canonicalizeAndHash(ruleDefinition);
  const ruleId = mode === "deterministic_rules"
    ? "30000000-0000-4000-8000-000000000001"
    : "30000000-0000-4000-8000-000000000002";
  const queries = [];
  const releases = [];
  const persisted = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === "BEGIN" || sql.startsWith("SET TRANSACTION")) return { rows: [] };
      if (sql === "ROLLBACK") {
        if (rollbackFails) throw new Error("rollback failed");
        persisted.length = 0;
        return { rows: [] };
      }
      if (sql === "COMMIT") return { rows: [] };
      if (
        sql.includes("FROM public.claim_versions") ||
        sql.includes("FROM public.claim_version_evidence cve") ||
        sql.includes("FROM public.evidence_assessments ea") ||
        sql.includes("FROM public.evidence_assessment_independence_comparisons")
      ) {
        return snapshot.query();
      }
      if (sql.includes("FROM public.derivation_rule_revisions")) {
        return {
          rows: [{
            id: ruleId,
            rule_id: `rule-${mode}`,
            rule_version: "1",
            derivation_type: "input_manifest",
            definition_canonical: definitionRecord.canonical,
            definition_hash: definitionRecord.hash,
            input_schema_id: "factbase-derivation-input",
            input_schema_version: "1",
            output_schema_id: "factbase-input-manifest",
            output_schema_version: "1",
            canonicalization_id: "jcs-rfc8785",
            canonicalization_version: "1",
            hash_algorithm: "sha-256",
            reproducibility_mode: mode,
            interpreter_id: mode === "deterministic_rules"
              ? "factbase-derivation-rule-interpreter"
              : null,
            interpreter_version: mode === "deterministic_rules" ? "1" : null,
            interpreter_artifact_hash: mode === "deterministic_rules"
              ? getDerivationInterpreterArtifactHash()
              : null,
            interpreter_execution_contract_id: mode === "deterministic_rules"
              ? execution.contractId
              : null,
            interpreter_execution_contract_version: mode === "deterministic_rules"
              ? execution.contractVersion
              : null,
            interpreter_execution_contract_hash: mode === "deterministic_rules"
              ? execution.contractHash
              : null,
            interpreter_runtime_id: mode === "deterministic_rules"
              ? execution.runtimeId
              : null,
            interpreter_runtime_version: mode === "deterministic_rules"
              ? execution.runtimeVersion
              : null,
            snapshot_builder_id: builder.id,
            snapshot_builder_version: builder.version,
            snapshot_builder_artifact_hash: builder.artifactHash,
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          }],
        };
      }
      if (sql.includes("FROM public.derivation_rule_decision_codes")) {
        return {
          rows: [
            { input_kind: "assessment", usage: "used", decision_code: "included_in_manifest" },
            { input_kind: "evidence_relation", usage: "used", decision_code: "included_in_manifest" },
          ],
        };
      }
      if (sql.includes("INSERT INTO public.derivations")) {
        persisted.push("derivation");
        return {
          rows: [{
            id: "40000000-0000-4000-8000-000000000001",
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          }],
        };
      }
      for (const [marker, fragment] of [
        ["evidence", "INSERT INTO public.derivation_evidence_inputs"],
        ["assessment", "INSERT INTO public.derivation_assessment_inputs"],
        ["audit", "INSERT INTO public.derivation_recorded_process_audits"],
      ]) {
        if (sql.includes(fragment)) {
          if (failAt === marker) throw new Error(`${marker} insert failed`);
          persisted.push(marker);
          return { rows: [] };
        }
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release(destroy) { releases.push(destroy === true); },
  };
  return {
    pool: { async connect() { return client; } },
    queries,
    releases,
    persisted,
    ruleId,
  };
}

test("service handoff rejects snapshot and output wrappers under unchanged identities", async () => {
  const cases = [
    {
      from: "const loadFinalizedDerivationInputSnapshot = derivationInputSnapshotService_1.loadDerivationInputSnapshot;",
      to: `const loadFinalizedDerivationInputSnapshot = async (...args) => {
    const result = await (0, derivationInputSnapshotService_1.loadDerivationInputSnapshot)(...args);
    const inputCanonical = "{}";
    return Object.freeze({ ...result, inputCanonical, inputHash: (0, canonicalJson_1.sha256)(inputCanonical) });
};`,
      expected: /not finalized by the bound builder/,
    },
    {
      from: "const executeFinalizedDeterministicRule = derivationRuleInterpreter_1.executeDeterministicRule;",
      to: `const executeFinalizedDeterministicRule = (...args) => {
    const result = (0, derivationRuleInterpreter_1.executeDeterministicRule)(...args);
    const outputCanonical = "{}";
    return Object.freeze({ ...result, outputCanonical, outputHash: (0, canonicalJson_1.sha256)(outputCanonical) });
};`,
      expected: /not finalized by the bound interpreter/,
    },
  ];

  for (const testCase of cases) {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "factbase-rcv015-handoff-"));
    const copiedTree = join(temporaryDirectory, "dist");
    try {
      symlinkSync(
        join(__dirname, "..", "node_modules"),
        join(temporaryDirectory, "node_modules"),
        "dir",
      );
      cpSync(join(__dirname, "..", "dist"), copiedTree, { recursive: true });
      const servicePath = join(copiedTree, "services", "derivationService.js");
      const originalSource = readFileSync(servicePath, "utf8");
      const changedSource = originalSource.replace(testCase.from, testCase.to);
      assert.notEqual(changedSource, originalSource);
      writeFileSync(servicePath, changedSource, "utf8");

      const changedService = require(servicePath);
      const harness = derivationTransactionHarness({ mode: "deterministic_rules" });
      await assert.rejects(
        changedService.createDerivation(
          {
            claimVersionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            ruleRevisionId: harness.ruleId,
          },
          harness.pool,
        ),
        testCase.expected,
      );
      assert.equal(
        harness.queries.some((sql) => sql.includes("INSERT INTO public.derivations")),
        false,
      );
      assert.equal(harness.queries.at(-1), "ROLLBACK");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

test("finalized snapshot and deterministic output handoffs are deeply immutable", async () => {
  const snapshotResult = await loadDerivationInputSnapshot(snapshotClient(), "version-id");
  const execution = executeDeterministicRule(
    validateRuleDefinition(definition(), "deterministic_rules"),
    snapshotResult.snapshot,
    snapshotResult.inputHash,
    "factbase-input-manifest",
    "1",
  );
  assert.equal(Object.isFrozen(snapshotResult), true);
  assert.equal(Object.isFrozen(snapshotResult.snapshot), true);
  assert.equal(Object.isFrozen(snapshotResult.snapshot.evidenceRelations), true);
  assert.equal(Object.isFrozen(execution), true);
  assert.equal(Object.isFrozen(execution.output), true);
  assert.equal(Object.isFrozen(execution.usageDecisions), true);
  assert.throws(() =>
    Object.defineProperty(snapshotResult.snapshot.claimVersion, "title", {
      value: "mutated",
    }),
  );
  assert.throws(() =>
    Object.defineProperty(execution.output, "inputHash", { value: "mutated" }),
  );
});

test("post-load mutable intrinsics cannot alter snapshot bytes or hash", async () => {
  const expectedSnapshot = await loadDerivationInputSnapshot(
    snapshotClient(),
    "version-id",
  );
  const expected = {
    canonical: expectedSnapshot.inputCanonical,
    hash: expectedSnapshot.inputHash,
  };
  const builderHash = getDerivationSnapshotBuilderIdentity().artifactHash;
  const originals = {
    map: Array.prototype.map,
    flatMap: Array.prototype.flatMap,
    sort: Array.prototype.sort,
    push: Array.prototype.push,
    filter: Array.prototype.filter,
    reduce: Array.prototype.reduce,
    slice: Array.prototype.slice,
    indexOf: Array.prototype.indexOf,
    objectKeys: Object.keys,
    objectEntries: Object.entries,
    objectGetPrototypeOf: Object.getPrototypeOf,
    objectGetOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
    reflectOwnKeys: Reflect.ownKeys,
    reflectDefineProperty: Reflect.defineProperty,
    jsonStringify: JSON.stringify,
    Map: globalThis.Map,
    Set: globalThis.Set,
    lowerCase: String.prototype.toLowerCase,
    charCodeAt: String.prototype.charCodeAt,
    startsWith: String.prototype.startsWith,
    stringSlice: String.prototype.slice,
    repeat: String.prototype.repeat,
    replace: String.prototype.replace,
    regexpExec: RegExp.prototype.exec,
    regexpTest: RegExp.prototype.test,
    numberFinite: Number.isFinite,
    numberSafeInteger: Number.isSafeInteger,
    mathAbs: Math.abs,
    arrayZero: Object.getOwnPropertyDescriptor(Array.prototype, "0"),
    arrayOne: Object.getOwnPropertyDescriptor(Array.prototype, "1"),
    objectToJSON: Object.getOwnPropertyDescriptor(Object.prototype, "toJSON"),
    arrayToJSON: Object.getOwnPropertyDescriptor(Array.prototype, "toJSON"),
  };
  const fail = (name) => () => { throw new Error(`${name} must be load-bound`); };
  let actual;
  try {
    Array.prototype.map = fail("map");
    Array.prototype.flatMap = fail("flatMap");
    Array.prototype.sort = fail("sort");
    Array.prototype.push = fail("push");
    Array.prototype.filter = fail("filter");
    Array.prototype.reduce = fail("reduce");
    Array.prototype.slice = fail("slice");
    Array.prototype.indexOf = fail("indexOf");
    Object.keys = fail("Object.keys");
    Object.entries = fail("Object.entries");
    Object.getPrototypeOf = fail("Object.getPrototypeOf");
    Object.getOwnPropertyDescriptors = fail("Object.getOwnPropertyDescriptors");
    Reflect.ownKeys = fail("Reflect.ownKeys");
    Reflect.defineProperty = fail("Reflect.defineProperty");
    JSON.stringify = fail("JSON.stringify");
    globalThis.Map = class { constructor() { throw new Error("Map must be load-bound"); } };
    globalThis.Set = class { constructor() { throw new Error("Set must be load-bound"); } };
    String.prototype.toLowerCase = fail("toLowerCase");
    String.prototype.charCodeAt = fail("charCodeAt");
    String.prototype.startsWith = fail("startsWith");
    String.prototype.slice = fail("String.slice");
    String.prototype.repeat = fail("repeat");
    String.prototype.replace = fail("replace");
    RegExp.prototype.exec = fail("RegExp.exec");
    RegExp.prototype.test = fail("RegExp.test");
    Number.isFinite = fail("Number.isFinite");
    Number.isSafeInteger = fail("Number.isSafeInteger");
    Math.abs = fail("Math.abs");
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      get() { return "poison"; },
      set(_) {},
    });
    Object.defineProperty(Array.prototype, "1", {
      configurable: true,
      get() { return "poison"; },
      set(_) {},
    });
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value: fail("Object.prototype.toJSON"),
    });
    Object.defineProperty(Array.prototype, "toJSON", {
      configurable: true,
      value: fail("Array.prototype.toJSON"),
    });
    const snapshot = await loadDerivationInputSnapshot(
      snapshotClient(),
      "version-id",
    );
    actual = {
      canonical: snapshot.inputCanonical,
      hash: snapshot.inputHash,
    };
  } finally {
    Array.prototype.map = originals.map;
    Array.prototype.flatMap = originals.flatMap;
    Array.prototype.sort = originals.sort;
    Array.prototype.push = originals.push;
    Array.prototype.filter = originals.filter;
    Array.prototype.reduce = originals.reduce;
    Array.prototype.slice = originals.slice;
    Array.prototype.indexOf = originals.indexOf;
    Object.keys = originals.objectKeys;
    Object.entries = originals.objectEntries;
    Object.getPrototypeOf = originals.objectGetPrototypeOf;
    Object.getOwnPropertyDescriptors = originals.objectGetOwnPropertyDescriptors;
    Reflect.ownKeys = originals.reflectOwnKeys;
    Reflect.defineProperty = originals.reflectDefineProperty;
    JSON.stringify = originals.jsonStringify;
    globalThis.Map = originals.Map;
    globalThis.Set = originals.Set;
    String.prototype.toLowerCase = originals.lowerCase;
    String.prototype.charCodeAt = originals.charCodeAt;
    String.prototype.startsWith = originals.startsWith;
    String.prototype.slice = originals.stringSlice;
    String.prototype.repeat = originals.repeat;
    String.prototype.replace = originals.replace;
    RegExp.prototype.exec = originals.regexpExec;
    RegExp.prototype.test = originals.regexpTest;
    Number.isFinite = originals.numberFinite;
    Number.isSafeInteger = originals.numberSafeInteger;
    Math.abs = originals.mathAbs;
    if (originals.arrayZero) {
      Object.defineProperty(Array.prototype, "0", originals.arrayZero);
    } else {
      delete Array.prototype[0];
    }
    if (originals.arrayOne) {
      Object.defineProperty(Array.prototype, "1", originals.arrayOne);
    } else {
      delete Array.prototype[1];
    }
    if (originals.objectToJSON) {
      Object.defineProperty(Object.prototype, "toJSON", originals.objectToJSON);
    } else {
      delete Object.prototype.toJSON;
    }
    if (originals.arrayToJSON) {
      Object.defineProperty(Array.prototype, "toJSON", originals.arrayToJSON);
    } else {
      delete Array.prototype.toJSON;
    }
  }
  assert.deepEqual(actual, expected);
  assert.equal(getDerivationSnapshotBuilderIdentity().artifactHash, builderHash);
});

test("snapshot V1 governance separates schema changes from implementation identity", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "factbase-rcv015-snapshot-"));
  const originalTree = join(temporaryDirectory, "original");
  const changedTree = join(temporaryDirectory, "changed");
  try {
    symlinkSync(
      join(__dirname, "..", "node_modules"),
      join(temporaryDirectory, "node_modules"),
      "dir",
    );
    cpSync(join(__dirname, "..", "dist"), originalTree, { recursive: true });
    cpSync(join(__dirname, "..", "dist"), changedTree, { recursive: true });
    const originalSnapshotPath = join(
      originalTree,
      "services",
      "derivationInputSnapshotService.js",
    );
    const changedSnapshotPath = join(
      changedTree,
      "services",
      "derivationInputSnapshotService.js",
    );
    const changedGraphPath = join(
      changedTree,
      "services",
      "derivationAssessmentGraph.js",
    );
    const originalGraphSource = readFileSync(changedGraphPath, "utf8");
    const changedGraphSource = originalGraphSource.replace(
      'code: "cycle",',
      'code: "cycle_changed",',
    );
    assert.notEqual(changedGraphSource, originalGraphSource);
    writeFileSync(changedGraphPath, changedGraphSource, "utf8");

    const originalIdentity = require(originalSnapshotPath)
      .getDerivationSnapshotBuilderIdentity();
    const graphChangedIdentity = require(changedSnapshotPath)
      .getDerivationSnapshotBuilderIdentity();
    assert.equal(graphChangedIdentity.id, originalIdentity.id);
    assert.equal(graphChangedIdentity.version, originalIdentity.version);
    assert.notEqual(graphChangedIdentity.artifactHash, originalIdentity.artifactHash);
    await assert.rejects(
      require(changedSnapshotPath).loadDerivationInputSnapshot(snapshotClient()),
      /unknown V1 graph code/,
    );

    const secondChangedTree = join(temporaryDirectory, "mapping-changed");
    cpSync(join(__dirname, "..", "dist"), secondChangedTree, { recursive: true });
    const mappingPath = join(
      secondChangedTree,
      "services",
      "derivationInputSnapshotService.js",
    );
    const originalMappingSource = readFileSync(mappingPath, "utf8");
    const changedMappingSource = originalMappingSource.replace(
      "publicationStatus: version.publication_status",
      "publicationStatusChanged: version.publication_status",
    );
    assert.notEqual(changedMappingSource, originalMappingSource);
    writeFileSync(mappingPath, changedMappingSource, "utf8");
    const mappingChangedIdentity = require(mappingPath)
      .getDerivationSnapshotBuilderIdentity();
    assert.notEqual(mappingChangedIdentity.artifactHash, originalIdentity.artifactHash);
    await assert.rejects(
      require(mappingPath).loadDerivationInputSnapshot(snapshotClient()),
      /unexpected or missing field/,
    );

    const envelopeChangedTree = join(temporaryDirectory, "envelope-changed");
    cpSync(join(__dirname, "..", "dist"), envelopeChangedTree, { recursive: true });
    const envelopePath = join(
      envelopeChangedTree,
      "services",
      "derivationInputSnapshotService.js",
    );
    const originalEnvelopeSource = readFileSync(envelopePath, "utf8");
    const changedEnvelopeSource = originalEnvelopeSource.replace(
      "id: INPUT_SCHEMA_ID",
      "id: `${INPUT_SCHEMA_ID}-changed`",
    );
    assert.notEqual(changedEnvelopeSource, originalEnvelopeSource);
    writeFileSync(envelopePath, changedEnvelopeSource, "utf8");
    const envelopeChangedIdentity = require(envelopePath)
      .getDerivationSnapshotBuilderIdentity();
    assert.notEqual(envelopeChangedIdentity.artifactHash, originalIdentity.artifactHash);
    await assert.rejects(
      require(envelopePath).loadDerivationInputSnapshot(snapshotClient()),
      /unsupported schema identity/,
    );

    const validatorChangedTree = join(temporaryDirectory, "validator-changed");
    cpSync(join(__dirname, "..", "dist"), validatorChangedTree, { recursive: true });
    const validatorSnapshotPath = join(
      validatorChangedTree,
      "services",
      "derivationInputSnapshotService.js",
    );
    const validatorPath = join(
      validatorChangedTree,
      "services",
      "derivationInputSchemaV1.js",
    );
    const originalValidatorSource = readFileSync(validatorPath, "utf8");
    const changedValidatorSource = originalValidatorSource.replace(
      "expected a positive safe integer number",
      "expected the unchanged V1 positive integer representation",
    );
    assert.notEqual(changedValidatorSource, originalValidatorSource);
    writeFileSync(validatorPath, changedValidatorSource, "utf8");
    const validatorChanged = require(validatorSnapshotPath);
    const validatorChangedIdentity = validatorChanged
      .getDerivationSnapshotBuilderIdentity();
    assert.equal(validatorChangedIdentity.id, originalIdentity.id);
    assert.equal(validatorChangedIdentity.version, originalIdentity.version);
    assert.notEqual(
      validatorChangedIdentity.artifactHash,
      originalIdentity.artifactHash,
    );
    const validatorChangedSnapshot = await validatorChanged
      .loadDerivationInputSnapshot(snapshotClient());
    const originalSnapshotForValidator = await require(originalSnapshotPath)
      .loadDerivationInputSnapshot(snapshotClient());
    assert.equal(
      validatorChangedSnapshot.inputCanonical,
      originalSnapshotForValidator.inputCanonical,
    );
    assert.equal(
      validatorChangedSnapshot.inputHash,
      originalSnapshotForValidator.inputHash,
    );

    const implementationChangedTree = join(temporaryDirectory, "implementation-changed");
    cpSync(join(__dirname, "..", "dist"), implementationChangedTree, { recursive: true });
    const implementationPath = join(
      implementationChangedTree,
      "services",
      "derivationInputSnapshotService.js",
    );
    const originalImplementationSource = readFileSync(implementationPath, "utf8");
    const changedImplementationSource = originalImplementationSource.replace(
      "const versionResult = await client.query",
      "void 0;\n    const versionResult = await client.query",
    );
    assert.notEqual(changedImplementationSource, originalImplementationSource);
    writeFileSync(implementationPath, changedImplementationSource, "utf8");
    const implementationChanged = require(implementationPath);
    const implementationChangedIdentity = implementationChanged
      .getDerivationSnapshotBuilderIdentity();
    assert.equal(implementationChangedIdentity.id, originalIdentity.id);
    assert.equal(implementationChangedIdentity.version, originalIdentity.version);
    assert.notEqual(
      implementationChangedIdentity.artifactHash,
      originalIdentity.artifactHash,
    );
    const originalSnapshot = await require(originalSnapshotPath)
      .loadDerivationInputSnapshot(snapshotClient());
    const implementationChangedSnapshot = await implementationChanged
      .loadDerivationInputSnapshot(snapshotClient());
    assertDerivationInputSchemaV1(originalSnapshot.snapshot);
    assertDerivationInputSchemaV1(implementationChangedSnapshot.snapshot);
    assert.equal(
      implementationChangedSnapshot.inputCanonical,
      originalSnapshot.inputCanonical,
    );
    assert.equal(implementationChangedSnapshot.inputHash, originalSnapshot.inputHash);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("snapshot builder artifact binds capture initialization semantics", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "factbase-rcv015-capture-"));
  const originalTree = join(temporaryDirectory, "original");
  const changedTree = join(temporaryDirectory, "changed");
  try {
    symlinkSync(
      join(__dirname, "..", "node_modules"),
      join(temporaryDirectory, "node_modules"),
      "dir",
    );
    cpSync(join(__dirname, "..", "dist"), originalTree, { recursive: true });
    cpSync(join(__dirname, "..", "dist"), changedTree, { recursive: true });
    const originalPath = join(
      originalTree,
      "services",
      "derivationInputSnapshotService.js",
    );
    const changedPath = join(
      changedTree,
      "services",
      "derivationInputSnapshotService.js",
    );
    const originalSource = readFileSync(changedPath, "utf8");
    const changedSource = originalSource.replace(
      "canonicalizeAndHash: canonicalJson_1.canonicalizeAndHash,",
      "canonicalizeAndHash: (...args) => canonicalJson_1.canonicalizeAndHash(...args),",
    );
    assert.notEqual(changedSource, originalSource);
    writeFileSync(changedPath, changedSource, "utf8");

    const original = require(originalPath);
    const changed = require(changedPath);
    assert.notEqual(
      changed.getDerivationSnapshotBuilderIdentity().artifactHash,
      original.getDerivationSnapshotBuilderIdentity().artifactHash,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("top-level artifacts bind transitive capture initialization semantics", () => {
  const cases = [
    {
      file: "derivationSafeRuntime.js",
      from: "loadedCreateHash: node_crypto_1.createHash,",
      to: "loadedCreateHash: (...args) => (0, node_crypto_1.createHash)(...args),",
      identity(moduleRoot) {
        return {
          interpreter: require(join(moduleRoot, "derivationRuleInterpreter.js"))
            .getDerivationInterpreterArtifactHash(),
          snapshot: require(join(moduleRoot, "derivationInputSnapshotService.js"))
            .getDerivationSnapshotBuilderIdentity().artifactHash,
        };
      },
    },
    {
      file: "derivationSafeRuntime.js",
      from: 'const initialHash = bindings.loadedCreateHash("sha256");',
      to: 'const initialHash = ((algorithm) => bindings.loadedCreateHash(algorithm))("sha256");',
      identity(moduleRoot) {
        return {
          interpreter: require(join(moduleRoot, "derivationRuleInterpreter.js"))
            .getDerivationInterpreterArtifactHash(),
          snapshot: require(join(moduleRoot, "derivationInputSnapshotService.js"))
            .getDerivationSnapshotBuilderIdentity().artifactHash,
        };
      },
    },
    {
      file: "derivationSafeRuntime.js",
      from: "return SAFE_RUNTIME_DERIVED_BINDINGS.stringSlice(value, start, end);",
      to: "return SAFE_RUNTIME_DERIVED_BINDINGS.stringRepeat(value, start);",
      identity(moduleRoot) {
        return {
          interpreter: require(join(moduleRoot, "derivationRuleInterpreter.js"))
            .getDerivationInterpreterArtifactHash(),
          snapshot: require(join(moduleRoot, "derivationInputSnapshotService.js"))
            .getDerivationSnapshotBuilderIdentity().artifactHash,
        };
      },
    },
    {
      file: "derivationExecutionIdentity.js",
      from: "safeSha256: derivationSafeRuntime_1.safeSha256,",
      to: "safeSha256: (value) => derivationSafeRuntime_1.safeSha256(value),",
      identity(moduleRoot) {
        return {
          interpreter: require(join(moduleRoot, "derivationRuleInterpreter.js"))
            .getDerivationInterpreterArtifactHash(),
          snapshot: require(join(moduleRoot, "derivationInputSnapshotService.js"))
            .getDerivationSnapshotBuilderIdentity().artifactHash,
        };
      },
    },
    {
      file: "canonicalJson.js",
      from: "safeSha256: derivationSafeRuntime_1.safeSha256,",
      to: "safeSha256: (value) => derivationSafeRuntime_1.safeSha256(value),",
      identity(moduleRoot) {
        return {
          interpreter: require(join(moduleRoot, "derivationRuleInterpreter.js"))
            .getDerivationInterpreterArtifactHash(),
          snapshot: require(join(moduleRoot, "derivationInputSnapshotService.js"))
            .getDerivationSnapshotBuilderIdentity().artifactHash,
        };
      },
    },
    {
      file: "canonicalJson.js",
      from: "const isolatedCanonicalize = CANONICAL_JSON_BINDINGS.runInContext(`(${canonicalizeSource})`, canonicalRealm);",
      to: "const isolatedCanonicalize = ((loaded) => (value) => loaded(value))(CANONICAL_JSON_BINDINGS.runInContext(`(${canonicalizeSource})`, canonicalRealm));",
      identity(moduleRoot) {
        return {
          interpreter: require(join(moduleRoot, "derivationRuleInterpreter.js"))
            .getDerivationInterpreterArtifactHash(),
          snapshot: require(join(moduleRoot, "derivationInputSnapshotService.js"))
            .getDerivationSnapshotBuilderIdentity().artifactHash,
        };
      },
    },
    {
      file: "canonicalDecimal.js",
      from: "safeSlice: derivationSafeRuntime_1.safeSlice,",
      to: "safeSlice: (...args) => derivationSafeRuntime_1.safeSlice(...args),",
      identity(moduleRoot) {
        return require(join(moduleRoot, "derivationInputSnapshotService.js"))
          .getDerivationSnapshotBuilderIdentity().artifactHash;
      },
    },
    {
      file: "canonicalDecimal.js",
      from: "const decimalPattern = /^([+-]?)(\\d+)(?:\\.(\\d*))?(?:[eE]([+-]?\\d+))?$/;",
      to: "const decimalPattern = /^([+-]?)(\\d+)(?:\\.(\\d*))?(?:[eE]([+-]?\\d+))?$/g;",
      identity(moduleRoot) {
        return require(join(moduleRoot, "derivationInputSnapshotService.js"))
          .getDerivationSnapshotBuilderIdentity().artifactHash;
      },
    },
    {
      file: "derivationAssessmentGraph.js",
      from: "findTextIndex: derivationSafeRuntime_1.findTextIndex,",
      to: "findTextIndex: (...args) => derivationSafeRuntime_1.findTextIndex(...args),",
      identity(moduleRoot) {
        return require(join(moduleRoot, "derivationInputSnapshotService.js"))
          .getDerivationSnapshotBuilderIdentity().artifactHash;
      },
    },
    {
      file: "derivationInputSchemaV1.js",
      from: "validateCanonicalTimestamp: canonicalJson_1.validateCanonicalTimestamp,",
      to: "validateCanonicalTimestamp: (...args) => canonicalJson_1.validateCanonicalTimestamp(...args),",
      identity(moduleRoot) {
        return require(join(moduleRoot, "derivationInputSnapshotService.js"))
          .getDerivationSnapshotBuilderIdentity().artifactHash;
      },
    },
    {
      file: "derivationInputSchemaV1.js",
      from: "const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;",
      to: "const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
      identity(moduleRoot) {
        return require(join(moduleRoot, "derivationInputSnapshotService.js"))
          .getDerivationSnapshotBuilderIdentity().artifactHash;
      },
    },
  ];

  for (const testCase of cases) {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "factbase-rcv015-transitive-"));
    const originalTree = join(temporaryDirectory, "original");
    const changedTree = join(temporaryDirectory, "changed");
    try {
      symlinkSync(
        join(__dirname, "..", "node_modules"),
        join(temporaryDirectory, "node_modules"),
        "dir",
      );
      cpSync(join(__dirname, "..", "dist"), originalTree, { recursive: true });
      cpSync(join(__dirname, "..", "dist"), changedTree, { recursive: true });
      const changedPath = join(changedTree, "services", testCase.file);
      const originalSource = readFileSync(changedPath, "utf8");
      const changedSource = originalSource.replace(testCase.from, testCase.to);
      assert.notEqual(changedSource, originalSource, testCase.file);
      writeFileSync(changedPath, changedSource, "utf8");
      assert.notDeepEqual(
        testCase.identity(join(changedTree, "services")),
        testCase.identity(join(originalTree, "services")),
        testCase.file,
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

test("input schema V1 rejects representation and closed-structure drift", async () => {
  const baseline = (await loadDerivationInputSnapshot(snapshotClient())).snapshot;
  assert.doesNotThrow(() => assertDerivationInputSchemaV1(baseline));
  const clone = () => JSON.parse(JSON.stringify(baseline));

  const versionNumberAsString = clone();
  versionNumberAsString.claimVersion.versionNumber = "1";
  assert.throws(
    () => assertDerivationInputSchemaV1(versionNumberAsString),
    /positive safe integer number/,
  );

  const decimalAsNumber = clone();
  decimalAsNumber.evidenceRelations[0].assessments[0].sourceQuality = 0.75;
  assert.throws(
    () => assertDerivationInputSchemaV1(decimalAsNumber),
    /expected a string/,
  );

  const nonCanonicalTimestamp = clone();
  nonCanonicalTimestamp.evidenceRelations[0].evidence.retrievedAt =
    "2026-01-01T13:00:00.123456+13:00";
  assert.throws(
    () => assertDerivationInputSchemaV1(nonCanonicalTimestamp),
    /YYYY-MM-DDTHH:mm:ss.ffffffZ/,
  );

  const uppercaseUuid = clone();
  uppercaseUuid.claimVersion.id = uppercaseUuid.claimVersion.id.toUpperCase();
  assert.throws(
    () => assertDerivationInputSchemaV1(uppercaseUuid),
    /lowercase canonical UUID/,
  );

  const changedNull = clone();
  changedNull.claimVersion.actor.type = false;
  assert.throws(
    () => assertDerivationInputSchemaV1(changedNull),
    /expected a string/,
  );

  const arrayChangedToObject = clone();
  arrayChangedToObject.evidenceRelations = {};
  assert.throws(
    () => assertDerivationInputSchemaV1(arrayChangedToObject),
    /expected an array/,
  );

  const renamedGraphCode = clone();
  renamedGraphCode.evidenceRelations[0].assessmentGraph.integrity.anomalies[0].code =
    "cycle_changed";
  assert.throws(
    () => assertDerivationInputSchemaV1(renamedGraphCode),
    /unknown V1 graph code/,
  );

  const addedField = clone();
  addedField.claimVersion.unexpected = "value";
  assert.throws(
    () => assertDerivationInputSchemaV1(addedField),
    /unexpected or missing field/,
  );

  const renamedField = clone();
  renamedField.claimVersion.publicationStatusChanged =
    renamedField.claimVersion.publicationStatus;
  delete renamedField.claimVersion.publicationStatus;
  assert.throws(
    () => assertDerivationInputSchemaV1(renamedField),
    /unexpected or missing field/,
  );

  for (const mutate of [
    (value) => { value.evidenceRelations[0].assessments[0].rubric = { id: null, version: null }; },
    (value) => { value.evidenceRelations[0].assessments[0].recencyContext = { referenceType: null, referenceAt: null }; },
    (value) => { value.evidenceRelations[0].assessments[0].responseTo = { assessmentId: null, relation: null }; },
    (value) => { value.evidenceRelations[0].assessments[0].method.ruleSet = { id: null, version: null }; },
    (value) => { value.evidenceRelations[0].assessments[0].method.model = { id: null, version: null, processType: null, processVersion: null }; },
    (value) => { value.evidenceRelations[0].assessments[0].method.imported = { referenceType: null, reference: null }; },
  ]) {
    const allNullContext = clone();
    mutate(allNullContext);
    assert.throws(
      () => assertDerivationInputSchemaV1(allNullContext),
      /absent optional context must be JSON null/,
    );
  }
});

test("current RCV-015 code rejects an unimplemented input schema version", async () => {
  let connected = false;
  const pool = {
    async connect() {
      connected = true;
      throw new Error("must not connect for an unsupported schema");
    },
  };
  await assert.rejects(
    createDerivationRuleRevision(
      {
        ruleId: "future-input-schema",
        ruleVersion: "1",
        derivationType: "input_manifest",
        inputSchemaId: "factbase-derivation-input",
        inputSchemaVersion: "2",
        outputSchemaId: "factbase-input-manifest",
        outputSchemaVersion: "1",
        reproducibilityMode: "deterministic_rules",
        definition: definition(),
      },
      pool,
    ),
    /Unsupported derivation input schema contract/,
  );
  assert.equal(connected, false);
});

test("deterministic output envelope changes require a new interpreter artifact", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "factbase-rcv015-output-"));
  const originalTree = join(temporaryDirectory, "original");
  const changedTree = join(temporaryDirectory, "changed");
  try {
    symlinkSync(
      join(__dirname, "..", "node_modules"),
      join(temporaryDirectory, "node_modules"),
      "dir",
    );
    cpSync(join(__dirname, "..", "dist"), originalTree, { recursive: true });
    cpSync(join(__dirname, "..", "dist"), changedTree, { recursive: true });
    const originalPath = join(
      originalTree,
      "services",
      "derivationRuleInterpreter.js",
    );
    const changedPath = join(
      changedTree,
      "services",
      "derivationRuleInterpreter.js",
    );
    const originalSource = readFileSync(changedPath, "utf8");
    const changedSource = originalSource.replace(
      "schema: { id: outputSchemaId, version: outputSchemaVersion },",
      "schemaChanged: { id: outputSchemaId, version: outputSchemaVersion },",
    );
    assert.notEqual(changedSource, originalSource);
    writeFileSync(changedPath, changedSource, "utf8");

    const originalInterpreter = require(originalPath);
    const changedInterpreter = require(changedPath);
    const originalHash = originalInterpreter.getDerivationInterpreterArtifactHash();
    const changedHash = changedInterpreter.getDerivationInterpreterArtifactHash();
    assert.notEqual(changedHash, originalHash);
    const boundDefinition = definition();
    boundDefinition.interpreter.artifactHash = originalHash;
    assert.throws(() =>
      changedInterpreter.executeDeterministicRule(
        boundDefinition,
        { claimVersion: { id: "version-id" }, evidenceRelations: [] },
        "input-hash",
        "factbase-input-manifest",
        "1",
      ),
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("DSL V1 only accepts its complete neutral contract", () => {
  const parsed = validateRuleDefinition(definition(), "deterministic_rules");
  assert.equal(parsed.dsl.id, "factbase-derivation-rule-dsl");
  assert.equal("decisionCodes" in parsed, false);
  assert.equal("candidateUsage" in parsed, false);
  assert.throws(() =>
    validateRuleDefinition(definition({ condition: { relevance: 1 } }), "deterministic_rules"),
  );
  assert.throws(() =>
    validateRuleDefinition(
      definition({
        interpreter: {
          id: "factbase-derivation-rule-interpreter",
          version: "1",
          artifactHash: "0".repeat(64),
          description: "not an artifact identity",
        },
      }),
      "deterministic_rules",
    ),
  );
  assert.throws(() =>
    validateRuleDefinition(
      definition({
        decisionCodes: [
          { inputKind: "assessment", usage: "not_used", code: "excluded" },
        ],
      }),
      "deterministic_rules",
    ),
  );
  assert.throws(() =>
    validateRuleDefinition(
      definition({ output: { operation: "truth_score" } }),
      "deterministic_rules",
    ),
  );
  assert.throws(() =>
    validateRuleDefinition(
      definition({ interpreter: { id: "callback", version: "1" } }),
      "deterministic_rules",
    ),
  );
});

test("DSL interpreter classifies every candidate uniformly and emits only a manifest", () => {
  const parsed = validateRuleDefinition(definition(), "deterministic_rules");
  const snapshot = {
    claimVersion: { id: "version-id" },
    evidenceRelations: [
      {
        relationId: "relation-1",
        assessments: [{ id: "assessment-1" }, { id: "assessment-2" }],
        assessmentGraph: {
          integrity: {
            anomalies: [{ code: "cycle", assessmentIds: ["assessment-1"] }],
          },
        },
      },
    ],
  };
  const first = interpretDeterministicRule(parsed, snapshot, "input-hash");
  const second = interpretDeterministicRule(parsed, snapshot, "input-hash");
  assert.deepEqual(second, first);
  assert.deepEqual(first.usageDecisions, [
    {
      inputKind: "evidence_relation",
      inputId: "relation-1",
      usage: "used",
      decisionCode: "included_in_manifest",
    },
    {
      inputKind: "assessment",
      inputId: "assessment-1",
      usage: "used",
      decisionCode: "included_in_manifest",
    },
    {
      inputKind: "assessment",
      inputId: "assessment-2",
      usage: "used",
      decisionCode: "included_in_manifest",
    },
  ]);
  assert.equal("score" in first.output, false);
  assert.equal("winner" in first.output, false);
});

test("recorded-process definitions are separate from the DSL", () => {
  const recorded = validateRuleDefinition(
    {
      contract: { id: "factbase-recorded-process-rule", version: "1" },
      audit: {
        schemaId: "factbase-recorded-process-audit",
        schemaVersion: "1",
      },
    },
    "recorded_process",
  );
  assert.equal(recorded.contract.id, "factbase-recorded-process-rule");
  assert.equal("interpreter" in recorded, false);
});

test("derivation service rolls back snapshot failures and destroys a client after rollback failure", async () => {
  const { createDerivation } = require("../dist/services/derivationService");
  for (const rollbackFails of [false, true]) {
    const queries = [];
    const releases = [];
    const client = {
      async query(sql) {
        queries.push(sql);
        if (sql.includes("FROM public.claim_versions")) {
          throw new Error("snapshot failed");
        }
        if (sql === "ROLLBACK" && rollbackFails) {
          throw new Error("rollback failed");
        }
        return { rows: [] };
      },
      release(destroy) { releases.push(destroy === true); },
    };
    const pool = { async connect() { return client; } };
    await assert.rejects(
      createDerivation(
        {
          claimVersionId: "10000000-0000-4000-8000-000000000001",
          ruleRevisionId: "10000000-0000-4000-8000-000000000002",
        },
        pool,
      ),
      rollbackFails
        ? /could not be rolled back/
        : /snapshot failed/,
    );
    assert.deepEqual(queries.slice(0, 4), [
      "BEGIN",
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
      queries[2],
      "ROLLBACK",
    ]);
    assert.equal(queries[2].includes("FROM public.claim_versions"), true);
    assert.deepEqual(releases, [rollbackFails]);
  }
});

test("derivation service atomically rolls back every post-derivation child insert stage", async () => {
  const { createDerivation } = require("../dist/services/derivationService");
  const claimVersionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const evidenceIds = [
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
  ];
  const assessmentIds = [
    "20000000-0000-0000-0000-000000000001",
    "20000000-0000-0000-0000-000000000002",
  ];

  for (const stage of ["evidence", "assessment", "audit"]) {
    const mode = stage === "audit" ? "recorded_process" : "deterministic_rules";
    const harness = derivationTransactionHarness({ mode, failAt: stage });
    const input = {
      claimVersionId,
      ruleRevisionId: harness.ruleId,
    };
    if (mode === "recorded_process") {
      input.recordedProcess = {
        usageDecisions: [
          ...evidenceIds.map((inputId) => ({
            inputKind: "evidence_relation",
            inputId,
            usage: "used",
            decisionCode: "included_in_manifest",
          })),
          ...assessmentIds.map((inputId) => ({
            inputKind: "assessment",
            inputId,
            usage: "used",
            decisionCode: "included_in_manifest",
          })),
        ],
        output: { operation: "recorded_manifest" },
        audit: {
          processId: "process",
          processVersion: "1",
          implementationId: "implementation",
          implementationVersion: "1",
          parameters: {},
          startedAt: "2026-01-01T00:00:00.000001Z",
          completedAt: "2026-01-01T00:00:01.123456Z",
        },
      };
    }
    await assert.rejects(
      createDerivation(input, harness.pool),
      new RegExp(`${stage} insert failed`),
    );
    assert.equal(
      harness.queries.some((sql) => sql.includes("INSERT INTO public.derivations")),
      true,
    );
    assert.equal(harness.queries.at(-1), "ROLLBACK");
    assert.deepEqual(harness.persisted, []);
    assert.deepEqual(harness.releases, [false]);
  }
});

test("a post-derivation failure destroys the client when rollback also fails", async () => {
  const { createDerivation } = require("../dist/services/derivationService");
  const harness = derivationTransactionHarness({
    mode: "deterministic_rules",
    failAt: "evidence",
    rollbackFails: true,
  });
  await assert.rejects(
    createDerivation(
      {
        claimVersionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        ruleRevisionId: harness.ruleId,
      },
      harness.pool,
    ),
    /could not be rolled back/,
  );
  assert.equal(harness.queries.at(-1), "ROLLBACK");
  assert.deepEqual(harness.releases, [true]);
});
