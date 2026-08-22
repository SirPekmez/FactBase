import { createHash } from "node:crypto";

function initializeSafeRuntimeBindings() {
  return Object.freeze({
    reflectDefineProperty: Reflect.defineProperty,
    reflectOwnKeys: Reflect.ownKeys,
    objectGetPrototypeOf: Object.getPrototypeOf,
    objectGetOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
    objectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    objectCreate: Object.create,
    objectFreeze: Object.freeze,
    loadedObjectPrototype: Object.prototype,
    arrayIsArray: Array.isArray,
    functionCall: Function.prototype.call,
    functionBind: Function.prototype.bind,
    stringToLowerCase: String.prototype.toLowerCase,
    stringCharCodeAt: String.prototype.charCodeAt,
    stringStartsWith: String.prototype.startsWith,
    stringSlice: String.prototype.slice,
    stringRepeat: String.prototype.repeat,
    regexpExec: RegExp.prototype.exec,
    numberIsFinite: Number.isFinite,
    numberIsSafeInteger: Number.isSafeInteger,
    mathAbs: Math.abs,
    numberConstructor: Number,
    jsonStringify: JSON.stringify,
    loadedDate: Date,
    dateGetTime: Date.prototype.getTime,
    dateToISOString: Date.prototype.toISOString,
    functionToString: Function.prototype.toString,
    bufferFrom: Buffer.from,
    loadedCreateHash: createHash,
    loadedWeakSet: WeakSet,
    weakSetAdd: WeakSet.prototype.add,
    weakSetHas: WeakSet.prototype.has,
  });
}

const SAFE_RUNTIME_BINDINGS = initializeSafeRuntimeBindings();

function initializeSafeRuntimeDerivedBindings(
  bindings: typeof SAFE_RUNTIME_BINDINGS,
) {
  const uncurryThis = bindings.functionBind.bind(bindings.functionCall) as <
    T extends Function,
  >(
    value: T,
  ) => (...args: unknown[]) => unknown;
  const objectGetPrototypeOf = bindings.objectGetPrototypeOf;
  const initialHash = bindings.loadedCreateHash("sha256");
  const hashPrototype = objectGetPrototypeOf(initialHash) as {
    update: Function;
    digest: Function;
  };
  return Object.freeze({
    reflectDefineProperty: bindings.reflectDefineProperty,
    reflectOwnKeys: bindings.reflectOwnKeys,
    objectGetPrototypeOf,
    objectGetOwnPropertyDescriptors: bindings.objectGetOwnPropertyDescriptors,
    objectGetOwnPropertyDescriptor: bindings.objectGetOwnPropertyDescriptor,
    objectCreate: bindings.objectCreate,
    objectFreeze: bindings.objectFreeze,
    loadedObjectPrototype: bindings.loadedObjectPrototype,
    arrayIsArray: bindings.arrayIsArray,
    stringToLowerCase: uncurryThis(bindings.stringToLowerCase) as (
      value: string,
    ) => string,
    stringCharCodeAt: uncurryThis(bindings.stringCharCodeAt) as (
      value: string,
      index: number,
    ) => number,
    stringStartsWith: uncurryThis(bindings.stringStartsWith) as (
      value: string,
      search: string,
    ) => boolean,
    stringSlice: uncurryThis(bindings.stringSlice) as (
      value: string,
      start: number,
      end?: number,
    ) => string,
    stringRepeat: uncurryThis(bindings.stringRepeat) as (
      value: string,
      count: number,
    ) => string,
    regexpExec: uncurryThis(bindings.regexpExec) as (
      pattern: RegExp,
      value: string,
    ) => RegExpExecArray | null,
    numberIsFinite: bindings.numberIsFinite,
    numberIsSafeInteger: bindings.numberIsSafeInteger,
    mathAbs: bindings.mathAbs,
    numberConstructor: bindings.numberConstructor,
    jsonStringify: bindings.functionBind.call(
      bindings.jsonStringify,
      JSON,
    ) as typeof JSON.stringify,
    loadedDate: bindings.loadedDate,
    dateGetTime: uncurryThis(bindings.dateGetTime) as (value: Date) => number,
    dateToISOString: uncurryThis(bindings.dateToISOString) as (
      value: Date,
    ) => string,
    functionToString: uncurryThis(bindings.functionToString) as (
      value: Function,
    ) => string,
    bufferFrom: bindings.functionBind.call(
      bindings.bufferFrom,
      Buffer,
    ) as typeof Buffer.from,
    loadedCreateHash: bindings.loadedCreateHash,
    loadedWeakSet: bindings.loadedWeakSet,
    weakSetAdd: uncurryThis(bindings.weakSetAdd) as (
      set: WeakSet<object>,
      value: object,
    ) => WeakSet<object>,
    weakSetHas: uncurryThis(bindings.weakSetHas) as (
      set: WeakSet<object>,
      value: object,
    ) => boolean,
    hashUpdate: uncurryThis(hashPrototype.update) as (
      hash: ReturnType<typeof createHash>,
      value: Buffer,
    ) => ReturnType<typeof createHash>,
    hashDigest: uncurryThis(hashPrototype.digest) as (
      hash: ReturnType<typeof createHash>,
      encoding: "hex",
    ) => string,
  });
}

