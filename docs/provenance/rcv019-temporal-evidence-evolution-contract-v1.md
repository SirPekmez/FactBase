# RCV-019 Temporal Evidence Evolution Contract V1

## 1. Purpose and scope

RCV-019 defines a deterministic, historically authenticated timeline of
documented evidence states for one Claim and deterministic descriptive
transitions between successive authenticated states. It describes how the
documented evidence state changed; it does not determine truth.

FactBase's North Star remains: make the demonstrated support for a claim
transparent, reproducible, and traceable.

## 2. Non-goals and boundaries

RCV-019 does not define a truth timeline, truth score, source trustworthiness,
source rank, source score, evidentiary superiority, newer-is-better semantics,
more-sources-is-stronger semantics, or any claim that a contradiction or
missing evidence establishes falsity. It does not overwrite current or
historical state, silently deduplicate occurrences, invent temporal order, or
use current mutable state as historical authority.

## 3. Subject and point identity

One timeline concerns exactly one `Claim` identified by its RCV-009 Claim ID.
Every point binds exactly one ClaimVersion ID, and that ClaimVersion must
belong to the timeline Claim. Claim ID does not erase ClaimVersion history.

Each point has two separate identities:

- `pointId`: immutable identity of one timeline occurrence;
- `stateHash`: identity of the canonical state content.

`stateHash` is not an occurrence identity. Equal state hashes are allowed at
different points and never cause deduplication. Duplicate `pointId` values are
invalid.

## 4. Knowledge time

`knowledgeAt` is an explicit canonical timestamp assigned exactly once by the
authorized RCV-019 point-creation/write path. It means the time from which the
complete authenticated state represented by that point is recorded as part of
FactBase's documented knowledge history.

`knowledgeAt` is explicit, validated, canonical, immutable, included in the
state and timeline canonical/hash material, and replayed exactly as persisted.
No database default, transaction time, current clock, or upstream timestamp
may supply it.

`knowledgeAt` is not publication time, external event time, statement
`observedAt`, `validFrom`, `validTo`, evidence retrieval or creation time,
ArtifactVersion creation time, ClaimVersion creation time, assessment time,
derivation time, analysis time, binding persistence time, or replay time.

Historical event time and FactBase knowledge time remain distinct. Evidence
learned later about an earlier event creates a later point with its own
`knowledgeAt`; earlier points remain immutable and the original event,
observation, and validity metadata remain visible.

## 5. Temporal ordering

Within one valid timeline, points are ordered only by strictly increasing
`knowledgeAt`. `pointId`, UUID, `stateHash`, database insertion order, row
order, analysis ID, retrieval order, and lexicographic identity are forbidden
as temporal tie-breakers.

If distinct points for one Claim have equal `knowledgeAt` and no authenticated
ordering relation exists, verification fails closed with
`AMBIGUOUS_TEMPORAL_ORDER`. The verifier must not guess.

## 6. Authenticated historical state

Each point contains a complete canonical, versioned, hash-addressed,
historically immutable, replayable state. It must bind:

- RCV-009 Claim and ClaimVersion identity;
- RCV-010 evidence and provenance identities;
- an authenticated RCV-016 historical provenance state.

RCV-011, RCV-013, RCV-014, RCV-015, RCV-017, and RCV-018 facets are optional.
If a facet is included, its exact historical identity, version, and hash must
authenticate. An omitted optional facet is not invalid unless the point
declares it as part of its state.

Current mutable rows can never replace an authenticated prerequisite.

## 7. State and transitions

State is authoritative historical content. A transition is a deterministic
derived comparison between two successive valid points; it is not an
independent historical fact and cannot exceed the demonstrated state
difference.

The V1 transition vocabulary is closed to:

- `SUPPORTING_EVIDENCE_ADDED`;
- `CONTRADICTING_EVIDENCE_ADDED`;
- `DEPENDENCY_GAP_INTRODUCED`;
- `DEPENDENCY_GAP_RESOLVED`;
- `CONTRADICTION_INTRODUCED`;
- `CONTRADICTION_RESOLVED`;
- `ASSESSMENT_CHANGED` (only when an authenticated assessment facet is
  present in both compared states);
- `UNCHANGED`.

Each transition is emitted only when its corresponding authenticated facet
shows the exact pre/post difference. If the required facet is absent, the
transition is not applicable; absence is never interpreted as a negative fact.

One adjacent pair may emit multiple transition kinds. The transition output is
an ordered list, sorted by the closed vocabulary order stated above, and is
empty only when the states are equal. Each kind is emitted independently from
its own authenticated facet; no dominant transition suppresses another.

