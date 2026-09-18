# FactBase Research Scheduler / Policy Contract V1

## 1. Purpose and authority boundary

The Scheduler / Policy authority determines and records when an already
authorized RCV-021 `ResearchOperation` becomes eligible for another
`ResearchRun`. It owns temporal policy and deterministic scheduling-decision
provenance only.

The Scheduler / Policy authority does not execute research, create
`ProviderResult` records, interpret results, determine truth, determine
evidence strength, determine Claim correctness, rank sources, perform RCV-022
analysis, or own RCV-020 observation authority.

RCV-020 remains configured/passive observation authority. RCV-021 remains
active-research execution and provenance authority. RCV-022 and later
authorities remain Claim and evidence semantic-analysis authority.

The Scheduler / Policy authority MUST NOT absorb RCV-020 observation
semantics, RCV-021 execution semantics, or RCV-022 analysis semantics.

## 2. Scheduled object

The Scheduler evaluates candidate new `ResearchRun` requests only under an
existing `ResearchOperation`.

The Scheduler MUST NOT autonomously create a `ResearchOperation`. A changed
subject, purpose, scope, or authorization requires a new RCV-021
`ResearchOperation` under the RCV-021 Contract.

## 3. RUN_NOW authority

`RUN_NOW` authorizes exactly one new `ResearchRun` request under the same
existing `OPEN` `ResearchOperation` and its immutable Operation-level
authorization.

The existing Operation authorization is sufficient for repeated Runs under
that same authorized intent. No fresh RCV-021 trigger is required for this
request.

A `SchedulerDecision` for `RUN_NOW`:

- binds the `ResearchOperation` identity;
- binds the Scheduler policy identity and version;
- binds one deterministic schedule slot; and
- requests one new Run under the existing Operation authorization.

The SchedulerDecision MUST NOT:

- create an Operation;
- create a new RCV-021 `TriggerBinding`;
- impersonate `OPERATOR`;
- impersonate `RCV020_RESEARCH_REQUEST`;
- add `SYSTEM` or `POLICY` to the RCV-021 vocabulary; or
- become authority for the resulting Run.

RCV-021 remains sole authority for the resulting `ResearchRun` and all of
its execution, result, retry, rerun, and observation-binding semantics.

## 4. RCV-021 trigger boundary

The RCV-021 trigger vocabulary remains exactly:

- `OPERATOR`;
- `RCV020_RESEARCH_REQUEST`.

A SchedulerDecision is not an RCV-021 trigger and does not alter the RCV-021
Contract, Design, schema, or trigger vocabulary.

An autonomous scheduler-origin trigger independent of existing Operation
authorization is outside V1 and would require explicit future RCV-021
authority.

## 5. Scheduler policy authority

One Scheduler policy stream is bound to one `ResearchOperation`.

Each immutable policy version binds:

- policy identity;
- Operation identity;
- monotonically increasing policy version;
- enabled state;
- authenticated policy-version creation authority and creation time;
- immutable UTC `effectiveAt`;
- immutable UTC `firstEligibilityAt`;
- one positive fixed interval represented as an exact decimal integer number
  of microseconds;
- canonical version;
- canonical bytes; and
- SHA-256 hash of the canonical UTF-8 bytes.

Policy versions are append-only and immutable. A policy version MUST NOT be
rewritten, deleted, or repaired. A current-policy pointer, queue state, or
runtime configuration is derived operational state and is not historical
authority.

Within V1, all versions in one policy stream retain the same
`firstEligibilityAt` and fixed interval. Changing the cadence interval
requires a separately authorized future policy stream or later Contract
authority and is not supported by this V1 stream rule.

V1 has no maximum research age, maximum run count, date horizon, policy
expiry, outcome-based delay, or separate minimum/maximum cadence authority.
The positive fixed interval is the complete V1 cadence constraint.

## 6. Policy version transitions

Policy versions in one stream have strictly increasing `effectiveAt` values.
For an unissued slot, the applicable version is the highest version whose
`effectiveAt` is less than or equal to that slot's `scheduledAt`.

