const assert = require("node:assert/strict");
const test = require("node:test");

const { Rcv016PostgresHistoricalReadRepository } = require("../dist/services/rcv016PostgresReadRepository");

const SNAPSHOT_ID = "00000000-0000-0000-0000-000000000800";

test("Postgres historical read uses one read-only repeatable-read transaction and exact snapshotId", async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, values = []) {
      calls.push([sql.replace(/\s+/g, " ").trim(), values]);
      if (/FROM public\.provenance_snapshots/.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: null, rows: [] };
    },
    release() { released = true; },
  };
  const repository = new Rcv016PostgresHistoricalReadRepository({ async connect() { return client; } });
  assert.equal(await repository.loadHistoricalSnapshotById(SNAPSHOT_ID), null);
  assert.equal(calls[0][0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.match(calls[1][0], /WHERE id = \$1/);
  assert.deepEqual(calls[1][1], [SNAPSHOT_ID]);
  assert.equal(calls.at(-1)[0], "COMMIT");
  assert.equal(released, true);
  assert.equal(calls.some(([sql]) => /latest|current|winner|ORDER BY.*version|MAX\(version\)/i.test(sql)), false);
});

test("Postgres historical read rolls back and releases on query failure", async () => {
  const calls = [];
  const failure = new Error("read failed");
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (/FROM public\.provenance_snapshots/.test(sql)) throw failure;
      return { rowCount: null, rows: [] };
    },
    release() { released = true; },
  };
  const repository = new Rcv016PostgresHistoricalReadRepository({ async connect() { return client; } });
  await assert.rejects(() => repository.loadHistoricalSnapshotById(SNAPSHOT_ID), (error) => error === failure);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(released, true);
});
