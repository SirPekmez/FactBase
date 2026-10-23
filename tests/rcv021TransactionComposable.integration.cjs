const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool } = require("pg");
const canonical = require("../dist/services/rcv021Canonical");
const verifier = require("../dist/services/rcv021WriteVerifier");
const repo = require("../dist/services/rcv021PostgresRepository");
const read = require("../dist/services/rcv021ReadService");

const database = process.env.RCV021_TX_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 8 }) : null;
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = (second) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000000Z`;
const fields = (value) => { const result = canonical.canonicalizeRcv021Authority(value); return { canonicalVersion: 1, canonical: result.canonical, canonicalHash: result.hash }; };
const withoutAuthority = ({ canonicalVersion: _version, canonical: _canonical, canonicalHash: _hash, ...value }) => value;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function bundle(seed) {
  const base = seed * 20;
  const operationId = id(base + 1), subjectBindingId = id(base + 2), triggerBindingId = id(base + 3), runId = id(base + 4);
  const subjectValue = { subjectBindingId, operationId, subjectType: "AUTHENTICATED_OPERATOR_REQUEST", captureId: null, observationOccurrenceId: null, researchTriggerRequestId: null, operatorRequestId: id(base + 5), historicalClaimId: null };
  const subject = { ...subjectValue, ...fields(subjectValue) };
  const triggerValue = { triggerBindingId, operationId, triggerType: "OPERATOR", initiatorIdentity: "operator", authorizationCanonical: "{}", creationTime: time(0), executionOwner: "owner", executionContext: "ctx", triggerRequestId: null, originatingCaptureId: null, originatingOccurrenceId: null, ruleIdentity: null, ruleVersion: null };
  const trigger = { ...triggerValue, ...fields(triggerValue) };
  const operationValue = { operationId, subjectBindingId, triggerBindingId, purpose: "research", scopeCanonical: "{}", operationCreatedAt: time(1) };
  const operation = { ...operationValue, ...fields(operationValue) };
  const runValue = { runId, operationId, strategyIdentity: "strategy", strategyVersion: 1, providerIdentity: "provider", adapterIdentity: "adapter", adapterVersion: "1", executionParametersCanonical: "{}", runCreatedAt: time(2), deadlineAt: time(40), predecessorRunId: null };
  const run = { ...runValue, ...fields(runValue) };
  return { operations: [operation], subjects: [subject], triggers: [trigger], runs: [run] };
}

test("caller rollback removes all transaction-neutral Run writes", { skip: !enabled }, async () => {
  const input = bundle(1), client = await pool.connect();
  try {
    await client.query("BEGIN");
    await repo.persistRcv021BundleWithinTransaction(client, verifier.verifyRcv021Write(input));
    assert.equal(Number((await client.query("SELECT count(*)::int AS count FROM public.research_runs WHERE run_id=$1", [input.runs[0].runId])).rows[0].count), 1);
    await client.query("ROLLBACK");
  } finally { client.release(); }
  assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM public.research_runs WHERE run_id=$1", [input.runs[0].runId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM public.research_operations WHERE operation_id=$1", [input.operations[0].operationId])).rows[0].count), 0);
});

test("caller commit is reader-verifiable and canonical-equivalent", { skip: !enabled }, async () => {
  const input = bundle(2), client = await pool.connect();
  try {
    await client.query("BEGIN");
    await repo.persistRcv021BundleWithinTransaction(client, verifier.verifyRcv021Write(input));
    await client.query("COMMIT");
  } finally { client.release(); }
  const row = (await pool.query("SELECT run_id::text AS run_id, operation_id::text AS operation_id, canonical, encode(canonical_hash,'hex') AS canonical_hash FROM public.research_runs WHERE run_id=$1", [input.runs[0].runId])).rows[0];
  assert.deepEqual(row, { run_id: input.runs[0].runId, operation_id: input.runs[0].operationId, canonical: input.runs[0].canonical, canonical_hash: input.runs[0].canonicalHash });
  assert.equal((await read.Rcv021ReadService.fromPool(pool).verifyOperation(input.operations[0].operationId)).verified, true);
});

test("standalone wrapper and shared primitive preserve same-identity idempotency/conflict behavior", { skip: !enabled }, async () => {
  const input = bundle(3);
  await repo.persistRcv021Bundle(pool, input);
  const before = (await pool.query("SELECT run_id::text AS run_id, canonical, encode(canonical_hash,'hex') AS canonical_hash FROM public.research_runs WHERE run_id=$1", [input.runs[0].runId])).rows[0];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await repo.persistRcv021BundleWithinTransaction(client, verifier.verifyRcv021Write(input));
    const divergentValue = { ...withoutAuthority(input.runs[0]), strategyIdentity: "different-strategy" };
    const divergent = { ...divergentValue, ...fields(divergentValue) };
    await assert.rejects(() => repo.persistRcv021BundleWithinTransaction(client, verifier.verifyRcv021Write({ ...input, runs: [divergent] })), /DUPLICATE_CONFLICT/);
    await client.query("ROLLBACK");
  } finally { client.release(); }
  const after = (await pool.query("SELECT run_id::text AS run_id, canonical, encode(canonical_hash,'hex') AS canonical_hash FROM public.research_runs WHERE run_id=$1", [input.runs[0].runId])).rows[0];
  assert.deepEqual(after, before);
  assert.equal((await read.Rcv021ReadService.fromPool(pool).verifyOperation(input.operations[0].operationId)).verified, true);
});

test("same/same caller transactions converge to one immutable Run", { skip: !enabled }, async () => {
  const input = bundle(4);
  const run = async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await repo.persistRcv021BundleWithinTransaction(client, verifier.verifyRcv021Write(input));
      await client.query("COMMIT");
      return "COMMITTED";
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original */ }
      throw error;
    } finally { client.release(); }
  };
  assert.deepEqual((await Promise.all([run(), run()])).sort(), ["COMMITTED", "COMMITTED"]);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM public.research_runs WHERE run_id=$1", [input.runs[0].runId])).rows[0].count), 1);
});

test("same/divergent caller transactions fail closed without duplicate authority", { skip: !enabled }, async () => {
  const input = bundle(5);
  const divergentValue = { ...withoutAuthority(input.runs[0]), strategyIdentity: "concurrent-different-strategy" };
  const divergent = { ...divergentValue, ...fields(divergentValue) };
  const attempt = async (candidate) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await repo.persistRcv021BundleWithinTransaction(client, verifier.verifyRcv021Write(candidate));
      await client.query("COMMIT");
      return "COMMITTED";
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original */ }
      return String(error.message);
    } finally { client.release(); }
  };
  const outcomes = await Promise.all([attempt(input), attempt({ ...input, runs: [divergent] })]);
  assert.equal(outcomes.filter((value) => value === "COMMITTED").length, 1);
  assert.equal(outcomes.filter((value) => value.includes("DUPLICATE_CONFLICT")).length, 1);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM public.research_runs WHERE run_id=$1", [input.runs[0].runId])).rows[0].count), 1);
});

test("close-vs-Run serialization rejects a Run after a committed close", { skip: !enabled }, async () => {
  const input = bundle(6);
  await repo.persistRcv021Bundle(pool, { operations: input.operations, subjects: input.subjects, triggers: input.triggers });
  const closeValue = { eventId: id(126), operationId: input.operations[0].operationId, eventType: "CLOSED", eventAt: time(3), actorIdentity: "operator" };
  const close = { ...closeValue, ...fields(closeValue) };
  const closeClient = await pool.connect();
  const runClient = await pool.connect();
  try {
    await closeClient.query("BEGIN");
    await closeClient.query("SELECT operation_id FROM public.research_operations WHERE operation_id=$1 FOR UPDATE", [input.operations[0].operationId]);
    await repo.persistRcv021BundleWithinTransaction(closeClient, verifier.verifyRcv021Write({ operations: input.operations, subjects: input.subjects, triggers: input.triggers, operationLifecycleEvents: [close] }));

    await runClient.query("BEGIN");
    const runPromise = repo.persistRcv021BundleWithinTransaction(runClient, verifier.verifyRcv021Write(input));
    await sleep(50);
    await closeClient.query("COMMIT");
    await assert.rejects(runPromise, /LIFECYCLE_VIOLATION/);
    await runClient.query("ROLLBACK");
  } finally {
    try { await closeClient.query("ROLLBACK"); } catch { /* already committed */ }
    try { await runClient.query("ROLLBACK"); } catch { /* already rolled back */ }
    closeClient.release(); runClient.release();
  }
  assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM public.research_operation_lifecycle_events WHERE event_id=$1", [close.eventId])).rows[0].count), 1);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM public.research_runs WHERE run_id=$1", [input.runs[0].runId])).rows[0].count), 0);
});

test.after(async () => { if (pool) await pool.end(); });


const core = require("../dist/services/rcv021SemanticCore");
function reviewHistory(seed,includeNull,terminalAt=4) {
 const b=bundle(seed), base=seed*20;
 const a={attemptId:id(base+6),runId:b.runs[0].runId,attemptNumber:'1',predecessorAttemptId:null,startedAt:time(3)};
 const r={resolutionId:id(base+7),attemptId:a.attemptId,outcome:'FAILED',terminalAt:time(terminalAt),...(includeNull?{failureAuthority:null}:{})};
 const start={eventId:id(base+8),runId:a.runId,eventType:'STARTED',eventAt:time(2),executionAuthority:'engine'};
 const manifest=core.deriveTerminalManifest([]);
 const t={resolutionId:id(base+9),runId:a.runId,outcome:'FAILED',terminalAt:time(5),completionAuthority:'engine',resultManifestCanonical:manifest.canonical,resultManifestHash:manifest.hash,resultCount:'0'};
 return {...b,attempts:[{...a,...fields(a)}],attemptResolutions:[{...r,...fields(r)}],runLifecycleEvents:[{...start,...fields(start)}],runTerminalResolutions:[{...t,...fields(t)}]};
}
for(const [seed,includeNull,end] of [[101,false,4],[102,true,3]]) test(`write/read exact FAILED history: ${includeNull?'explicit null, equal start/end':'omitted cause'}`,{skip:!enabled},async()=>{
 const input=reviewHistory(seed,includeNull,end);
 await repo.persistRcv021Bundle(pool,input);
 const row=(await pool.query('SELECT failure_authority,canonical,encode(canonical_hash,\'hex\') AS hash FROM research_attempt_resolutions WHERE resolution_id=$1',[input.attemptResolutions[0].resolutionId])).rows[0];
 assert.equal(row.failure_authority,null);assert.equal(row.canonical,input.attemptResolutions[0].canonical);assert.equal(row.hash,input.attemptResolutions[0].canonicalHash);
 const started=(await pool.query("SELECT to_char(event_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at FROM research_run_lifecycle_events WHERE event_id=$1",[input.runLifecycleEvents[0].eventId])).rows[0];
 assert.equal(started.at,input.runLifecycleEvents[0].eventAt);
 const before=JSON.stringify(row);assert.equal((await read.Rcv021ReadService.fromPool(pool).verifyOperation(input.operations[0].operationId)).verified,true);
 const after=(await pool.query('SELECT failure_authority,canonical,encode(canonical_hash,\'hex\') AS hash FROM research_attempt_resolutions WHERE resolution_id=$1',[input.attemptResolutions[0].resolutionId])).rows[0];assert.equal(JSON.stringify(after),before);
});
test('deadline missing cause and terminal-before-start reject before any persistence',{skip:!enabled},async()=>{
 for(const [seed,deadline] of [[103,false],[104,true]]){
  const b=reviewHistory(seed,false,deadline?40:2);
  if(deadline){const t={...b.runTerminalResolutions[0],outcome:'TIMED_OUT',terminalAt:time(41)};delete t.canonical;delete t.canonicalHash;delete t.canonicalVersion;b.runTerminalResolutions=[{...t,...fields(t)}];}
  await assert.rejects(()=>repo.persistRcv021Bundle(pool,b),deadline?/DEADLINE_VIOLATION/:/ORDERING_VIOLATION/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM research_operations WHERE operation_id=$1',[b.operations[0].operationId])).rows[0].n,0);
 }
});
test('persisted cause corruption is rejected with no read repair',{skip:!enabled},async()=>{
 const b=reviewHistory(105,false);await repo.persistRcv021Bundle(pool,b);
 const client=await pool.connect();try{await client.query("SET session_replication_role='replica'");await client.query('UPDATE research_attempt_resolutions SET failure_authority=$1 WHERE resolution_id=$2',['injected cause',b.attemptResolutions[0].resolutionId]);}finally{await client.query("SET session_replication_role='origin'");client.release();}
 const snapshot=async()=>JSON.stringify((await pool.query('SELECT * FROM research_attempt_resolutions WHERE resolution_id=$1',[b.attemptResolutions[0].resolutionId])).rows);
 const before=await snapshot();await assert.rejects(()=>read.Rcv021ReadService.fromPool(pool).verifyOperation(b.operations[0].operationId),/CANONICAL_MISMATCH/);assert.equal(await snapshot(),before);
});
