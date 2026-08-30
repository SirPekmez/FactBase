import {
  Rcv016CanonicalTimestampV1,
  Rcv016CanonicalUuidV1,
  Rcv016Sha256HexV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  canonicalizeAndHash,
  sha256,
  validateCanonicalTimestamp,
} from "./canonicalJson";
import {
  Rcv016CanonicalizationError,
  Rcv016HashIntegrityError,
  Rcv016UnsupportedContractVersionError,
  Rcv016ValidationError,
  expectRcv016ExactObject,
  expectRcv016String,
  freezeRcv016,
} from "./rcv016Validation";

export {
  RCV016_TECHNICAL_ERROR_CODES,
  Rcv016CanonicalizationError,
  Rcv016HashIntegrityError,
  Rcv016PayloadLimitError,
  Rcv016TechnicalError,
  Rcv016TechnicalErrorCode,
  Rcv016UnsupportedContractVersionError,
  Rcv016ValidationError,
} from "./rcv016Validation";

export interface Rcv016CanonicalResult<T> {
  readonly value: Readonly<T>;
  readonly canonical: string;
  readonly hash: Rcv016Sha256HexV1;
}

export interface Rcv016CanonicalBytesResult {
  readonly canonical: string;
  readonly hash: Rcv016Sha256HexV1;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function canonicalizeRcv016(value: unknown): Rcv016CanonicalBytesResult {
  try {
    return freezeRcv016(canonicalizeAndHash(value)) as Rcv016CanonicalBytesResult;
  } catch (error) {
    if (error instanceof Rcv016CanonicalizationError) throw error;
    throw new Rcv016CanonicalizationError(
      "$",
      error instanceof Error ? error.message : "canonicalization failed",
    );
  }
}

export function finalizeRcv016Canonical<T>(
  value: T,
): Rcv016CanonicalResult<T> {
  const frozenValue = freezeRcv016(value);
  const canonical = canonicalizeRcv016(frozenValue);
  return freezeRcv016({
    value: frozenValue,
    canonical: canonical.canonical,
    hash: canonical.hash,
  });
}

export function sha256Rcv016Text(value: string): Rcv016Sha256HexV1 {
  if (typeof value !== "string") {
    throw new Rcv016ValidationError("text", "expected a string");
  }
  return sha256(value) as Rcv016Sha256HexV1;
}

export function validateRcv016CanonicalUuid(
  value: unknown,
  path: string,
): Rcv016CanonicalUuidV1 {
  const text = expectRcv016String(value, path);
  if (!UUID_PATTERN.test(text)) {
    throw new Rcv016ValidationError(path, "expected a lowercase canonical UUID");
  }
  return text as Rcv016CanonicalUuidV1;
}

export function validateRcv016CanonicalTimestamp(
  value: unknown,
  path: string,
): Rcv016CanonicalTimestampV1 {
  try {
    return validateCanonicalTimestamp(value) as Rcv016CanonicalTimestampV1;
  } catch {
    throw new Rcv016ValidationError(
      path,
      "expected YYYY-MM-DDTHH:mm:ss.ffffffZ",
    );
  }
}

export function validateRcv016Sha256Hex(
  value: unknown,
  path: string,
): Rcv016Sha256HexV1 {
  const text = expectRcv016String(value, path);
  if (!SHA256_PATTERN.test(text)) {
    throw new Rcv016ValidationError(path, "expected 64 lowercase hexadecimal characters");
  }
  return text as Rcv016Sha256HexV1;
}

export function assertRcv016TextHash(
  text: string,
  suppliedHash: unknown,
  path: string,
): Rcv016Sha256HexV1 {
  const hash = validateRcv016Sha256Hex(suppliedHash, path);
  if (sha256Rcv016Text(text) !== hash) {
    throw new Rcv016HashIntegrityError(path, "does not match the UTF-8 text bytes");
  }
  return hash;
}

export function validateRcv016SchemaIdentity<
  Id extends string,
  Version extends string,
>(
  value: unknown,
  expectedId: Id,
  expectedVersion: Version,
  path: string,
): Readonly<{ id: Id; version: Version }> {
  const schema = expectRcv016ExactObject(value, ["id", "version"], path);
  const id = expectRcv016String(schema.id, `${path}.id`);
  const version = expectRcv016String(schema.version, `${path}.version`);
  if (id !== expectedId || version !== expectedVersion) {
    throw new Rcv016UnsupportedContractVersionError(
      path,
      `expected ${expectedId}/${expectedVersion}`,
    );
  }
  return freezeRcv016({ id: expectedId, version: expectedVersion });
}
