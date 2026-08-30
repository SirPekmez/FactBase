const assert = require("node:assert/strict");
const test = require("node:test");

const { canonicalizeRcv016, sha256Rcv016Text, Rcv016ValidationError } = require("../dist/services/rcv016Canonical");
const { buildRcv016ProvenanceSnapshot } = require("../dist/services/rcv016SnapshotBuilder");
const {
  Rcv016DatabaseError,
  Rcv016RelationalIntegrityError,
} = require("../dist/services/rcv016RepositoryContract");
const {
  assertRcv016SnapshotHashIntegrity,
  enumerateRcv016FoundationReferenceTargets,
  writeRcv016Snapshot,
} = require("../dist/services/rcv016WriteVerifier");

const TS = "2026-01-02T03:04:05.000000Z";
const EMPTY = "{}";
const EMPTY_HASH = sha256Rcv016Text(EMPTY);
const SNAPSHOT_ID = "00000000-0000-0000-0000-000000000800";

function id(number) {
  return `00000000-0000-0000-0000-${number.toString(16).padStart(12, "0")}`;
}

function policy() {
  const definition = {
    policyId: "phase-3-policy",
    policyVersion: "1",
    maxRoots: 10,
    maxNodes: 20,
    maxEdges: 20,
    maxDepth: 4,
    maxCanonicalSnapshotBytes: 1_000_000,
    allowedRelationships: ["cites", "derived_from", "incorporates", "quotes", "reposts", "syndicated_from", "uses_information_from"],
    deterministicOrdering: "schema_category_then_canonical_key_lexicographic_v1",
    visitedSemantics: "expand_node_once_include_statement_once_diagnose_cycles_v1",
  };
  const canonical = canonicalizeRcv016(definition);
  return { ...definition, definitionCanonical: canonical.canonical, definitionHash: canonical.hash };
}

function artifactVersion(number) {
  return { artifactVersionId: id(number), artifactId: id(1000 + number), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: EMPTY, captureHash: EMPTY_HASH, createdAt: TS };
}

function sourceVersion(number, sourceNumber) {
  return { sourceVersionId: id(number), sourceId: id(sourceNumber), versionNumber: 1, metadataSchemaIdentity: { id: "factbase-source-version-metadata", version: "1" }, metadataCanonical: EMPTY, metadataHash: EMPTY_HASH, observedAt: TS, createdAt: TS };
}

function common(statementId, foundation = null, rationale = null) {
  return { statementId, observedAt: TS, validFrom: null, validTo: null, initiator: null, rationale, foundation, supersedesStatementId: null, createdAt: TS };
}

function builderResult() {
  const foundation = {
    schema: { id: "factbase-provenance-foundation", version: "1" },
    items: [
      { kind: "artifact_version_reference", artifactVersionId: id(1) },
      { kind: "deterministic_method", methodId: "method", methodVersion: "1", inputReferences: [
        { referenceType: "provenance_snapshot", referenceId: id(900) },
        { referenceType: "artifact_version", referenceId: id(2) },
        { referenceType: "evidence", referenceId: id(500) },
      ] },
      { kind: "evidence_reference", evidenceId: id(500) },
      { kind: "imported_assertion", referenceType: "external_record", reference: "free-string-not-a-target" },
    ],
  };
  const traversalPolicy = policy();
  const sourceA = sourceVersion(20, 2001);
  const sourceB = sourceVersion(21, 2002);
  return buildRcv016ProvenanceSnapshot({
    snapshotIdentity: { snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1", canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" },
    builderIdentity: { builderId: "factbase-provenance-snapshot-builder", builderVersion: "1", builderArtifactHash: "a".repeat(64) },
    traversalPolicy,
    roots: [id(1)],
    artifactVersions: [artifactVersion(1), artifactVersion(2)],
    sourceVersions: [sourceA, sourceB],
    artifactProvenanceStatements: [
      { family: "ArtifactProvenanceStatement", ...common(id(101)), subjectArtifactVersionId: id(1), relationship: "cites", objectArtifactVersionId: id(2) },
      { family: "ArtifactProvenanceStatement", ...common(id(102)), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(1) },
    ],
    sourceRelationshipStatements: [
      { family: "SourceRelationshipStatement", ...common(id(301)), subjectSourceId: sourceA.sourceId, relationship: "part_of", objectSourceId: sourceB.sourceId },
    ],
    artifactSourceAttributions: [
      { family: "ArtifactSourceAttribution", ...common(id(201)), subjectArtifactVersionId: id(1), relationship: "authored_by", objectSourceVersionId: id(20) },
      { family: "ArtifactSourceAttribution", ...common(id(202)), subjectArtifactVersionId: id(2), relationship: "published_by", objectSourceVersionId: id(21) },
    ],
    evidenceArtifactBindings: [
      { family: "EvidenceArtifactBinding", ...common(id(401)), subjectEvidenceId: id(500), relationship: "bound_to", objectArtifactVersionId: id(1) },
    ],
    knowledgeStateStatements: [
      { family: "KnowledgeStateStatement", ...common(id(501), foundation, "nul:\u0000 literal:\\u0000 é quote:\" slash:\\"), subjectArtifactVersionId: id(1), scope: "upstream_provenance", state: "known" },
    ],
  });
}

