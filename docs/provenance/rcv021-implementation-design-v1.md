# RCV-021 Active Research Orchestration — Implementation Design V1

## 1. Design authority and status

This Design is drafted against the owner-selected working basis for the
RCV-021 Contract V1 identified below. That selection is solely a basis for
continued review; the Contract remains a draft and is not frozen. It does not
approve or freeze the Contract or authorize implementation.

Contract:
`docs/provenance/rcv021-active-research-orchestration-contract-v1.md`

Selected working-basis Contract SHA256:
`0275261ee20decf2f1194ad40b052bed77dafad5742e756cc75ed7a45baaed46`

The Design adds no semantic authority. It specifies physical objects,
validation, transaction boundaries, interfaces, and proof strategy. It is a
draft and is not frozen.

RCV-019 remains temporal/evidence-state authority. RCV-020 remains the sole
authority for configured observation, ObservationOccurrence,
RetrievalAttempt, Capture, comparison, retention, coverage, and
AuthenticatedHandoff. RCV-022 and later RCVs own Claim and evidence analysis.

## 2. Authoritative object set

The minimum new persisted authoritative object set is exactly:

1. `research_operations`
2. `research_operation_subject_bindings`
3. `research_operation_trigger_bindings`
4. `research_operation_lifecycle_events`
5. `research_runs`
6. `research_run_lifecycle_events`
7. `research_run_terminal_resolutions`
8. `research_attempts`
9. `research_attempt_resolutions`
10. `research_provider_results`
11. `research_result_selections`

No aggregate, queue, coverage, current-state, parallel Capture, or parallel
Handoff object is authoritative. A derived current-state projection may be
materialized outside this authority set, but must be reconstructible from
these objects and must never be used for historical verification.

### 2.1 Physical table contract for migration derivation

The following is the complete physical contract for the eleven authoritative
tables. It is intentionally stated before SQL is written so the migration is
mechanically derivable and cannot add convenience authority.

Common rules apply to every table: identifiers are PostgreSQL `UUID` primary
keys; timestamps are `TIMESTAMPTZ`; canonical bytes are UTF-8 `TEXT` in the
single RCV-021 canonical convention; `canonical_version` is `INTEGER NOT NULL`
and must equal the one supported version; `canonical_hash` is `BYTEA NOT NULL`
with exactly 32 bytes (SHA-256); and `created_at` is immutable. Every table
has an immutable-history trigger that rejects both `UPDATE` and `DELETE`.
All foreign keys below use `ON DELETE NO ACTION ON UPDATE NO ACTION`; no
historical foreign key cascades. Cross-row temporal, lineage, and manifest
rules are additionally required in WriteVerifier/ReadVerifier because a
PostgreSQL `CHECK` cannot inspect another row.

The only closed physical domains are `subject_type` =
`RCV020_CAPTURE | RCV020_OBSERVATION_OCCURRENCE |
RCV020_RESEARCH_TRIGGER_REQUEST | AUTHENTICATED_OPERATOR_REQUEST |
HISTORICAL_CLAIM_IDENTITY`; `trigger_type` = `OPERATOR |
RCV020_RESEARCH_REQUEST`; operation event type = `CLOSED`; run event type =
`STARTED`; run terminal outcome = `SUCCESS_WITH_RESULTS |
SUCCESS_NO_RESULTS | FAILED | TIMED_OUT`; and attempt resolution outcome =
`SUCCEEDED | FAILED`. Provider protocol result status is deliberately
provider-descriptive non-empty text, not a new RCV-021 semantic enum.

1. **`research_operations`** — PK `operation_id`; required
   `subject_binding_id`, `trigger_binding_id`, `purpose`, `scope_canonical`,
   `operation_created_at`, canonical version/bytes/hash, and `created_at`;
   no nullable semantic fields. The two binding IDs have deferred FKs to the
   one-to-one child tables. Checks require non-empty purpose/scope, supported
   canonical version, and 32-byte hash. Indexes: `(operation_created_at,
   operation_id)`. No additional uniqueness beyond the PK.
2. **`research_operation_subject_bindings`** — PK `subject_binding_id`;
   required `operation_id` (unique FK), closed `subject_type`, canonical
   version/bytes/hash, and `created_at`; nullable typed references are exactly
   `capture_id`, `observation_occurrence_id`, `research_trigger_request_id`,
   `operator_request_id`, and `historical_claim_id`. RCV-020 capture and
   occurrence references have restrictive FKs; the other three are opaque
   authenticated identities and have no current-state FK. Checks enforce one
   and only one non-null reference and exact discriminator/reference pairing.
   Indexes: unique `operation_id`, each populated typed reference.
