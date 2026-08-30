export const RCV016_TECHNICAL_ERROR_CODES = [
  "validation_error",
  "canonicalization_error",
  "payload_limit_error",
  "unsupported_contract_version",
  "hash_integrity_error",
] as const;

export type Rcv016TechnicalErrorCode =
  (typeof RCV016_TECHNICAL_ERROR_CODES)[number];

export abstract class Rcv016TechnicalError extends Error {
  abstract readonly code: Rcv016TechnicalErrorCode;

  protected constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}

export class Rcv016ValidationError extends Rcv016TechnicalError {
  readonly code = "validation_error" as const;

  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv016ValidationError";
  }
}

export class Rcv016CanonicalizationError extends Rcv016TechnicalError {
  readonly code = "canonicalization_error" as const;

  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv016CanonicalizationError";
  }
}

export class Rcv016PayloadLimitError extends Rcv016TechnicalError {
  readonly code = "payload_limit_error" as const;

  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv016PayloadLimitError";
  }
}

export class Rcv016UnsupportedContractVersionError extends Rcv016TechnicalError {
  readonly code = "unsupported_contract_version" as const;

  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv016UnsupportedContractVersionError";
  }
}

export class Rcv016HashIntegrityError extends Rcv016TechnicalError {
  readonly code = "hash_integrity_error" as const;

  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv016HashIntegrityError";
  }
}

export type Rcv016SchemaObject = Record<string, unknown>;

export function expectRcv016PlainObject(
  value: unknown,
  path: string,
): Rcv016SchemaObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Rcv016ValidationError(path, "expected a plain object");
  }
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key !== "string") {
      throw new Rcv016ValidationError(path, "expected string field names");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
      throw new Rcv016ValidationError(path, "fields must be enumerable data properties");
    }
  }
  return value as Rcv016SchemaObject;
}

export function expectRcv016ExactObject(
  value: unknown,
  keys: readonly string[],
  path: string,
): Rcv016SchemaObject {
  const object = expectRcv016PlainObject(value, path);
  const ownKeys = Object.keys(object);
  if (ownKeys.length !== keys.length) {
    throw new Rcv016ValidationError(path, "unexpected or missing field");
  }
  for (const key of ownKeys) {
    if (!keys.includes(key)) {
      throw new Rcv016ValidationError(path, "unexpected or missing field");
    }
  }
  return object;
}

export function expectRcv016Array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Rcv016ValidationError(path, "expected an array");
  }
  return value;
}

export function expectRcv016String(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Rcv016ValidationError(path, "expected a string");
  }
  return value;
}

export function expectRcv016NonEmptyString(
  value: unknown,
  path: string,
): string {
  const text = expectRcv016String(value, path);
  if (text.length === 0) {
    throw new Rcv016ValidationError(path, "expected a non-empty string");
  }
  return text;
}

export function expectRcv016NullableNonEmptyString(
  value: unknown,
  path: string,
): string | null {
  return value === null ? null : expectRcv016NonEmptyString(value, path);
}

export function expectRcv016PositiveSafeInteger(
  value: unknown,
  path: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Rcv016ValidationError(
      path,
      "expected a finite positive safe integer",
    );
  }
  return value;
}

export function rcv016CodepointLength(value: string): number {
  return Array.from(value).length;
}

export function rcv016Utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function assertRcv016CountLimit(
  actual: number,
  limit: number,
  path: string,
  limitName: string,
): void {
  if (actual > limit) {
    throw new Rcv016PayloadLimitError(
      path,
      `exceeds ${limitName} (${actual} > ${limit})`,
    );
  }
}

export function assertRcv016TextLimits(
  value: string,
  codepointLimit: number,
  utf8ByteLimit: number,
  path: string,
  codepointLimitName: string,
  utf8ByteLimitName: string,
): void {
  assertRcv016CountLimit(
    rcv016CodepointLength(value),
    codepointLimit,
    path,
    codepointLimitName,
  );
  assertRcv016CountLimit(
    rcv016Utf8ByteLength(value),
    utf8ByteLimit,
    path,
    utf8ByteLimitName,
  );
}

export function freezeRcv016<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) {
        freezeRcv016(descriptor.value);
      }
    }
    Object.freeze(value);
  }
  return value;
}
