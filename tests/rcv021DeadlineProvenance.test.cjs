const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const legacy=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/rcv021DeadlineLegacy.json'),'utf8'));
const c=require('../dist/services/rcv021Canonical'),provenance=require('../dist/services/rcv021DeadlineProvenance'),reader=require('../dist/services/rcv021ReadVerifier'),scheduler=require('../dist/services/researchSchedulerPostgresWriter'),writer=require('../dist/services/rcv021WriteVerifier');
const fields=v=>{const x=c.canonicalizeRcv021Authority(v);return {canonicalVersion:1,canonical:x.canonical,canonicalHash:x.hash};};
function replace(value,changes){const {canonicalVersion,canonical,canonicalHash,...payload}=value;const next={...payload,...changes};return {...next,...fields(next)};}
function structured(){const g=structuredClone(legacy);g.attemptResolutions=[replace(g.attemptResolutions[0],{failureAuthority:provenance.buildRcv021DeadlineProvenance(g.runs[0],g.attempts[0])})];return g;}
function clientFor(g,missingRows=false){return {queries:[],async query(sql){this.queries.push(sql);assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|COMMIT|ROLLBACK|BEGIN)\b/i);const table=sql.match(/FROM public\.([a-z_]+)/)?.[1];const rows={research_operations:[g.operation],research_operation_subject_bindings:[g.subject],research_operation_trigger_bindings:[g.trigger],research_operation_lifecycle_events:g.operationLifecycleEvents,research_runs:g.runs,research_run_lifecycle_events:g.runLifecycleEvents,research_run_terminal_resolutions:g.terminalResolutions,research_attempts:g.attempts,research_attempt_resolutions:g.attemptResolutions,research_provider_results:g.providerResults,research_result_selections:g.resultSelections,rcv020_observation_occurrences:g.rcv020Occurrences}[table];assert.ok(rows,'expected historical SELECT');return missingRows&&table==='research_attempts'?{}:{rows:structuredClone(rows)};}};}
test('negated legacy text authenticates bytes but never earns full verification',()=>{const g=structuredClone(legacy),before=JSON.stringify(g),r=reader.verifyRcv021HistoricalGraph(g);assert.equal(r.canonicalVerified,true);assert.equal(r.deadlineQualification,'UNKNOWN');assert.equal(r.verified,false);assert.throws(()=>reader.requireRcv021HistoricalVerification(g),/DEADLINE_VIOLATION/);assert.equal(JSON.stringify(g),before);});
test('actual Scheduler writer gate rejects negated legacy cause before any write',async()=>{const client=clientFor(legacy);await assert.rejects(()=>scheduler.verifySchedulerRcv021DeadlineContext(client,legacy.operation.operationId,'2026-01-01T00:00:15.000000Z'),/DEADLINE_VIOLATION/);assert.ok(client.queries.some(sql=>sql.includes('research_attempt_resolutions')));});
test('valid exact structured cause earns source-level qualification and Scheduler admission',async()=>{const g=structured();assert.equal(reader.verifyRcv021HistoricalGraph(g).verified,true);await scheduler.verifySchedulerRcv021DeadlineContext(clientFor(g),g.operation.operationId,'2026-01-01T00:00:15.000000Z');});
test('wrong run/attempt/hash/deadline and negative cause fail with isolated valid outer hashes',()=>{const good=structured();for(const change of [{runId:good.attempts[0].attemptId},{attemptId:good.runs[0].runId},{runCanonicalHash:'0'.repeat(64)},{attemptCanonicalHash:'0'.repeat(64)},{deadlineAt:'2026-01-01T00:00:11.000000Z'},{cause:'NOT_DEADLINE_RELATED'},{extra:'hidden'},{runId:123}]){const g=structuredClone(good);const inner={...JSON.parse(g.attemptResolutions[0].failureAuthority),...change};g.attemptResolutions=[replace(g.attemptResolutions[0],{failureAuthority:c.canonicalizeRcv021Authority(inner).canonical})];assert.throws(()=>reader.verifyRcv021HistoricalGraph(g),/DEADLINE_VIOLATION/);}});
test('legacy marker and unsupported schema stay UNKNOWN, never silently upgraded',()=>{for(const text of ['RUN_DEADLINE_EXPIRED','Frist abgelaufen','{"schema":"RCV021-DEADLINE-PROVENANCE-V2"}']){const g=structuredClone(legacy);g.attemptResolutions=[replace(g.attemptResolutions[0],{failureAuthority:text})];assert.equal(reader.verifyRcv021HistoricalGraph(g).verified,false);}});
test('noncanonical inner JSON is rejected without rewriting historical authority',()=>{const g=structured(),old=g.attemptResolutions[0].failureAuthority;g.attemptResolutions=[replace(g.attemptResolutions[0],{failureAuthority:JSON.stringify(JSON.parse(old),null,2)})];const before=JSON.stringify(g);assert.throws(()=>reader.verifyRcv021HistoricalGraph(g),/DEADLINE_VIOLATION/);assert.equal(JSON.stringify(g),before);});
test('outcome spoofing cannot bypass active deadline expiry',()=>{const g=structured();g.terminalResolutions=[replace(g.terminalResolutions[0],{outcome:'SUCCESS_NO_RESULTS'})];assert.throws(()=>reader.verifyRcv021HistoricalGraph(g),/DEADLINE_VIOLATION/);});
test('missing SQL measurement is not an empty attempt set',async()=>{const g=structured();await assert.rejects(()=>scheduler.verifySchedulerRcv021DeadlineContext(clientFor(g,true),g.operation.operationId,'2026-01-01T00:00:15.000000Z'),/unmeasured historical row set/);});
test('ordinary FAILED before deadline stays optional',()=>{const g=structuredClone(legacy);g.attemptResolutions=[replace(g.attemptResolutions[0],{terminalAt:'2026-01-01T00:00:05.000000Z',failureAuthority:null})];g.terminalResolutions=[replace(g.terminalResolutions[0],{outcome:'FAILED',terminalAt:'2026-01-01T00:00:06.000000Z'})];assert.equal(reader.verifyRcv021HistoricalGraph(g).verified,true);});

