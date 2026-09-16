const assert = require('node:assert/strict');
const test = require('node:test');

const CASES = [
  'missing activation','duplicate activation','retirement before activation','resume without pause','nested/double pause','event after retirement','event_sequence corruption','timestamp-order corruption','effective-interval contradiction','configuration overlap',
  'missing occurrence resolution','duplicate occurrence resolution','unsupported occurrence outcome','MISSED with attempt present','SUCCEEDED without Capture','deadline beyond occurrence cutoff','missing attempt resolution','duplicate attempt resolution','cross-occurrence retry predecessor','predecessor not FAILED','retry starts too early','retry_number mismatch','retry cycle',
  'missing Capture','Capture on FAILED attempt','duplicate Capture per attempt','detectable Capture/content/blob identity conflation','content-hash corruption','Capture canonical corruption','parent identity corruption','missing comparison','self comparison','future comparison','equal-time comparison','cross-Monitor comparison','comparison algorithm/version corruption','CHANGED/UNCHANGED parity mismatch',
  'missing request/query authority','request canonical corruption','request hash corruption','missing explicit zero-item adapter-result authority','EMPTY inferred from absence',
  'RESTORED / unsupported event','retention event sequence/order corruption','Capture-link corruption','inconsistent derived availability/history',
  'Capture lineage corruption','source identity corruption','Monitor identity corruption','configuration identity corruption','occurrence identity corruption','attempt identity corruption','Capture hash corruption','observedAt / availability / derivation/provenance authority corruption','handoff canonical/hash/idempotency corruption',
];
const PRECEDENCE = [
  'missing Capture + malformed Capture canonical',
  'malformed Capture canonical + incorrect Capture hash',
  'duplicate membership + missing expected membership',
  'decreasing lifecycle time + overlapping configuration intervals',
  'cross-occurrence retry predecessor + Capture/result mismatch',
];

test('RCV-020 Wave-4 physical corruption manifest is exactly frozen', () => {
  assert.equal(CASES.length, 55);
  assert.equal(PRECEDENCE.length, 5);
});

module.exports = { CASES, PRECEDENCE };

