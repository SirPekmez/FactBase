import { createContext, runInContext } from "node:vm";
import canonicalize from "canonicalize";
import { JsonValue } from "../types/derivation";
import {
  appendArrayElement as exportedAppendArrayElement,
  getDerivationSafeRuntimeArtifactHash as exportedGetDerivationSafeRuntimeArtifactHash,
  loadedFunctionSource as exportedLoadedFunctionSource,
  safeArrayIsArray as exportedSafeArrayIsArray,
  safeCharCodeAt as exportedSafeCharCodeAt,
  safeDateGetTime as exportedSafeDateGetTime,
  safeDateToISOString as exportedSafeDateToISOString,
  safeDefineProperty as exportedSafeDefineProperty,
  safeCreateNullPrototypeObject as exportedSafeCreateNullPrototypeObject,
  safeFreeze as exportedSafeFreeze,
  safeGetOwnPropertyDescriptors as exportedSafeGetOwnPropertyDescriptors,
  safeGetPrototypeOf as exportedSafeGetPrototypeOf,
  getLoadedObjectPrototype as exportedGetLoadedObjectPrototype,
  safeNumberIsFinite as exportedSafeNumberIsFinite,
  safeOwnKeys as exportedSafeOwnKeys,
  safeParseDate as exportedSafeParseDate,
  safeRegExpExec as exportedSafeRegExpExec,
  safeSha256 as exportedSafeSha256,
  safeSlice as exportedSafeSlice,
  safeStartsWith as exportedSafeStartsWith,
} from "./derivationSafeRuntime";

function initializeCanonicalJsonBindings() {
  return Object.freeze({
    createContext,
    runInContext,
    appendArrayElement: exportedAppendArrayElement,
    getDerivationSafeRuntimeArtifactHash:
      exportedGetDerivationSafeRuntimeArtifactHash,
    loadedFunctionSource: exportedLoadedFunctionSource,
    safeArrayIsArray: exportedSafeArrayIsArray,
    safeCharCodeAt: exportedSafeCharCodeAt,
    safeDateGetTime: exportedSafeDateGetTime,
    safeDateToISOString: exportedSafeDateToISOString,
    safeDefineProperty: exportedSafeDefineProperty,
    safeCreateNullPrototypeObject: exportedSafeCreateNullPrototypeObject,
    safeFreeze: exportedSafeFreeze,
    safeGetOwnPropertyDescriptors: exportedSafeGetOwnPropertyDescriptors,
    safeGetPrototypeOf: exportedSafeGetPrototypeOf,
    getLoadedObjectPrototype: exportedGetLoadedObjectPrototype,
    safeNumberIsFinite: exportedSafeNumberIsFinite,
    safeOwnKeys: exportedSafeOwnKeys,
    safeParseDate: exportedSafeParseDate,
    safeRegExpExec: exportedSafeRegExpExec,
    safeSha256: exportedSafeSha256,
    safeSlice: exportedSafeSlice,
    safeStartsWith: exportedSafeStartsWith,
  });
}

const CANONICAL_JSON_BINDINGS = initializeCanonicalJsonBindings();
const appendArrayElement = CANONICAL_JSON_BINDINGS.appendArrayElement;
const getDerivationSafeRuntimeArtifactHash =
  CANONICAL_JSON_BINDINGS.getDerivationSafeRuntimeArtifactHash;
const loadedFunctionSource = CANONICAL_JSON_BINDINGS.loadedFunctionSource;
const safeArrayIsArray = CANONICAL_JSON_BINDINGS.safeArrayIsArray;
const safeCharCodeAt = CANONICAL_JSON_BINDINGS.safeCharCodeAt;
const safeDateGetTime = CANONICAL_JSON_BINDINGS.safeDateGetTime;
const safeDateToISOString = CANONICAL_JSON_BINDINGS.safeDateToISOString;
const safeDefineProperty = CANONICAL_JSON_BINDINGS.safeDefineProperty;
const safeCreateNullPrototypeObject =
  CANONICAL_JSON_BINDINGS.safeCreateNullPrototypeObject;
const safeFreeze = CANONICAL_JSON_BINDINGS.safeFreeze;
const safeGetOwnPropertyDescriptors =
  CANONICAL_JSON_BINDINGS.safeGetOwnPropertyDescriptors;
