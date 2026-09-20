const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Wave B transaction-neutral writer source has no transaction ownership", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "rcv022Writer.ts"), "utf8");
  assert.doesNotMatch(source, /client\.query\(\s*["'`]\s*(BEGIN|COMMIT|ROLLBACK)\b/);
  assert.doesNotMatch(source, /\.release\s*\(/);
  assert.match(source, /persistRcv022BundleWithinTransaction/);
});