const SAFE_RUNTIME_DERIVED_BINDINGS =
  initializeSafeRuntimeDerivedBindings(SAFE_RUNTIME_BINDINGS);

export function defineArrayElement<T>(target: T[], index: number, value: T): void {
  if (
    !SAFE_RUNTIME_DERIVED_BINDINGS.reflectDefineProperty(target, index, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  ) {
    throw new Error("Unable to define deterministic array element");
  }
}

export function appendArrayElement<T>(target: T[], value: T): void {
  defineArrayElement(target, target.length, value);
}

export function copyArrayRange<T>(
  source: ReadonlyArray<T>,
  start: number,
): T[] {
  const result: T[] = [];
  for (let index = start; index < source.length; index += 1) {
    appendArrayElement(result, source[index]);
  }
  return result;
}

export function sortArrayCopy<T>(
  source: ReadonlyArray<T>,
  compare: (left: T, right: T) => number,
): T[] {
  const result: T[] = [];
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const value = source[sourceIndex];
    let insertAt = result.length;
    while (insertAt > 0 && compare(result[insertAt - 1], value) > 0) {
      insertAt -= 1;
    }
    appendArrayElement(result, value);
    for (let moveIndex = result.length - 1; moveIndex > insertAt; moveIndex -= 1) {
      defineArrayElement(result, moveIndex, result[moveIndex - 1]);
    }
    defineArrayElement(result, insertAt, value);
  }
  return result;
}

export function findTextIndex(values: ReadonlyArray<string>, value: string): number {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === value) return index;
  }
  return -1;
}

export function safeArrayIsArray(value: unknown): value is unknown[] {
  return SAFE_RUNTIME_DERIVED_BINDINGS.arrayIsArray(value);
}

export function safeOwnKeys(value: object): Array<string | symbol> {
  return SAFE_RUNTIME_DERIVED_BINDINGS.reflectOwnKeys(value);
}

export function safeGetPrototypeOf(value: object): object | null {
  return SAFE_RUNTIME_DERIVED_BINDINGS.objectGetPrototypeOf(value);
}

export function safeGetOwnPropertyDescriptors(
  value: object,
): PropertyDescriptorMap {
  return SAFE_RUNTIME_DERIVED_BINDINGS.objectGetOwnPropertyDescriptors(value);
}

export function safeDefineProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  if (!SAFE_RUNTIME_DERIVED_BINDINGS.reflectDefineProperty(target, key, descriptor)) {
    throw new Error("Unable to define deterministic object property");
  }
}

export function safeFreeze<T extends object>(value: T): Readonly<T> {
  return SAFE_RUNTIME_DERIVED_BINDINGS.objectFreeze(value);
}

export function safeCreateNullPrototypeObject(): object {
  return SAFE_RUNTIME_DERIVED_BINDINGS.objectCreate(null);
}

export function getLoadedObjectPrototype(): object {
  return SAFE_RUNTIME_DERIVED_BINDINGS.loadedObjectPrototype;
}

export function createSafeWeakSet(): WeakSet<object> {
  return new SAFE_RUNTIME_DERIVED_BINDINGS.loadedWeakSet<object>();
}

export function safeWeakSetAdd(set: WeakSet<object>, value: object): void {
  SAFE_RUNTIME_DERIVED_BINDINGS.weakSetAdd(set, value);
}

export function safeWeakSetHas(set: WeakSet<object>, value: object): boolean {
  return SAFE_RUNTIME_DERIVED_BINDINGS.weakSetHas(set, value);
}

export function safeDeepFreeze(value: unknown): void {
  const visited = createSafeWeakSet();
  function visit(current: unknown): void {
    if (typeof current !== "object" || current === null) return;
    if (safeWeakSetHas(visited, current)) return;
    safeWeakSetAdd(visited, current);
    const keys = SAFE_RUNTIME_DERIVED_BINDINGS.reflectOwnKeys(current);
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor =
        SAFE_RUNTIME_DERIVED_BINDINGS.objectGetOwnPropertyDescriptor(
          current,
          keys[index],
        );
      if (descriptor && "value" in descriptor) visit(descriptor.value);
    }
    SAFE_RUNTIME_DERIVED_BINDINGS.objectFreeze(current);
  }
  visit(value);
}

