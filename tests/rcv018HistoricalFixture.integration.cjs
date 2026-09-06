const assert = require('node:assert/strict');
const test = require('node:test');
const { Pool } = require('pg');
const path = require('node:path');
const { materializeHistoricalFixture, IDS } = require(path.join(__dirname, 'helpers', 'rcv018HistoricalFixture.cjs'));
const { readRcv018Analysis } = require('../dist/services/rcv018PostgresReadRepository');
const { verifyRcv018ReadBundle } = require('../dist/services/rcv018ReadVerifier');

const DB = process.env.RCV018_R2B_DATABASE;
const enabled = Boolean(DB && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database: DB, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, max: 4 }) : null;

test('materialize the frozen historical prerequisite graph', { skip: !enabled }, async () => {
  await materializeHistoricalFixture(pool);
  assert.ok(IDS.analysis);
});

test.after(async () => { if (pool) await pool.end(); });
