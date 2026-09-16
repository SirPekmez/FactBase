import { createHash } from "node:crypto";

export interface Rcv020FinalObject {
  readonly identity: string;
  readonly reference: string;
  readonly contentHash: string;
  readonly byteLength: bigint;
}

export interface Rcv020RawObjectAuthority {
  finalize(bytes: Uint8Array, expectedHash: string, expectedLength: bigint): Promise<Rcv020FinalObject>;
  verify(object: Rcv020FinalObject): Promise<boolean>;
  exists(identity: string): Promise<boolean>;
}

export interface Rcv020RawObjectFaults {
  readonly failFinalize?: boolean;
  readonly failVerify?: boolean;
  readonly disappearAfterCommit?: boolean;
}

/** Deterministic local authority used by Wave 3 proofs; it makes no durability claim. */
export class Rcv020InMemoryRawObjectAuthority implements Rcv020RawObjectAuthority {
  private readonly objects = new Map<string, Uint8Array>();
  private readonly faults: Rcv020RawObjectFaults;

  constructor(faults: Rcv020RawObjectFaults = {}) { this.faults = faults; }

  async finalize(bytes: Uint8Array, expectedHash: string, expectedLength: bigint): Promise<Rcv020FinalObject> {
    if (this.faults.failFinalize) throw new Error("raw object finalization failed");
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    const actualLength = BigInt(bytes.byteLength);
    if (actualHash !== expectedHash || actualLength !== expectedLength) throw new Error("raw object hash/length mismatch");
    const identity = `sha256:${actualHash}`;
    if (!this.objects.has(identity)) this.objects.set(identity, new Uint8Array(bytes));
    return Object.freeze({ identity, reference: identity, contentHash: actualHash, byteLength: actualLength });
  }

  async verify(object: Rcv020FinalObject): Promise<boolean> {
    if (this.faults.failVerify) return false;
    const bytes = this.objects.get(object.identity);
    if (!bytes) return false;
    return createHash("sha256").update(bytes).digest("hex") === object.contentHash && BigInt(bytes.byteLength) === object.byteLength;
  }

  async exists(identity: string): Promise<boolean> { return this.objects.has(identity); }

  disappear(identity: string): void { this.objects.delete(identity); }
}

export function hashRcv020Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
