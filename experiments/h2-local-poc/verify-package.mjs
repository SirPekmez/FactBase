// Separate public-only reader: no generator import, signing, writes or remote keys.
import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { compactVerify, importJWK, errors } from 'jose';
import canonicalize from '../../node_modules/canonicalize/lib/canonicalize.js';

class PackageError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const names = ['ES256.jws', 'ES256.public.jwk.json', 'PS256.jws',
  'PS256.public.jwk.json', 'payload.json', 'results.json'];
const hash = data => createHash('sha256').update(data).digest('hex');
const text = data => new TextDecoder('utf-8', { fatal: true }).decode(data);

function checkHashes(files, manifest) {
  assert.deepEqual(Object.keys(manifest).sort(), [...names].sort());
  for (const name of names) {
    if (!/^[0-9a-f]{64}$/.test(manifest[name]) || hash(files.get(name)) !== manifest[name])
      throw new PackageError('FILE_HASH_MISMATCH');
  }
}

async function verifyRecord(algorithm, token, jwk, payload) {
  const expectedKeyFields = algorithm === 'ES256' ? ['crv', 'kty', 'x', 'y'] : ['e', 'kty', 'n'];
  assert.deepEqual(Object.keys(jwk).sort(), expectedKeyFields.sort()); // Public-only closed JWK.
  assert.equal(jwk.kty, algorithm === 'ES256' ? 'EC' : 'RSA');
  if (algorithm === 'ES256') assert.equal(jwk.crv, 'P-256');
  const key = await importJWK(jwk, algorithm);
  if (algorithm === 'PS256') {
    assert.equal(key.algorithm.modulusLength, 2048);
    assert.equal(key.algorithm.hash.name, 'SHA-256');
  }
  const verified = await compactVerify(token, header => {
    assert.deepEqual(header, { alg: algorithm, kid: `poc-export-${algorithm}`, typ: 'h2-synthetic-export-only+jws' });
    return key;
  }, { algorithms: [algorithm] });
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  assert.notEqual(parts[1], '');
  assert.equal(Buffer.from(parts[2], 'base64url').length, algorithm === 'ES256' ? 64 : 256);
  assert.equal(canonicalize(JSON.parse(payload)), payload);
  if (text(verified.payload) !== payload) throw new PackageError('PAYLOAD_BINDING_MISMATCH');
}

function mutate(token, part) {
  const pieces = token.split('.');
  const bytes = Buffer.from(pieces[part], 'base64url');
  bytes[0] ^= 1;
  pieces[part] = bytes.toString('base64url');
  return pieces.join('.');
}
const signatureMismatch = error => error instanceof errors.JWSSignatureVerificationFailed &&
  error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' && !('cause' in error);

async function main() {
  assert.equal(process.argv.length, 3);
  assert.equal(process.permission.has('fs.write'), false);
  assert.equal(process.permission.has('net'), false);
  const directory = resolve(process.argv[2]);
  assert.equal((await lstat(directory)).isDirectory(), true);
  assert.deepEqual((await readdir(directory)).sort(), [...names, 'sha256.json'].sort());
  const files = new Map();
  for (const name of [...names, 'sha256.json']) {
    const path = join(directory, name), info = await lstat(path);
    assert.equal(info.isFile(), true); // Symlinks/directories are rejected.
    assert.ok(info.size < 100000);
    files.set(name, await readFile(path));
  }
  const manifest = JSON.parse(text(files.get('sha256.json')));
  checkHashes(files, manifest);
  console.log('PASS package exact-file-set/public-only/hash-manifest');
  let count = 1;
  const payload = text(files.get('payload.json'));
  assert.deepEqual(JSON.parse(text(files.get('results.json'))), {
    scope: 'synthetic-local-mechanism-only', results: ['ES256', 'PS256'].map(algorithm =>
      ({ algorithm, generationVerification: true })),
  }); // Metadata only; signatures are verified again below.
  for (const alg of ['ES256', 'PS256']) {
    const token = text(files.get(`${alg}.jws`));
    const jwk = JSON.parse(text(files.get(`${alg}.public.jwk.json`)));
    await verifyRecord(alg, token, jwk, payload);
    console.log(`PASS ${alg} exported-original-jws/payload/public-key`); count++;
    // Construct mutations outside the expected-rejection checks; no file changes.
    const changedPayload = mutate(token, 1), changedSignature = mutate(token, 2);
    await assert.rejects(() => verifyRecord(alg, changedPayload, jwk, payload), signatureMismatch);
    console.log(`PASS ${alg} modified-jws-payload-rejected ERR_JWS_SIGNATURE_VERIFICATION_FAILED`); count++;
    await assert.rejects(() => verifyRecord(alg, changedSignature, jwk, payload), signatureMismatch);
    console.log(`PASS ${alg} modified-signature-rejected ERR_JWS_SIGNATURE_VERIFICATION_FAILED`); count++;
    const otherPayload = canonicalize({ ...JSON.parse(payload), recordId: 'synthetic-modified' });
    await assert.rejects(() => verifyRecord(alg, token, jwk, otherPayload), error =>
      error instanceof PackageError && error.code === 'PAYLOAD_BINDING_MISMATCH');
    console.log(`PASS ${alg} modified-external-payload-rejected PAYLOAD_BINDING_MISMATCH`); count++;
  }
  const changedFiles = new Map(files);
  changedFiles.set('payload.json', Buffer.from(`${payload}\n`));
  assert.throws(() => checkHashes(changedFiles, manifest), error =>
    error instanceof PackageError && error.code === 'FILE_HASH_MISMATCH');
  console.log('PASS package modified-file-rejected FILE_HASH_MISMATCH'); count++;
  console.log(`SHA256 sha256.json ${hash(files.get('sha256.json'))}`);
  console.log(`RESULT ${count}/${count} package checks; local mechanics only; C01-C11 NOT RUN; F1/D03 OPEN`);
}
try { await main(); }
catch { console.error('FAIL package verification (details suppressed)'); process.exitCode = 1; }