function policyRecord(snapshot) {
  const keys = ["policyId", "policyVersion", "definitionHash", "maxRoots", "maxNodes", "maxEdges", "maxDepth", "maxCanonicalSnapshotBytes", "allowedRelationships", "deterministicOrdering", "visitedSemantics"];
  return Object.fromEntries(keys.map((key) => [key, snapshot[key]]));
}

class FakeRepository {
  constructor(result, { failAt = null, missing = [] } = {}) {
    this.result = result;
    this.failAt = failAt;
    this.missing = new Set(missing);
    this.events = [];
    this.captured = {};
    this.policyVersions = new Map([["phase-3-policy\u00001", policyRecord(result.snapshot)], ["phase-3-policy\u00002", { ...policyRecord(result.snapshot), policyVersion: "2" }]]);
  }

  hit(name, value) {
    this.events.push(name);
    if (value !== undefined) this.captured[name] = value;
    if (this.failAt === name) throw new Error(`injected ${name}`);
  }

  async withRcv016WriteTransaction(options, operation) {
    this.hit(`begin:${options.isolation}`);
    if (this.failAt === "transaction_open") throw new Error("injected transaction_open");
    const tx = {
      loadTraversalPolicyByIdentity: async (policyId, policyVersion) => {
        const name = `policy:${policyId}:${policyVersion}`; this.hit(name); return this.policyVersions.get(`${policyId}\u0000${policyVersion}`) ?? null;
      },
      lockEvidenceForReferenceVerification: async (targetId) => this.lock("evidence", targetId),
      lockArtifactVersionForReferenceVerification: async (targetId) => this.lock("artifact_version", targetId),
      lockProvenanceSnapshotForReferenceVerification: async (targetId) => this.lock("provenance_snapshot", targetId),
      insertSnapshotHeader: async (value) => this.hit("insert:header", value),
      insertSnapshotArtifactVersions: async (value) => this.hit("insert:artifactVersions", value),
      insertSnapshotSourceVersions: async (value) => this.hit("insert:sourceVersions", value),
      insertSnapshotArtifactProvenanceStatements: async (value) => this.hit("insert:artifactProvenanceStatements", value),
      insertSnapshotSourceRelationshipStatements: async (value) => this.hit("insert:sourceRelationshipStatements", value),
      insertSnapshotArtifactSourceAttributions: async (value) => this.hit("insert:artifactSourceAttributions", value),
      insertSnapshotEvidenceArtifactBindings: async (value) => this.hit("insert:evidenceArtifactBindings", value),
      insertSnapshotKnowledgeStateStatements: async (value) => this.hit("insert:knowledgeStateStatements", value),
    };
    try {
      const value = await operation(tx);
      this.hit("commit");
      return value;
    } catch (error) {
      this.events.push("rollback");
      throw error;
    }
  }

  async lock(type, targetId) {
    const name = `lock:${type}:${targetId}`;
    this.hit(name);
    return !this.missing.has(`${type}:${targetId}`);
  }
}

