import {
  RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_ID,
  RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_VERSION,
  RCV016_HASH_ALGORITHM,
  Rcv016ArtifactVersionCaptureV1,
  Rcv016MediaTypeV1,
  Rcv016NonEmptyStringV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  Rcv016CanonicalResult,
  finalizeRcv016Canonical,
  validateRcv016CanonicalTimestamp,
  validateRcv016SchemaIdentity,
  validateRcv016Sha256Hex,
} from "./rcv016Canonical";
import { validateRcv016PayloadLimits } from "./rcv016PayloadLimits";
import {
  Rcv016PayloadLimitError,
  Rcv016ValidationError,
  assertRcv016TextLimits,
  expectRcv016ExactObject,
  expectRcv016NonEmptyString,
  expectRcv016NullableNonEmptyString,
  rcv016Utf8ByteLength,
} from "./rcv016Validation";

const CAPTURE_KEYS = [
  "schema",
  "locator",
  "mediaType",
  "title",
  "publishedAt",
  "observedAt",
  "retrievedAt",
  "representation",
] as const;
const REPRESENTATION_KEYS = ["kind", "hashAlgorithm", "contentHash"] as const;
const MEDIA_TYPE_PATTERN =
  /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/;

function nullableTimestamp(value: unknown, path: string) {
  return value === null ? null : validateRcv016CanonicalTimestamp(value, path);
}

function validateMediaType(value: unknown): Rcv016MediaTypeV1 | null {
  const text = expectRcv016NullableNonEmptyString(value, "artifactCapture.mediaType");
  if (text !== null && !MEDIA_TYPE_PATTERN.test(text)) {
    throw new Rcv016ValidationError(
      "artifactCapture.mediaType",
      "expected a lowercase ASCII Media Type without parameters",
    );
  }
  return text as Rcv016MediaTypeV1 | null;
}

export function validateAndCanonicalizeRcv016ArtifactCapture(
  value: unknown,
  rawLimits: unknown,
): Rcv016CanonicalResult<Rcv016ArtifactVersionCaptureV1> {
  const limits = validateRcv016PayloadLimits(rawLimits);
  const input = expectRcv016ExactObject(value, CAPTURE_KEYS, "artifactCapture");
  const schema = validateRcv016SchemaIdentity(
    input.schema,
    RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_ID,
    RCV016_ARTIFACT_VERSION_CAPTURE_SCHEMA_VERSION,
    "artifactCapture.schema",
  );
  const locator = expectRcv016NullableNonEmptyString(
    input.locator,
    "artifactCapture.locator",
  );
  const mediaType = validateMediaType(input.mediaType);
  const title = expectRcv016NullableNonEmptyString(
    input.title,
    "artifactCapture.title",
  );
  if (locator !== null) {
    assertRcv016TextLimits(
      locator,
      limits.artifactLocatorCodepoints,
      limits.artifactLocatorUtf8Bytes,
      "artifactCapture.locator",
      "artifactLocatorCodepoints",
      "artifactLocatorUtf8Bytes",
    );
  }
  if (mediaType !== null) {
    assertRcv016TextLimits(
      mediaType,
      limits.mediaTypeCodepoints,
      limits.mediaTypeUtf8Bytes,
      "artifactCapture.mediaType",
      "mediaTypeCodepoints",
      "mediaTypeUtf8Bytes",
    );
  }
  if (title !== null) {
    assertRcv016TextLimits(
      title,
      limits.titleCodepoints,
      limits.titleUtf8Bytes,
      "artifactCapture.title",
      "titleCodepoints",
      "titleUtf8Bytes",
    );
  }
  const publishedAt = nullableTimestamp(
    input.publishedAt,
    "artifactCapture.publishedAt",
  );
  const observedAt = validateRcv016CanonicalTimestamp(
    input.observedAt,
    "artifactCapture.observedAt",
  );
  const representationInput = expectRcv016ExactObject(
    input.representation,
    REPRESENTATION_KEYS,
    "artifactCapture.representation",
  );
  const kind = expectRcv016NonEmptyString(
    representationInput.kind,
    "artifactCapture.representation.kind",
  );

  let capture: Rcv016ArtifactVersionCaptureV1;
  if (kind === "captured_bytes") {
    const retrievedAt = validateRcv016CanonicalTimestamp(
      input.retrievedAt,
      "artifactCapture.retrievedAt",
    );
    if (representationInput.hashAlgorithm !== RCV016_HASH_ALGORITHM) {
      throw new Rcv016ValidationError(
        "artifactCapture.representation.hashAlgorithm",
        `expected ${RCV016_HASH_ALGORITHM}`,
      );
    }
    const contentHash = validateRcv016Sha256Hex(
      representationInput.contentHash,
      "artifactCapture.representation.contentHash",
    );
    capture = {
      schema,
      locator: locator as Rcv016NonEmptyStringV1 | null,
      mediaType,
      title: title as Rcv016NonEmptyStringV1 | null,
      publishedAt,
      observedAt,
      retrievedAt,
      representation: {
        kind: "captured_bytes",
        hashAlgorithm: RCV016_HASH_ALGORITHM,
        contentHash,
      },
    };
  } else if (kind === "metadata_only") {
    const retrievedAt = nullableTimestamp(
      input.retrievedAt,
      "artifactCapture.retrievedAt",
    );
    if (
      representationInput.hashAlgorithm !== null ||
      representationInput.contentHash !== null
    ) {
      throw new Rcv016ValidationError(
        "artifactCapture.representation",
        "metadata_only requires null hashAlgorithm and contentHash",
      );
    }
    capture = {
      schema,
      locator: locator as Rcv016NonEmptyStringV1 | null,
      mediaType,
      title: title as Rcv016NonEmptyStringV1 | null,
      publishedAt,
      observedAt,
      retrievedAt,
      representation: {
        kind: "metadata_only",
        hashAlgorithm: null,
        contentHash: null,
      },
    };
  } else {
    throw new Rcv016ValidationError(
      "artifactCapture.representation.kind",
      "unknown Capture representation",
    );
  }

  const result = finalizeRcv016Canonical(capture);
  if (rcv016Utf8ByteLength(result.canonical) > limits.artifactCaptureCanonicalBytes) {
    throw new Rcv016PayloadLimitError(
      "artifactCapture",
      "exceeds artifactCaptureCanonicalBytes",
    );
  }
  return result;
}
