# FactBase Research Scheduler / Policy Implementation Design V1

Status: draft for independent Design audit. This document implements the
frozen Scheduler/Policy Contract V1 and does not change that Contract,
RCV-020, RCV-021, or RCV-022.

## 1. Authority and evidence boundary

The authoritative Scheduler Contract is
`docs/provenance/factbase-research-scheduler-policy-contract-v1.md`.
Its current authoritative bytes are 29236 bytes with SHA-256
`2736cf84a3b6ffdf27a1452b0ed63f97be3884ead11689347423385ca174e72f`, locked
by snapshot commit `8abfad20b19e050b4f913962ceb8558212207292` (tree
`b5046afb21e0085ad34bf3d4231577de7bff0238`). The prior hash
`272c05f918932b5e15ddf46f9f18dba74bc3e81138dd0e65138c8c10f81879dd` is
superseded and is not current authority.
The frozen RCV-021 Contract and Design remain separate authorities.

The RCV-021 transaction-neutral write capability is a proven prerequisite.
It was committed locally in `2f7fbe7bf715afb6eb3e14b024cd6d22949b9f99` and
physically verified for rollback, commit, idempotency, conflict, locking, and
Reader parity. The complete Scheduler transaction containing the Scheduler
manifest, SchedulerDecision, RCV-021 ResearchRun, and SchedulerRunNowBinding
is a Design requirement only. It is not physically proven by this Design
document and must pass the later integrated implementation proof.

No current-policy pointer, queue, evaluation-history entity, mutable
high-water row, provider state, Claim state, or secret is Scheduler authority.

## 2. Exact Scheduler authority inventory

The Scheduler owns exactly six tables:

1. `scheduler_policy_streams`
2. `scheduler_policy_versions`
3. `scheduler_decisions`
4. `scheduler_lifecycle_prefix_manifests`
5. `scheduler_lifecycle_prefix_members`
6. `scheduler_run_now_bindings`

There is no evaluation table, evaluation identity, evaluation canonical/hash,
or mutable current-policy table.

### 2.1 `scheduler_policy_streams`

This is the immutable identity connecting one policy stream to one existing
RCV-021 ResearchOperation. It contains:

- `policy_id UUID NOT NULL` — primary key;
- `operation_id UUID NOT NULL` — unique, logical/SQL reference to
  `research_operations.operation_id`; and
- immutable persistence metadata such as `created_at`, excluded from policy
  semantic canonical bytes.

`operation_id` is unique, enforcing one stream per Operation. There is no
independent stream canonical/hash authority: the stream is only the stable
parent identity for versioned policy authority. The Operation reference uses
`ON DELETE NO ACTION` and `ON UPDATE NO ACTION`.

### 2.2 `scheduler_policy_versions`

Each row is immutable policy authority:

- `policy_id UUID NOT NULL`;
- `version BIGINT NOT NULL`;
- `enabled BOOLEAN NOT NULL`;
- `effective_at TIMESTAMPTZ(6) NOT NULL`;
- `first_eligibility_at TIMESTAMPTZ(6) NOT NULL`;
- `fixed_interval_micros BIGINT NOT NULL`;
- `canonical_version INTEGER NOT NULL`;
- `canonical TEXT NOT NULL`;
- `canonical_hash BYTEA NOT NULL`; and
- immutable persistence metadata `created_at`.

The primary key is `(policy_id, version)`. `version >= 1`,
`fixed_interval_micros > 0`, canonical version is the supported version, and
the hash is exactly 32 bytes. A unique `(policy_id, effective_at)` key
prevents equal effective times.

`policy_id` is a NO ACTION foreign key to `scheduler_policy_streams`.
Canonical text is non-empty, `enabled` is non-null, and all three timestamp
and interval fields are non-null and validated by the exact time/BigInt rules
below.

The Writer, while holding the stream lock, requires the new version to be
strictly greater than every existing version and its `effective_at` to be
strictly later than every existing effective time. Version gaps are valid;
contiguous numbering is not required. The initial version must satisfy
`effective_at <= first_eligibility_at`. Every later version must preserve the
stream's original `first_eligibility_at` and `fixed_interval_micros`. These
cross-row rules are Writer and Reader invariants in addition to row-local
checks.

### 2.3 `scheduler_decisions`

The semantic primary key is exactly:

`(operation_id, policy_id, slot_index)`.

The persisted row contains:

- the three identity fields above;
- `policy_version BIGINT` and the owning policy-version canonical/hash
  reference;
- `scheduled_at TIMESTAMPTZ(6)`;
- `evaluation_at TIMESTAMPTZ(6)`;
- `decision` (`RUN_NOW` or `NO_ACTION`);
- `reason` from the closed Contract vocabulary;
- `next_eligible_at TIMESTAMPTZ(6)` nullable under the exact null rule;
- `manifest_id` and manifest hash reference;
- predecessor identity components `previous_operation_id`,
  `previous_policy_id`, `previous_slot_index`, and
  `previous_decision_canonical_hash`, all null for genesis and all non-null
  otherwise;
