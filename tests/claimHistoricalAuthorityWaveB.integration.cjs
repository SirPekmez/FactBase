const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");

const database = process.env.CLAIM_AUTHORITY_WAVE_B_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled
  ? new Pool({
      database,
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      max: 8,
    })
  : null;

const CLAIMS = {
  legacy: "10000000-0000-0000-0000-000000000201",
  primary: "10000000-0000-0000-0000-000000000301",
  duplicate: "10000000-0000-0000-0000-000000000302",
  concurrent: "10000000-0000-0000-0000-000000000303",
};
const VERSIONS = {
  legacy: "20000000-0000-0000-0000-000000000201",
  primaryOne: "20000000-0000-0000-0000-000000000301",
  primaryTwo: "20000000-0000-0000-0000-000000000302",
  concurrent: "20000000-0000-0000-0000-000000000303",
  logicalDuplicate: "20000000-0000-0000-0000-000000000304",
};
const TS = "2026-09-19T12:00:00.000000Z";
const MIGRATION_ROOT = path.join(__dirname, "..", "migrations");

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function migrationFiles() {
  return fs
    .readdirSync(MIGRATION_ROOT)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(MIGRATION_ROOT, name));
}

async function insertSourceClaim(client, claimId) {
  await client.query("INSERT INTO public.claims (id) VALUES ($1)", [claimId]);
}

async function insertSourceVersion(
  client,
  versionId,
  claimId,
  versionNumber,
  fields = {},
) {
  await client.query(
    `INSERT INTO public.claim_versions
      (id,claim_id,version_number,title,normalized_statement,language,claim_type,
       status,publication_status,change_reason,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','unpublished','wave-b fixture',$8)`,
    [
      versionId,
      claimId,
      versionNumber,
      fields.title ?? `title-${versionNumber}`,
      fields.normalizedStatement ?? `statement-${versionNumber}`,
      fields.language ?? "en",
      fields.claimType ?? "fact",
      TS,
    ],
  );
}

