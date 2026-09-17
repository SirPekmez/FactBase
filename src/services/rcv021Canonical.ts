import { createHash } from "node:crypto";
import { canonicalizeAndHash } from "./canonicalJson";
import { validateRcv020Timestamp, validateRcv020Uuid } from "../contracts/rcv020ObservatoryContractV1";
import { RCV021_CANONICAL_VERSION, Rcv021ValidationError, ProviderResult } from "../contracts/rcv021ActiveResearchContractV1";

export interface Rcv021CanonicalResult { readonly canonical: string; readonly hash: string; }
export const RCV021_POSTGRES_BIGINT_MAX = 9223372036854775807n;

function fail(path: string, message: string, code: "MALFORMED_DATA" | "VERSION_MISMATCH" = "MALFORMED_DATA"): never {
  throw new Rcv021ValidationError(code, path, message);
}

export function canonicalizeRcv021(value: unknown, path = "value"): Rcv021CanonicalResult {
  rejectSecrets(value, path);
  try {
    const result = canonicalizeAndHash(value);
    return Object.freeze({ canonical: result.canonical, hash: result.hash });
  } catch (error) {
    if (error instanceof Rcv021ValidationError) throw error;
    fail(path, error instanceof Error ? error.message : "canonicalization failed");
  }
}

export function sha256Rcv021Text(value: string): string {
  if (typeof value !== "string") fail("text", "expected string");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertRcv021HashMatches(canonical: string, supplied: unknown, path = "canonicalHash"): string {
  if (typeof supplied !== "string" || !/^[0-9a-f]{64}$/.test(supplied)) fail(path, "expected lowercase SHA-256 hash");
  const expected = sha256Rcv021Text(canonical);
  if (expected !== supplied) throw new Rcv021ValidationError("HASH_MISMATCH", path, "does not match canonical UTF-8 bytes");
  return supplied;
}

export function validateRcv021BigInt(value: unknown, path = "integer"): bigint {
  if (typeof value === "bigint") { if (value < 1n || value > RCV021_POSTGRES_BIGINT_MAX) fail(path, "expected PostgreSQL BIGINT range >= 1"); return value; }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail(path, "expected exact decimal string or bigint");
  try { const parsed = BigInt(value); if (parsed < 1n || parsed > RCV021_POSTGRES_BIGINT_MAX) fail(path, "expected PostgreSQL BIGINT range >= 1"); return parsed; } catch { fail(path, "invalid decimal integer"); }
}

export function validateRcv021NonNegativeBigInt(value: unknown, path = "integer"): bigint {
  if (typeof value === "bigint") { if (value < 0n || value > RCV021_POSTGRES_BIGINT_MAX) fail(path, "expected PostgreSQL BIGINT range >= 0"); return value; }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail(path, "expected exact decimal string or bigint");
  try { const parsed = BigInt(value); if (parsed < 0n || parsed > RCV021_POSTGRES_BIGINT_MAX) fail(path, "expected PostgreSQL BIGINT range >= 0"); return parsed; } catch { fail(path, "invalid decimal integer"); }
}

export function canonicalRcv021BigInt(value: unknown, path = "integer"): string { return validateRcv021BigInt(value, path).toString(10); }
export function canonicalRcv021NonNegativeBigInt(value: unknown, path = "integer"): string { return validateRcv021NonNegativeBigInt(value, path).toString(10); }

export function validateRcv021Uuid(value: unknown, path = "id"): string { try { return validateRcv020Uuid(value, path); } catch { throw new Rcv021ValidationError("MALFORMED_DATA", path, "expected lowercase canonical UUID"); } }
export function validateRcv021Timestamp(value: unknown, path = "timestamp"): string { try { return validateRcv020Timestamp(value, path); } catch { throw new Rcv021ValidationError("MALFORMED_DATA", path, "expected canonical UTC timestamp"); } }
export function validateRcv021Version(value: unknown, path = "canonicalVersion"): 1 { if (value !== RCV021_CANONICAL_VERSION) throw new Rcv021ValidationError("VERSION_MISMATCH", path, "unsupported RCV-021 canonical version"); return 1; }

const SECRET_KEY = /(?:secret|token|password|api[-_]?key|credential[-_]?value|private[-_]?credential)/i;
function rejectSecrets(value: unknown, path: string, seen: object[] = []): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Canonical JSON fields are carried as strings by the authority types.
    // Inspect a nested JSON envelope when present so secret keys cannot hide
    // inside an otherwise opaque canonical field. Invalid/non-JSON strings
    // retain their existing validation behavior.
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { rejectSecrets(JSON.parse(value) as unknown, path, seen); } catch (error) { if (error instanceof Rcv021ValidationError) throw error; }
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.includes(value)) fail(path, "canonical value must not contain cycles");
  seen.push(value);
  if (Array.isArray(value)) value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`, seen));
  else Object.entries(value).forEach(([key, item]) => { if (SECRET_KEY.test(key)) fail(`${path}.${key}`, "plaintext secrets are not semantic authority"); rejectSecrets(item, `${path}.${key}`, seen); });
  seen.pop();
}
export function canonicalizeRcv021Authority(value: unknown, path = "authority"): Rcv021CanonicalResult { rejectSecrets(value, path); return canonicalizeRcv021(value, path); }

function canonicalElement(value: unknown, path: string): string { return canonicalizeRcv021(value, path).canonical; }
export function canonicalizeUnorderedCollection(values: ReadonlyArray<unknown>, path = "collection"): Rcv021CanonicalResult {
  const elements = values.map((value, index) => canonicalElement(value, `${path}[${index}]`));
  elements.sort((a, b) => Buffer.from(a, "utf8").compare(Buffer.from(b, "utf8")));
  return canonicalizeRcv021(elements, path);
}
export function canonicalizeOrderedCollection(values: ReadonlyArray<unknown>, path = "collection"): Rcv021CanonicalResult {
  return canonicalizeRcv021(values.map((value, index) => JSON.parse(canonicalElement(value, `${path}[${index}]`))), path);
}

export function deriveProviderResultManifest(results: ReadonlyArray<ProviderResult>): Rcv021CanonicalResult & { readonly count: string } {
  const members = results.map((result, index) => {
    validateRcv021Uuid(result.resultId, `results[${index}].resultId`);
    if (typeof result.canonicalHash !== "string" || !/^[0-9a-f]{64}$/.test(result.canonicalHash)) fail(`results[${index}].canonicalHash`, "expected SHA-256 hash");
    return { resultId: result.resultId, resultHash: result.canonicalHash };
  });
  members.sort((a, b) => a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : a.resultHash < b.resultHash ? -1 : a.resultHash > b.resultHash ? 1 : 0);
  const canonical = canonicalizeRcv021(members, "resultManifest");
  return Object.freeze({ ...canonical, count: String(members.length) });
}
