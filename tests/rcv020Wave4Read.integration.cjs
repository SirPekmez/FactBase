const assert = require('node:assert/strict');
const test = require('node:test');
const { Pool } = require('pg');
const { persistRcv020Authority } = require('../dist/services/rcv020PersistenceService');
const { Rcv020PostgresReadRepository } = require('../dist/services/rcv020PostgresReadRepository');
const { Rcv020ReadService } = require('../dist/services/rcv020ReadService');
const c = require('../dist/services/rcv020Canonical');
const s = require('../dist/services/rcv020SemanticCore');

const database = process.env.RCV020_W4_DATABASE;
const enabled = Boolean(database && /^factbase_rcv020_wave4_physical_[a-z0-9_]+$/.test(database) && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 8 }) : null;
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ts = n => `2026-01-01T00:00:${String(n).padStart(2,'0')}.000000Z`;
const hash = x => c.sha256Rcv020Text(x);
function fixture() {
  const source = { logicalSourceId:id(1), organizationIdentity:'wave4-source', sourceClass:'public', jurisdiction:'CH', canonical:JSON.stringify({source:1}), identityHash:hash(JSON.stringify({source:1})) };
  const monitor = { monitorId:id(2), logicalSourceId:id(1), monitorKind:'api', canonical:'{}', identityHash:hash('{}') };
  const endpointRequest = { method:'GET', target:'https://example.test/items', parameters:{}, credentialReference:null };
  const ep = c.canonicalizeRcv020Request(endpointRequest);
  const config0 = { monitorConfigurationVersionId:id(3), monitorId:id(2), versionNumber:'9007199254740993', endpointRequest, retrievalMethod:'GET', authenticationReference:null, expectedMediaConstraints:{}, triggerEligibility:'SCHEDULED', scope:{}, safetyPolicy:{}, adapterId:'test', adapterVersion:'1', parserId:null, parserVersion:null, retentionPolicy:'METADATA_HASH_ONLY', retentionPolicyVersion:1, effectiveFrom:ts(0), effectiveUntil:null };
  const config = { ...config0, canonical:c.canonicalizeRcv020MonitorConfiguration(config0).canonical, canonicalHash:c.canonicalizeRcv020MonitorConfiguration(config0).hash };
  const occurrence0 = { occurrenceId:id(4), logicalSourceId:id(1), monitorId:id(2), monitorConfigurationVersionId:id(3), triggerOrigin:'SCHEDULED', scheduledAt:ts(1), triggerReceivedAt:null, requestedAt:null, dueAt:ts(1), evaluationCutoffAt:ts(20) };
  const trigger = c.canonicalizeRcv020({schema:'RCV020-TRIGGER-V1', triggerOrigin:'SCHEDULED', scheduledAt:ts(1), triggerReceivedAt:null, requestedAt:null});
  const occurrence = { ...occurrence0, triggerCanonical:trigger.canonical, triggerHash:trigger.hash };
  const requestCanonical = ep.canonical, requestHash = ep.hash;
  const attempt0 = { attemptId:id(5), occurrenceId:id(4), previousAttemptId:null, retryNumber:'1', retrievalStartedAt:ts(2), attemptDeadlineAt:ts(10), adapterId:'test', adapterVersion:'1', requestCanonical, requestHash };
  const attempt = { ...attempt0 };
  const ar = { attemptResolutionId:id(6), attemptId:id(5), retrievalCompletedAt:ts(3), outcome:'CAPTURED_CHANGED', failureCode:null };
  const cap0 = { captureId:id(7), logicalSourceId:id(1), monitorId:id(2), monitorConfigurationVersionId:id(3), occurrenceId:id(4), retrievalAttemptId:id(5), observedAt:ts(3), contentHash:'a'.repeat(64), byteLength:'0', rawObjectIdentity:null, requestHash, requestedTarget:endpointRequest.target, finalUrl:null, redirectCanonical:null, responseStatus:200, responseMetadataCanonical:'{}', mediaType:'application/json', retentionPolicy:'METADATA_HASH_ONLY', retentionPolicyVersion:1 };
  const cap = { ...cap0, captureHash:c.canonicalizeRcv020({schema:'RCV020-CAPTURE-ENVELOPE-V1', ...cap0, byteLength:'0'}).hash };
  const cmp0 = { comparisonId:id(8), currentCaptureId:id(7), priorCaptureId:null, algorithmId:'raw-bytes', algorithmVersion:1, result:'FIRST_OBSERVED' };
  const cmp = { ...cmp0, inputCanonical:'{}', inputHash:hash('{}') };
  const occRes = { resolutionId:id(10), occurrenceId:id(4), outcome:'SUCCEEDED', evaluationCutoffAt:ts(20), evaluatedAt:ts(20), skipReason:null, skipActorPolicyIdentity:null, terminalizationPolicyVersion:1, canonical:'{}', canonicalHash:hash('{}') };
  return { contractVersion:1, sources:[source], monitors:[monitor], configurations:[config], lifecycleEvents:[{eventId:id(9), monitorConfigurationVersionId:id(3), eventType:'ACTIVATED', eventAt:ts(0), eventSequence:'9007199254740995', actorPolicyIdentity:'test'}], occurrences:[occurrence], occurrenceResolutions:[occRes], attempts:[attempt], attemptResolutions:[ar], captures:[cap], comparisons:[cmp], retentionEvents:[], handoffs:[], quarantine:[] };
}

test('Wave 4 physical read projection, verification, no-repair, and current-state independence', { skip: !enabled }, async () => {
  await persistRcv020Authority(pool, fixture());
  const repo = new Rcv020PostgresReadRepository(pool);
  const raw = await repo.loadByOccurrenceId(id(4));
  assert.ok(raw); assert.equal(raw.configuration.versionNumber, '9007199254740993');
  const verified = await new Rcv020ReadService(repo).readOccurrence(id(4));
  assert.equal(verified.occurrenceOutcome, 'SUCCEEDED'); assert.equal(verified.authenticated, true);
  const before = (await pool.query('SELECT canonical FROM public.rcv020_captures WHERE capture_id=$1',[id(7)])).rows[0].canonical;
  await pool.query("SET session_replication_role='replica'");
  await pool.query("UPDATE public.rcv020_captures SET canonical='{' WHERE capture_id=$1", [id(7)]);
  await pool.query("SET session_replication_role='origin'");
  await assert.rejects(() => new Rcv020ReadService(repo).readOccurrence(id(4)), e => e.code === 'MALFORMED_DATA' || e.code === 'CANONICAL_MISMATCH');
  const after = (await pool.query('SELECT canonical FROM public.rcv020_captures WHERE capture_id=$1',[id(7)])).rows[0].canonical;
  assert.equal(after, '{'); assert.notEqual(before, after);
});

test.after(async () => { if (pool) await pool.end(); });