3. **`research_operation_trigger_bindings`** — PK `trigger_binding_id`;
   required `operation_id` (unique FK), closed `trigger_type`, `created_at`,
   canonical version/bytes/hash; nullable per-trigger fields are
   `initiator_identity`, `authorization_canonical`, `execution_owner`,
   `trigger_request_id`, `originating_capture_id`,
   `originating_occurrence_id`, `rule_identity`, and `rule_version`.
   RCV-020 capture/occurrence references have restrictive FKs. Checks enforce
   the exact OPERATOR versus RCV020_RESEARCH_REQUEST field set, non-empty
   required text, positive `rule_version`, and XOR when an originating
   reference is supplied. Indexes: unique `operation_id`, trigger type.
4. **`research_operation_lifecycle_events`** — PK `event_id`; required
   `operation_id` FK, closed `event_type` domain containing only `CLOSED`,
   `event_at`, `actor_identity`, canonical version/bytes/hash, and
   `created_at`. Unique `(operation_id, event_type)` (equivalently one close
   event per operation). Checks require non-empty actor, supported version,
   and 32-byte hash. Index `(operation_id, event_at, event_id)`; the verifier
   enforces event time after creation and no event after closure.
5. **`research_runs`** — PK `run_id`; required `operation_id` FK,
   `strategy_identity`, `strategy_version`, `provider_identity`,
   `adapter_identity`, `adapter_version`, `execution_parameters_canonical`,
   `run_created_at`, immutable `deadline_at`, canonical version/bytes/hash,
   and `created_at`; nullable `predecessor_run_id` is a restrictive self-FK.
   Checks require non-empty identities, positive strategy version, deadline
   not before creation, and predecessor different from self. Indexes:
   `(operation_id, run_created_at, run_id)` and `predecessor_run_id`.
6. **`research_run_lifecycle_events`** — PK `event_id`; required `run_id` FK,
   closed `event_type` domain containing only `STARTED`, `event_at`,
   `execution_authority`, canonical version/bytes/hash, and `created_at`.
   Unique `(run_id, event_type)`; checks require non-empty execution
   authority, supported version, and 32-byte hash. Index `(run_id, event_at,
   event_id)`; the verifier enforces PLANNED → RUNNING ordering.
7. **`research_run_terminal_resolutions`** — PK `resolution_id`; required
   `run_id` (unique FK), closed terminal outcome, `terminal_at`,
   `completion_authority`, immutable `result_manifest_canonical`,
   `result_manifest_hash`, `result_count BIGINT`, canonical version/bytes/hash,
   and `created_at`. Checks require non-empty completion authority,
   `result_count >= 0`, 32-byte hashes, and `SUCCESS_NO_RESULTS` to have zero
   count and an empty manifest. `SUCCESS_WITH_RESULTS` requires a positive
   count; FAILED/TIMED_OUT may retain any already-authenticated result count.
   Index `(run_id, terminal_at)`; manifest member existence/order is verified
   against ProviderResult rows.
8. **`research_attempts`** — PK `attempt_id`; required `run_id` FK,
   `attempt_number BIGINT`, `started_at`, canonical version/bytes/hash, and
   `created_at`; nullable `predecessor_attempt_id`. Unique `(run_id,
   attempt_number)` and unique `(attempt_id, run_id)` support a composite
   same-Run predecessor FK `(predecessor_attempt_id, run_id)` back to this
   table. Checks require `attempt_number >= 1`, predecessor different from
   self, supported version, and 32-byte hash. Index `(run_id, started_at,
   attempt_id)`.
9. **`research_attempt_resolutions`** — PK `resolution_id`; required
   `attempt_id` (unique FK), closed technical outcome domain `SUCCEEDED` or
   `FAILED`, `terminal_at`, canonical version/bytes/hash, and `created_at`;
   nullable `failure_authority` is optional for ordinary FAILED resolutions,
   required for a FAILED resolution caused by Run-deadline expiry, and
   forbidden for SUCCEEDED. When present, it is non-empty technical diagnostic
   provenance only. Index `(attempt_id, terminal_at)`; the verifier enforces
   `terminal_at >= started_at` and one immutable resolution.
