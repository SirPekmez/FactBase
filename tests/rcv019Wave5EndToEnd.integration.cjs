const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool } = require("pg");
const { buildRcv019Timeline } = require("../dist/services/rcv019TimelineBuilder");
const { assembleRcv019HistoricalState } = require("../dist/services/rcv019HistoricalStateAssembler");
const { verifyRcv019Write } = require("../dist/services/rcv019WriteVerifier");
const { persistRcv019Timeline } = require("../dist/services/rcv019PostgresRepository");
const { Rcv019PostgresReadRepository } = require("../dist/services/rcv019PostgresReadRepository");
const { Rcv019ReadService } = require("../dist/services/rcv019ReadService");
const { verifyRcv019ReadBundle } = require("../dist/services/rcv019ReadVerifier");
const { materializeHistoricalFixture, IDS } = require("./helpers/rcv018HistoricalFixture.cjs");

// Physical Wave-5 proof is intentionally opt-in and must use a newly-created
// disposable database. The sandbox has no authority to select or clean up a
// retained database on behalf of the caller.
const database = process.env.RCV019_W5_DATABASE;
const enabled = Boolean(database && /^factbase_rcv019_wave5_physical_[a-z0-9_]+$/.test(database) && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 4 }) : null;

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ANALYSIS_ID = id(9403);
const CREATED_AT = "2026-01-10T00:00:00.000000Z";
const POINT_IDS = [id(9410), id(9411), id(9412), id(9413)];
const RCV019_TABLES = [
  "rcv019_temporal_evidence_analyses",
  "rcv019_temporal_evidence_points",
  "rcv019_temporal_evidence_point_facets",
  "rcv019_temporal_evidence_transitions",
];

async function counts(client) {
  const result = {};
  for (const table of RCV019_TABLES) {
    const row = (await client.query(`SELECT count(*)::int AS count FROM public.${table}`)).rows[0];
    result[table] = row.count;
  }
  return result;
}

function makeTimeline(fixture) {
  const snapshotHash = fixture.rcv016Derived.snapshot.hash;
  const dependencyHash = fixture.rcv017Derived.verified.analysisHash;
  const contradictionHash = fixture.rcv018Derived.projection.analysisHash;
  const makeState = (optionalFacets) => assembleRcv019HistoricalState({
    claimId: IDS.claim,
    claimVersionId: IDS.claimVersion,
    evidenceProvenance: [{ evidenceId: IDS.evidence, relation: "supports" }],
    rcv016Snapshot: { snapshotId: IDS.snapshot, snapshotHash },
    ...(optionalFacets === undefined ? {} : { optionalFacets }),
  });
  const points = [
    makeState(undefined),
    makeState(undefined),
    makeState([{ kind: "RCV017_ANALYSIS", id: IDS.rcv017Analysis, version: 1, hash: dependencyHash }]),
    makeState([
      { kind: "RCV017_ANALYSIS", id: IDS.rcv017Analysis, version: 1, hash: dependencyHash },
      { kind: "RCV018_ANALYSIS", id: IDS.analysis, version: 1, hash: contradictionHash },
    ]),
  ].map((state, ordinal) => ({
    pointId: POINT_IDS[ordinal],
    claimId: IDS.claim,
    claimVersionId: IDS.claimVersion,
    knowledgeAt: `2026-01-0${ordinal + 1}T00:00:00.000000Z`,
    state,
    stateHash: require("../dist/services/rcv019Canonical").hashRcv019State(state),
  }));
  return buildRcv019Timeline({ analysisId: ANALYSIS_ID, claimId: IDS.claim, points });
}

