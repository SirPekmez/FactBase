# Claim-Level Evidence View Technical Design V1

Design status: DRAFT FOR REVIEW

This Design specifies how the First Slice of the Claim-Level Evidence View
Contract can be implemented. The Contract is the semantic authority. This
Design adds no semantic authority, schema object, persistence model, or
meaning beyond that Contract and the frozen RCV-022 authorities.

## 1. Design boundary

The First Slice is one deterministic read-time projector/verifier:

```text
ViewSpec
  -> structural validation and canonical ordering
  -> one repeatable-read, read-only historical transaction
  -> independent exact-reference re-authentication
  -> closed occurrence enumeration
  -> unique Assessment projection and occurrence projection
  -> scope-relative result
```

No database table, column, index, trigger, foreign key, persisted view,
execution receipt, cache authority, dynamic snapshot, scheduler, policy
engine, plugin registry, or generalized aggregation framework is required.

The projector returns a result only after the complete scoped graph has been
authenticated. It never calculates a score, chooses a relation, ranks a
method, or derives contradiction across Envelopes.

## 2. Storage and module decision

The implementation has the following storage impact:

```text
NEW_TABLE_COUNT = 0
NEW_COLUMN_COUNT = 0
NEW_INDEX_COUNT = 0
NEW_TRIGGER_COUNT = 0
NEW_FK_COUNT = 0
NEW_PERSISTED_AUTHORITY_COUNT = 0
```

The smallest production boundary is one module, following the existing
service convention:

```text
src/services/claimLevelEvidenceView.ts
```

That module owns ViewSpec validation, transaction orchestration, independent
historical verification, deterministic projection, and result construction.
It does not become a policy engine or a reusable registry. A future
implementation MAY place private pure helpers in the same module; no helper
hierarchy is required by this Design.

## 3. Technical input shape

The conceptual input is:

```ts
type ClaimVersionRef = {
  claimVersionId: string;
  canonicalVersion: number;
  canonicalHash: string;
};

type EnvelopeRef = {
  envelopeId: string;
  canonicalVersion: number;
  canonicalHash: string;
};

type AssessmentRef = {
  assessmentId: string;
  canonicalVersion: number;
  canonicalHash: string;
};

type MatchRef = {
  matchId: string;
  canonicalVersion: number;
  canonicalHash: string;
};

type FragmentRef = {
  fragmentId: string;
  canonicalVersion: number;
  canonicalHash: string;
};

type ClaimLevelEvidenceViewSpec = {
  claimVersionRef: ClaimVersionRef;
  envelopeManifest: readonly EnvelopeRef[];
  contractVersion: 1;
};
```

`claimVersionId`, `envelopeId`, and all authority IDs use the repository's
canonical lowercase UUID syntax. Canonical versions and canonical hashes use
the frozen RCV-022 version and lowercase SHA-256 syntax. The Claim identity is
authenticated transitively from the ClaimVersion authority; it is not a
second, independently selectable subject.

There is no cutoff, SnapshotRef, AnalysisRunRef, AdmissionPolicyVersion, or
separate ProjectionVersion in this First-Slice input.

## 4. ViewSpec normalization

ViewSpec validation occurs before database reads:

1. Validate the exact object shape and `contractVersion`.
2. Validate the ClaimVersion reference ID, version, and hash syntax.
3. Validate every Envelope reference ID, version, and hash syntax.
4. Treat `envelopeManifest` as a set. An exact duplicate Envelope identity is
   a malformed ViewSpec; it is not silently deduplicated. Conflicting version
   or hash references for one Envelope identity are also malformed.
5. Canonicalize the manifest order by the tuple
   `(envelopeId, canonicalVersion, canonicalHash)`.

The comparator is byte/string lexicographic for canonical lowercase UUID and
hash text, with numeric comparison for the canonical version. It is locale
independent and does not use object insertion order, caller order, or database
row order. Caller order is therefore accepted as input presentation only; it
does not change ViewSpec meaning or result identity.

An empty manifest is valid under the frozen Contract. It produces an empty
AssessmentManifest, an empty OccurrenceManifest, an empty EnvelopeProvenance
collection, and the explicit scope-relative enumeration status. It does not
mean absence of evidence, `UNRELATED`, `INSUFFICIENT`, `REFUTES`, exhaustive
research, or global completeness.

## 5. Independent historical re-authentication