export function safeLowerCase(value: string): string {
  return SAFE_RUNTIME_DERIVED_BINDINGS.stringToLowerCase(value);
}

export function safeCharCodeAt(value: string, index: number): number {
  return SAFE_RUNTIME_DERIVED_BINDINGS.stringCharCodeAt(value, index);
}

export function safeStartsWith(value: string, search: string): boolean {
  return SAFE_RUNTIME_DERIVED_BINDINGS.stringStartsWith(value, search);
}

export function safeSlice(value: string, start: number, end?: number): string {
  return SAFE_RUNTIME_DERIVED_BINDINGS.stringSlice(value, start, end);
}

export function safeRepeat(value: string, count: number): string {
  return SAFE_RUNTIME_DERIVED_BINDINGS.stringRepeat(value, count);
}

export function safeRegExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  return SAFE_RUNTIME_DERIVED_BINDINGS.regexpExec(pattern, value);
}

export function safeNumber(value: string): number {
  return SAFE_RUNTIME_DERIVED_BINDINGS.numberConstructor(value);
}

export function safeJsonStringifyString(value: string): string {
  return SAFE_RUNTIME_DERIVED_BINDINGS.jsonStringify(value);
}

export function safeParseDate(value: string): Date {
  return new SAFE_RUNTIME_DERIVED_BINDINGS.loadedDate(value);
}

export function safeDateGetTime(value: Date): number {
  return SAFE_RUNTIME_DERIVED_BINDINGS.dateGetTime(value);
}

export function safeDateToISOString(value: Date): string {
  return SAFE_RUNTIME_DERIVED_BINDINGS.dateToISOString(value);
}

export function safeNumberIsFinite(value: number): boolean {
  return SAFE_RUNTIME_DERIVED_BINDINGS.numberIsFinite(value);
}

export function safeNumberIsSafeInteger(value: number): boolean {
  return SAFE_RUNTIME_DERIVED_BINDINGS.numberIsSafeInteger(value);
}

export function safeAbs(value: number): number {
  return SAFE_RUNTIME_DERIVED_BINDINGS.mathAbs(value);
}

export function loadedFunctionSource(value: Function): string {
  return SAFE_RUNTIME_DERIVED_BINDINGS.functionToString(value);
}

export function safeSha256(value: string): string {
  const hash = SAFE_RUNTIME_DERIVED_BINDINGS.loadedCreateHash("sha256");
  SAFE_RUNTIME_DERIVED_BINDINGS.hashUpdate(
    hash,
    SAFE_RUNTIME_DERIVED_BINDINGS.bufferFrom(value, "utf8"),
  );
  return SAFE_RUNTIME_DERIVED_BINDINGS.hashDigest(hash, "hex");
}

function loadedBindingIdentity(label: string, value: Function): string {
  return `${label}\n${value.name}\n${loadedFunctionSource(value)}`;
}