10. **`research_provider_results`** — PK `result_id`; required `run_id` FK,
    `provider_item_identity`, `provider_envelope_canonical`,
    `provider_identity`, `adapter_identity`, `adapter_version`,
    `result_observed_at`, descriptive non-empty `protocol_result_status`,
    canonical version/bytes/hash, and `created_at`; nullable
    `provider_source_time`. No uniqueness is imposed on provider item identity
    because repeated provider observations remain distinct results. Indexes:
    `(run_id, result_observed_at, result_id)` and provider item identity.
11. **`research_result_selections`** — PK `selection_id`; required
    `provider_result_id` FK, `selection_authorization`,
    `selected_artifact_identity`, deterministic intended
    `observation_occurrence_id` (unique binding
    identity, not an RCV-021 occurrence), `selected_at`, canonical
    version/bytes/hash, and `created_at`. No nullable semantic binding is
    needed: the intended RCV-020 identity is allocated before insertion. The
    RCV-020 occurrence row may be absent when downstream creation fails, but
    when present it must use that exact identity. Indexes: provider result,
    intended occurrence, and `(selected_at, selection_id)`. Selection is
    append-only; downstream success never updates it.

The migration must create only these columns, constraints, indexes, and
immutability protections. No derived state, queue, diagnostic table, or
convenience aggregate is part of the authoritative schema.

## 3. ResearchOperation

`research_operations` is immutable creation authority. It contains only:

- `operation_id`;
- purpose and scope;
- trigger/authorization binding identity;
- subject-binding identity;
- `operation_created_at`;
- Contract/schema version;
- operation canonical bytes and SHA-256 hash.

Creation establishes lifecycle `OPEN`; no mutable authoritative state column
is stored. The operation identity is the idempotency identity. The same
identity and canonical is idempotent; the same identity with divergent
canonical fails closed; a different identity remains distinct.

The operation lifecycle is exactly `OPEN → CLOSED`. Closure is represented by
one immutable `research_operation_lifecycle_events` row. Closure is explicit
and authenticated; a Run outcome never closes the Operation. A Run insert is
rejected once a valid close event exists.

## 4. SubjectBinding

`research_operation_subject_bindings` is a one-to-one immutable child of an
Operation. It has:

- `subject_binding_id`;
- `operation_id` (unique);
- closed `subject_type` exactly:
  `RCV020_CAPTURE`, `RCV020_OBSERVATION_OCCURRENCE`,
  `RCV020_RESEARCH_TRIGGER_REQUEST`, `AUTHENTICATED_OPERATOR_REQUEST`, or
  `HISTORICAL_CLAIM_IDENTITY`;
- exactly one matching typed reference;
- canonical version, canonical bytes, and SHA-256 hash.

The physical representation uses typed nullable references plus an exact XOR
constraint: one and only one reference is present, and it is the reference
allowed by `subject_type`. RCV-020 references use restrictive/no-action
foreign keys. Operator-request and historical-Claim references are opaque
authenticated identities; no current Claim lookup is permitted. No generic
subject column exists.

## 5. TriggerBinding

`research_operation_trigger_bindings` is a one-to-one immutable child of an
Operation. Its closed `trigger_type` is exactly `OPERATOR` or
`RCV020_RESEARCH_REQUEST`.

For `OPERATOR`, it preserves authenticated initiator identity, authorization
context, creation time, execution owner/context, and canonical/hash/version.

For `RCV020_RESEARCH_REQUEST`, it preserves the exact persisted trigger
identity, originating Capture or ObservationOccurrence reference where
supplied, deterministic rule identity/version, creation time, execution
owner, and canonical/hash/version.

Per-trigger fields use an exact discriminator/XOR rule. `SYSTEM` and `POLICY`
are rejected. Trigger creation cannot be inferred from current Claim state,
current configuration, coverage absence, current source state, or mutable
operational state.

## 6. OperationLifecycleEvent

`research_operation_lifecycle_events` is append-only immutable lifecycle
authority. Operation creation is the immutable `OPEN` fact; the only
transition event is authenticated `CLOSED`.

Each event preserves event identity, Operation identity, event type, event
time, actor/authorization identity, canonical version, canonical bytes, and
hash. At most one close event is permitted. Events after closure and any Run
created after closure fail closed. No UPDATE or DELETE is used for lifecycle
history.

## 7. ResearchRun

`research_runs` is immutable creation authority for one historical execution
occurrence under one Operation. It contains:

