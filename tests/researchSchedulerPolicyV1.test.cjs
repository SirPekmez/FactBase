const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const policy = require("../dist/services/researchSchedulerPolicyV1");
const canonical = require("../dist/services/researchSchedulerCanonical");
const time = require("../dist/services/researchSchedulerTime");

const OPERATION = "11111111-1111-4111-8111-111111111111";
const POLICY = "22222222-2222-4222-8222-222222222222";
const AUTHORIZATION = "2026-01-01T00:00:00.000000Z";

test("Policy v1 builder freezes universal immediate 24-hour authority", () => {
  const authority = policy.buildResearchSchedulerPolicyV1Authority({ operationId: OPERATION, policyId: POLICY, authorizationAt: AUTHORIZATION });
  assert.equal(authority.semanticPolicyId, "factbase-research-recheck-universal-24h");
  assert.equal(authority.version, "1");
  assert.equal(authority.enabled, true);
  assert.equal(authority.authorizationAt, AUTHORIZATION);
  assert.equal(authority.effectiveAt, AUTHORIZATION);
  assert.equal(authority.firstEligibilityAt, AUTHORIZATION);
  assert.equal(authority.fixedIntervalMicros, "86400000000");
  const decoded = canonical.canonicalizeSchedulerPolicyVersion({
    operationId: OPERATION,
    policyId: POLICY,
    version: authority.version,
    enabled: authority.enabled,
    effectiveAtMicros: time.parseSchedulerTimestamp(authority.effectiveAt),
    firstEligibilityAtMicros: time.parseSchedulerTimestamp(authority.firstEligibilityAt),
    fixedIntervalMicros: authority.fixedIntervalMicros,
  });
  assert.equal(authority.canonical, decoded.canonical);
  assert.equal(authority.canonicalHash, decoded.hash);
});

test("Policy v1 builder is exact, UTC-only, and has no runtime cadence inputs", () => {
  assert.throws(() => policy.buildResearchSchedulerPolicyV1Authority({ operationId: OPERATION, policyId: POLICY, authorizationAt: "2026-01-01T00:00:00.000000+00:00" }));
  assert.throws(() => policy.buildResearchSchedulerPolicyV1Authority({ operationId: OPERATION, policyId: POLICY, authorizationAt: "infinity" }));
  assert.equal(policy.RESEARCH_SCHEDULER_POLICY_V1_FIXED_INTERVAL_MICROS, 86400000000n);
  const source = fs.readFileSync("src/services/researchSchedulerPolicyV1.ts", "utf8");
  assert.doesNotMatch(source, /Date\.now\s*\(|CURRENT_TIMESTAMP|clock_timestamp\s*\(|\bnew\s+Date\b|\bNumber\s*\(/i);
  assert.doesNotMatch(source, /adaptive|news.?volume|evidence.?strength|cost.?feedback|AI.?selected/i);
});