The module MUST NOT call the RCV-022 Reader's `verified: true` result as its
semantic oracle. It performs the following chain inside one transaction.

### 5.1 Target ClaimVersion

Load the exact ClaimVersion authority named by `claimVersionRef`, verify its
canonical version/hash, canonical bytes, identity, and parent Claim authority.
Any failure prevents result construction.

### 5.2 Each scoped Envelope

For each normalized EnvelopeRef, in canonical manifest order:

1. Load the exact Envelope row by `envelopeId`.
2. Require exactly one row and match its persisted version/hash to the ref.
3. Parse and validate the persisted canonical Envelope object.
4. Recompute and compare canonical bytes and SHA-256 hash.
5. Compare relational projections with canonical scalar and array fields.
6. Load both support projections ordered by `ordinal` and require exact parity
   with canonical `matchRefs` and `assessmentRefs`.
7. Require contiguous zero-based ordinals, unique identities, Assessment-to-
   Match closure, and exact target ClaimVersion binding.
8. Retain the immutable Envelope provenance needed for the result, including
   its exact reference, cutoff, analysis time, and analysis-method identity,
   version, and hash.

The Envelope's `analysisCutoffAt` is read and preserved with its frozen
Envelope-local eligibility-boundary meaning. It is never used to select an
Envelope.

### 5.3 Each Assessment occurrence

For each AssessmentRef in each authenticated Envelope, in persisted ordinal
order:

1. Load the exact Assessment authority by ID.
2. Verify its canonical version/hash, canonical bytes, identity, relation,
   timestamp, and embedded MethodProvenance shape.
3. Re-authenticate the referenced Match by exact ID/version/hash.
4. Re-authenticate the Match's Claim, ClaimVersion, Fragment, matcher identity,
   and opaque matcher input commitments.
5. Re-authenticate the Fragment's Capture authority, representation hashes,
   locator/content-binding constraints, and extraction authority.
6. Verify the Assessment's transitive Claim, ClaimVersion, Match, and Fragment
   fields exactly match the authenticated Match and Fragment.
7. Verify the Assessment's MethodProvenance commitments exactly as persisted;
   no provider, model, tool, or current method lookup is permitted.
8. Require the Assessment's Match to occur exactly once in that Envelope's
   authenticated `matchRefs`.

Only after every scoped occurrence and every transitive dependency succeeds
may the module construct a ViewResult.

## 6. Reuse and independence boundary

| Existing capability | Design classification |
|---|---|
| RFC-8785/JCS and UTF-8 SHA-256 primitives from `canonicalJson` | ALLOWED LOW-LEVEL PRIMITIVE |
| UUID, version, hash, timestamp, and closed-token syntax checks | SAFE GENERIC VALIDATOR |
| RCV-022 canonical builders, if used to reconstruct persisted canonical bytes and then compared with stored bytes/hash | SAFE CANONICAL RECONSTRUCTION ONLY; builder output alone is never verification |
| Exact-ID row loading and projection comparison patterns | SAFE AUTHORITY-FETCH PATTERN, subject to independent implementation |
| `verifyRcv022HistoricalEnvelope` / `verifyRcv022HistoricalEnvelopeWithinTransaction` as the View's proof | SEMANTIC ORACLE — PROHIBITED |
| Writer admission functions or Writer success | SEMANTIC ORACLE — PROHIBITED |
| Current Claim, matcher, provider, model, tool, scheduler, Operation, or Run state | PROHIBITED |

The First Slice does not require a new shared primitive. If implementation
duplication is later demonstrated to be unsafe, extraction of a generic
canonical/hash or failure-selection primitive is an implementation refactor;
it must not move semantic authority into the Writer or make the Reader the
View oracle.

## 7. Query strategy

All database access is exact-reference access derived from the normalized
ViewSpec or from an already authenticated authority. The module MUST NOT scan
all Envelopes for a ClaimVersion, search for the latest row, discover by
cutoff, scan all Assessments for relevance, or query a database-wide candidate
set.

The implementation MAY batch exact IDs for efficiency. Batched rows MUST be
placed in Maps keyed by their immutable IDs and processed in canonical
Envelope/ordinal order. Database return order is never semantic. Chunking a
batch at a driver parameter limit is allowed only as a technical detail and
must not change failure precedence or result ordering. Pagination is not a
semantic feature of this First Slice.

## 8. Transaction and concurrency model

The module opens one caller-independent historical read transaction using:

```text
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
```

