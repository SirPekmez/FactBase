import { createHash } from "node:crypto";
import { canonicalizeAndHash } from "./canonicalJson";
import {
  RCV020_CANONICAL_VERSION,
  RCV020_REQUEST_CANONICAL_VERSION,
  Rcv020Hash,
  Rcv020MonitorConfigurationVersion,
  Rcv020RequestQuery,
  Rcv020ValidationError,
  validateRcv020Hash,
  validateRcv020Timestamp,
  validateRcv020Uuid,
} from "../contracts/rcv020ObservatoryContractV1";

export interface Rcv020CanonicalResult {
  readonly canonical: string;
  readonly hash: Rcv020Hash;
}

function fail(path: string, message: string): never {
  throw new Rcv020ValidationError(path, message);
}

export function canonicalizeRcv020(value: unknown, path = "value"): Rcv020CanonicalResult {
  try {
    const result = canonicalizeAndHash(value);
    return Object.freeze({ canonical: result.canonical, hash: validateRcv020Hash(result.hash, `${path}.hash`) });
  } catch (error) {
    if (error instanceof Rcv020ValidationError) throw error;
    fail(path, error instanceof Error ? error.message : "canonicalization failed");
  }
}

export function sha256Rcv020Text(value: string): Rcv020Hash {
  if (typeof value !== "string") fail("text", "expected string");
  return createHash("sha256").update(value, "utf8").digest("hex") as Rcv020Hash;
}

/** Accept only exact decimal text or bigint; Number is intentionally rejected. */
export function validateRcv020BigInt(value: unknown, path = "integer"): bigint {
  if (typeof value === "bigint") {
    if (value < 1n) fail(path, "expected integer >= 1");
    return value;
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail(path, "expected exact decimal string or bigint");
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 1n) fail(path, "expected integer >= 1");
    return parsed;
  } catch {
    fail(path, "invalid decimal integer");
  }
}

export function canonicalBigInt(value: unknown, path = "integer"): string {
  return validateRcv020BigInt(value, path).toString(10);
}

export function validateRcv020NonNegativeBigInt(value: unknown, path = "integer"): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) fail(path, "expected integer >= 0");
    return value;
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail(path, "expected exact decimal string or bigint");
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) fail(path, "expected integer >= 0");
    return parsed;
  } catch {
    fail(path, "invalid decimal integer");
  }
}

const SECRET_KEY = /(?:secret|token|password|authorization|api[-_]?key|credential[-_]?value)/i;

function assertNoSecrets(value: unknown, path: string, seen: object[] = []): void {
  if (value === null || typeof value !== "object") return;
  if (seen.includes(value)) fail(path, "request/query must not contain cycles");
  seen.push(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) fail(`${path}.${key}`, "secrets/tokens are not canonical request authority");
      assertNoSecrets(item, `${path}.${key}`, seen);
    }
  }
  seen.pop();
}

export function canonicalizeRcv020Request(request: Rcv020RequestQuery): Rcv020CanonicalResult {
  if (request === null || typeof request !== "object" || Array.isArray(request)) fail("request", "expected object");
  if (typeof request.method !== "string" || request.method.length === 0) fail("request.method", "expected non-empty method");
  if (typeof request.target !== "string" || request.target.length === 0) fail("request.target", "expected non-empty target");
  if (request.parameters === null || typeof request.parameters !== "object" || Array.isArray(request.parameters)) fail("request.parameters", "expected object");
  if (request.credentialReference !== null && typeof request.credentialReference !== "string") fail("request.credentialReference", "expected string or explicit null");
  assertNoSecrets(request, "request");
  return canonicalizeRcv020({ schema: RCV020_REQUEST_CANONICAL_VERSION, method: request.method, target: request.target, parameters: request.parameters, credentialReference: request.credentialReference }, "request");
}

export function canonicalizeRcv020MonitorConfiguration(config: Rcv020MonitorConfigurationVersion): Rcv020CanonicalResult {
  validateRcv020Uuid(config.monitorConfigurationVersionId, "monitorConfigurationVersionId");
  validateRcv020Uuid(config.monitorId, "monitorId");
  const versionNumber = canonicalBigInt(config.versionNumber, "versionNumber");
  const endpoint = canonicalizeRcv020Request(config.endpointRequest);
  validateRcv020Timestamp(config.effectiveFrom, "effectiveFrom");
  if (config.effectiveUntil !== undefined && config.effectiveUntil !== null) validateRcv020Timestamp(config.effectiveUntil, "effectiveUntil");
  if (config.effectiveUntil !== undefined && config.effectiveUntil !== null && config.effectiveFrom >= config.effectiveUntil) fail("effectiveUntil", "must be later than effectiveFrom");
  if (typeof config.retrievalMethod !== "string" || config.retrievalMethod.length === 0) fail("retrievalMethod", "expected non-empty text");
  if (typeof config.triggerEligibility !== "string" || config.triggerEligibility.length === 0) fail("triggerEligibility", "expected non-empty text");
  if (config.expectedMediaConstraints === null || typeof config.expectedMediaConstraints !== "object" || Array.isArray(config.expectedMediaConstraints)) fail("expectedMediaConstraints", "expected object");
  if (config.scope === null || typeof config.scope !== "object" || Array.isArray(config.scope)) fail("scope", "expected object");
  if (config.safetyPolicy === null || typeof config.safetyPolicy !== "object" || Array.isArray(config.safetyPolicy)) fail("safetyPolicy", "expected object");
  if (typeof config.adapterId !== "string" || config.adapterId.length === 0 || typeof config.adapterVersion !== "string" || config.adapterVersion.length === 0) fail("adapter", "adapter identity/version is required");
  if (!["PERMANENT_RAW", "TEMPORARY_RAW", "METADATA_HASH_ONLY"].includes(config.retentionPolicy)) fail("retentionPolicy", "unsupported retention policy");
  if (!Number.isInteger(config.retentionPolicyVersion) || config.retentionPolicyVersion < 1) fail("retentionPolicyVersion", "expected positive version");
  const value = {
    schema: RCV020_CANONICAL_VERSION,
    monitorConfigurationVersionId: config.monitorConfigurationVersionId,
    monitorId: config.monitorId,
    versionNumber,
    endpointRequest: JSON.parse(endpoint.canonical) as unknown,
    retrievalMethod: config.retrievalMethod,
    authenticationReference: config.authenticationReference ?? null,
    expectedMediaConstraints: config.expectedMediaConstraints,
    triggerEligibility: config.triggerEligibility,
    scope: config.scope,
    safetyPolicy: config.safetyPolicy,
    adapterId: config.adapterId,
    adapterVersion: config.adapterVersion,
    parserId: config.parserId ?? null,
    parserVersion: config.parserVersion ?? null,
    retentionPolicy: config.retentionPolicy,
    retentionPolicyVersion: config.retentionPolicyVersion,
    effectiveFrom: config.effectiveFrom,
    effectiveUntil: config.effectiveUntil ?? null,
  };
  return canonicalizeRcv020(value, "monitorConfigurationVersion");
}

export function assertRcv020HashMatches(value: string, suppliedHash: unknown, path = "hash"): Rcv020Hash {
  const expected = sha256Rcv020Text(value);
  const actual = validateRcv020Hash(suppliedHash, path);
  if (expected !== actual) fail(path, "does not match canonical UTF-8 bytes");
  return actual;
}
