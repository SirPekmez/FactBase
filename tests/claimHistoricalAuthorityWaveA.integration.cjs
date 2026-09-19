const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Pool } = require("pg");

const database = process.env.CLAIM_AUTHORITY_WAVE_A_DATABASE;
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

const CLAIMS = {
  legacy: "10000000-0000-0000-0000-000000000001",
  authenticated: "10000000-0000-0000-0000-000000000101",
};
const VERSIONS = {
  legacy: "20000000-0000-0000-0000-000000000001",
  authenticated: "20000000-0000-0000-0000-000000000101",
  second: "20000000-0000-0000-0000-000000000102",
};
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const TS = "2026-09-19T12:00:00.000000Z";
const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "migrations",
  "rcv009_add_claim_historical_authority.sql",
);

const AUTHORITY_TABLES = [
  "claim_identity_authorities",
  "claim_version_authorities",
];
const EXPECTED_AUTHORITY_COLUMNS = {
  claim_identity_authorities: [
    "claim_id",
    "canonical_version",
    "canonical",
    "canonical_hash",
  ],
  claim_version_authorities: [
    "claim_version_id",
    "claim_id",
    "version_number",
    "title",
    "normalized_statement",
    "language",
    "claim_type",
    "canonical_version",
    "canonical",
    "canonical_hash",
  ],
};
const EXPECTED_SOURCE_COLUMNS = {
  claims: ["id"],
  claim_versions: [
    "id",
    "claim_id",
    "version_number",
    "title",
    "normalized_statement",
    "language",
    "claim_type",
    "status",
    "publication_status",
    "change_reason",
    "created_at",
    "based_on_version_id",
    "actor_type",
    "actor_id",
    "source_type",
    "source_reference",
    "request_id",
  ],
};

