import {
  RCV016_ARTIFACT_VERSION_MEMBERSHIP_ROLE_ORDER_V1,
  RCV016_MEMBERSHIP_CATEGORY_ORDER_V1,
  Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1,
} from "../contracts/rcv016ProvenanceContractV1";
import { validateRcv016CanonicalUuid } from "./rcv016Canonical";
import {
  Rcv016ValidationError,
  expectRcv016ExactObject,
  freezeRcv016,
} from "./rcv016Validation";

const KEY_FIELDS = {
  ArtifactVersion: "artifactVersionId",
  SourceVersion: "sourceVersionId",
  ArtifactProvenanceStatement: "artifactProvenanceStatementId",
  SourceRelationshipStatement: "sourceRelationshipStatementId",
  ArtifactSourceAttribution: "artifactSourceAttributionId",
  EvidenceArtifactBinding: "evidenceArtifactBindingId",
  KnowledgeStateStatement: "knowledgeStateStatementId",
} as const;

type MembershipTargetType = keyof typeof KEY_FIELDS;

function categoryRank(targetType: MembershipTargetType): number {
  return RCV016_MEMBERSHIP_CATEGORY_ORDER_V1.indexOf(targetType);
}

function roleRank(key: Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1): number {
  return key.targetType === "ArtifactVersion"
    ? RCV016_ARTIFACT_VERSION_MEMBERSHIP_ROLE_ORDER_V1.indexOf(key.membershipRole)
    : 0;
}

function keyId(key: Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1): string {
  switch (key.targetType) {
    case "ArtifactVersion":
      return key.artifactVersionId;
    case "SourceVersion":
      return key.sourceVersionId;
    case "ArtifactProvenanceStatement":
      return key.artifactProvenanceStatementId;
    case "SourceRelationshipStatement":
      return key.sourceRelationshipStatementId;
    case "ArtifactSourceAttribution":
      return key.artifactSourceAttributionId;
    case "EvidenceArtifactBinding":
      return key.evidenceArtifactBindingId;
    case "KnowledgeStateStatement":
      return key.knowledgeStateStatementId;
  }
}

function validateKey(
  value: unknown,
  index: number,
): Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1 {
  const path = `membershipKeys[${index}]`;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Rcv016ValidationError(path, "expected a closed Membership key object");
  }
  const targetType = (value as { targetType?: unknown }).targetType;
  if (
    typeof targetType !== "string" ||
    !(targetType in KEY_FIELDS)
  ) {
    throw new Rcv016ValidationError(`${path}.targetType`, "unexpected target type");
  }
  const typedTarget = targetType as MembershipTargetType;
  const idField = KEY_FIELDS[typedTarget];
  const object = expectRcv016ExactObject(
    value,
    ["targetType", "membershipRole", idField],
    path,
  );
  const role = object.membershipRole;
  if (
    (typedTarget === "ArtifactVersion" && role !== "root" && role !== "included") ||
    (typedTarget !== "ArtifactVersion" && role !== "included")
  ) {
    throw new Rcv016ValidationError(`${path}.membershipRole`, "unexpected role");
  }
  const id = validateRcv016CanonicalUuid(object[idField], `${path}.${idField}`);
  return {
    targetType: typedTarget,
    membershipRole: role,
    [idField]: id,
  } as Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1;
}

export function sortRcv016SnapshotMembershipKeys(
  values: readonly unknown[],
): readonly Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1[] {
  const keys = values.map(validateKey);
  const seen = new Set<string>();
  for (const key of keys) {
    const semanticKey = `${key.targetType}\u0000${key.membershipRole}\u0000${keyId(key)}`;
    if (seen.has(semanticKey)) {
      throw new Rcv016ValidationError("membershipKeys", "duplicate Membership key");
    }
    seen.add(semanticKey);
  }
  keys.sort((left, right) => {
    const category = categoryRank(left.targetType) - categoryRank(right.targetType);
    if (category !== 0) return category;
    const role = roleRank(left) - roleRank(right);
    if (role !== 0) return role;
    const leftId = keyId(left);
    const rightId = keyId(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return freezeRcv016(keys) as readonly Rcv016ProvenanceSnapshotMembershipCanonicalKeyV1[];
}
