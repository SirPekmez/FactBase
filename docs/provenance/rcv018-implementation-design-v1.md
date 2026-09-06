# RCV-018 Implementation Design V1

## Status and authority

**DESIGN STATUS: IMPLEMENTATION DESIGN V1**

This document records the reviewed implementation architecture for RCV-018. It
constrains implementation interfaces and responsibilities; it does not redefine
the frozen RCV-018 Contract, Implementation Guardrails, or migration. If a
conflict is found, the Contract, Guardrails, and frozen physical schema remain
authoritative for their respective responsibilities.

Frozen inputs are the Contract hash
`894266b120a00bde19e1e3b3c69e323d2e98c51e05351a651e392dbf1cb56cbe`, Guardrails
hash `0a69123cbdef5964dbb311513e2a7a43b68879cccd5211d9d503bec1ff9cd168`, and
migration hash
`ca0e02f5dd84b6ec6e0955ff36340bdba4a87ca66f087d406054f016798f22c1`.

## Component manifest

The minimum production set contains exactly eight TypeScript components. The
already-frozen migration is not an additional application component.

| Component | Responsibility and inputs/outputs | Boundary and exclusions |
|---|---|---|
| `rcv018EvidenceContradictionContractV1.ts` | Closed TypeScript representations, exact five vocabularies, primitive and closed-shape validation. Consumes unknown request data; returns validated immutable values or `REJECT_UNSUPPORTED` errors. | Pure; no I/O, persistence, inference, canonicalization authority, or repair. |
| `rcv018Canonical.ts` | RFC-8785/JCS canonicalization and exact UTF-8 SHA-256 for the frozen semantic objects. Consumes validated semantic objects; returns raw Canonical and hash. | Pure deterministic utility; it computes bytes but is not an independent semantic authority. |
| `rcv018AnalysisBuilder.ts` | Validates the finite explicit historical assertion set, authenticates supplied domains/provenance inputs, orders members, evaluates every unordered pair once, derives findings, and emits an immutable analysis and write projection. | Pure; no database, network, current/latest lookup, free-text extraction, repair, fallback, or ranking. |
| `rcv018WriteVerifier.ts` | Authenticates Builder output and explicit prerequisite projections: closed shapes, Canonical/hash parity, identity/version/hash uniqueness, cross-object parity, C1 typed statement resolution, evidence relational parity, all-pairs replay, and complete finding set. Emits an authenticated write projection. | Pure; no database/repository handle, network, mutable global state, writes, repair, or implicit queries. |
| `rcv018PostgresRepository.ts` | Persists only an authenticated projection in one parameterized atomic transaction; checks concrete prerequisite existence and inserts new findings and analysis memberships in dependency order. | I/O-bound only; no semantic interpretation, sorting, normalization, overwrite, UPSERT, repair, or implicit retry. |
| `rcv018PostgresReadRepository.ts` | Exact-analysis-ID, read-only retrieval of the raw parent, memberships, child rows, Canonicals, hashes, and explicitly requested historical projections. | I/O-bound; no current/latest query, reconstruction, deduplication, renumbering, or verification authority. |
| `rcv018ReadVerifier.ts` | Independently verifies the raw persisted bundle, historical provenance, C1 identity, Canonical/hash parity, scope/membership/order, and deterministic complete replay. | Pure; no database handle, writes, repair, fallback, normalization, or current-state substitution. |
| `rcv018ApplicationService.ts` | Thin public orchestration for `buildAnalysis`, `writeAnalysis`, and `verifyAnalysis`. Returns success only after post-write verification. | No semantic enrichment, SQL, inference, retry policy, or bypass of either verifier. |

No separate pair-selection service or symmetry-only component exists.

### Component dependency and failure contract

The dependency direction is one-way: Contract types and Canonical utilities are
used by Builder and both verifiers; Builder output is consumed by Write-Verifier;
the authenticated projection is consumed by the Repository; the raw bundle is
consumed by Read-Verifier; Application Service delegates to these components.
No component calls a later layer.

- The Contract module accepts unknown values and emits frozen validated values;
  invalid shape, primitive, vocabulary, or provenance is `REJECT_UNSUPPORTED`.
- Canonical accepts only validated semantic objects and emits exact Canonical
  text plus SHA-256; malformed input is rejected and no bytes are normalized.
- Builder accepts an explicit assertion set plus authenticated domain,
  historical-binding, and algorithm inputs; it emits an immutable analysis,
  findings, and persistence projection or rejects the entire build. Its output
  is deterministic for identical inputs and it performs no I/O.
- Write-Verifier accepts Builder output and explicit immutable prerequisite
  projections; it emits a branded authenticated write projection or rejects it.
  It owns semantic validation but no transaction or historical lookup.
- PostgreSQL Repository accepts only that branded projection and prerequisite
  identity checks; it returns committed identity/result or a rolled-back
  persistence error. Its sole transaction is the write I/O boundary.
