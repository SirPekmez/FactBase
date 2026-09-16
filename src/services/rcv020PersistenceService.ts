import { Rcv020Capture } from "../contracts/rcv020ObservatoryContractV1";
import { Rcv020RawObjectAuthority, Rcv020FinalObject, hashRcv020Bytes } from "./rcv020RawObjectAuthority";
import { Rcv020PgClient, Rcv020PgPool, persistRcv020Bundle } from "./rcv020PostgresRepository";
import { Rcv020WriteBundle, verifyRcv020Write } from "./rcv020WriteVerifier";

export interface Rcv020PersistenceInput extends Rcv020WriteBundle {
  readonly rawBytesByCaptureId?: ReadonlyMap<string, Uint8Array>;
}

export interface Rcv020PersistenceResult {
  readonly rawObjects: ReadonlyMap<string, Rcv020FinalObject>;
  readonly persisted: true;
}

/** Semantic verification precedes object finalization and the relational transaction. */
export async function persistRcv020Authority(
  clientOrPool: Rcv020PgClient | Rcv020PgPool,
  input: Rcv020PersistenceInput,
  objects?: Rcv020RawObjectAuthority,
): Promise<Rcv020PersistenceResult> {
  const verified = verifyRcv020Write(input);
  const finalized = new Map<string, Rcv020FinalObject>();
  if (objects) {
    for (const capture of verified.captures ?? []) {
      const retention = (capture as unknown as { retentionPolicy?: string }).retentionPolicy ?? "METADATA_HASH_ONLY";
      if (retention === "METADATA_HASH_ONLY") continue;
      const bytes = input.rawBytesByCaptureId?.get(capture.captureId);
      if (!bytes) throw new Error(`raw bytes required for retained Capture ${capture.captureId}`);
      const expectedHash = hashRcv020Bytes(bytes);
      if (expectedHash !== capture.contentHash) throw new Error("raw bytes content hash mismatch");
      const object = await objects.finalize(bytes, expectedHash, BigInt(capture.byteLength.toString()));
      if (!(await objects.verify(object))) throw new Error("final raw object verification failed");
      if (capture.rawObjectIdentity != null && capture.rawObjectIdentity !== object.identity) throw new Error("Capture raw object identity mismatch");
      finalized.set(capture.captureId, object);
    }
  }
  const persistedInput: Rcv020WriteBundle = finalized.size === 0 ? verified : {
    ...verified,
    captures: (verified.captures ?? []).map((capture) => {
      const object = finalized.get(capture.captureId);
      return object ? { ...capture, rawObjectIdentity: object.identity, rawObjectReference: object.reference } : capture;
    }),
  };
  const bound = typeof (clientOrPool as Rcv020PgPool).connect === "function" ? await (clientOrPool as Rcv020PgPool).connect() : clientOrPool as Rcv020PgClient;
  try {
    await persistRcv020Bundle(bound, persistedInput);
    return Object.freeze({ rawObjects: finalized, persisted: true as const });
  } finally {
    const release = (bound as Rcv020PgClient & { release?: () => void }).release;
    if (release) release();
  }
}

export const persistRcv020Write = persistRcv020Authority;
