const assert = require("node:assert/strict");
const test = require("node:test");

const { createRcv016ApplicationService } = require("../dist/services/rcv016ApplicationService");
const { canonicalizeRcv016 } = require("../dist/services/rcv016Canonical");
const { validateAndCanonicalizeRcv016ArtifactCapture } = require("../dist/services/rcv016ArtifactCapture");
const { validateRcv016PayloadLimits } = require("../dist/services/rcv016PayloadLimits");
const { verifyRcv016HistoricalSnapshot } = require("../dist/services/rcv016ReadVerifier");
const { buildRcv016ProvenanceSnapshot } = require("../dist/services/rcv016SnapshotBuilder");
const { validateRcv016TraversalPolicy } = require("../dist/services/rcv016TraversalPolicy");
const { writeRcv016Snapshot } = require("../dist/services/rcv016WriteVerifier");
const { RCV016_BOUNDED_PAYLOAD_FIELDS_V1 } = require("../dist/contracts/rcv016ProvenanceContractV1");

const SNAPSHOT_ID = "00000000-0000-0000-0000-000000000800";
const ARTIFACT_VERSION_ID = "00000000-0000-0000-0000-000000000001";
const ARTIFACT_ID = "00000000-0000-0000-0000-000000001001";
const TS = "2026-01-02T03:04:05.000000Z";

function limits() {
  const definition = { limitsId: "phase-6-limits", limitsVersion: "1" };
  for (const field of RCV016_BOUNDED_PAYLOAD_FIELDS_V1) definition[field] = 1_000_000;
  const bound = canonicalizeRcv016(definition);
  return validateRcv016PayloadLimits({ ...definition, definitionCanonical: bound.canonical, definitionHash: bound.hash });
}

function policy() {
  const definition = {
    policyId: "phase-6-policy", policyVersion: "1", maxRoots: 10, maxNodes: 10,
    maxEdges: 10, maxDepth: 2, maxCanonicalSnapshotBytes: 1_000_000,
    allowedRelationships: ["cites", "derived_from", "incorporates", "quotes", "reposts", "syndicated_from", "uses_information_from"],
    deterministicOrdering: "schema_category_then_canonical_key_lexicographic_v1",
    visitedSemantics: "expand_node_once_include_statement_once_diagnose_cycles_v1",
  };
  const bound = canonicalizeRcv016(definition);
  return validateRcv016TraversalPolicy({ ...definition, definitionCanonical: bound.canonical, definitionHash: bound.hash });
}

function inputFixture() {
  const payloadLimits = limits();
  const capture = validateAndCanonicalizeRcv016ArtifactCapture({
    schema: { id: "factbase-artifact-version-capture", version: "1" }, locator: null,
    mediaType: null, title: "Phase 6", publishedAt: null, observedAt: TS, retrievedAt: null,
    representation: { kind: "metadata_only", hashAlgorithm: null, contentHash: null },
  }, payloadLimits);
  return {
    payloadLimits,
    input: {
      snapshotIdentity: { snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1", canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" },
      builderIdentity: { builderId: "factbase-provenance-snapshot-builder", builderVersion: "1", builderArtifactHash: "a".repeat(64) },
      traversalPolicy: policy(), roots: [ARTIFACT_VERSION_ID],
      artifactVersions: [{ artifactVersionId: ARTIFACT_VERSION_ID, artifactId: ARTIFACT_ID, versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: capture.canonical, captureHash: capture.hash, createdAt: TS }],
      sourceVersions: [], artifactProvenanceStatements: [], sourceRelationshipStatements: [],
      artifactSourceAttributions: [], evidenceArtifactBindings: [], knowledgeStateStatements: [],
    },
  };
}

function fakeWriteRepository(expectedPolicy) {
  const calls = [];
  let header;
  let artifactMembership = [];
  const empty = async (rows) => { assert.deepEqual(rows, []); };
  return {
    calls,
    get header() { return header; },
    get artifactMembership() { return artifactMembership; },
    async withRcv016WriteTransaction(options, operation) {
      calls.push(["transaction", options.isolation]);
      const transaction = {
        async loadTraversalPolicyByIdentity(id, version) { calls.push(["policy", id, version]); return expectedPolicy; },
        async lockEvidenceForReferenceVerification() { throw new Error("unexpected Evidence lock"); },
        async lockArtifactVersionForReferenceVerification() { throw new Error("unexpected ArtifactVersion lock"); },
        async lockProvenanceSnapshotForReferenceVerification() { throw new Error("unexpected Snapshot lock"); },
        async insertSnapshotHeader(value) { calls.push(["header", value.snapshotId]); header = structuredClone(value); },
        async insertSnapshotArtifactVersions(rows) { calls.push(["ArtifactVersion", rows.length]); artifactMembership = structuredClone(rows); },
        insertSnapshotSourceVersions: empty,
        insertSnapshotArtifactProvenanceStatements: empty,
        insertSnapshotSourceRelationshipStatements: empty,
        insertSnapshotArtifactSourceAttributions: empty,
        insertSnapshotEvidenceArtifactBindings: empty,
        insertSnapshotKnowledgeStateStatements: empty,
      };
      const result = await operation(transaction);
      calls.push(["commit"]);
      return result;
    },
  };
}

