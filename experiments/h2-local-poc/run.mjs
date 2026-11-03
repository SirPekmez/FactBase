import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { verify as verifySignature, constants } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CompactSign, compactVerify, generateKeyPair, exportJWK } from 'jose';
import canonicalize from '../../node_modules/canonicalize/lib/canonicalize.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const jcsPath = fileURLToPath(new URL('../../node_modules/canonicalize/', import.meta.url));
const type = 'h2-local-poc-only+jws';
// Entirely artificial: these are NOT real Capture hashes, W2 measurements or H2 fields.
const literal = '{"attemptId":"poc-attempt","basisHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","captureId":"poc-capture","issuerId":"poc-factbase","recordId":"poc-h2","schemaVersion":"POC-NOT-H2-PROFILE","w2Refs":["poc-acquisition","poc-readback"]}';
const payload = canonicalize({
  w2Refs: ['poc-acquisition', 'poc-readback'], schemaVersion: 'POC-NOT-H2-PROFILE',
  recordId: 'poc-h2', issuerId: 'poc-factbase', captureId: 'poc-capture',
  basisHash: 'a'.repeat(64), attemptId: 'poc-attempt',
});
assert.equal(payload, literal); // Hand-written literal, separate from serializer output.
const bytes = new TextEncoder().encode(payload);

const CONTROL_EXIT = 42;
const controlMarkers = Object.freeze({
  'import-error': 'POC_CONTROL_IMPORT_TYPE_ERROR_V1',
  'wrong-rejection': 'POC_CONTROL_SIGNATURE_FAILURE_RETHROWN_V1',
});
const processError = code => Object.assign(new Error(code), { code });

function checkProcessResult({ spawnError, ioError, code, signal, output, diagnostics }, marker) {
  if (spawnError) throw processError('POC_SPAWN_ERROR');
  if (signal !== null) throw processError('POC_SIGNAL_ABORT');
  if (ioError) throw processError('POC_PROCESS_IO_ERROR');
  if (code !== (marker ? CONTROL_EXIT : 0)) throw processError('POC_EXIT_STATUS');
  if (diagnostics !== '') throw processError('POC_PROCESS_DIAGNOSTICS');
  if (marker) {
    // Exact whole output: no missing, extra, duplicate or alternative marker.
    if (output !== `${marker}\n`) throw processError('POC_CONTROL_MARKER');
    return { controlled: marker };
  }
  try { return JSON.parse(output); } catch { throw processError('POC_VERIFIER_OUTPUT'); }
}

function invokeVerifier(requests, control = null) {
  const input = JSON.stringify({ requests, control }); // Setup outside process callbacks.
  const marker = control === null ? null : controlMarkers[control];
  if (control !== null && !marker) throw processError('POC_INVALID_CONTROL');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--permission', `--allow-fs-read=${here}`, `--allow-fs-read=${jcsPath}`,
      fileURLToPath(new URL('verifier.mjs', import.meta.url)),
    ], { cwd: here, env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '', spawnError = false, ioError = false;
    // Suppress raw diagnostics; no token/key/material is printed on failure.
    child.stderr.on('data', data => { diagnostics += data; });
    child.stdout.on('data', data => { output += data; });
    child.on('error', () => { spawnError = true; });
    for (const stream of [child.stdin, child.stdout, child.stderr])
      stream.on('error', () => { ioError = true; });
    child.on('close', (code, signal) => {
      try { resolve(checkProcessResult({ spawnError, ioError, code, signal, output, diagnostics }, marker)); }
      catch (error) { reject(error); }
    });
    child.stdin.end(input);
  });
}

function mutate(token, part) {
  const segments = token.split('.');
  const data = Buffer.from(segments[part], 'base64url');
  data[0] ^= 1;
  segments[part] = data.toString('base64url');
  return segments.join('.');
}