const safeGetPrototypeOf = CANONICAL_JSON_BINDINGS.safeGetPrototypeOf;
const getLoadedObjectPrototype =
  CANONICAL_JSON_BINDINGS.getLoadedObjectPrototype;
const safeNumberIsFinite = CANONICAL_JSON_BINDINGS.safeNumberIsFinite;
const safeOwnKeys = CANONICAL_JSON_BINDINGS.safeOwnKeys;
const safeParseDate = CANONICAL_JSON_BINDINGS.safeParseDate;
const safeRegExpExec = CANONICAL_JSON_BINDINGS.safeRegExpExec;
const safeSha256 = CANONICAL_JSON_BINDINGS.safeSha256;
const safeSlice = CANONICAL_JSON_BINDINGS.safeSlice;
const safeStartsWith = CANONICAL_JSON_BINDINGS.safeStartsWith;

export interface CanonicalJsonResult {
  canonical: string;
  hash: string;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = safeCharCodeAt(value, index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = safeCharCodeAt(value, index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

const loadedCanonicalizeSource = loadedFunctionSource(canonicalize);

function initializeCanonicalRealm(canonicalizeSource: string) {
  const canonicalRealm = CANONICAL_JSON_BINDINGS.createContext(
    safeCreateNullPrototypeObject(),
  );
  const realmCreateArray = CANONICAL_JSON_BINDINGS.runInContext(
    "() => []",
    canonicalRealm,
  ) as () => unknown[];
  const realmCreateObject = CANONICAL_JSON_BINDINGS.runInContext(
    "() => ({})",
    canonicalRealm,
  ) as () => object;
  const isolatedCanonicalize = CANONICAL_JSON_BINDINGS.runInContext(
    `(${canonicalizeSource})`,
    canonicalRealm,
  ) as (value: unknown) => string | undefined;
  CANONICAL_JSON_BINDINGS.runInContext(
    `[
      Object, Object.prototype, Array, Array.prototype, String, String.prototype,
      Number, Number.prototype, Boolean, Boolean.prototype, Function,
      Function.prototype, JSON
    ].forEach((value) => Object.freeze(value));`,
    canonicalRealm,
  );
  return safeFreeze({
    loadedObjectPrototype: getLoadedObjectPrototype(),
    realmCreateArray,
    realmCreateObject,
    isolatedCanonicalize,
  });
}

const CANONICAL_REALM = initializeCanonicalRealm(loadedCanonicalizeSource);

function seenIndex(seen: ReadonlyArray<object>, value: object): number {
  for (let index = 0; index < seen.length; index += 1) {
    if (seen[index] === value) return index;
  }
  return -1;
}

function validateAndCloneJsonValue(value: unknown, seen: object[]): JsonValue {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) {
      throw new Error("Canonical JSON strings must not contain lone surrogates");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!safeNumberIsFinite(value)) {
      throw new Error("Canonical JSON numbers must be finite");
    }
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
  }
  if (seenIndex(seen, value) !== -1) {
    throw new Error("Canonical JSON must not contain cycles");
  }
  const isArray = safeArrayIsArray(value);
  if (
    safeGetPrototypeOf(value) !== CANONICAL_REALM.loadedObjectPrototype &&
    !isArray
  ) {
    throw new Error("Canonical JSON objects must be plain objects");
  }

  appendArrayElement(seen, value);
  let cloned: JsonValue;
  if (isArray) {
    const arrayClone = CANONICAL_REALM.realmCreateArray() as JsonValue[];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (item === undefined) {
        throw new Error("Canonical JSON arrays must not contain undefined");
      }
      safeDefineProperty(arrayClone, index, {
        value: validateAndCloneJsonValue(item, seen),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    cloned = arrayClone;
  } else {
    const objectClone = CANONICAL_REALM.realmCreateObject() as {
      [key: string]: JsonValue;
    };
    const ownKeys = safeOwnKeys(value);
    const descriptors = safeGetOwnPropertyDescriptors(value);
    for (let index = 0; index < ownKeys.length; index += 1) {
      const key = ownKeys[index];
      if (typeof key === "symbol") {
        throw new Error("Canonical JSON objects must not contain symbol keys");
      }
      const descriptor = descriptors[key];
      if (descriptor.enumerable !== true) {
        throw new Error("Canonical JSON objects must not contain hidden properties");
      }
      if (hasLoneSurrogate(key)) {
        throw new Error("Canonical JSON property names must not contain lone surrogates");
      }
      if (descriptor.get || descriptor.set) {
        throw new Error("Canonical JSON objects must not contain accessors");
      }
      const item = descriptor.value;
      if (item === undefined) {
        throw new Error(`Canonical JSON property ${key} is undefined`);
      }
      safeDefineProperty(objectClone, key, {
        value: validateAndCloneJsonValue(item, seen),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    cloned = objectClone;
  }
  seen.length -= 1;
  return cloned;
}

export function canonicalizeJson(value: unknown): string {
  const isolatedValue = validateAndCloneJsonValue(value, []);
  const result = CANONICAL_REALM.isolatedCanonicalize(isolatedValue);
  if (result === undefined) {
    throw new Error("Canonical JSON root must be serializable");
  }
  return result;
}

export function sha256(value: string): string {
  return safeSha256(value);
}

export function canonicalizeAndHash(value: unknown): CanonicalJsonResult {
  const canonical = canonicalizeJson(value);
  return { canonical, hash: sha256(canonical) };
}

export function validateCanonicalTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Timestamp must be a canonical UTC string");
  }
  const match = safeRegExpExec(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/,
    value,
  );
  if (!match || safeStartsWith(match[1], "0000-")) {
    throw new Error("Timestamp must use YYYY-MM-DDTHH:mm:ss.ffffffZ");
  }
  const millisecondForm = `${match[1]}.${safeSlice(match[2], 0, 3)}Z`;
  const parsed = safeParseDate(millisecondForm);
  if (
    !safeNumberIsFinite(safeDateGetTime(parsed)) ||
    safeDateToISOString(parsed) !== millisecondForm
  ) {
    throw new Error("Timestamp contains an invalid UTC calendar value");
  }
  return value;
}

const CANONICAL_JSON_ARTIFACT_HASH = safeSha256(
  [
    "factbase-canonical-json-runtime-v1",
    "private-module-captures-v2",
    getDerivationSafeRuntimeArtifactHash(),
    loadedCanonicalizeSource,
    loadedFunctionSource(initializeCanonicalJsonBindings),
    loadedFunctionSource(CANONICAL_JSON_BINDINGS.createContext),
    loadedFunctionSource(CANONICAL_JSON_BINDINGS.runInContext),
    loadedFunctionSource(initializeCanonicalRealm),
    loadedFunctionSource(CANONICAL_REALM.realmCreateArray),
    loadedFunctionSource(CANONICAL_REALM.realmCreateObject),
    loadedFunctionSource(CANONICAL_REALM.isolatedCanonicalize),
    loadedFunctionSource(appendArrayElement),
    loadedFunctionSource(safeArrayIsArray),
    loadedFunctionSource(safeCharCodeAt),
    loadedFunctionSource(safeDateGetTime),
    loadedFunctionSource(safeDateToISOString),
    loadedFunctionSource(safeDefineProperty),
    loadedFunctionSource(safeCreateNullPrototypeObject),
    loadedFunctionSource(safeFreeze),
    loadedFunctionSource(safeGetOwnPropertyDescriptors),
    loadedFunctionSource(safeGetPrototypeOf),
    loadedFunctionSource(getLoadedObjectPrototype),
    loadedFunctionSource(safeNumberIsFinite),
    loadedFunctionSource(safeOwnKeys),
    loadedFunctionSource(safeParseDate),
    loadedFunctionSource(safeRegExpExec),
    loadedFunctionSource(safeSha256),
    loadedFunctionSource(safeSlice),
    loadedFunctionSource(safeStartsWith),
    loadedFunctionSource(hasLoneSurrogate),
    loadedFunctionSource(seenIndex),
    loadedFunctionSource(validateAndCloneJsonValue),
    loadedFunctionSource(canonicalizeJson),
    loadedFunctionSource(sha256),
    loadedFunctionSource(canonicalizeAndHash),
    loadedFunctionSource(validateCanonicalTimestamp),
  ].join("\n"),
);

export function getCanonicalJsonArtifactHash(): string {
  return CANONICAL_JSON_ARTIFACT_HASH;
}