async function replayMigrations() {
  const client = await pool.connect();
  try {
    for (const file of migrationFiles()) {
      if (path.basename(file) === "rcv009_create_claims_historical_authority.sql") {
        await insertSourceClaim(client, CLAIMS.legacy);
        await insertSourceVersion(client, VERSIONS.legacy, CLAIMS.legacy, 1, {
          title: "legacy",
          normalizedStatement: "legacy statement",
        });
      }
      await client.query(fs.readFileSync(file, "utf8"));
    }
  } finally {
    client.release();
  }
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function countRows(table, column, value) {
  const result = await pool.query(
    `SELECT count(*)::integer AS count FROM public.${table} WHERE ${column} = $1`,
    [value],
  );
  return result.rows[0].count;
}

async function assertAbsent(claimId, versionId) {
  assert.equal(await countRows("claims", "id", claimId), 0);
  assert.equal(await countRows("claim_versions", "id", versionId), 0);
  assert.equal(await countRows("claim_identity_authorities", "claim_id", claimId), 0);
  assert.equal(await countRows("claim_version_authorities", "claim_version_id", versionId), 0);
}

test("Claim Historical Authority Wave B canonical and composable writer proof", { skip: !enabled }, async () => {
  await replayMigrations();
  const {
    buildClaimIdentityCanonical,
    buildClaimVersionCanonical,
  } = require("../dist/services/claimHistoricalAuthorityCanonical");
  const {
    persistClaimIdentityAuthorityWithinTransaction,
    persistClaimVersionAuthorityWithinTransaction,
    ClaimAuthorityWriterError,
  } = require("../dist/services/claimHistoricalAuthorityWriter");
  const {
    createClaimWithInitialVersionAndAuthority,
    createClaimWithInitialVersionWithinTransaction,
  } = require("../dist/services/claimService");
  const {
    createClaimVersionWithAuthority,
    createClaimVersionWithinTransaction,
  } = require("../dist/services/claimVersionService");

  const identity = await pool.query(
    `SELECT current_database() AS database_name,
            current_setting('server_encoding') AS encoding,
            version() AS version`,
  );
  assert.equal(identity.rows[0].database_name, database);
  assert.equal(identity.rows[0].encoding, "UTF8");
  assert.match(identity.rows[0].version, /^PostgreSQL 16\./);

  assert.equal(await countRows("claim_identity_authorities", "claim_id", CLAIMS.legacy), 0);
  assert.equal(await countRows("claim_version_authorities", "claim_version_id", VERSIONS.legacy), 0);
  await pool.query(
    "UPDATE public.claim_versions SET title = 'legacy remains mutable' WHERE id = $1",
    [VERSIONS.legacy],
  );

  const created = await createClaimWithInitialVersionAndAuthority(
    {
      title: " exact title ",
      normalizedStatement: "  exact statement  ",
      language: "EN",
      claimType: "Fact",
    },
    pool,
  );
  const sourceVersion = await pool.query(
    `SELECT id,claim_id,version_number,title,normalized_statement,language,claim_type
     FROM public.claim_versions WHERE id = $1`,
    [created.version.id],
  );
  const persistedVersion = await pool.query(
    `SELECT claim_version_id,claim_id,version_number,title,normalized_statement,
            language,claim_type,canonical_version,canonical,canonical_hash
     FROM public.claim_version_authorities WHERE claim_version_id = $1`,
    [created.version.id],
  );
  const expectedVersion = buildClaimVersionCanonical({
    claimId: sourceVersion.rows[0].claim_id,
    claimVersionId: sourceVersion.rows[0].id,
    versionNumber: sourceVersion.rows[0].version_number,
    title: sourceVersion.rows[0].title,
    normalizedStatement: sourceVersion.rows[0].normalized_statement,
    language: sourceVersion.rows[0].language,
    claimType: sourceVersion.rows[0].claim_type,
  });
  assert.equal(persistedVersion.rows[0].canonical, expectedVersion.canonical);
  assert.equal(persistedVersion.rows[0].canonical_hash, expectedVersion.hash);
  assert.equal(persistedVersion.rows[0].canonical_hash, hash(expectedVersion.canonical));
  assert.equal(persistedVersion.rows[0].title, sourceVersion.rows[0].title);
  assert.equal(persistedVersion.rows[0].normalized_statement, sourceVersion.rows[0].normalized_statement);

  const identityRow = await pool.query(
    `SELECT claim_id,canonical_version,canonical,canonical_hash
     FROM public.claim_identity_authorities WHERE claim_id = $1`,
    [created.id],
  );
  const expectedIdentity = buildClaimIdentityCanonical({ claimId: created.id });
  assert.equal(identityRow.rows[0].canonical, expectedIdentity.canonical);
  assert.equal(identityRow.rows[0].canonical_hash, expectedIdentity.hash);
  assert.equal(identityRow.rows[0].canonical_hash.length, 64);
  assert.match(identityRow.rows[0].canonical_hash, /^[0-9a-f]{64}$/);

  const revision = await createClaimVersionWithAuthority(
    {
      claimId: created.id,
      basedOnVersionNumber: 1,
      title: "revision title",
      normalizedStatement: "revision statement",
      language: "en",
      claimType: "fact",
      changeReason: "wave-b revision",
    },
    pool,
  );
  assert.equal(revision.version.versionNumber, 2);
  assert.equal(await countRows("claim_version_authorities", "claim_version_id", revision.version.id), 1);

  const rollbackIds = [
    ["30000000-0000-0000-0000-000000000401", "40000000-0000-0000-0000-000000000401"],
    ["30000000-0000-0000-0000-000000000402", "40000000-0000-0000-0000-000000000402"],
    ["30000000-0000-0000-0000-000000000403", "40000000-0000-0000-0000-000000000403"],
    ["30000000-0000-0000-0000-000000000404", "40000000-0000-0000-0000-000000000404"],
  ];
  for (const [index, [claimId, versionId]] of rollbackIds.entries()) {
    const failure = new Error(`injected rollback ${index}`);
    await assert.rejects(
      withTransaction(async (client) => {
        await insertSourceClaim(client, claimId);
        if (index >= 1) {
          await persistClaimIdentityAuthorityWithinTransaction(client, claimId);
        }
        if (index >= 2) {
          await insertSourceVersion(client, versionId, claimId, 1);
        }
        if (index >= 3) {
          await persistClaimVersionAuthorityWithinTransaction(client, versionId);
        }
        throw failure;
      }),
      failure,
    );
    await assertAbsent(claimId, versionId);
  }

  const missingParentClaim = "30000000-0000-0000-0000-000000000405";
  const missingParentVersion = "40000000-0000-0000-0000-000000000405";
  await withTransaction(async (client) => {
    await insertSourceClaim(client, missingParentClaim);
    await insertSourceVersion(client, missingParentVersion, missingParentClaim, 1);
  });
  await assert.rejects(
    withTransaction((client) =>
      persistClaimVersionAuthorityWithinTransaction(client, missingParentVersion),
    ),
    (error) => error instanceof ClaimAuthorityWriterError && error.code === "MISSING_PARENT_CLAIM_AUTHORITY",
  );
  assert.equal(await countRows("claim_version_authorities", "claim_version_id", missingParentVersion), 0);

  const retryIdentity = await withTransaction((client) =>
    persistClaimIdentityAuthorityWithinTransaction(client, created.id),
  );
  assert.equal(retryIdentity.canonicalHash, expectedIdentity.hash);
  const retryVersion = await withTransaction((client) =>
    persistClaimVersionAuthorityWithinTransaction(client, created.version.id),
  );
  assert.equal(retryVersion.canonicalHash, expectedVersion.hash);

  await withTransaction(async (client) => {
    await insertSourceClaim(client, CLAIMS.duplicate);
    await client.query(
      `INSERT INTO public.claim_identity_authorities
        (claim_id,canonical_version,canonical,canonical_hash)
       VALUES ($1,1,'{}',$2)`,
      [CLAIMS.duplicate, "a".repeat(64)],
    );
  });
  await assert.rejects(
    withTransaction((client) =>
      persistClaimIdentityAuthorityWithinTransaction(client, CLAIMS.duplicate),
    ),
    (error) => error instanceof ClaimAuthorityWriterError && error.code === "DUPLICATE_DIVERGENCE",
  );
  assert.equal(await countRows("claim_identity_authorities", "claim_id", CLAIMS.duplicate), 1);

  await withTransaction(async (client) => {
    await insertSourceClaim(client, CLAIMS.concurrent);
    await insertSourceVersion(client, VERSIONS.concurrent, CLAIMS.concurrent, 1);
    await persistClaimIdentityAuthorityWithinTransaction(client, CLAIMS.concurrent);
  });
  const concurrentIdentityClaim = "10000000-0000-0000-0000-000000000305";
  await withTransaction((client) => insertSourceClaim(client, concurrentIdentityClaim));
  const identityFirst = await pool.connect();
  const identitySecond = await pool.connect();
  try {
    await identityFirst.query("BEGIN");
    const identityFirstPromise = persistClaimIdentityAuthorityWithinTransaction(
      identityFirst,
      concurrentIdentityClaim,
    );
    await identitySecond.query("BEGIN");
    const identitySecondPromise = persistClaimIdentityAuthorityWithinTransaction(
      identitySecond,
      concurrentIdentityClaim,
    );
    await identityFirst.query("COMMIT");
    const [identityFirstResult, identitySecondResult] = await Promise.all([
      identityFirstPromise,
      identitySecondPromise,
    ]);
    await identitySecond.query("COMMIT");
    assert.equal(identityFirstResult.canonicalHash, identitySecondResult.canonicalHash);
  } finally {
    identityFirst.release();
    identitySecond.release();
  }
  assert.equal(await countRows("claim_identity_authorities", "claim_id", concurrentIdentityClaim), 1);

  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query("BEGIN");
    const firstResult = await persistClaimVersionAuthorityWithinTransaction(first, VERSIONS.concurrent);
    await second.query("BEGIN");
    const secondPromise = persistClaimVersionAuthorityWithinTransaction(second, VERSIONS.concurrent);
    await first.query("COMMIT");
    const secondResult = await secondPromise;
    await second.query("COMMIT");
    assert.equal(firstResult.canonicalHash, secondResult.canonicalHash);
  } finally {
    first.release();
    second.release();
  }
  assert.equal(await countRows("claim_version_authorities", "claim_version_id", VERSIONS.concurrent), 1);

  const logicalCreated = await createClaimWithInitialVersionAndAuthority(
    {
      title: "logical concurrency base",
      normalizedStatement: "logical concurrency base",
      language: "en",
      claimType: "fact",
    },
    pool,
  );
  const logicalClaimId = logicalCreated.id;
  const logicalInputs = [
    {
      claimId: logicalClaimId,
      basedOnVersionNumber: 1,
      title: "logical A",
      normalizedStatement: "logical A",
      language: "en",
      claimType: "fact",
      changeReason: "concurrent A",
    },
    {
      claimId: logicalClaimId,
      basedOnVersionNumber: 1,
      title: "logical B",
      normalizedStatement: "logical B",
      language: "en",
      claimType: "fact",
      changeReason: "concurrent B",
    },
  ];
  const logicalResults = await Promise.all(
    logicalInputs.map((input) =>
      createClaimVersionWithAuthority(input, pool).then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
    ),
  );
  assert.equal(logicalResults.filter((result) => result.value).length, 1);
  assert.equal(
    logicalResults.filter(
      (result) => result.error?.name === "ClaimVersionConflictError",
    ).length,
    1,
  );
  assert.equal(await countRows("claim_versions", "claim_id", logicalClaimId), 2);
  assert.equal(await countRows("claim_version_authorities", "claim_id", logicalClaimId), 2);

});

test.after(async () => {
  await pool?.end();
});
