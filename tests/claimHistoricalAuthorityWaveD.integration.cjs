const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");

const database = process.env.CLAIM_AUTHORITY_WAVE_D_DATABASE;
const enabled = Boolean(database && process.env.PGHOST && process.env.PGPORT);
const pool = enabled
  ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 10 })
  : null;
const migrationRoot = path.join(__dirname, "..", "migrations");
const legacyClaimId = "90000000-0000-4000-8000-000000000001";
const legacyVersionId = "91000000-0000-4000-8000-000000000001";
const parentClaimId = "90000000-0000-4000-8000-000000000002";

function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function migrationFiles() { return fs.readdirSync(migrationRoot).filter((name) => name.endsWith(".sql")).sort().map((name) => path.join(migrationRoot, name)); }

async function insertClaim(client, id) { await client.query("INSERT INTO public.claims (id) VALUES ($1)", [id]); }
async function insertVersion(client, id, claimId, fields = {}) {
  await client.query(`INSERT INTO public.claim_versions
    (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at)
    VALUES ($1,$2,1,$3,$4,$5,$6,'draft','unpublished','wave-d fixture','2026-09-19T12:00:00.000000Z')`,
  [id, claimId, fields.title ?? "title", fields.normalizedStatement ?? "statement", fields.language ?? "en", fields.claimType ?? "fact"]);
}
async function replayMigrations() {
  const client = await pool.connect();
  try {
    for (const file of migrationFiles()) {
      if (path.basename(file) === "rcv009_create_claims_historical_authority.sql") {
        await insertClaim(client, legacyClaimId);
        await insertVersion(client, legacyVersionId, legacyClaimId, { title: "legacy", normalizedStatement: "legacy" });
      }
      await client.query(fs.readFileSync(file, "utf8"));
    }
  } finally { client.release(); }
}
async function tx(work) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
async function rows(table, where, values) { return (await pool.query(`SELECT * FROM public.${table} WHERE ${where} ORDER BY 1`, values)).rows; }
async function state(claimId, versionId) {
  return JSON.stringify({
    claim: await rows("claims", "id = $1", [claimId]),
    version: await rows("claim_versions", "id = $1", [versionId]),
    claimAuthority: await rows("claim_identity_authorities", "claim_id = $1", [claimId]),
    versionAuthority: await rows("claim_version_authorities", "claim_version_id = $1", [versionId]),
  });
}
async function disableUser(table, work) {
  await pool.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`);
  try { return await work(); } finally { await pool.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`); }
}
async function disableAll(table, work) {
  await pool.query(`ALTER TABLE public.${table} DISABLE TRIGGER ALL`);
  try { return await work(); } finally { await pool.query(`ALTER TABLE public.${table} ENABLE TRIGGER ALL`); }
}
async function replaceConstraint(table, name, expression, work) {
  await pool.query(`ALTER TABLE public.${table} DROP CONSTRAINT ${name}`);
  try { return await work(); } finally { await pool.query(`ALTER TABLE public.${table} ADD CONSTRAINT ${name} CHECK (${expression})`); }
}
async function expectCode(reader, fn, code) {
  await assert.rejects(fn, (error) => { assert.equal(error.code, code); return true; });
}
async function makeSelectRole() {
  const role = `claim_wave_d_reader_${process.pid}`;
  await pool.query(`DROP ROLE IF EXISTS "${role}"`);
  await pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'wave-d-reader'`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await pool.query(`REVOKE CREATE ON SCHEMA public FROM "${role}"`);
  for (const table of ["claims", "claim_versions", "claim_identity_authorities", "claim_version_authorities"]) {
    await pool.query(`GRANT SELECT ON public.${table} TO "${role}"`);
    await pool.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.${table} FROM "${role}"`);
  }
  return role;
}

