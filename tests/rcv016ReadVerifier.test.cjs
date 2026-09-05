const assert = require("node:assert/strict");
const test = require("node:test");

const { RCV016_BOUNDED_PAYLOAD_FIELDS_V1 } = require("../dist/contracts/rcv016ProvenanceContractV1");
const { canonicalizeRcv016, sha256Rcv016Text, Rcv016HashIntegrityError, Rcv016UnsupportedContractVersionError } = require("../dist/services/rcv016Canonical");
const { validateAndCanonicalizeRcv016ArtifactCapture } = require("../dist/services/rcv016ArtifactCapture");
const { validateAndCanonicalizeRcv016Foundation } = require("../dist/services/rcv016Foundation");
const { validateRcv016PayloadLimits } = require("../dist/services/rcv016PayloadLimits");
const { Rcv016ReadIntegrityError, verifyRcv016HistoricalSnapshot } = require("../dist/services/rcv016ReadVerifier");
const { validateAndCanonicalizeRcv016SourceMetadata } = require("../dist/services/rcv016SourceMetadata");
const { buildRcv016ProvenanceSnapshot } = require("../dist/services/rcv016SnapshotBuilder");
const { validateRcv016TraversalPolicy } = require("../dist/services/rcv016TraversalPolicy");

const TS = "2026-01-02T03:04:05.000000Z";
const SNAPSHOT_ID = "00000000-0000-0000-0000-000000000800";

function id(number) {
  return `00000000-0000-0000-0000-${number.toString(16).padStart(12, "0")}`;
}

function payloadLimits() {
  const definition = { limitsId: "phase-5-limits", limitsVersion: "1" };
  for (const field of RCV016_BOUNDED_PAYLOAD_FIELDS_V1) definition[field] = 1_000_000;
  const canonical = canonicalizeRcv016(definition);
  return validateRcv016PayloadLimits({ ...definition, definitionCanonical: canonical.canonical, definitionHash: canonical.hash });
}