test("Wave-5 composes the authenticated RCV-016→018 chain with the RCV-019 write/read path", { skip: !enabled }, async () => {
  const fixture = {};
  const before = await counts(pool);
  assert.deepEqual(before, Object.fromEntries(RCV019_TABLES.map((table) => [table, 0])));
  await materializeHistoricalFixture(pool, fixture);

  const timeline = makeTimeline(fixture);
  const verifiedWrite = verifyRcv019Write(timeline);
  assert.equal(verifiedWrite.analysis.points.length, 4);
  assert.deepEqual(verifiedWrite.transitionRows.map((row) => row.changeTypes), [["UNCHANGED"], ["DEPENDENCY_GAP_INTRODUCED"], ["CONTRADICTION_INTRODUCED"]]);

  const writer = await pool.connect();
  try { await persistRcv019Timeline(writer, verifiedWrite, CREATED_AT); } finally { writer.release(); }

  const rawBundle = await new Rcv019PostgresReadRepository(pool).loadAnalysisById(ANALYSIS_ID);
  assert.ok(rawBundle);
  assert.equal(rawBundle.points.length, 4);
  assert.equal(rawBundle.facets.length, 3);
  assert.equal(rawBundle.transitions.length, 3);
  assert.deepEqual(rawBundle.points.map((point) => point.pointId), POINT_IDS);
  assert.deepEqual(rawBundle.points.map((point) => point.ordinal), [0, 1, 2, 3]);
  assert.deepEqual(rawBundle.points.map((point) => point.knowledgeAt), timeline.points.map((point) => point.knowledgeAt));
  assert.equal(rawBundle.analysis.timelineHash, verifiedWrite.analysis.timelineHash);
  assert.equal(rawBundle.analysis.canonical, verifiedWrite.analysis.canonical);

  const serviceResult = await new Rcv019ReadService(pool).readAnalysis(ANALYSIS_ID);
  assert.ok(serviceResult);
  const independentResult = verifyRcv019ReadBundle(rawBundle);
  assert.deepEqual(serviceResult, independentResult);
  assert.deepEqual(serviceResult.transitions, verifiedWrite.analysis.transitions);
  assert.equal(serviceResult.timelineHash, verifiedWrite.analysis.timelineHash);

  const historicalBindings = await pool.query(
    "SELECT claim_version_id, rcv016_snapshot_id, rcv016_snapshot_hash, rcv017_analysis_id, rcv017_analysis_hash FROM public.rcv018_assertion_historical_bindings WHERE assertion_id=$1 ORDER BY ordinal",
    [IDS.assertionA],
  );
  assert.ok(historicalBindings.rows.some((row) => row.claim_version_id === IDS.claimVersion));
  assert.ok(historicalBindings.rows.some((row) => row.rcv016_snapshot_id === IDS.snapshot && row.rcv016_snapshot_hash === fixture.rcv016Derived.snapshot.hash));
  assert.ok(historicalBindings.rows.some((row) => row.rcv017_analysis_id === IDS.rcv017Analysis && row.rcv017_analysis_hash === fixture.rcv017Derived.verified.analysisHash));

  const status = (await pool.query("SELECT status FROM public.claim_versions WHERE id=$1", [IDS.claimVersion])).rows[0].status;
  const changedStatus = status === "draft" ? "active" : "draft";
  await pool.query("UPDATE public.claim_versions SET status=$1 WHERE id=$2", [changedStatus, IDS.claimVersion]);
  const afterCurrentMutation = await new Rcv019ReadService(pool).readAnalysis(ANALYSIS_ID);
  assert.deepEqual(afterCurrentMutation, serviceResult);
  await pool.query("UPDATE public.claim_versions SET status=$1 WHERE id=$2", [status, IDS.claimVersion]);
  assert.equal((await pool.query("SELECT status FROM public.claim_versions WHERE id=$1", [IDS.claimVersion])).rows[0].status, status);
  assert.deepEqual(await counts(pool), { ...before, rcv019_temporal_evidence_analyses: 1, rcv019_temporal_evidence_points: 4, rcv019_temporal_evidence_point_facets: 3, rcv019_temporal_evidence_transitions: 3 });
});

test.after(async () => { if (pool) await pool.end(); });
