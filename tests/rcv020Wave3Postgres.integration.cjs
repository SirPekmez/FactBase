const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const { persistRcv020Authority } = require("../dist/services/rcv020PersistenceService");
const { insertHandoff } = require("../dist/services/rcv020PostgresRepository");
const { sha256Rcv020Text } = require("../dist/services/rcv020Canonical");
const { canonicalizeRcv020RetentionAvailabilityEvent } = require("../dist/services/rcv020SemanticCore");
const { Rcv020ReadService } = require("../dist/services/rcv020ReadService");

const DB = process.env.RCV020_W3_DATABASE;
const enabled = Boolean(DB && process.env.PGHOST && process.env.PGPORT);
const pool = enabled ? new Pool({ database: DB, host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, password: process.env.PGPASSWORD, max: 4 }) : null;
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ts = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000000Z`;
const emptyHash = sha256Rcv020Text("{}");
function shiftBundle(input, offset) {
  return JSON.parse(JSON.stringify(input).replace(/10000000-0000-4000-8000-(\d{12})/g, (_, digits) => `10000000-0000-4000-8000-${String(Number(digits) + offset).padStart(12, "0")}`));
}

function bundle(seed = 0) {
  const identityCanonical = JSON.stringify({ seed });
  const identityHash = sha256Rcv020Text(identityCanonical);
  const source = { logicalSourceId: id(1 + seed * 20), organizationIdentity: `w3-source-${seed}`, sourceClass: "official", jurisdiction: "CH", canonical: identityCanonical, identityHash };
  const monitor = { monitorId: id(2 + seed * 20), logicalSourceId: source.logicalSourceId, monitorKind: "api", canonical: identityCanonical, identityHash: sha256Rcv020Text(identityCanonical + "-monitor") };
  const config = {
    monitorConfigurationVersionId: id(3 + seed * 20), monitorId: monitor.monitorId, versionNumber: "9007199254740993",
    endpointRequest: { method: "GET", target: `https://example.test/items/${seed}`, parameters: {}, credentialReference: null },
    retrievalMethod: "GET", authenticationReference: null, expectedMediaConstraints: {}, triggerEligibility: "SCHEDULED", scope: {}, safetyPolicy: {}, adapterId: "test", adapterVersion: "1", parserId: null, parserVersion: null,
    retentionPolicy: "METADATA_HASH_ONLY", retentionPolicyVersion: 1, effectiveFrom: ts(0), effectiveUntil: null,
  };
  const occurrence = { occurrenceId: id(4 + seed * 20), logicalSourceId: source.logicalSourceId, monitorId: monitor.monitorId, monitorConfigurationVersionId: config.monitorConfigurationVersionId, triggerOrigin: "SCHEDULED", scheduledAt: ts(1), triggerReceivedAt: null, requestedAt: null, dueAt: ts(1), evaluationCutoffAt: ts(20) };
  const requestCanonical = JSON.stringify({ credentialReference: null, method: "GET", parameters: {}, target: `https://example.test/items/${seed}` });
  const attempt = { attemptId: id(5 + seed * 20), occurrenceId: occurrence.occurrenceId, previousAttemptId: null, retryNumber: "1", retrievalStartedAt: ts(2), attemptDeadlineAt: ts(10), adapterId: "test", adapterVersion: "1", requestCanonical, requestHash: sha256Rcv020Text(requestCanonical) };
  const attemptResolution = { attemptResolutionId: id(6 + seed * 20), attemptId: attempt.attemptId, retrievalCompletedAt: ts(3), outcome: "CAPTURED_CHANGED", failureCode: null };
  const capture = { captureId: id(7 + seed * 20), logicalSourceId: source.logicalSourceId, monitorId: monitor.monitorId, monitorConfigurationVersionId: config.monitorConfigurationVersionId, occurrenceId: occurrence.occurrenceId, retrievalAttemptId: attempt.attemptId, observedAt: ts(3), contentHash: "a".repeat(64), byteLength: "0", rawObjectIdentity: null, requestHash: attempt.requestHash, requestedTarget: `https://example.test/items/${seed}`, responseStatus: 200, responseMetadataCanonical: "{}", mediaType: "application/json", retentionPolicy: "METADATA_HASH_ONLY", retentionPolicyVersion: 1 };
  const comparison = { comparisonId: id(8 + seed * 20), currentCaptureId: capture.captureId, priorCaptureId: null, algorithmId: "raw-bytes", algorithmVersion: 1, result: "FIRST_OBSERVED", inputCanonical: "{}", inputHash: emptyHash };
  const occurrenceResolution = { resolutionId: id(9 + seed * 20), occurrenceId: occurrence.occurrenceId, outcome: "SUCCEEDED", evaluationCutoffAt: ts(20), evaluatedAt: ts(20), skipReason: null, skipActorPolicyIdentity: null, terminalizationPolicyVersion: 1, canonical: "{}", canonicalHash: emptyHash };
  const lifecycle = { eventId: id(10 + seed * 20), monitorConfigurationVersionId: config.monitorConfigurationVersionId, eventType: "ACTIVATED", eventAt: ts(0), eventSequence: "9007199254740995", actorPolicyIdentity: "test" };
  return { contractVersion: 1, sources: [source], monitors: [monitor], configurations: [config], lifecycleEvents: [lifecycle], occurrences: [occurrence], occurrenceResolutions: [occurrenceResolution], attempts: [attempt], attemptResolutions: [attemptResolution], captures: [capture], comparisons: [comparison], retentionEvents: [], handoffs: [], quarantine: [] };
}
function handoff() { return { handoffId: id(13), captureId: id(27), logicalSourceId: id(21), monitorId: id(22), monitorConfigurationVersionId: id(23), occurrenceId: id(24), retrievalAttemptId: id(25), captureHash: "a".repeat(64), rawAvailabilitySnapshot: "METADATA_HASH_ONLY", observedAt: ts(3), provenanceManifest: "{}", handoffCanonical: "{}", handoffHash: emptyHash, idempotencyKey: "w3-handoff-1" }; }
function handoffForSeed(seed) {
  const base = seed * 20;
  return { handoffId: id(base + 13), captureId: id(base + 7), logicalSourceId: id(base + 1), monitorId: id(base + 2), monitorConfigurationVersionId: id(base + 3), occurrenceId: id(base + 4), retrievalAttemptId: id(base + 5), captureHash: "a".repeat(64), rawObjectIdentity: `sha256:blob-${seed}`, rawAvailabilitySnapshot: "AVAILABLE", observedAt: ts(3), provenanceManifest: "{}", handoffCanonical: "{}", handoffHash: emptyHash, idempotencyKey: `w3-handoff-${seed}` };
}