It performs SELECT-only reads and commits after successful projection. On
failure it rolls back the read transaction. It requests no row locks and has
no INSERT, UPDATE, DELETE, DDL, repair, or normalization path.

The stable snapshot ensures that all explicitly referenced authorities are
observed consistently. New unrelated Envelopes do not affect the result
because they are outside the closed manifest. Existing RCV-022 immutability
guards prevent valid persisted authorities from being changed or deleted; a
corrupted persisted row is read as-is and fails closed.

## 9. Whole-view fail-closed flow

The module uses private temporary in-memory structures during verification:

```text
normalized ViewSpec
authenticated Envelope records
authenticated occurrence records
unique Assessment map
failure candidates
```

No externally visible AssessmentManifest, OccurrenceManifest, or partial
ViewResult is returned while verification is in progress. If any scoped
authority fails, the temporary structures are discarded and one deterministic
failure is raised. A successful ViewResult is constructed only after all
occurrences and all transitive authorities authenticate.

## 10. Result projection

The conceptual result is:

```ts
type AssessmentProjection = {
  assessmentRef: AssessmentRef;
  claimEvidenceMatchRef: MatchRef;
  evidenceFragmentRef: FragmentRef;
  claimVersionRef: ClaimVersionRef;
  relation: "SUPPORTS" | "REFUTES" | "INSUFFICIENT" | "UNRELATED";
  rationale: string;
  methodProvenance: Readonly<Record<string, unknown>>; // exact authenticated RCV-022 object; no redesign here
  assessedAt: string;
};

type AssessmentOccurrence = {
  envelopeRef: EnvelopeRef;
  assessmentRef: AssessmentRef;
  ordinal: number;
};

type EnvelopeProvenance = {
  envelopeRef: EnvelopeRef;
  claimVersionRef: ClaimVersionRef;
  analysisCutoffAt: string;
  analysisAt: string;
  analysisMethodIdentity: string;
  analysisMethodVersion: string;
  analysisMethodHash: string;
};

type ClaimLevelEvidenceViewResult = {
  claimVersionRef: ClaimVersionRef;
  assessmentManifest: readonly AssessmentProjection[];
  occurrenceManifest: readonly AssessmentOccurrence[];
  envelopeProvenance: readonly EnvelopeProvenance[];
  scopeEnumeration: {
    scopeKind: "EXPLICIT_ENVELOPE_SET";
    status: "ENUMERATED_AND_CONSIDERED";
  };
};
```

These are technical conceptual types, not persisted schema. The
AssessmentManifest contains one entry per unique authenticated Assessment
identity, keyed by `assessmentId`. Its canonical version and hash are
authentication commitments for that identity, not a second identity key. All
occurrences of one `assessmentId` must authenticate to the same version/hash;
a conflicting reference is a verification failure, never a second Assessment
entry. The manifest is not deduplicated by content, relation, Match, or
MethodProvenance. The OccurrenceManifest contains one entry per actual
Envelope membership and is never deduplicated across Envelopes.

The projection exposes no aggregate relation, score, rank, confidence, winner,
preferred method, or preferred Assessment. Counts are not mandatory; callers
may derive descriptive counts from the returned manifests.

## 11. Deterministic projection order

The module uses these exact orders:

1. EnvelopeProvenance and the Envelope portion of OccurrenceManifest: exact
   Envelope reference tuple `(envelopeId, canonicalVersion, canonicalHash)`;
2. AssessmentManifest: exact Assessment reference tuple
   `(assessmentId, canonicalVersion, canonicalHash)`;
3. OccurrenceManifest within that Envelope order: ascending persisted ordinal.

Canonical UUID/hash strings compare bytewise/lexicographically and versions
compare numerically. Locale collation, database row order, insertion order,
object iteration, method type, relation, timestamp, and content are never
comparators. These orders are reproducibility mechanisms only.

## 12. Failure model and precedence

The ViewSpec has only the minimum additional structural failure concepts:

- malformed ViewSpec or reference shape;
- duplicate or conflicting EnvelopeRef in the closed manifest;
- target ClaimVersion mismatch between ViewSpec and a scoped Envelope.

Underlying RCV-022 failure codes remain authoritative for historical
verification, including `MISSING_AUTHORITY`, `UNSUPPORTED_VERSION`,
`MALFORMED_DATA`, `IDENTITY_MISMATCH`, `LINEAGE_MISMATCH`,
`CANONICAL_MISMATCH`, `HASH_MISMATCH`, `CLAIM_SCOPE_MISMATCH`,
`METHOD_AUTHORITY_MISMATCH`, `INVALID_RELATION`, and related frozen classes.

