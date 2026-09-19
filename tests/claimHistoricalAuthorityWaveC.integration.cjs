const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");

const database = process.env.CLAIM_AUTHORITY_WAVE_C_DATABASE;
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
const MIGRATION_ROOT = path.join(__dirname, "..", "migrations");
const LEGACY_CLAIM = "50000000-0000-4000-8000-000000000001";
const LEGACY_VERSION = "60000000-0000-4000-8000-000000000001";
const TS = "2026-09-19T12:00:00.000000Z";

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

async function insertClaim(client, claimId) {
  await client.query("INSERT INTO public.claims (id) VALUES ($1)", [claimId]);
}

async function insertVersion(client, versionId, claimId, fields = {}) {
  await client.query(
    `INSERT INTO public.claim_versions
      (id,claim_id,version_number,title,normalized_statement,language,claim_type,
       status,publication_status,change_reason,created_at)
     VALUES ($1,$2,1,$3,$4,$5,$6,'draft','unpublished','wave-c fixture',$7)`,
    [
      versionId,
      claimId,
      fields.title ?? "title",
      fields.normalizedStatement ?? "statement",
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
        await insertClaim(client, LEGACY_CLAIM);
        await insertVersion(client, LEGACY_VERSION, LEGACY_CLAIM, {
          title: "legacy title",
          normalizedStatement: "legacy statement",
        });
      }
      await client.query(fs.readFileSync(file, "utf8"));
    }
  } finally {
    client.release();
  }
}

async function withOwnerTransaction(work) {
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

async function readRows(table, where, values) {
  const result = await pool.query(
    `SELECT * FROM public.${table} WHERE ${where} ORDER BY 1`,
    values,
  );
  return result.rows;
}

async function snapshot(claimId, versionId) {
  return JSON.stringify({
    claim: await readRows("claims", "id = $1", [claimId]),
    version: await readRows("claim_versions", "id = $1", [versionId]),
    claimAuthority: await readRows("claim_identity_authorities", "claim_id = $1", [claimId]),
    versionAuthority: await readRows("claim_version_authorities", "claim_version_id = $1", [versionId]),
  });
}

async function expectFailure(reader, fn, code) {
  await assert.rejects(fn, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

async function disableTrigger(table, trigger, work) {
  await pool.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`);
  try {
    return await work();
  } finally {
    await pool.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`);
  }
}

async function disableUserTriggers(table, work) {
  await pool.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`);
  try {
    return await work();
  } finally {
    await pool.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`);
  }
}

async function disableAllTriggers(table, work) {
  await pool.query(`ALTER TABLE public.${table} DISABLE TRIGGER ALL`);
  try {
    return await work();
  } finally {
    await pool.query(`ALTER TABLE public.${table} ENABLE TRIGGER ALL`);
  }
}

async function replaceConstraint(table, name, definition, work) {
  await pool.query(`ALTER TABLE public.${table} DROP CONSTRAINT ${name}`);
  try {
    return await work();
  } finally {
    await pool.query(`ALTER TABLE public.${table} ADD CONSTRAINT ${name} CHECK (${definition})`);
  }
}

async function createSelectOnlyRole() {
  const role = `claim_wave_c_reader_${process.pid}`;
  await pool.query(`DROP ROLE IF EXISTS "${role}"`);
  await pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'wave-c-reader'`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await pool.query(`REVOKE CREATE ON SCHEMA public FROM "${role}"`);
  for (const table of [
    "claims",
    "claim_versions",
    "claim_identity_authorities",
    "claim_version_authorities",
  ]) {
    await pool.query(`GRANT SELECT ON public.${table} TO "${role}"`);
    await pool.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.${table} FROM "${role}"`);
  }
  return role;
}

