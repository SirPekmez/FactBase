import {
  Rcv020AttemptOutcome,
  Rcv020ObservationOccurrence,
  Rcv020OccurrenceOutcome,
  Rcv020RequestQuery,
} from "../contracts/rcv020ObservatoryContractV1";
import { canonicalizeRcv020Request } from "./rcv020Canonical";
import { Rcv020PersistenceInput, Rcv020PersistenceResult, persistRcv020Authority } from "./rcv020PersistenceService";
import { Rcv020RawObjectAuthority } from "./rcv020RawObjectAuthority";
import { Rcv020PgPool } from "./rcv020PostgresRepository";
import { Rcv020ReadPool } from "./rcv020PostgresReadRepository";
import { Rcv020ReadService } from "./rcv020ReadService";

/** A deterministic adapter result supplied by the caller or a test authority. */
export type Rcv020AdapterResult =
  | Readonly<{
      outcome: Exclude<Rcv020AttemptOutcome, "FAILED">;
      completedAt: string;
      bytes: Uint8Array;
    }>
  | Readonly<{
      outcome: "FAILED";
      completedAt: string;
      failureCode: string;
    }>;

export interface Rcv020AdapterContext {
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly request: Rcv020RequestQuery;
  readonly requestCanonical: string;
  readonly requestHash: string;
  readonly attemptDeadlineAt: string;
}

export interface Rcv020DeterministicAdapter {
  retrieve(context: Rcv020AdapterContext): Promise<Rcv020AdapterResult>;
}

/** A deterministic, in-memory adapter used for integration and fault proofs. */
export class Rcv020MapAdapter implements Rcv020DeterministicAdapter {
  private readonly responses: ReadonlyMap<string, Rcv020AdapterResult>;

  constructor(responses: ReadonlyMap<string, Rcv020AdapterResult> | Record<string, Rcv020AdapterResult>) {
    this.responses = responses instanceof Map ? responses : new Map(Object.entries(responses));
  }

  async retrieve(context: Rcv020AdapterContext): Promise<Rcv020AdapterResult> {
    const response = this.responses.get(context.requestHash) ?? this.responses.get(context.request.target);
    if (!response) throw new Error(`deterministic adapter response missing for ${context.requestHash}`);
    return response;
  }
}

export interface Rcv020OperationalRunInput {
  readonly bundle: Rcv020PersistenceInput;
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly request: Rcv020RequestQuery;
  readonly adapter: Rcv020DeterministicAdapter;
}

export interface Rcv020OperationalRunResult {
  readonly adapterResult: Rcv020AdapterResult;
  readonly persistence: Rcv020PersistenceResult;
  readonly verified: Awaited<ReturnType<Rcv020ReadService["readOccurrence"]>>;
  readonly coverage: Rcv020ScheduledCoverage;
  readonly requestCanonical: string;
  readonly requestHash: string;
}

/**
 * Connects a deterministic adapter to the already-authoritative Wave-2/3/4
 * models. The supplied bundle remains the authority: adapter output must
 * exactly agree with its attempt resolution and Capture bytes are checked
 * against the persisted content hash before persistence begins.
 */
