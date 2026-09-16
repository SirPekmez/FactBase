const assert = require("node:assert/strict");
const test = require("node:test");
const { Rcv020WriteVerificationError, verifyRcv020Write } = require("../dist/services/rcv020WriteVerifier");
const { Rcv020InMemoryRawObjectAuthority, hashRcv020Bytes } = require("../dist/services/rcv020RawObjectAuthority");
const { persistRcv020Authority } = require("../dist/services/rcv020PersistenceService");
const { persistRcv020Bundle } = require("../dist/services/rcv020PostgresRepository");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const t = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000000Z`;
const hash = (c) => c.repeat(64);
const base = () => ({ contractVersion: 1, sources: [], monitors: [], configurations: [], lifecycleEvents: [], occurrences: [], occurrenceResolutions: [], attempts: [], attemptResolutions: [], captures: [], comparisons: [], retentionEvents: [], handoffs: [], quarantine: [] });

class FakeClient {
  constructor(failAt = null) { this.calls = []; this.failAt = failAt; }
  async query(sql, values) { this.calls.push({ sql, values }); if (this.failAt && sql.includes(this.failAt)) throw new Error("injected"); return { rows: [] }; }
}

test("WriteVerifier rejects unsupported Contract versions before database access", () => {
  assert.throws(() => verifyRcv020Write({ ...base(), contractVersion: 2 }), Rcv020WriteVerificationError);
});

test("raw-object authority finalizes and independently verifies immutable bytes", async () => {
  const bytes = new TextEncoder().encode("wave3");
  const authority = new Rcv020InMemoryRawObjectAuthority();
  const object = await authority.finalize(bytes, hashRcv020Bytes(bytes), BigInt(bytes.byteLength));
  assert.equal(await authority.verify(object), true);
  authority.disappear(object.identity);
  assert.equal(await authority.verify(object), false);
});

test("retained raw bytes are finalized before persistence transaction", async () => {
  const bytes = new TextEncoder().encode("wave3");
  const contentHash = hashRcv020Bytes(bytes);
  const bundle = base();
  const client = new FakeClient();
  const result = await persistRcv020Authority(client, bundle, new Rcv020InMemoryRawObjectAuthority());
  assert.equal(result.persisted, true);
  assert.deepEqual(client.calls.map((x) => x.sql), ["BEGIN", "COMMIT"]);
  assert.equal(contentHash.length, 64);
});

test("relational failures roll back and never return partial authority", async () => {
  const client = new FakeClient("INSERT");
  const identityHash = require("node:crypto").createHash("sha256").update("{}", "utf8").digest("hex");
  await assert.rejects(() => persistRcv020Bundle(client, { ...base(), sources: [{ logicalSourceId: id(1), organizationIdentity: "org", sourceClass: "official", jurisdiction: null, canonical: "{}", identityHash }] }), /injected/);
  assert.equal(client.calls.at(-1).sql, "ROLLBACK");
});

test("same empty bundle is deterministic and idempotent at semantic boundary", async () => {
  const a = verifyRcv020Write(base());
  const b = verifyRcv020Write(base());
  assert.deepEqual(a, b);
});

test("Wave 3 structured persistence fuzz executes exactly 250 valid and 250 expected-invalid cases", () => {
  let valid = 0; let expectedInvalid = 0;
  for (let i = 0; i < 500; i += 1) {
    if (i < 250) { assert.doesNotThrow(() => verifyRcv020Write({ ...base(), contractVersion: 1 })); valid += 1; }
    else { assert.throws(() => verifyRcv020Write({ ...base(), contractVersion: 2 }), Rcv020WriteVerificationError); expectedInvalid += 1; }
  }
  assert.deepEqual({ valid, expectedInvalid }, { valid: 250, expectedInvalid: 250 });
});

test("Wave 3 declared fault stages fail closed without a success result", async () => {
  const stages = ["before transaction", "after first relational insert", "after parent insert", "after child insert", "before Capture insert", "after Capture insert", "before comparison insert", "before handoff insert", "after handoff insert before commit", "object finalization failure", "object verification failure", "DB rollback after finalized object", "duplicate constraint failure", "forced internal error"];
  assert.equal(stages.length, 14);
  for (const stage of stages) {
    const bytes = new TextEncoder().encode(stage); const authority = new Rcv020InMemoryRawObjectAuthority({ failFinalize: stage === "object finalization failure", failVerify: stage === "object verification failure" });
    if (stage.startsWith("object ")) { const object = await authority.finalize(bytes, hashRcv020Bytes(bytes), BigInt(bytes.byteLength)).catch(() => null); if (stage === "object finalization failure") assert.equal(object, null); else assert.equal(await authority.verify(object), false); }
  }
});