Failure selection is deterministic:

1. reject malformed ViewSpec before opening the database transaction;
2. within a valid ViewSpec, collect failures from exact historical checks;
3. select the highest frozen RCV-022 precedence class;
4. break same-class ties by UTF-8/lexicographic `(path, code, message)` after
   path has been prefixed with canonical Envelope order and occurrence ordinal.

The result is independent of caller order, batch boundaries, SQL row order,
and first-detected error order. No failure is converted into an exclusion or
partial result.

## 13. Empty and repeated cases

The projector handles these cases without semantic inference:

- zero Envelopes: valid empty scope and empty manifests;
- one zero-Match/zero-Assessment Envelope: valid empty occurrence set;
- multiple empty Envelopes: valid, with their Envelope provenance preserved;
- mixed empty and non-empty Envelopes: valid, with only authenticated
  occurrences projected;
- one immutable Assessment in two Envelopes: one AssessmentManifest entry and
  two OccurrenceManifest entries with their separate Envelope refs/ordinals;
- repeated `SUPPORTS` or `REFUTES` occurrences: descriptive multiplicity only;
  no stronger relation, net relation, majority, or score is produced.

## 14. Current-state, clock, and repair rules

Allowed reads are immutable historical authorities explicitly required by the
RCV-022 closure: Claim and ClaimVersion authorities, RCV-022 authority rows,
RCV-022 membership projections, and the authenticated RCV-020 Capture rows
bound by the Fragment authority. Persisted RCV-019/RCV-021 context may be
validated only when an RCV-022 authority explicitly binds it through frozen
commitments; current RCV-019/RCV-021 state is never queried as a substitute.

Prohibited reads include current Claim state, mutable Claim metadata, source
or Capture configuration, matcher configuration, method configuration,
provider/model/tool state, Scheduler state, Operation/Run state, and current
normalization behavior.

The module may parse and compare persisted `assessedAt`, `analysisAt`, and
`analysisCutoffAt` values under their frozen canonical timestamp rules. It
must not call `Date.now`, `new Date()`, a current-time helper, SQL current
timestamp, or wall-clock logic for eligibility or projection.

No mutation SQL exists. The module never repairs hashes or canonical text,
rebuilds missing authority, changes references, normalizes ordinals, removes
duplicates by rewrite, or backfills history.

## 15. Service boundary and batching

The conceptual service boundary is:

```text
getClaimLevelEvidenceView(spec: ClaimLevelEvidenceViewSpec): Promise<ClaimLevelEvidenceViewResult>
```

The exact public export and dependency injection shape follow repository
conventions during implementation. Successful output is the complete result
above; failure returns no partial result. Exact-ID batches and in-memory Maps
are sufficient for the First Slice. No semantic pagination or user-visible
limit is defined. If operational resource limits are later required, they
must not silently change the semantic candidate universe and require separate
review if they can reject an otherwise valid scope.

## 16. Performance and concurrency constraints

Allowed optimizations are exact-ID batching, Map indexing, stable canonical
sorting, and avoiding repeated loads of the same immutable authority. Every
occurrence still receives its own binding and membership checks.

Prohibited shortcuts include latest-only selection, first-match selection,
early successful projection before full authentication, relation-count
shortcuts, method preference, and content-based deduplication.

A concurrently inserted Envelope not named by the ViewSpec cannot change the
result. A concurrently attempted mutation of an existing immutable authority
is rejected by frozen guards; a pre-existing corrupted row remains visible to
the repeatable-read transaction and fails closed. No new lock is required.

## 17. Contract-to-Design parity matrix