test("Wave 3 persists a complete valid authority set atomically", { skip: !enabled }, async () => {
  const result = await persistRcv020Authority(pool, bundle(1));
  assert.equal(result.persisted, true);
  const tables = ["logical_sources", "monitors", "monitor_configuration_versions", "configuration_lifecycle_events", "observation_occurrences", "observation_occurrence_resolutions", "retrieval_attempts", "retrieval_attempt_resolutions", "captures", "capture_comparisons"];
  for (const table of tables) assert.equal(Number((await pool.query(`SELECT count(*)::int AS count FROM public.rcv020_${table}`)).rows[0].count), 1, table);
  const b = await pool.query("SELECT version_number::text AS version_number FROM public.rcv020_monitor_configuration_versions WHERE monitor_configuration_version_id=$1", [id(23)]);
  const a = await pool.query("SELECT retry_number::text AS retry_number FROM public.rcv020_retrieval_attempts WHERE attempt_id=$1", [id(25)]);
  const e = await pool.query("SELECT event_sequence::text AS event_sequence FROM public.rcv020_configuration_lifecycle_events WHERE event_id=$1", [id(30)]);
  assert.equal(b.rows[0].version_number, "9007199254740993"); assert.equal(a.rows[0].retry_number, "1"); assert.equal(e.rows[0].event_sequence, "9007199254740995");
});

test("Wave 3 persistence soak: exactly 100 valid cycles with no drift", { skip: !enabled }, async () => {
  for (let n = 2; n < 102; n += 1) {
    const shifted = bundle(n);
    await persistRcv020Authority(pool, shifted);
    assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM public.rcv020_captures WHERE capture_id=$1", [id(7 + n * 20)])).rows[0].count), 1);
  }
});