The initial policy version MUST have `effectiveAt` less than or equal to
`firstEligibilityAt`. Therefore slot `0` always has an applicable initial
policy version and V1 has no initial applicability gap.

The initial-version invariant makes an applicable version exist for every
valid slot. If malformed history presents no applicable version, the
Scheduler fails closed. If the applicable version is disabled, the slot
produces `NO_ACTION` with reason `POLICY_DISABLED`.

A new version supersedes an older version only for future unissued slots at
or after its `effectiveAt`. It MUST NOT rewrite prior slots or decisions.
An existing decision permanently owns its slot under the policy version that
produced it. An older and newer version MUST NOT co-own a slot.

Policy changes therefore remain historically verifiable under the exact
version that produced each decision. A later version cannot reinterpret a
historical decision.

## 7. Schedule-slot identity

The canonical schedule-slot identity is the tuple:

`(operation_id, policy_id, slot_index)`

`slot_index` is a non-negative exact integer transported as a decimal string
or equivalent arbitrary-precision integer representation. The first slot is
index `0`. Policy version is not part of slot identity. `scheduledAt` is
derived from immutable policy authority and persisted in the decision for
verification.

No two policy versions may own the same slot. Equal content in different
slot identities MUST NOT be collapsed.

## 8. Slot arithmetic

For slot index `n`:

`scheduledAt(n) = firstEligibilityAt + n × fixedInterval`

The arithmetic is exact UTC microsecond arithmetic over integer values. It
MUST NOT use floating point, rounding, truncation, locale-sensitive parsing,
wall-clock calendar arithmetic, or DST interpretation. Arithmetic overflow or
malformed timestamp authority fails closed.

Historical verification MUST use the persisted policy and supplied evaluation
time only; it MUST NOT substitute the current clock.

## 9. Missed-slot coalescing

For an evaluation timestamp `E`:

- if `E < firstEligibilityAt`, no slot is due;
- otherwise, `n = floor((E - firstEligibilityAt) / fixedInterval)`.

If `E < firstEligibilityAt`, the Scheduler may return the transient
evaluation result `SCHEDULE_LATER / NOT_YET_ELIGIBLE` with the exact next
scheduled time. This result has no SchedulerDecision identity, consumes no
slot, and is not persisted historical authority.

For `E >= firstEligibilityAt`, only slot `n` is evaluated. All earlier
unissued or missed slots are coalesced; the Scheduler MUST NOT emit one
decision or Run per missed slot. A slot identity is consumed only when an
immutable persisted SchedulerDecision is created for that due slot.

When a due slot is persistently consumed, its selected slot identity and
`scheduledAt` MUST be persisted. When a slot is evaluated normally, the next
slot is:

`nextEligibleAt = firstEligibilityAt + (n + 1) × fixedInterval`.

If slot `n` already has a decision, the existing immutable decision is the
idempotent result before any current policy evaluation; it MUST NOT be
replaced by a later policy version or reclassified by current policy state.

Persisted SchedulerDecisions in one policy stream also form one immutable
predecessor chain. A chain genesis has both `previousDecisionIdentity` and
`previousDecisionCanonicalHash` equal to explicit canonical `null`. Every
non-genesis decision MUST reference the immediately preceding decision in the
same policy stream and its independently reconstructed canonical SHA-256 hash.
There MUST be exactly one genesis for a non-empty stream, at most one
successor for any predecessor, and no cycle, forward reference, disconnected
node, or missing predecessor. The complete chain MUST cover every persisted
decision in the stream exactly once. Along the authenticated chain, each
successor `slot_index` MUST be strictly greater than its predecessor's.

This is logical Scheduler authority order only. It is not PostgreSQL physical
insertion order, transaction-ID order, commit-timestamp order, wall-clock
order, `evaluationAt` order, or `scheduledAt` order. A decreasing or equal
slot index on a chain edge fails closed as retroactive or conflicting history.

## 10. SchedulerDecision authority