export async function executeRcv020OperationalSlice(
  pool: Rcv020PgPool & Rcv020ReadPool,
  input: Rcv020OperationalRunInput,
  objects?: Rcv020RawObjectAuthority,
): Promise<Rcv020OperationalRunResult> {
  const request = canonicalizeRcv020Request(input.request);
  const attempt = (input.bundle.attempts ?? []).find((value) => value.attemptId === input.attemptId);
  if (!attempt || attempt.occurrenceId !== input.occurrenceId) throw new Error("operational attempt/occurrence identity mismatch");
  const attemptWithRequest = attempt as typeof attempt & { requestCanonical?: string; requestHash?: string };
  if (attemptWithRequest.requestCanonical !== undefined && attemptWithRequest.requestCanonical !== request.canonical) throw new Error("operational request canonical mismatch");
  if (attemptWithRequest.requestHash !== undefined && attemptWithRequest.requestHash !== request.hash) throw new Error("operational request hash mismatch");
  const occurrence = (input.bundle.occurrences ?? []).find((value) => value.occurrenceId === input.occurrenceId);
  if (!occurrence) throw new Error("operational occurrence missing");

  const adapterResult = await input.adapter.retrieve({
    occurrenceId: occurrence.occurrenceId,
    attemptId: attempt.attemptId,
    request: input.request,
    requestCanonical: request.canonical,
    requestHash: request.hash,
    attemptDeadlineAt: attempt.attemptDeadlineAt,
  });
  const resolution = (input.bundle.attemptResolutions ?? []).find((value) => value.attemptId === attempt.attemptId);
  if (!resolution || resolution.outcome !== adapterResult.outcome || resolution.retrievalCompletedAt !== adapterResult.completedAt) {
    throw new Error("adapter result does not match immutable attempt resolution");
  }
  if (adapterResult.outcome === "FAILED" && resolution.failureCode !== adapterResult.failureCode) throw new Error("adapter failure code does not match immutable attempt resolution");
  if (adapterResult.outcome !== "FAILED") {
    const capture = (input.bundle.captures ?? []).find((value) => value.retrievalAttemptId === attempt.attemptId);
    if (!capture) throw new Error("capture-producing adapter result has no Capture authority");
    const bytes = Buffer.from(adapterResult.bytes);
    const crypto = await import("node:crypto");
    const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== capture.contentHash || BigInt(bytes.byteLength) !== BigInt(capture.byteLength.toString())) throw new Error("adapter bytes do not match Capture authority");
    const retention = (capture as unknown as { retentionPolicy?: string }).retentionPolicy ?? "METADATA_HASH_ONLY";
    if (retention !== "METADATA_HASH_ONLY" && !objects) throw new Error("retained Capture requires raw-object authority");
    if (retention !== "METADATA_HASH_ONLY" && capture.rawObjectIdentity && capture.rawObjectIdentity !== `sha256:${actualHash}`) throw new Error("Capture raw-object identity does not match content hash");
    if (adapterResult.outcome === "CAPTURED_EMPTY") {
      let metadata: unknown;
      try { metadata = JSON.parse(String((capture as unknown as { responseMetadataCanonical?: string }).responseMetadataCanonical)); } catch { throw new Error("EMPTY Capture metadata is not canonical"); }
      if (!metadata || typeof metadata !== "object" || (metadata as { itemCount?: unknown }).itemCount !== 0) throw new Error("EMPTY requires explicit zero-item authority");
    }
  }
  const persistenceInput: Rcv020PersistenceInput = adapterResult.outcome === "FAILED"
    ? input.bundle
    : { ...input.bundle, rawBytesByCaptureId: new Map([[((input.bundle.captures ?? []).find((value) => value.retrievalAttemptId === attempt.attemptId)?.captureId ?? ""), adapterResult.bytes]]) };
  const persistence = await persistRcv020Authority(pool, persistenceInput, objects);
  const verified = await new Rcv020ReadService(pool).readOccurrence(input.occurrenceId);
  if (!verified) throw new Error("persisted occurrence could not be read back");
  const coverage = deriveRcv020ScheduledCoverage(
    input.bundle.occurrences ?? [],
    (input.bundle.occurrenceResolutions ?? []).map((value) => ({ occurrenceId: value.occurrenceId, outcome: value.outcome as Rcv020OccurrenceOutcome })),
    (input.bundle.attempts ?? []).map((value) => value.occurrenceId),
  );
  return Object.freeze({ adapterResult, persistence, verified, coverage, requestCanonical: request.canonical, requestHash: request.hash });
}

export interface Rcv020ScheduledCoverage {
  readonly expected: number;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly missed: number;
  readonly skipped: number;
}

/** Derives scheduled coverage only from persisted occurrence/attempt authority. */
export function deriveRcv020ScheduledCoverage(
  occurrences: readonly Rcv020ObservationOccurrence[],
  occurrenceResolutions: readonly { occurrenceId: string; outcome: Rcv020OccurrenceOutcome }[],
  attemptOccurrenceIds: readonly string[],
): Rcv020ScheduledCoverage {
  const scheduled = occurrences.filter((occurrence) => occurrence.triggerOrigin === "SCHEDULED");
  const attempted = new Set(attemptOccurrenceIds);
  const resolutions = new Map(occurrenceResolutions.map((resolution) => [resolution.occurrenceId, resolution.outcome]));
  let succeeded = 0; let failed = 0; let missed = 0; let skipped = 0;
  for (const occurrence of scheduled) {
    const outcome = resolutions.get(occurrence.occurrenceId);
    if (outcome === "SUCCEEDED") succeeded += 1;
    else if (outcome === "FAILED") failed += 1;
    else if (outcome === "SKIPPED") skipped += 1;
    else if (outcome === "MISSED" || !attempted.has(occurrence.occurrenceId)) missed += 1;
  }
  return Object.freeze({ expected: scheduled.length, attempted: scheduled.filter((occurrence) => attempted.has(occurrence.occurrenceId)).length, succeeded, failed, missed, skipped });
}
