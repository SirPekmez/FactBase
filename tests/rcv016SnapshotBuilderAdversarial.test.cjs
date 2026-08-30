const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalizeRcv016,
  sha256Rcv016Text,
  Rcv016PayloadLimitError,
  Rcv016ValidationError,
} = require("../dist/services/rcv016Canonical");
const {
  assertFinalizedRcv016SnapshotBuilderResult,
  buildRcv016ProvenanceSnapshot,
} = require("../dist/services/rcv016SnapshotBuilder");
const {
  RCV016_SNAPSHOT_CANONICAL_INCLUDED_FIELDS_V1,
} = require("../dist/contracts/rcv016ProvenanceContractV1");

const TS = "2026-01-02T03:04:05.000000Z";
const EMPTY = "{}";
const EMPTY_HASH = sha256Rcv016Text(EMPTY);

function id(number) {
  return `00000000-0000-0000-0000-${number.toString(16).padStart(12, "0")}`;
}

function policy(overrides = {}) {
  const definition = {
    policyId: "phase-2-policy",
    policyVersion: "1",
    maxRoots: 20,
    maxNodes: 100,
    maxEdges: 100,
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
    deterministicOrdering: "schema_category_then_canonical_key_lexicographic_v1",
    visitedSemantics: "expand_node_once_include_statement_once_diagnose_cycles_v1",
    ...overrides,
  };
  const { canonical, hash } = canonicalizeRcv016(definition);
  return { ...definition, definitionCanonical: canonical, definitionHash: hash };
}

function artifactVersion(number) {
  return {
    artifactVersionId: id(number),
    artifactId: id(1000 + number),
    versionNumber: 1,
    captureSchemaId: "factbase-artifact-version-capture",
    captureSchemaVersion: "1",
    captureCanonical: EMPTY,
    captureHash: EMPTY_HASH,
    createdAt: TS,
  };
}

function sourceVersion(number, sourceNumber = 2000 + number) {
  return {
    sourceVersionId: id(number),
    sourceId: id(sourceNumber),
    versionNumber: 1,
    metadataSchemaIdentity: { id: "factbase-source-version-metadata", version: "1" },
    metadataCanonical: EMPTY,
    metadataHash: EMPTY_HASH,
    observedAt: TS,
    createdAt: TS,
  };
}

function commonStatement(statementId) {
  return {
    statementId,
    observedAt: TS,
    validFrom: null,
    validTo: null,
    initiator: null,
    rationale: null,
    foundation: null,
    supersedesStatementId: null,
    createdAt: TS,
  };
}

function provenance(number, subject, object, relationship = "cites") {
  return {
    family: "ArtifactProvenanceStatement",
    ...commonStatement(id(number)),
    subjectArtifactVersionId: id(subject),
    relationship,
    objectArtifactVersionId: id(object),
  };
}

function attribution(number, artifact, source, relationship = "authored_by") {
  return {
    family: "ArtifactSourceAttribution",
    ...commonStatement(id(number)),
    subjectArtifactVersionId: id(artifact),
    relationship,
    objectSourceVersionId: id(source),
  };
}

function sourceRelationship(number, subjectSourceId, objectSourceId, relationship = "part_of") {
  return {
    family: "SourceRelationshipStatement",
    ...commonStatement(id(number)),
    subjectSourceId,
    relationship,
    objectSourceId,
  };
}

function binding(number, evidence, artifact) {
  return {
    family: "EvidenceArtifactBinding",
    ...commonStatement(id(number)),
    subjectEvidenceId: id(evidence),
    relationship: "bound_to",
    objectArtifactVersionId: id(artifact),
  };
}

function knowledge(number, artifact, state) {
  return {
    family: "KnowledgeStateStatement",
    ...commonStatement(id(number)),
    subjectArtifactVersionId: id(artifact),
    scope: "upstream_provenance",
    state,
  };
}

