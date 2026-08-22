const assert = require("node:assert/strict");
const test = require("node:test");

const {
  InvalidCanonicalDecimalError,
  canonicalizePostgreSqlNumeric,
} = require("../dist/services/canonicalDecimal");

test("PostgreSQL NUMERIC values become lossless canonical decimal strings", () => {
  const cases = new Map([
    ["0", "0"],
    ["1", "1"],
    ["0.75", "0.75"],
    ["0.7500000000000001", "0.7500000000000001"],
    ["0.7500", "0.75"],
    ["+0.7500", "0.75"],
    ["00.7500", "0.75"],
    ["1.0000", "1"],
    ["-0", "0"],
    ["-0.000", "0"],
    ["7.5e-1", "0.75"],
    ["1e-16", "0.0000000000000001"],
  ]);
  for (const [input, expected] of cases) {
    assert.equal(canonicalizePostgreSqlNumeric(input), expected, input);
  }
});

test("decimal canonicalization rejects invalid, negative and out-of-range values", () => {
  for (const value of ["NaN", "Infinity", "-0.1", "1.0001", "2", "", "0.1x"]) {
    assert.throws(
      () => canonicalizePostgreSqlNumeric(value),
      InvalidCanonicalDecimalError,
      value,
    );
  }
});
