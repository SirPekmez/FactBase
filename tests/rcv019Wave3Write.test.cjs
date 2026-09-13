const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRcv019Timeline } = require("../dist/services/rcv019TimelineBuilder");
const { hashRcv019State } = require("../dist/services/rcv019Canonical");
const { verifyRcv019Write } = require("../dist/services/rcv019WriteVerifier");
const { persistRcv019Timeline } = require("../dist/services/rcv019PostgresRepository");

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const claim = id(7001), sh = "a".repeat(64);
function point(n, at, evidence = []) { const state = { contractVersion:1, claimId:claim, claimVersionId:id(1), evidenceProvenance:evidence, rcv016Snapshot:{snapshotId:id(7000),snapshotHash:sh} }; return {pointId:id(7100+n),claimId:claim,claimVersionId:id(1),knowledgeAt:at,state,stateHash:hashRcv019State(state)}; }
function valid() { return buildRcv019Timeline({analysisId:id(7200),claimId:claim,points:[point(0,"2026-01-01T00:00:00.000000Z"),point(1,"2026-01-02T00:00:00.000000Z",[{evidenceId:id(2),relation:"supports"}])]}); }

test("Wave-3 write verifier authenticates the complete Wave-2 projection", () => { const a=valid(); const v=verifyRcv019Write(a); assert.equal(v.pointRows.length,2); assert.equal(v.transitionRows.length,1); assert.equal(v.analysis.timelineHash,a.timelineHash); });
test("Wave-3 verifier rejects canonical/hash/order/membership corruption", () => { const a=valid(); for (const bad of [ {...a,canonical:a.canonical+" "}, {...a,timelineHash:"b".repeat(64)}, {...a,transitions:[]}, {...a,points:[a.points[1],a.points[0]]} ]) assert.throws(()=>verifyRcv019Write(bad)); });
test("Wave-3 verifier rejects malformed historical prerequisites without mutation", () => { const a=valid(); const bad=structuredClone(a); bad.points[0].state.rcv016Snapshot={}; const before=JSON.stringify(bad); assert.throws(()=>verifyRcv019Write(bad)); assert.equal(JSON.stringify(bad),before); });
test("Wave-3 persistence owns one transaction and rolls back on any stage failure", async () => { const calls=[]; const client={query:async(sql,values)=>{calls.push(sql); if(sql.startsWith("INSERT INTO public.rcv019_temporal_evidence_points")) throw new Error("forced"); return {rows:[]}; }}; await assert.rejects(()=>persistRcv019Timeline(client,verifyRcv019Write(valid()),"2026-01-03T00:00:00.000Z")); assert.equal(calls[0],"BEGIN"); assert.equal(calls.at(-1),"ROLLBACK"); });
test("Wave-3 duplicate write conflict is surfaced without semantic retry", async () => { const calls=[]; const client={query:async(sql)=>{calls.push(sql); if(sql.startsWith("INSERT INTO public.rcv019_temporal_evidence_analyses")) throw new Error("duplicate"); return {rows:[]}; }}; await assert.rejects(()=>persistRcv019Timeline(client,verifyRcv019Write(valid()),"2026-01-03T00:00:00.000Z"),/duplicate/); assert.deepEqual(calls,["BEGIN",calls[1],"ROLLBACK"]); });
