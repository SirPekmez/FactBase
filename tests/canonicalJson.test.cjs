const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateCanonicalTimestamp,
  canonicalizeAndHash,
  canonicalizeJson,
  sha256,
} = require("../dist/services/canonicalJson");

// Official RFC 8785 / cyberphone reference-corpus vectors.
const vectors = [
  {
    name: "values",
    input: `{
      "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
      "string": "\\u20ac$\\u000F\\u000aA'\\u0042\\u0022\\u005c\\\\\\\"/",
      "literals": [null, true, false]
    }`,
    output: `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/"}`,
  },
  {
    name: "arrays",
    input: `[56,{"d":true,"10":null,"1":[]}]`,
    output: `[56,{"1":[],"10":null,"d":true}]`,
  },
  {
    name: "unicode property sorting",
    input: `{"€":"Euro Sign","\\r":"Carriage Return","\\n":"Newline","1":"One","":"Control","😂":"Smiley","ö":"Latin Small Letter O With Diaeresis","דּ":"Hebrew Letter Dalet With Dagesh","</script>":"Browser Challenge"}`,
    output: `{"\\n":"Newline","\\r":"Carriage Return","1":"One","</script>":"Browser Challenge","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😂":"Smiley","דּ":"Hebrew Letter Dalet With Dagesh"}`,
  },
];

for (const vector of vectors) {
  test(`JCS official conformance vector: ${vector.name}`, () => {
    assert.equal(canonicalizeJson(JSON.parse(vector.input)), vector.output);
  });
}

test("canonical JSON rejects values outside I-JSON instead of silently rewriting", () => {
  assert.throws(() => canonicalizeJson({ value: Number.NaN }));
  assert.throws(() => canonicalizeJson({ value: Number.POSITIVE_INFINITY }));
  assert.throws(() => canonicalizeJson({ value: undefined }));
  assert.throws(() => canonicalizeJson(new Date()));
  assert.throws(() => canonicalizeJson({ value: "\ud800" }));
  assert.throws(() => canonicalizeJson({ "\udc00": "invalid key" }));
  assert.throws(() => canonicalizeJson({ [Symbol("hidden")]: true }));
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
  assert.throws(() => canonicalizeJson(accessor));
  const hidden = {};
  Object.defineProperty(hidden, "value", { enumerable: false, value: 1 });
  assert.throws(() => canonicalizeJson(hidden));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJson(cyclic));
});

test("SHA-256 covers canonical UTF-8 bytes and canonical timestamps preserve microseconds", () => {
  const result = canonicalizeAndHash({ b: 2, a: "€" });
  assert.equal(result.canonical, `{"a":"€","b":2}`);
  assert.equal(result.hash, sha256(result.canonical));
  assert.equal(
    validateCanonicalTimestamp("2026-08-22T12:34:56.789000Z"),
    "2026-08-22T12:34:56.789000Z",
  );
  assert.equal(
    validateCanonicalTimestamp("2026-08-22T12:34:56.000001Z"),
    "2026-08-22T12:34:56.000001Z",
  );
  assert.equal(
    validateCanonicalTimestamp("2026-08-22T12:34:56.123456Z"),
    "2026-08-22T12:34:56.123456Z",
  );
  for (const invalid of [
    new Date("2026-08-22T12:34:56.789Z"),
    "2026-08-22T12:34:56.789Z",
    "2026-02-30T12:34:56.000000Z",
    "2026-08-22T12:34:56.000000+00:00",
  ]) {
    assert.throws(() => validateCanonicalTimestamp(invalid));
  }
});