test("Wave 3 immutability blocks UPDATE and DELETE on all authoritative tables", { skip: !enabled }, async () => {
  await pool.query("INSERT INTO public.rcv020_quarantined_payloads (quarantine_id,attempt_id,reason,policy_canonical,object_identity,payload_hash,byte_length) VALUES ($1,$2,'TIMEOUT','{}',NULL,NULL,0) ON CONFLICT DO NOTHING", [id(11), id(25)]);
  await pool.query("INSERT INTO public.rcv020_retention_availability_events (event_id,capture_id,event_type,reason,event_at,resulting_availability,event_sequence,canonical,canonical_hash) VALUES ($1,$2,'LOST','test',$3,'UNAVAILABLE',1,'{}',$4) ON CONFLICT DO NOTHING", [id(12), id(27), ts(4), emptyHash]);
  await insertHandoff(pool, handoff());
  const targets = [
    ["logical_sources", "logical_source_id", id(21)], ["monitors", "monitor_id", id(22)],
    ["monitor_configuration_versions", "monitor_configuration_version_id", id(23)], ["configuration_lifecycle_events", "event_id", id(30)],
    ["observation_occurrences", "occurrence_id", id(24)], ["observation_occurrence_resolutions", "resolution_id", id(29)],
    ["retrieval_attempts", "attempt_id", id(25)], ["retrieval_attempt_resolutions", "attempt_resolution_id", id(26)],
    ["captures", "capture_id", id(27)], ["capture_comparisons", "comparison_id", id(28)],
    ["quarantined_payloads", "quarantine_id", id(11)], ["retention_availability_events", "event_id", id(12)],
    ["authenticated_handoffs", "handoff_id", id(13)],
  ];
  for (const [table, key, value] of targets) {
    await assert.rejects(() => pool.query(`UPDATE public.rcv020_${table} SET ${key}=${key} WHERE ${key}=$1`, [value]));
    await assert.rejects(() => pool.query(`DELETE FROM public.rcv020_${table} WHERE ${key}=$1`, [value]));
  }
});

test("Wave 3 handoff idempotency preserves one Capture for multiple targets", { skip: !enabled }, async () => {
  assert.equal(await insertHandoff(pool, handoff()), "idempotent");
  assert.equal(await insertHandoff(pool, handoff()), "idempotent");
  await assert.rejects(() => insertHandoff(pool, { ...handoff(), handoffHash: "b".repeat(64) }), /idempotency conflict/);
});

test("Wave 3 duplicate and divergent identity behavior is fail-closed", { skip: !enabled }, async () => {
  const input = bundle(1);
  await assert.rejects(() => persistRcv020Authority(pool, input));
  const divergent = JSON.parse(JSON.stringify(input));
  divergent.sources[0].organizationIdentity = "different";
  await assert.rejects(() => persistRcv020Authority(pool, divergent));
  const rows = await pool.query("SELECT count(*)::int AS count FROM public.rcv020_logical_sources WHERE logical_source_id=$1", [id(21)]);
  assert.equal(Number(rows.rows[0].count), 1);
});

test("RCV-020 identical successful bytes remain distinct Capture occurrences", { skip: !enabled }, async () => {
  const first = bundle(600);
  const second = bundle(601);
  const sameBytesHash = crypto.createHash("sha256").update(Buffer.from("same bytes")).digest("hex");
  first.captures[0].contentHash = sameBytesHash;
  second.captures[0].contentHash = sameBytesHash;
  first.captures[0].byteLength = "10";
  second.captures[0].byteLength = "10";
  await persistRcv020Authority(pool, first);
  await persistRcv020Authority(pool, second);
  const result = await pool.query(`SELECT o.occurrence_id, a.attempt_id, c.capture_id, c.content_hash
    FROM public.rcv020_observation_occurrences o
    JOIN public.rcv020_retrieval_attempts a ON a.occurrence_id = o.occurrence_id
    JOIN public.rcv020_captures c ON c.retrieval_attempt_id = a.attempt_id
    WHERE o.occurrence_id IN ($1,$2) ORDER BY o.occurrence_id`, [id(4 + 600 * 20), id(4 + 601 * 20)]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].content_hash, result.rows[1].content_hash);
  for (const key of ["occurrence_id", "attempt_id", "capture_id"]) assert.notEqual(result.rows[0][key], result.rows[1][key], key);
});

