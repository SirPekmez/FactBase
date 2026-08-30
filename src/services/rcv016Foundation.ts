import {
  RCV016_FOUNDATION_SCHEMA_ID,
  RCV016_FOUNDATION_SCHEMA_VERSION,
  Rcv016DeterministicMethodInputReferenceV1,
  Rcv016FoundationItemV1,
  Rcv016FoundationV1,
  Rcv016NonEmptyStringV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  Rcv016CanonicalResult,
  canonicalizeRcv016,
  finalizeRcv016Canonical,
  validateRcv016CanonicalUuid,
  validateRcv016SchemaIdentity,
} from "./rcv016Canonical";
import { validateRcv016PayloadLimits } from "./rcv016PayloadLimits";
import {
  Rcv016PayloadLimitError,
  Rcv016ValidationError,
  assertRcv016CountLimit,
  assertRcv016TextLimits,
  expectRcv016Array,
  expectRcv016ExactObject,
  expectRcv016NonEmptyString,
  expectRcv016PlainObject,
  rcv016Utf8ByteLength,
} from "./rcv016Validation";

const FOUNDATION_KEYS = ["schema", "items"] as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertReferenceLimits(
  value: string,
  limits: ReturnType<typeof validateRcv016PayloadLimits>,
  path: string,
): void {
  assertRcv016TextLimits(
    value,
    limits.foundationReferenceCodepoints,
    limits.foundationReferenceUtf8Bytes,
    path,
    "foundationReferenceCodepoints",
    "foundationReferenceUtf8Bytes",
  );
}

function compareInputReference(
  left: Rcv016DeterministicMethodInputReferenceV1,
  right: Rcv016DeterministicMethodInputReferenceV1,
): number {
  return (
    compareText(left.referenceType, right.referenceType) ||
    compareText(left.referenceId, right.referenceId)
  );
}

function validateInputReference(
  value: unknown,
  path: string,
  limits: ReturnType<typeof validateRcv016PayloadLimits>,
): Rcv016DeterministicMethodInputReferenceV1 {
  const raw = expectRcv016ExactObject(
    value,
    ["referenceType", "referenceId"],
    path,
  );
  const referenceType = expectRcv016NonEmptyString(
    raw.referenceType,
    `${path}.referenceType`,
  );
  if (
    referenceType !== "evidence" &&
    referenceType !== "artifact_version" &&
    referenceType !== "provenance_snapshot"
  ) {
    throw new Rcv016ValidationError(
      `${path}.referenceType`,
      "unknown deterministic-method reference type",
    );
  }
  const referenceId = validateRcv016CanonicalUuid(
    raw.referenceId,
    `${path}.referenceId`,
  );
  assertReferenceLimits(referenceId, limits, `${path}.referenceId`);
  return { referenceType, referenceId } as Rcv016DeterministicMethodInputReferenceV1;
}

function validateFoundationItem(
  value: unknown,
  index: number,
  limits: ReturnType<typeof validateRcv016PayloadLimits>,
): { item: Rcv016FoundationItemV1; inputReferenceCount: number } {
  const path = `foundation.items[${index}]`;
  const plain = expectRcv016PlainObject(value, path);
  const kind = expectRcv016NonEmptyString(plain.kind, `${path}.kind`);
  if (kind === "evidence_reference") {
    const input = expectRcv016ExactObject(value, ["kind", "evidenceId"], path);
    const evidenceId = validateRcv016CanonicalUuid(
      input.evidenceId,
      `${path}.evidenceId`,
    );
    assertReferenceLimits(evidenceId, limits, `${path}.evidenceId`);
    return {
      item: { kind, evidenceId } as Rcv016FoundationItemV1,
      inputReferenceCount: 0,
    };
  }
  if (kind === "artifact_version_reference") {
    const input = expectRcv016ExactObject(
      value,
      ["kind", "artifactVersionId"],
      path,
    );
    const artifactVersionId = validateRcv016CanonicalUuid(
      input.artifactVersionId,
      `${path}.artifactVersionId`,
    );
    assertReferenceLimits(artifactVersionId, limits, `${path}.artifactVersionId`);
    return {
      item: { kind, artifactVersionId } as Rcv016FoundationItemV1,
      inputReferenceCount: 0,
    };
  }
  if (kind === "imported_assertion") {
    const input = expectRcv016ExactObject(
      value,
      ["kind", "referenceType", "reference"],
      path,
    );
    const referenceType = expectRcv016NonEmptyString(
      input.referenceType,
      `${path}.referenceType`,
    );
    if (referenceType !== "import_run" && referenceType !== "external_record") {
      throw new Rcv016ValidationError(
        `${path}.referenceType`,
        "unknown imported-assertion reference type",
      );
    }
    const reference = expectRcv016NonEmptyString(
      input.reference,
      `${path}.reference`,
    );
    assertReferenceLimits(reference, limits, `${path}.reference`);
    return {
      item: {
        kind,
        referenceType,
        reference: reference as Rcv016NonEmptyStringV1,
      },
      inputReferenceCount: 0,
    };
  }
  if (kind === "deterministic_method") {
    const input = expectRcv016ExactObject(
      value,
      ["kind", "methodId", "methodVersion", "inputReferences"],
      path,
    );
    const methodId = expectRcv016NonEmptyString(input.methodId, `${path}.methodId`);
    const methodVersion = expectRcv016NonEmptyString(
      input.methodVersion,
      `${path}.methodVersion`,
    );
    assertReferenceLimits(methodId, limits, `${path}.methodId`);
    assertReferenceLimits(methodVersion, limits, `${path}.methodVersion`);
    const rawReferences = expectRcv016Array(
      input.inputReferences,
      `${path}.inputReferences`,
    );
    if (rawReferences.length === 0) {
      throw new Rcv016ValidationError(
        `${path}.inputReferences`,
        "expected a non-empty array",
      );
    }
    const inputReferences = rawReferences.map((reference, referenceIndex) =>
      validateInputReference(
        reference,
        `${path}.inputReferences[${referenceIndex}]`,
        limits,
      ),
    );
    inputReferences.sort(compareInputReference);
    for (let referenceIndex = 1; referenceIndex < inputReferences.length; referenceIndex += 1) {
      if (
        compareInputReference(
          inputReferences[referenceIndex - 1],
          inputReferences[referenceIndex],
        ) === 0
      ) {
        throw new Rcv016ValidationError(
          `${path}.inputReferences`,
          "exact duplicate input reference",
        );
      }
    }
    return {
      item: {
        kind,
        methodId: methodId as Rcv016NonEmptyStringV1,
        methodVersion: methodVersion as Rcv016NonEmptyStringV1,
        inputReferences: inputReferences as [
          Rcv016DeterministicMethodInputReferenceV1,
          ...Rcv016DeterministicMethodInputReferenceV1[],
        ],
      },
      inputReferenceCount: inputReferences.length,
    };
  }
  throw new Rcv016ValidationError(`${path}.kind`, "unknown Foundation kind");
}

