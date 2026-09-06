import {
  canonicalizeAndHash,
  sha256,
} from "./canonicalJson";
import {
  Rcv018ValidationError,
  Sha256HexV1,
  validateSha256HexV1,
} from "../contracts/rcv018EvidenceContradictionContractV1";

export interface Rcv018CanonicalResult<T> {
  readonly value: Readonly<T>;
  readonly canonical: string;
  readonly hash: Sha256HexV1;
}

export interface Rcv018CanonicalBytesResult {
  readonly canonical: string;
  readonly hash: Sha256HexV1;
}

/** Pure RFC-8785/JCS + exact UTF-8 SHA-256 computation. */
export function canonicalizeRcv018(value: unknown): Rcv018CanonicalBytesResult {
  try {
    const result = canonicalizeAndHash(value);
    return Object.freeze({ canonical: result.canonical, hash: validateSha256HexV1(result.hash, "hash") });
  } catch (error) {
    if (error instanceof Rcv018ValidationError) throw error;
    throw new Rcv018ValidationError("$", error instanceof Error ? error.message : "canonicalization failed");
  }
}

export function finalizeRcv018Canonical<T>(value: T): Rcv018CanonicalResult<T> {
  const result = canonicalizeRcv018(value);
  return Object.freeze({ value: Object.freeze(value) as Readonly<T>, canonical: result.canonical, hash: result.hash });
}

export function sha256Rcv018Text(value: string): Sha256HexV1 {
  if (typeof value !== "string") throw new Rcv018ValidationError("text", "expected a string");
  return validateSha256HexV1(sha256(value), "hash");
}

export function assertRcv018TextHash(text: string, suppliedHash: unknown, path = "hash"): Sha256HexV1 {
  const hashValue = validateSha256HexV1(suppliedHash, path);
  if (sha256Rcv018Text(text) !== hashValue) throw new Rcv018ValidationError(path, "does not match exact UTF-8 text bytes");
  return hashValue;
}