function universe(overrides = {}) {
  return {
    snapshotIdentity: {
      snapshotSchemaId: "factbase-provenance-snapshot",
      snapshotSchemaVersion: "1",
      canonicalizationId: "jcs-rfc8785",
      canonicalizationVersion: "1",
      hashAlgorithm: "sha-256",
    },
    builderIdentity: {
      builderId: "factbase-provenance-snapshot-builder",
      builderVersion: "1",
      builderArtifactHash: "a".repeat(64),
    },
    traversalPolicy: policy(),
    roots: [id(1)],
    artifactVersions: [artifactVersion(1)],
    sourceVersions: [],
    artifactProvenanceStatements: [],
    sourceRelationshipStatements: [],
    artifactSourceAttributions: [],
    evidenceArtifactBindings: [],
    knowledgeStateStatements: [],
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildRcv016ProvenanceSnapshot(universe(overrides));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

test("only the exact finalized Builder result passes the authenticated handoff", () => {
  assert.equal(typeof assertFinalizedRcv016SnapshotBuilderResult, "function");
  const result = build();
  const canonicalBefore = result.canonical;
  const hashBefore = result.hash;
  assert.strictEqual(assertFinalizedRcv016SnapshotBuilderResult(result), result);

  const frozenStructuralClone = Object.freeze({ ...result });
  assert.throws(
    () => assertFinalizedRcv016SnapshotBuilderResult(frozenStructuralClone),
    Rcv016ValidationError,
  );

  const jsonClone = deepFreeze(JSON.parse(JSON.stringify(result)));
  assert.throws(
    () => assertFinalizedRcv016SnapshotBuilderResult(jsonClone),
    Rcv016ValidationError,
  );

  const forged = deepFreeze({
    snapshot: JSON.parse(result.canonical),
    canonical: result.canonical,
    hash: sha256Rcv016Text(result.canonical),
    membership: JSON.parse(JSON.stringify(result.membership)),
  });
  assert.throws(
    () => assertFinalizedRcv016SnapshotBuilderResult(forged),
    Rcv016ValidationError,
  );
  assert.equal(result.canonical, canonicalBefore);
  assert.equal(result.hash, hashBefore);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.snapshot));
});

test("Snapshot Builder rejects invalid roots and a zero maxDepth policy", () => {
  assert.throws(() => build({ roots: [] }), Rcv016ValidationError);
  assert.throws(() => build({ roots: [id(1), id(1)] }), Rcv016ValidationError);
  assert.throws(() => build({ roots: [id(10).toUpperCase()] }), Rcv016ValidationError);
  assert.throws(() => build({ roots: ["invalid"] }), Rcv016ValidationError);
  assert.throws(() => build({ roots: [id(2)] }), Rcv016ValidationError);
  assert.throws(
    () => build({ traversalPolicy: policy({ maxDepth: 0 }) }),
    Rcv016ValidationError,
  );
  assert.throws(
    () => build({
      roots: [id(1), id(2)],
      artifactVersions: [artifactVersion(1), artifactVersion(2)],
      traversalPolicy: policy({ maxRoots: 1 }),
    }),
    Rcv016PayloadLimitError,
  );
  const exactRoots = build({
    roots: [id(2), id(1)],
    artifactVersions: [artifactVersion(2), artifactVersion(1)],
    traversalPolicy: policy({ maxRoots: 2 }),
  });
  assert.deepEqual(exactRoots.snapshot.rootArtifactVersionIds, [id(1), id(2)]);
});