function migrationFiles() {
  return fs
    .readdirSync(path.join(__dirname, "..", "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(__dirname, "..", "migrations", name));
}

async function replayMigrations() {
  const client = await pool.connect();
  try {
    for (const file of migrationFiles()) {
      if (path.basename(file) === "rcv009_create_claims_historical_authority.sql") {
        await insertLegacyFixtures(client);
      }
      await client.query(fs.readFileSync(file, "utf8"));
    }
  } finally {
    client.release();
  }
}

async function insertLegacyFixtures(client = pool) {
  await client.query("INSERT INTO public.claims (id) VALUES ($1)", [CLAIMS.legacy]);
  await client.query(
    `INSERT INTO public.claim_versions
      (id,claim_id,version_number,title,normalized_statement,language,claim_type,
       status,publication_status,change_reason,created_at)
     VALUES ($1,$2,1,'legacy title','legacy statement','en','fact',
       'draft','unpublished','legacy fixture',$3)`,
    [VERSIONS.legacy, CLAIMS.legacy, TS],
  );
}

async function insertAuthenticatedFixtures() {
  await pool.query("INSERT INTO public.claims (id) VALUES ($1)", [CLAIMS.authenticated]);
  await pool.query(
    `INSERT INTO public.claim_versions
      (id,claim_id,version_number,title,normalized_statement,language,claim_type,
       status,publication_status,change_reason,created_at)
     VALUES ($1,$2,1,'authenticated title','authenticated statement','en','fact',
       'draft','unpublished','authenticated fixture',$3)`,
    [VERSIONS.authenticated, CLAIMS.authenticated, TS],
  );
  await pool.query(
    `INSERT INTO public.claim_identity_authorities
      (claim_id,canonical_version,canonical,canonical_hash)
     VALUES ($1,1,$2,$3)`,
    [CLAIMS.authenticated, "{}", HASH_A],
  );
  await pool.query(
    `INSERT INTO public.claim_version_authorities
      (claim_version_id,claim_id,version_number,title,normalized_statement,
       language,claim_type,canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,1,'authenticated title','authenticated statement',
       'en','fact',1,$3,$4)`,
    [VERSIONS.authenticated, CLAIMS.authenticated, "{}", HASH_B],
  );
}

async function assertRejected(sql, values, label) {
  await assert.rejects(() => pool.query(sql, values), undefined, label);
}

async function snapshot(sql, values = []) {
  const result = await pool.query(sql, values);
  return result.rows;
}

test("Claim Historical Authority Wave A physical proof", { skip: !enabled }, async () => {
  await replayMigrations();

  const identity = await pool.query(
    `SELECT current_database() AS database_name,
            current_setting('server_encoding') AS encoding,
            version() AS version`,
  );
  assert.equal(identity.rows[0].database_name, database);
  assert.equal(identity.rows[0].encoding, "UTF8");
  assert.match(identity.rows[0].version, /^PostgreSQL 16\./);

  const tables = await snapshot(
    `SELECT tablename FROM pg_catalog.pg_tables
     WHERE schemaname = 'public' AND tablename = ANY($1::text[])
     ORDER BY tablename`,
    [AUTHORITY_TABLES],
  );
  assert.deepEqual(tables.map((row) => row.tablename), AUTHORITY_TABLES.slice().sort());

  const columns = await snapshot(
    `SELECT table_name,column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name,ordinal_position`,
    [AUTHORITY_TABLES],
  );
  for (const table of AUTHORITY_TABLES) {
    assert.deepEqual(
      columns.filter((row) => row.table_name === table).map((row) => row.column_name),
      EXPECTED_AUTHORITY_COLUMNS[table],
    );
  }

  const pks = await snapshot(
    `SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
     FROM pg_catalog.pg_constraint
     WHERE contype = 'p'
       AND conrelid::regclass::text = ANY($1::text[])
     ORDER BY table_name`,
    [AUTHORITY_TABLES],
  );
  assert.deepEqual(pks, [
    { table_name: "claim_identity_authorities", definition: "PRIMARY KEY (claim_id)" },
    { table_name: "claim_version_authorities", definition: "PRIMARY KEY (claim_version_id)" },
  ]);

  const uniques = await snapshot(
    `SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
     FROM pg_catalog.pg_constraint
     WHERE contype = 'u'
       AND conrelid::regclass::text = ANY($1::text[])
     ORDER BY table_name`,
    [AUTHORITY_TABLES],
  );
  assert.deepEqual(uniques, [
    {
      table_name: "claim_version_authorities",
      definition: "UNIQUE (claim_id, version_number)",
    },
  ]);

  const foreignKeys = await snapshot(
    `SELECT conname,
            conrelid::regclass::text AS table_name,
            confrelid::regclass::text AS referenced_table,
            pg_get_constraintdef(oid) AS definition,
            confdeltype,
            confupdtype
     FROM pg_catalog.pg_constraint
     WHERE contype = 'f'
       AND conrelid::regclass::text = ANY($1::text[])
     ORDER BY conname`,
    [AUTHORITY_TABLES],
  );
  assert.equal(foreignKeys.length, 4);
  assert.deepEqual(
    foreignKeys.map((row) => [row.table_name, row.referenced_table, row.confdeltype, row.confupdtype]),
    [
      ["claim_identity_authorities", "claims", "a", "a"],
      ["claim_version_authorities", "claims", "a", "a"],
      ["claim_version_authorities", "claim_versions", "a", "a"],
      ["claim_version_authorities", "claim_identity_authorities", "a", "a"],
    ],
  );

  const triggers = await snapshot(
    `SELECT tgname, tgrelid::regclass::text AS table_name
     FROM pg_catalog.pg_trigger
     WHERE NOT tgisinternal
       AND tgrelid::regclass::text = ANY($1::text[])
     ORDER BY tgname`,
    [[
      "claim_identity_authorities",
      "claim_version_authorities",
      "claims",
      "claim_versions",
    ]],
  );
  assert.deepEqual(triggers, [
    { tgname: "trg_claim_authenticated_source_protection", table_name: "claims" },
    { tgname: "trg_claim_identity_authority_immutable", table_name: "claim_identity_authorities" },
    { tgname: "trg_claim_version_authenticated_source_protection", table_name: "claim_versions" },
    { tgname: "trg_claim_version_authority_immutable", table_name: "claim_version_authorities" },
  ]);

  const sourceColumns = await snapshot(
    `SELECT table_name,column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name,ordinal_position`,
    [["claims", "claim_versions"]],
  );
  for (const [table, expected] of Object.entries(EXPECTED_SOURCE_COLUMNS)) {
    assert.deepEqual(
      sourceColumns.filter((row) => row.table_name === table).map((row) => row.column_name),
      expected,
    );
  }

  assert.deepEqual(
    await snapshot("SELECT count(*)::integer AS count FROM public.claim_identity_authorities"),
    [{ count: 0 }],
  );
  assert.deepEqual(
    await snapshot("SELECT count(*)::integer AS count FROM public.claim_version_authorities"),
    [{ count: 0 }],
  );
  await pool.query(
    "UPDATE public.claim_versions SET title = 'legacy mutable update' WHERE id = $1",
    [VERSIONS.legacy],
  );

  await insertAuthenticatedFixtures();
  await pool.query(
    "UPDATE public.claim_versions SET status = 'published' WHERE id = $1",
    [VERSIONS.authenticated],
  );

  const claimBefore = await snapshot(
    "SELECT id FROM public.claims WHERE id = $1",
    [CLAIMS.authenticated],
  );
  await assertRejected(
    "UPDATE public.claims SET id = $2 WHERE id = $1",
    [CLAIMS.authenticated, "10000000-0000-0000-0000-000000000199"],
    "authenticated Claim identity update must fail",
  );
  assert.deepEqual(
    await snapshot("SELECT id FROM public.claims WHERE id = $1", [CLAIMS.authenticated]),
    claimBefore,
  );
  await assertRejected(
    "DELETE FROM public.claims WHERE id = $1",
    [CLAIMS.authenticated],
    "authenticated Claim delete must fail",
  );
  assert.deepEqual(
    await snapshot("SELECT id FROM public.claims WHERE id = $1", [CLAIMS.authenticated]),
    claimBefore,
  );

  const versionBefore = await snapshot(
    `SELECT id,claim_id,version_number,title,normalized_statement,language,claim_type,status
     FROM public.claim_versions WHERE id = $1`,
    [VERSIONS.authenticated],
  );
  await assertRejected(
    "UPDATE public.claim_versions SET title = 'tampered' WHERE id = $1",
    [VERSIONS.authenticated],
    "authenticated ClaimVersion semantic update must fail",
  );
  assert.deepEqual(
    await snapshot(
      `SELECT id,claim_id,version_number,title,normalized_statement,language,claim_type,status
       FROM public.claim_versions WHERE id = $1`,
      [VERSIONS.authenticated],
    ),
    versionBefore,
  );
  await assertRejected(
    "DELETE FROM public.claim_versions WHERE id = $1",
    [VERSIONS.authenticated],
    "authenticated ClaimVersion delete must fail",
  );
  assert.deepEqual(
    await snapshot(
      "SELECT id FROM public.claim_versions WHERE id = $1",
      [VERSIONS.authenticated],
    ),
    [{ id: VERSIONS.authenticated }],
  );

  const authorityBefore = await snapshot(
    "SELECT * FROM public.claim_identity_authorities WHERE claim_id = $1",
    [CLAIMS.authenticated],
  );
  await assertRejected(
    "UPDATE public.claim_identity_authorities SET canonical = 'changed' WHERE claim_id = $1",
    [CLAIMS.authenticated],
    "Claim authority update must fail",
  );
  await assertRejected(
    "DELETE FROM public.claim_identity_authorities WHERE claim_id = $1",
    [CLAIMS.authenticated],
    "Claim authority delete must fail",
  );
  assert.deepEqual(
    await snapshot(
      "SELECT * FROM public.claim_identity_authorities WHERE claim_id = $1",
      [CLAIMS.authenticated],
    ),
    authorityBefore,
  );

  const versionAuthorityBefore = await snapshot(
    "SELECT * FROM public.claim_version_authorities WHERE claim_version_id = $1",
    [VERSIONS.authenticated],
  );
  await assertRejected(
    "UPDATE public.claim_version_authorities SET title = 'changed' WHERE claim_version_id = $1",
    [VERSIONS.authenticated],
    "ClaimVersion authority update must fail",
  );
  await assertRejected(
    "DELETE FROM public.claim_version_authorities WHERE claim_version_id = $1",
    [VERSIONS.authenticated],
    "ClaimVersion authority delete must fail",
  );
  assert.deepEqual(
    await snapshot(
      "SELECT * FROM public.claim_version_authorities WHERE claim_version_id = $1",
      [VERSIONS.authenticated],
    ),
    versionAuthorityBefore,
  );

  await assertRejected(
    `INSERT INTO public.claim_identity_authorities
      (claim_id,canonical_version,canonical,canonical_hash)
     VALUES ($1,2,'{}',$2)`,
    [CLAIMS.legacy, HASH_A],
    "canonical version check must fail",
  );
  await assertRejected(
    `INSERT INTO public.claim_identity_authorities
      (claim_id,canonical_version,canonical,canonical_hash)
     VALUES ($1,1,'{}','NOT_A_HASH')`,
    [CLAIMS.legacy],
    "canonical hash check must fail",
  );
  await assertRejected(
    `INSERT INTO public.claim_identity_authorities
      (claim_id,canonical_version,canonical,canonical_hash)
     VALUES ($1,1,'{}',$2)`,
    [CLAIMS.authenticated, HASH_A],
    "duplicate Claim authority must fail",
  );
  await assertRejected(
    `INSERT INTO public.claim_version_authorities
      (claim_version_id,claim_id,version_number,title,normalized_statement,
       language,claim_type,canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,1,'authenticated title','authenticated statement',
       'en','fact',1,'{}',$3)`,
    [VERSIONS.authenticated, CLAIMS.authenticated, HASH_B],
    "duplicate ClaimVersion authority must fail",
  );

  await pool.query(
    `INSERT INTO public.claim_versions
      (id,claim_id,version_number,title,normalized_statement,language,claim_type,
       status,publication_status,change_reason,created_at)
     VALUES ($1,$2,2,'second','second','en','fact','draft','unpublished','fixture',$3)`,
    [VERSIONS.second, CLAIMS.authenticated, TS],
  );
  await assertRejected(
    `INSERT INTO public.claim_version_authorities
      (claim_version_id,claim_id,version_number,title,normalized_statement,
       language,claim_type,canonical_version,canonical,canonical_hash)
     VALUES ($1,$2,1,'second','second','en','fact',1,'{}',$3)`,
    [VERSIONS.second, CLAIMS.authenticated, HASH_B],
    "duplicate Claim/version authority must fail",
  );

  assert.deepEqual(
    await snapshot(
      `SELECT count(*)::integer AS count
       FROM public.claim_identity_authorities WHERE claim_id = $1`,
      [CLAIMS.authenticated],
    ),
    [{ count: 1 }],
  );
  assert.deepEqual(
    await snapshot(
      `SELECT count(*)::integer AS count
       FROM public.claim_version_authorities WHERE claim_id = $1`,
      [CLAIMS.authenticated],
    ),
    [{ count: 1 }],
  );
});

test.after(async () => {
  await pool?.end();
});