test("Claim Historical Authority Wave C independent Reader/Verifier proof", { skip: !enabled }, async () => {
  await replayMigrations();
  const canonical = require("../dist/services/claimHistoricalAuthorityCanonical");
  const claimService = require("../dist/services/claimService");
  const reader = require("../dist/services/claimHistoricalAuthorityReader");

  const identity = await pool.query(
    `SELECT current_database() AS database_name,
            current_setting('server_encoding') AS encoding,
            version() AS version`,
  );
  assert.equal(identity.rows[0].database_name, database);
  assert.equal(identity.rows[0].encoding, "UTF8");
  assert.match(identity.rows[0].version, /^PostgreSQL 16\./);

  await expectFailure(
    reader,
    () => reader.verifyClaimIdentityAuthorityWithinClient(pool, "70000000-0000-4000-8000-000000000001"),
    "MISSING_SOURCE_CLAIM",
  );
  await expectFailure(reader, () => reader.verifyClaimIdentityAuthorityWithinClient(pool, LEGACY_CLAIM), "UNAUTHENTICATED_LEGACY_CLAIM");
  await expectFailure(reader, () => reader.verifyClaimVersionAuthorityWithinClient(pool, LEGACY_VERSION), "UNAUTHENTICATED_LEGACY_CLAIMVERSION");

  const created = await claimService.createClaimWithInitialVersionAndAuthority(
    {
      title: " exact title Ω ",
      normalizedStatement: "  exact statement é  ",
      language: "EN",
      claimType: "Fact",
    },
    pool,
  );
  const claimId = created.id;
  const versionId = created.version.id;
  const expectedClaim = canonical.buildClaimIdentityCanonical({ claimId });
  const expectedVersion = canonical.buildClaimVersionCanonical({
    claimId,
    claimVersionId: versionId,
    versionNumber: 1,
    title: " exact title Ω ",
    normalizedStatement: "  exact statement é  ",
    language: "EN",
    claimType: "Fact",
  });

  const verifiedClaim = await reader.verifyClaimIdentityAuthority(claimId, pool);
  const verifiedVersion = await reader.verifyClaimVersionAuthority(versionId, pool);
  assert.deepEqual(verifiedClaim, { verified: true, claimId, canonicalVersion: 1, canonicalHash: expectedClaim.hash });
  assert.deepEqual(verifiedVersion, { verified: true, claimId, claimVersionId: versionId, versionNumber: 1, canonicalVersion: 1, canonicalHash: expectedVersion.hash });

  const role = await createSelectOnlyRole();
  const restricted = new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: role, password: "wave-c-reader", max: 2 });
  try {
    const grants = await pool.query(
      `SELECT has_table_privilege($1, 'public.claims', 'SELECT') AS can_select,
              has_table_privilege($1, 'public.claims', 'INSERT') AS can_insert,
              has_table_privilege($1, 'public.claims', 'UPDATE') AS can_update,
              has_table_privilege($1, 'public.claims', 'DELETE') AS can_delete`,
      [role],
    );
    assert.deepEqual(grants.rows[0], { can_select: true, can_insert: false, can_update: false, can_delete: false });
    assert.deepEqual(await reader.verifyClaimIdentityAuthority(claimId, restricted), verifiedClaim);
    assert.deepEqual(await reader.verifyClaimVersionAuthority(versionId, restricted), verifiedVersion);
    await restricted.end();
  } finally {
    await restricted.end().catch(() => {});
    await pool.query(`DROP OWNED BY "${role}"`);
    await pool.query(`DROP ROLE IF EXISTS "${role}"`);
  }

  const baseline = await snapshot(claimId, versionId);
  assert.deepEqual(await reader.verifyClaimIdentityAuthority(claimId, pool), verifiedClaim);
  assert.deepEqual(await reader.verifyClaimVersionAuthority(versionId, pool), verifiedVersion);
  assert.equal(await snapshot(claimId, versionId), baseline);
  await pool.query("UPDATE public.claim_versions SET status = 'published' WHERE id = $1", [versionId]);
  assert.deepEqual(await reader.verifyClaimVersionAuthority(versionId, pool), verifiedVersion);
  await pool.query("UPDATE public.claim_versions SET status = 'draft' WHERE id = $1", [versionId]);

  await disableUserTriggers("claim_identity_authorities", async () => {
    await replaceConstraint("claim_identity_authorities", "chk_claim_identity_authorities_canonical_version", "canonical_version = 1", async () => {
      await pool.query("UPDATE public.claim_identity_authorities SET canonical_version = 2 WHERE claim_id = $1", [claimId]);
      await expectFailure(reader, () => reader.verifyClaimIdentityAuthority(claimId, pool), "UNSUPPORTED_CLAIM_CANONICAL_VERSION");
      await pool.query("UPDATE public.claim_identity_authorities SET canonical_version = 1 WHERE claim_id = $1", [claimId]);
    });
  });

  const corruptionCases = [
    ["malformed JSON", "{", expectedClaim.hash, "MALFORMED_CLAIM_AUTHORITY"],
    ["wrong schema", JSON.stringify({ schema: "wrong", canonicalVersion: 1, claimId }), hash(JSON.stringify({ schema: "wrong", canonicalVersion: 1, claimId })), "MALFORMED_CLAIM_AUTHORITY"],
    ["wrong canonical value", JSON.stringify({ schema: "factbase-claim-identity-authority", canonicalVersion: 1, claimId: "71111111-1111-4111-8111-111111111111" }), hash(JSON.stringify({ schema: "factbase-claim-identity-authority", canonicalVersion: 1, claimId: "71111111-1111-4111-8111-111111111111" })), "CANONICAL_MISMATCH"],
    ["wrong hash", expectedClaim.canonical, "a".repeat(64), "HASH_MISMATCH"],
    ["non-JCS", JSON.stringify(JSON.parse(expectedClaim.canonical), null, 2), hash(JSON.stringify(JSON.parse(expectedClaim.canonical), null, 2)), "CANONICAL_MISMATCH"],
    ["extra key", `${expectedClaim.canonical.slice(0, -1)},\"extra\":true}`, hash(`${expectedClaim.canonical.slice(0, -1)},\"extra\":true}`), "MALFORMED_CLAIM_AUTHORITY"],
    ["missing key", JSON.stringify({ schema: "factbase-claim-identity-authority", canonicalVersion: 1 }), hash(JSON.stringify({ schema: "factbase-claim-identity-authority", canonicalVersion: 1 })), "MALFORMED_CLAIM_AUTHORITY"],
  ];
  for (const [name, canonicalValue, hashValue, code] of corruptionCases) {
    const before = await snapshot(claimId, versionId);
    await disableUserTriggers("claim_identity_authorities", async () => {
      await pool.query("UPDATE public.claim_identity_authorities SET canonical = $1, canonical_hash = $2 WHERE claim_id = $3", [canonicalValue, hashValue, claimId]);
      try {
        await expectFailure(reader, () => reader.verifyClaimIdentityAuthority(claimId, pool), code);
      } finally {
        await pool.query("UPDATE public.claim_identity_authorities SET canonical = $1, canonical_hash = $2 WHERE claim_id = $3", [expectedClaim.canonical, expectedClaim.hash, claimId]);
      }
    });
    assert.equal(await snapshot(claimId, versionId), before);
    assert.equal(name.length > 0, true);
  }

  const versionCorruptionCases = [
    ["malformed JSON", "{", expectedVersion.hash, "MALFORMED_CLAIMVERSION_AUTHORITY"],
    ["wrong schema", JSON.stringify({ schema: "wrong", canonicalVersion: 1, claimId, claimVersionId: versionId, versionNumber: 1, title: " exact title Ω ", normalizedStatement: "  exact statement é  ", language: "EN", claimType: "Fact" }), "b".repeat(64), "MALFORMED_CLAIMVERSION_AUTHORITY"],
    ["wrong claim id", JSON.stringify({ schema: "factbase-claim-version-authority", canonicalVersion: 1, claimId: "71111111-1111-4111-8111-111111111111", claimVersionId: versionId, versionNumber: 1, title: " exact title Ω ", normalizedStatement: "  exact statement é  ", language: "EN", claimType: "Fact" }), "c".repeat(64), "CANONICAL_MISMATCH"],
    ["wrong version id", JSON.stringify({ schema: "factbase-claim-version-authority", canonicalVersion: 1, claimId, claimVersionId: "72222222-2222-4222-8222-222222222222", versionNumber: 1, title: " exact title Ω ", normalizedStatement: "  exact statement é  ", language: "EN", claimType: "Fact" }), "d".repeat(64), "CANONICAL_MISMATCH"],
    ["non-JCS", JSON.stringify(JSON.parse(expectedVersion.canonical), null, 2), hash(JSON.stringify(JSON.parse(expectedVersion.canonical), null, 2)), "CANONICAL_MISMATCH"],
    ["extra key", `${expectedVersion.canonical.slice(0, -1)},\"extra\":true}`, hash(`${expectedVersion.canonical.slice(0, -1)},\"extra\":true}`), "MALFORMED_CLAIMVERSION_AUTHORITY"],
    ["missing key", JSON.stringify({ schema: "factbase-claim-version-authority", canonicalVersion: 1 }), hash(JSON.stringify({ schema: "factbase-claim-version-authority", canonicalVersion: 1 })), "MALFORMED_CLAIMVERSION_AUTHORITY"],
    ["wrong hash", expectedVersion.canonical, "e".repeat(64), "HASH_MISMATCH"],
  ];
  for (const [name, canonicalValue, hashValue, code] of versionCorruptionCases) {
    const before = await snapshot(claimId, versionId);
    await disableUserTriggers("claim_version_authorities", async () => {
      await pool.query("UPDATE public.claim_version_authorities SET canonical = $1, canonical_hash = $2 WHERE claim_version_id = $3", [canonicalValue, hashValue, versionId]);
      try {
        await expectFailure(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), code);
      } finally {
        await pool.query("UPDATE public.claim_version_authorities SET canonical = $1, canonical_hash = $2 WHERE claim_version_id = $3", [expectedVersion.canonical, expectedVersion.hash, versionId]);
      }
    });
    assert.equal(await snapshot(claimId, versionId), before);
    assert.equal(name.length > 0, true);
  }

  await disableUserTriggers("claim_version_authorities", async () => {
    await replaceConstraint("claim_version_authorities", "chk_claim_version_authorities_canonical_version", "canonical_version = 1", async () => {
      await pool.query("UPDATE public.claim_version_authorities SET canonical_version = 2 WHERE claim_version_id = $1", [versionId]);
      await expectFailure(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), "UNSUPPORTED_CLAIMVERSION_CANONICAL_VERSION");
      await pool.query("UPDATE public.claim_version_authorities SET canonical_version = 1 WHERE claim_version_id = $1", [versionId]);
    });
  });

  const versionFieldCases = [
    ["version_number", 2, "VERSION_NUMBER_MISMATCH"],
    ["title", "authority title", "SOURCE_PARITY_MISMATCH"],
    ["normalized_statement", "authority statement", "SOURCE_PARITY_MISMATCH"],
    ["language", "de", "SOURCE_PARITY_MISMATCH"],
    ["claim_type", "event", "SOURCE_PARITY_MISMATCH"],
  ];
  for (const [field, value, code] of versionFieldCases) {
    const before = await snapshot(claimId, versionId);
    await disableUserTriggers("claim_version_authorities", async () => {
      await pool.query(`UPDATE public.claim_version_authorities SET ${field} = $1 WHERE claim_version_id = $2`, [value, versionId]);
      try {
        await expectFailure(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), code);
      } finally {
        await pool.query(`UPDATE public.claim_version_authorities SET ${field} = $1 WHERE claim_version_id = $2`, [field === "version_number" ? 1 : ({ title: " exact title Ω ", normalized_statement: "  exact statement é  ", language: "EN", claim_type: "Fact" })[field], versionId]);
      }
    });
    assert.equal(await snapshot(claimId, versionId), before);
  }

  const sourceBefore = await snapshot(claimId, versionId);
  await disableTrigger("claim_versions", "trg_claim_version_authenticated_source_protection", async () => {
    await pool.query("UPDATE public.claim_versions SET title = 'mutated current title' WHERE id = $1", [versionId]);
    try {
      await expectFailure(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), "SOURCE_PARITY_MISMATCH");
    } finally {
      await pool.query("UPDATE public.claim_versions SET title = $1 WHERE id = $2", [" exact title Ω ", versionId]);
    }
  });
  assert.equal(await snapshot(claimId, versionId), sourceBefore);

  const parentMismatchClaim = "50000000-0000-4000-8000-000000000002";
  await withOwnerTransaction((client) => insertClaim(client, parentMismatchClaim));
  await disableTrigger("claim_versions", "trg_claim_version_authenticated_source_protection", async () => {
    await pool.query("UPDATE public.claim_versions SET claim_id = $1 WHERE id = $2", [parentMismatchClaim, versionId]);
    try {
      await expectFailure(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), "PARENT_CLAIM_MISMATCH");
    } finally {
      await pool.query("UPDATE public.claim_versions SET claim_id = $1 WHERE id = $2", [claimId, versionId]);
    }
  });

  const parentAuthorityBefore = await snapshot(claimId, versionId);
  await disableAllTriggers("claim_version_authorities", async () => {
    await disableAllTriggers("claim_identity_authorities", async () => {
      await pool.query("DELETE FROM public.claim_identity_authorities WHERE claim_id = $1", [claimId]);
      try {
        await expectFailure(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), "MISSING_CLAIM_AUTHORITY");
      } finally {
        await pool.query("INSERT INTO public.claim_identity_authorities (claim_id, canonical_version, canonical, canonical_hash) VALUES ($1,1,$2,$3)", [claimId, expectedClaim.canonical, expectedClaim.hash]);
      }
    });
  });
  assert.equal(await snapshot(claimId, versionId), parentAuthorityBefore);

  const precedenceBefore = await snapshot(claimId, versionId);
  await disableUserTriggers("claim_version_authorities", async () => {
    await pool.query("UPDATE public.claim_version_authorities SET title = 'authority mismatch', canonical = '{', canonical_hash = $1 WHERE claim_version_id = $2", ["b".repeat(64), versionId]);
    try {
      let first;
      let second;
      try {
        await reader.verifyClaimVersionAuthority(versionId, pool);
      } catch (error) {
        first = error;
      }
      try {
        await reader.verifyClaimVersionAuthority(versionId, pool);
      } catch (error) {
        second = error;
      }
      assert.ok(first);
      assert.ok(second);
      assert.equal(first.code, "SOURCE_PARITY_MISMATCH");
      assert.equal(second.code, first.code);
    } finally {
      await pool.query("UPDATE public.claim_version_authorities SET title = $1, canonical = $2, canonical_hash = $3 WHERE claim_version_id = $4", [" exact title Ω ", expectedVersion.canonical, expectedVersion.hash, versionId]);
    }
  });
  assert.equal(await snapshot(claimId, versionId), precedenceBefore);

  const reconnected = new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 2 });
  try {
    assert.deepEqual(await reader.verifyClaimIdentityAuthority(claimId, reconnected), verifiedClaim);
    assert.deepEqual(await reader.verifyClaimVersionAuthority(versionId, reconnected), verifiedVersion);
  } finally {
    await reconnected.end();
  }
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `const { Pool } = require('pg'); const reader = require(${JSON.stringify(path.join(process.cwd(), "dist/services/claimHistoricalAuthorityReader.js"))}); const pool = new Pool({ database: process.env.CLAIM_AUTHORITY_WAVE_C_DATABASE, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD }); Promise.all([reader.verifyClaimIdentityAuthority(process.env.WAVE_C_CLAIM_ID, pool), reader.verifyClaimVersionAuthority(process.env.WAVE_C_VERSION_ID, pool)]).then(() => pool.end()).catch((error) => { console.error(error); pool.end().finally(() => process.exit(1)); });`,
    ],
    {
      env: { ...process.env, WAVE_C_CLAIM_ID: claimId, WAVE_C_VERSION_ID: versionId },
      encoding: "utf8",
    },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test.after(async () => {
  await pool?.end();
});
