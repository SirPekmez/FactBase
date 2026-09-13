import {
  Rcv019HistoricalFacet,
  Rcv019TemporalEvidenceState,
  Rcv019ValidationError,
  validateRcv019Hash,
  validateRcv019Uuid,
  validateRcv019Version,
} from "../contracts/rcv019TemporalEvidenceContractV1";

export interface Rcv019HistoricalStateInput {
  readonly claimId: unknown;
  readonly claimVersionId: unknown;
  readonly evidenceProvenance: readonly Readonly<Record<string, unknown>>[];
  readonly rcv016Snapshot: Readonly<Record<string, unknown>>;
  readonly optionalFacets?: readonly Rcv019HistoricalFacet[];
}

/** Assemble only explicitly supplied historical projections; never queries live state. */
export function assembleRcv019HistoricalState(input: Rcv019HistoricalStateInput): Rcv019TemporalEvidenceState {
  if (input === null || typeof input !== "object") throw new Rcv019ValidationError("input", "expected object");
  const claimId = validateRcv019Uuid(input.claimId, "claimId");
  const claimVersionId = validateRcv019Uuid(input.claimVersionId, "claimVersionId");
  if (!Array.isArray(input.evidenceProvenance)) throw new Rcv019ValidationError("evidenceProvenance", "expected array");
  input.evidenceProvenance.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Rcv019ValidationError(`evidenceProvenance[${index}]`, "malformed historical evidence entry");
    }
    const candidate = entry as Record<string, unknown>;
    if ((candidate.evidenceId === undefined && candidate.id === undefined) || typeof candidate.relation !== "string") {
      throw new Rcv019ValidationError(`evidenceProvenance[${index}]`, "incomplete authenticated evidence identity");
    }
  });
  if (input.rcv016Snapshot === null || typeof input.rcv016Snapshot !== "object" || Array.isArray(input.rcv016Snapshot)) {
    throw new Rcv019ValidationError("rcv016Snapshot", "missing authenticated snapshot projection");
  }
  if (input.rcv016Snapshot.snapshotId === undefined || input.rcv016Snapshot.snapshotHash === undefined) {
    throw new Rcv019ValidationError("rcv016Snapshot", "incomplete authenticated snapshot identity");
  }
  validateRcv019Uuid(input.rcv016Snapshot.snapshotId, "rcv016Snapshot.snapshotId");
  validateRcv019Hash(input.rcv016Snapshot.snapshotHash, "rcv016Snapshot.snapshotHash");
  const optionalFacets = input.optionalFacets?.map((facet, index) => {
    if (facet === null || typeof facet !== "object") throw new Rcv019ValidationError(`optionalFacets[${index}]`, "expected facet");
    validateRcv019Uuid(facet.id, `optionalFacets[${index}].id`);
    validateRcv019Version(facet.version, `optionalFacets[${index}].version`);
    validateRcv019Hash(facet.hash, `optionalFacets[${index}].hash`);
    return Object.freeze({ ...facet });
  });
  return Object.freeze({
    contractVersion: 1,
    claimId,
    claimVersionId,
    evidenceProvenance: Object.freeze(input.evidenceProvenance.map((entry) => Object.freeze({ ...entry }))),
    rcv016Snapshot: Object.freeze({ ...input.rcv016Snapshot }),
    ...(optionalFacets === undefined ? {} : { optionalFacets: Object.freeze(optionalFacets) }),
  });
}