- nullable ACTIVE_RUN evidence fields: blocking `run_id`, Run creation
  identity/hash, historical state, and RUNNING event identity/hash only when
  the derived state is RUNNING;
- nullable `run_now_binding_identity` and `run_now_run_id`, both non-null
  exactly for `RUN_NOW`;
- `canonical_version`, `canonical`, and `canonical_hash`; and
- immutable persistence metadata `created_at`, excluded from
  SchedulerDecision canonical bytes.

The persisted decision/reason matrix is exactly:

- `NO_ACTION / OPERATION_CLOSED`;
- `NO_ACTION / POLICY_DISABLED`;
- `NO_ACTION / ACTIVE_RUN`;
- `RUN_NOW / INITIAL_ELIGIBILITY`;
- `RUN_NOW / INTERVAL_ELIGIBILITY`; and
- `RUN_NOW / MISSED_SLOT_COALESCED`.

`SCHEDULE_LATER` and `NOT_YET_ELIGIBLE` cannot be stored. `slot_index >= 0`.
Database checks enforce the decision/reason matrix, nullability, and the
conditional evidence/XOR rules; the Reader repeats every check.

The concrete references are: `operation_id` to the RCV-021 Operation,
`policy_id` to `scheduler_policy_streams`, `(policy_id, policy_version)` to
`scheduler_policy_versions`, and `manifest_id` to
`scheduler_lifecycle_prefix_manifests`. The manifest's decision identity must
equal the decision primary key. Row-local checks cover supported enum values,
32-byte hashes, non-empty canonical text, `next_eligible_at IS NULL` exactly
for CLOSED/DISABLED reasons, ACTIVE_RUN evidence present exactly for
ACTIVE_RUN, RUNNING evidence present exactly for derived RUNNING state, and
RUN_NOW binding fields present exactly for RUN_NOW.

The predecessor identity is the typed tuple
`(previous_operation_id, previous_policy_id, previous_slot_index)`. A row
CHECK enforces all four predecessor components are null together for genesis
or non-null together for non-genesis. Cross-row Writer/Reader rules enforce
same-stream membership, predecessor existence, predecessor-hash equality,
tail append, branch absence, cycle absence, complete coverage, and strict slot
increase. The conceptual unique structures are the Decision identity primary
key, one nullable predecessor identity per Decision, and at most one
successor per `(policy_id, previous_operation_id, previous_policy_id,
previous_slot_index)`; genesis uniqueness is one null-predecessor row per
policy stream.

Every persisted decision is one node in the immutable predecessor chain for
its policy stream. The chain is the only issuance-order authority; no
`issued_at`, issuance ordinal, database sequence, transaction identifier,
commit timestamp, or mutable tail is authority.

### 2.4 `scheduler_lifecycle_prefix_manifests`

There is one immutable combined manifest for each persisted SchedulerDecision.
It contains:

- `manifest_id UUID NOT NULL` — primary key;
- the decision identity `(operation_id, policy_id, slot_index)`;
- `evaluation_at TIMESTAMPTZ(6)`;
- `canonical_version`;
- `canonical TEXT`; and
- `canonical_hash BYTEA` (the manifest hash).

The decision identity is unique in this table, making the relation one-to-one
with `scheduler_decisions`. The Operation and policy-stream references use
NO ACTION semantics; `policy_id` also references the stream. Manifest
canonical bytes authenticate the exact ordered
member set; the member rows are not represented by an ungrounded aggregate
hash alone.

### 2.5 `scheduler_lifecycle_prefix_members`

Each row is one exact member of a manifest:

- `manifest_id UUID NOT NULL`;
- `authority_kind` from the five closed kinds below;
- `authoritative_time TIMESTAMPTZ(6) NOT NULL`;
- `authority_identity TEXT NOT NULL`;
- `authority_canonical_version INTEGER NOT NULL`;
- `authority_canonical_hash BYTEA NOT NULL`; and
- an immutable typed logical reference to the RCV-021 authority.

The primary key is `(manifest_id, authority_kind, authority_identity)`. No
database collation determines order. An ordinal is not stored: the Reader
derives it from the frozen ordering key and rejects duplicate or ambiguous
members. The five kinds, in fixed order, are:

1. `OPERATION_CREATED`
2. `OPERATION_LIFECYCLE_EVENT`
3. `RUN_CREATED`
4. `RUN_LIFECYCLE_EVENT`
5. `RUN_TERMINAL_RESOLUTION`

The logical reference mapping is typed by `authority_kind` and points to the
corresponding immutable RCV-021 identity. Concrete SQL FKs are used where a
stable single target exists; polymorphic member targets are authenticated by
the kind, identity, canonical bytes, and hash during Read verification.
Member kind is closed, identity and canonical text are non-empty, and every
member hash is exactly 32 bytes.