test("Snapshot Builder traverses all seven relationships downstream to upstream", () => {
  const relationships = [
    "cites", "quotes", "incorporates", "reposts", "syndicated_from",
    "derived_from", "uses_information_from",
  ];
  const statements = relationships.map((relationship, index) =>
    provenance(100 + index, 1, 2 + index, relationship));
  const artifacts = Array.from({ length: 8 }, (_, index) => artifactVersion(1 + index));
  const result = build({ artifactVersions: artifacts, artifactProvenanceStatements: statements });
  assert.deepEqual(result.snapshot.artifactProvenanceStatements.map((item) => item.relationship).sort(), [...relationships].sort());
  assert.equal(result.snapshot.artifactVersions.length, 8);

  const reverse = build({
    roots: [id(2)],
    artifactVersions: [artifactVersion(1), artifactVersion(2)],
    artifactProvenanceStatements: [provenance(150, 1, 2)],
  });
  assert.deepEqual(reverse.snapshot.artifactVersions.map((item) => item.artifactVersionId), [id(2)]);
  assert.equal(reverse.snapshot.artifactProvenanceStatements.length, 0);
});

test("minimum-distance traversal and maxDepth are independent of discovery order", () => {
  const artifacts = [1, 2, 3, 4, 5].map(artifactVersion);
  const statements = [
    provenance(101, 1, 2),
    provenance(102, 1, 3),
    provenance(103, 3, 4),
    provenance(104, 4, 2),
    provenance(105, 2, 5),
  ];
  const atDepthTwo = build({
    artifactVersions: artifacts,
    artifactProvenanceStatements: statements,
    traversalPolicy: policy({ maxDepth: 2 }),
  });
  assert.deepEqual(atDepthTwo.snapshot.artifactVersions.map((item) => item.artifactVersionId), [id(1), id(2), id(3), id(4), id(5)]);
  assert.deepEqual(atDepthTwo.snapshot.artifactProvenanceStatements.map((item) => item.statementId).sort(), [id(101), id(102), id(103), id(105)].sort());
  const permuted = build({
    artifactVersions: [...artifacts].reverse(),
    artifactProvenanceStatements: [...statements].reverse(),
    traversalPolicy: policy({ maxDepth: 2 }),
  });
  assert.equal(permuted.canonical, atDepthTwo.canonical);
  assert.equal(permuted.hash, atDepthTwo.hash);

  const depthOne = build({
    artifactVersions: artifacts,
    artifactProvenanceStatements: statements,
    traversalPolicy: policy({ maxDepth: 1 }),
  });
  assert.deepEqual(depthOne.snapshot.artifactVersions.map((item) => item.artifactVersionId), [id(1), id(2), id(3)]);
  assert.deepEqual(depthOne.snapshot.artifactProvenanceStatements.map((item) => item.statementId).sort(), [id(101), id(102)]);
});

test("node and traversal-edge limits fail the whole build and ignore non-traversal statements", () => {
  const base = {
    artifactVersions: [artifactVersion(1), artifactVersion(2)],
    artifactProvenanceStatements: [provenance(101, 1, 2)],
  };
  assert.doesNotThrow(() => build({ ...base, traversalPolicy: policy({ maxNodes: 2, maxEdges: 1 }) }));
  assert.throws(() => build({ ...base, traversalPolicy: policy({ maxNodes: 1 }) }), Rcv016PayloadLimitError);
  assert.throws(() => build({
    artifactVersions: [artifactVersion(1), artifactVersion(2), artifactVersion(3)],
    artifactProvenanceStatements: [provenance(101, 1, 2), provenance(102, 1, 3)],
    traversalPolicy: policy({ maxEdges: 1 }),
  }), Rcv016PayloadLimitError);
  assert.doesNotThrow(() => build({
    ...base,
    sourceVersions: [sourceVersion(20)],
    artifactSourceAttributions: [attribution(201, 1, 20)],
    evidenceArtifactBindings: [binding(202, 30, 1)],
    knowledgeStateStatements: [knowledge(203, 1, "known")],
    traversalPolicy: policy({ maxEdges: 1 }),
  }));
});