test("Claim Historical Authority Wave D final integrated PostgreSQL proof", { skip: !enabled }, async () => {
  await replayMigrations();
  const canonical = require("../dist/services/claimHistoricalAuthorityCanonical");
  const writer = require("../dist/services/claimHistoricalAuthorityWriter");
  const claimService = require("../dist/services/claimService");
  const reader = require("../dist/services/claimHistoricalAuthorityReader");

  const identity = (await pool.query("SELECT current_database() AS database_name, current_setting('server_encoding') AS encoding, version() AS version")).rows[0];
  assert.equal(identity.database_name, database);
  assert.equal(identity.encoding, "UTF8");
  assert.match(identity.version, /^PostgreSQL 16\./);

  const staticReader = fs.readFileSync(path.join(__dirname, "..", "src/services/claimHistoricalAuthorityReader.ts"), "utf8");
  assert.doesNotMatch(staticReader, /claimHistoricalAuthorityWriter|claimService|claimVersionService|RCV-022/);
  assert.doesNotMatch(staticReader, /\b(?:INSERT|DELETE|FOR\s+(?:UPDATE|SHARE)|BEGIN|COMMIT|ROLLBACK|TEMP\s+TABLE|LOCK\s+TABLE)\b/);

  assert.equal((await rows("claim_identity_authorities", "claim_id = $1", [legacyClaimId])).length, 0);
  assert.equal((await rows("claim_version_authorities", "claim_version_id = $1", [legacyVersionId])).length, 0);
  await expectCode(reader, () => reader.verifyClaimIdentityAuthority(legacyClaimId, pool), "UNAUTHENTICATED_LEGACY_CLAIM");
  await expectCode(reader, () => reader.verifyClaimVersionAuthority(legacyVersionId, pool), "UNAUTHENTICATED_LEGACY_CLAIMVERSION");

  const created = await claimService.createClaimWithInitialVersionAndAuthority({
    title: "Wave D exact Ω title",
    normalizedStatement: "Wave D exact é statement",
    language: "EN",
    claimType: "Fact",
  }, pool);
  const claimId = created.id;
  const versionId = created.version.id;
  const expectedClaim = canonical.buildClaimIdentityCanonical({ claimId });
  const expectedVersion = canonical.buildClaimVersionCanonical({ claimId, claimVersionId: versionId, versionNumber: 1, title: "Wave D exact Ω title", normalizedStatement: "Wave D exact é statement", language: "EN", claimType: "Fact" });
  const persistedClaim = (await pool.query("SELECT claim_id,canonical_version,canonical,canonical_hash FROM public.claim_identity_authorities WHERE claim_id=$1", [claimId])).rows[0];
  const persistedVersion = (await pool.query("SELECT * FROM public.claim_version_authorities WHERE claim_version_id=$1", [versionId])).rows[0];
  const sourceVersion = (await pool.query("SELECT id,claim_id,version_number,title,normalized_statement,language,claim_type FROM public.claim_versions WHERE id=$1", [versionId])).rows[0];
  assert.deepEqual(persistedClaim, { claim_id: claimId, canonical_version: 1, canonical: expectedClaim.canonical, canonical_hash: expectedClaim.hash });
  assert.equal(persistedVersion.canonical, expectedVersion.canonical);
  assert.equal(persistedVersion.canonical_hash, expectedVersion.hash);
  assert.deepEqual([persistedVersion.claim_id, persistedVersion.claim_version_id, persistedVersion.version_number, persistedVersion.title, persistedVersion.normalized_statement, persistedVersion.language, persistedVersion.claim_type], [sourceVersion.claim_id, sourceVersion.id, sourceVersion.version_number, sourceVersion.title, sourceVersion.normalized_statement, sourceVersion.language, sourceVersion.claim_type]);
  assert.equal(persistedClaim.canonical_hash, sha256(persistedClaim.canonical));
  assert.equal(persistedVersion.canonical_hash, sha256(persistedVersion.canonical));

  assert.deepEqual(await reader.verifyClaimIdentityAuthority(claimId, pool), { verified: true, claimId, canonicalVersion: 1, canonicalHash: expectedClaim.hash });
  assert.deepEqual(await reader.verifyClaimVersionAuthority(versionId, pool), { verified: true, claimId, claimVersionId: versionId, versionNumber: 1, canonicalVersion: 1, canonicalHash: expectedVersion.hash });

  const rollbackClaim = "90000000-0000-4000-8000-000000000003";
  const rollbackVersion = "91000000-0000-4000-8000-000000000003";
  await assert.rejects(tx(async (client) => {
    const ids = { claimId: rollbackClaim, versionId: rollbackVersion, requestId: "92000000-0000-4000-8000-000000000003" };
    const createdRollback = await claimService.createClaimWithInitialVersionWithinTransaction(client, { title: "rollback", normalizedStatement: "rollback", language: "en", claimType: "fact" }, ids);
    await writer.persistClaimIdentityAuthorityWithinTransaction(client, createdRollback.id);
    await writer.persistClaimVersionAuthorityWithinTransaction(client, createdRollback.version.id);
    throw new Error("wave-d injected pre-commit failure");
  }), /wave-d injected pre-commit failure/);
  assert.equal((await rows("claims", "id=$1", [rollbackClaim])).length, 0);
  assert.equal((await rows("claim_versions", "id=$1", [rollbackVersion])).length, 0);
  assert.equal((await rows("claim_identity_authorities", "claim_id=$1", [rollbackClaim])).length, 0);
  assert.equal((await rows("claim_version_authorities", "claim_version_id=$1", [rollbackVersion])).length, 0);

  const role = await makeSelectRole();
  const restricted = new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: role, password: "wave-d-reader", max: 2 });
  try {
    const grants = (await pool.query(`SELECT has_table_privilege($1,'public.claims','SELECT') AS s, has_table_privilege($1,'public.claims','INSERT') AS i, has_table_privilege($1,'public.claims','UPDATE') AS u, has_table_privilege($1,'public.claims','DELETE') AS d`, [role])).rows[0];
    assert.deepEqual(grants, { s: true, i: false, u: false, d: false });
    await reader.verifyClaimIdentityAuthority(claimId, restricted);
    await reader.verifyClaimVersionAuthority(versionId, restricted);
  } finally { await restricted.end(); await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE IF EXISTS "${role}"`); }

  const child = spawnSync(process.execPath, ["-e", `const {Pool}=require('pg'); const r=require(${JSON.stringify(path.join(process.cwd(), "dist/services/claimHistoricalAuthorityReader.js"))}); const p=new Pool({database:process.env.CLAIM_AUTHORITY_WAVE_D_DATABASE,host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD}); Promise.all([r.verifyClaimIdentityAuthority(process.env.WAVE_D_CLAIM,p),r.verifyClaimVersionAuthority(process.env.WAVE_D_VERSION,p)]).then(()=>p.end()).catch(e=>{console.error(e);p.end().finally(()=>process.exit(1));});`], { env: { ...process.env, WAVE_D_CLAIM: claimId, WAVE_D_VERSION: versionId }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr || child.stdout);

  await pool.query("UPDATE public.claim_versions SET status='published' WHERE id=$1", [versionId]);
  await reader.verifyClaimVersionAuthority(versionId, pool);
  await pool.query("UPDATE public.claim_versions SET status='draft' WHERE id=$1", [versionId]);

  const parent = parentClaimId;
  await tx((client) => insertClaim(client, parent));
  const expectedParent = canonical.buildClaimIdentityCanonical({ claimId: parent });
  await pool.query(
    "INSERT INTO public.claim_identity_authorities (claim_id,canonical_version,canonical,canonical_hash) VALUES ($1,1,$2,$3)",
    [parent, expectedParent.canonical, expectedParent.hash],
  );
  let sourceCases = 0;
  const sourceFields = [
    ["claim_id", parent, "PARENT_CLAIM_MISMATCH"],
    ["version_number", 2, "VERSION_NUMBER_MISMATCH"],
    ["title", "corrupt title", "SOURCE_PARITY_MISMATCH"],
    ["normalized_statement", "corrupt statement", "SOURCE_PARITY_MISMATCH"],
    ["language", "de", "SOURCE_PARITY_MISMATCH"],
    ["claim_type", "event", "SOURCE_PARITY_MISMATCH"],
  ];
  for (const [field, value, code] of sourceFields) {
    const beforeCorruption = await state(claimId, versionId);
    await disableUser("claim_versions", async () => {
      await pool.query(`UPDATE public.claim_versions SET ${field}=$1 WHERE id=$2`, [value, versionId]);
      const corrupted = await state(claimId, versionId);
      await expectCode(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), code);
      assert.equal(await state(claimId, versionId), corrupted);
      await pool.query(`UPDATE public.claim_versions SET ${field}=$1 WHERE id=$2`, [field === "claim_id" ? claimId : field === "version_number" ? 1 : ({ title: "Wave D exact Ω title", normalized_statement: "Wave D exact é statement", language: "EN", claim_type: "Fact" })[field], versionId]);
    });
    assert.equal(await state(claimId, versionId), beforeCorruption);
    sourceCases += 1;
  }

  const claimCorruptionCases = [
    ["canonical_version", 2, expectedClaim.canonical, expectedClaim.hash, "UNSUPPORTED_CLAIM_CANONICAL_VERSION"],
    ["canonical", "{", "a".repeat(64), "MALFORMED_CLAIM_AUTHORITY"],
    ["canonical_hash", "a".repeat(64), expectedClaim.canonical, "HASH_MISMATCH"],
  ];
  let authorityCases = 0;
  let canonicalCases = 0;
  let hashCases = 0;
  for (const item of claimCorruptionCases) {
    const beforeCorruption = await state(claimId, versionId);
    await disableUser("claim_identity_authorities", async () => {
      if (item[0] === "canonical_version") {
        await replaceConstraint("claim_identity_authorities", "chk_claim_identity_authorities_canonical_version", "canonical_version = 1", async () => {
          await pool.query("UPDATE public.claim_identity_authorities SET canonical_version=2 WHERE claim_id=$1", [claimId]);
          const corrupted = await state(claimId, versionId);
          await expectCode(reader, () => reader.verifyClaimIdentityAuthority(claimId, pool), item[4]);
          assert.equal(await state(claimId, versionId), corrupted);
          await pool.query("UPDATE public.claim_identity_authorities SET canonical_version=1 WHERE claim_id=$1", [claimId]);
        });
      } else if (item[0] === "canonical") {
        await pool.query("UPDATE public.claim_identity_authorities SET canonical=$1, canonical_hash=$2 WHERE claim_id=$3", [item[1], item[2], claimId]);
        const corrupted = await state(claimId, versionId);
        await expectCode(reader, () => reader.verifyClaimIdentityAuthority(claimId, pool), item[3]);
        assert.equal(await state(claimId, versionId), corrupted);
        await pool.query("UPDATE public.claim_identity_authorities SET canonical=$1, canonical_hash=$2 WHERE claim_id=$3", [expectedClaim.canonical, expectedClaim.hash, claimId]);
      } else {
        await pool.query("UPDATE public.claim_identity_authorities SET canonical_hash=$1 WHERE claim_id=$2", [item[1], claimId]);
        const corrupted = await state(claimId, versionId);
        await expectCode(reader, () => reader.verifyClaimIdentityAuthority(claimId, pool), item[3]);
        assert.equal(await state(claimId, versionId), corrupted);
        await pool.query("UPDATE public.claim_identity_authorities SET canonical_hash=$1 WHERE claim_id=$2", [expectedClaim.hash, claimId]);
      }
    });
    assert.equal(await state(claimId, versionId), beforeCorruption);
    authorityCases += 1;
    if (item[0] === "canonical_hash") hashCases += 1;
  }

  const claimCanonicalCases = [
    ["malformed JSON", "{", "a".repeat(64), "MALFORMED_CLAIM_AUTHORITY"],
    ["missing key", JSON.stringify({ schema: "factbase-claim-identity-authority", canonicalVersion: 1 }), "b".repeat(64), "MALFORMED_CLAIM_AUTHORITY"],
    ["extra key", expectedClaim.canonical.slice(0, -1) + ',"extra":true}', "c".repeat(64), "MALFORMED_CLAIM_AUTHORITY"],
    ["wrong schema", JSON.stringify({ schema: "wrong", canonicalVersion: 1, claimId }), "d".repeat(64), "MALFORMED_CLAIM_AUTHORITY"],
    ["wrong canonical version", JSON.stringify({ schema: "factbase-claim-identity-authority", canonicalVersion: 2, claimId }), "e".repeat(64), "MALFORMED_CLAIM_AUTHORITY"],
    ["wrong identity", JSON.stringify({ schema: "factbase-claim-identity-authority", canonicalVersion: 1, claimId: parent }), "f".repeat(64), "CANONICAL_MISMATCH"],
    ["non-JCS serialization", JSON.stringify(JSON.parse(expectedClaim.canonical), null, 2), sha256(JSON.stringify(JSON.parse(expectedClaim.canonical), null, 2)), "CANONICAL_MISMATCH"],
  ];
  for (const [, canonicalValue, hashValue, code] of claimCanonicalCases) {
    const beforeCorruption = await state(claimId, versionId);
    await disableUser("claim_identity_authorities", async () => {
      await pool.query("UPDATE public.claim_identity_authorities SET canonical=$1, canonical_hash=$2 WHERE claim_id=$3", [canonicalValue, hashValue, claimId]);
      const corrupted = await state(claimId, versionId);
      await expectCode(reader, () => reader.verifyClaimIdentityAuthority(claimId, pool), code);
      assert.equal(await state(claimId, versionId), corrupted);
      await pool.query("UPDATE public.claim_identity_authorities SET canonical=$1, canonical_hash=$2 WHERE claim_id=$3", [expectedClaim.canonical, expectedClaim.hash, claimId]);
    });
    assert.equal(await state(claimId, versionId), beforeCorruption);
    canonicalCases += 1;
  }

  const claimMalformedHashBefore = await state(claimId, versionId);
  await disableUser("claim_identity_authorities", async () => await replaceConstraint("claim_identity_authorities", "chk_claim_identity_authorities_canonical_hash", "canonical_hash ~ '^[0-9a-f]{64}$'", async () => {
    await pool.query("UPDATE public.claim_identity_authorities SET canonical_hash='bad' WHERE claim_id=$1", [claimId]);
    const corrupted = await state(claimId, versionId);
    await expectCode(reader, () => reader.verifyClaimIdentityAuthority(claimId, pool), "MALFORMED_CLAIM_AUTHORITY");
    assert.equal(await state(claimId, versionId), corrupted);
    await pool.query("UPDATE public.claim_identity_authorities SET canonical_hash=$1 WHERE claim_id=$2", [expectedClaim.hash, claimId]);
  }));
  assert.equal(await state(claimId, versionId), claimMalformedHashBefore);
  hashCases += 1;

  const versionCanonicalCases = [
    ["{", "b".repeat(64), "MALFORMED_CLAIMVERSION_AUTHORITY"],
    [JSON.stringify({ schema: "factbase-claim-version-authority", canonicalVersion: 1, claimId, claimVersionId: versionId, versionNumber: 1, title: "Wave D exact Ω title", normalizedStatement: "Wave D exact é statement", language: "EN" }), "b".repeat(64), "MALFORMED_CLAIMVERSION_AUTHORITY"],
    [JSON.stringify(JSON.parse(expectedVersion.canonical), null, 2), sha256(JSON.stringify(JSON.parse(expectedVersion.canonical), null, 2)), "CANONICAL_MISMATCH"],
    [expectedVersion.canonical.slice(0, -1) + ',"extra":true}', "c".repeat(64), "MALFORMED_CLAIMVERSION_AUTHORITY"],
    [JSON.stringify({ ...JSON.parse(expectedVersion.canonical), claimId: parent }), "c".repeat(64), "CANONICAL_MISMATCH"],
    [JSON.stringify({ ...JSON.parse(expectedVersion.canonical), canonicalVersion: 2 }), "c".repeat(64), "MALFORMED_CLAIMVERSION_AUTHORITY"],
    [expectedVersion.canonical, "d".repeat(64), "HASH_MISMATCH"],
    [JSON.stringify({ schema: "wrong", canonicalVersion: 1 }), "e".repeat(64), "MALFORMED_CLAIMVERSION_AUTHORITY"],
  ];
  for (const [canonicalValue, hashValue, code] of versionCanonicalCases) {
    const beforeCorruption = await state(claimId, versionId);
    await disableUser("claim_version_authorities", async () => {
      await pool.query("UPDATE public.claim_version_authorities SET canonical=$1, canonical_hash=$2 WHERE claim_version_id=$3", [canonicalValue, hashValue, versionId]);
      const corrupted = await state(claimId, versionId);
      await expectCode(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), code);
      assert.equal(await state(claimId, versionId), corrupted);
      await pool.query("UPDATE public.claim_version_authorities SET canonical=$1, canonical_hash=$2 WHERE claim_version_id=$3", [expectedVersion.canonical, expectedVersion.hash, versionId]);
    });
    assert.equal(await state(claimId, versionId), beforeCorruption);
    canonicalCases += 1;
    if (code === "HASH_MISMATCH") hashCases += 1;
  }

  const versionMalformedHashBefore = await state(claimId, versionId);
  await disableUser("claim_version_authorities", async () => await replaceConstraint("claim_version_authorities", "chk_claim_version_authorities_canonical_hash", "canonical_hash ~ '^[0-9a-f]{64}$'", async () => {
    await pool.query("UPDATE public.claim_version_authorities SET canonical_hash='bad' WHERE claim_version_id=$1", [versionId]);
    const corrupted = await state(claimId, versionId);
    await expectCode(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), "MALFORMED_CLAIMVERSION_AUTHORITY");
    assert.equal(await state(claimId, versionId), corrupted);
    await pool.query("UPDATE public.claim_version_authorities SET canonical_hash=$1 WHERE claim_version_id=$2", [expectedVersion.hash, versionId]);
  }));
  assert.equal(await state(claimId, versionId), versionMalformedHashBefore);
  hashCases += 1;

  const versionFields = [["claim_id", parent, "PARENT_CLAIM_MISMATCH"], ["version_number", 2, "VERSION_NUMBER_MISMATCH"], ["title", "authority title", "SOURCE_PARITY_MISMATCH"], ["normalized_statement", "authority statement", "SOURCE_PARITY_MISMATCH"], ["language", "de", "SOURCE_PARITY_MISMATCH"], ["claim_type", "event", "SOURCE_PARITY_MISMATCH"]];
  for (const [field, value, code] of versionFields) {
    const beforeCorruption = await state(claimId, versionId);
    await disableUser("claim_version_authorities", async () => {
      await pool.query(`UPDATE public.claim_version_authorities SET ${field}=$1 WHERE claim_version_id=$2`, [value, versionId]);
      const corrupted = await state(claimId, versionId);
      await expectCode(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), code);
      assert.equal(await state(claimId, versionId), corrupted);
      const original = { claim_id: claimId, version_number: 1, title: "Wave D exact Ω title", normalized_statement: "Wave D exact é statement", language: "EN", claim_type: "Fact" }[field];
      await pool.query(`UPDATE public.claim_version_authorities SET ${field}=$1 WHERE claim_version_id=$2`, [original, versionId]);
    });
    assert.equal(await state(claimId, versionId), beforeCorruption);
    authorityCases += 1;
  }

  const parentBefore = await state(claimId, versionId);
  await disableAll("claim_version_authorities", async () => await disableAll("claim_identity_authorities", async () => {
    await pool.query("DELETE FROM public.claim_identity_authorities WHERE claim_id=$1", [claimId]);
    const corrupted = await state(claimId, versionId);
    await expectCode(reader, () => reader.verifyClaimVersionAuthority(versionId, pool), "MISSING_CLAIM_AUTHORITY");
    assert.equal(await state(claimId, versionId), corrupted);
    await pool.query("INSERT INTO public.claim_identity_authorities (claim_id,canonical_version,canonical,canonical_hash) VALUES ($1,1,$2,$3)", [claimId, expectedClaim.canonical, expectedClaim.hash]);
  }));
  assert.equal(await state(claimId, versionId), parentBefore);

  const multiCases = [
    ["claim source + canonical + hash", async () => { await disableUser("claim_versions", async () => { await pool.query("UPDATE public.claim_versions SET title='source-corrupt' WHERE id=$1", [versionId]); }); await disableUser("claim_version_authorities", async () => { await pool.query("UPDATE public.claim_version_authorities SET canonical='{', canonical_hash=$1 WHERE claim_version_id=$2", ["f".repeat(64), versionId]); }); }, "SOURCE_PARITY_MISMATCH"],
    ["parent + source + hash", async () => { await disableUser("claim_versions", async () => { await pool.query("UPDATE public.claim_versions SET claim_id=$1 WHERE id=$2", [parent, versionId]); }); await disableUser("claim_version_authorities", async () => { await pool.query("UPDATE public.claim_version_authorities SET title='authority-corrupt', canonical_hash=$1 WHERE claim_version_id=$2", ["1".repeat(64), versionId]); }); }, "PARENT_CLAIM_MISMATCH"],
    ["malformed canonical + hash", async () => { await disableUser("claim_version_authorities", async () => { await pool.query("UPDATE public.claim_version_authorities SET canonical='{', canonical_hash=$1 WHERE claim_version_id=$2", ["2".repeat(64), versionId]); }); }, "MALFORMED_CLAIMVERSION_AUTHORITY"],
    ["unsupported version + canonical + hash", async () => { await pool.query("ALTER TABLE public.claim_version_authorities DROP CONSTRAINT chk_claim_version_authorities_canonical_version"); await disableUser("claim_version_authorities", async () => { await pool.query("UPDATE public.claim_version_authorities SET canonical_version=2, canonical='{', canonical_hash=$1 WHERE claim_version_id=$2", ["3".repeat(64), versionId]); }); }, "UNSUPPORTED_CLAIMVERSION_CANONICAL_VERSION"],
    ["identity + source", async () => { await disableUser("claim_version_authorities", async () => { await pool.query("UPDATE public.claim_version_authorities SET title='authority-corrupt' WHERE claim_version_id=$1", [versionId]); }); await disableUser("claim_versions", async () => { await pool.query("UPDATE public.claim_versions SET title='source-corrupt' WHERE id=$1", [versionId]); }); }, "SOURCE_PARITY_MISMATCH"],
  ];
  let multiCount = 0;
  for (const [, corrupt, code] of multiCases) {
    const dropsVersionConstraint = code === "UNSUPPORTED_CLAIMVERSION_CANONICAL_VERSION";
    const beforeCorruption = await state(claimId, versionId);
    await corrupt();
    const corrupted = await state(claimId, versionId);
    let first;
    let second;
    try { await reader.verifyClaimVersionAuthority(versionId, pool); } catch (error) { first = error; }
    try { await reader.verifyClaimVersionAuthority(versionId, pool); } catch (error) { second = error; }
    assert.equal(first.code, code);
    assert.equal(second.code, first.code);
    assert.equal(await state(claimId, versionId), corrupted);
    await disableUser("claim_versions", async () => await disableUser("claim_version_authorities", async () => {
      await pool.query("UPDATE public.claim_versions SET claim_id=$1,title=$2 WHERE id=$3", [claimId, "Wave D exact Ω title", versionId]);
      await pool.query("UPDATE public.claim_version_authorities SET claim_id=$1,version_number=1,title=$2,canonical_version=1,canonical=$3,canonical_hash=$4 WHERE claim_version_id=$5", [claimId, "Wave D exact Ω title", expectedVersion.canonical, expectedVersion.hash, versionId]);
    }));
    if (dropsVersionConstraint) {
      await pool.query("ALTER TABLE public.claim_version_authorities ADD CONSTRAINT chk_claim_version_authorities_canonical_version CHECK (canonical_version = 1)");
    }
    assert.equal(await state(claimId, versionId), beforeCorruption);
    multiCount += 1;
  }

  const corruptedRestartBefore = await state(claimId, versionId);
  await disableUser("claim_identity_authorities", async () => {
    await pool.query("UPDATE public.claim_identity_authorities SET canonical_hash=$1 WHERE claim_id=$2", ["4".repeat(64), claimId]);
    const corrupted = await state(claimId, versionId);
    const restart = spawnSync(process.execPath, ["-e", `const {Pool}=require('pg'); const r=require(${JSON.stringify(path.join(process.cwd(), "dist/services/claimHistoricalAuthorityReader.js"))}); const p=new Pool({database:process.env.CLAIM_AUTHORITY_WAVE_D_DATABASE,host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD}); r.verifyClaimIdentityAuthority(process.env.WAVE_D_CLAIM,p).then(()=>process.exit(2)).catch(e=>{if(e.code!=='HASH_MISMATCH')process.exit(3);p.end();});`], { env: { ...process.env, WAVE_D_CLAIM: claimId }, encoding: "utf8" });
    assert.equal(restart.status, 0, restart.stderr || restart.stdout);
    assert.equal(await state(claimId, versionId), corrupted);
    await pool.query("UPDATE public.claim_identity_authorities SET canonical_hash=$1 WHERE claim_id=$2", [expectedClaim.hash, claimId]);
  });
  assert.equal(await state(claimId, versionId), corruptedRestartBefore);

  assert.equal(sourceCases, 6);
  assert.equal(authorityCases, 9);
  assert.equal(canonicalCases, 15);
  assert.equal(hashCases, 4);
  assert.equal(multiCount, 5);
  assert.equal(writer === undefined, false);
});

test.after(async () => { await pool?.end(); });
