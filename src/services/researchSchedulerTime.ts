export const SCHEDULER_POSTGRES_BIGINT_MAX = 9223372036854775807n;

// PostgreSQL's finite TIMESTAMPTZ domain, expressed as exact epoch
// microseconds.  The upper bound exceeds signed PostgreSQL BIGINT, so these
// values intentionally remain application BigInts.
export const SCHEDULER_POSTGRES_TIMESTAMP_MIN_MICROS = -210863520000000000n;
export const SCHEDULER_POSTGRES_TIMESTAMP_MAX_MICROS = 9224318015999999999n;

const MICROS_PER_SECOND = 1_000_000n;
const MICROS_PER_DAY = 86_400_000_000n;
const DAYS_PER_400_YEARS = 146097n;
const EPOCH_DAY_OFFSET = 719468n;

export type SchedulerTimestampMicros = bigint;

export class SchedulerTimeError extends Error {
  constructor(
    readonly code: "MALFORMED_DATA" | "SLOT_ARITHMETIC_VIOLATION" | "UNSUPPORTED_STATE",
    message: string,
    readonly path = "timestamp",
  ) {
    super(message);
    this.name = "SchedulerTimeError";
  }
}

function fail(message: string, path = "timestamp", code: SchedulerTimeError["code"] = "MALFORMED_DATA"): never {
  throw new SchedulerTimeError(code, message, path);
}

function floorDiv(value: bigint, divisor: bigint): bigint {
  let quotient = value / divisor;
  if (value % divisor < 0n) quotient -= 1n;
  return quotient;
}

function parseDecimal(value: string, path: string): bigint {
  if (!/^[0-9]+$/.test(value)) fail("expected decimal component", path);
  try {
    return BigInt(value);
  } catch {
    fail("invalid decimal", path);
  }
}

function padUnsigned(value: bigint, width: number, path: string): string {
  const text = value.toString(10);
  if (text.length > width) fail("component exceeds canonical width", path);
  return text.padStart(width, "0");
}

function isLeapYear(year: bigint): boolean {
  return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
}

function daysInMonth(year: bigint, month: bigint): bigint {
  if (month === 2n) return isLeapYear(year) ? 29n : 28n;
  return [1n, 3n, 5n, 7n, 8n, 10n, 12n].includes(month) ? 31n : 30n;
}

function daysFromCivil(year: bigint, month: bigint, day: bigint): bigint {
  const adjustedYear = year - (month <= 2n ? 1n : 0n);
  const era = floorDiv(adjustedYear, 400n);
  const yearOfEra = adjustedYear - era * 400n;
  const monthPrime = month + (month > 2n ? -3n : 9n);
  const dayOfYear = floorDiv(153n * monthPrime + 2n, 5n) + day - 1n;
  const dayOfEra =
    yearOfEra * 365n +
    floorDiv(yearOfEra, 4n) -
    floorDiv(yearOfEra, 100n) +
    dayOfYear;
  return era * DAYS_PER_400_YEARS + dayOfEra - EPOCH_DAY_OFFSET;
}

function civilFromDays(days: bigint): { year: bigint; month: bigint; day: bigint } {
  const shifted = days + EPOCH_DAY_OFFSET;
  const era = floorDiv(shifted, DAYS_PER_400_YEARS);
  const dayOfEra = shifted - era * DAYS_PER_400_YEARS;
  const yearOfEra = floorDiv(
    dayOfEra - floorDiv(dayOfEra, 1460n) + floorDiv(dayOfEra, 36524n) - floorDiv(dayOfEra, 146096n),
    365n,
  );
  let year = yearOfEra + era * 400n;
  const dayOfYear =
    dayOfEra -
    (365n * yearOfEra + floorDiv(yearOfEra, 4n) - floorDiv(yearOfEra, 100n));
  const monthPrime = floorDiv(5n * dayOfYear + 2n, 153n);
  const day = dayOfYear - floorDiv(153n * monthPrime + 2n, 5n) + 1n;
  const month = monthPrime + (monthPrime < 10n ? 3n : -9n);
  if (month <= 2n) year += 1n;
  return { year, month, day };
}

function parseYear(value: string): bigint {
  if (/^[0-9]{4}$/.test(value)) return BigInt(value);
  if (!/^[+-][0-9]{6}$/.test(value)) fail("year is not canonical", "timestamp.year");
  const sign = value[0] === "-" ? -1n : 1n;
  const magnitude = BigInt(value.slice(1));
  const year = sign * magnitude;
  if (year === 0n || (sign === 1n && year < 10000n)) {
    fail("extended year is not canonical", "timestamp.year");
  }
  return year;
}

function formatYear(year: bigint): string {
  if (year >= 0n && year <= 9999n) return padUnsigned(year, 4, "timestamp.year");
  const sign = year < 0n ? "-" : "+";
  const magnitude = year < 0n ? -year : year;
  return `${sign}${padUnsigned(magnitude, 6, "timestamp.year")}`;
}

export function assertSchedulerTimestampMicros(value: unknown, path = "timestamp"): bigint {
  if (typeof value !== "bigint") fail("expected BigInt epoch microseconds", path, "SLOT_ARITHMETIC_VIOLATION");
  if (
    value < SCHEDULER_POSTGRES_TIMESTAMP_MIN_MICROS ||
    value > SCHEDULER_POSTGRES_TIMESTAMP_MAX_MICROS
  ) {
    fail("timestamp is outside finite PostgreSQL range", path, "SLOT_ARITHMETIC_VIOLATION");
  }
  return value;
}