The five member kinds map to frozen RCV-021 authority exactly:

- `OPERATION_CREATED` → `research_operations.operation_id`,
  `canonical_hash`, `operation_created_at`, and `operation_id`;
- `OPERATION_LIFECYCLE_EVENT` →
  `research_operation_lifecycle_events.event_id`, `canonical_hash`, `event_at`,
  and `operation_id`;
- `RUN_CREATED` → `research_runs.run_id`, `canonical_hash`, `run_created_at`,
  `operation_id`, and `run_id`;
- `RUN_LIFECYCLE_EVENT` → `research_run_lifecycle_events.event_id`,
  `canonical_hash`, `event_at`, and `run_id`, with Operation membership
  authenticated through `research_runs.operation_id`; and
- `RUN_TERMINAL_RESOLUTION` →
  `research_run_terminal_resolutions.resolution_id`, `canonical_hash`,
  `terminal_at`, and `run_id`, with Operation membership authenticated through
  `research_runs.operation_id`.

For every member, `authorityCanonicalVersion` is copied from the referenced
RCV-021 row's `canonical_version`; `authorityCanonicalHash` is copied from its
`canonical_hash`; and `authorityIdentity` is the lowercase canonical UUID text
of the listed immutable identity. The typed pair `(authorityKind,
authorityIdentity)` is the collision-free member key and is ordered by UTF-8
bytes, never database collation.

### 2.6 `scheduler_run_now_bindings`

This is immutable one-to-one cross-authority binding:

- decision identity `(operation_id, policy_id, slot_index)` — primary key and
  FK to `scheduler_decisions`;
- `run_id UUID NOT NULL` — logical/SQL reference to
  `research_runs.run_id`, unique in this table;
- `operation_id UUID NOT NULL` for cross-checking the Operation boundary;
- `canonical_version`, `canonical`, and `canonical_hash`; and
- immutable persistence metadata.

The binding canonical authority contains the exact decision identity and
Run identity. The Reader compares decision `run_id`, binding `run_id`, and
the actual RCV-021 Run identity. One decision cannot bind two Runs and one
Scheduler-origin Run cannot satisfy two decisions.

`run_id` uses NO ACTION referential semantics. The binding operation must equal
the decision and the RCV-021 Run's Operation. Binding canonical text is
non-empty, its version is supported, and its hash is exactly 32 bytes.

## 3. Time, transport, and arithmetic

All persisted UTC times use finite PostgreSQL `TIMESTAMPTZ(6)`. The exact
epoch is `1970-01-01T00:00:00.000000Z`. The canonical internal form is a
signed decimal epoch-microsecond BigInt string. PostgreSQL `infinity` and
`-infinity` are rejected as non-finite sentinels, not treated as UTC values.

The canonical transport grammar is an expanded proleptic-Gregorian UTC text:
`YEAR-MM-DDTHH:mm:ss.ffffffZ`, with exactly six fractional digits. `YEAR` is
exactly four unsigned digits for astronomical years `0000` through `9999` and
exactly a sign followed by six digits for all other years (`+010000` and
`-004712`, for example). Astronomical year `0000` is 1 BC; negative years
continue that numbering. This covers the finite PostgreSQL timestamp domain
from `-004712-01-01T00:00:00.000000Z` (4713 BC) through
`+294276-12-31T23:59:59.999999Z` (294276 AD). Only the canonical `Z` form is accepted at
the service boundary; offset inputs are rejected rather than normalized by a
second parser.

The PostgreSQL client uses text transport for `TIMESTAMPTZ` so no driver
`Date` parser can lose precision. The parser validates the complete grammar,
proleptic-Gregorian calendar, finite PostgreSQL range, UTC suffix, and exactly
six fractional digits. More than six fractional digits are rejected; no
rounding or truncation occurs. Every read converts the text representation
directly to signed epoch-microsecond BigInt, and formatting is the exact
inverse. One microsecond before epoch is `-1`, epoch is `0`, and one
microsecond after epoch is `1`. No JavaScript `Date`, JavaScript `Number`,
floating point, locale, DST, or wall-clock arithmetic is used.

The finite range check is applied before PostgreSQL binding and after reverse
conversion. Malformed, non-UTC, over-precision, non-canonical, infinite, or
out-of-range values fail closed.

For slot `n`:

`scheduledAt = firstEligibilityAt + BigInt(n) * fixedIntervalMicros`.

`slot_index` and `fixed_interval_micros` are PostgreSQL BIGINT values moved
through decimal strings/BigInt. The implementation rejects negative or
out-of-range values, checks multiplication and addition against the supported
PostgreSQL timestamp epoch-microsecond range, and checks conversion to
`TIMESTAMPTZ(6)` before persistence. There is no wraparound, truncation,
rounding, clamping, or floating-point intermediate.

## 4. Policy owner and slot history

