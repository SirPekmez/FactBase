const CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION = 1 as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type ClaimLevelEvidenceViewInputFailureCode =
  | "MALFORMED_VIEW_SPEC"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "DUPLICATE_ENVELOPE_REF";

export class ClaimLevelEvidenceViewInputError extends Error {
  readonly name = "ClaimLevelEvidenceViewInputError";

  constructor(
    readonly code: ClaimLevelEvidenceViewInputFailureCode,
    readonly path: string,
    readonly detail: string,
  ) {
    super(`${code} at ${path}: ${detail}`);
  }
}

export interface ClaimVersionRef {
  readonly claimVersionId: string;
  readonly canonicalVersion: 1;
  readonly canonicalHash: string;
}

export interface EnvelopeRef {
  readonly envelopeId: string;
  readonly canonicalVersion: 1;
  readonly canonicalHash: string;
}

export interface ClaimLevelEvidenceViewSpec {
  readonly claimVersionRef: ClaimVersionRef;
  readonly envelopeManifest: readonly EnvelopeRef[];
  readonly contractVersion: 1;
}

function fail(
  code: ClaimLevelEvidenceViewInputFailureCode,
  path: string,
  message: string,
): never {
  throw new ClaimLevelEvidenceViewInputError(code, path, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("MALFORMED_VIEW_SPEC", path, "expected a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("MALFORMED_VIEW_SPEC", path, "expected a plain object");
  }
  return value as Record<string, unknown>;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const object = record(value, path);
  const ownKeys = Reflect.ownKeys(object);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail("MALFORMED_VIEW_SPEC", path, "symbol properties are not allowed");
  }
  const actual = (ownKeys as string[]).slice().sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail("MALFORMED_VIEW_SPEC", path, `expected exactly: ${keys.join(", ")}`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !("value" in descriptor)) {
      fail("MALFORMED_VIEW_SPEC", `${path}.${key}`, "accessors are not allowed");
    }
    if (descriptor.value === null || descriptor.value === undefined) {
      fail("MALFORMED_VIEW_SPEC", `${path}.${key}`, "null/undefined is not allowed");
    }
  }
  return object;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    fail("MALFORMED_VIEW_SPEC", path, "expected lowercase canonical UUID");
  }
  return value;
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("MALFORMED_VIEW_SPEC", path, "expected lowercase SHA-256 hash");
  }
  return value;
}

function version(value: unknown, path: string): 1 {
  if (value !== 1) {
    fail("MALFORMED_VIEW_SPEC", path, "expected canonicalVersion 1");
  }
  return 1;
}

function compareBytes(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function compareEnvelopeRefs(left: EnvelopeRef, right: EnvelopeRef): number {
  return (
    compareBytes(left.envelopeId, right.envelopeId) ||
    left.canonicalVersion - right.canonicalVersion ||
    compareBytes(left.canonicalHash, right.canonicalHash)
  );
}

type StructuralFailure = {
  code: ClaimLevelEvidenceViewInputFailureCode;
  path: string;
  detail: string;
  selectionKey: string;
};

function stableStructuralPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

function structuralFailure(
  error: ClaimLevelEvidenceViewInputError,
): StructuralFailure {
  const path = stableStructuralPath(error.path);
  return {
    code: error.code,
    path,
    detail: error.detail,
    selectionKey: `${path}\u0000${error.code}\u0000${error.detail}`,
  };
}

function selectStructuralFailure(failures: StructuralFailure[]): never {
  const winner = failures
    .slice()
    .sort((left, right) => compareBytes(left.selectionKey, right.selectionKey))[0];
  fail(winner.code, winner.path, winner.detail);
}

function cloneClaimVersionRef(value: unknown): ClaimVersionRef {
  const object = exactRecord(
    value,
    ["claimVersionId", "canonicalVersion", "canonicalHash"],
    "claimVersionRef",
  );
  return Object.freeze({
    claimVersionId: uuid(object.claimVersionId, "claimVersionRef.claimVersionId"),
    canonicalVersion: version(
      object.canonicalVersion,
      "claimVersionRef.canonicalVersion",
    ),
    canonicalHash: hash(
      object.canonicalHash,
      "claimVersionRef.canonicalHash",
    ),
  });
}

function cloneEnvelopeRef(value: unknown, path: string): EnvelopeRef {
  const object = exactRecord(
    value,
    ["envelopeId", "canonicalVersion", "canonicalHash"],
    path,
  );
  return Object.freeze({
    envelopeId: uuid(object.envelopeId, `${path}.envelopeId`),
    canonicalVersion: version(
      object.canonicalVersion,
      `${path}.canonicalVersion`,
    ),
    canonicalHash: hash(object.canonicalHash, `${path}.canonicalHash`),
  });
}

function cloneAndCanonicalizeEnvelopeManifest(value: unknown): readonly EnvelopeRef[] {
  if (!Array.isArray(value)) {
    fail("MALFORMED_VIEW_SPEC", "envelopeManifest", "expected an array");
  }

  const refs: EnvelopeRef[] = [];
  const byId = new Map<string, EnvelopeRef>();
  const failures: StructuralFailure[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let ref: EnvelopeRef;
    try {
      ref = cloneEnvelopeRef(value[index], `envelopeManifest[${index}]`);
    } catch (error) {
      if (!(error instanceof ClaimLevelEvidenceViewInputError)) throw error;
      failures.push(structuralFailure(error));
      continue;
    }
    const previous = byId.get(ref.envelopeId);
    if (previous) {
      const detail =
        previous.canonicalVersion === ref.canonicalVersion &&
        previous.canonicalHash === ref.canonicalHash
          ? "duplicate EnvelopeRef"
          : "conflicting references for one envelopeId";
      const path = stableStructuralPath(
        `envelopeManifest[${index}].envelopeId`,
      );
      failures.push({
        code: "DUPLICATE_ENVELOPE_REF",
        path,
        detail,
        selectionKey: `${path}\u0000DUPLICATE_ENVELOPE_REF\u0000${detail}`,
      });
      continue;
    }
    byId.set(ref.envelopeId, ref);
    refs.push(ref);
  }

  if (failures.length > 0) selectStructuralFailure(failures);

  refs.sort(compareEnvelopeRefs);
  return Object.freeze(refs);
}

/**
 * Wave A structural boundary. This function performs no database access and
 * does not authenticate any historical RCV-022 authority.
 */
export function prepareClaimLevelEvidenceViewSpec(
  value: unknown,
): ClaimLevelEvidenceViewSpec {
  const object = exactRecord(
    value,
    ["claimVersionRef", "envelopeManifest", "contractVersion"],
    "viewSpec",
  );
  if (object.contractVersion !== CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION) {
    fail(
      "UNSUPPORTED_CONTRACT_VERSION",
      "contractVersion",
      `expected ${CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION}`,
    );
  }

  return Object.freeze({
    claimVersionRef: cloneClaimVersionRef(object.claimVersionRef),
    envelopeManifest: cloneAndCanonicalizeEnvelopeManifest(
      object.envelopeManifest,
    ),
    contractVersion: CLAIM_LEVEL_EVIDENCE_VIEW_CONTRACT_VERSION,
  });
}