- Read Repository accepts one validated analysis ID and returns one raw
  historical bundle or absence. It performs exact-ID read I/O only.
- Read-Verifier accepts the raw bundle and explicit historical projections and
  emits a verified historical result or a typed integrity failure. It owns no
  database or repository dependency.
- Application Service accepts public build/write/verify requests and delegates
  in the permitted sequence; it returns a verified result only after all
  required stages succeed. It owns no semantic or transaction decisions.

All failures are fail-closed: invalid or unverifiable state rejects, repository
transactions roll back, and no layer repairs, retries semantically, or turns a
duplicate or missing result into success.

## Authority and operation sequence

The database is not a semantic authority. PostgreSQL supplies only structural
constraints, PK/FK integrity, uniqueness, local primitive checks, ordinal
non-negativity, and atomic persistence. Contradiction generation, UNRESOLVED
derivation, comparison, incompatibility, Canonical reconstruction, all-pairs
evaluation, C1 family resolution, current/latest selection, and repair remain
application/verifier responsibilities.

The permitted write sequence is:

1. Validate the public request boundary.
2. Obtain exact prerequisite and historical projections.
3. Build the deterministic complete analysis.
4. Run pure Write-Verifier authentication.
5. Persist the authenticated projection in one atomic repository transaction.
6. Read the exact persisted analysis and run independent Read-Verifier
   authentication.
7. Return the verified application result.

The repository never receives an unauthenticated semantic projection, and
post-write verification never substitutes for pre-write verification.

## C1 typed statement identity

`StatementRefV1` is exactly `{ statementKind, statementId }`, where
`statementKind` is one of `ArtifactProvenanceStatement`,
`SourceRelationshipStatement`, `ArtifactSourceAttribution`,
`EvidenceArtifactBinding`, or `KnowledgeStateStatement`, and `statementId` is a
`LowercaseUuidV1`. The pair is the identity; `statementId` alone is never used.

The verifier maps each kind to exactly one frozen RCV-016 family and checks only
that family. It never searches the five families, applies precedence, consults
current/latest state, or falls back. A missing, invalid, unsupported, or
semantically unverifiable selected-family row is rejected. The SQL projection
uses `statement_kind` and `statement_id`; no polymorphic FK, registry, dynamic
FK emulation, or table-name semantic field exists. The typed identity is part of
EvidenceAssertion Canonical/hash through its evidence basis and historical
bindings; higher-level Canonicals bind it transitively through assertion hashes.

## Closed unions and historical bindings

Assertion context has exactly two variants. UUID requires `uuidValue` and
forbids `tokenValue`; TOKEN requires a valid TokenV1 `tokenValue` and forbids
`uuidValue`. Construction, serialization, projection, and read verification
preserve the discriminator exactly; coercion is forbidden.

HistoricalBindingV1 has exactly `CLAIM_VERSION`, `STATEMENT`,
`ARTIFACT_VERSION`, `RCV016_SNAPSHOT`, and `RCV017_ANALYSIS` variants. Each
variant has only its Contract-defined fields; STATEMENT uses the typed C1 pair.
Arrays are non-empty, ordinalized, duplicate-free, and canonically ordered.
Partial uniqueness is enforced by the migration and semantic identity is
rechecked by both verifiers. Upstream rows are authenticated as historical
records, never replaced by future mutable state.

## Deterministic analysis and finding computation

The Builder accepts one finite, explicit, historically bound,
duplicate-free, deterministically ordered assertion set. If its size is `N`, it
evaluates exactly `N * (N - 1) / 2` unordered pairs, once each. Invalid members
reject the complete analysis; no caller-selected subset or heuristic omission
is possible.

Each pair authenticates its domains and context before comparability. A valid
same-domain pair uses only the explicit binary symmetric
`EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR` rule. Explicit pair proof yields
`INCOMPATIBILITY_PROVEN`; absence yields `INCOMPATIBILITY_NOT_PROVEN`.
`CONTRADICTION` is derived only from comparability plus proven incompatibility;
every V1 contradiction is derived `UNRESOLVED`. No probability, confidence,
quality, truth, ranking, winner, or evidence-strength semantics are introduced.

Findings use normalized participant order, non-redundant Canonical, and
`findingHash` as semantic identity. Existing findings must match the expected
Canonical/hash and semantic fields exactly. A mismatch fails; it is never
overwritten, repaired, or silently replaced. New findings may be inserted in
the analysis transaction; a concurrent unique conflict rolls back the
transaction and fails.

## Analysis envelope and persistence

The persisted envelope freezes `analysisId`, exact assertion identity/hash
memberships, consumed ValueDomain and ComparisonDomain identity/version/hash
memberships, closed contract and algorithm bindings, exact assertion child
data, and the complete contradiction finding-hash set. Repeated arrays retain
their normative order and duplicate rules. The contract and algorithm bindings
are supplied as exact closed identity/version/hash tuples; runtime, deployment,
machine, timestamp, and database metadata are excluded.

