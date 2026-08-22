import {
  getDerivationSafeRuntimeArtifactHash as exportedGetDerivationSafeRuntimeArtifactHash,
  loadedFunctionSource as exportedLoadedFunctionSource,
  safeAbs as exportedSafeAbs,
  safeNumber as exportedSafeNumber,
  safeNumberIsSafeInteger as exportedSafeNumberIsSafeInteger,
  safeRegExpExec as exportedSafeRegExpExec,
  safeRepeat as exportedSafeRepeat,
  safeSha256 as exportedSafeSha256,
  safeSlice as exportedSafeSlice,
} from "./derivationSafeRuntime";

function initializeCanonicalDecimalBindings() {
  return Object.freeze({
    getDerivationSafeRuntimeArtifactHash:
      exportedGetDerivationSafeRuntimeArtifactHash,
    loadedFunctionSource: exportedLoadedFunctionSource,
    safeAbs: exportedSafeAbs,
    safeNumber: exportedSafeNumber,
    safeNumberIsSafeInteger: exportedSafeNumberIsSafeInteger,
    safeRegExpExec: exportedSafeRegExpExec,
    safeRepeat: exportedSafeRepeat,
    safeSha256: exportedSafeSha256,
    safeSlice: exportedSafeSlice,
  });
}

const DECIMAL_BINDINGS = initializeCanonicalDecimalBindings();
const getDerivationSafeRuntimeArtifactHash =
  DECIMAL_BINDINGS.getDerivationSafeRuntimeArtifactHash;
const loadedFunctionSource = DECIMAL_BINDINGS.loadedFunctionSource;
const safeAbs = DECIMAL_BINDINGS.safeAbs;
const safeNumber = DECIMAL_BINDINGS.safeNumber;
const safeNumberIsSafeInteger = DECIMAL_BINDINGS.safeNumberIsSafeInteger;
const safeRegExpExec = DECIMAL_BINDINGS.safeRegExpExec;
const safeRepeat = DECIMAL_BINDINGS.safeRepeat;
const safeSha256 = DECIMAL_BINDINGS.safeSha256;
const safeSlice = DECIMAL_BINDINGS.safeSlice;

const decimalPattern = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const MAX_EXPANDED_DIGITS = 20_000;

export class InvalidCanonicalDecimalError extends Error {
  constructor(public readonly value: string) {
    super(`Invalid canonical decimal: ${value}`);
    this.name = "InvalidCanonicalDecimalError";
  }
}

function trimLeadingZeros(value: string): string {
  let index = 0;
  while (index < value.length - 1 && value[index] === "0") index += 1;
  return safeSlice(value, index);
}

function trimTrailingZeros(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "0") end -= 1;
  return safeSlice(value, 0, end);
}

function containsOnlyZeros(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "0") return false;
  }
  return true;
}

export function canonicalizePostgreSqlNumeric(value: string): string {
  const match = safeRegExpExec(decimalPattern, value);
  if (!match) {
    throw new InvalidCanonicalDecimalError(value);
  }

  const sign = match[1];
  const integerDigits = match[2];
  const fractionDigits = match[3] ?? "";
  const exponentText = match[4] ?? "0";
  const exponent = safeNumber(exponentText);
  if (!safeNumberIsSafeInteger(exponent)) {
    throw new InvalidCanonicalDecimalError(value);
  }

  const unsignedDigits = `${integerDigits}${fractionDigits}`;
  const decimalPosition = integerDigits.length + exponent;
  if (
    safeAbs(decimalPosition) > MAX_EXPANDED_DIGITS ||
    unsignedDigits.length > MAX_EXPANDED_DIGITS
  ) {
    throw new InvalidCanonicalDecimalError(value);
  }

  let expandedInteger: string;
  let expandedFraction: string;
  if (decimalPosition <= 0) {
    expandedInteger = "0";
    expandedFraction = `${safeRepeat("0", -decimalPosition)}${unsignedDigits}`;
  } else if (decimalPosition >= unsignedDigits.length) {
    expandedInteger = `${unsignedDigits}${safeRepeat(
      "0",
      decimalPosition - unsignedDigits.length,
    )}`;
    expandedFraction = "";
  } else {
    expandedInteger = safeSlice(unsignedDigits, 0, decimalPosition);
    expandedFraction = safeSlice(unsignedDigits, decimalPosition);
  }

  expandedInteger = trimLeadingZeros(expandedInteger);
  expandedFraction = trimTrailingZeros(expandedFraction);
  const isZero = containsOnlyZeros(expandedInteger) && expandedFraction === "";
  if (isZero) {
    return "0";
  }
  if (sign === "-") {
    throw new InvalidCanonicalDecimalError(value);
  }

  if (expandedInteger === "1" && expandedFraction !== "") {
    throw new InvalidCanonicalDecimalError(value);
  }
  if (expandedInteger !== "0" && expandedInteger !== "1") {
    throw new InvalidCanonicalDecimalError(value);
  }

  return expandedFraction === ""
    ? expandedInteger
    : `${expandedInteger}.${expandedFraction}`;
}

const CANONICAL_DECIMAL_ARTIFACT_HASH = safeSha256(
  [
    "factbase-postgresql-numeric-canonicalization-v1",
    "private-module-captures-v2",
    decimalPattern.source,
    decimalPattern.flags,
    String(MAX_EXPANDED_DIGITS),
    getDerivationSafeRuntimeArtifactHash(),
    loadedFunctionSource(initializeCanonicalDecimalBindings),
    loadedFunctionSource(safeAbs),
    loadedFunctionSource(safeNumber),
    loadedFunctionSource(safeNumberIsSafeInteger),
    loadedFunctionSource(safeRegExpExec),
    loadedFunctionSource(safeRepeat),
    loadedFunctionSource(safeSha256),
    loadedFunctionSource(safeSlice),
    loadedFunctionSource(trimLeadingZeros),
    loadedFunctionSource(trimTrailingZeros),
    loadedFunctionSource(containsOnlyZeros),
    loadedFunctionSource(canonicalizePostgreSqlNumeric),
  ].join("\n"),
);

export function getCanonicalDecimalArtifactHash(): string {
  return CANONICAL_DECIMAL_ARTIFACT_HASH;
}