test("RCV-020 invalid payload bytes remain quarantine-only", { skip: !enabled }, async () => {
  const failed = bundle(602);
  failed.attemptResolutions[0] = { ...failed.attemptResolutions[0], outcome: "FAILED", failureCode: "PAYLOAD_TOO_LARGE", failureTaxonomyVersion: 1 };
  failed.occurrenceResolutions[0] = { ...failed.occurrenceResolutions[0], outcome: "FAILED" };
  failed.captures = [];
  failed.comparisons = [];
  failed.quarantine = [{ quarantineId: id(302 * 20 + 11), attemptId: failed.attempts[0].attemptId, reason: "PAYLOAD_TOO_LARGE", policyCanonical: "{}", objectIdentity: "sha256:invalid-payload", payloadHash: "b".repeat(64), byteLength: "4" }];
  await persistRcv020Authority(pool, failed);
  const counts = await pool.query(`SELECT
    (SELECT count(*) FROM public.rcv020_captures WHERE occurrence_id=$1)::int AS captures,
    (SELECT count(*) FROM public.rcv020_authenticated_handoffs WHERE occurrence_id=$1)::int AS handoffs,
    (SELECT count(*) FROM public.rcv020_quarantined_payloads WHERE attempt_id=$2)::int AS quarantine`, [failed.occurrences[0].occurrenceId, failed.attempts[0].attemptId]);
  assert.deepEqual(counts.rows[0], { captures: 0, handoffs: 0, quarantine: 1 });
  const occurrence = await pool.query("SELECT outcome FROM public.rcv020_observation_occurrence_resolutions WHERE occurrence_id=$1", [failed.occurrences[0].occurrenceId]);
  assert.equal(occurrence.rows[0].outcome, "FAILED");
});

test("RCV-020 handoff snapshot survives later availability loss", { skip: !enabled }, async () => {
  const seed = 603;
  const input = bundle(seed);
  input.captures[0].retentionPolicy = "PERMANENT_RAW";
  input.captures[0].rawObjectIdentity = `sha256:blob-${seed}`;
  input.captures[0].rawObjectReference = `memory://blob-${seed}`;
  input.captures[0].finalUrl = null;
  input.captures[0].redirectCanonical = null;
  await persistRcv020Authority(pool, input);
  const h = handoffForSeed(seed);
  await insertHandoff(pool, h);
  const before = await pool.query("SELECT handoff_canonical, handoff_hash, raw_object_identity, raw_availability_snapshot FROM public.rcv020_authenticated_handoffs WHERE handoff_id=$1", [h.handoffId]);
  const retention = { eventId: id(seed * 20 + 14), captureId: input.captures[0].captureId, eventType: "LOST", eventAt: ts(4), eventSequence: "1", reason: "object unavailable", policyLegalBasis: null, resultingAvailability: "UNAVAILABLE" };
  const encoded = canonicalizeRcv020RetentionAvailabilityEvent(retention);
  await pool.query(`INSERT INTO public.rcv020_retention_availability_events
    (event_id,capture_id,event_type,reason,policy_legal_basis,event_at,resulting_availability,event_sequence,canonical,canonical_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [retention.eventId, retention.captureId, retention.eventType, retention.reason, null, retention.eventAt, retention.resultingAvailability, retention.eventSequence, encoded.canonical, encoded.hash]);
  const after = await pool.query("SELECT handoff_canonical, handoff_hash, raw_object_identity, raw_availability_snapshot FROM public.rcv020_authenticated_handoffs WHERE handoff_id=$1", [h.handoffId]);
  assert.deepEqual(after.rows, before.rows);
  const verified = await new Rcv020ReadService(pool).readOccurrence(input.occurrences[0].occurrenceId);
  assert.equal(verified.observed, true);
  assert.equal(verified.authenticated, true);
  assert.equal(verified.replayable, false);
});

test("Wave 3 transaction failure leaves no partial relational authority", { skip: !enabled }, async () => {
  const failureSeed = 1000;
  const shifted = bundle(failureSeed);
  let injected = false;
  const failingPool = { connect: async () => { const c = await pool.connect(); return { ...c, query: async (sql, values) => { if (!injected && typeof sql === "string" && sql.includes("rcv020_captures")) { injected = true; throw new Error("forced internal error"); } return c.query(sql, values); } }; } };
  await assert.rejects(() => persistRcv020Authority(failingPool, shifted), /forced internal error/);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM public.rcv020_logical_sources WHERE logical_source_id=$1", [id(1 + failureSeed * 20)])).rows[0].count), 0);
});

test("Wave 3 physical proof leaves no uncontrolled concurrent deadlocks", { skip: !enabled }, async () => {
  for (const size of [1, 10, 25, 50, 100]) {
    const jobs = Array.from({ length: size }, (_, index) => {
      return persistRcv020Authority(pool, bundle(200 + size * 100 + index));
    });
    await Promise.all(jobs);
  }
});

test.after(async () => { if (pool) await pool.end(); });