async function write(result, repository, factory = () => SNAPSHOT_ID) {
  return writeRcv016Snapshot({ builderResult: result, snapshotIdFactory: factory, repository });
}

test("Write-Verifier authenticates before one snapshotId allocation and commits the exact bundle", async () => {
  const result = builderResult();
  const repository = new FakeRepository(result);
  let factoryCalls = 0;
  const written = await write(result, repository, () => { factoryCalls += 1; return SNAPSHOT_ID; });
  assert.equal(factoryCalls, 1);
  assert.deepEqual(written, { snapshotId: SNAPSHOT_ID, snapshotHash: result.hash, snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1" });
  assert.equal(repository.captured["insert:header"].snapshotCanonical, result.canonical);
  assert.equal(repository.captured["insert:header"].snapshotHash, result.hash);
  assert.ok(!("createdAt" in repository.captured["insert:header"]));
  assert.ok(!result.canonical.includes("snapshotId"));
  assert.deepEqual(repository.events, [
    "begin:repeatable_read",
    "policy:phase-3-policy:1",
    `lock:evidence:${id(500)}`,
    `lock:artifact_version:${id(1)}`,
    `lock:artifact_version:${id(2)}`,
    `lock:provenance_snapshot:${id(900)}`,
    "insert:header",
    "insert:artifactVersions",
    "insert:sourceVersions",
    "insert:artifactProvenanceStatements",
    "insert:sourceRelationshipStatements",
    "insert:artifactSourceAttributions",
    "insert:evidenceArtifactBindings",
    "insert:knowledgeStateStatements",
    "commit",
  ]);
});

test("forged Builder results fail before snapshotId generation or transaction work", async () => {
  const result = builderResult();
  for (const candidate of [Object.freeze({ ...result }), JSON.parse(JSON.stringify(result)), Object.freeze({ snapshot: result.snapshot, canonical: result.canonical, hash: result.hash, membership: result.membership })]) {
    const repository = new FakeRepository(result);
    let calls = 0;
    await assert.rejects(() => write(candidate, repository, () => { calls += 1; return SNAPSHOT_ID; }), Rcv016ValidationError);
    assert.equal(calls, 0);
    assert.deepEqual(repository.events, []);
  }
  const real = builderResult();
  await assert.rejects(
    () => writeRcv016Snapshot({ builderResult: real, snapshotIdFactory: () => SNAPSHOT_ID, repository: new FakeRepository(real), extra: true }),
    Rcv016ValidationError,
  );
});

test("snapshotId validation rejects without normalization or regeneration", async () => {
  const result = builderResult();
  for (const candidate of ["AAAAAAAA-0000-0000-0000-000000000001", "invalid"]) {
    let calls = 0;
    await assert.rejects(() => write(result, new FakeRepository(result), () => { calls += 1; return candidate; }), Rcv016ValidationError);
    assert.equal(calls, 1);
  }
});

test("Canonical text, Unicode escapes, hash, and all seven Membership families remain byte-exact", async () => {
  const result = builderResult();
  const repository = new FakeRepository(result);
  await write(result, repository);
  const header = repository.captured["insert:header"];
  assert.strictEqual(header.snapshotCanonical, result.canonical);
  assert.equal(header.snapshotHash, sha256Rcv016Text(result.canonical));
  assert.ok(result.canonical.includes("\\u0000"));
  assert.ok(result.canonical.includes("\\\\u0000"));
  const familyEvents = repository.events.filter((entry) => entry.startsWith("insert:")).slice(1);
  assert.deepEqual(familyEvents, ["insert:artifactVersions", "insert:sourceVersions", "insert:artifactProvenanceStatements", "insert:sourceRelationshipStatements", "insert:artifactSourceAttributions", "insert:evidenceArtifactBindings", "insert:knowledgeStateStatements"]);
  assert.equal(repository.captured["insert:artifactVersions"].filter((row) => row.artifactVersionId === id(1)).length, 2);
});

test("Foundation targets are deduplicated, deterministically ordered, and locked inside the transaction", async () => {
  const result = builderResult();
  assert.deepEqual(enumerateRcv016FoundationReferenceTargets(result), [
    { targetType: "evidence", targetId: id(500) },
    { targetType: "artifact_version", targetId: id(1) },
    { targetType: "artifact_version", targetId: id(2) },
    { targetType: "provenance_snapshot", targetId: id(900) },
  ]);
  const foundationBefore = result.snapshot.knowledgeStateStatements[0].foundation;
  const repository = new FakeRepository(result);
  await write(result, repository);
  const locks = repository.events.filter((entry) => entry.startsWith("lock:"));
  assert.deepEqual(locks, [
    `lock:evidence:${id(500)}`,
    `lock:artifact_version:${id(1)}`,
    `lock:artifact_version:${id(2)}`,
    `lock:provenance_snapshot:${id(900)}`,
  ]);
  assert.ok(repository.events.indexOf(locks[0]) > repository.events.indexOf("begin:repeatable_read"));
  assert.ok(repository.events.indexOf(locks.at(-1)) < repository.events.indexOf("insert:header"));
  assert.strictEqual(result.snapshot.knowledgeStateStatements[0].foundation, foundationBefore);
});

test("missing Foundation targets and exact Policy drift fail relationally with rollback", async () => {
  const result = builderResult();
  for (const target of [`evidence:${id(500)}`, `artifact_version:${id(1)}`, `provenance_snapshot:${id(900)}`]) {
    const missing = new FakeRepository(result, { missing: [target] });
    await assert.rejects(() => write(result, missing), Rcv016RelationalIntegrityError);
    assert.ok(missing.events.includes("rollback"));
    assert.ok(!missing.events.includes("insert:header"));
  }

  const drift = new FakeRepository(result);
  drift.policyVersions.set("phase-3-policy\u00001", { ...policyRecord(result.snapshot), definitionHash: "b".repeat(64) });
  await assert.rejects(() => write(result, drift), Rcv016RelationalIntegrityError);
  assert.deepEqual(drift.events.slice(0, 3), ["begin:repeatable_read", "policy:phase-3-policy:1", "rollback"]);
  assert.ok(!drift.events.some((event) => event.includes("phase-3-policy:2")));
});

test("hash integrity helper rejects alternate bytes without weakening Builder authentication", () => {
  const result = builderResult();
  assert.doesNotThrow(() => assertRcv016SnapshotHashIntegrity(result.canonical, result.hash));
  assert.throws(() => assertRcv016SnapshotHashIntegrity(`${result.canonical}\n`, result.hash));
});

test("every transaction-stage failure prevents success and records no false commit", async () => {
  const result = builderResult();
  const stages = [
    "transaction_open", "policy:phase-3-policy:1", `lock:evidence:${id(500)}`, `lock:artifact_version:${id(2)}`,
    "insert:header", "insert:artifactVersions", "insert:sourceVersions", "insert:artifactProvenanceStatements",
    "insert:sourceRelationshipStatements", "insert:artifactSourceAttributions", "insert:evidenceArtifactBindings",
    "insert:knowledgeStateStatements", "commit",
  ];
  for (const failAt of stages) {
    const repository = new FakeRepository(result, { failAt });
    await assert.rejects(() => write(result, repository), Rcv016DatabaseError, failAt);
    if (failAt === "transaction_open") assert.ok(!repository.events.includes("rollback"));
    else assert.ok(repository.events.includes("rollback"), failAt);
    assert.equal(repository.events.filter((event) => event === "commit").length, failAt === "commit" ? 1 : 0, failAt);
  }
});

test("Write-Verifier does not mutate the authenticated result or export semantic shortcuts", async () => {
  const result = builderResult();
  const before = { canonical: result.canonical, hash: result.hash, snapshot: JSON.stringify(result.snapshot), membership: JSON.stringify(result.membership) };
  await write(result, new FakeRepository(result));
  assert.deepEqual({ canonical: result.canonical, hash: result.hash, snapshot: JSON.stringify(result.snapshot), membership: JSON.stringify(result.membership) }, before);
  const api = require("../dist/services/rcv016WriteVerifier");
  const forbidden = /(truth|credibility|quality|trust|independence|weight|ranking|winner|current|effectiveStatement|getLatest|getPayload)/i;
  assert.deepEqual(Object.keys(api).filter((name) => forbidden.test(name)), []);
});