test("non-traversal closure uses exact local predicates and preserves history", () => {
  const sv1 = sourceVersion(20, 2001);
  const sv2 = sourceVersion(21, 2002);
  const sv3 = sourceVersion(22, 2003);
  const result = build({
    artifactVersions: [artifactVersion(1), artifactVersion(2), artifactVersion(3)],
    artifactProvenanceStatements: [provenance(101, 1, 2)],
    sourceVersions: [sv1, sv2, sv3],
    artifactSourceAttributions: [
      attribution(201, 1, 20, "authored_by"),
      attribution(202, 2, 21, "published_by"),
      attribution(203, 3, 22, "hosted_by"),
    ],
    sourceRelationshipStatements: [
      sourceRelationship(301, sv1.sourceId, sv2.sourceId, "part_of"),
      sourceRelationship(302, sv2.sourceId, sv3.sourceId, "controlled_by"),
    ],
    evidenceArtifactBindings: [binding(401, 500, 1), binding(402, 501, 3)],
    knowledgeStateStatements: [
      knowledge(501, 1, "unknown"),
      knowledge(502, 1, "partial"),
      knowledge(503, 1, "known"),
      knowledge(504, 3, "known"),
    ],
  });
  assert.deepEqual(result.snapshot.sourceVersions.map((item) => item.sourceVersionId), [id(20), id(21)]);
  assert.deepEqual(result.snapshot.artifactSourceAttributions.map((item) => item.statementId), [id(201), id(202)]);
  assert.deepEqual(result.snapshot.sourceRelationshipStatements.map((item) => item.statementId), [id(301)]);
  assert.deepEqual(result.snapshot.evidenceArtifactBindings.map((item) => item.statementId), [id(401)]);
  assert.deepEqual(result.snapshot.knowledgeStateStatements.map((item) => item.statementId), [id(501), id(502), id(503)]);
  assert.deepEqual(result.snapshot.derivedUnrecordedStates, [{ artifactVersionId: id(2), scope: "upstream_provenance", state: "unrecorded" }]);
  assert.equal(result.snapshot.conflictDiagnostics.length, 0);
});

test("root and included Membership coexist while derived subjects deduplicate", () => {
  const result = build({
    artifactVersions: [artifactVersion(1), artifactVersion(2)],
    artifactProvenanceStatements: [provenance(101, 1, 2), provenance(102, 2, 1)],
    traversalPolicy: policy({ maxDepth: 2 }),
  });
  const artifactKeys = result.snapshot.membershipKeys.filter((key) => key.targetType === "ArtifactVersion");
  assert.deepEqual(artifactKeys, [
    { targetType: "ArtifactVersion", membershipRole: "root", artifactVersionId: id(1) },
    { targetType: "ArtifactVersion", membershipRole: "included", artifactVersionId: id(1) },
    { targetType: "ArtifactVersion", membershipRole: "included", artifactVersionId: id(2) },
  ]);
  assert.deepEqual(result.snapshot.derivedUnrecordedStates.map((item) => item.artifactVersionId), [id(1), id(2)]);
  assert.equal(result.snapshot.buildTimeCycleDiagnostics.length, 1);
});

test("cycle diagnostics use only the bounded traversed subgraph", () => {
  const graph = {
    artifactVersions: [artifactVersion(1), artifactVersion(2), artifactVersion(3)],
    artifactProvenanceStatements: [provenance(101, 1, 2), provenance(102, 2, 3), provenance(103, 3, 1)],
  };
  assert.equal(build({ ...graph, traversalPolicy: policy({ maxDepth: 1 }) }).snapshot.buildTimeCycleDiagnostics.length, 0);
  assert.equal(build({ ...graph, traversalPolicy: policy({ maxDepth: 2 }) }).snapshot.buildTimeCycleDiagnostics.length, 0);
  assert.equal(build({ ...graph, traversalPolicy: policy({ maxDepth: 3 }) }).snapshot.buildTimeCycleDiagnostics.length, 1);
});

