import {
  RCV016_SOURCE_VERSION_METADATA_SCHEMA_ID,
  RCV016_SOURCE_VERSION_METADATA_SCHEMA_VERSION,
  Rcv016AbsoluteUrlStringV1,
  Rcv016NonEmptyStringV1,
  Rcv016SourceLocatorV1,
  Rcv016SourceVersionMetadataV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  Rcv016CanonicalResult,
  finalizeRcv016Canonical,
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
  expectRcv016NullableNonEmptyString,
  rcv016Utf8ByteLength,
} from "./rcv016Validation";

const METADATA_KEYS = ["schema", "displayName", "observedLocators"] as const;
const LOCATOR_KEYS = ["kind", "value", "namespace"] as const;
const URL_KINDS = ["homepage_url", "profile_url"] as const;
const NAMESPACED_KINDS = ["handle", "external_identifier"] as const;
const ABSOLUTE_URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const URL_FORBIDDEN_WHITESPACE = /[\u0000-\u0020\u007f]/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareLocator(
  left: Rcv016SourceLocatorV1,
  right: Rcv016SourceLocatorV1,
): number {
  const kind = compareText(left.kind, right.kind);
  if (kind !== 0) return kind;
  if (left.namespace === null && right.namespace !== null) return -1;
  if (left.namespace !== null && right.namespace === null) return 1;
  if (left.namespace !== null && right.namespace !== null) {
    const namespace = compareText(left.namespace, right.namespace);
    if (namespace !== 0) return namespace;
  }
  return compareText(left.value, right.value);
}

function validateAbsoluteUrl(value: string, path: string): Rcv016AbsoluteUrlStringV1 {
  if (!ABSOLUTE_URL_SCHEME.test(value) || URL_FORBIDDEN_WHITESPACE.test(value)) {
    throw new Rcv016ValidationError(path, "expected an absolute URL");
  }
  try {
    new URL(value);
  } catch {
    throw new Rcv016ValidationError(path, "expected an absolute URL");
  }
  return value as Rcv016AbsoluteUrlStringV1;
}

function validateLocator(
  value: unknown,
  index: number,
  locatorCodepoints: number,
  locatorUtf8Bytes: number,
): Rcv016SourceLocatorV1 {
  const path = `sourceMetadata.observedLocators[${index}]`;
  const input = expectRcv016ExactObject(value, LOCATOR_KEYS, path);
  const kind = expectRcv016NonEmptyString(input.kind, `${path}.kind`);
  const locatorValue = expectRcv016NonEmptyString(input.value, `${path}.value`);
  assertRcv016TextLimits(
    locatorValue,
    locatorCodepoints,
    locatorUtf8Bytes,
    `${path}.value`,
    "locatorStringCodepoints",
    "locatorStringUtf8Bytes",
  );

  if ((URL_KINDS as readonly string[]).includes(kind)) {
    if (input.namespace !== null) {
      throw new Rcv016ValidationError(`${path}.namespace`, "expected JSON null");
    }
    return {
      kind: kind as (typeof URL_KINDS)[number],
      value: validateAbsoluteUrl(locatorValue, `${path}.value`),
      namespace: null,
    };
  }
  if ((NAMESPACED_KINDS as readonly string[]).includes(kind)) {
    const namespace = expectRcv016NonEmptyString(
      input.namespace,
      `${path}.namespace`,
    );
    assertRcv016TextLimits(
      namespace,
      locatorCodepoints,
      locatorUtf8Bytes,
      `${path}.namespace`,
      "locatorStringCodepoints",
      "locatorStringUtf8Bytes",
    );
    return {
      kind: kind as (typeof NAMESPACED_KINDS)[number],
      value: locatorValue as Rcv016NonEmptyStringV1,
      namespace: namespace as Rcv016NonEmptyStringV1,
    };
  }
  throw new Rcv016ValidationError(`${path}.kind`, "unknown Source Locator kind");
}

export function validateAndCanonicalizeRcv016SourceMetadata(
  value: unknown,
  rawLimits: unknown,
): Rcv016CanonicalResult<Rcv016SourceVersionMetadataV1> {
  const limits = validateRcv016PayloadLimits(rawLimits);
  const input = expectRcv016ExactObject(value, METADATA_KEYS, "sourceMetadata");
  const schema = validateRcv016SchemaIdentity(
    input.schema,
    RCV016_SOURCE_VERSION_METADATA_SCHEMA_ID,
    RCV016_SOURCE_VERSION_METADATA_SCHEMA_VERSION,
    "sourceMetadata.schema",
  );
  const displayName = expectRcv016NullableNonEmptyString(
    input.displayName,
    "sourceMetadata.displayName",
  );
  if (displayName !== null) {
    assertRcv016TextLimits(
      displayName,
      limits.displayNameCodepoints,
      limits.displayNameUtf8Bytes,
      "sourceMetadata.displayName",
      "displayNameCodepoints",
      "displayNameUtf8Bytes",
    );
  }
  const locatorInputs = expectRcv016Array(
    input.observedLocators,
    "sourceMetadata.observedLocators",
  );
  assertRcv016CountLimit(
    locatorInputs.length,
    limits.sourceLocatorCount,
    "sourceMetadata.observedLocators",
    "sourceLocatorCount",
  );
  if (displayName === null && locatorInputs.length === 0) {
    throw new Rcv016ValidationError(
      "sourceMetadata",
      "requires displayName or at least one observed Locator",
    );
  }
  const observedLocators = locatorInputs.map((locator, index) =>
    validateLocator(
      locator,
      index,
      limits.locatorStringCodepoints,
      limits.locatorStringUtf8Bytes,
    ),
  );
  observedLocators.sort(compareLocator);
  for (let index = 1; index < observedLocators.length; index += 1) {
    if (compareLocator(observedLocators[index - 1], observedLocators[index]) === 0) {
      throw new Rcv016ValidationError(
        "sourceMetadata.observedLocators",
        "exact duplicate Locator",
      );
    }
  }

  const result = finalizeRcv016Canonical({
    schema,
    displayName: displayName as Rcv016NonEmptyStringV1 | null,
    observedLocators,
  } as Rcv016SourceVersionMetadataV1);
  if (rcv016Utf8ByteLength(result.canonical) > limits.sourceMetadataCanonicalBytes) {
    throw new Rcv016PayloadLimitError(
      "sourceMetadata",
      "exceeds sourceMetadataCanonicalBytes",
    );
  }
  return result;
}