function policy() {
  const definition = {
    policyId: "phase-5-policy",
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
  return validateRcv016TraversalPolicy({ ...definition, definitionCanonical: canonical.canonical, definitionHash: canonical.hash });
}

function common(statementId, foundation = null) {
  return { statementId, observedAt: TS, validFrom: null, validTo: null, initiator: null, rationale: null, foundation, supersedesStatementId: null, createdAt: TS };
}

function fixture() {
  const limits = payloadLimits();
  const sourceMetadataA = validateAndCanonicalizeRcv016SourceMetadata({ schema: { id: "factbase-source-version-metadata", version: "1" }, displayName: "Source A", observedLocators: [] }, limits);
  const sourceMetadataB = validateAndCanonicalizeRcv016SourceMetadata({ schema: { id: "factbase-source-version-metadata", version: "1" }, displayName: "Source B", observedLocators: [] }, limits);
  const captureA = validateAndCanonicalizeRcv016ArtifactCapture({ schema: { id: "factbase-artifact-version-capture", version: "1" }, locator: null, mediaType: null, title: "A nul:\u0000 literal:\\u0000 é", publishedAt: null, observedAt: TS, retrievedAt: null, representation: { kind: "metadata_only", hashAlgorithm: null, contentHash: null } }, limits);
  const captureB = validateAndCanonicalizeRcv016ArtifactCapture({ schema: { id: "factbase-artifact-version-capture", version: "1" }, locator: null, mediaType: null, title: "B", publishedAt: null, observedAt: TS, retrievedAt: null, representation: { kind: "metadata_only", hashAlgorithm: null, contentHash: null } }, limits);
  const foundation = validateAndCanonicalizeRcv016Foundation({
    schema: { id: "factbase-provenance-foundation", version: "1" },
    items: [
      { kind: "evidence_reference", evidenceId: id(500) },
      { kind: "artifact_version_reference", artifactVersionId: id(2) },
      { kind: "deterministic_method", methodId: "method", methodVersion: "1", inputReferences: [
        { referenceType: "evidence", referenceId: id(500) },
        { referenceType: "artifact_version", referenceId: id(2) },
        { referenceType: "provenance_snapshot", referenceId: id(900) },
      ] },
      { kind: "imported_assertion", referenceType: "external_record", reference: "free-string" },
    ],
  }, limits);
  const sourceVersions = [
    { sourceVersionId: id(20), sourceId: id(2001), versionNumber: 1, metadataSchemaIdentity: { id: "factbase-source-version-metadata", version: "1" }, metadataCanonical: sourceMetadataA.canonical, metadataHash: sourceMetadataA.hash, observedAt: TS, createdAt: TS },
    { sourceVersionId: id(21), sourceId: id(2002), versionNumber: 1, metadataSchemaIdentity: { id: "factbase-source-version-metadata", version: "1" }, metadataCanonical: sourceMetadataB.canonical, metadataHash: sourceMetadataB.hash, observedAt: TS, createdAt: TS },
  ];
  const artifactVersions = [
    { artifactVersionId: id(1), artifactId: id(1001), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: captureA.canonical, captureHash: captureA.hash, createdAt: TS },
    { artifactVersionId: id(2), artifactId: id(1002), versionNumber: 1, captureSchemaId: "factbase-artifact-version-capture", captureSchemaVersion: "1", captureCanonical: captureB.canonical, captureHash: captureB.hash, createdAt: TS },
  ];
  const artifactProvenanceStatements = [
    { family: "ArtifactProvenanceStatement", ...common(id(102)), subjectArtifactVersionId: id(1), relationship: "cites", objectArtifactVersionId: id(2) },
    { family: "ArtifactProvenanceStatement", ...common(id(103)), subjectArtifactVersionId: id(1), relationship: "quotes", objectArtifactVersionId: id(2) },
    { family: "ArtifactProvenanceStatement", ...common(id(101)), subjectArtifactVersionId: id(2), relationship: "quotes", objectArtifactVersionId: id(1) },
  ];
  const sourceRelationshipStatements = [{ family: "SourceRelationshipStatement", ...common(id(301)), subjectSourceId: id(2001), relationship: "part_of", objectSourceId: id(2002) }];
  const artifactSourceAttributions = [
    { family: "ArtifactSourceAttribution", ...common(id(201)), subjectArtifactVersionId: id(1), relationship: "authored_by", objectSourceVersionId: id(20) },
    { family: "ArtifactSourceAttribution", ...common(id(202)), subjectArtifactVersionId: id(2), relationship: "published_by", objectSourceVersionId: id(21) },
  ];
  const evidenceArtifactBindings = [{ family: "EvidenceArtifactBinding", ...common(id(401)), subjectEvidenceId: id(500), relationship: "bound_to", objectArtifactVersionId: id(1) }];
  const knowledgeStateStatements = [{ family: "KnowledgeStateStatement", ...common(id(501), foundation.value), subjectArtifactVersionId: id(1), scope: "upstream_provenance", state: "known" }];
  const traversalPolicy = policy();
  const result = buildRcv016ProvenanceSnapshot({
    snapshotIdentity: { snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1", canonicalizationId: "jcs-rfc8785", canonicalizationVersion: "1", hashAlgorithm: "sha-256" },
    builderIdentity: { builderId: "factbase-provenance-snapshot-builder", builderVersion: "1", builderArtifactHash: "a".repeat(64) },
    traversalPolicy,
    roots: [id(1)],
    artifactVersions,
    sourceVersions,
    artifactProvenanceStatements,
    sourceRelationshipStatements,
    artifactSourceAttributions,
    evidenceArtifactBindings,
    knowledgeStateStatements,
  });
  const record = (value, hasFoundation = false) => ({ value, payloadLimits: limits, foundationCanonical: hasFoundation ? foundation.canonical : null, foundationHash: hasFoundation ? foundation.hash : null });
  return {
    result,
    raw: {
      header: { snapshotId: SNAPSHOT_ID, snapshotCanonical: result.canonical, snapshotHash: result.hash, persistenceCreatedAt: TS },
      relationalMembershipKeys: [...result.snapshot.membershipKeys].reverse(),
      artifactVersions: result.snapshot.artifactVersions.map((value) => record(value)),
      sourceVersions: result.snapshot.sourceVersions.map((value) => record(value)),
      artifactProvenanceStatements: result.snapshot.artifactProvenanceStatements.map((value) => record(value)),
      sourceRelationshipStatements: result.snapshot.sourceRelationshipStatements.map((value) => record(value)),
      artifactSourceAttributions: result.snapshot.artifactSourceAttributions.map((value) => record(value)),
      evidenceArtifactBindings: result.snapshot.evidenceArtifactBindings.map((value) => record(value)),
      knowledgeStateStatements: result.snapshot.knowledgeStateStatements.map((value) => record(value, true)),
      traversalPolicy,
      foundationTargets: { evidenceIds: [id(500)], artifactVersionIds: [id(2)], provenanceSnapshotIds: [id(900)] },
    },
  };
}

function clone(value) {
  return structuredClone(value);
}

function repository(raw) {
  const calls = [];
  return { calls, writes: 0, async loadHistoricalSnapshotById(snapshotId) { calls.push(snapshotId); return raw; } };
}

function setSnapshot(raw, snapshot, canonicalOverride = null) {
  const canonical = canonicalOverride ?? canonicalizeRcv016(snapshot).canonical;
  raw.header.snapshotCanonical = canonical;
  raw.header.snapshotHash = sha256Rcv016Text(canonical);
}

async function expectReadCode(raw, code) {
  await assert.rejects(
    () => verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(raw)),
    (error) => error.code === code,
  );
}

test("valid exact historical read verifies without rewriting and ignores SQL row order", async () => {
  const { raw, result } = fixture();
  const repo = repository(raw);
  const before = JSON.stringify(raw);
  const verified = await verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repo);
  assert.deepEqual(verified, { verified: true, snapshotId: SNAPSHOT_ID, snapshotHash: result.hash, snapshotSchemaId: "factbase-provenance-snapshot", snapshotSchemaVersion: "1" });
  assert.deepEqual(repo.calls, [SNAPSHOT_ID]);
  assert.equal(repo.writes, 0);
  assert.equal(JSON.stringify(raw), before);
  assert.ok(raw.header.snapshotCanonical.includes("\\u0000"));
  assert.ok(raw.header.snapshotCanonical.includes("\\\\u0000"));
});

