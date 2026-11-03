// Explicit synthetic export only. Never imported by run.mjs.
import assert from 'node:assert/strict';
import { mkdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CompactSign, compactVerify, generateKeyPair, exportJWK } from 'jose';
import canonicalize from '../../node_modules/canonicalize/lib/canonicalize.js';

async function main() {
  assert.deepEqual(process.argv.slice(2), ['--export']);
  const files = new Map();
  const payload = canonicalize({
    schemaVersion: 'POC-EXPORT-NOT-H2-V1', issuerId: 'synthetic-factbase',
    recordId: 'synthetic-h2', captureId: 'synthetic-capture', attemptId: 'synthetic-attempt',
    basisHash: 'b'.repeat(64), w2Refs: ['synthetic-measurement', 'synthetic-readback'],
  });
  files.set('payload.json', payload);
  const results = [];
  for (const alg of ['ES256', 'PS256']) {
    const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: false, modulusLength: 2048 });
    assert.equal(privateKey.extractable, false);
    const token = await new CompactSign(new TextEncoder().encode(payload))
      .setProtectedHeader({ alg, kid: `poc-export-${alg}`, typ: 'h2-synthetic-export-only+jws' })
      .sign(privateKey);
    const verified = await compactVerify(token, publicKey, { algorithms: [alg] });
    assert.equal(new TextDecoder().decode(verified.payload), payload);
    const jwk = await exportJWK(publicKey); // Only publicKey can reach serialization.
    assert.equal(jwk.d, undefined);
    files.set(`${alg}.jws`, token); // Original Compact serialization, unchanged.
    files.set(`${alg}.public.jwk.json`, canonicalize(jwk));
    results.push({ algorithm: alg, generationVerification: true });
  }
  files.set('results.json', canonicalize({ scope: 'synthetic-local-mechanism-only', results }));
  const hashes = Object.fromEntries([...files].map(([name, data]) =>
    [name, createHash('sha256').update(data).digest('hex')]));
  files.set('sha256.json', canonicalize(hashes)); // Does not hash itself.

  const here = await realpath(fileURLToPath(new URL('.', import.meta.url)));
  const root = join(here, 'exports');
  try { await mkdir(root); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  assert.equal((await lstat(root)).isDirectory(), true); // Reject a symlink.
  const name = `synthetic-h2-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const directory = join(root, name);
  await mkdir(directory); // Exclusive new directory; no collision retry/overwrite.
  for (const [filename, data] of files) await writeFile(join(directory, filename), data, { flag: 'wx' });
  console.log(`EXPORT exports/${name}`);
  console.log('RESULT exported 7 public synthetic files; private keys memory-only');
}

try { await main(); }
catch { console.error('FAIL synthetic export (details suppressed; partial directory may remain)'); process.exitCode = 1; }
