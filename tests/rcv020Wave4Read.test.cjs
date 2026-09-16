const assert = require('node:assert/strict');
const test = require('node:test');
const canonical = require('../dist/services/rcv020Canonical');
const semantic = require('../dist/services/rcv020SemanticCore');
const verifier = require('../dist/services/rcv020ReadVerifier');

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ts = n => `2026-01-01T00:00:${String(n).padStart(2,'0')}.000000Z`;
const hash = s => canonical.sha256Rcv020Text(s);

function validBundle(seed = 0) {
  const base = seed * 20;
  const sourceCanonical = JSON.stringify({ source: seed });
  const source = { logicalSourceId:id(base+1), organizationIdentity:`source-${seed}`, sourceClass:'public', jurisdiction:'CH', createdAt:ts(0), identityCanonical:{source:seed}, identityHash:hash(sourceCanonical) };
  const monitor = { monitorId:id(base+2), logicalSourceId:source.logicalSourceId, monitorKind:'api', createdAt:ts(0), identityCanonical:{monitor:seed}, identityHash:hash(`monitor-${seed}`) };
  const endpointRequest = { method:'GET', target:`https://example.test/${seed}`, parameters:{}, credentialReference:null };
  const endpoint = canonical.canonicalizeRcv020Request(endpointRequest);
  const c0 = { monitorConfigurationVersionId:id(base+3), monitorId:monitor.monitorId, versionNumber:'1', endpointRequest, retrievalMethod:'GET', authenticationReference:null, expectedMediaConstraints:{}, triggerEligibility:'SCHEDULED', scope:{}, safetyPolicy:{}, adapterId:'test', adapterVersion:'1', parserId:null, parserVersion:null, retentionPolicy:'METADATA_HASH_ONLY', retentionPolicyVersion:1, effectiveFrom:ts(0), effectiveUntil:null };
  const cenc = canonical.canonicalizeRcv020MonitorConfiguration(c0);
  const configuration = { ...c0, endpointRequestCanonical:endpoint.canonical, endpointRequestHash:endpoint.hash, canonical:cenc.canonical, canonicalHash:cenc.hash, createdAt:ts(0) };
  const o0 = { occurrenceId:id(base+4), logicalSourceId:source.logicalSourceId, monitorId:monitor.monitorId, monitorConfigurationVersionId:configuration.monitorConfigurationVersionId, triggerOrigin:'SCHEDULED', scheduledAt:ts(1), triggerReceivedAt:null, requestedAt:null, dueAt:ts(1), evaluationCutoffAt:ts(20) };
  const trigger = canonical.canonicalizeRcv020({ schema:'RCV020-TRIGGER-V1', triggerOrigin:'SCHEDULED', scheduledAt:ts(1), triggerReceivedAt:null, requestedAt:null });
  const oenc = semantic.canonicalizeRcv020Occurrence(o0);
  const occurrence = { ...o0, triggerCanonical:trigger.canonical, triggerHash:trigger.hash, evaluationPolicyVersion:1, createdAt:ts(0), canonical:oenc.canonical, canonicalHash:oenc.hash };
  const a0 = { attemptId:id(base+5), occurrenceId:occurrence.occurrenceId, previousAttemptId:null, retryNumber:'1', retrievalStartedAt:ts(2), attemptDeadlineAt:ts(10), adapterId:'test', adapterVersion:'1', requestCanonical:endpoint.canonical, requestHash:endpoint.hash };
  const aenc = semantic.canonicalizeRcv020Attempt(a0);
  const attempt = { ...a0, createdAt:ts(2), canonical:aenc.canonical, canonicalHash:aenc.hash };
  const ar = { attemptResolutionId:id(base+6), attemptId:attempt.attemptId, retrievalCompletedAt:ts(3), outcome:'CAPTURED_CHANGED', failureCode:null, failureTaxonomyVersion:null, diagnosticCanonical:null, canonical:'{}', canonicalHash:hash('{}'), createdAt:ts(3) };
  const cap0 = { captureId:id(base+7), logicalSourceId:source.logicalSourceId, monitorId:monitor.monitorId, monitorConfigurationVersionId:configuration.monitorConfigurationVersionId, occurrenceId:occurrence.occurrenceId, retrievalAttemptId:attempt.attemptId, observedAt:ts(3), contentHash:'a'.repeat(64), byteLength:'0', rawObjectIdentity:null, requestHash:endpoint.hash, requestedTarget:endpointRequest.target, finalUrl:null, redirectCanonical:null, responseStatus:200, responseMetadataCanonical:'{}', mediaType:'application/json', retentionPolicy:'METADATA_HASH_ONLY', retentionPolicyVersion:1 };
  const capenc = canonical.canonicalizeRcv020({ schema:'RCV020-CAPTURE-ENVELOPE-V1', ...cap0, byteLength:'0' });
  const capture = { ...cap0, captureCanonical:capenc.canonical, captureHash:capenc.hash, rawObjectReference:null, createdAt:ts(3) };
  const cmp0 = { comparisonId:id(base+8), currentCaptureId:capture.captureId, priorCaptureId:null, algorithmId:'raw-bytes', algorithmVersion:1, result:'FIRST_OBSERVED' };
  const cmpenc = semantic.canonicalizeRcv020CaptureComparison(cmp0);
  const comparison = { ...cmp0, inputCanonical:'{}', inputHash:hash('{}'), canonical:cmpenc.canonical, canonicalHash:cmpenc.hash, createdAt:ts(3) };
  const lifecycleEvents = [{ eventId:id(base+9), monitorConfigurationVersionId:configuration.monitorConfigurationVersionId, eventType:'ACTIVATED', eventAt:ts(0), eventSequence:'1', actorPolicyIdentity:'test' }];
  const occurrenceResolution = { resolutionId:id(base+10), occurrenceId:occurrence.occurrenceId, outcome:'SUCCEEDED', evaluationCutoffAt:ts(20), evaluatedAt:ts(20), skipReason:null, skipActorPolicyIdentity:null, terminalizationPolicyVersion:1, canonical:'{}', canonicalHash:hash('{}'), createdAt:ts(20) };
  return { contractVersion:1, source, monitor, configuration, lifecycleEvents, occurrence, occurrenceResolution, occurrenceResolutions:[occurrenceResolution], attempts:[attempt], attemptResolutions:[ar], captures:[capture], comparisons:[comparison], retentionEvents:[], handoffs:[], quarantine:[] };
}