| Contract invariant | Technical mechanism | Data source | Failure/proof |
|---|---|---|---|
| One ClaimVersion | exact ClaimVersionRef and scope checks | Claim/ClaimVersion authorities | scope failure; target-binding proof |
| Explicit closed scope | normalize exact EnvelopeRef set | ViewSpec and Envelope authorities | malformed/duplicate scope proof |
| Closed candidates | canonical ordered `assessmentRefs` only | Envelope plus support projection | no-discovery proof |
| Whole-view fail-closed | temporary structures; publish only after all checks | all scoped authorities | invalid-member and multi-error proof |
| No exclusion policy | valid scoped items included; invalid scope fails | ViewSpec and authorities | no-ranking/no-drop proof |
| Identity/occurrence split | Map by `assessmentId`, enforcing one authenticated version/hash commitment, plus occurrence list | Envelope memberships | repeated-Assessment proof |
| Envelope cutoff meaning | copy persisted cutoff; never select by it | Envelope authority | cutoff counterexample |
| Scope-relative completeness | explicit structured status | closed manifest and verified refs | empty/mixed-scope proof |
| Provenance | exact refs and immutable descriptive fields | ClaimVersion, Capture, Match, Assessment, Envelope | lineage proof |
| MethodProvenance | preserve exact object; no comparator | Assessment authority | method-order proof |
| Relations | preserve four RCV-022 tokens | Assessment authority | mixed-relation proof |
| No cross-Envelope contradiction | no claim-level contradiction field or branch | occurrence projection | cross-Envelope proof |
| Descriptive counts only | no mandatory count fields | derived manifests | asymmetric-count proof |
| Non-weighting order | canonical tuple/ordinal comparators | persisted refs | permutation proof |
| Read-time only | SELECT-only transaction and ephemeral result | PostgreSQL snapshot | SQL/no-repair proof |
| Current-state independence | allowlist immutable historical reads | bound authority rows | runtime mutation proof |
| Current-clock independence | persisted timestamp parsing only | canonical timestamps | clock substitution proof |
| Determinism | canonical normalization and failure selector | ViewSpec and stable snapshot | caller/row-order proof |
| No repair | no mutation path | all persisted rows | before/after equality proof |
| Upstream boundaries | no RCV-018/020/021 semantic takeover | upstream authorities | boundary audit |

## 18. Implementation proof waves

Implementation must proceed only after this Design is independently reviewed.
Every physical proof uses a fresh disposable PostgreSQL database. Before the
RCV-022 migration, `NEW_LAYER_OBJECT_COUNT_BEFORE` MUST be zero. A retained
database MUST NOT be touched. If guards or triggers must be bypassed to create
persisted corruption, the bypass is disposable-only, minimal, restored in a
`finally` path, and the production projector runs only after restoration. The
production Writer MUST NOT run while guards are disabled.

The smallest meaningful waves are:

### Wave A — ViewSpec and closed scope

Implement exact input validation, empty/duplicate handling, canonical manifest
ordering, exact target ClaimVersion binding, and the empty-scope result.
Measure with a valid closed scope and malformed/duplicate scope cases.

### Wave B — Historical re-authentication and projection

Implement one repeatable-read, read-only transaction; exact Envelope and
transitive authority authentication; unique AssessmentManifest;
OccurrenceManifest; EnvelopeProvenance; and scope-relative status.
Measure a real PostgreSQL persisted multi-Envelope Golden Slice, including a
commit boundary and a fresh connection. The proof MUST distinguish a fresh
connection from a fresh process or runtime restart.

### Wave C — Failure, precedence, and full no-repair matrix

First prove each single fault in isolation: malformed ViewSpec, duplicate
EnvelopeRef, bad target ClaimVersionRef, missing scoped Envelope or required
authority (`MISSING_AUTHORITY`), unsupported canonical/authority version
(`UNSUPPORTED_VERSION`), bad canonical/hash commitment, wrong ClaimVersion
scope, corrupt Assessment, corrupt Match/Fragment lineage, and one valid plus
one invalid scoped Envelope. Also prove the same `assessmentId` appearing in
multiple occurrences with conflicting canonicalVersion or canonicalHash:
there is one identity only, no latest-wins or silent deduplication, and the
whole view fails using the existing structural or duplicate-conflict
semantics.

Then prove the paired reachability control. In the stale-control case, leave
an earlier hash/reference commitment stale and require that earlier frozen
failure. In the neutralized case, recompute only the dependent commitments
needed to pass earlier checks and require the intended deeper
`LINEAGE_MISMATCH`, `CLAIM_SCOPE_MISMATCH`, or other exact frozen class. The
proof MUST show both that the earlier failure is reachable and that the deeper
check is actually reached after neutralization.

For every multi-fault case, record fault A, fault B, the expected winner from
frozen precedence, caller-order variation, database row-order variation where
relevant, and a fresh-connection repetition. No first-thrown error may select
the result. Capture every affected persisted row before and after production
verification and require exact equality; “no UPDATE was issued” is not
sufficient.