The Writer serializes on the policy-stream row before selecting a policy
owner. For an unissued slot, the owner is the unique highest version whose
`effective_at <= scheduled_at`. The initial-version invariant guarantees an
owner for slot zero and every valid later slot. A malformed zero-owner or
co-owner state fails closed. An existing decision is authenticated first and
retains its original policy-version identity forever.

Only an immutable persisted due-slot decision consumes a slot. Transient
pre-due results consume none. Due CLOSED, DISABLED, ACTIVE_RUN, and every
RUN_NOW decision consume the selected slot.

`INTERVAL_ELIGIBILITY` requires `n > 0` and persisted decisions for every
slot `0..n-1`. `MISSED_SLOT_COALESCED` requires `n > 0` and at least one
earlier slot that remains unissued. Earlier slots are never backfilled. Once
a gap has been coalesced, later due slots may continue to be classified as
MISSED_SLOT_COALESCED exactly as required by the Contract.

The Writer holds the policy-stream lock, authenticates the complete immutable
predecessor chain, derives its unique logical tail, and rejects a new Decision
whose `slot_index` is less than or equal to the tail's slot. A new Decision
references that tail identity and canonical hash; the predecessor is never
updated. Reader verification reconstructs the same chain and fails closed for
any lower/equal successor, branch, cycle, disconnected node, missing
predecessor, or incomplete coverage. Skipped slot indices remain permitted;
chain adjacency is not slot contiguity.

An empty policy stream has zero Decisions and zero genesis nodes. A non-empty
stream has exactly one genesis, with both predecessor fields null. Every other
Decision has exactly one existing predecessor in the same stream, with a
matching reconstructed canonical hash. At most one successor may name a
predecessor. The Reader rejects self references, forward references, cycles,
branches, disconnected nodes, cross-stream predecessors, incomplete
coverage, and more than one logical tail. A valid non-empty chain has exactly
one tail: the unique covered node with no successor.

## 5. Transient evaluation boundary

The evaluator returns a non-authoritative discriminated result, for example:

```text
{
  kind: "TRANSIENT_EVALUATION",
  evaluationAt,
  decision,
  reason,
  nextEligibleAt,
  dueSlot: null | { policyId, slotIndex, scheduledAt },
  existingDecision: null | authenticated persisted decision
}
```

The minimal result fields are `evaluationAt`, `decision`, `reason`, and
`nextEligibleAt`; `dueSlot` and `existingDecision` are present only when
needed to identify an evaluated/returned persisted slot. The result has no
identity, canonical bytes, hash, or occurrence claim.

Before due, OPEN/enabled returns `SCHEDULE_LATER / NOT_YET_ELIGIBLE`, CLOSED
returns transient `NO_ACTION / OPERATION_CLOSED`, and disabled policy returns
transient `NO_ACTION / POLICY_DISABLED`. These results are derived from
persisted authority plus supplied `evaluationAt`, are not persisted, and do
not consume a slot. A transient result proves only what would be returned for
that supplied input; it does not prove that an evaluation actually occurred.

## 6. Persisted decision evaluation

For a concrete due slot, the Writer authenticates any existing decision first.
Same identity and same canonical authority returns it idempotently; divergent
authority fails closed. Otherwise the due-slot precedence is:

1. historically CLOSED Operation;
2. disabled effective policy;
3. historically blocking nonterminal Run;
4. eligible RUN_NOW reason selection.

The full evaluation precedence additionally checks `NOT_YET_ELIGIBLE` before
the due-only branches; it is always transient. Pre-due CLOSED and DISABLED
are transient and never pre-consume a future slot. Due CLOSED and DISABLED
create persisted `NO_ACTION` decisions with `nextEligibleAt = NULL`.
Due ACTIVE_RUN and every RUN_NOW decision persist the immediately following
deterministic slot as `nextEligibleAt`. Thus every persisted decision other
than CLOSED/DISABLED has a non-null next eligibility.

## 7. Lifecycle prefix and historical state

The manifest scope is one referenced Operation plus every relevant same-
Operation RCV-021 creation, lifecycle, and terminal authority whose
authoritative time is `<= evaluationAt`. Equality is included; later
authority is excluded. Members are ordered by authoritative time ascending,
fixed authority-kind order, and immutable identity UTF-8 bytes ascending.

The Reader independently reconstructs the expected member set and canonical
bytes from immutable RCV-021 authority. Missing, extra, duplicate, hash-
mismatched, or newly discovered backdated members fail with
`LIFECYCLE_PREFIX_VIOLATION`; the manifest and decision are never repaired.

Operation state is OPEN when no CLOSED event is in the prefix and CLOSED when
the authenticated CLOSED event is in it. A later close does not rewrite an
earlier decision. Contradictory/backdated lifecycle history fails closed.

For each in-scope Run, the Reader derives PLANNED, RUNNING, or a terminal
outcome from the prefix. PLANNED requires Run creation in the prefix and no
RUNNING event or terminal resolution in it. RUNNING additionally requires the
RUNNING event in the prefix. A terminal authority at or before the cutoff
prevents ACTIVE_RUN; terminal authority after the cutoff remains later
history.