`ASSESSMENT_CHANGED` means that the authenticated assessment facet differs in
identity, response set, rubric identity/version, or other Contract-defined
assessment content. It never means that evidence became better, worse, true,
or false. `CONTRADICTION_INTRODUCED` and `CONTRADICTION_RESOLVED` are exact
RCV-018 finding-set differences: a finding identity absent before and present
after, or present before and absent after. `DEPENDENCY_GAP_INTRODUCED` and
`DEPENDENCY_GAP_RESOLVED` use the corresponding exact RCV-017 finding-set
difference. Disappearance of one finding while another remains is not a
general resolution of the whole facet.

`UNCHANGED` is valid when two distinct ordered occurrences have equivalent
authenticated state content. It is descriptive, derived, non-authoritative,
not a truth statement, and not deduplication.

## 8. State equality

Two states are equal exactly when their Contract-defined authenticated state
content is equal after canonicalization. `pointId` and `knowledgeAt` are
occurrence metadata and do not participate in state-content equality.
ClaimVersion identity, canonical envelope version, and every included optional
facet do participate. Optional facets absent from both states compare as absent;
an included facet cannot compare equal to an absent facet. Canonical member
ordering is part of equality. Equal state content therefore permits
`UNCHANGED` across distinct occurrences.

## 9. Canonicalization, hashing, and versioning

The state canonical field set is closed and versioned. It includes Claim and
ClaimVersion identities, complete authenticated state content, and the
versioned state envelope, but excludes occurrence-only `pointId` and
`knowledgeAt`. The occurrence/timeline canonical envelope separately includes
`pointId`, `knowledgeAt`, the state hash, ordered points, and ordered
transitions. Neither envelope contains environment, database-row-order,
insertion-order, or current-clock fields.

`stateHash` is computed only from the Contract-authorized canonical state
content and therefore does not identify an occurrence. A timeline/analysis
hash, if emitted, is computed only from its Contract-authorized canonical
envelope. Transition values are included in that envelope but are derived, not
independent historical facts. The hash algorithm is referenced from
the existing FactBase canonical/hash authority; this contract does not create
a competing algorithm.

The contract version is `RCV-019 V1`. Unknown versions fail closed. There is no
latest-version fallback.

## 10. Historical immutability and fail-closed behavior

Persisted `pointId`, `knowledgeAt`, Claim/ClaimVersion binding, historical
bindings, canonical content, hashes, and authenticated state are immutable.
Read, replay, and verification paths never repair them.

Semantic failure classes include:

`POINT_NOT_FOUND`, `MISSING_HISTORICAL_PREREQUISITE`,
`UNAUTHENTICATED_POINT`, `INVALID_CLAIM_VERSION_BINDING`, `DUPLICATE_POINT_ID`,
`INVALID_KNOWLEDGE_AT`, `AMBIGUOUS_TEMPORAL_ORDER`, `CANONICAL_MISMATCH`,
`HASH_MISMATCH`, `PARTIAL_HISTORICAL_BINDING`, `CURRENT_STATE_SUBSTITUTION`,
`UNSUPPORTED_VERSION`, `UNSUPPORTED_STATE`, and `UNSUPPORTED_TRANSITION`.

## 11. Determinism and strength rule

The same authenticated points produce the same timeline; the same points
produce the same `knowledgeAt` ordering; the same ordering produces the same
transitions; the same state produces the same canonical bytes and hash.
Replay uses persisted `knowledgeAt` exactly. Repeated equivalent states remain
representable. Equal-time ambiguity fails closed.

The expected answer must never be stronger than the demonstrated historical
evidence. A transition may describe only differences directly demonstrated by
authenticated state comparison. Truth, falsity, trust, superiority, and
invented history are outside this contract.

## 12. Output envelope and cardinality

An RCV-019 output contains an analysis/timeline identity, `RCV-019 V1`, one
Claim ID, ordered authenticated points, derived transitions, and its canonical
and hash envelope.

Zero points is invalid because no timeline can be authenticated. One point is
valid and has zero transitions. Two or more points are valid only when their
`knowledgeAt` values are strictly increasing; each adjacent pair yields one
deterministic transition result, including `UNCHANGED` where applicable.

The output preserves traceability from source to Claim, timeline, point,
ClaimVersion, authenticated state, evidence/artifact, and optional downstream
analysis. Source-profile aggregation and numerical scoring are outside
RCV-019 and belong to a later RCV.

## 13. Non-normative example

In 1950, Point A enters documented knowledge history. In 1965, Point B adds
authenticated supporting evidence. In 1980, Point C adds an authenticated
contradiction. In 2005, Point D resolves an authenticated dependency gap. In
2026, Point E adds evidence whose external event metadata refers to an earlier
period. The timeline orders A–E by `knowledgeAt` while preserving the separate
external historical dates. It makes no claim that the newspaper statement
became true or false.