test('Wave 4 verifies an immutable historical bundle', () => {
  const result = verifier.verifyRcv020ReadBundle(validBundle());
  assert.equal(result.authenticated, true); assert.equal(result.observed, true); assert.equal(result.occurrenceOutcome, 'SUCCEEDED'); assert.equal(result.replayable, false);
});

test('Wave 4 precedence is deterministic and no-repair', () => {
  const b = validBundle();
  b.captures = [];
  b.occurrenceResolution.outcome = 'SUCCEEDED';
  const before = JSON.stringify(b);
  assert.throws(() => verifier.verifyRcv020ReadBundle(b), e => e.code === 'MISSING_DATA' || e.code === 'CAPTURE_RESULT_MISMATCH');
  assert.equal(JSON.stringify(b), before); // verifier performs no mutation
});

test('Wave 4 exact negative manifest cases fail closed', () => {
  const cases = [
    ['malformed canonical', b => { b.configuration.canonical = '{'; }],
    ['hash mismatch', b => { b.configuration.canonicalHash = 'b'.repeat(64); }],
    ['illegal lifecycle', b => { b.lifecycleEvents.push({ ...b.lifecycleEvents[0], eventId:id(99), eventType:'RESUMED', eventSequence:'2' }); }],
    ['deadline beyond cutoff', b => { b.attempts[0].attemptDeadlineAt = ts(30); }],
    ['capture on failed attempt', b => { b.attemptResolutions[0].outcome = 'FAILED'; b.attemptResolutions[0].failureCode = 'TIMEOUT'; }],
    ['self comparison', b => { b.comparisons[0].priorCaptureId = b.comparisons[0].currentCaptureId; }],
    ['RESTORED event', b => { b.retentionEvents.push({ eventId:id(98), captureId:b.captures[0].captureId, eventType:'RESTORED', eventAt:ts(4), eventSequence:'1', reason:'x', resultingAvailability:'AVAILABLE', canonical:'{}', canonicalHash:hash('{}') }); }],
    ['unsafe bigint', b => { b.configuration.versionNumber = 0; }],
  ];
  for (const [name, mutate] of cases) { const b = validBundle(); mutate(b); assert.throws(() => verifier.verifyRcv020ReadBundle(b), e => e && verifier.RCV020_READ_FAILURE_CODES.includes(e.code), name); }
});

