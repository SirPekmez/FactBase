const assert = require('node:assert/strict');
const test = require('node:test');
const { withAtomicFixtureTransaction, materializeHistoricalFixture, insertFixtureRoots, insertFixtureRcv016, insertFixtureRcv017, insertFixtureRcv018, BASELINE_PHASE_ROWS } = require('./helpers/rcv018HistoricalFixture.cjs');

function fakePool({ failAt } = {}) {
  const calls = [];
  const client = {
    async query(sql) { calls.push(sql); if (sql === failAt) throw new Error(`injected ${sql}`); return { rowCount: 1, rows: [] }; },
    release() { calls.push('RELEASE'); },
  };
  return { calls, async connect() { calls.push('CONNECT'); if (failAt === 'CONNECT') throw new Error('connect'); return client; } };
}

test('atomic helper owns one transaction and rolls back on child failure', async () => {
  const pool = fakePool({ failAt: 'FAIL' });
  const client = await pool.connect();
  await assert.rejects(() => withAtomicFixtureTransaction(client, async (client) => {
    await client.query('INSERT row 1');
    await client.query('FAIL');
  }));
  client.release();
  assert.deepEqual(pool.calls, ['CONNECT', 'BEGIN', 'INSERT row 1', 'FAIL', 'ROLLBACK', 'RELEASE']);
  assert.equal(pool.calls.includes('COMMIT'), false);
});

test('atomic helper commits once on success and never rolls back', async () => {
  const pool = fakePool();
  const client = await pool.connect();
  await withAtomicFixtureTransaction(client, async (client) => {
    await client.query('INSERT row 1');
    await client.query('INSERT row 46');
  });
  client.release();
  assert.deepEqual(pool.calls, ['CONNECT', 'BEGIN', 'INSERT row 1', 'INSERT row 46', 'COMMIT', 'RELEASE']);
  assert.equal(pool.calls.includes('ROLLBACK'), false);
});

test('connection failure performs zero fixture writes', async () => {
  const pool = fakePool({ failAt: 'CONNECT' });
  await assert.rejects(() => pool.connect().then((client) => withAtomicFixtureTransaction(client, async () => { throw new Error('must not run'); })));
  assert.deepEqual(pool.calls, ['CONNECT']);
});

test('failure after conceptual row 20 uses one client and rolls back', async () => {
  const pool = fakePool();
  await assert.rejects(() => materializeHistoricalFixture(pool, async (client) => {
    for (let i = 1; i <= 20; i += 1) await client.query(`ROW ${i}`);
    throw new Error('after row 20');
  }));
  assert.equal(pool.calls.filter((x) => x === 'CONNECT').length, 1);
  assert.equal(pool.calls.filter((x) => x === 'BEGIN').length, 1);
  assert.equal(pool.calls.filter((x) => x === 'ROLLBACK').length, 1);
  assert.equal(pool.calls.includes('COMMIT'), false);
  assert.equal(pool.calls.filter((x) => x === 'RELEASE').length, 1);
});

test('failure during conceptual RCV018 rows uses the same client', async () => {
  const pool = fakePool();
  await assert.rejects(() => materializeHistoricalFixture(pool, async (client) => {
    await client.query('ROWS 1-20');
    await client.query('ROWS 21-25');
    throw new Error('during RCV018');
  }));
  assert.deepEqual(pool.calls, ['CONNECT', 'BEGIN', 'ROWS 1-20', 'ROWS 21-25', 'ROLLBACK', 'RELEASE']);
});

test('failure on physical row 20 rolls back the shared transaction', async () => {
  const calls = [];
  let inserts = 0;
  const client = { async query(sql, values) { calls.push({ sql, values }); if (/^INSERT INTO /.test(sql) && ++inserts === 20) throw new Error('injected row 20'); return { rowCount: 1, rows: [] }; }, release() {} };
  const pool = { async connect() { calls.push({ sql: 'CONNECT' }); return client; } };
  await assert.rejects(() => materializeHistoricalFixture(pool));
  assert.equal(inserts, 20);
  assert.equal(calls.filter((x) => x.sql === 'BEGIN').length, 1);
  assert.equal(calls.filter((x) => x.sql === 'ROLLBACK').length, 1);
  assert.equal(calls.filter((x) => x.sql === 'COMMIT').length, 0);
});