Captured at write time: all authenticated semantic objects, raw Canonicals,
hashes, provenance projections, membership ordinals, and finding identities.
Read back as persisted: exactly those rows and raw bytes, with no projection
repair. Replay-verified: domain parity, provenance parity, all unordered pairs,
and the complete finding set. Forbidden to re-derive: meaning from current,
latest, live, or alternate-family state.

## Repository projections and transactions

The write projection contains every persisted semantic field and raw Canonical
needed by the frozen 15-table schema; database-generated names and physical
constraint identifiers remain repository-internal. Normative ordering fields
are child ordinals and the ordered semantic arrays. SQL `ORDER BY ordinal` is
transport stability only; verifiers reject gaps, duplicates, or non-canonical
ordering.

Global ValueDomains, ComparisonDomains, and EvidenceAssertions are immutable
authenticated prerequisites. ContradictionFindings are global immutable
artifacts, reusable by hash. Analyses and membership rows are analysis-scoped.
The repository performs no semantic UPDATE or DELETE operation. All FK actions
remain NO ACTION, and no operation uses insert-ignore, UPSERT, overwrite,
repair, or implicit retry.

The public application operations are exactly `buildAnalysis`, `writeAnalysis`,
and `verifyAnalysis`. Build requires a complete explicit historical input set;
write requires a branded Write-Verifier result and authenticated prerequisites;
verify requires an exact analysis ID. `writeAnalysis` owns no transaction
itself: the PostgreSQL Repository owns the single atomic transaction. A write
response is successful only after exact read-back and Read-Verifier success.

## Read and failure taxonomy

The Read Repository returns an exact-ID raw bundle containing the analysis,
all memberships, referenced assertions and children, domains and children,
findings, Canonicals, hashes, and historical projections needed for parity.
The Read-Verifier reports distinct failures for missing, malformed,
inconsistent, historically unverifiable, version-mismatched, hash-mismatched,
unexpected, duplicate, and incorrectly ordered data. Structural or integrity
failures are `REJECT_UNSUPPORTED`; valid semantic domain differences remain
`NOT_COMPARABLE`.

## Future test architecture

Tests are design targets only and are not created here:

- semantic/unit tests: exact closed shapes, primitives, vocabularies, Canonical
  and hash rules;
- deterministic Builder tests: ordering, singleton/empty domains, all-pairs
  counts, pair symmetry, and finding determinism;
- adversarial Builder tests: duplicates, omissions, invalid provenance, C1
  collisions, and forbidden inference;
- Write-Verifier tests: supplied historical projections, parity, replay, and
  authenticated-write branding;
- repository integration tests: atomic insertion, FK/unique behavior, rollback,
  and no duplicate-as-success;
- Read-Verifier corruption tests: raw-byte, membership, ordinal, hash,
  historical, and complete-result corruption;
- Application-Service tests: orchestration order and verifier bypass
  prevention;
- end-to-end historical tests: exact-ID read-back, replay, and independence
  from later current-state additions.

## Adversarial responsibility matrix

| Attack | Detecting layer | Required outcome |
|---|---|---|
| Same UUID in different statement families | Write-/Read-Verifier C1 resolver | Selected kind only; no ambiguity or alternate search |
| Missing historical prerequisite | Write-Verifier with supplied projection; repository existence check; Read-Verifier | `REJECT_UNSUPPORTED` |
| Upstream row changed after creation | Read-Verifier historical parity | Reject; never reinterpret current state |
| Duplicate binding with another ordinal | Builder/verifiers plus partial unique index | Reject |
| Malformed UUID/TOKEN union | Contract validator, Builder, verifiers, DB XOR check | Reject |
| Invalid version or hash | Contract validator, verifiers, DB local checks | `REJECT_UNSUPPORTED` |
| Domain version/hash drift | Write-/Read-Verifier identity parity | Reject, never `NOT_COMPARABLE` |
| Finding outside assertion membership | Write-/Read-Verifier complete scope replay | Reject |
| Duplicate analysis membership | Builder/verifiers and DB unique constraint | Reject |
| Order-dependent nondeterminism | Builder canonical ordering and verifiers | Reject non-canonical input/state |
| DB-valid but semantically unverifiable state | Read-Verifier | Reject |
| Silent repair or sorting | Builder/verifiers/repository guardrails | Forbidden; reject |
| Retry after partial failure | Repository rollback; application caller only | Transaction fails; no implicit retry |
| Current/latest read path | Read Repository query boundary | Forbidden; exact-ID only |

## Non-regression and change control

No semantic modification of RCV-014, RCV-015, RCV-016, or RCV-017 is required.
Future defects require explicit proof, impact and regression analysis, the
smallest correction, approval, and new artifact hashes/review. Implementation
convenience is not grounds for changing frozen semantics.

**IMPLEMENTATION DESIGN V1 REVIEWED: YES**
**IMPLEMENTATION DESIGN FREEZE CANDIDATE: YES**
**IMPLEMENTATION READY: NO**