- `run_id` and `operation_id`;
- exact strategy/query identity and version;
- provider identity;
- adapter identity/version;
- execution parameters;
- `run_created_at`;
- immutable deadline;
- optional terminal predecessor Run identity for a Rerun;
- Contract/schema version, canonical bytes, and hash.

It excludes ProviderResult rows, result count, result manifest, completion
metadata, terminal outcome, and terminal time. ProviderResult insertion and
terminal resolution therefore never rewrite Run canonical bytes.

The Run identity is independent of query/result content. Distinct Runs remain
distinct even when every result byte is equivalent.

## 8. RunLifecycleEvent

`research_run_lifecycle_events` is append-only immutable lifecycle authority.
Run creation establishes `PLANNED`; one authenticated start event establishes
`RUNNING`. A Run terminal resolution establishes the terminal state but does
not mutate the parent Run.

Each lifecycle event preserves event identity, Run identity, event type,
event time, execution authority, canonical version, canonical bytes, and hash.
There is at most one start event and no event after terminal resolution.
Ordering is `PLANNED → RUNNING → terminal`; database row order is irrelevant.

## 9. RunTerminalResolution

`research_run_terminal_resolutions` has exactly one immutable row per Run.
It contains:

- resolution identity and Run identity;
- one terminal outcome: `SUCCESS_WITH_RESULTS`, `SUCCESS_NO_RESULTS`,
  `FAILED`, or `TIMED_OUT`;
- `terminal_at`;
- completion authority;
- final ordered ProviderResult identity/hash manifest and manifest hash;
- final result-count snapshot;
- canonical version, canonical bytes, and hash.

The manifest and count are derived only from authenticated ProviderResult rows
at terminalization and are then immutable resolution authority. A live count
is a derived projection only. `SUCCESS_NO_RESULTS` has count zero and an empty
manifest; it is never a world-absence or truth claim.

ProviderResults arriving after terminal resolution are late activity. They
cannot rewrite the Run, terminal resolution, or prior result manifest and
cannot change the terminal outcome. V1 rejects such ProviderResult inserts;
no diagnostic row is part of the RCV-021 authority set.

## 10. ResearchAttempt and Retry

`research_attempts` is immutable technical-attempt authority under one Run. It
contains:

- attempt identity and Run identity;
- exact positive `attempt_number` (first attempt is `1`);
- optional predecessor attempt identity;
- `started_at`;
- canonical version, canonical bytes, and hash.

Attempt number is physically PostgreSQL `BIGINT NOT NULL` with a database
minimum of `1`. The application boundary accepts only an exact decimal string
or JavaScript `BigInt`, serializes it as canonical base-10 text, and binds it
to PostgreSQL as decimal text/parameter data. JavaScript `Number` coercion,
rounding, truncation, clamping, and any global parser that narrows the
physical domain are forbidden. There is no semantic maximum below the
PostgreSQL BIGINT maximum; Retry still requires predecessor number plus one.

`research_attempt_resolutions` has exactly one immutable row per Attempt. It
contains resolution identity, Attempt identity, terminal technical outcome
(`SUCCEEDED` or `FAILED`), terminal time, optional failure authority/diagnostic
for ordinary `FAILED` outcomes, required deadline-expiry provenance for a
deadline-caused `FAILED` outcome, canonical version, canonical bytes, and hash.

A Retry must be in the same Run, reference a terminal `FAILED` predecessor,
start strictly after the predecessor terminal time, and have number exactly
predecessor number plus one. Lineage is acyclic. A speculative parallel
attempt is not Retry authority. Attempt and resolution rows are never updated
or deleted. Every started Attempt must receive exactly one terminal
resolution. A Run cannot terminalize while any started Attempt is unresolved.
If the immutable Run deadline expires while an Attempt is active, the Attempt
is resolved `FAILED` with technical deadline-expiry provenance before the Run
resolves `TIMED_OUT`; no Retry may begin after Run terminalization. The timing
rules are `attemptStartedAt <= attemptTerminalAt <= runTerminalAt`, and a
`TIMED_OUT` Run has `runTerminalAt >= deadline` after all active Attempts are
resolved.

### 10.1 Owner-selected deadline provenance working representation

The owner selected a versioned structured deadline-cause representation in the
existing optional `failure_authority` field. The exact working schema,
legacy-evidence distinction and implementation scope are documented in
`docs/provenance/rcv021-deadline-provenance-working-basis-v1.md`.
Ordinary FAILED provenance remains optional. Historical canonical bytes and
hashes are never rewritten. Canonical authentication of legacy text does not
establish fully qualified deadline-cause evidence. This working representation
and the source-level counterexamples are not physical requalification,
a complete transaction-context proof, freeze or Snapshot-Lock.

