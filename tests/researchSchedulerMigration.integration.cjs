const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool } = require("pg");

const database = process.env.SCHEDULER_WAVE1_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled
  ? new Pool({
      database,
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      max: 4,
    })
  : null;

const TABLES = [
  "scheduler_decisions",
  "scheduler_lifecycle_prefix_manifests",
  "scheduler_lifecycle_prefix_members",
  "scheduler_policy_streams",
  "scheduler_policy_versions",
  "scheduler_run_now_bindings",
];
const EXPECTED_COLUMNS = {
  scheduler_policy_streams: ["policy_id", "operation_id", "created_at"],
  scheduler_policy_versions: ["policy_id", "version", "enabled", "effective_at", "first_eligibility_at", "fixed_interval_micros", "canonical_version", "canonical", "canonical_hash", "created_at"],
  scheduler_decisions: ["operation_id", "policy_id", "slot_index", "policy_version", "policy_version_canonical_hash", "scheduled_at", "evaluation_at", "decision", "reason", "next_eligible_at", "manifest_id", "operation_manifest_hash", "previous_operation_id", "previous_policy_id", "previous_slot_index", "previous_decision_canonical_hash", "active_run_id", "active_run_creation_identity", "active_run_creation_hash", "active_run_historical_state", "active_run_running_event_identity", "active_run_running_event_hash", "run_now_binding_identity", "run_now_run_id", "canonical_version", "canonical", "canonical_hash", "created_at"],
  scheduler_lifecycle_prefix_manifests: ["manifest_id", "operation_id", "policy_id", "slot_index", "evaluation_at", "canonical_version", "canonical", "canonical_hash", "created_at"],
  scheduler_lifecycle_prefix_members: ["manifest_id", "authority_kind", "authoritative_time", "authority_identity", "authority_canonical_version", "authority_canonical_hash"],
  scheduler_run_now_bindings: ["operation_id", "policy_id", "slot_index", "run_id", "canonical_version", "canonical", "canonical_hash", "created_at"],
};
const O = "10000000-0000-0000-0000-000000000001";
const SUBJECT = "10000000-0000-0000-0000-000000000002";
const TRIGGER = "10000000-0000-0000-0000-000000000003";
const POLICY = "20000000-0000-0000-0000-000000000001";
const RUN = "30000000-0000-0000-0000-000000000001";
const HASH = Buffer.alloc(32, 7);
const EMPTY_HASH = Buffer.alloc(32, 8);
const TS = "2026-09-18T12:00:00.000000Z";

async function expectReject(client, sql, values, label) {
  await assert.rejects(() => client.query(sql, values), undefined, label);
  await client.query("ROLLBACK").catch(() => {});
}