RUN_NOW requires zero same-Operation PLANNED/RUNNING Runs. ACTIVE_RUN requires
exactly one. More than one blocking Run is invalid and never selects an
arbitrary winner. ACTIVE_RUN evidence is persisted only for ACTIVE_RUN;
RUNNING event evidence is persisted only for derived RUNNING state.

## 8. RUN_NOW transaction and identity

The Scheduler owns one outer PostgreSQL transaction. It acquires the policy
stream lock first, then the RCV-021 Operation-row lock, authenticates policy
and Operation history, selects the due slot, and authenticates any existing
same-slot Decision first. If no same-slot Decision exists, it authenticates
the complete existing Decision chain, derives its unique logical tail, checks
predecessor slot monotonicity, reconstructs the prefix, derives precedence,
and prepares all canonical authority.

The conceptual transaction order is: begin; lock and authenticate the policy
stream; lock and authenticate the RCV-021 Operation; authenticate policy and
version; compute the due slot; authenticate an existing same-slot Decision;
if none exists, reconstruct the complete Decision chain and tail; reject a
non-increasing new slot; reconstruct the lifecycle prefix; derive precedence;
construct the predecessor-bound canonical Decision; derive the deterministic
Run ID when needed; invoke the transaction-neutral RCV-021 primitive; persist
manifest and members; persist the Decision; persist the RUN_NOW binding;
recheck equality; commit. Statement order may vary only for FK feasibility.

The Scheduler derives the Run identity before canonicalizing the decision:

1. canonicalize the exact tuple `{ operationId, policyId, slotIndex }`, with
   `slotIndex` represented as a decimal string;
2. prefix the UTF-8 bytes with the exact domain string
   `factbase/rcv021/scheduler-run-id/v1\0`;
3. SHA-256 the concatenation; and
4. use the first 16 digest bytes as an RFC-4122 UUID, set the version nibble
   to `4`, and set the variant bits to binary `10`.

This is technical idempotency only. It does not change RCV-021 identity
semantics, collapse equal content, or require secrecy. Same slot produces the
same Run ID; different slot identities produce distinct derived IDs.

Inside the same transaction the Writer authenticates an existing same-slot
Decision before append. An identical canonical authority returns idempotently;
a divergent authority fails closed. For a new Decision, an empty stream alone
permits genesis; otherwise the Writer binds the authenticated tail identity
and hash and requires the new slot to be strictly greater. The Writer then
invokes the proven transaction-neutral RCV-021 primitive, persists the
manifest and members, persists the predecessor-bound SchedulerDecision,
persists the one-to-one binding, rechecks all identity equalities, and commits.
Statement order may move for FK satisfaction, but the lock order and single
commit boundary do not change. A failure or process crash before commit rolls
back every Scheduler and RCV-021 write. No committed partial state is valid.

The complete Scheduler single-commit path remains unproven until the
integrated implementation proof.

## 9. Concurrency and idempotency

All Scheduler write paths use the lock order:

`policy stream → RCV-021 Operation → due-slot/authority checks`.

No advisory lock is required. The policy-stream lock serializes policy-version
insertion, owner selection, same-slot evaluation, and retroactive checks. The
Operation lock is the same serialization boundary used by RCV-021 Run
creation and Operation close.

- Same slot/same canonical authority: authenticated idempotent return.
- Same slot/divergent authority: `DUPLICATE_CONFLICT`, no winner and no
  replacement.
- Concurrent policy version insertion: stream lock forces owner selection
  after the version commit order is known.
- Operation close versus RUN_NOW: Operation lock orders the transactions; the
  later transaction observes CLOSED and cannot create an invalid Run.
- Concurrent non-Scheduler Run creation: the same Operation lock orders the
  active-Run reconstruction and RCV-021 primitive.
- Terminalization after `evaluationAt`: later terminal authority is outside
  the bound prefix and cannot reinterpret the persisted decision.
- Concurrent appends: stream serialization re-reads the authenticated tail;
  only one successor can name a predecessor, and the next append must extend
  the resulting tail.
- Retroactive lower/equal slot: stream serialization rejects it as a
  `RETROACTIVE_SLOT_VIOLATION` before persistence.

Readers never depend on locks or mutable current pointers.

## 10. Canonical and hash ownership

Independent SHA-256 authority exists exactly for:

1. `SchedulerPolicyVersion` — version, enabled state, effective time, stable
   first eligibility, stable interval, and schema/version fields;
2. `SchedulerLifecyclePrefixManifest` — cutoff, decision identity, and the
   deterministically ordered exact member references;
3. `SchedulerDecision` — the complete Contract field set, including explicit
   nulls and conditional evidence; and
4. `SchedulerRunNowBinding` — decision identity, Operation identity, and
   RCV-021 Run identity.

