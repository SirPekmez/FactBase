# RCV-019 Temporal Evidence Evolution — Implementation Design V1

## Status and authority

**DESIGN STATUS: DRAFT**

This document is an implementation design, not a contract, migration, or
implementation. The frozen authority is the RCV-019 Contract V1 at
`docs/provenance/rcv019-temporal-evidence-evolution-contract-v1.md`, SHA-256
`a028ad8b81b9132b8dca72760fc43799d2b31d815c89b92d38c3e02734bbe615`.
RCV-009 through RCV-018 contracts, schemas, and guardrails remain authoritative
for their own semantics. A conflict is a design defect and must not be solved
by changing an earlier RCV.

## 1. Design goal and boundaries

The implementation must realize the frozen RCV-019 Contract exactly, without
introducing additional epistemic semantics. It must not add truth, source,
confidence, ranking, quantity, newer-is-better, current-state, synthetic-time,
repair, or silent-deduplication semantics.

The minimum architecture is pure domain validation/canonicalization, a state
assembler, a timeline builder, a transition derivation engine, independent
write/read verifiers, one atomic repository boundary, and a read service. The
database is a structural projection, never a semantic authority.

## 2. Component manifest

| Component | Status | Responsibility | Explicit exclusions |
|---|---|---|---|
| `rcv019TemporalEvidenceContractV1` | REQUIRED | Closed domain shapes, versions, IDs, timestamps, failure classes | No I/O or semantic inference |
| `rcv019Canonical` | REQUIRED | Reuse `canonicalizeAndHash`/`sha256` from `canonicalJson`; produce exact JCS/UTF-8 bytes | No field invention or normalization |
| `rcv019HistoricalStateAssembler` | REQUIRED | Accept exact RCV-009/010/016 projections and declared optional facets; authenticate and form complete state | No latest/current lookup |
| `rcv019TimelineBuilder` | REQUIRED | Validate one Claim, construct immutable points, enforce `knowledgeAt` order, derive transitions, emit write projection | No persistence or repair |
| `rcv019TransitionDeriver` | REQUIRED | Pure adjacent-state set comparisons using exact upstream identities | No truth/trust interpretation |
| `rcv019WriteVerifier` | REQUIRED | Re-authenticate the proposed complete bundle and canonical/hash/transition parity before write | No writes or fallback |
| `rcv019PostgresRepository` | REQUIRED | Persist authenticated projection in one parameterized atomic transaction | No semantic sorting, UPSERT, or repair |
| `rcv019PostgresReadRepository` | REQUIRED | Exact analysis-ID retrieval of raw rows and bound historical projections | No latest/current selection |
| `rcv019ReadService` | REQUIRED | Orchestrate exact read followed by independent verification | No enrichment |
| `rcv019ReadVerifier` | REQUIRED | Reconstruct and verify persisted state, points, ordering, transitions, and hashes | Read-only; no repair |
| migration after RCV-018 | REQUIRED (plan only) | Add only RCV-019 structural objects after RCV-018 | No migration is created in this phase |
| separate point-hash utility | NOT NEEDED | Occurrence envelope can be covered by timeline hash | Avoid duplicate hash authority |

Dependency direction is Contract → Canonical → assembler/deriver/builder →
write verifier → repository → read repository → read verifier → service.

## 3. Logical domain model

### TemporalEvidenceState

State content is the canonical, versioned, hash-addressed historical content:
RCV-009 Claim/ClaimVersion identity, required RCV-010 evidence/provenance
identity, required authenticated RCV-016 snapshot identity/version/hash, and
only the optional facets explicitly declared by the point. Each optional facet
contains its exact identity, version, and hash. Absence is represented as
absence, not as an empty or negative fact. `stateHash` covers this content and
excludes `pointId` and `knowledgeAt`.

### TemporalEvidencePoint

An immutable occurrence containing `pointId`, one Claim ID, exactly one
ClaimVersion ID belonging to that Claim, explicit canonical `knowledgeAt`, the
complete authenticated `TemporalEvidenceState`, `stateHash`, and the V1 state
and occurrence envelope versions. `pointId` is unique occurrence identity;
equal state content at another time is allowed and is never deduplicated.

### TemporalEvidenceTransition

An adjacent-pair derived record containing `fromPointId`, `toPointId`, V1
transition version, and an ordered `changeTypes[]` list. It has no independent
historical authority. It is deterministically regenerated from the two states;
physical persistence is optional and, if used, is a projection checked against
the derived value.

