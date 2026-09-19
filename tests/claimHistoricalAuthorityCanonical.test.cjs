const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  buildClaimIdentityCanonical,
  buildClaimVersionCanonical,
} = require("../dist/services/claimHistoricalAuthorityCanonical");

const CLAIM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

function independentHash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("Claim canonical authority is exactly three keys with an independent golden vector", () => {
  const result = buildClaimIdentityCanonical({ claimId: CLAIM_ID });
  assert.deepEqual(Object.keys(result.object), ["schema", "canonicalVersion", "claimId"]);
  assert.deepEqual(Object.keys(JSON.parse(result.canonical)).sort(), [
    "canonicalVersion",
    "claimId",
    "schema",
  ]);
  assert.equal(
    result.canonical,
    '{"canonicalVersion":1,"claimId":"11111111-1111-4111-8111-111111111111","schema":"factbase-claim-identity-authority"}',
  );
  assert.equal(
    result.hash,
    "d1dddce23890e171d53195a57e283d1e0674e808fa3e97067856045397df0903",
  );
  assert.equal(result.hash, independentHash(result.canonical));
});

test("ClaimVersion canonical authority is exactly nine keys with exact strings", () => {
  const result = buildClaimVersionCanonical({
    claimId: CLAIM_ID,
    claimVersionId: VERSION_ID,
    versionNumber: 1,
    title: "Titre é",
    normalizedStatement: "  exact  ",
    language: "fr",
    claimType: "fact",
  });
  assert.deepEqual(Object.keys(result.object), [
    "schema",
    "canonicalVersion",
    "claimId",
    "claimVersionId",
    "versionNumber",
    "title",
    "normalizedStatement",
    "language",
    "claimType",
  ]);
  assert.deepEqual(Object.keys(JSON.parse(result.canonical)).sort(), [
    "canonicalVersion",
    "claimId",
    "claimType",
    "claimVersionId",
    "language",
    "normalizedStatement",
    "schema",
    "title",
    "versionNumber",
  ]);
  assert.equal(
    result.canonical,
    '{"canonicalVersion":1,"claimId":"11111111-1111-4111-8111-111111111111","claimType":"fact","claimVersionId":"22222222-2222-4222-8222-222222222222","language":"fr","normalizedStatement":"  exact  ","schema":"factbase-claim-version-authority","title":"Titre é","versionNumber":1}',
  );
  assert.equal(
    result.hash,
    "34d3ec6545c6cd5f8eae5e97260d4982bef88fb2105ec2453d04ec260ae9da23",
  );
  assert.equal(result.hash, independentHash(result.canonical));
});

test("canonical builders preserve empty strings, whitespace, case, and Unicode representation", () => {
  const exact = buildClaimVersionCanonical({
    claimId: CLAIM_ID,
    claimVersionId: VERSION_ID,
    versionNumber: 7,
    title: "  Mixed Case  ",
    normalizedStatement: "e\u0301",
    language: "EN",
    claimType: "Fact",
  });
  const composed = buildClaimVersionCanonical({
    claimId: CLAIM_ID,
    claimVersionId: VERSION_ID,
    versionNumber: 7,
    title: "  Mixed Case  ",
    normalizedStatement: "é",
    language: "EN",
    claimType: "Fact",
  });
  const empty = buildClaimVersionCanonical({
    claimId: CLAIM_ID,
    claimVersionId: VERSION_ID,
    versionNumber: 7,
    title: "",
    normalizedStatement: "",
    language: "",
    claimType: "",
  });
  assert.match(exact.canonical, /"title":"  Mixed Case  "/);
  assert.match(exact.canonical, /"language":"EN"/);
  assert.notEqual(exact.hash, composed.hash);
  assert.match(empty.canonical, /"title":""/);
  assert.match(empty.canonical, /"normalizedStatement":""/);
});

test("Claim and ClaimVersion schemas are domain-separated and invalid versions fail closed", () => {
  const claim = buildClaimIdentityCanonical({ claimId: CLAIM_ID });
  const version = buildClaimVersionCanonical({
    claimId: CLAIM_ID,
    claimVersionId: VERSION_ID,
    versionNumber: 1,
    title: "title",
    normalizedStatement: "statement",
    language: "en",
    claimType: "fact",
  });
  assert.notEqual(claim.hash, version.hash);
  assert.throws(
    () => buildClaimVersionCanonical({ ...JSON.parse(JSON.stringify(version.object)), versionNumber: 0 }),
    /positive safe integer/,
  );
  assert.throws(
    () => buildClaimIdentityCanonical({ claimId: 42 }),
    /claimId must be a string/,
  );
});