All are versioned deterministic UTF-8 canonical objects hashed over exact
UTF-8 bytes with SHA-256. Canonical collections use the frozen manifest
ordering or explicit semantic field order. Database row order, locale,
runtime collection order, current state, and persistence metadata are never
canonical inputs. Canonical binary hashes are stored as 32-byte values; text
diagnostics use lowercase hexadecimal.

The exact canonical objects are:

- `scheduler-policy-version-v1`: keys `schema`, `canonicalVersion`,
  `policyId`, `operationId`, `version`, `enabled`, `effectiveAtMicros`,
  `firstEligibilityAtMicros`, and `fixedIntervalMicros`;
- `scheduler-lifecycle-prefix-manifest-v1`: keys `schema`,
  `canonicalVersion`, `manifestId`, `operationId`, `policyId`, `slotIndex`,
  `evaluationAtMicros`, and `members`. Each member has exactly
  `authorityKind`, `authoritativeTimeMicros`, `authorityIdentity`,
  `authorityCanonicalVersion`, and `authorityCanonicalHash`;
- `scheduler-decision-v1`: keys `schema`, `canonicalVersion`, `operationId`,
  `policyId`, `slotIndex`, `previousDecisionIdentity`,
  `previousDecisionCanonicalHash`, `policyVersion`,
  `policyVersionCanonicalHash`, `scheduledAtMicros`, `evaluationAtMicros`,
  `decision`, `reason`, `nextEligibleAtMicros`, `operationManifestId`,
  `operationManifestHash`, `activeRunId`, `activeRunCreationIdentity`,
  `activeRunCreationHash`, `activeRunHistoricalState`,
  `activeRunRunningEventIdentity`, `activeRunRunningEventHash`,
  `runNowBindingIdentity`, and `runNowRunId`; and
- `scheduler-run-now-binding-v1`: keys `schema`, `canonicalVersion`,
  `operationId`, `policyId`, `slotIndex`, and `runId`.

Every listed key is present. `canonicalVersion` is the string `"1"`; identity
values and hashes are canonical strings; `enabled` is Boolean; all semantic
integers and times are decimal strings; and all conditional values use JSON
`null` when inapplicable. `previousDecisionIdentity` is either `null` or one
typed object with exactly `operationId`, `policyId`, and `slotIndex`, each a
canonical identity/decimal string. The member array is pre-ordered by
authoritative time, fixed kind rank, and authority-identity UTF-8 bytes.

The `schema` literals are respectively
`scheduler-policy-version-v1`, `scheduler-lifecycle-prefix-manifest-v1`,
`scheduler-decision-v1`, and `scheduler-run-now-binding-v1`.

Serialization is exactly RFC 8785 JSON Canonicalization Scheme using the
verified FactBase `canonicalJson`/`canonicalizeAndHash` path and pinned
`canonicalize` package version `2.1.0`, with no local variation. The canonical JSON
string is encoded as UTF-8 and hashed with SHA-256; the stored binary hash is
32 bytes and diagnostic text is lowercase hexadecimal. RFC 8785 supplies
object-key ordering, escaping, and null serialization; it does not reorder
the semantically pre-ordered member array. Undefined or omitted values,
non-finite numbers, lone surrogates, and extra keys are invalid.

The canonical field types are closed: `schema` and `canonicalVersion` are
strings; UUID identities and hashes are lowercase strings; `version`,
`slotIndex`, and all `*Micros` fields are canonical decimal strings;
`authorityCanonicalVersion` is the referenced RCV-021 version converted to a
canonical decimal string;
`enabled` is Boolean; `decision`, `reason`, and `activeRunHistoricalState`
are closed strings; `members` is an ordered array; and every conditional
Decision key is nullable but never omitted. PolicyVersion has no nullable
field. Manifest members have no nullable field. Binding has no nullable field.

The canonical dependency graph is acyclic: PolicyVersion authority is
independent; Manifest authority depends on referenced RCV-021 member hashes;
Decision `N` depends on its policy/version, manifest, and predecessor `N-1`
identity/hash; and Binding depends on its Decision identity and Run identity.
Binding does not contain the SchedulerDecision hash, and Decision contains
only deterministic binding identity/Run identity, so no Decision/Binding hash
cycle exists.

## 11. Failure taxonomy and precedence

The Design-owned diagnostic taxonomy has exactly 16 classes:

`MISSING_DATA`, `MALFORMED_DATA`, `VERSION_MISMATCH`, `CANONICAL_MISMATCH`,
`HASH_MISMATCH`, `IDENTITY_MISMATCH`, `DUPLICATE_CONFLICT`,
`POLICY_VERSION_VIOLATION`, `SLOT_ARITHMETIC_VIOLATION`,
`RETROACTIVE_SLOT_VIOLATION`, `DECISION_PRECEDENCE_VIOLATION`,
`LIFECYCLE_PREFIX_VIOLATION`, `NONTERMINAL_RUN_VIOLATION`,
`RUN_NOW_BINDING_VIOLATION`, `CURRENT_STATE_SUBSTITUTION`, and
`UNSUPPORTED_STATE`.

