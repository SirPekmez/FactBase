# FactBase First Real Recheck Policy V1

Status: Policy authority definition pending snapshot lock.

This document freezes the first real-world recheck business Policy for an
already-authorized RCV-021 `ResearchOperation`. It selects temporal
eligibility only. The frozen Scheduler Contract and Implementation Design
remain authoritative for persistence, canonicalization, decision derivation,
historical verification, and failure behavior.

## 1. Purpose and boundary

The Policy answers when an already-authorized Operation may be considered for
another research run. The Scheduler determines **when**, not whether a claim
is true, whether evidence supports or refutes a claim, source credibility,
claim importance, semantic relevance, or any RCV-022 result.

RCV-021 remains active-research execution authority. RCV-020 remains
observation and retrieval authority. RCV-022 remains semantic claim/evidence
analysis authority. This Policy adds no authority to any of those layers.

## 2. Policy identity and version

The stable product-semantic Policy identity is:

`factbase-research-recheck-universal-24h`

The Policy version is positive integer `1`.

The frozen Scheduler schema represents each Operation's policy stream with an
immutable UUID `policy_id`. That UUID is the stream identity bound to exactly
one Operation; it is not a time-based label, a random cadence selector, or a
shared mutable current-policy pointer. The semantic identity above names the
business Policy and does not add a field to the Scheduler canonical schema.

The first production PolicyVersion is therefore version `1` of the
operation-bound stream, with the exact canonical fields already frozen by the
Scheduler Design:

`schema canonicalVersion policyId operationId version enabled effectiveAtMicros firstEligibilityAtMicros fixedIntervalMicros`

No additional assignment or cadence-class field is required.

## 3. Assignment and cadence

Assignment is universal. Every already-authorized Operation receives this
Policy; no Operation-type, source-type, subject-category, or semantic
classification selects a different cadence.

The fixed interval is exactly 24 hours:

`fixedIntervalMicros = 86400000000`

This value is a deliberate **POLICY CHOICE**, not a technical requirement.
There is no variable sequence, exponential backoff, adaptive interval, or
1/2/4 cadence.

## 4. First eligibility and effectiveAt

Let `authorizationAt` be the immutable Operation authorization timestamp
recorded by RCV-021 authority. In the existing RCV-021 physical authority,
this is the persisted `research_operations.operation_created_at` value for
the authorized Operation; it is not a Scheduler-created timestamp.

For PolicyVersion 1:

- `firstEligibilityAt = authorizationAt`;
- `effectiveAt = authorizationAt`;
- slot `0` is eligible at `authorizationAt`;
- slot `n` is scheduled at `authorizationAt + n * 86400000000` microseconds.

These are explicit persisted authority values. The Scheduler MUST NOT obtain
either value from the current wall clock. If the immutable authorization
timestamp is unavailable or fails validation, the PolicyVersion is not
authoritative and evaluation fails closed.

The equality of `effectiveAt`, `firstEligibilityAt`, and `authorizationAt`
is the v1 Policy rule. It ensures that slot 0 has an applicable initial
version without an applicability gap.

## 5. Enabled and disabled behavior

The `enabled` field is immutable for each PolicyVersion.

Before a due slot, a disabled evaluation remains transient. At a due slot, a
disabled Policy produces the persisted Scheduler result:

`NO_ACTION / POLICY_DISABLED`

It creates no RCV-021 Run. Re-enabling through later immutable policy
authority applies only to future unissued slots; it does not replay disabled
or otherwise missed slots individually.

This Policy does not change the frozen treatment of a pre-due closed
Operation; that evaluation also remains transient.

## 6. Missed slots

This Policy uses the frozen Scheduler `MISSED_SLOT_COALESCED` semantics.
Missed eligible slots are never replayed one at a time and no synthetic
Decisions are created for them. If any earlier eligible slot remains unissued,
a later due `RUN_NOW` Decision is classified as
`MISSED_SLOT_COALESCED`. The classification remains literal for later due
slots while the earlier gap remains.

## 7. Allowed and prohibited inputs

The Policy may use only:

- Operation identity;
- immutable Operation authorization timestamp;
- operation-bound policy identity and version;
- immutable `enabled` state;
- immutable `effectiveAt`;
- immutable `firstEligibilityAt`; and
- immutable `fixedIntervalMicros`.

The Policy MUST NOT use truth or falsity, support or refutation, evidence
strength, credibility, source quality or independence, claim importance,
semantic relevance, RCV-022 output, AI judgment, news volume, current capture
content, source activity, queue pressure, compute load, provider pricing,
cost feedback, or adaptive heuristics. None of those inputs may silently
alter cadence.

Historical active-Run state remains relevant only to the frozen Scheduler
decision precedence; it is not a Policy assignment input.

## 8. Version changes

PolicyVersions are immutable and append-only. A later enabled/disabled state
or other policy-state change requires new immutable authority at an explicit
`effectiveAt`; it never mutates a prior version or Decision.

Within this v1 stream, `firstEligibilityAt` and `fixedIntervalMicros` remain
stable as required by the frozen Scheduler Contract. A future cadence change
MUST NOT edit PolicyVersion 1. If a future product decision selects another
interval, it requires explicit later policy authority compatible with the
Contract; where the stable-cadence-per-stream rule prohibits that change, a
separately authorized future policy stream or later Contract authority is
required. No workaround or silent migration is implied here.

## 9. Cost and freshness limits

The 24-hour interval is not selected as economically optimal. Cost
measurement is explicitly deferred. Future measured cost may motivate a
future explicit Policy change, but cost feedback MUST NOT dynamically mutate
PolicyVersion 1.

The interval defines nominal Scheduler eligibility only. It does not
guarantee evidence freshness or a completed research run within 24 hours.
Execution delay, provider availability, retrieval failure, missed slots, and
source publication timing can affect what is observed. Absence of a result
does not establish that nothing exists.

## 10. Compatibility statement

This Policy is compatible with the frozen Scheduler Contract and Design:
fixed-interval slot arithmetic, immediate slot-0 eligibility, immutable
versioning, due-versus-transient evaluation, disabled decisions, coalesced
missed slots, historical Reader verification, current-state independence, and
no-repair are unchanged.

No migration, Scheduler production-code change, RCV-020 change, RCV-021
change, or RCV-022 change is required to define this Policy.

## 11. Policy choices versus technical requirements

The following are explicit **POLICY CHOICES** for the first real Policy:

- universal assignment;
- immediate first eligibility at Operation authorization; and
- a 24-hour fixed interval.

The following are **TECHNICAL REQUIREMENTS** inherited from the frozen
Scheduler authority, not choices made by this document:

- immutable, versioned, append-only policy authority;
- exact deterministic slot arithmetic;
- no mutation of historical Decisions;
- frozen due/transient precedence;
- frozen `MISSED_SLOT_COALESCED` behavior;
- exact historical verification;
- current-state independence; and
- no repair.