## 11. Rerun

A Rerun is a new `research_runs` row under the same `OPEN` Operation. It may
reference one terminal predecessor Run, must be created after that
predecessor's terminal time, and has a new identity and execution timestamps.
No numeric rerun sequence is semantic authority. A nonterminal Run is
recovered with Retry rather than a parallel Rerun. Rerun lineage is acyclic;
the predecessor is never mutated.

## 12. ProviderResult

`research_provider_results` is append-only authority only for:

“This provider returned this result or metadata under this recorded Run.”

Each row contains result identity, Run identity, provider item identity and
metadata, provider response/result envelope, provider identity,
adapter/version, `result_observed_at`, optional provider/source timestamp,
protocol result status, canonical version, canonical bytes, and hash.

The protocol result status is descriptive provider-response status; it is not
truth, evidence, selection, Capture, or Handoff authority. A ProviderResult
does not mutate its Run. Unselected metadata remains RCV-021 history only.

One Run may have zero, one, or many ProviderResults. When included in a
terminal manifest, result identities are sorted by their UTF-8 identity text
ascending (with the result hash as a deterministic tie-breaker); insertion or
database row order is never used.

## 13. ResultSelection / ResultBinding

`research_result_selections` is one append-only immutable authority for:

`ProviderResult → selected artifact → intended RCV-020 observation binding`.

It contains selection identity, ProviderResult identity, selection
authorization, selected-artifact identity, a deterministic intended RCV-020
ObservationOccurrence identity, `selected_at`, canonical version, canonical
bytes, and hash. The intended occurrence identity is the sole cross-authority
binding reference; it is not an RCV-021 occurrence.

Selection does not mutate ProviderResult and does not mean that RCV-020
retrieval or Capture succeeded. If RCV-020 occurrence creation or retrieval
fails, the ProviderResult and Selection remain valid; RCV-020 independently
records its failure. Selection is therefore independently provable from
provider return and observation success.

## 14. RCV-020 integration

RCV-021 uses a narrow binding adapter. For each selected artifact it passes
the immutable intended `observation_occurrence_id` and the ordinary frozen
RCV-020 EXTERNAL caller fields to the existing RCV-020 path. RCV-020 itself
constructs the unchanged `RCV020-TRIGGER-V1` envelope and its hash; that
envelope contains only its existing trigger fields and no RCV-021 provenance
identities.

RCV-020 remains sole authority for the resulting ObservationOccurrence,
RetrievalAttempt, Capture, raw-object protocol, comparison, retention,
coverage, AuthenticatedHandoff, and historical verification. No RCV-020 enum,
canonical rule, table, or semantic state is changed. Existing external
authority already provides `trigger_origin = EXTERNAL`, trigger canonical and
hash, trigger receipt time, occurrence identity, and immutable cutoff.

V1 is co-located: RCV-021 and RCV-020 authoritative tables use the same
PostgreSQL database. The boundary has three explicit transactions. **T0**
validates and commits each ProviderResult independently; a ProviderResult does
not require a Selection. **T1** validates and commits only a ResultSelection,
referencing an already committed ProviderResult and including the unique
deterministic intended `observation_occurrence_id`; no second request key is
introduced. **T2**, using the existing RCV-020 transaction client, submits the
EXTERNAL occurrence request with that caller-supplied occurrence identity and
ordinary frozen trigger fields. RCV-020 constructs its fixed trigger
canonical/hash internally. The adapter treats an existing occurrence as
idempotent only when its immutable occurrence canonical/hash and generated
trigger canonical/hash match; any divergence is a conflict. T2 commits only
the RCV-020 ObservationOccurrence request/binding. Retrieval, attempt resolution,
Capture, comparison, retention, and AuthenticatedHandoff occur later in their
existing RCV-020 transaction boundaries. Thus the valid historical states are:
(A) ProviderResult only, meaning the provider returned it and it was not
selected; (B) ProviderResult plus Selection with no RCV-020 occurrence, meaning
selection/observation intent exists but downstream binding has not succeeded;
and (C) ProviderResult plus Selection plus the RCV-020 occurrence, meaning the
selected result entered the observation path. If T2 or any later RCV-020
execution fails, T0/T1 authority remains valid and immutable; no RCV-021 row is
rewritten and no Capture or Handoff is inferred. This is an intentional
authenticated historical boundary, not a distributed-transaction claim.