function foundationItemKey(item: Rcv016FoundationItemV1): readonly string[] {
  if (item.kind === "evidence_reference") return [item.kind, item.evidenceId];
  if (item.kind === "artifact_version_reference") {
    return [item.kind, item.artifactVersionId];
  }
  if (item.kind === "imported_assertion") {
    return [item.kind, item.referenceType, item.reference];
  }
  return [
    item.kind,
    item.methodId,
    item.methodVersion,
    canonicalizeRcv016(item.inputReferences).canonical,
  ];
}

function compareFoundationItem(
  left: Rcv016FoundationItemV1,
  right: Rcv016FoundationItemV1,
): number {
  const leftKey = foundationItemKey(left);
  const rightKey = foundationItemKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const comparison = compareText(leftKey[index], rightKey[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function validateAndCanonicalizeRcv016Foundation(
  value: unknown,
  rawLimits: unknown,
): Rcv016CanonicalResult<Rcv016FoundationV1> | null {
  const limits = validateRcv016PayloadLimits(rawLimits);
  if (value === null) return null;
  const input = expectRcv016ExactObject(value, FOUNDATION_KEYS, "foundation");
  const schema = validateRcv016SchemaIdentity(
    input.schema,
    RCV016_FOUNDATION_SCHEMA_ID,
    RCV016_FOUNDATION_SCHEMA_VERSION,
    "foundation.schema",
  );
  const rawItems = expectRcv016Array(input.items, "foundation.items");
  if (rawItems.length === 0) {
    throw new Rcv016ValidationError("foundation.items", "expected a non-empty array");
  }
  assertRcv016CountLimit(
    rawItems.length,
    limits.foundationItemCount,
    "foundation.items",
    "foundationItemCount",
  );
  const validated = rawItems.map((item, index) =>
    validateFoundationItem(item, index, limits),
  );
  const totalInputReferences = validated.reduce(
    (total, entry) => total + entry.inputReferenceCount,
    0,
  );
  assertRcv016CountLimit(
    totalInputReferences,
    limits.foundationInputReferenceCount,
    "foundation.items",
    "foundationInputReferenceCount",
  );
  const items = validated.map(({ item }) => item);
  items.sort(compareFoundationItem);
  for (let index = 1; index < items.length; index += 1) {
    if (compareFoundationItem(items[index - 1], items[index]) === 0) {
      throw new Rcv016ValidationError("foundation.items", "exact duplicate item");
    }
  }
  const result = finalizeRcv016Canonical({
    schema,
    items: items as [Rcv016FoundationItemV1, ...Rcv016FoundationItemV1[]],
  } as Rcv016FoundationV1);
  if (rcv016Utf8ByteLength(result.canonical) > limits.foundationCanonicalBytes) {
    throw new Rcv016PayloadLimitError(
      "foundation",
      "exceeds foundationCanonicalBytes",
    );
  }
  return result;
}