When several failures exist, the first class in this exact order wins:

1. `MISSING_DATA`
2. `MALFORMED_DATA`
3. `VERSION_MISMATCH`
4. `IDENTITY_MISMATCH`
5. `POLICY_VERSION_VIOLATION`
6. `SLOT_ARITHMETIC_VIOLATION`
7. `RETROACTIVE_SLOT_VIOLATION`
8. `LIFECYCLE_PREFIX_VIOLATION`
9. `NONTERMINAL_RUN_VIOLATION`
10. `DECISION_PRECEDENCE_VIOLATION`
11. `CANONICAL_MISMATCH`
12. `HASH_MISMATCH`
13. `DUPLICATE_CONFLICT`
14. `RUN_NOW_BINDING_VIOLATION`
15. `CURRENT_STATE_SUBSTITUTION`
16. `UNSUPPORTED_STATE`.

Within one class, the canonical field path is selected by UTF-8 byte order,
then immutable identity by UTF-8 byte order. No semantic failure is repaired,
converted to a winner, or hidden as a generic success.

Predecessor-chain failures map without adding a new class: missing or partial
predecessor data is `MISSING_DATA` or `MALFORMED_DATA`; wrong predecessor or
cross-stream identity is `IDENTITY_MISMATCH`; predecessor hash mismatch is
`HASH_MISMATCH`; second genesis, branch, cycle, disconnection, or incomplete
coverage is `DECISION_PRECEDENCE_VIOLATION`; and a self/forward/decreasing or
equal-slot edge is `RETROACTIVE_SLOT_VIOLATION`. The global precedence above
selects the primary class when multiple defects coexist.

## 12. Immutability and referential rules

All six Scheduler tables are insert-only. Database guards reject UPDATE and
DELETE. Historical foreign keys use NO ACTION; no cascade can remove or
rewrite authority. A correction requires new Contract-permitted authority.

Concrete SQL FKs are used for policy stream to RCV-021 Operation, policy
version to stream, decision to stream/version/manifest, and binding to
decision/RCV-021 Run where the target type is stable. Manifest members use
typed logical references for their polymorphic RCV-021 targets and are
verified against exact target canonical/hash bytes.

## 13. Migration shape and correctness structures

The migration creates exactly the six tables above, their closed enums/checks,
NO ACTION references, and one immutable guard pattern consistent with the
existing FactBase migrations. It creates no evaluation table, queue table,
current-policy pointer, or extra semantic authority object.

The predecessor chain is represented entirely inside `scheduler_decisions`;
no chain, tail, issuance, evaluation, or sequence-authority table is needed.

Correctness-required structures are:

- unique `operation_id` on policy streams;
- primary `(policy_id, version)` and unique effective time per stream;
- primary `(operation_id, policy_id, slot_index)` on decisions;
- predecessor identity components on decisions, with an all-null/all-non-null
  row check and same-stream authenticated logical relation (not a required
  self-FK);
- unique non-null predecessor identity per policy stream, plus a partial unique
  null-predecessor genesis key per stream;
- one manifest identity per decision identity;
- primary manifest-member identity and deterministic member uniqueness;
- primary binding decision identity and unique `run_id` binding.

Indexes used only for lookup (for example effective-time or manifest-member
scans) are performance structures and do not carry authority.

Row-local constraints can enforce predecessor all-null/all-non-null shape,
identity uniqueness, one successor per predecessor, and one genesis. Writer
serialization and the SELECT-only Reader enforce predecessor existence,
same-stream membership, predecessor-hash equality, no self/forward reference,
cycle absence, complete coverage, unique tail, and strict slot monotonicity;
these cross-row graph properties are not claimed as SQL CHECK semantics.

## 14. Writer responsibilities

The Writer authenticates policy input, validates UTC/BigInt values, selects the
exact owner, computes the slot, and returns the transient result without any
write when the selected slot is not due. For a due slot it serializes the
stream, authenticates any existing same-slot Decision first, then for a new
Decision authenticates the complete chain, derives the unique tail, enforces
predecessor and slot monotonicity,
reconstructs the complete prefix, derives Operation and Run states, applies
precedence, constructs canonical/hash authority, derives a Scheduler Run ID,
calls the shared RCV-021 primitive, persists all six-table authority required
for the result, checks binding equality, and commits once. Any failure rolls
back and fails closed. The Writer never repairs, reconnects a chain, or
substitutes current state.

## 15. Independent Reader/Verifier