### TemporalEvidenceAnalysis

The immutable output envelope contains `analysisId`, `RCV-019 V1`, one Claim ID,
ordered point references, derived adjacent transitions, canonical envelope, and
timeline/analysis hash. It is an immutable occurrence of an analysis, not a
“latest analysis” view. Multiple analyses for one Claim are permitted only as
distinct explicitly identified immutable envelopes (for example, different
point sets or contract versions); no implicit latest selection exists.

## 4. Identity, cardinality, and equality

The subject is exactly one RCV-009 Claim. Every point's ClaimVersion must
belong to that Claim. Statement similarity, source identity, or descriptive
content cannot substitute for either identity.

`pointId` uniqueness is enforced structurally and semantically. Duplicate
point IDs fail closed. `stateHash` equality across different point IDs is
valid. Point ID, knowledgeAt, database IDs, ordinals, and persistence metadata
are excluded from state-content equality. ClaimVersion identity, state version,
and every included optional facet participate in equality; absent and present
facets are unequal.

Cardinality is exact: zero points is invalid; one point is valid with zero
transitions; N ≥ 2 points are valid only with strictly increasing
`knowledgeAt`, and have exactly N−1 adjacent transition records. One pair may
contain multiple change types. `UNCHANGED` is emitted only when the pair's
state content is equal and does not coexist with another change type.

## 5. knowledgeAt and timestamp safety

`knowledgeAt` is a caller-explicit RCV-019 semantic timestamp assigned exactly
once by the authorized point-creation/write path. The design uses the existing
FactBase canonical timestamp convention (UTC, fixed microsecond precision,
canonical `YYYY-MM-DDTHH:mm:ss.ffffffZ` text) after validation. PostgreSQL
storage must preserve the instant and precision; serialization must round-trip
the exact canonical text.

The write path rejects missing, malformed, non-canonical, or non-UTC values. No
database default, `now()`, transaction timestamp, upstream `created_at`, or
replay clock can supply it. Read/replay uses the persisted value byte-for-byte;
it never regenerates it. External event/observed/validity time, retrieval time,
assessment time, derivation time, analysis time, binding time, and transaction
time remain separate fields in their upstream facets.

Late-arriving evidence keeps its authenticated historical event metadata while
appearing in a new later point with the later `knowledgeAt`; earlier points are
not backfilled or rewritten.

## 6. Historical state and bindings

Required state references:

- RCV-009 Claim ID and ClaimVersion ID, with ownership checked;
- exact RCV-010 evidence/provenance IDs and version-bound relationships; and
- exact RCV-016 snapshot ID, contract version, canonical/hash, and membership
  projection.

Optional declared facets are RCV-011/013/014 assessment state, RCV-015
derivation, RCV-017 analysis/findings, and RCV-018 analysis/findings. An
optional facet is absent without invalidating the point unless declared;
declared facets must authenticate exact identity/version/hash and complete
canonical content. No current/latest row or cross-family fallback may satisfy a
binding.

The preferred binding model is point-specific typed facet memberships (Option C),
not a generic polymorphic binding table. Each membership has a closed facet
kind, exact ID/version/hash, and canonical ordinal. This provides strict
authentication and canonical ordering without an open-ended abstraction.

## 7. Canonical and hash boundaries

Logical state canonical shape (illustrative pseudostructure):

```text
{
  "contractVersion":"RCV-019-V1",
  "claimId":"...",
  "claimVersionId":"...",
  "required": {
    "evidenceProvenance": [ exact RCV-010 identities/hashes ],
    "rcv016Snapshot": { id, version, hash }
  },
  "optional": { declared facet objects in closed facet order }
}
```

The actual field set is closed by the Contract and upstream contracts. Arrays
are sorted by explicit semantic keys, never input/SQL order; absent fields are
absent, not null-coerced. `stateHash` is SHA-256 of exact RFC-8785/JCS UTF-8
state bytes using the existing `canonicalJson` utility. It excludes `pointId`
and `knowledgeAt`.

The occurrence/timeline envelope includes the point ID, knowledgeAt, stateHash,
ordered point list, and ordered derived transitions. A timeline hash is the
SHA-256 of that exact canonical envelope. No separate pointHash is required:
the point occurrence is transitively covered by the timeline hash while the
stateHash remains content-only. If an implementation later needs a point hash,
it must be a separate occurrence-envelope hash and cannot be called stateHash.

## 8. Ordering and transition derivation