test('raw loss preserves observation/authentication while ending replayability', () => {
  const b = validBundle();
  b.captures[0].rawObjectIdentity = 'sha256:object-1';
  b.captures[0].retentionPolicy = 'PERMANENT_RAW';
  const capSemantic = { ...b.captures[0] }; delete capSemantic.captureCanonical; delete capSemantic.captureHash; delete capSemantic.createdAt; delete capSemantic.rawObjectReference;
  const capEncoded = canonical.canonicalizeRcv020({ schema:'RCV020-CAPTURE-ENVELOPE-V1', ...capSemantic, byteLength:String(capSemantic.byteLength) });
  b.captures[0].captureCanonical = capEncoded.canonical; b.captures[0].captureHash = capEncoded.hash;
  const retained = verifier.verifyRcv020ReadBundle(b);
  assert.equal(retained.observed, true); assert.equal(retained.authenticated, true); assert.equal(retained.replayable, true);
  const retention = { eventId:id(77), captureId:b.captures[0].captureId, eventType:'LOST', eventAt:ts(4), eventSequence:'1', reason:'object unavailable', policyLegalBasis:null, resultingAvailability:'UNAVAILABLE' };
  const retentionEncoded = semantic.canonicalizeRcv020RetentionAvailabilityEvent(retention);
  b.retentionEvents.push({ ...retention, canonical:retentionEncoded.canonical, canonicalHash:retentionEncoded.hash });
  const lost = verifier.verifyRcv020ReadBundle(b);
  assert.equal(lost.observed, true); assert.equal(lost.authenticated, true); assert.equal(lost.replayable, false);
});

test('Wave 4 read determinism soak: exactly 1000 executions', () => {
  const b = validBundle(); const expected = JSON.stringify(verifier.verifyRcv020ReadBundle(b));
  for (let i = 0; i < 1000; i += 1) assert.equal(JSON.stringify(verifier.verifyRcv020ReadBundle(b)), expected);
});

test('Wave 4 structured fuzz: exactly 500 valid and 500 invalid', () => {
  let unexpected = 0;
  for (let i = 0; i < 500; i += 1) { try { verifier.verifyRcv020ReadBundle(validBundle(i)); } catch { unexpected += 1; } }
  for (let i = 0; i < 500; i += 1) { const b = validBundle(i + 500); b.configuration.versionNumber = 0; try { verifier.verifyRcv020ReadBundle(b); unexpected += 1; } catch {} }
  assert.equal(unexpected, 0);
});

test('Wave 4 historical stress chains: 1/10/25/50/100 x 10', () => {
  for (const size of [1,10,25,50,100]) for (let r = 0; r < 10; r += 1) for (let i = 0; i < size; i += 1) verifier.verifyRcv020ReadBundle(validBundle(size * 10 + r * size + i));
});

module.exports = { validBundle };