The Scheduler distinguishes a transient Scheduler evaluation result from a
persisted SchedulerDecision. A transient evaluation result is deterministically
derived from persisted Scheduler policy authority, persisted historical
RCV-021 authority, and a supplied immutable `evaluationAt`; it may be returned
to a caller but does not prove that an evaluation historically occurred.

A persisted SchedulerDecision is created only when a concrete due schedule
slot is consumed. It is immutable and owns exactly one slot identity:
`(operation_id, policy_id, slot_index)`. There is no evaluation identity or
evaluation entity in V1.

The complete canonical input field set below applies only to persisted
SchedulerDecision authority:

- canonical schema and version;
- SchedulerDecision identity, which is exactly
  `(operation_id, policy_id, slot_index)`;
- `operation_id`;
- `policy_id`;
- exact policy version identity;
- policy-version canonical and hash reference;
- `slot_index`;
- `scheduledAt`;
- supplied UTC `evaluationAt`;
- decision;
- reason;
- `nextEligibleAt`;
- immutable Operation lifecycle-prefix identity and hash;
- conditional immutable nonterminal-Run evidence; and
- conditional emitted `RUN_NOW` request/binding authority;
- `previousDecisionIdentity`; and
- `previousDecisionCanonicalHash`.

The canonical field set MUST contain no mutable or current-state field.

`previousDecisionIdentity` is the exact SchedulerDecision identity tuple
`(operation_id, policy_id, slot_index)`. Both predecessor fields are always
present canonically. They are both `null` for genesis and both non-null for a
non-genesis decision. A predecessor hash MUST match the independently
reconstructed canonical bytes of that predecessor. A predecessor never stores
successor information, so this dependency is acyclic.

`SCHEDULE_LATER / NOT_YET_ELIGIBLE` is evaluation-only. It has no
SchedulerDecision identity, no slot identity, consumes no slot, and has no
persisted SchedulerDecision canonical bytes or hash. It never transitions into
or replaces a later SchedulerDecision.

The Operation lifecycle-prefix authority is always present. Nonterminal-Run
evidence is non-null exactly when the reason is `ACTIVE_RUN` and is `null`
otherwise. For `ACTIVE_RUN`, it contains the blocking Run identity, Run
creation identity and hash, lifecycle-prefix identity and hash, explicit
historical `PLANNED` or `RUNNING` state, and a RUNNING event identity and hash
only when the state is `RUNNING`.

The emitted `RUN_NOW` request/binding is non-null exactly when the decision is
`RUN_NOW` and is `null` otherwise. `nextEligibleAt` is `null` exactly for
`OPERATION_CLOSED` and `POLICY_DISABLED`, and is non-null for every other
valid decision. All conditional absence is represented by explicit canonical
`null`; omission is not a second representation.

The persisted SchedulerDecision decision vocabulary is exactly:

- `RUN_NOW`; and
- `NO_ACTION`.

The transient Scheduler evaluation result may additionally use
`SCHEDULE_LATER`. No other persisted SchedulerDecision state exists.

## 11. Decision reason vocabulary and consistency

The closed V1 reason vocabulary is exactly:

- `INITIAL_ELIGIBILITY`;
- `INTERVAL_ELIGIBILITY`;
- `NOT_YET_ELIGIBLE`;
- `ACTIVE_RUN`;
- `OPERATION_CLOSED`;
- `POLICY_DISABLED`;
- `MISSED_SLOT_COALESCED`.

`OPERATOR_OVERRIDE` is not a Scheduler reason. An authenticated operator
request remains solely RCV-021 authority.

The valid persisted SchedulerDecision decision/reason combinations are:

| Condition | Decision | Reason | `nextEligibleAt` |
|---|---|---|---|
| no existing decision and Operation is historically closed | `NO_ACTION` | `OPERATION_CLOSED` | `NULL` |
| no existing decision and effective policy version is disabled | `NO_ACTION` | `POLICY_DISABLED` | `NULL` |
| no existing decision and an applicable Run is historically active | `NO_ACTION` | `ACTIVE_RUN` | next exact slot |
| no existing decision, first due slot, no active Run | `RUN_NOW` | `INITIAL_ELIGIBILITY` | next exact slot |
| no existing decision, later due slot, no earlier slot was coalesced | `RUN_NOW` | `INTERVAL_ELIGIBILITY` | next exact slot |
| no existing decision, due slot with at least one earlier missed/unissued slot coalesced | `RUN_NOW` | `MISSED_SLOT_COALESCED` | next exact slot |