The builder, write verifier, and read verifier all enforce ascending strictly
increasing `knowledgeAt`. Equal times fail closed as
`AMBIGUOUS_TEMPORAL_ORDER`; no UUID, point ID, hash, insertion order, row
order, analysis ID, or retrieval order is a tie-break.

Change types are emitted independently and sorted by the Contract vocabulary
order. Set comparisons use stable authenticated identity keys, never text:

| Change type | Compared facet and identity | Emission rule | Absent facet |
|---|---|---|---|
| `SUPPORTING_EVIDENCE_ADDED` | RCV-010 supporting evidence/binding identity | after-set minus before-set non-empty | Not applicable |
| `CONTRADICTING_EVIDENCE_ADDED` | RCV-010 contradicting evidence/binding identity | after minus before non-empty | Not applicable |
| `DEPENDENCY_GAP_INTRODUCED` | exact RCV-017 finding identity/hash | after minus before non-empty | Not applicable |
| `DEPENDENCY_GAP_RESOLVED` | exact RCV-017 finding identity/hash | before minus after non-empty | Not applicable; remaining gaps are not resolved globally |
| `CONTRADICTION_INTRODUCED` | exact RCV-018 finding identity/hash | after minus before non-empty | Not applicable |
| `CONTRADICTION_RESOLVED` | exact RCV-018 finding identity/hash | before minus after non-empty | Not applicable; another finding may remain |
| `ASSESSMENT_CHANGED` | authenticated assessment canonical/identity, response set, rubric/version | unequal present facets | Unsupported if absent in either |
| `UNCHANGED` | complete state-content equality | equal state hashes/content and no other change | Not applicable |

Evidence direction and binding identities come from RCV-010/011 authority;
descriptive text, source reputation, and count are never compared. Dependency
and contradiction changes are per exact finding set: disappearance of A plus
appearance of B yields resolved/introduced as applicable, not a binary global
resolution. A transition record may contain several types in the closed order.
If authenticated state content differs but no closed change type applies, the
pair fails closed as `UNSUPPORTED_TRANSITION`; an empty change list is valid
only for equal state content.

## 9. Builder and verifiers

The builder accepts one explicit Claim and candidate point set, validates closed
shapes and ClaimVersion ownership, authenticates all required/declared facet
projections, canonicalizes each state, computes state hashes, orders by
knowledgeAt, derives transitions, canonicalizes the envelope, and computes the
timeline hash. It has no database, current-state lookup, implicit time, or
repair capability.

The write verifier repeats structural, identity, timestamp, strict-order,
historical-binding, state canonical/hash, transition parity, cardinality,
version, and envelope hash checks. It accepts only a complete authenticated
projection and returns a branded write value.

The read verifier retrieves exact analysis ID data, reconstructs every point and
facet in explicit semantic order, authenticates all upstream references, and
replays canonicalization, hashes, equality, cardinality, ordering, and
transitions independently. It never writes, sorts-and-persists, deduplicates,
repairs, or enriches from current state.

Validation precedence is: point/analysis absence; unsupported or malformed
version/shape; missing historical prerequisite; Claim/ClaimVersion mismatch;
duplicate identity/membership; invalid knowledgeAt or equal-time ambiguity;
historical identity/version/hash mismatch; state canonical/hash mismatch;
transition mismatch; timeline canonical/hash mismatch. This precedence is for
stable externally visible failure classification, not an implementation
mandate for SQL ordering.

## 10. Atomic persistence and logical schema plan

The write flow is: validate request; authenticate projections; build and verify
the complete bundle; begin one transaction; insert analysis root; insert points
and typed facet memberships; insert transition projection if chosen; persist
exact canonical/hash bytes; commit; exact read-back and read verification. Any
failure rolls back all RCV-019 rows.

Migration planning (after RCV-018, SQL not created here) uses the smallest
structural set:

- `rcv019_temporal_evidence_analyses`: PK analysisId; Claim FK; contract/version,
  canonical, timeline hash; immutable creation metadata outside hashes;
- `rcv019_temporal_evidence_points`: PK pointId; analysis FK; Claim and
  ClaimVersion FKs; knowledgeAt; state version/canonical/stateHash; unique
  `(analysisId, pointId)` and nonnegative ordinal;
- `rcv019_temporal_evidence_point_facets`: point FK; closed facet kind; exact
  referenced ID/version/hash; unique point/kind/reference and ordinal;
