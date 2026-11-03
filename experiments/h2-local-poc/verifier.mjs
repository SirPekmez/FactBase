// Public-only interface. Run under Node's permission model, with no write grant.
import { compactVerify, importJWK, errors } from 'jose';
import canonicalize from '../../node_modules/canonicalize/lib/canonicalize.js';

const TYPE = 'h2-local-poc-only+jws';
const profiles = Object.freeze({
  ES256: { kty: 'EC', crv: 'P-256', bytes: 64 },
  PS256: { kty: 'RSA', bytes: 256 },
});

class PrototypeRejection extends Error {
  constructor(code) { super(code); this.code = code; }
}
class ImportFailure extends Error {
  constructor(cause) { super('POC_IMPORT_FAILURE', { cause }); }
}

// These are only PoC test expectations, not H2 error codes or priorities.
const expectedRejections = new Map([
  ['KEY_PROFILE', PrototypeRejection],
  ['UNKNOWN_KID', PrototypeRejection],
  ['ERR_JWS_SIGNATURE_VERIFICATION_FAILED', errors.JWSSignatureVerificationFailed],
  ['ERR_JOSE_ALG_NOT_ALLOWED', errors.JOSEAlgNotAllowed],
]);

async function verify({ token, publicJwk, algorithm, kid, expectedPayload }) {
  const profile = profiles[algorithm];
  if (!profile || publicJwk.d || publicJwk.k || publicJwk.kty !== profile.kty ||
      (profile.crv && publicJwk.crv !== profile.crv)) throw new PrototypeRejection('KEY_PROFILE');
  if (algorithm === 'PS256' && Buffer.from(publicJwk.n, 'base64url').length !== 256)
    throw new PrototypeRejection('KEY_PROFILE'); // Deliberately only the 2048-bit PoC case.
  let key;
  try { key = await importJWK(publicJwk, algorithm); }
  catch (cause) { throw new ImportFailure(cause); }
  const result = await compactVerify(token, (header) => {
    if (header.alg !== algorithm) throw new Error('ALGORITHM_PROFILE');
    if (header.kid !== kid) throw new PrototypeRejection('UNKNOWN_KID');
    if (header.typ !== TYPE || Object.keys(header).sort().join(',') !== 'alg,kid,typ')
      throw new Error('HEADER_PROFILE');
    return key;
  }, { algorithms: [algorithm] });
  if (token.split('.').length !== 3 || !token.split('.')[1] ||
      Buffer.from(token.split('.')[2], 'base64url').length !== profile.bytes)
    throw new Error('SIGNATURE_FORMAT');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(result.payload);
  if (canonicalize(JSON.parse(text)) !== text || text !== expectedPayload)
    throw new Error('PAYLOAD_PROFILE');
  return true;
}

async function evaluate({ expectedRejection, ...request }) {
  const expectedClass = expectedRejections.get(expectedRejection);
  if (expectedRejection !== null && !expectedClass) throw new Error('INVALID_TEST_EXPECTATION');
  try { await verify(request); }
  catch (error) {
    // A wrapped WebCrypto exception is not a clean signature-mismatch result.
    // Import/setup/runtime errors and wrong rejection reasons fail the process.
    if (!expectedClass || !(error instanceof expectedClass) ||
        error.code !== expectedRejection || 'cause' in error) throw error;
    return { accepted: false, code: error.code };
  }
  if (expectedRejection !== null) throw new Error('EXPECTED_REJECTION_MISSING');
  return { accepted: true };
}

async function runControl(control, requests) {
  if (requests.length !== 1) throw new Error('CONTROL_SETUP');
  const request = requests[0];
  // Validate control setup before the catch that observes the verifier failure.
  if (control === 'import-error') {
    if (request.expectedRejection !== 'KEY_PROFILE' ||
        request.publicJwk.ext !== 'poc-invalid-boolean')
      throw new Error('CONTROL_SETUP');
  } else if (control !== 'wrong-rejection' || request.expectedRejection !== 'UNKNOWN_KID') {
    throw new Error('CONTROL_SETUP');
  }
  let marker;
  try { await evaluate(request); }
  catch (error) {
    if (control === 'import-error' && error instanceof ImportFailure &&
        error.cause instanceof TypeError && error.cause.constructor === TypeError &&
        error.cause.code === undefined && !('cause' in error.cause)) {
      marker = 'POC_CONTROL_IMPORT_TYPE_ERROR_V1';
    } else if (control === 'wrong-rejection' &&
        error instanceof errors.JWSSignatureVerificationFailed &&
        error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' && !('cause' in error)) {
      marker = 'POC_CONTROL_SIGNATURE_FAILURE_RETHROWN_V1';
    } else { throw error; }
  }
  if (!marker) throw new Error('CONTROL_FAILURE_MISSING');
  // Only reached after the exact failure escaped evaluate's rejection catch.
  process.stdout.write(`${marker}\n`);
  process.exitCode = 42;
}

// No signing function, private key, file-writing API, network or subprocess grant.
async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 200000) throw new Error('INPUT_LIMIT');
  }
  const { requests, control } = JSON.parse(input);
  if (control !== null) { await runControl(control, requests); return; }
  const results = [];
  for (const request of requests) results.push(await evaluate(request));
  process.stdout.write(JSON.stringify({
    writeAllowed: process.permission.has('fs.write'),
    networkAllowed: process.permission.has('net'),
    results,
  }));
}
try { await main(); }
catch {
  // Fixed diagnostic only: never expose exception text, stack or input data.
  console.error('FAIL verifier unexpected failure');
  process.exitCode = 1;
}