The Reader retrieves the complete persisted graph using SELECT-only access,
reconstructs every canonical/hash value, recomputes policy ownership and slot
arithmetic, and reconstructs the complete Decision chain. It verifies genesis,
predecessor identity/hash and same-stream membership, successor uniqueness,
cycle absence, same-slot identity consistency, full coverage, unique tail, and strict slot increase before
checking the decision matrix and issuance order. It then reconstructs exact
manifest membership, derives Operation and every Run state at the cutoff,
checks zero/exact-one nonterminal rules, verifies `nextEligibleAt`, validates
the RUN_NOW binding and actual RCV-021 Run, and detects backdated or current-
state substitutions. It does not trust Writer output, stored hashes alone,
current policy pointers, current Run state, queue state, provider state,
source state, Claim state, secrets, or the current clock. Invalid history
fails closed with no repair.

## 16. Implementation waves

### Wave 1 — migration and physical invariants

Done when exactly six tables, keys, checks, NO ACTION references, and
immutable guards replay cleanly and catalog inspection finds no extra
authority object.

### Wave 2 — pure Scheduler semantic core

Done when exact expanded UTC/BigInt parsing, slot arithmetic, policy owner
selection, transient/persisted boundary, decision matrix, RFC 8785 canonical
bytes, hashes, predecessor-chain traversal, failure precedence, and
deterministic repeats pass without PostgreSQL writes.

### Wave 3 — integrated RUN_NOW slice

Done when the fresh PostgreSQL proof performs transient pre-due evaluation,
slot-0 RUN_NOW, complete manifest, deterministic Run ID, one outer transaction
through the shared RCV-021 primitive, binding, commit, identical retry,
divergent retry failure, and injected rollback with zero partial authority.
This is the first physical proof of Scheduler combined atomicity and is not
covered by the prerequisite commit.

### Wave 4 — independent historical Reader

Done when Reader-only reconstruction accepts valid history, rejects every
manifest/decision/binding/hash corruption, performs no repair, works with a
SELECT-only role, and remains independent of current state.

### Wave 5 — complete policy and concurrency behavior

Done when CLOSED/DISABLED/ACTIVE_RUN, PLANNED/RUNNING, repeated MISSED,
policy-version transitions, same-slot races, predecessor-chain append/branch/
cycle/corruption cases, close/run races, concurrent Run creation, and
retroactive-slot rejection pass physically.

### Wave 6 — adversarial and close proofs

Done when crash/restart, rollback/commit, timestamp and BIGINT extremes,
backdated contradictions, no-partial-authority, SELECT-only, drift, and full
regression proofs pass on final bytes.

## 17. Mandatory physical proof inventory

The implementation must prove, on disposable UTF-8 PostgreSQL:

- clean migration replay and exact six-table catalog;
- no evaluation or extra authority object;
- every FK, CHECK, XOR, and immutable UPDATE/DELETE guard;
- independent RFC 8785 golden vectors and exact SHA-256 vectors for all four
  canonical authorities, including genesis, successor, and conditional-null
  Decision variants;
- exact microsecond round-trip across epoch, pre-epoch, BCE/extended years,
  finite PostgreSQL boundaries, and rejected infinity values; BIGINT above
  JavaScript MAX_SAFE_INTEGER, maximum supported timestamp arithmetic, and
  overflow rejection;
- transient `SCHEDULE_LATER` with no decision and slot 0 still available;
- same/same idempotency and same/divergent conflict;
- empty stream, one genesis, valid successor, second genesis, branch,
  disconnected node, self-reference, two-node and longer cycles, missing
  predecessor, wrong predecessor hash, cross-stream predecessor, and equal or
  decreasing slot-edge corruption;
- slot 5 followed by attempted slot 3 rejection, same-slot retry with no new
  chain node, concurrent append serialization, unique-tail reconstruction,
  and SELECT-only chain verification;
- policy-version, Operation-close, concurrent Run, and retroactive-slot races;
- PLANNED blocking, RUNNING blocking, zero nonterminal RUN_NOW, and multiple
  nonterminal fail-closed behavior;
- exact mapping, membership, ordering, hashes, canonical versions, tie keys,
  missing/extra members, and backdated contradiction for all five manifest
  member kinds;
- combined Scheduler/RCV-021 commit, rollback, crash/restart, no partial
  authority, binding equality, and retry recovery;
- repeated MISSED semantics;
- Reader deterministic repeat, no-repair, and current-state independence;
- SELECT-only Reader verification;
- Contract/Design/migration/RCV-021 drift checks and the complete regression
  matrix.

## 18. Explicit non-goals and drift audit

This Design adds no adaptive cadence, outcome-based cadence, truth or evidence
semantics, Claim analysis, source ranking, provider execution, Scheduler-owned
RCV-021 trigger, mutable current-policy authority, evaluation history, repair,
or completeness inference. RCV-020 remains observation authority, RCV-021
remains active-research execution authority, and RCV-022 remains future
semantic analysis authority.

Contract drift: 0. RCV-021 Contract drift: 0. RCV-021 Design drift: 0.
RCV-021 schema change: 0. RCV-021 trigger change: 0. RCV-022 leakage: 0.
Semantic invention: 0. Design authority ambiguities: 0. Open Design-shaping
questions: 0.