- `rcv019_temporal_evidence_transitions`: analysis FK; from/to point FKs;
  adjacent ordinal and canonical change list, with unique pair;

All foreign keys use established NO ACTION behavior. Structural uniqueness,
non-nullability, closed literals, UTC timestamp shape, and hash format belong
in SQL where representable. Strict temporal ordering, canonical parity,
historical authentication, and transition semantics remain verifier-owned.
Updates/deletes are prohibited using the established append-only pattern;
repository operations are insert-only and never UPSERT or repair.

Correctness indexes only: analysis by Claim, points by analysis/ordinal,
unique point ID, and facet lookup by point/kind/reference. No speculative
performance index is proposed.

## 11. Read/write and late-arrival flows

Read queries use exact analysis ID and explicit `ORDER BY` for transport only;
the verifier rejects gaps, duplicates, or non-canonical order. A late-arriving
1980 event learned in 2026 retains event/retrieval metadata in its facet and is
added only to a new point whose knowledgeAt is 2026. Existing rows and hashes
remain untouched.

## 12. Numeric and runtime safety

Ordinals and counts are bounded implementation values; TypeScript accepts only
safe non-negative integers and PostgreSQL uses the repository's established
integer/bigint conversion discipline. No global parser changes are needed.
The design has no executable derivation language or external runtime: runtime
boundary and hidden external input are therefore not applicable. Canonical and
hash computation reuses `canonicalJson`, `rcv016Canonical`, and `rcv018Canonical`
patterns only after auditing field boundaries; RCV-016/018 semantic canonical
wrappers are not reused for RCV-019 objects.

## 13. Test architecture (design targets only)

Tests must cover Contract vectors; knowledgeAt validation/round-trip; point and
state identity; repeated equal states; equal-time failure; late arrival;
canonical/hash vectors and boundary corruption; every transition and
multi-change ordering; ClaimVersion and facet authentication; current-state
independence; write atomicity; read projection parity; read verification and
no-repair; failure precedence; migration/constraint replay; and integration
RCV-009→019 plus the future RCV-020 traceability shape. Structured fuzz,
stress, replay, soak, and disposable corruption clones are required for the
later robustness phase, not this design phase.

## 14. Deterministic fixture and adversarial plan

The minimal fixture is one Claim with four or five points: initial state,
supporting evidence addition, contradiction introduction, dependency-gap
resolution, and an unchanged repeated state; a late-arriving historical event
metadata example is included without changing its historical date. Every point
has explicit deterministic knowledgeAt and exact upstream IDs/hashes.

Future corruption cases include duplicate point ID, duplicate/equal knowledgeAt,
wrong ClaimVersion, state/canonical/hash mismatch, missing or wrong facet,
transition/timeline hash mismatch, and attempted current-state substitution.
Each must fail closed and leave persisted bytes/rows unchanged.

## 15. Scale and handoff

Measure points per timeline, facet bindings per point, optional findings per
point, and change types per adjacent pair at legal implementation limits. Do
not establish arbitrary Contract maxima here. Correctness and deterministic
hash/order stability precede performance observations.

The physical design preserves `source → Claim → analysis → point →
ClaimVersion → authenticated state → evidence/artifact → optional analyses`.
Source-profile aggregation and all scoring remain outside RCV-019.

## 16. Implementation order

1. Confirm Contract and prior schema authority; record no semantic changes.
2. Add closed domain types and timestamp/ID validation.
3. Add state canonicalization/hash wrappers and equality projection.
4. Add historical-state assembler and typed facet authentication.
5. Add transition derivation and timeline builder.
6. Add write verifier and branded projection.
7. Implement the post-RCV-018 migration and structural constraints.
8. Implement the atomic repository.
9. Implement exact read repository, read service, and independent read verifier.
10. Wire application orchestration with post-write read verification.
11. Add focused contract/integration tests, then robustness tests.
12. Perform RCV-009→019 handoff and later RCV-020 traceability checks.

## 17. Design self-audit

Contract-required decisions are: Claim subject, ClaimVersion-per-point,
knowledgeAt producer/immutability, point/state identity separation, strict
ordering and ambiguity failure, authenticated state, state-plus-delta output,
closed transitions, canonical/hash/version boundaries, no repair, and current-
state independence. Typed facet tables, a timeline hash, repository layering,
and the listed indexes are implementation choices directly serving those
requirements. No score, truth, ranking, fallback, or unbounded generic binding
is justified. No prior RCV contract, schema, hash rule, or historical authority
is changed.