async function run() {
  let count = 0;
  // Synthetic process-result records, not deliberately crashed real processes.
  const marker = controlMarkers['import-error'];
  const processResult = { spawnError: false, ioError: false, code: CONTROL_EXIT,
    signal: null, output: `${marker}\n`, diagnostics: '' };
  const processCases = [
    ['missing-marker', { output: '' }, 'POC_CONTROL_MARKER'],
    ['wrong-marker', { output: 'POC_WRONG\n' }, 'POC_CONTROL_MARKER'],
    ['duplicate-marker', { output: `${marker}\n${marker}\n` }, 'POC_CONTROL_MARKER'],
    ['wrong-control-exit', { code: 0 }, 'POC_EXIT_STATUS'],
    ['signal-abort', { code: null, signal: 'SIGTERM' }, 'POC_SIGNAL_ABORT'],
    ['spawn-error', { spawnError: true, code: null }, 'POC_SPAWN_ERROR'],
    ['stream-error', { ioError: true }, 'POC_PROCESS_IO_ERROR'],
    ['unexpected-exit', { code: 1 }, 'POC_EXIT_STATUS'],
  ];
  for (const [name, change, code] of processCases) {
    assert.throws(() => checkProcessResult({ ...processResult, ...change }, marker), { code });
    console.log(`PASS process-result ${name} ${code}`); count++;
  }
  const keys = {};
  for (const alg of ['ES256', 'PS256']) {
    keys[alg] = await generateKeyPair(alg, { extractable: false, modulusLength: 2048 });
    const actual = keys[alg].privateKey.algorithm;
    assert.equal(keys[alg].privateKey.extractable, false);
    if (alg === 'ES256') assert.equal(actual.namedCurve, 'P-256');
    else { assert.equal(actual.name, 'RSA-PSS'); assert.equal(actual.modulusLength, 2048); assert.equal(actual.hash.name, 'SHA-256'); }
  }
  for (const alg of ['ES256', 'PS256']) {
    const kid = `poc-only-${alg}`;
    const sign = (header, key = keys[alg].privateKey) =>
      new CompactSign(bytes).setProtectedHeader(header).sign(key);
    const token = await sign({ alg, kid, typ: type });
    const segments = token.split('.');
    assert.equal(segments.length, 3);
    assert.equal(Buffer.from(segments[1], 'base64url').toString('utf8'), literal);
    assert.equal(Buffer.from(segments[2], 'base64url').length, alg === 'ES256' ? 64 : 256);
    // A second standard-library API checks exact JWS input and explicit formats.
    // It shares this Node/OpenSSL runtime: not an independent trust instance.
    const signingInput = Buffer.from(`${segments[0]}.${segments[1]}`, 'ascii');
    const signature = Buffer.from(segments[2], 'base64url');
    const keyOptions = alg === 'ES256'
      ? { key: keys[alg].publicKey, dsaEncoding: 'ieee-p1363' }
      : { key: keys[alg].publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };
    assert.equal(verifySignature('sha256', signingInput, keyOptions, signature), true);
    console.log(`PASS ${alg} explicit-format-public-node-verification`); count++;
    if (alg === 'PS256') {
      assert.equal(verifySignature('sha256', signingInput, { ...keyOptions, saltLength: 0 }, signature), false);
      console.log('PASS PS256 salt-zero-rejected'); count++;
    }
    const other = alg === 'ES256' ? 'PS256' : 'ES256';
    const publicJwk = await exportJWK(keys[alg].publicKey);
    assert.equal(publicJwk.d, undefined);
    const base = { token, publicJwk, algorithm: alg, kid, expectedPayload: literal };
    const wrongAlgorithm = await new CompactSign(bytes)
      .setProtectedHeader({ alg: other, kid, typ: type }).sign(keys[other].privateKey);
    const unknownKid = await sign({ alg, kid: 'poc-unknown', typ: type });
    // Build and validate control tokens outside all expected-rejection catches.
    await compactVerify(wrongAlgorithm, keys[other].publicKey, { algorithms: [other] });
    await compactVerify(unknownKid, keys[alg].publicKey, { algorithms: [alg] });
    const cases = [
      ['valid', base, null],
      ['signature-mutated', { ...base, token: mutate(token, 2) }, 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'],
      ['payload-mutated', { ...base, token: mutate(token, 1) }, 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'],
      ['unknown-kid-valid-signature', { ...base, token: unknownKid }, 'UNKNOWN_KID'],
      ['wrong-key-type', { ...base, publicJwk: await exportJWK(keys[other].publicKey) }, 'KEY_PROFILE'],
      ['other-algorithm-valid-signature', { ...base, token: wrongAlgorithm }, 'ERR_JOSE_ALG_NOT_ALLOWED'],
    ];
    const response = await invokeVerifier(cases.map(([, request, expectedRejection]) => ({ ...request, expectedRejection })));
    assert.equal(response.writeAllowed, false);
    assert.equal(response.networkAllowed, false);
    assert.equal(response.results.length, cases.length);
    for (let i = 0; i < cases.length; i++) {
      const [name, , expectedRejection] = cases[i];
      assert.deepEqual(response.results[i], expectedRejection === null
        ? { accepted: true } : { accepted: false, code: expectedRejection }, `${alg} ${name}`);
      console.log(`PASS ${alg} ${name}${expectedRejection ? ` ${expectedRejection}` : ''}`); count++;
    }
    const wrongKey = keys[other].privateKey;
    assert.equal(wrongKey.type, 'private');
    assert.equal(wrongKey.algorithm.name, other === 'ES256' ? 'ECDSA' : 'RSA-PSS');
    const mismatchedSigner = new CompactSign(bytes).setProtectedHeader({ alg, kid, typ: type });
    await assert.rejects(() => mismatchedSigner.sign(wrongKey), error =>
      error instanceof TypeError && error.constructor === TypeError &&
      error.code === undefined && !('cause' in error));
    console.log(`PASS ${alg} signer-rejects-wrong-key TypeError`); count++;
    // Regression guards: unexpected import errors and wrong rejection causes
    // must terminate the verifier, never become successful negative cases.
    const invalidJwk = { ...publicJwk, ext: 'poc-invalid-boolean' };
    const importControl = [
      { ...base, publicJwk: invalidJwk, expectedRejection: 'KEY_PROFILE' },
    ];
    const rejectionControl = [
      { ...base, token: mutate(token, 2), expectedRejection: 'UNKNOWN_KID' },
    ];
    assert.deepEqual(await invokeVerifier(importControl, 'import-error'),
      { controlled: controlMarkers['import-error'] });
    console.log(`PASS ${alg} unexpected-import-error-fails-verifier`); count++;
    assert.deepEqual(await invokeVerifier(rejectionControl, 'wrong-rejection'),
      { controlled: controlMarkers['wrong-rejection'] });
    console.log(`PASS ${alg} wrong-rejection-cause-fails-verifier`); count++;
    console.log(`PASS ${alg} embedded-payload/signature-format/public-only-read-only-verifier`); count++;
  }
  console.log(`RESULT ${count}/${count} local checks; C01-C11 NOT RUN; F1/D03 OPEN`);
}

try { await run(); }
catch { console.error('FAIL local prototype (details suppressed)'); process.exitCode = 1; }