test("Contract tuple ordering accepts authenticated Builder output with non-monotonic statement IDs", async () => {
  const { raw, result } = fixture();
  const canonicalBeforeVerification = result.canonical;
  const hashBeforeVerification = result.hash;
  assert.deepEqual(
    result.snapshot.artifactProvenanceStatements.map((statement) => statement.statementId),
    [id(102), id(103), id(101)],
  );
  assert.equal((await verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(raw))).verified, true);
  assert.equal(raw.header.snapshotCanonical, canonicalBeforeVerification);
  assert.equal(raw.header.snapshotHash, hashBeforeVerification);
});

test("statement-backed arrays reject malformed Contract tuple ordering and duplicate identities", async () => {
  async function rejectArtifactOrder(mutate, expectedMessage = "expected frozen canonical statement tuple order") {
    const raw = clone(fixture().raw);
    const snapshot = JSON.parse(raw.header.snapshotCanonical);
    mutate(snapshot.artifactProvenanceStatements);
    setSnapshot(raw, snapshot);
    await assert.rejects(
      () => verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(raw)),
      (error) => error.code === "closed_schema_violation" && error.cause?.message.includes(expectedMessage),
    );
  }

  await rejectArtifactOrder((statements) => statements.reverse());
  await rejectArtifactOrder((statements) => {
    [statements[0], statements[1]] = [statements[1], statements[0]];
  });
  await rejectArtifactOrder((statements) => {
    statements[0].relationship = "quotes";
    statements[0].objectArtifactVersionId = id(2);
    statements[1].relationship = "quotes";
    statements[1].objectArtifactVersionId = id(1);
  });
  await rejectArtifactOrder((statements) => {
    statements[0].relationship = "quotes";
    statements[1].relationship = "quotes";
    [statements[0], statements[1]] = [statements[1], statements[0]];
  });
  await rejectArtifactOrder((statements) => {
    statements[2].statementId = statements[0].statementId;
  }, "duplicate statementId");
});

test("exact lookup, hash, RFC-8785/JCS, and version gates fail closed", async () => {
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(null)), (error) => error.code === "snapshot_not_found");
  const hash = fixture().raw;
  hash.header.snapshotHash = "b".repeat(64);
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(hash)), Rcv016HashIntegrityError);

  const nonJcs = fixture().raw;
  const parsed = JSON.parse(nonJcs.header.snapshotCanonical);
  setSnapshot(nonJcs, parsed, JSON.stringify(parsed, null, 2));
  await expectReadCode(nonJcs, "non_jcs_canonical");

  const unsupported = fixture().raw;
  const unsupportedSnapshot = JSON.parse(unsupported.header.snapshotCanonical);
  unsupportedSnapshot.snapshotSchemaVersion = "2";
  setSnapshot(unsupported, unsupportedSnapshot);
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(unsupported)), Rcv016UnsupportedContractVersionError);

  const unsupportedBuilder = fixture().raw;
  const unsupportedBuilderSnapshot = JSON.parse(unsupportedBuilder.header.snapshotCanonical);
  unsupportedBuilderSnapshot.builderVersion = "2";
  setSnapshot(unsupportedBuilder, unsupportedBuilderSnapshot);
  await assert.rejects(() => verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(unsupportedBuilder)), Rcv016UnsupportedContractVersionError);

  const extra = fixture().raw;
  const extraSnapshot = JSON.parse(extra.header.snapshotCanonical);
  extraSnapshot.extra = true;
  setSnapshot(extra, extraSnapshot);
  await expectReadCode(extra, "closed_schema_violation");
});