## 15. Same-content distinct history

Physical object deduplication is permitted, but the following identities must
remain distinct and independently verifiable:

ResearchOperation, ResearchRun, ResearchAttempt, ProviderResult,
ResultSelection, RCV-020 ObservationOccurrence, RCV-020 RetrievalAttempt, and
RCV-020 Capture. Content hash is never an occurrence or operation identity.

## 16. Time and ordering

The persisted times are:

- `operationCreatedAt`;
- operation close-event time;
- `runCreatedAt`;
- Run start-event time;
- attempt `startedAt` and attempt terminal time;
- Run `terminalAt`;
- `resultObservedAt`;
- `selectedAt`;
- optional provider/source timestamp;
- immutable Run deadline.

Required ordering is operation creation before close or Run creation; Run
creation before start; start before attempts; attempt start no later than its
attempt terminal (`attemptStartedAt <= attemptTerminalAt`); Retry start after
failed predecessor terminal time; Rerun creation
after terminal predecessor Run; result observation before selection; and
selection before any requested RCV-020 observation execution. Provider/source
time is metadata and may precede or follow observation time. RCV-020
`observedAt` and downstream RCV-019 `knowledgeAt` remain separate. Historical
verification never uses the current clock.

## 17. Secret and credential boundary

Canonical and persisted semantic authority may contain only credential-reference
identity/version, authorized provider-account identity where applicable, and
redacted execution representation. Token, password, API-key, and other
secret plaintext are excluded from canonical bytes, hashes, logs, and
historical result envelopes. Read verification requires no live credentials.

## 18. Canonical, hash, and version model

All eleven authoritative object types use one RCV-021 canonicalization
convention consistent with RCV-020: versioned deterministic JSON canonical
bytes, explicit null/absence representation, UTF-8 byte stability, and
SHA-256 hash over those bytes. Object member names use the canonical-json
lexicographic ordering already used by RCV-020.

Canonical envelopes include only the fields specified for that object above.
Unordered/set-semantic collections are sorted by the UTF-8 bytes of each
element's complete canonical JSON representation, ascending. Ordered or
sequence-semantic collections preserve the persisted authoritative order
exactly; their sequence position is part of the persisted envelope rather
than an incidental array position. Database row order, insertion order,
query-plan order, and runtime collection order are never authority.

Provider-return order, when supplied by the provider and retained in the
provider envelope, is preserved as historical provider metadata only. It does
not establish epistemic ranking or evidence authority. The terminal
ProviderResult manifest is an unordered membership set: its members are the
ProviderResult identities sorted by UTF-8 identity text ascending, with the
result hash as a deterministic tie-breaker (unreachable for distinct UUID
identities). No semantic ordinal is invented. Current clock, current
configuration, provider re-query, and mutable availability are excluded.
Unsupported canonical/schema versions fail closed. Same supplied historical
inputs produce identical bytes and hashes.

The only new semantic integer is `research_attempts.attempt_number`, which is
exact positive decimal/BigInt-safe and has no semantic maximum below the
physical domain. No JavaScript Number coercion, rounding, truncation, or
global PostgreSQL parser is permitted.

## 19. Write verification

The WriteVerifier validates, before persistence:

1. required object presence and structural shape;
2. supported Contract/canonical versions;
3. canonical reconstruction and exact hash;
4. identities and parent relationships;
5. SubjectBinding and TriggerBinding discriminator/XOR rules;
6. Operation and Run lifecycle ordering;
7. timestamps, deadlines, Retry and Rerun lineage;
8. ProviderResult and terminal manifest/count consistency;
9. ResultSelection authority and RCV-020 binding preconditions;
10. exact identity/canonical idempotency and divergent-conflict behavior.

Invalid authority fails closed. The verifier never normalizes or repairs input,
rewrites canonical/hash data, substitutes a newer Run, or consults current
state.

## 20. Transaction boundaries

V1 is deployed with RCV-021 and RCV-020 in the same PostgreSQL database. Each
independent RCV-021 authority unit is committed in one transaction: Operation
creation with its two binding rows; Operation close; Run creation with any
Rerun predecessor validation; Run start; Attempt creation/resolution;
ProviderResult insertion (T0, independently selectable); ResultSelection
insertion (T1, only after its ProviderResult exists); and Run terminal
resolution. A failed unit rolls back all rows in that unit.

