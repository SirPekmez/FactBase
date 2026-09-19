const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const readerSource = fs.readFileSync(
  "src/services/claimHistoricalAuthorityReader.ts",
  "utf8",
);

test("Wave C failure taxonomy is closed and deterministic", () => {
  const { CLAIM_HISTORICAL_AUTHORITY_FAILURE_CODES } = require(
    "../dist/services/claimHistoricalAuthorityReader",
  );
  assert.deepEqual(CLAIM_HISTORICAL_AUTHORITY_FAILURE_CODES, [
    "MISSING_SOURCE_CLAIM",
    "MISSING_SOURCE_CLAIMVERSION",
    "UNAUTHENTICATED_LEGACY_CLAIM",
    "UNAUTHENTICATED_LEGACY_CLAIMVERSION",
    "MISSING_CLAIM_AUTHORITY",
    "MISSING_CLAIMVERSION_AUTHORITY",
    "UNSUPPORTED_CLAIM_CANONICAL_VERSION",
    "UNSUPPORTED_CLAIMVERSION_CANONICAL_VERSION",
    "MALFORMED_CLAIM_AUTHORITY",
    "MALFORMED_CLAIMVERSION_AUTHORITY",
    "CLAIM_IDENTITY_MISMATCH",
    "CLAIMVERSION_IDENTITY_MISMATCH",
    "PARENT_CLAIM_MISMATCH",
    "VERSION_NUMBER_MISMATCH",
    "SOURCE_PARITY_MISMATCH",
    "CANONICAL_MISMATCH",
    "HASH_MISMATCH",
    "DUPLICATE_AUTHORITY",
  ]);
});

test("Wave C Reader is independent and SELECT-only", () => {
  assert.doesNotMatch(readerSource, /claimHistoricalAuthorityWriter/);
  assert.doesNotMatch(readerSource, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|LOCK)\b/);
  assert.doesNotMatch(readerSource, /FOR\s+(?:UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)/);
  assert.doesNotMatch(readerSource, /BEGIN|COMMIT|ROLLBACK|TEMP TABLE|advisory/i);
  assert.ok((readerSource.match(/\bSELECT\b/g) ?? []).length >= 4);
});

test("Wave C Reader independently verifies exact Claim and ClaimVersion rows", async () => {
  const canonical = require("../dist/services/claimHistoricalAuthorityCanonical");
  const reader = require("../dist/services/claimHistoricalAuthorityReader");
  const claimId = "11111111-1111-4111-8111-111111111111";
  const versionId = "22222222-2222-4222-8222-222222222222";
  const claim = canonical.buildClaimIdentityCanonical({ claimId });
  const version = canonical.buildClaimVersionCanonical({
    claimId,
    claimVersionId: versionId,
    versionNumber: 1,
    title: "exact title",
    normalizedStatement: "exact statement",
    language: "en",
    claimType: "fact",
  });
  const client = {
    async query(sql) {
      if (sql.includes("FROM public.claims")) return { rows: [{ id: claimId }] };
      if (sql.includes("FROM public.claim_identity_authorities")) {
        return { rows: [{ claim_id: claimId, canonical_version: 1, canonical: claim.canonical, canonical_hash: claim.hash }] };
      }
      if (sql.includes("FROM public.claim_versions")) {
        return { rows: [{ id: versionId, claim_id: claimId, version_number: 1, title: "exact title", normalized_statement: "exact statement", language: "en", claim_type: "fact" }] };
      }
      if (sql.includes("FROM public.claim_version_authorities")) {
        return { rows: [{ claim_version_id: versionId, claim_id: claimId, version_number: 1, title: "exact title", normalized_statement: "exact statement", language: "en", claim_type: "fact", canonical_version: 1, canonical: version.canonical, canonical_hash: version.hash }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  assert.deepEqual(await reader.verifyClaimIdentityAuthorityWithinClient(client, claimId), {
    verified: true,
    claimId,
    canonicalVersion: 1,
    canonicalHash: claim.hash,
  });
  assert.deepEqual(await reader.verifyClaimVersionAuthorityWithinClient(client, versionId), {
    verified: true,
    claimId,
    claimVersionId: versionId,
    versionNumber: 1,
    canonicalVersion: 1,
    canonicalHash: version.hash,
  });
});

test("Wave C Reader fails closed on canonical and hash corruption without writes", async () => {
  const canonical = require("../dist/services/claimHistoricalAuthorityCanonical");
  const reader = require("../dist/services/claimHistoricalAuthorityReader");
  const claimId = "33333333-3333-4333-8333-333333333333";
  const claim = canonical.buildClaimIdentityCanonical({ claimId });
  const makeClient = (canonicalValue, hashValue) => ({
    async query(sql) {
      if (sql.includes("FROM public.claims")) return { rows: [{ id: claimId }] };
      if (sql.includes("FROM public.claim_identity_authorities")) {
        return { rows: [{ claim_id: claimId, canonical_version: 1, canonical: canonicalValue, canonical_hash: hashValue }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  });
  await assert.rejects(
    () => reader.verifyClaimIdentityAuthorityWithinClient(makeClient("{", claim.hash), claimId),
    (error) => error.code === "MALFORMED_CLAIM_AUTHORITY",
  );
  await assert.rejects(
    () => reader.verifyClaimIdentityAuthorityWithinClient(makeClient(claim.canonical, "a".repeat(64)), claimId),
    (error) => error.code === "HASH_MISMATCH",
  );
});