test("all relational and Canonical Membership corruption classes are detected", async () => {
  for (const mutate of [
    (raw) => raw.relationalMembershipKeys.pop(),
    (raw) => raw.relationalMembershipKeys.push({ targetType: "SourceVersion", membershipRole: "included", sourceVersionId: id(99) }),
    (raw) => { raw.relationalMembershipKeys.find((key) => key.targetType === "ArtifactVersion").membershipRole = "wrong"; },
    (raw) => { raw.relationalMembershipKeys.find((key) => key.targetType === "ArtifactVersion").genericId = id(1); },
  ]) {
    const raw = clone(fixture().raw);
    mutate(raw);
    await expectReadCode(raw, "snapshot_membership_mismatch");
  }
  for (const mutate of [
    (snapshot) => snapshot.membershipKeys.pop(),
    (snapshot) => snapshot.membershipKeys.push({ targetType: "SourceVersion", membershipRole: "included", sourceVersionId: id(99) }),
    (snapshot) => { snapshot.membershipKeys[0] = { targetType: "ArtifactVersion", membershipRole: "wrong", artifactVersionId: id(1) }; },
    (snapshot) => snapshot.membershipKeys.reverse(),
  ]) {
    const raw = clone(fixture().raw);
    const snapshot = JSON.parse(raw.header.snapshotCanonical);
    mutate(snapshot);
    setSnapshot(raw, snapshot);
    await expectReadCode(raw, "snapshot_membership_mismatch");
  }
  const { raw } = fixture();
  const dual = raw.relationalMembershipKeys.filter((key) => key.targetType === "ArtifactVersion" && key.artifactVersionId === id(1));
  assert.deepEqual(new Set(dual.map((key) => key.membershipRole)), new Set(["root", "included"]));
});

test("derivedUnrecordedStates corruption is detected without consulting live Knowledge States", async () => {
  for (const mutate of [
    (values) => values.pop(),
    (values) => values.push({ artifactVersionId: id(99), scope: "upstream_provenance", state: "unrecorded" }),
    (values) => values.push({ ...values[0] }),
    (values) => { values[0].scope = "wrong"; },
    (values) => { values[0].state = "unknown"; },
  ]) {
    const raw = clone(fixture().raw);
    const snapshot = JSON.parse(raw.header.snapshotCanonical);
    mutate(snapshot.derivedUnrecordedStates);
    setSnapshot(raw, snapshot);
    await assert.rejects(() => verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(raw)));
  }
  const live = fixture().raw;
  live.liveKnowledgeStateStatements = [{ subjectArtifactVersionId: id(2), state: "known" }];
  assert.equal((await verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(live))).verified, true);
});

test("Foundation corruption and missing typed targets are neutral integrity failures", async () => {
  const missing = fixture().raw;
  missing.foundationTargets.evidenceIds = [];
  await expectReadCode(missing, "foundation_corruption");

  for (const corrupt of [
    (foundation) => foundation.items.push({ kind: "fifth_variant" }),
    (foundation) => foundation.items.push({ ...foundation.items[0] }),
    (foundation) => foundation.items.reverse(),
  ]) {
    const raw = clone(fixture().raw);
    const snapshot = JSON.parse(raw.header.snapshotCanonical);
    const statement = snapshot.knowledgeStateStatements[0];
    corrupt(statement.foundation);
    raw.knowledgeStateStatements[0].value = clone(statement);
    const foundationCanonical = canonicalizeRcv016(statement.foundation);
    raw.knowledgeStateStatements[0].foundationCanonical = foundationCanonical.canonical;
    raw.knowledgeStateStatements[0].foundationHash = foundationCanonical.hash;
    setSnapshot(raw, snapshot);
    await assert.rejects(() => verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(raw)));
  }
});

test("exact Policy corruption never falls forward to a newer version", async () => {
  for (const mutate of [
    (raw) => { raw.traversalPolicy = null; },
    (raw) => { raw.traversalPolicy.policyVersion = "2"; },
    (raw) => { raw.traversalPolicy.definitionHash = "b".repeat(64); },
  ]) {
    const raw = clone(fixture().raw);
    mutate(raw);
    await expectReadCode(raw, "policy_corruption");
  }
});