const SAFE_RUNTIME_ARTIFACT_HASH = safeSha256(
  [
    "factbase-derivation-safe-runtime-v1",
    "private-module-captures-v2",
    process.versions.node,
    process.versions.v8,
    loadedFunctionSource(initializeSafeRuntimeBindings),
    loadedFunctionSource(initializeSafeRuntimeDerivedBindings),
    loadedFunctionSource(loadedBindingIdentity),
    loadedBindingIdentity(
      "reflectDefineProperty",
      SAFE_RUNTIME_DERIVED_BINDINGS.reflectDefineProperty,
    ),
    loadedBindingIdentity("reflectOwnKeys", SAFE_RUNTIME_DERIVED_BINDINGS.reflectOwnKeys),
    loadedBindingIdentity(
      "objectGetPrototypeOf",
      SAFE_RUNTIME_DERIVED_BINDINGS.objectGetPrototypeOf,
    ),
    loadedBindingIdentity(
      "objectGetOwnPropertyDescriptors",
      SAFE_RUNTIME_DERIVED_BINDINGS.objectGetOwnPropertyDescriptors,
    ),
    loadedBindingIdentity(
      "objectGetOwnPropertyDescriptor",
      SAFE_RUNTIME_DERIVED_BINDINGS.objectGetOwnPropertyDescriptor,
    ),
    loadedBindingIdentity("objectCreate", SAFE_RUNTIME_DERIVED_BINDINGS.objectCreate),
    loadedBindingIdentity("objectFreeze", SAFE_RUNTIME_DERIVED_BINDINGS.objectFreeze),
    loadedBindingIdentity("arrayIsArray", SAFE_RUNTIME_DERIVED_BINDINGS.arrayIsArray),
    loadedBindingIdentity(
      "stringToLowerCase",
      SAFE_RUNTIME_DERIVED_BINDINGS.stringToLowerCase,
    ),
    loadedBindingIdentity("stringCharCodeAt", SAFE_RUNTIME_DERIVED_BINDINGS.stringCharCodeAt),
    loadedBindingIdentity("stringStartsWith", SAFE_RUNTIME_DERIVED_BINDINGS.stringStartsWith),
    loadedBindingIdentity("stringSlice", SAFE_RUNTIME_DERIVED_BINDINGS.stringSlice),
    loadedBindingIdentity("stringRepeat", SAFE_RUNTIME_DERIVED_BINDINGS.stringRepeat),
    loadedBindingIdentity("regexpExec", SAFE_RUNTIME_DERIVED_BINDINGS.regexpExec),
    loadedBindingIdentity("numberIsFinite", SAFE_RUNTIME_DERIVED_BINDINGS.numberIsFinite),
    loadedBindingIdentity(
      "numberIsSafeInteger",
      SAFE_RUNTIME_DERIVED_BINDINGS.numberIsSafeInteger,
    ),
    loadedBindingIdentity("mathAbs", SAFE_RUNTIME_DERIVED_BINDINGS.mathAbs),
    loadedBindingIdentity("numberConstructor", SAFE_RUNTIME_DERIVED_BINDINGS.numberConstructor),
    loadedBindingIdentity("jsonStringify", SAFE_RUNTIME_DERIVED_BINDINGS.jsonStringify),
    loadedBindingIdentity("loadedDate", SAFE_RUNTIME_DERIVED_BINDINGS.loadedDate),
    loadedBindingIdentity("dateGetTime", SAFE_RUNTIME_DERIVED_BINDINGS.dateGetTime),
    loadedBindingIdentity("dateToISOString", SAFE_RUNTIME_DERIVED_BINDINGS.dateToISOString),
    loadedBindingIdentity("functionToString", SAFE_RUNTIME_DERIVED_BINDINGS.functionToString),
    loadedBindingIdentity("bufferFrom", SAFE_RUNTIME_DERIVED_BINDINGS.bufferFrom),
    loadedBindingIdentity("loadedCreateHash", SAFE_RUNTIME_DERIVED_BINDINGS.loadedCreateHash),
    loadedBindingIdentity("loadedWeakSet", SAFE_RUNTIME_DERIVED_BINDINGS.loadedWeakSet),
    loadedBindingIdentity("weakSetAdd", SAFE_RUNTIME_DERIVED_BINDINGS.weakSetAdd),
    loadedBindingIdentity("weakSetHas", SAFE_RUNTIME_DERIVED_BINDINGS.weakSetHas),
    loadedBindingIdentity("hashUpdate", SAFE_RUNTIME_DERIVED_BINDINGS.hashUpdate),
    loadedBindingIdentity("hashDigest", SAFE_RUNTIME_DERIVED_BINDINGS.hashDigest),
    loadedFunctionSource(defineArrayElement),
    loadedFunctionSource(appendArrayElement),
    loadedFunctionSource(copyArrayRange),
    loadedFunctionSource(sortArrayCopy),
    loadedFunctionSource(findTextIndex),
    loadedFunctionSource(safeArrayIsArray),
    loadedFunctionSource(safeOwnKeys),
    loadedFunctionSource(safeGetPrototypeOf),
    loadedFunctionSource(safeGetOwnPropertyDescriptors),
    loadedFunctionSource(safeDefineProperty),
    loadedFunctionSource(safeFreeze),
    loadedFunctionSource(safeCreateNullPrototypeObject),
    loadedFunctionSource(getLoadedObjectPrototype),
    loadedFunctionSource(createSafeWeakSet),
    loadedFunctionSource(safeWeakSetAdd),
    loadedFunctionSource(safeWeakSetHas),
    loadedFunctionSource(safeDeepFreeze),
    loadedFunctionSource(safeLowerCase),
    loadedFunctionSource(safeCharCodeAt),
    loadedFunctionSource(safeStartsWith),
    loadedFunctionSource(safeSlice),
    loadedFunctionSource(safeRepeat),
    loadedFunctionSource(safeRegExpExec),
    loadedFunctionSource(safeNumber),
    loadedFunctionSource(safeJsonStringifyString),
    loadedFunctionSource(safeParseDate),
    loadedFunctionSource(safeDateGetTime),
    loadedFunctionSource(safeDateToISOString),
    loadedFunctionSource(safeNumberIsFinite),
    loadedFunctionSource(safeNumberIsSafeInteger),
    loadedFunctionSource(safeAbs),
    loadedFunctionSource(safeSha256),
  ].join("\n"),
);

export function getDerivationSafeRuntimeArtifactHash(): string {
  return SAFE_RUNTIME_ARTIFACT_HASH;
}