The research-to-observation boundary is intentionally staged because a
downstream observation may fail without invalidating the already-authenticated
research result. **T0** commits ProviderResult independently. **T1** commits a
ResultSelection referencing that ProviderResult and persisting exactly one
deterministic intended `observation_occurrence_id`. **T2** is the existing
RCV-020 transaction that inserts the EXTERNAL ObservationOccurrence request/
binding using that caller-supplied occurrence identity and ordinary frozen
trigger fields; RCV-020 constructs the fixed trigger canonical/hash internally.
The sole cross-authority idempotency identity is `observation_occurrence_id`.
A repeat with the same occurrence identity and matching immutable occurrence
and generated-trigger authority is idempotent; a divergent authority is a
conflict. No second request key or cross-authority hash is introduced.
T2 commits only the RCV-020 occurrence request/binding. RetrievalAttempt,
Capture, comparison, retention, and AuthenticatedHandoff remain later
RCV-020 transactions.

If T2 or any later RCV-020 transaction fails, T0/T1 ProviderResult and
ResultSelection authority remain valid, immutable, and historically
verifiable. No
RCV-021 row is rewritten and no Capture or Handoff is inferred. Finalized raw
objects belong to the delegated RCV-020 protocol and may be orphaned after a
relational rollback; they are never authority by themselves. This boundary
provides retry-safe authenticated handoff without claiming a distributed
transaction.

## 21. Historical ReadRepository

The exact historical read graph is:

`ResearchOperation → SubjectBinding → TriggerBinding → OperationLifecycleEvent
→ ResearchRuns → RunLifecycleEvent → RunTerminalResolution → ResearchAttempts
→ AttemptResolution → ProviderResults → ResultSelections → referenced RCV-020
authority`.

Reads use exact identities, explicit parent predicates, stable canonical
ordering, and exact timestamp/integer representations. No current provider,
endpoint, configuration, parser, credential, Claim, scheduler, availability,
or external-truth lookup is permitted.

## 22. Independent ReadVerifier

The ReadVerifier reconstructs the graph from persisted rows and independently
checks versions, canonical/hash, identity, subject/trigger XOR, lifecycle,
terminal uniqueness, result manifest/count, Retry and Rerun lineage,
ordering/deadline, Selection and RCV-020 binding, and same-content distinct
history. It does not trust WriteVerifier acceptance.

The verifier is read-only. It never inserts repair rows, updates or deletes
history, rewrites canonical/hash values, repairs lineage, or selects newer
records as substitutes. A current-state projection, if present, is ignored
for verification.

## 23. Design-level failure taxonomy and precedence

The minimum deterministic classes are:

`MISSING_DATA`, `MALFORMED_DATA`, `VERSION_MISMATCH`, `CANONICAL_MISMATCH`,
`HASH_MISMATCH`, `IDENTITY_MISMATCH`, `DUPLICATE_CONFLICT`,
`SUBJECT_BINDING_VIOLATION`, `TRIGGER_BINDING_VIOLATION`,
`ORDERING_VIOLATION`, `DEADLINE_VIOLATION`, `LIFECYCLE_VIOLATION`,
`RETRY_LINEAGE_VIOLATION`, `RERUN_LINEAGE_VIOLATION`,
`TERMINAL_RESOLUTION_MISMATCH`, `RESULT_MANIFEST_MISMATCH`,
`RESULT_BINDING_VIOLATION`, `RCV020_BINDING_VIOLATION`,
`CURRENT_STATE_SUBSTITUTION`, and `UNSUPPORTED_STATE`.

When multiple failures coexist, the deterministic precedence is exactly the
listed order. Same-class ties use canonical path ordering. Database row order,
query plan, and insertion order cannot affect the returned class or path.

## 24. Concurrency and idempotency

Concurrency-critical identities are Operation, close event, Run, terminal
resolution, Attempt number, ProviderResult, ResultSelection, the intended
RCV-020 ObservationOccurrence identity, and the RCV-020 Handoff key.

The required behavior is:

- Operation create versus close/Run create is serialized by Operation identity;
  a closed Operation admits no Run.
- Same Run/Attempt/Result/Selection identity and same canonical is
  deterministic idempotency.
- Same identity and divergent canonical is a conflict.
- Different identities with equivalent content remain distinct.
- Only one terminal resolution exists per Run and one resolution per Attempt.
- Attempt-number uniqueness and predecessor validation prevent retry-lineage
  corruption.
