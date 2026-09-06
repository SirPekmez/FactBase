const assert = require("node:assert/strict");
const test = require("node:test");
const { readRcv018Analysis, normalizeRcv018BigIntRows } = require("../dist/services/rcv018PostgresReadRepository");
const { verifyRcv018ReadBundle, Rcv018ReadVerificationError } = require("../dist/services/rcv018ReadVerifier");
const canon = require("../dist/services/rcv018Canonical");
const id = "00000000-0000-0000-0000-000000000500"; const h = "a".repeat(64);
function pool() { const trace=[]; const rows = (sql, params) => sql.includes("rcv018_analyses WHERE") && params[0] === id ? [{analysis_id:id,contract_version:1,algorithm_version:1,contract_hash:h,algorithm_hash:h,analysis_hash:h,canonical:"{}"}] : []; const client={async query(text, params=[]){trace.push(text); if(text.startsWith("SELECT * FROM public.rcv018_analyses")) { const r=rows(text,params); return {rowCount:r.length,rows:r}; } return {rowCount:0,rows:[]};},release(){}}; return {trace,async connect(){return client;}}; }
test("read repository uses exact ID, repeatable read, stable ordering, and not-found", async()=>{const p=pool(); const result=await readRcv018Analysis(p,id); assert.equal(result.analysis.analysis_id,id); assert.ok(p.trace[0].startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")); assert.ok(p.trace.some(x=>x.includes("ORDER BY ordinal"))); const missing=await readRcv018Analysis(p,"00000000-0000-0000-0000-000000000501"); assert.equal(missing,null);});
test("read verifier authenticates raw analysis and rejects mutation/duplicate ordinals",()=>{const input={analysisId:id,assertions:[],valueDomains:[],comparisonDomains:[],contractBinding:{contractId:"contract",contractVersion:1,contractHash:h},algorithmBinding:{algorithmId:"algorithm",algorithmVersion:1,algorithmHash:h}}; const built=require("../dist/services/rcv018AnalysisBuilder").buildRcv018Analysis(input); const bundle={analysis:{analysis_id:id,contract_id:"contract",contract_version:1,contract_hash:h,algorithm_id:"algorithm",algorithm_version:1,algorithm_hash:h,analysis_hash:built.hash,canonical:built.canonical},assertions:[],assertionContexts:[],evidenceBasis:[],historicalBindings:[],valueDomains:[],valueDomainValues:[],comparisonDomains:[],comparisonKeys:[],incompatibilityPairs:[],findings:[],analysisAssertions:[],analysisValueDomains:[],analysisComparisonDomains:[],analysisFindings:[]}; const ok=verifyRcv018ReadBundle(bundle); assert.equal(ok.pairCount,0); assert.throws(()=>verifyRcv018ReadBundle({...bundle,analysis:{...bundle.analysis,canonical:"{\"x\":1}"}}),Rcv018ReadVerificationError); assert.throws(()=>verifyRcv018ReadBundle({...bundle,analysisAssertions:[{ordinal:0},{ordinal:0}]}),Rcv018ReadVerificationError);});
test("PostgreSQL BIGINT strings normalize strictly at the read boundary",()=>{const rows=normalizeRcv018BigIntRows([{contract_version:"1",algorithm_version:"1",value_domain_version:"1",comparison_domain_version:"1",ordinal:"0"}]); assert.deepEqual(rows[0],{contract_version:1,algorithm_version:1,value_domain_version:1,comparison_domain_version:1,ordinal:0}); for(const value of ["-1","01","1.5","1e0","", "abc", "9007199254740992"]) assert.throws(()=>normalizeRcv018BigIntRows([{ordinal:value}]));});

test("STATEMENT bindings dispatch only to the selected EvidenceArtifactBinding family", async()=>{
  const analysisId = "00000000-0000-0000-0000-000000000500";
  const statementId = "00000000-0000-0000-0000-000000000802";
  const trace = [];
  const client = { async query(sql, params = []) {
    trace.push({ sql, params });
    if (sql.startsWith("SELECT * FROM public.rcv018_analyses")) return { rowCount: 1, rows: [{ analysis_id: analysisId, contract_version: 1, algorithm_version: 1 }] };
    if (sql.includes("rcv018_analysis_assertions")) return { rowCount: 1, rows: [{ analysis_id: analysisId, assertion_id: "00000000-0000-0000-0000-000000000701", ordinal: 0 }] };
    if (sql.includes("rcv018_assertion_historical_bindings")) return { rowCount: 1, rows: [{ assertion_id: "00000000-0000-0000-0000-000000000701", ordinal: 0, kind: "STATEMENT", statement_kind: "EvidenceArtifactBinding", statement_id: statementId }] };
    if (sql.includes("evidence_artifact_bindings")) return { rowCount: 1, rows: [{ id: statementId }] };
    return { rowCount: 0, rows: [] };
  }, release() {} };
  const p = { async connect() { return client; } };
  const bundle = await readRcv018Analysis(p, analysisId);
  assert.equal(bundle.statementPrerequisites.length, 1);
  assert.equal(bundle.statementPrerequisites[0].id, statementId);
  assert.equal(trace.filter((q) => q.sql.includes("evidence_artifact_bindings")).length, 1);
  assert.equal(trace.filter((q) => q.sql.includes("knowledge_state_statements")).length, 0);
  assert.equal(trace.filter((q) => /statement|evidence_artifact_bindings/.test(q.sql) && !q.sql.includes("evidence_artifact_bindings")).length, 0);
});
