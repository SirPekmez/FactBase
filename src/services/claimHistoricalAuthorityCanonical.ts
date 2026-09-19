import {
  canonicalizeAndHash,
  CanonicalJsonResult,
} from "./canonicalJson";

export const CLAIM_IDENTITY_AUTHORITY_SCHEMA =
  "factbase-claim-identity-authority" as const;
export const CLAIM_VERSION_AUTHORITY_SCHEMA =
  "factbase-claim-version-authority" as const;
export const CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION = 1 as const;

export interface ClaimIdentityCanonicalInput {
  claimId: string;
}

export interface ClaimVersionCanonicalInput {
  claimId: string;
  claimVersionId: string;
  versionNumber: number;
  title: string;
  normalizedStatement: string;
  language: string;
  claimType: string;
}

export interface ClaimIdentityCanonicalObject {
  schema: typeof CLAIM_IDENTITY_AUTHORITY_SCHEMA;
  canonicalVersion: typeof CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION;
  claimId: string;
}

export interface ClaimVersionCanonicalObject {
  schema: typeof CLAIM_VERSION_AUTHORITY_SCHEMA;
  canonicalVersion: typeof CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION;
  claimId: string;
  claimVersionId: string;
  versionNumber: number;
  title: string;
  normalizedStatement: string;
  language: string;
  claimType: string;
}

export interface ClaimIdentityCanonicalResult extends CanonicalJsonResult {
  object: ClaimIdentityCanonicalObject;
}

export interface ClaimVersionCanonicalResult extends CanonicalJsonResult {
  object: ClaimVersionCanonicalObject;
}

function assertString(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
}

function assertPositiveInteger(name: string, value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

export function buildClaimIdentityCanonical(
  input: ClaimIdentityCanonicalInput,
): ClaimIdentityCanonicalResult {
  assertString("claimId", input.claimId);
  const object: ClaimIdentityCanonicalObject = {
    schema: CLAIM_IDENTITY_AUTHORITY_SCHEMA,
    canonicalVersion: CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION,
    claimId: input.claimId,
  };
  const result = canonicalizeAndHash(object);
  return { object, ...result };
}

export function buildClaimVersionCanonical(
  input: ClaimVersionCanonicalInput,
): ClaimVersionCanonicalResult {
  assertString("claimId", input.claimId);
  assertString("claimVersionId", input.claimVersionId);
  assertPositiveInteger("versionNumber", input.versionNumber);
  assertString("title", input.title);
  assertString("normalizedStatement", input.normalizedStatement);
  assertString("language", input.language);
  assertString("claimType", input.claimType);

  const object: ClaimVersionCanonicalObject = {
    schema: CLAIM_VERSION_AUTHORITY_SCHEMA,
    canonicalVersion: CLAIM_HISTORICAL_AUTHORITY_CANONICAL_VERSION,
    claimId: input.claimId,
    claimVersionId: input.claimVersionId,
    versionNumber: input.versionNumber,
    title: input.title,
    normalizedStatement: input.normalizedStatement,
    language: input.language,
    claimType: input.claimType,
  };
  const result = canonicalizeAndHash(object);
  return { object, ...result };
}
