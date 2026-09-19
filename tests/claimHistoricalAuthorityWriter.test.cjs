const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const writerSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "services", "claimHistoricalAuthorityWriter.ts"),
  "utf8",
);

for (const functionName of [
  "persistClaimIdentityAuthorityWithinTransaction",
  "persistClaimVersionAuthorityWithinTransaction",
  "requireClaimIdentityAuthorityWithinTransaction",
]) {
  test(`${functionName} is transaction-neutral`, () => {
    const start = writerSource.indexOf(`export async function ${functionName}`);
    assert.notEqual(start, -1);
    const next = writerSource.indexOf("export ", start + 10);
    const body = writerSource.slice(start, next === -1 ? undefined : next);
    assert.doesNotMatch(body, /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/);
  });
}