test("Snapshot Canonical is exactly 31 fields, identity-bound, hash-bound, and immutable", () => {
  const input = universe();
  const result = buildRcv016ProvenanceSnapshot(input);
  assert.deepEqual(Object.keys(result.snapshot), [...RCV016_SNAPSHOT_CANONICAL_INCLUDED_FIELDS_V1]);
  assert.equal(result.hash, sha256Rcv016Text(result.canonical));
  assert.equal(result.canonical, canonicalizeRcv016(result.snapshot).canonical);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.snapshot));
  assert.ok(!("snapshotId" in result.snapshot));
  assert.ok(!("snapshotPersistenceCreatedAt" in result.snapshot));
  assert.deepEqual(Object.keys(result.snapshot.artifactVersions[0]), [
    "artifactVersionId", "artifactId", "versionNumber", "captureSchemaId",
    "captureSchemaVersion", "captureCanonical", "captureHash", "createdAt",
  ]);
  assert.ok(!("publishedAt" in result.snapshot.artifactVersions[0]));
  assert.ok(!("observedAt" in result.snapshot.artifactVersions[0]));
  assert.ok(!("retrievedAt" in result.snapshot.artifactVersions[0]));

  input.roots.push(id(2));
  input.artifactVersions[0].artifactId = id(9999);
  assert.deepEqual(result.snapshot.rootArtifactVersionIds, [id(1)]);
  assert.equal(result.snapshot.artifactVersions[0].artifactId, id(1001));

  const changedBuilder = build({ builderIdentity: { ...input.builderIdentity, builderArtifactHash: "b".repeat(64) } });
  assert.notEqual(changedBuilder.canonical, result.canonical);
  assert.notEqual(changedBuilder.hash, result.hash);
});

test("maxCanonicalSnapshotBytes uses exact final UTF-8 JCS bytes", () => {
  let limit = 1_000_000;
  let exact;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    exact = build({ traversalPolicy: policy({ maxCanonicalSnapshotBytes: limit }) });
    const actual = Buffer.byteLength(exact.canonical, "utf8");
    if (actual === limit) break;
    limit = actual;
  }
  const exactBytes = Buffer.byteLength(exact.canonical, "utf8");
  const exactResult = build({ traversalPolicy: policy({ maxCanonicalSnapshotBytes: exactBytes }) });
  assert.equal(Buffer.byteLength(exactResult.canonical, "utf8"), exactBytes);
  assert.doesNotThrow(
    () => build({ traversalPolicy: policy({ maxCanonicalSnapshotBytes: exactBytes + 1 }) }),
  );
  assert.throws(
    () => build({ traversalPolicy: policy({ maxCanonicalSnapshotBytes: exactBytes - 1 }) }),
    Rcv016PayloadLimitError,
  );
});

test("selected missing references fail closed while foreign objects stay excluded", () => {
  assert.throws(() => build({
    artifactProvenanceStatements: [provenance(101, 1, 2)],
  }), Rcv016ValidationError);
  assert.throws(() => build({
    artifactSourceAttributions: [attribution(201, 1, 20)],
  }), Rcv016ValidationError);
  const foreign = build({
    artifactVersions: [artifactVersion(1), artifactVersion(3)],
    artifactProvenanceStatements: [provenance(101, 3, 4)],
    artifactSourceAttributions: [attribution(201, 3, 20)],
    evidenceArtifactBindings: [binding(301, 400, 3)],
    knowledgeStateStatements: [knowledge(401, 3, "known")],
  });
  assert.deepEqual(foreign.snapshot.artifactVersions.map((item) => item.artifactVersionId), [id(1)]);
  assert.equal(foreign.snapshot.artifactProvenanceStatements.length, 0);
  assert.equal(foreign.snapshot.artifactSourceAttributions.length, 0);
  assert.equal(foreign.snapshot.evidenceArtifactBindings.length, 0);
  assert.equal(foreign.snapshot.knowledgeStateStatements.length, 0);
});