async function installFixtures(client) {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO public.research_operations
      (operation_id, subject_binding_id, trigger_binding_id, purpose, scope_canonical,
       operation_created_at, canonical_version, canonical, canonical_hash)
     VALUES ($1,$2,$3,'wave1','{}',$4,1,'{}',$5)`,
    [O, SUBJECT, TRIGGER, TS, HASH],
  );
  await client.query(
    `INSERT INTO public.research_operation_subject_bindings
      (subject_binding_id,operation_id,subject_type,operator_request_id,
       canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,'AUTHENTICATED_OPERATOR_REQUEST',$3,1,'{}',$4)`,
    [SUBJECT, O, SUBJECT, HASH],
  );
  await client.query(
    `INSERT INTO public.research_operation_trigger_bindings
      (trigger_binding_id,operation_id,trigger_type,initiator_identity,
       authorization_canonical,execution_owner,canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,'OPERATOR','wave1','{}','wave1',1,'{}',$3)`,
    [TRIGGER, O, HASH],
  );
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query(
    "INSERT INTO public.scheduler_policy_streams (policy_id,operation_id) VALUES ($1,$2)",
    [POLICY, O],
  );
  await client.query(
    `INSERT INTO public.scheduler_policy_versions
      (policy_id,version,enabled,effective_at,first_eligibility_at,
       fixed_interval_micros,canonical_version,canonical,canonical_hash)
     VALUES ($1,1,true,$2,$2,1000000,1,'{}',$3)`,
    [POLICY, TS, HASH],
  );
  await client.query(
    `INSERT INTO public.scheduler_lifecycle_prefix_manifests
      (manifest_id,operation_id,policy_id,slot_index,evaluation_at,
       canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,$3,0,$4,1,'{}',$5),
            ($6,$2,$3,1,$4,1,'{}',$5),
            ($7,$2,$3,2,$4,1,'{}',$5),
            ($8,$2,$3,3,$4,1,'{}',$5)`,
    [
      "40000000-0000-0000-0000-000000000001",
      O,
      POLICY,
      TS,
      HASH,
      "40000000-0000-0000-0000-000000000002",
      "40000000-0000-0000-0000-000000000003",
      "40000000-0000-0000-0000-000000000004",
    ],
  );
  await client.query(
    `INSERT INTO public.scheduler_lifecycle_prefix_members
      (manifest_id,authority_kind,authoritative_time,authority_identity,
       authority_canonical_version,authority_canonical_hash)
     VALUES ($1,'OPERATION_CREATED',$2,$3,1,$4)`,
    ["40000000-0000-0000-0000-000000000001", TS, O, HASH],
  );
  await client.query(
    `INSERT INTO public.scheduler_decisions
      (operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,
       scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,
       operation_manifest_hash,canonical_version,canonical,canonical_hash,
       run_now_binding_identity,run_now_run_id)
     VALUES ($1,$2,0,1,$3,$4,$4,'RUN_NOW','INITIAL_ELIGIBILITY',$5,$6,$3,1,'{}',$3,'genesis',$7)`,
    [
      O,
      POLICY,
      HASH,
      TS,
      "2026-09-18T12:00:01.000000Z",
      "40000000-0000-0000-0000-000000000001",
      RUN,
    ],
  );
  await client.query(
    `INSERT INTO public.scheduler_decisions
      (operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,
       scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,
       operation_manifest_hash,active_run_id,active_run_creation_identity,
       active_run_creation_hash,active_run_historical_state,
       active_run_running_event_identity,active_run_running_event_hash,
       previous_operation_id,previous_policy_id,previous_slot_index,
       previous_decision_canonical_hash,canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,1,1,$3,$4,$4,'NO_ACTION','ACTIVE_RUN',$5,$6,$3,$7,$7,$3,'RUNNING',$8,$3,$1,$2,0,$3,1,'{}',$3)`,
    [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000002", RUN, "50000000-0000-0000-0000-000000000001"],
  );
  await client.query(
    `INSERT INTO public.research_runs
      (run_id,operation_id,strategy_identity,strategy_version,provider_identity,
       adapter_identity,adapter_version,execution_parameters_canonical,run_created_at,
       deadline_at,canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,'wave1',1,'wave1','wave1','1','{}',$3,$4,1,'{}',$5)`,
    [RUN, O, TS, "2026-09-18T13:00:00.000000Z", HASH],
  );
  await client.query(
    `INSERT INTO public.scheduler_run_now_bindings
      (operation_id,policy_id,slot_index,run_id,canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,0,$3,1,'{}',$4)`,
    [O, POLICY, RUN, HASH],
  );
  await client.query("COMMIT");
}

test("Scheduler Wave 1 physical catalog and row constraints", { skip: !enabled }, async () => {
  const client = await pool.connect();
  try {
    const version = await client.query("SELECT version(), current_setting('server_encoding') AS encoding");
    assert.match(version.rows[0].version, /^PostgreSQL 16\./);
    assert.equal(version.rows[0].encoding, "UTF8");

    const tableRows = await client.query(
      `SELECT tablename FROM pg_catalog.pg_tables
       WHERE schemaname='public' AND tablename LIKE 'scheduler_%'
       ORDER BY tablename`,
    );
    assert.deepEqual(tableRows.rows.map((row) => row.tablename), TABLES);

    const columnRows = await client.query(
      `SELECT table_name,column_name,data_type,udt_name,is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name = ANY($1::text[])
       ORDER BY table_name,ordinal_position`,
      [TABLES],
    );
    assert.equal(columnRows.rows.length > 0, true);
    const byTable = new Map();
    for (const row of columnRows.rows) {
      if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
      byTable.get(row.table_name).push(row);
    }
    for (const table of TABLES) {
      assert.deepEqual(byTable.get(table).map((row) => row.column_name), EXPECTED_COLUMNS[table]);
    }
    assert.equal(byTable.get("scheduler_policy_streams").find((x) => x.column_name === "operation_id").is_nullable, "NO");
    assert.equal(byTable.get("scheduler_policy_versions").find((x) => x.column_name === "version").udt_name, "int8");
    assert.equal(byTable.get("scheduler_policy_versions").find((x) => x.column_name === "fixed_interval_micros").udt_name, "int8");
    assert.equal(byTable.get("scheduler_decisions").find((x) => x.column_name === "slot_index").udt_name, "int8");
    assert.equal(byTable.get("scheduler_decisions").find((x) => x.column_name === "evaluation_at").udt_name, "timestamptz");
    assert.equal(byTable.get("scheduler_lifecycle_prefix_members").find((x) => x.column_name === "authoritative_time").udt_name, "timestamptz");

    const fks = await client.query(
      `SELECT conname,confdeltype,confupdtype
       FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
       WHERE t.relnamespace='public'::regnamespace AND t.relname LIKE 'scheduler_%' AND c.contype='f'`,
    );
    assert.equal(fks.rows.length, 11);
    assert.ok(fks.rows.every((row) => row.confdeltype === "a" && row.confupdtype === "a"));
    const constraints = await client.query(
      `SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
       WHERE t.relnamespace='public'::regnamespace AND t.relname LIKE 'scheduler_%'`,
    );
    const expectedConstraints = [
      "fk_scheduler_stream_operation", "pk_scheduler_policy_versions", "uq_scheduler_policy_versions_effective", "fk_scheduler_policy_version_stream", "chk_scheduler_policy_version_positive", "chk_scheduler_policy_interval_positive", "chk_scheduler_policy_canonical_version", "chk_scheduler_policy_canonical_nonempty", "chk_scheduler_policy_canonical_hash",
      "uq_scheduler_manifest_decision_identity", "fk_scheduler_manifest_operation", "fk_scheduler_manifest_stream", "chk_scheduler_manifest_slot_nonnegative", "chk_scheduler_manifest_canonical_version", "chk_scheduler_manifest_canonical_nonempty", "chk_scheduler_manifest_canonical_hash",
      "pk_scheduler_decisions", "fk_scheduler_decision_operation", "fk_scheduler_decision_stream", "fk_scheduler_decision_policy_version", "fk_scheduler_decision_manifest", "chk_scheduler_decision_slot_nonnegative", "chk_scheduler_decision_policy_hash", "chk_scheduler_decision_manifest_hash", "chk_scheduler_decision_canonical_version", "chk_scheduler_decision_canonical_nonempty", "chk_scheduler_decision_canonical_hash", "chk_scheduler_decision_predecessor_shape", "chk_scheduler_decision_reason_matrix", "chk_scheduler_decision_next_eligibility", "chk_scheduler_decision_active_run_evidence", "chk_scheduler_decision_run_now_binding_evidence",
      "pk_scheduler_manifest_members", "fk_scheduler_manifest_member_manifest", "chk_scheduler_manifest_member_identity", "chk_scheduler_manifest_member_version", "chk_scheduler_manifest_member_hash",
      "pk_scheduler_run_now_bindings", "uq_scheduler_run_now_binding_run", "fk_scheduler_binding_decision", "fk_scheduler_binding_run", "chk_scheduler_binding_slot_nonnegative", "chk_scheduler_binding_canonical_version", "chk_scheduler_binding_canonical_nonempty", "chk_scheduler_binding_canonical_hash",
    ];
    const actualConstraints = new Set(constraints.rows.map((row) => row.conname));
    for (const constraint of expectedConstraints) assert.ok(actualConstraints.has(constraint), `missing constraint ${constraint}`);
    const indexes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'scheduler_%'`,
    );
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    for (const index of ["uq_scheduler_decision_genesis", "uq_scheduler_decision_successor", "idx_scheduler_policy_versions_owner", "idx_scheduler_manifest_members_order"]) assert.ok(indexNames.has(index), `missing index ${index}`);
    const triggers = await client.query(
      `SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'scheduler_%' AND NOT tgisinternal
       ORDER BY tgname`,
    );
    assert.equal(triggers.rows.length, 6);

    await installFixtures(client);
    const valid = await client.query("SELECT count(*)::int AS count FROM public.scheduler_decisions");
    assert.equal(valid.rows[0].count, 2);

    await client.query("BEGIN");
    await assert.rejects(() => client.query("INSERT INTO public.scheduler_policy_streams(policy_id,operation_id) VALUES ($1,$2)", ["20000000-0000-0000-0000-000000000002", O]));
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES ($1,0,true,$2,$2,1,1,'{}',$3)`, [POLICY, TS, HASH]));
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_policy_versions(policy_id,version,enabled,effective_at,first_eligibility_at,fixed_interval_micros,canonical_version,canonical,canonical_hash) VALUES ($1,3,true,$2,$2,0,1,'{}',$3)`, [POLICY, TS, HASH]));
    await client.query("ROLLBACK");

    const manifest = "40000000-0000-0000-0000-000000000003";
    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_lifecycle_prefix_manifests(manifest_id,operation_id,policy_id,slot_index,evaluation_at,canonical_version,canonical,canonical_hash) VALUES ($1,$2,$3,-1,$4,1,'{}',$5)`, [manifest, O, POLICY, TS, HASH]));
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,previous_decision_canonical_hash,canonical_version,canonical,canonical_hash,run_now_binding_identity,run_now_run_id) VALUES ($1,$2,4,1,$3,$4,$4,'NO_ACTION','INITIAL_ELIGIBILITY',$5,$6,$3,$1,$2,1,$3,1,'{}',$3,NULL,NULL)`, [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000003"]));
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,canonical_version,canonical,canonical_hash,run_now_binding_identity,run_now_run_id) VALUES ($1,$2,4,1,$3,$4,$4,'RUN_NOW','INITIAL_ELIGIBILITY',$5,$6,$3,$1,$2,1,1,'{}',$3,NULL,NULL)`, [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000003"]));
    await client.query("ROLLBACK");

    for (const predecessorValues of [
      [O, null, null, null],
      [O, POLICY, 1, null],
      [null, POLICY, null, HASH],
    ]) {
      await client.query("BEGIN");
      await assert.rejects(() => client.query(`INSERT INTO public.scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,previous_decision_canonical_hash,canonical_version,canonical,canonical_hash,run_now_binding_identity,run_now_run_id) VALUES ($1,$2,4,1,$3,$4,$4,'RUN_NOW','INTERVAL_ELIGIBILITY',$5,$6,$3,$7,$8,$9,$10,1,'{}',$3,'partial',$11)`, [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000003", ...predecessorValues, RUN]));
      await client.query("ROLLBACK");
    }

    // At-most-one genesis and at-most-one successor are physical guards;
    // chain existence, hash authentication, and monotonicity remain later
    // Writer/Reader invariants.
    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,canonical_version,canonical,canonical_hash,run_now_binding_identity,run_now_run_id) VALUES ($1,$2,2,1,$3,$4,$4,'RUN_NOW','INITIAL_ELIGIBILITY',$5,$6,$3,1,'{}',$3,'second-genesis',$7)`, [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000003", RUN]));
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,previous_decision_canonical_hash,canonical_version,canonical,canonical_hash,run_now_binding_identity,run_now_run_id) VALUES ($1,$2,3,1,$3,$4,$4,'RUN_NOW','INTERVAL_ELIGIBILITY',$5,$6,$3,$1,$2,0,$3,1,'{}',$3,'second-successor',$7)`, [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000004", RUN]));
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,canonical_version,canonical,canonical_hash,run_now_binding_identity,run_now_run_id) VALUES ($1,$2,0,1,$3,$4,$4,'RUN_NOW','INITIAL_ELIGIBILITY',$5,$6,$3,1,'{}',$3,'duplicate-slot',$7)`, [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000001", RUN]));
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,canonical_version,canonical,canonical_hash,run_now_binding_identity,run_now_run_id) VALUES ($1,$2,4,1,$3,$4,$4,'RUN_NOW','INTERVAL_ELIGIBILITY',$5,$6,$3,$1,$2,1,1,'{}',$3,NULL,$7)`, [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000003", RUN]));
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query(`INSERT INTO public.scheduler_decisions(operation_id,policy_id,slot_index,policy_version,policy_version_canonical_hash,scheduled_at,evaluation_at,decision,reason,next_eligible_at,manifest_id,operation_manifest_hash,previous_operation_id,previous_policy_id,previous_slot_index,previous_decision_canonical_hash,canonical_version,canonical,canonical_hash,run_now_binding_identity,run_now_run_id) VALUES ($1,$2,3,1,$3,$4,$4,'RUN_NOW','INTERVAL_ELIGIBILITY',$5,$6,$3,$1,$2,1,$3,1,'{}',$3,'second-run-binding',$7)`, [O, POLICY, HASH, TS, "2026-09-18T12:00:01.000000Z", "40000000-0000-0000-0000-000000000004", RUN]);
    await assert.rejects(() => client.query(`INSERT INTO public.scheduler_run_now_bindings(operation_id,policy_id,slot_index,run_id,canonical_version,canonical,canonical_hash) VALUES ($1,$2,3,$3,1,'{}',$4)`, [O, POLICY, RUN, HASH]));
    await client.query("ROLLBACK");

    const tableKeys = [
      ["scheduler_policy_streams", "policy_id", POLICY],
      ["scheduler_policy_versions", "policy_id", POLICY],
      ["scheduler_decisions", "operation_id", O],
      ["scheduler_lifecycle_prefix_manifests", "manifest_id", "40000000-0000-0000-0000-000000000001"],
      ["scheduler_lifecycle_prefix_members", "manifest_id", "40000000-0000-0000-0000-000000000001"],
      ["scheduler_run_now_bindings", "operation_id", O],
    ];
    for (const [table, key, value] of tableKeys) {
      await client.query("BEGIN");
      await assert.rejects(() => client.query(`UPDATE public.${table} SET ${key} = ${key} WHERE ${key} = $1`, [value]), undefined, `${table} update`);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await assert.rejects(() => client.query(`DELETE FROM public.${table} WHERE ${key} = $1`, [value]), undefined, `${table} delete`);
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
    await pool.end();
  }
});