export function parseSchedulerTimestamp(value: unknown, path = "timestamp"): bigint {
  if (typeof value !== "string") fail("expected canonical UTC timestamp", path);
  if (value === "infinity" || value === "-infinity") fail("infinite timestamp is unsupported", path, "UNSUPPORTED_STATE");
  const match = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
  if (!match) fail("expected canonical UTC timestamp with six fractional digits", path);
  const year = parseYear(match[1]);
  const month = parseDecimal(match[2], `${path}.month`);
  const day = parseDecimal(match[3], `${path}.day`);
  const hour = parseDecimal(match[4], `${path}.hour`);
  const minute = parseDecimal(match[5], `${path}.minute`);
  const second = parseDecimal(match[6], `${path}.second`);
  const micros = parseDecimal(match[7], `${path}.microsecond`);
  if (month < 1n || month > 12n) fail("month is out of range", `${path}.month`);
  if (day < 1n || day > daysInMonth(year, month)) fail("day is out of range", `${path}.day`);
  if (hour > 23n) fail("hour is out of range", `${path}.hour`);
  if (minute > 59n) fail("minute is out of range", `${path}.minute`);
  if (second > 59n) fail("second is out of range", `${path}.second`);
  const result =
    daysFromCivil(year, month, day) * MICROS_PER_DAY +
    hour * 3_600_000_000n +
    minute * 60_000_000n +
    second * MICROS_PER_SECOND +
    micros;
  return assertSchedulerTimestampMicros(result, path);
}

export function formatSchedulerTimestamp(value: unknown, path = "timestamp"): string {
  const micros = assertSchedulerTimestampMicros(value, path);
  const days = floorDiv(micros, MICROS_PER_DAY);
  const dayMicros = micros - days * MICROS_PER_DAY;
  const civil = civilFromDays(days);
  const hour = floorDiv(dayMicros, 3_600_000_000n);
  const minute = floorDiv(dayMicros - hour * 3_600_000_000n, 60_000_000n);
  const second = floorDiv(
    dayMicros - hour * 3_600_000_000n - minute * 60_000_000n,
    MICROS_PER_SECOND,
  );
  const fraction =
    dayMicros -
    hour * 3_600_000_000n -
    minute * 60_000_000n -
    second * MICROS_PER_SECOND;
  return `${formatYear(civil.year)}-${padUnsigned(civil.month, 2, `${path}.month`)}-${padUnsigned(civil.day, 2, `${path}.day`)}T${padUnsigned(hour, 2, `${path}.hour`)}:${padUnsigned(minute, 2, `${path}.minute`)}:${padUnsigned(second, 2, `${path}.second`)}.${padUnsigned(fraction, 6, `${path}.microsecond`)}Z`;
}

export function parseSchedulerMicros(value: unknown, path = "timestampMicros"): bigint {
  if (typeof value !== "string" || !/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)) {
    fail("expected signed canonical decimal epoch microseconds", path);
  }
  try {
    return assertSchedulerTimestampMicros(BigInt(value), path);
  } catch (error) {
    if (error instanceof SchedulerTimeError) throw error;
    fail("invalid epoch microseconds", path);
  }
}

export function canonicalSchedulerMicros(value: bigint, path = "timestampMicros"): string {
  return assertSchedulerTimestampMicros(value, path).toString(10);
}

export function validateSchedulerBigInt(value: unknown, path = "integer"): bigint {
  if (typeof value === "bigint") {
    if (value < 0n || value > SCHEDULER_POSTGRES_BIGINT_MAX) fail("expected non-negative PostgreSQL BIGINT", path, "SLOT_ARITHMETIC_VIOLATION");
    return value;
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("expected canonical non-negative decimal", path);
  }
  const parsed = BigInt(value);
  if (parsed > SCHEDULER_POSTGRES_BIGINT_MAX) fail("outside PostgreSQL BIGINT range", path, "SLOT_ARITHMETIC_VIOLATION");
  return parsed;
}

export function validateSchedulerPositiveBigInt(value: unknown, path = "integer"): bigint {
  const parsed = validateSchedulerBigInt(value, path);
  if (parsed < 1n) fail("expected positive PostgreSQL BIGINT", path);
  return parsed;
}

export function deriveSchedulerScheduledAt(
  firstEligibilityAtMicros: unknown,
  slotIndex: unknown,
  fixedIntervalMicros: unknown,
): bigint {
  const first = assertSchedulerTimestampMicros(firstEligibilityAtMicros, "firstEligibilityAtMicros");
  const slot = validateSchedulerBigInt(slotIndex, "slotIndex");
  const interval = validateSchedulerPositiveBigInt(fixedIntervalMicros, "fixedIntervalMicros");
  const result = first + slot * interval;
  return assertSchedulerTimestampMicros(result, "scheduledAtMicros");
}

export interface SchedulerDueSlot {
  readonly slotIndex: bigint;
  readonly scheduledAtMicros: bigint;
  readonly nextEligibleAtMicros: bigint;
}

export function deriveSchedulerDueSlot(
  firstEligibilityAtMicros: unknown,
  fixedIntervalMicros: unknown,
  evaluationAtMicros: unknown,
): SchedulerDueSlot | null {
  const first = assertSchedulerTimestampMicros(firstEligibilityAtMicros, "firstEligibilityAtMicros");
  const interval = validateSchedulerPositiveBigInt(fixedIntervalMicros, "fixedIntervalMicros");
  const evaluation = assertSchedulerTimestampMicros(evaluationAtMicros, "evaluationAtMicros");
  if (evaluation < first) return null;
  const slot = (evaluation - first) / interval;
  const scheduled = deriveSchedulerScheduledAt(first, slot, interval);
  const next = deriveSchedulerScheduledAt(first, slot + 1n, interval);
  return Object.freeze({ slotIndex: slot, scheduledAtMicros: scheduled, nextEligibleAtMicros: next });
}