No other combination is valid.

The Scheduler evaluation result may additionally be transient
`SCHEDULE_LATER / NOT_YET_ELIGIBLE`. It may also transiently return
`NO_ACTION / OPERATION_CLOSED` or `NO_ACTION / POLICY_DISABLED` when the
next slot is not yet due. Those transient results are not persisted
SchedulerDecision combinations.

For every evaluation, the precedence is exactly:

1. authenticate an existing persisted decision for the selected due slot;
2. `OPERATION_CLOSED`;
3. `POLICY_DISABLED`;
4. `NOT_YET_ELIGIBLE`;
5. `ACTIVE_RUN`; and
6. eligible `RUN_NOW` reason selection.

`OPERATION_CLOSED` and `POLICY_DISABLED` may therefore produce transient
pre-due results. `NOT_YET_ELIGIBLE` is always transient. `ACTIVE_RUN` and
`RUN_NOW` apply only once a concrete slot is due. For a due, unconsumed slot,
the persisted decision precedence is exactly `OPERATION_CLOSED`,
`POLICY_DISABLED`, `ACTIVE_RUN`, and eligible `RUN_NOW` reason selection.

Therefore `CLOSED` wins over disabled policy or any Run state; disabled policy
wins over a nonterminal Run; not-yet-eligible wins over a nonterminal Run; and
a nonterminal Run blocks only an otherwise-due slot. An existing due-slot
decision is authenticated before this precedence is evaluated: same slot
identity and same immutable authority is idempotent, while divergent
authority fails closed.

`NOT_YET_ELIGIBLE` is valid only when the selected next slot is not yet due.
`MISSED_SLOT_COALESCED` is valid only for a due slot with at least one earlier
unissued slot coalesced.

## 12. Next eligibility

For a persisted SchedulerDecision, `nextEligibleAt` is immutable and is
derived from the exact slot arithmetic. For a transient evaluation result,
`nextEligibleAt` is only a deterministic derived output and is not historical
SchedulerDecision authority. A transient `NOT_YET_ELIGIBLE` result returns
the exact next scheduled slot; a transient pre-due `OPERATION_CLOSED` or
`POLICY_DISABLED` result returns `NULL`.

For persisted SchedulerDecisions, `nextEligibleAt` is `NULL` only when the
Operation is historically `CLOSED` or the effective policy version is
disabled.

For `ACTIVE_RUN` on an otherwise-due slot, the evaluated slot is consumed and
`nextEligibleAt` is the immediately following deterministic slot. The same
following-slot rule applies to `RUN_NOW`. For `SCHEDULE_LATER`,
`nextEligibleAt` is the exact next scheduled slot owned by the applicable
enabled policy version.

A later enabled policy version may establish new future eligibility. No
existing decision is altered.

## 13. Operation-closed authority

If the Operation is historically `CLOSED` at `evaluationAt`:

- decision is `NO_ACTION`;
- reason is `OPERATION_CLOSED`; and
- `nextEligibleAt` is `NULL`.

If the next schedule slot is not yet due, this is a transient evaluation
result only: no SchedulerDecision is persisted and no future slot is
consumed. If a concrete slot is already due, the result is the persisted
`NO_ACTION / OPERATION_CLOSED` decision for that due slot.

The Scheduler MUST NOT create or request a Run under a closed Operation.

## 14. Policy-disabled authority

If the effective policy version is disabled at the evaluated slot:

- decision is `NO_ACTION`;
- reason is `POLICY_DISABLED`; and
- `nextEligibleAt` is `NULL`.

If the next schedule slot is not yet due, this is a transient evaluation
result only: no SchedulerDecision is persisted and no future slot is
consumed. If a concrete slot is already due, the result is the persisted
`NO_ACTION / POLICY_DISABLED` decision for that due slot.

