const assert = require("node:assert/strict");
const test = require("node:test");

const {
  sortRcv016SnapshotMembershipKeys,
} = require("../dist/services/rcv016SnapshotMembership");
const {
  buildRcv016CycleDiagnostics,
} = require("../dist/services/rcv016CycleDiagnostics");

const UUID = {
  a: "00000000-0000-0000-0000-000000000001",
  b: "00000000-0000-0000-0000-000000000002",
  c: "00000000-0000-0000-0000-000000000003",
  d: "00000000-0000-0000-0000-000000000004",
  e: "00000000-0000-0000-0000-000000000005",
  f: "00000000-0000-0000-0000-000000000006",
  g: "00000000-0000-0000-0000-000000000007",
};

test("RCV-016 Membership uses seven closed key shapes and the frozen total order", () => {
  const keys = [
    { targetType: "KnowledgeStateStatement", membershipRole: "included", knowledgeStateStatementId: UUID.g },
    { targetType: "ArtifactVersion", membershipRole: "included", artifactVersionId: UUID.a },
    { targetType: "EvidenceArtifactBinding", membershipRole: "included", evidenceArtifactBindingId: UUID.f },
    { targetType: "ArtifactSourceAttribution", membershipRole: "included", artifactSourceAttributionId: UUID.e },
    { targetType: "SourceRelationshipStatement", membershipRole: "included", sourceRelationshipStatementId: UUID.d },
    { targetType: "ArtifactProvenanceStatement", membershipRole: "included", artifactProvenanceStatementId: UUID.c },
    { targetType: "SourceVersion", membershipRole: "included", sourceVersionId: UUID.b },
    { targetType: "ArtifactVersion", membershipRole: "root", artifactVersionId: UUID.b },
    { targetType: "ArtifactVersion", membershipRole: "root", artifactVersionId: UUID.a },
  ];

  const sorted = sortRcv016SnapshotMembershipKeys(keys);
  assert.deepEqual(
    sorted.map((key) => [key.targetType, key.membershipRole, Object.values(key)[2]]),
    [
      ["ArtifactVersion", "root", UUID.a],
      ["ArtifactVersion", "root", UUID.b],
      ["ArtifactVersion", "included", UUID.a],
      ["SourceVersion", "included", UUID.b],
      ["ArtifactProvenanceStatement", "included", UUID.c],
      ["SourceRelationshipStatement", "included", UUID.d],
      ["ArtifactSourceAttribution", "included", UUID.e],
      ["EvidenceArtifactBinding", "included", UUID.f],
      ["KnowledgeStateStatement", "included", UUID.g],
    ],
  );
  assert.ok(Object.isFrozen(sorted));
  assert.ok(sorted.every(Object.isFrozen));
});

test("RCV-016 Membership rejects open, duplicate, and invalid-role keys", () => {
  assert.throws(() =>
    sortRcv016SnapshotMembershipKeys([
      { targetType: "ArtifactVersion", membershipRole: "root", artifactVersionId: UUID.a },
      { targetType: "ArtifactVersion", membershipRole: "root", artifactVersionId: UUID.a },
    ]),
  );
  assert.throws(() =>
    sortRcv016SnapshotMembershipKeys([
      { targetType: "SourceVersion", membershipRole: "root", sourceVersionId: UUID.a },
    ]),
  );
  assert.throws(() =>
    sortRcv016SnapshotMembershipKeys([
      { targetType: "ArtifactVersion", membershipRole: "root", artifactVersionId: UUID.a, id: UUID.a },
    ]),
  );
  assert.throws(() =>
    sortRcv016SnapshotMembershipKeys([
      { targetType: "Source", membershipRole: "included", sourceId: UUID.a },
    ]),
  );
});

function provenance(statementId, subjectArtifactVersionId, objectArtifactVersionId, relationship = "cites") {
  return { statementId, subjectArtifactVersionId, objectArtifactVersionId, relationship };
}

test("RCV-016 Cycle diagnostics normalize directed rotations and discovery order", () => {
  const statements = [
    provenance(UUID.d, UUID.a, UUID.b),
    provenance(UUID.e, UUID.b, UUID.c),
    provenance(UUID.f, UUID.c, UUID.a),
  ];
  const expected = [{
    code: "artifact_provenance_cycle_detected",
    artifactVersionIds: [UUID.a, UUID.b, UUID.c, UUID.a],
    statementIds: [UUID.d, UUID.e, UUID.f],
  }];
  assert.deepEqual(buildRcv016CycleDiagnostics(statements), expected);
  assert.deepEqual(buildRcv016CycleDiagnostics([...statements].reverse()), expected);
});

test("RCV-016 Cycle diagnostics preserve direction, collapse repeats, and sort identities", () => {
  const forward = [
    provenance(UUID.d, UUID.a, UUID.b),
    provenance(UUID.e, UUID.b, UUID.c),
    provenance(UUID.f, UUID.c, UUID.a),
  ];
  const reverseWithDifferentStatements = [
    provenance(UUID.d, UUID.a, UUID.c),
    provenance(UUID.e, UUID.c, UUID.b),
    provenance(UUID.g, UUID.b, UUID.a),
  ];
  const diagnostics = buildRcv016CycleDiagnostics(forward);
  assert.equal(diagnostics.length, 1);
  assert.notDeepEqual(
    diagnostics,
    buildRcv016CycleDiagnostics(reverseWithDifferentStatements),
  );
  assert.deepEqual(
    buildRcv016CycleDiagnostics([provenance(UUID.d, UUID.a, UUID.a)]),
    [{
      code: "artifact_provenance_cycle_detected",
      artifactVersionIds: [UUID.a, UUID.a],
      statementIds: [UUID.d],
    }],
  );
  assert.ok(Object.isFrozen(diagnostics));
});

test("RCV-016 Cycle diagnostics deterministically order disjoint cycles", () => {
  const cycles = [
    provenance(UUID.d, UUID.a, UUID.b),
    provenance(UUID.e, UUID.b, UUID.a),
    provenance(UUID.f, UUID.c, UUID.d),
    provenance(UUID.g, UUID.d, UUID.c),
  ];
  const forward = buildRcv016CycleDiagnostics(cycles);
  const reverse = buildRcv016CycleDiagnostics([...cycles].reverse());
  assert.equal(forward.length, 2);
  assert.deepEqual(reverse, forward);
});