### Wave D — Restart, determinism, and independence

For a valid committed graph, close the original connection/pool and verify
with a fresh connection. Where the harness supports it, cross a fresh Node
process/runtime boundary as a separate proof. The resulting ViewResult MUST
be byte/semantically identical and require no in-memory builder, cache, or
process-local authority state.

For a committed corrupted graph, neutralize unrelated commitments as needed,
commit the corruption, then repeat through a fresh connection and fresh
process/runtime where supported. The invalid restart proof MUST preserve the
intended failure class, fail the whole view closed, return no partial result,
perform no repair, and leave the corrupted persisted state byte-for-byte
unchanged.

Also exercise caller-order permutations, query/row-order permutations where
safely possible, repeated Assessments across Envelopes, current-state
mutation, current-clock substitution, and SUPPORTS/REFUTES across Envelopes
without cross-Envelope contradiction.

Each wave MUST follow:

```text
measurement proof -> adversarial counterexample -> independent Test Review -> Snapshot-Lock
```

No wave may add scoring, weighting, ranking, truth, persistence, dynamic
selection, or a new semantic authority.

## 19. Minimum Golden Slice

The first complete persisted proof should contain one ClaimVersion and two
authenticated Envelopes in the explicit manifest:

```text
Envelope A: Assessment X at ordinal 0, Assessment Y at ordinal 1
Envelope B: Assessment X at ordinal 3, Assessment Z at ordinal 0
```

The exact valid RCV-022 authorities determine the relations and methods.
Required projection facts are:

```text
AssessmentManifest: X, Y, Z once each
OccurrenceManifest: A/X/0, A/Y/1, B/X/3, B/Z/0
```

The repeated X occurrence proves that identity is not occurrence and that
repetition creates no evidentiary weight. If the Envelopes contain
SUPPORTS/REFUTES, those relations remain visible without a new claim-level
contradiction.

## 20. Minimum negative proof matrix

The implementation test plan MUST include at least:

- malformed ViewSpec and malformed target ClaimVersionRef;
- malformed and duplicate EnvelopeRef;
- missing scoped Envelope or required authority, isolated so `MISSING_AUTHORITY`
  is selected;
- unsupported canonical or authority version, isolated so
  `UNSUPPORTED_VERSION` is selected;
- bad Envelope canonical/hash commitment;
- Envelope bound to another ClaimVersion;
- corrupt Assessment authority;
- corrupt Match or Fragment transitive lineage;
- the same `assessmentId` in multiple scoped Envelopes with conflicting
  canonical commitments;
- one valid plus one invalid scoped Envelope causing whole-view failure;
- caller-order permutation and database row-order variation where relevant;
- the same Assessment across multiple Envelopes;
- SUPPORTS in one Envelope and REFUTES in another without new contradiction;
- five-versus-one relation multiplicity without majority semantics;
- stale-control and neutralized-deeper-check paired reachability cases;
- current-state mutation attempt;
- current-clock substitution attempt;
- valid fresh-connection and fresh-process/restart proof;
- invalid fresh-connection and fresh-process/restart proof;
- exact full affected persisted-state before/after equality after every
  corruption or failure.

Single-fault proofs MUST precede multi-fault precedence proofs. Multi-fault
proofs MUST vary caller order and, where relevant, physical row order, repeat
from a fresh connection, and select the same frozen-precedence failure every
time.

Tests MUST call the production projector and real persisted authorities. They
MUST NOT copy its verifier, implement a test-only aggregator, use a Reader
success boolean as an oracle, fake persistence, or share an invalid fixture
across unrelated cases.

## 21. Explicit non-goals

This Design does not introduce or implement:

- database schema changes or persistence;
- execution receipts or caches;
- dynamic scope or global cutoff selection;
- global evidence completeness;
- scoring, weighting, ranking, majority, or preferred authorities;
- truth verdicts or cross-Envelope contradiction;
- explanation synthesis, editorial acceptance, or HITL;
- source, retrieval, observation, or research completeness;
- RCV-018, RCV-020, or RCV-021 authority takeover.

## 22. North-Star fit

The Design increases transparency and reproducibility by exposing exactly
which authenticated Assessment identities and Envelope occurrences were
considered for one ClaimVersion under one explicit scope. It preserves
traceability to historical authorities and does not change evidentiary
meaning. It therefore adds visibility without introducing hidden selection,
weighting, or truth semantics.