test('intermediate cutoff and absent terminal cannot green recorded post-deadline activity',async()=>{
  const cutoff='2026-01-01T00:00:12.500000Z';
  const graphAtCutoff=require('../dist/services/researchSchedulerPostgresReader').graphAtCutoff;
  for(const original of [legacy,structured()]) {
    const g=graphAtCutoff(structuredClone(original),cutoff);
    assert.equal(g.terminalResolutions.length,0);assert.equal(g.attemptResolutions.length,1);
    const before=JSON.stringify(g);assert.equal(reader.verifyRcv021HistoricalGraph(g).deadlineQualification,'UNKNOWN');
    assert.equal(reader.verifyRcv021HistoricalGraph(g).verified,false);
    await assert.rejects(()=>scheduler.verifySchedulerRcv021DeadlineContext(clientFor(original),original.operation.operationId,cutoff),/DEADLINE_VIOLATION/);
    assert.equal(JSON.stringify(g),before);
  }
});

test('exported Scheduler create path rejects the legacy counterexample and rolls back without authority writes',async()=>{
  const time=require('../dist/services/researchSchedulerTime'),canonical=require('../dist/services/researchSchedulerCanonical');
  const g=structuredClone(legacy),policyId='71000000-0000-4000-8000-000000000099',operationId=g.operation.operationId;
  const effectiveAt='2026-01-01T00:00:01.000000Z',firstAt='2026-01-01T00:00:15.000000Z';
  const policy={policyId,operationId,version:'1',enabled:true,effectiveAtMicros:time.parseSchedulerTimestamp(effectiveAt),firstEligibilityAtMicros:time.parseSchedulerTimestamp(firstAt),fixedIntervalMicros:'86400000000'};
  const encoded=canonical.canonicalizeSchedulerPolicyVersion(policy),base=clientFor(g),commands=[];
  const client={release(){commands.push('RELEASE');},async query(sql){commands.push(sql);
    if(sql.startsWith('SAVEPOINT rcv021_idle_'))throw Object.assign(new Error('outside transaction'),{code:'25P01'});
    if(sql==="SELECT current_setting('transaction_isolation') AS isolation_level")return {rows:[{isolation_level:'read committed'}],rowCount:1,command:'SELECT'};
    if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[],command:sql};
    assert.doesNotMatch(sql,/^\s*(INSERT|UPDATE|DELETE|COMMIT)\b/i);
    if(sql.includes('scheduler_policy_streams')&&sql.includes('FOR UPDATE'))return {rows:[{policy_id:policyId,operation_id:operationId}]};
    if(sql.includes('research_operations')&&sql.includes('FOR UPDATE'))return {rows:[{operation_id:operationId}]};
    if(sql.includes('JOIN public.research_operation_subject_bindings'))return {rows:[{operation_id:operationId,subject_binding_id:g.subject.subjectBindingId,trigger_binding_id:g.trigger.triggerBindingId,canonical:g.operation.canonical,canonical_hash:g.operation.canonicalHash,canonical_version:1,subject_canonical:g.subject.canonical,subject_canonical_hash:g.subject.canonicalHash,subject_canonical_version:1,trigger_canonical:g.trigger.canonical,trigger_canonical_hash:g.trigger.canonicalHash,trigger_canonical_version:1,close_count:'0'}]};
    if(sql.includes('FROM public.scheduler_policy_versions'))return {rows:[{policy_id:policyId,operation_id:operationId,version:'1',enabled:true,effective_at:effectiveAt,first_eligibility_at:firstAt,fixed_interval_micros:'86400000000',canonical_version:'1',canonical:encoded.canonical,canonical_hash:encoded.hash}]};
    if(sql.includes('FROM public.scheduler_decisions'))return {rows:[]};
    return base.query(sql);
  }};
  const request={operationId,policyId,evaluationAt:firstAt,deadlineAt:'2026-01-01T00:00:40.000000Z',strategyIdentity:'strategy',strategyVersion:1,providerIdentity:'provider',adapterIdentity:'adapter',adapterVersion:'1',executionParametersCanonical:'{}'};
  await assert.rejects(()=>scheduler.createSchedulerRunNow({connect:async()=>client},request),/DEADLINE_VIOLATION/);
  assert.ok(commands.includes('ROLLBACK'));assert.equal(commands.at(-1),'RELEASE');
});