test('all four fixture phases receive the same client and cover 46 rows', async () => {
  const calls = [];
  const client = { async query(sql, values) { calls.push({ sql, values }); return { rowCount: 1, rows: [] }; }, release() {} };
  const pool = { async connect() { return client; } };
  await materializeHistoricalFixture(pool);
  assert.equal(calls.filter((x) => x.sql === 'BEGIN').length, 1);
  assert.equal(calls.filter((x) => x.sql === 'COMMIT').length, 1);
  assert.equal(calls.filter((x) => x.sql === 'ROLLBACK').length, 0);
  const physical = calls.filter((x) => /^INSERT INTO /.test(x.sql));
  assert.equal(physical.length, 46);
  assert.deepEqual(physical.slice(0, 20).map((x) => x.sql.match(/^INSERT INTO (?:public\.)?([a-z0-9_]+)/i)[1]), [
    'claims','claim_versions','provenance_payload_limits','provenance_artifacts',
    'provenance_artifact_versions','evidence','evidence_artifact_bindings',
    'provenance_traversal_policies','provenance_snapshots',
    'provenance_snapshot_artifact_versions','provenance_snapshot_evidence_artifact_bindings',
    'claim_version_evidence','dependency_analysis_policies',
    'dependency_analysis_policy_relationships','claim_evidence_dependency_analyses',
    'dependency_analysis_evidence_relations','dependency_analysis_bindings',
    'dependency_analysis_knowledge_incomplete_findings',
    'dependency_analysis_knowledge_affected_artifacts',
    'dependency_analysis_derived_unrecorded_evidence',
  ]);
  assert.deepEqual(physical.slice(20).map((x) => x.sql.match(/^INSERT INTO (?:public\.)?([a-z0-9_]+)/i)[1]), [
    'rcv018_value_domains','rcv018_value_domain_values','rcv018_value_domain_values',
    'rcv018_comparison_domains','rcv018_incompatibility_pairs',
    'rcv018_evidence_assertions','rcv018_assertion_evidence_basis',
    'rcv018_assertion_historical_bindings','rcv018_assertion_historical_bindings',
    'rcv018_assertion_historical_bindings','rcv018_assertion_historical_bindings',
    'rcv018_assertion_historical_bindings','rcv018_evidence_assertions',
    'rcv018_assertion_evidence_basis','rcv018_assertion_historical_bindings',
    'rcv018_assertion_historical_bindings','rcv018_assertion_historical_bindings',
    'rcv018_assertion_historical_bindings','rcv018_assertion_historical_bindings',
    'rcv018_contradiction_findings','rcv018_analyses',
    'rcv018_analysis_assertions','rcv018_analysis_assertions','rcv018_analysis_value_domains',
    'rcv018_analysis_comparison_domains','rcv018_analysis_findings',
  ]);
  assert.equal(calls.filter((x) => x.sql.startsWith('SELECT $1')).length, 0);
});

test('historical bindings use strict lexical order for both assertions', async () => {
  const calls = [];
  const client = { async query(sql, values) { calls.push({ sql, values }); return { rowCount: 1, rows: [] }; } };
  await insertFixtureRcv018(client, {});
  const bindingCalls = calls.filter((x) => x.sql.includes('rcv018_assertion_historical_bindings'));
  assert.equal(bindingCalls.length, 10);
  for (const start of [0, 5]) {
    assert.deepEqual(bindingCalls.slice(start, start + 5).map((x) => x.values[2]), ['ARTIFACT_VERSION','CLAIM_VERSION','RCV016_SNAPSHOT','RCV017_ANALYSIS','STATEMENT']);
    assert.deepEqual(bindingCalls.slice(start, start + 5).map((x) => x.values[1]), [0,1,2,3,4]);
  }
});