test("Cycle and Conflict diagnostics reproduce only from Snapshot-contained statements", async () => {
  for (const mutate of [
    (snapshot) => snapshot.buildTimeCycleDiagnostics.pop(),
    (snapshot) => snapshot.buildTimeCycleDiagnostics.push({ ...snapshot.buildTimeCycleDiagnostics[0] }),
    (snapshot) => snapshot.buildTimeCycleDiagnostics.push({ code: "unknown" }),
    (snapshot) => snapshot.conflictDiagnostics.push({ code: "invented_conflict" }),
  ]) {
    const raw = clone(fixture().raw);
    const snapshot = JSON.parse(raw.header.snapshotCanonical);
    mutate(snapshot);
    setSnapshot(raw, snapshot);
    await expectReadCode(raw, "diagnostic_corruption");
  }
  const live = fixture().raw;
  live.liveArtifactProvenanceStatements = [{ statementId: id(999) }];
  live.liveSourceRelationshipStatements = [{ statementId: id(998) }];
  live.liveEvidenceArtifactBindings = [{ statementId: id(997) }];
  assert.equal((await verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(live))).verified, true);
});

test("historical multiplicity is preserved and later rows from all live families stay out", async () => {
  const { raw, result } = fixture();
  raw.liveKnowledgeStateStatements = [{ statementId: id(994) }];
  raw.liveArtifactProvenanceStatements = [{ statementId: id(995) }];
  raw.liveSourceRelationshipStatements = [{ statementId: id(996) }];
  raw.liveEvidenceArtifactBindings = [{ statementId: id(997) }];
  const before = result.canonical;
  const verified = await verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(raw));
  assert.equal(verified.verified, true);
  assert.equal(raw.header.snapshotCanonical, before);
  assert.equal(result.snapshot.artifactProvenanceStatements.length, 3);
  assert.equal(result.snapshot.artifactSourceAttributions.length, 2);
  assert.equal(result.snapshot.knowledgeStateStatements.length, 1);
});

test("missing or internally corrupted historical objects are detected", async () => {
  const missing = fixture().raw;
  missing.sourceVersions.pop();
  await expectReadCode(missing, "missing_historical_object");

  const metadata = clone(fixture().raw);
  const badMetadata = { ...JSON.parse(metadata.sourceVersions[0].value.metadataCanonical), extra: true };
  const metadataCanonical = canonicalizeRcv016(badMetadata);
  metadata.sourceVersions[0].value.metadataCanonical = metadataCanonical.canonical;
  metadata.sourceVersions[0].value.metadataHash = metadataCanonical.hash;
  const snapshot = JSON.parse(metadata.header.snapshotCanonical);
  snapshot.sourceVersions[0] = clone(metadata.sourceVersions[0].value);
  setSnapshot(metadata, snapshot);
  await expectReadCode(metadata, "closed_schema_violation");

  const capture = clone(fixture().raw);
  const badCapture = JSON.parse(capture.artifactVersions[0].value.captureCanonical);
  badCapture.representation.kind = "unknown";
  const captureCanonical = canonicalizeRcv016(badCapture);
  capture.artifactVersions[0].value.captureCanonical = captureCanonical.canonical;
  capture.artifactVersions[0].value.captureHash = captureCanonical.hash;
  const captureSnapshot = JSON.parse(capture.header.snapshotCanonical);
  captureSnapshot.artifactVersions[0] = clone(capture.artifactVersions[0].value);
  setSnapshot(capture, captureSnapshot);
  await expectReadCode(capture, "closed_schema_violation");
});

test("successful verification is neutral and production API exposes no repair or semantic shortcuts", async () => {
  const api = require("../dist/services/rcv016ReadVerifier");
  const repositoryApi = require("../dist/services/rcv016ReadRepositoryContract");
  const forbidden = /(latest|current|winner|best|effective|repair|normalizeAndSave|update|delete|rank|score|truth|credibility|quality|independence)/i;
  assert.deepEqual(Object.keys(api).filter((name) => forbidden.test(name)), []);
  assert.deepEqual(Object.keys(repositoryApi).filter((name) => forbidden.test(name)), []);
  const result = await verifyRcv016HistoricalSnapshot(SNAPSHOT_ID, repository(fixture().raw));
  assert.deepEqual(Object.keys(result).sort(), ["snapshotHash", "snapshotId", "snapshotSchemaId", "snapshotSchemaVersion", "verified"]);
});