test("discovery permutations are byte-identical and Builder output has no semantic leak", () => {
  const sv1 = sourceVersion(20, 2001);
  const sv2 = sourceVersion(21, 2002);
  const base = universe({
    roots: [id(2), id(1)],
    artifactVersions: [artifactVersion(1), artifactVersion(2), artifactVersion(3)],
    artifactProvenanceStatements: [provenance(101, 1, 3), provenance(102, 2, 3)],
    sourceVersions: [sv1, sv2],
    artifactSourceAttributions: [attribution(201, 1, 20), attribution(202, 2, 21)],
    sourceRelationshipStatements: [sourceRelationship(301, sv1.sourceId, sv2.sourceId)],
    evidenceArtifactBindings: [binding(401, 500, 1), binding(402, 501, 2)],
    knowledgeStateStatements: [knowledge(501, 1, "known"), knowledge(502, 2, "partial")],
  });
  const left = buildRcv016ProvenanceSnapshot(base);
  const right = buildRcv016ProvenanceSnapshot({
    ...base,
    roots: [...base.roots].reverse(),
    artifactVersions: [...base.artifactVersions].reverse(),
    sourceVersions: [...base.sourceVersions].reverse(),
    artifactProvenanceStatements: [...base.artifactProvenanceStatements].reverse(),
    sourceRelationshipStatements: [...base.sourceRelationshipStatements].reverse(),
    artifactSourceAttributions: [...base.artifactSourceAttributions].reverse(),
    evidenceArtifactBindings: [...base.evidenceArtifactBindings].reverse(),
    knowledgeStateStatements: [...base.knowledgeStateStatements].reverse(),
  });
  assert.equal(right.canonical, left.canonical);
  assert.equal(right.hash, left.hash);
  const forbidden = ["truth", "credibility", "quality", "trust", "independence", "weight", "ranking", "winner", "isCurrent", "effectiveStatement"];
  for (const key of forbidden) assert.ok(!(key in left) && !(key in left.snapshot));
});

test("all attribution and Source relationship histories use local closure without transitive expansion", () => {
  const representedA = sourceVersion(20, 2001);
  const representedB = sourceVersion(21, 2002);
  const unrepresentedC = sourceVersion(22, 2003);
  const attributions = ["authored_by", "published_by", "hosted_by", "issued_by"]
    .map((relationship, index) => attribution(210 + index, 1, index % 2 === 0 ? 20 : 21, relationship));
  const sourceRelationships = ["alias_of", "successor_of", "part_of", "controlled_by", "operated_by"]
    .map((relationship, index) => sourceRelationship(310 + index, representedA.sourceId, representedB.sourceId, relationship));
  sourceRelationships.push(sourceRelationship(399, representedB.sourceId, unrepresentedC.sourceId, "part_of"));

  const result = build({
    sourceVersions: [unrepresentedC, representedB, representedA],
    artifactSourceAttributions: [...attributions].reverse(),
    sourceRelationshipStatements: [...sourceRelationships].reverse(),
  });
  assert.deepEqual(
    result.snapshot.artifactSourceAttributions.map((item) => item.relationship).sort(),
    ["authored_by", "published_by", "hosted_by", "issued_by"].sort(),
  );
  assert.deepEqual(
    result.snapshot.sourceRelationshipStatements.map((item) => item.relationship).sort(),
    ["alias_of", "successor_of", "part_of", "controlled_by", "operated_by"].sort(),
  );
  assert.deepEqual(result.snapshot.sourceVersions.map((item) => item.sourceVersionId), [id(20), id(21)]);
  assert.ok(!result.snapshot.sourceRelationshipStatements.some((item) => item.statementId === id(399)));
  assert.ok(!result.snapshot.sourceVersions.some((item) => item.sourceVersionId === id(22)));
});