Disable, resume, and postpone operations are represented by new immutable,
authenticated policy versions. Existing policy and decision history is never
mutated.

## 15. Active-Run historical authority

A blocking Run is any same-Operation Run whose authenticated historical
lifecycle prefix at `evaluationAt` is nonterminal. The blocking states are
exactly `PLANNED` and `RUNNING`. The terminal states are exactly
`SUCCESS_WITH_RESULTS`, `SUCCESS_NO_RESULTS`, `FAILED`, and `TIMED_OUT`.

If an applicable RCV-021 Run is historically nonterminal at `evaluationAt`:

- decision is `NO_ACTION`;
- reason is `ACTIVE_RUN`; and
- the decision records or references the exact immutable Run authority used.

The active-Run binding includes exactly the relevant immutable prefix
authority:

- Run identity;
- immutable Run creation authority;
- the lifecycle-prefix identity and manifest hash;
- explicit historical `PLANNED` or `RUNNING` state; and
- the `RUNNING` lifecycle event identity and canonical/hash authority only
  when the state is `RUNNING`; and
- `evaluationAt`.

The lifecycle-prefix manifest is one combined manifest for the Operation and
all relevant same-Operation Runs observed for the evaluation. It authenticates
the exact relevant immutable RCV-021 authority members. Its members are the
Operation creation authority, Operation lifecycle-event authority, Run
creation authority, Run lifecycle-event authority, and Run terminal-resolution
authority whose authoritative time is less than or equal to `evaluationAt`;
equality is included and later authority is excluded. The manifest has
deterministic canonical bytes and a SHA-256 hash. Members are ordered by
authoritative time ascending, then authority kind, then immutable identity
text ascending. Database row order MUST NOT determine membership or ordering.

The Operation lifecycle prefix proves `OPEN` when no Operation close event is
in the prefix and proves `CLOSED` when its authenticated close event is in the
prefix. Run-specific evidence references the exact Run members in this same
manifest and binds the same manifest identity and hash.

The exact cutoff identity is:

`(evaluationAt, lifecyclePrefixManifestHash)`.

Historical verification reconstructs the manifest from immutable RCV-021
authority and requires:

- Run creation time less than or equal to `evaluationAt`;
- for `PLANNED`, no RUNNING lifecycle event and no terminal resolution in the
  authenticated prefix;
- for `RUNNING`, a RUNNING lifecycle event with time less than or equal to
  `evaluationAt`; and
- no terminal resolution in the authenticated prefix.

Any terminal authority whose authoritative terminal time is less than or
equal to `evaluationAt` must be in the prefix and prevents `ACTIVE_RUN`.

If more than one same-Operation nonterminal Run is present in the authenticated
prefix, the historical authority is invalid. The Scheduler MUST fail closed,
must not choose one arbitrarily, and must not emit a SchedulerDecision.

A terminal event occurring after evaluation does not retroactively change the
decision or alter the authenticated prior prefix. A later-added or backdated
authority claiming terminal time less than or equal to `evaluationAt` that
conflicts with the prefix is a historical contradiction and fails closed; it
MUST NOT repair or rewrite the SchedulerDecision.
Current Run state is never a substitute for this historical authority.

## 16. Eligible-slot authority

If the Operation is historically `OPEN`, the applicable policy is enabled,
no same-Operation Run is historically nonterminal, and the selected slot is eligible,
the decision is `RUN_NOW`.

The reason is selected without overlap:

- `INITIAL_ELIGIBILITY` for the first eligible slot;
- `INTERVAL_ELIGIBILITY` for a later normal slot; or
- `MISSED_SLOT_COALESCED` when one or more earlier slots were coalesced.

These reasons are mutually exclusive. `INITIAL_ELIGIBILITY` requires slot
index `0`, a due slot, no prior decision for that slot, and no blocking
nonterminal Run. `INTERVAL_ELIGIBILITY` requires slot index greater than `0`,
no earlier unissued slot, a due slot, and no blocking nonterminal Run.
`MISSED_SLOT_COALESCED` requires slot index greater than `0`, at least one
earlier unissued slot, a due slot, and no blocking nonterminal Run. Earlier
missed slots are never backfilled.