test("three explicit commands delegate once and preserve exact owner result shapes", async () => {
  const calls = [];
  const built = Object.freeze({ authenticated: true });
  const written = Object.freeze({ snapshotId: SNAPSHOT_ID, snapshotHash: "a".repeat(64), snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1" });
  const verified = Object.freeze({ verified: true, snapshotId: SNAPSHOT_ID, snapshotHash: "a".repeat(64), snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1" });
  const writeRepository = {};
  const readRepository = {};
  const snapshotIdFactory = () => SNAPSHOT_ID;
  const service = createRcv016ApplicationService({
    builder(input) { calls.push(["build", input]); return built; },
    async writer(dependencies) { calls.push(["write", dependencies]); return written; },
    async verifier(id, repository) { calls.push(["verify", id, repository]); return verified; },
    writeRepository, readRepository, snapshotIdFactory,
  });
  const input = Object.freeze({ input: true });
  assert.strictEqual(service.buildSnapshot(input), built);
  assert.strictEqual(await service.writeSnapshot(built), written);
  assert.strictEqual(await service.verifySnapshot(SNAPSHOT_ID), verified);
  assert.deepEqual(calls, [
    ["build", input],
    ["write", { builderResult: built, repository: writeRepository, snapshotIdFactory }],
    ["verify", SNAPSHOT_ID, readRepository],
  ]);
});

test("real Builder, Write-Verifier, and Read-Verifier compose without a database", async () => {
  const fixture = inputFixture();
  const writeRepository = fakeWriteRepository(fixture.input.traversalPolicy);
  let rawRead = null;
  const readRepository = { async loadHistoricalSnapshotById(id) { assert.equal(id, SNAPSHOT_ID); return rawRead; } };
  const service = createRcv016ApplicationService({
    builder: buildRcv016ProvenanceSnapshot,
    writer: writeRcv016Snapshot,
    verifier: verifyRcv016HistoricalSnapshot,
    writeRepository, readRepository, snapshotIdFactory: () => SNAPSHOT_ID,
  });
  const built = service.buildSnapshot(fixture.input);
  const written = await service.writeSnapshot(built);
  rawRead = {
    header: { snapshotId: SNAPSHOT_ID, snapshotCanonical: built.canonical, snapshotHash: built.hash, persistenceCreatedAt: TS },
    relationalMembershipKeys: [...built.snapshot.membershipKeys].reverse(),
    artifactVersions: built.snapshot.artifactVersions.map((value) => ({ value, payloadLimits: fixture.payloadLimits })),
    sourceVersions: [], artifactProvenanceStatements: [], sourceRelationshipStatements: [],
    artifactSourceAttributions: [], evidenceArtifactBindings: [], knowledgeStateStatements: [],
    traversalPolicy: fixture.input.traversalPolicy,
    foundationTargets: { evidenceIds: [], artifactVersionIds: [], provenanceSnapshotIds: [] },
  };
  const verified = await service.verifySnapshot(written.snapshotId);
  assert.equal(written.snapshotId, SNAPSHOT_ID);
  assert.equal(written.snapshotHash, built.hash);
  assert.equal(verified.verified, true);
  assert.equal(verified.snapshotHash, built.hash);
  assert.equal(writeRepository.header.snapshotCanonical, built.canonical);
  assert.deepEqual(writeRepository.artifactMembership.map(({ membershipRole }) => membershipRole), ["root"]);
});

test("owner errors propagate unchanged with no fallback, retry, or hidden command", async () => {
  for (const operation of ["build", "write", "verify"]) {
    const sentinel = new Error(operation);
    let calls = 0;
    const service = createRcv016ApplicationService({
      builder() { calls += 1; if (operation === "build") throw sentinel; return {}; },
      async writer() { calls += 1; if (operation === "write") throw sentinel; return {}; },
      async verifier() { calls += 1; if (operation === "verify") throw sentinel; return {}; },
      writeRepository: {}, readRepository: {}, snapshotIdFactory: () => SNAPSHOT_ID,
    });
    const invoke = operation === "build" ? () => service.buildSnapshot({}) : operation === "write" ? () => service.writeSnapshot({}) : () => service.verifySnapshot(SNAPSHOT_ID);
    await assert.rejects(async () => invoke(), (error) => error === sentinel);
    assert.equal(calls, 1);
  }
});

test("real Builder validation errors propagate without application remapping", () => {
  const fixture = inputFixture();
  const service = createRcv016ApplicationService({
    builder: buildRcv016ProvenanceSnapshot,
    writer: writeRcv016Snapshot,
    verifier: verifyRcv016HistoricalSnapshot,
    writeRepository: {}, readRepository: {}, snapshotIdFactory: () => SNAPSHOT_ID,
  });
  assert.throws(() => service.buildSnapshot({ ...fixture.input, roots: [] }), (error) => error.code === "validation_error");
  const invalidPolicy = { ...fixture.input.traversalPolicy, maxDepth: 0 };
  assert.throws(() => service.buildSnapshot({ ...fixture.input, traversalPolicy: invalidPolicy }), (error) => error.code === "validation_error");
});

test("real write and read gates reject forged handoffs and malformed explicit IDs", async () => {
  let idCalls = 0;
  let readCalls = 0;
  const service = createRcv016ApplicationService({
    builder: buildRcv016ProvenanceSnapshot,
    writer: writeRcv016Snapshot,
    verifier: verifyRcv016HistoricalSnapshot,
    writeRepository: {},
    readRepository: { async loadHistoricalSnapshotById() { readCalls += 1; return null; } },
    snapshotIdFactory() { idCalls += 1; return SNAPSHOT_ID; },
  });
  await assert.rejects(() => service.writeSnapshot(Object.freeze({ forged: true })), (error) => error.code === "validation_error");
  assert.equal(idCalls, 0);
  await assert.rejects(() => service.verifySnapshot("not-a-uuid"), (error) => error.code === "validation_error");
  assert.equal(readCalls, 0);
});

test("write uses the exact captured finalized result despite later external state", async () => {
  const built = Object.freeze({ exact: "finalized" });
  const external = { knowledge: [], provenance: [] };
  let received;
  const service = createRcv016ApplicationService({
    builder: () => built,
    async writer(value) { received = value.builderResult; return { snapshotId: SNAPSHOT_ID }; },
    async verifier() { return { verified: true }; },
    writeRepository: {}, readRepository: {}, snapshotIdFactory: () => SNAPSHOT_ID,
  });
  const result = service.buildSnapshot({});
  external.knowledge.push("later");
  external.provenance.push("later");
  await service.writeSnapshot(result);
  assert.strictEqual(received, built);
  assert.deepEqual(external, { knowledge: ["later"], provenance: ["later"] });
});

test("verify requires the explicit caller ID and surfaces integrity errors unchanged", async () => {
  const integrity = Object.assign(new Error("membership"), { code: "snapshot_membership_mismatch" });
  const ids = [];
  const service = createRcv016ApplicationService({
    builder: () => ({}), writer: async () => ({}),
    async verifier(id) { ids.push(id); throw integrity; },
    writeRepository: {}, readRepository: {}, snapshotIdFactory: () => SNAPSHOT_ID,
  });
  await assert.rejects(() => service.verifySnapshot(SNAPSHOT_ID), (error) => error === integrity);
  assert.deepEqual(ids, [SNAPSHOT_ID]);
});

test("Application Service API is closed against semantic shortcuts", () => {
  const api = require("../dist/services/rcv016ApplicationService");
  const forbidden = /(latest|current|winner|best|effective|rank|score|inferIndependent|autoBind|repair|normalizeAndSave|refresh|truth|credibility|quality|trust|independence)/i;
  assert.deepEqual(Object.keys(api).filter((name) => forbidden.test(name)), []);
  const service = createRcv016ApplicationService({ builder() {}, async writer() {}, async verifier() {}, writeRepository: {}, readRepository: {}, snapshotIdFactory: () => SNAPSHOT_ID });
  assert.deepEqual(Object.keys(service).sort(), ["buildSnapshot", "verifySnapshot", "writeSnapshot"]);
  assert.equal(Object.isFrozen(service), true);
});

test("dependency wiring is captured once and cannot be redirected later", () => {
  const original = Object.freeze({ owner: "builder" });
  const dependencies = {
    builder: () => original,
    async writer() {}, async verifier() {},
    writeRepository: {}, readRepository: {}, snapshotIdFactory: () => SNAPSHOT_ID,
  };
  const service = createRcv016ApplicationService(dependencies);
  dependencies.builder = () => ({ owner: "replacement" });
  assert.strictEqual(service.buildSnapshot({}), original);
});