test("historical statements stay distinct and derived state uses only included Knowledge States", () => {
  const result = build({
    artifactVersions: [artifactVersion(1), artifactVersion(2), artifactVersion(3)],
    artifactProvenanceStatements: [
      provenance(101, 1, 2, "cites"),
      provenance(102, 1, 2, "cites"),
      provenance(103, 1, 3, "quotes"),
    ],
    knowledgeStateStatements: [
      knowledge(503, 1, "known"),
      knowledge(501, 1, "unknown"),
      knowledge(502, 1, "partial"),
      knowledge(504, 99, "known"),
    ],
  });
  assert.deepEqual(result.snapshot.artifactProvenanceStatements.map((item) => item.statementId), [id(101), id(102), id(103)]);
  assert.deepEqual(result.snapshot.knowledgeStateStatements.map((item) => item.statementId), [id(501), id(502), id(503)]);
  assert.deepEqual(result.snapshot.derivedUnrecordedStates, [
    { artifactVersionId: id(2), scope: "upstream_provenance", state: "unrecorded" },
    { artifactVersionId: id(3), scope: "upstream_provenance", state: "unrecorded" },
  ]);
});

test("derivedUnrecordedStates is required and empty when every member has an included state", () => {
  const result = build({
    artifactVersions: [artifactVersion(1), artifactVersion(2), artifactVersion(3)],
    artifactProvenanceStatements: [provenance(101, 1, 2), provenance(102, 1, 3)],
    knowledgeStateStatements: [
      knowledge(501, 1, "unknown"),
      knowledge(502, 2, "partial"),
      knowledge(503, 3, "known"),
    ],
  });
  assert.deepEqual(result.snapshot.derivedUnrecordedStates, []);
  assert.ok(Object.hasOwn(result.snapshot, "derivedUnrecordedStates"));
});

test("the finalized membership projection contains exactly seven typed families", () => {
  const sv1 = sourceVersion(20, 2001);
  const sv2 = sourceVersion(21, 2002);
  const result = build({
    artifactVersions: [artifactVersion(1), artifactVersion(2)],
    artifactProvenanceStatements: [provenance(101, 1, 2)],
    sourceVersions: [sv1, sv2],
    artifactSourceAttributions: [attribution(201, 1, 20), attribution(202, 2, 21)],
    sourceRelationshipStatements: [sourceRelationship(301, sv1.sourceId, sv2.sourceId)],
    evidenceArtifactBindings: [binding(401, 500, 1)],
    knowledgeStateStatements: [knowledge(501, 1, "known")],
  });
  assert.deepEqual([...new Set(result.snapshot.membershipKeys.map((key) => key.targetType))], [
    "ArtifactVersion",
    "SourceVersion",
    "ArtifactProvenanceStatement",
    "SourceRelationshipStatement",
    "ArtifactSourceAttribution",
    "EvidenceArtifactBinding",
    "KnowledgeStateStatement",
  ]);
  assert.deepEqual(Object.keys(result.membership), [
    "artifactVersions",
    "sourceVersions",
    "artifactProvenanceStatements",
    "sourceRelationshipStatements",
    "artifactSourceAttributions",
    "evidenceArtifactBindings",
    "knowledgeStateStatements",
  ]);
});

test("Builder input and relationship vocabularies fail closed", () => {
  assert.throws(() => buildRcv016ProvenanceSnapshot({ ...universe(), extra: true }), Rcv016ValidationError);
  assert.throws(() => build({
    artifactProvenanceStatements: [{ ...provenance(101, 1, 2), relationship: "authored_by" }],
  }), Rcv016ValidationError);
  assert.throws(() => build({
    sourceRelationshipStatements: [{
      ...sourceRelationship(301, id(2001), id(2002)),
      relationship: "cites",
    }],
  }), Rcv016ValidationError);
  assert.throws(() => build({
    knowledgeStateStatements: [{ ...knowledge(501, 1, "known"), scope: "provenance" }],
  }), Rcv016ValidationError);
});