- RCV-020 binding reuses the caller-supplied occurrence identity and existing
  canonical/conflict authority; the RCV-021 adapter provides race-safe
  idempotent comparison without adding an RCV-020 key or column.
- Deadlocks are avoided or surfaced as controlled technical failures; no
  unspecified winner or semantic retry is invented.

## 25. Additive migration design

One RCV-021 migration is appended after RCV-020. It creates only the eleven
authoritative object sets listed in §2, their closed enums/domains, restrictive
foreign keys, exact uniqueness and XOR checks, indexes needed for historical
reconstruction, and immutable-history enforcement.

All historical foreign keys use `NO ACTION`/restrictive behavior. No
cascading historical deletion is permitted. Every authoritative object has
minimum version checks, canonical/hash shape checks, and immutable UPDATE and
DELETE protection. No RCV-020 table, enum, canonical rule, or migration is
modified.

## 26. Early physical proof plan

Before integrated implementation, use fresh disposable PostgreSQL state to
prove:

- SubjectBinding exact XOR and one-to-one Operation binding;
- TriggerBinding discriminator fields and rejection of SYSTEM/POLICY;
- Operation close versus concurrent Run creation;
- Retry-number and predecessor races;
- Rerun ordering and closed-Operation rejection;
- canonical/hash and exact timestamp/integer round trips;
- zero, one, and many ProviderResults;
- immutable terminal result manifest/count;
- ResultSelection immutability and downstream-failure preservation;
- RCV-020 EXTERNAL trigger binding without schema change;
- same-content distinct Operation/Run/Result/Occurrence/Capture identities;
- `SUCCESS_NO_RESULTS` without world-absence semantics;
- late-result immutability;
- raw-loss replayability inheritance;
- current-state-independent historical verification;
- exact duplicate/conflict behavior and no-repair.

All physical proof uses fresh disposable databases, full migrations through
RCV-020 and the additive RCV-021 migration, deterministic fixtures, explicit
snapshots, and complete cleanup. Retained databases are never touched.

## 27. Implementation waves

**Wave 1 — schema and migration.** Create the eleven object sets, references,
closed constraints, uniqueness, immutable-history enforcement, and static
catalog proof. Prerequisite: this Design and Contract audit. Non-goals:
provider execution, orchestration, and RCV-022 analysis. Done requires exact
schema/referential proof and no prior-schema drift.

**Wave 2 — pure semantic core.** Implement canonical/hash, subject/trigger,
lifecycle, terminal, Retry/Rerun, result, selection, ordering, and
idempotency validators. Prerequisite: Wave 1 PASS. Non-goals: persistence,
network, current-state reads. Done requires deterministic unit, negative,
soak, fuzz, and stress proof.

**Wave 3 — write and binding boundary.** Implement WriteVerifier,
transaction-scoped repositories, exact duplicate/conflict handling, and the
narrow RCV-020 result-binding adapter. Prerequisite: Wave 2 PASS. Non-goals:
production provider/scheduler. Done requires rollback, immutability,
concurrency, and RCV-020 integration proof.

**Wave 4 — independent historical reads.** Implement ReadRepository,
historical reconstruction, ReadVerifier, precedence, no-repair, and
current-state-independence checks. Prerequisite: Wave 3 PASS. Non-goals:
live re-execution and semantic analysis. Done requires physical corruption,
read determinism, raw-loss, and no-repair proof.

**Wave 5 — integrated active-research slice.** Connect an explicitly
deterministic test-authority adapter to Operation/Run orchestration, result
selection, RCV-020 observation/Capture/Handoff, retention inheritance, and
historical verification. Prerequisite: Wave 4 PASS. Non-goals: production
provider adapters, production scheduler, autonomous policy research, and
RCV-022 semantics. Done requires the complete integrated physical proof,
fault/concurrency matrix, soak/fuzz/stress, and regression gates.

No wave may begin until its prerequisite is PASS.

## 28. Explicit non-goals

This Design does not implement production provider adapters, a production
scheduler, autonomous SYSTEM/POLICY research, Claim extraction or matching,
evidence support/refutation or strength, source trust or independence,
semantic similarity authority, truth/falsity, research/source completeness,
direct RCV-019 mutation, RCV-022 semantics, UI/editorial workflows, or vendor
durability claims.

## 29. Design status

Every Contract authority has an implementation home in this Design. RCV-020
schema and semantics remain unchanged, and no new semantic authority is
introduced. This document is an RCV-021 Implementation Design V1 draft for
audit. It is not frozen; migration and implementation are not authorized by
this draft.