test('overdue unresolved cutoff stays UNKNOWN while a predeadline active prefix remains admissible',async()=>{
  const clip=require('../dist/services/researchSchedulerPostgresReader').graphAtCutoff;
  for(const cutoff of ['2026-01-01T00:00:10.000000Z','2026-01-01T00:00:11.000000Z']) {
    const g=clip(structuredClone(legacy),cutoff);assert.equal(g.attemptResolutions.length,0);assert.equal(g.terminalResolutions.length,0);
    assert.equal(reader.verifyRcv021HistoricalGraph(g,cutoff).deadlineQualification,'UNKNOWN');
    assert.throws(()=>reader.requireRcv021HistoricalVerification(g,cutoff),/DEADLINE_VIOLATION/);
    await assert.rejects(()=>scheduler.verifySchedulerRcv021DeadlineContext(clientFor(legacy),legacy.operation.operationId,cutoff),/DEADLINE_VIOLATION/);
  }
  const before='2026-01-01T00:00:09.000000Z',early=clip(structuredClone(legacy),before);
  assert.equal(reader.verifyRcv021HistoricalGraph(early,before).verified,true);
  await scheduler.verifySchedulerRcv021DeadlineContext(clientFor(legacy),legacy.operation.operationId,before);
  assert.equal(reader.verifyRcv021HistoricalGraph(early).deadlineQualification,'UNKNOWN');
});

test('zero-duration decision Run stays valid while excluded from its predecision prefix',async()=>{
  const g=structuredClone(legacy);g.runs=[replace(g.runs[0],{deadlineAt:g.runs[0].runCreatedAt})];g.attempts=[];g.attemptResolutions=[];g.runLifecycleEvents=[];g.terminalResolutions=[];
  const at=g.runs[0].runCreatedAt,own=g.runs[0].runId;
  assert.doesNotThrow(()=>require("../dist/services/rcv021SemanticCore").validateRunCreation(g.runs[0],g.operation,"OPEN"));
  await assert.rejects(()=>scheduler.verifySchedulerRcv021DeadlineContext(clientFor(g),g.operation.operationId,at),/DEADLINE_VIOLATION/);
  await scheduler.verifySchedulerRcv021DeadlineContext(clientFor(g),g.operation.operationId,at,own);
  const clip=require('../dist/services/researchSchedulerPostgresReader').graphAtCutoff(g,at,[own]);
  assert.equal(clip.runs.length,0);assert.equal(reader.requireRcv021HistoricalVerification(clip,at).verified,true);
  // Excluding some other decision Run does not exclude the unqualified history.
  await assert.rejects(()=>scheduler.verifySchedulerRcv021DeadlineContext(clientFor(legacy),legacy.operation.operationId,'2026-01-01T00:00:15.000000Z',own.replace(/.$/,'9')),/DEADLINE_VIOLATION/);
});


test('caller cannot hide an older unqualified Run by claiming it is decision-created',async()=>{
  await assert.rejects(()=>scheduler.verifySchedulerRcv021DeadlineContext(clientFor(legacy),legacy.operation.operationId,'2026-01-01T00:00:15.000000Z',legacy.runs[0].runId),/IDENTITY_MISMATCH/);
});


test('decision output exclusion cannot hide corrupted creation bytes, hash or deadline',async()=>{
  const seed=structuredClone(legacy);seed.runs=[replace(seed.runs[0],{deadlineAt:seed.runs[0].runCreatedAt})];seed.attempts=[];seed.attemptResolutions=[];seed.runLifecycleEvents=[];seed.terminalResolutions=[];
  for(const change of [{canonicalHash:'0'.repeat(64)},{canonical:'{}'},{strategyIdentity:'tampered'},{deadlineAt:'2026-01-01T00:00:00.000000Z'}]){
    const g=structuredClone(seed);g.runs[0]={...g.runs[0],...change};const at=g.runs[0].runCreatedAt;
    assert.throws(()=>reader.authenticateRcv021DecisionOutputCreation(g,g.runs[0].runId,at),/HASH_MISMATCH|CANONICAL_MISMATCH|DEADLINE_VIOLATION/);
    await assert.rejects(()=>scheduler.verifySchedulerRcv021DeadlineContext(clientFor(g),g.operation.operationId,at,g.runs[0].runId),/HASH_MISMATCH|CANONICAL_MISMATCH|DEADLINE_VIOLATION/);
  }
  const g=structuredClone(seed),at=g.runs[0].runCreatedAt,id=g.runs[0].runId;
  reader.authenticateRcv021DecisionOutputCreation(g,id,at);
  const initial=require('../dist/services/researchSchedulerPostgresReader').graphAtCutoff(g,at,[id]);
  assert.equal(reader.requireRcv021HistoricalVerification(initial,at).verified,true);
});
