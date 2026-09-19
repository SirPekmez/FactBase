const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const time = require("../dist/services/researchSchedulerTime");

test("Scheduler timestamps round-trip exact epoch and PostgreSQL finite boundaries", () => {
  const vectors = [
    ["1970-01-01T00:00:00.000000Z", 0n],
    ["1969-12-31T23:59:59.999999Z", -1n],
    ["1970-01-01T00:00:00.000001Z", 1n],
    ["2000-02-29T12:34:56.123456Z", 951827696123456n],
    ["0000-01-01T00:00:00.000000Z", -62167219200000000n],
    ["-000001-01-01T00:00:00.000000Z", -62198755200000000n],
    ["+010000-01-01T00:00:00.000000Z", 253402300800000000n],
    ["-004712-01-01T00:00:00.000000Z", time.SCHEDULER_POSTGRES_TIMESTAMP_MIN_MICROS],
    ["+294276-12-31T23:59:59.999999Z", time.SCHEDULER_POSTGRES_TIMESTAMP_MAX_MICROS],
  ];
  for (const [text, micros] of vectors) {
    assert.equal(time.parseSchedulerTimestamp(text), micros);
    assert.equal(time.formatSchedulerTimestamp(micros), text);
  }
});

test("Scheduler timestamp parser rejects non-canonical, non-UTC, infinite, and invalid calendar values", () => {
  for (const value of [
    "1970-01-01T00:00:00Z",
    "1970-01-01T00:00:00.00000Z",
    "1970-01-01T00:00:00.0000000Z",
    "1970-01-01T00:00:00.000000+01:00",
    "1970-01-01T00:00:00.000000z",
    "1900-02-29T00:00:00.000000Z",
    "2000-13-01T00:00:00.000000Z",
    "2000-01-32T00:00:00.000000Z",
    "2000-01-01T24:00:00.000000Z",
    "2000-01-01T00:60:00.000000Z",
    "2000-01-01T00:00:60.000000Z",
    "infinity",
    "-infinity",
    "-0",
    "+000001-01-01T00:00:00.000000Z",
    "-000000-01-01T00:00:00.000000Z",
    "+294277-01-01T00:00:00.000000Z",
    "-004713-12-31T23:59:59.999999Z",
  ]) assert.throws(() => time.parseSchedulerTimestamp(value), time.SchedulerTimeError);
  assert.throws(() => time.formatSchedulerTimestamp(time.SCHEDULER_POSTGRES_TIMESTAMP_MIN_MICROS - 1n), time.SchedulerTimeError);
  assert.throws(() => time.formatSchedulerTimestamp(time.SCHEDULER_POSTGRES_TIMESTAMP_MAX_MICROS + 1n), time.SchedulerTimeError);
});

test("Scheduler calendar arithmetic handles leap-century and BCE rules without Date", () => {
  assert.equal(time.parseSchedulerTimestamp("1900-03-01T00:00:00.000000Z") - time.parseSchedulerTimestamp("1900-02-28T00:00:00.000000Z"), 86_400_000_000n);
  assert.equal(time.parseSchedulerTimestamp("2000-03-01T00:00:00.000000Z") - time.parseSchedulerTimestamp("2000-02-28T00:00:00.000000Z"), 2n * 86_400_000_000n);
  assert.equal(time.formatSchedulerTimestamp(time.parseSchedulerTimestamp("-000001-12-31T23:59:59.999999Z") + 1n), "0000-01-01T00:00:00.000000Z");
  const source = fs.readFileSync("src/services/researchSchedulerTime.ts", "utf8");
  assert.doesNotMatch(source, /\bnew\s+Date\b|\bDate\s*\(|\bNumber\s*\(/);
});

test("Scheduler BigInt and slot arithmetic preserve exact values above JS safe integer", () => {
  const large = "9007199254740993";
  assert.equal(time.validateSchedulerBigInt(large), 9007199254740993n);
  assert.equal(time.validateSchedulerPositiveBigInt(large), 9007199254740993n);
  assert.throws(() => time.validateSchedulerBigInt("-1"), time.SchedulerTimeError);
  assert.throws(() => time.validateSchedulerBigInt("9223372036854775808"), time.SchedulerTimeError);
  assert.throws(() => time.validateSchedulerPositiveBigInt("0"), time.SchedulerTimeError);
  const scheduled = time.deriveSchedulerScheduledAt(0n, large, 1n);
  assert.equal(scheduled, 9007199254740993n);
  assert.throws(() => time.deriveSchedulerScheduledAt(0n, "9223372036854775807", "9223372036854775807"), time.SchedulerTimeError);
});

test("Scheduler due-slot boundaries are exact and next eligibility is deterministic", () => {
  const first = 1_000_000n;
  const interval = 10n;
  assert.equal(time.deriveSchedulerDueSlot(first, interval, first - 1n), null);
  assert.deepEqual(time.deriveSchedulerDueSlot(first, interval, first), { slotIndex: 0n, scheduledAtMicros: first, nextEligibleAtMicros: first + interval });
  assert.deepEqual(time.deriveSchedulerDueSlot(first, interval, first + interval - 1n), { slotIndex: 0n, scheduledAtMicros: first, nextEligibleAtMicros: first + interval });
  assert.deepEqual(time.deriveSchedulerDueSlot(first, interval, first + interval), { slotIndex: 1n, scheduledAtMicros: first + interval, nextEligibleAtMicros: first + 2n * interval });
});