The decision requests exactly one new Run under the existing Operation
authorization. It does not create a new RCV-021 TriggerBinding.

## 17. Outcome independence

RCV-021 terminal outcomes do not alter V1 cadence:

- `SUCCESS_WITH_RESULTS`;
- `SUCCESS_NO_RESULTS`;
- `FAILED`;
- `TIMED_OUT`.

All retain the same fixed cadence. The Scheduler owns no automatic Retry,
failure backoff, timeout backoff, adaptive acceleration, or adaptive slowing.
Those behaviors require later explicit authority.

## 18. SUCCESS_NO_RESULTS boundary

The Scheduler adopts the exact RCV-021 meaning of `SUCCESS_NO_RESULTS` and
MUST NOT infer:

- that nothing exists;
- that no evidence exists;
- that a Claim is false;
- source absence;
- provider completeness;
- search completeness; or
- world completeness.

`SUCCESS_NO_RESULTS` leaves the fixed cadence unchanged.

## 19. SUCCESS_WITH_RESULTS boundary

Result content has no V1 scheduling meaning. The Scheduler MUST NOT inspect
result semantics to accelerate, slow, stop, prioritize, or otherwise alter
research. Such interpretation belongs outside this authority.

## 20. Operator requests

An authenticated `OPERATOR` request for immediate research remains solely
RCV-021 authority. It may request research independently of the schedule and
does not modify cadence, rewrite a SchedulerDecision, consume a historical
slot, or create a duplicate Scheduler operator authority.

No `OPERATOR_OVERRIDE` Scheduler reason exists in V1. A later Scheduler
evaluation may observe the resulting immutable Run as an `ACTIVE_RUN` input,
but that observation does not duplicate the operator authority.

## 21. RCV020 research requests

`RCV020_RESEARCH_REQUEST` remains an independent existing RCV-021 trigger
path. It is not Scheduler cadence acceleration and does not change RCV-020
semantics. The Scheduler may observe resulting immutable RCV-021 Run history
only as a legitimate historical input, such as for active-Run evaluation.

## 22. Duplicate and concurrency authority

There is at most one SchedulerDecision per:

`(operation_id, policy_id, slot_index)`.

That slot tuple is the SchedulerDecision's authoritative identity. Any
storage surrogate is non-authoritative and MUST NOT create a second
deduplication boundary.

The identity rules are:

- same identity and same immutable canonical authority: idempotent;
- same identity and divergent immutable canonical authority: fail closed; and
- different identities: distinct historical authority.

The same policy stream has one authenticated predecessor chain: no second
genesis, branch, disconnected append, or retroactive lower/equal-slot
successor is valid. Concurrent new decisions MUST append after the currently
authenticated logical tail; the Contract does not prescribe the physical
locking mechanism. The current tail is always derived from immutable chain
history and is never a mutable Scheduler authority.

Independent authenticated Operator requests remain distinct RCV-021 history.
Equal content MUST NOT collapse distinct scheduler slots, Runs, or other
historical authority.

## 23. Priority and resources

V1 has no semantic priority. Runtime queue ordering, concurrency limits,
provider rate limits, and throughput throttling are operational and derived;
they MUST NOT mean truth, Claim importance, evidence quality, source trust,
or editorial importance.

V1 has no semantic budget authority. Infrastructure may throttle execution,
but throttling does not change historical Scheduler policy semantics.

## 24. Clock and time authority

Authoritative Scheduler timestamps are supplied and persisted as UTC values,
including as applicable:

- policy `effectiveAt`;
- `firstEligibilityAt`;
- slot `scheduledAt`;
- `evaluationAt`; and
- `nextEligibleAt`.

Calendar schedules, DST interpretation, and monotonic runtime clocks are not
V1 authority. Historical verification MUST NOT use the current wall clock.

## 25. Historical verification

An independent Scheduler ReadVerifier must reconstruct and verify:

