const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const forbidden = /\b(?:credibility|trustScore|reputationScore|sourceQuality|independenceScore|truthScore)\b/i;
const implementationFiles = [
  ...fs.readdirSync(path.join(root, "src/services"))
    .filter((name) => name.startsWith("rcv020") && name.endsWith(".ts"))
    .map((name) => path.join(root, "src/services", name)),
  path.join(root, "migrations/rcv020_add_observatory_radar_ingestion.sql"),
];

test("RCV-020 implementation boundary contains no epistemic source-quality authority", () => {
  const matches = [];
  for (const file of implementationFiles) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => { if (forbidden.test(line)) matches.push(`${path.relative(root, file)}:${index + 1}`); });
  }
  assert.deepEqual(matches, []);
});