- the policy stream and exact policy version;
- policy canonical bytes, version, and SHA-256;
- slot identity and exact slot arithmetic;
- immutable scheduling inputs;
- historical Operation state;
- the historical active-Run prefix when applicable;
- decision, reason, and `nextEligibleAt`; and
- the `RUN_NOW` request binding where applicable; and
- the complete policy-stream predecessor chain, including exactly one genesis
  for a non-empty stream, predecessor identity and hash, same-stream
  membership, branch and cycle absence, complete coverage, and strict
  slot-index increase.

The verifier MUST reconstruct authority from persisted history rather than
trusting Writer output, current policy pointers, queue state, current Run
state, provider state, source state, Claim state, scheduler process memory,
credentials, or the current clock.

## 26. No-repair and immutability

Scheduler policy and decision history is append-only and immutable. A
verifier MUST NOT update, delete, repair, fill missing data, substitute
current policy or Run state, rewrite timestamps, or recompute history into
stored state.

Invalid, malformed, conflicting, unsupported, or lineage-invalid authority
fails closed. Missing predecessors, predecessor identity/hash mismatches,
second genesis, branches, cycles, disconnected nodes, same-stream violations,
and non-increasing chain slot indexes are lineage-invalid authority. Correction
creates new authority; no predecessor reference, hash, chain connection, or
historical decision is repaired or rewritten.

## 27. Secret boundary

Scheduler policy and decisions MUST never persist plaintext API keys, tokens,
passwords, provider secrets, or other credential material.

Where a provider or account reference is legitimately needed, only the
authorized reference identity and version may be persisted. Historical
Scheduler verification must not require a live secret.

## 28. Failure behavior

The Scheduler MUST fail closed for malformed or unsupported policy authority,
invalid slot arithmetic, invalid historical Operation or Run bindings,
invalid decision combinations, identity conflicts, canonical/hash mismatch,
and duplicate identity with divergent immutable authority.

The exact diagnostic failure taxonomy and precedence are implementation-level
concerns for the future Design. This Contract requires deterministic failure,
canonical-path determinism where diagnostics are exposed, and no repair; it
does not create a new closed error enum.

## 29. Non-goals

V1 explicitly excludes:

- truth or falsity;
- Claim correctness or extraction;
- evidence strength, matching, support, or refutation;
- source trust, ranking, or semantic relevance;
- adaptive or AI cadence;
- autonomous `SYSTEM` or `POLICY` RCV-021 triggers;
- outcome-dependent cadence or backoff;
- query generation;
- provider execution;
- search, provider, source, or world completeness;
- RCV-020 Capture or AuthenticatedHandoff ownership;
- a general workflow engine;
- UI or editorial workflow;
- vendor durability guarantees; and
- calendar or DST scheduling.

## 30. Canonical and hash authority

Policy and decision authority uses a versioned deterministic UTF-8 canonical
representation and SHA-256 over the exact canonical bytes.

Canonical representations MUST define explicit null and absence semantics,
must not depend on database row order, runtime collection order, locale, or
current mutable state, and must preserve exact decimal integer and UTC
microsecond values. Any canonical collection has one explicit deterministic
ordering rule appropriate to its semantic set or sequence meaning. For a
non-genesis SchedulerDecision, canonical authority may depend on the prior
decision identity and canonical hash; the prior decision MUST NOT depend on
the successor. RUN_NOW binding canonical authority MUST NOT introduce a
reverse Decision-hash dependency.

## 31. Determinism

Given identical persisted policy version, Operation authority, slot identity,
authenticated policy-stream predecessor chain, historical Run prefix, and
supplied evaluation timestamp, the Scheduler MUST produce identical:

- decision;
- reason;
- `nextEligibleAt`;
- canonical bytes; and
- hash.

External provider behavior and current operational availability are not
Scheduler determinism inputs.

## 32. Architectural placement

This authority is a separately named Scheduler / Policy Contract, outside the
RCV numbering. It must remain separate from RCV-020 observation, RCV-021
active-research execution, and RCV-022 Claim/evidence analysis authority.
