# RCV-021 Active Research Orchestration and Provenance Contract V1

## 1. Purpose and authority boundary

RCV-021 defines the minimum historical authority for explicitly authorized
active research operations. It records a research operation, its runs,
technical execution attempts, canonical query and strategy authority,
provider-result envelopes, rerun lineage, no-result outcomes, and the binding
of selected research results back into the normal RCV-020 observation path.

RCV-019 remains authority for historical and temporal evidence state. RCV-020
remains authority for configured observation, ObservationOccurrence,
RetrievalAttempt, Capture, comparison, retention, coverage, and
AuthenticatedHandoff. RCV-022 and later RCVs own Claim extraction, Claim
matching, evidence analysis, source/evidence analysis, and semantic
interpretation.

RCV-021 does not create truth authority, evidence authority, Claim-analysis
authority, source-profile authority, parallel Capture authority, or parallel
AuthenticatedHandoff authority.

## 2. Subject authority

The V1 subject type is a closed union of:

- `RCV020_CAPTURE`;
- `RCV020_OBSERVATION_OCCURRENCE`;
- `RCV020_RESEARCH_TRIGGER_REQUEST`;
- `AUTHENTICATED_OPERATOR_REQUEST`;
- `HISTORICAL_CLAIM_IDENTITY`.

A ResearchOperation may exist without a Claim. A historical Claim identity is
an optional identity/reference binding only. It never permits a current Claim
lookup, Claim analysis, or Claim-state substitution.

No generic or untyped subject exists in V1.

## 3. Trigger authority

The V1 trigger vocabulary is closed to:

- `OPERATOR`;
- `RCV020_RESEARCH_REQUEST`.

`OPERATOR` requires an authenticated initiator, authorization context,
creation time, and explicit query/strategy authority.

`RCV020_RESEARCH_REQUEST` requires the exact persisted trigger identity,
originating Capture or ObservationOccurrence where supplied, deterministic
rule identity and version, creation time, and downstream execution owner.

`SYSTEM` and `POLICY` triggers are not RCV-021 V1 authority. Autonomous
research policy is excluded.

Triggering may not be inferred from current Claim state, current
configuration, coverage absence, current source state, or mutable operational
state.

## 4. ResearchOperation

A ResearchOperation is one immutable authorized research intent. It binds:

- operation identity;
- one typed subject;
- purpose;
- scope;
- trigger and authorization;
- creation authority and `operationCreatedAt`.

A changed subject, purpose, scope, or authorization requires a new
ResearchOperation.

The same operation identity with the same canonical representation is
idempotent. The same identity with a divergent canonical representation fails
closed. Different operation identities remain distinct even when their
strategies or results are equivalent.

The operation lifecycle is exactly:

`OPEN → CLOSED`

`CLOSED` is terminal. Closure is explicit and authenticated. A Run outcome
does not implicitly close the Operation. No Run may be created after closure.

## 5. ResearchRun

A ResearchRun is one immutable historical execution occurrence under one
ResearchOperation. It binds:

- ResearchOperation identity;
- exact strategy/query identity and version;
- provider identity;
- adapter identity and version;
- execution parameters;
- `runCreatedAt`, execution timestamps, and immutable deadline;
- result envelope and terminal outcome.

Distinct Runs never collapse because query or result content is identical.

The Run lifecycle is:

`PLANNED → RUNNING → terminal`

The only V1 terminal outcomes are:

- `SUCCESS_WITH_RESULTS`;
- `SUCCESS_NO_RESULTS`;
- `FAILED`;
- `TIMED_OUT`.

`SUCCESS_NO_RESULTS` may be presented as “not found” to users, but
`NOT_FOUND` is not a second canonical enum value. `PARTIAL`, `SKIPPED`, and
`CANCELLED` are not V1 terminal outcomes.

Terminal resolution is immutable. Duplicate, late, or out-of-order terminal
resolution fails closed. A ResearchRun must not terminalize while any started
ResearchAttempt lacks an immutable terminal resolution.

## 6. Outcome semantics

`SUCCESS_WITH_RESULTS` means the declared query completed under the recorded
execution boundary and at least one result record was returned and accepted
into the Run result envelope.

`SUCCESS_NO_RESULTS` means the exact recorded query completed under its
execution boundary and returned zero result records. It never means
`DOES_NOT_EXIST`, world absence, falsity, no evidence, search completeness,
source completeness, or global completeness.

`FAILED` means declared execution completion failed. Result observations that
were already valid remain historically valid and are not invalidated by the
Run outcome.

`TIMED_OUT` means the immutable deadline expired before completion. Late
activity cannot rewrite terminal Run authority.

## 7. Technical attempts and Retry

A Retry is a technical execution attempt within the same ResearchRun and the
same strategy and authorization boundary.

The closed ResearchAttempt terminal-outcome vocabulary is exactly:

- `SUCCEEDED`;
- `FAILED`.

`SUCCEEDED` means that the technical execution completed sufficiently for Run
and result processing to continue. It never implies that a ProviderResult
exists, that the ResearchRun succeeded, that an RCV-020 ObservationOccurrence
or RetrievalAttempt succeeded, that a Capture exists, or that truth or
evidence succeeded.

`FAILED` means that the technical execution did not complete successfully.
`FAILED` is the only Retry-eligible Attempt outcome. Failure-cause provenance,
when recorded, is technical diagnostic authority only and does not create
another terminal state.

Every started ResearchAttempt must have exactly one immutable terminal
resolution. Attempt start time must be less than or equal to its terminal
time, and an Attempt terminal time must be less than or equal to the Run
terminal time. If the immutable ResearchRun deadline expires while an Attempt
is active, that Attempt receives an immutable `FAILED` terminal resolution
recording the technical deadline-expiry cause/provenance; the ResearchRun then
resolves `TIMED_OUT`. No Retry may begin after the Run is terminal, and for a
`TIMED_OUT` Run the Run terminal time is at or after its immutable deadline
after all active Attempts have been terminally resolved.

The predecessor must:

- belong to the same ResearchRun;
- have an immutable terminal `FAILED` outcome;
- terminate before the Retry starts.

Attempt numbering starts at `1`; each Retry number equals its predecessor's
number plus `1`. Retry lineage is acyclic. Speculative parallel attempts are
not Retry authority.

The same attempt identity with the same canonical representation is
idempotent. The same identity with a divergent canonical representation fails
closed.

## 8. Rerun

A Rerun is a new ResearchRun under the same `OPEN` ResearchOperation after a
prior Run has reached a terminal outcome. It has a new Run identity and new
execution timestamps and may reference one terminal predecessor Run.

No numeric rerun sequence is semantic authority. A nonterminal Run is
recovered through Retry, not a parallel Rerun. Rerun lineage is acyclic.

## 9. Query and strategy authority

The exact versioned canonical strategy envelope includes:

- logical query;
- filters;
- target scope;
- provider identity;
- adapter identity and version;
- locale and language;
- pagination and search bounds;
- execution parameters;
- trigger binding;
- strategy identity and version.

The envelope excludes plaintext secrets and current mutable configuration or
provider state. Historical verification uses the persisted envelope and never
repeats the query as proof.

## 10. Credential boundary

Only authorized historical references may be persisted, such as credential
reference identity/version, authorized provider-account identity, and a
redacted execution representation.

Tokens, passwords, API keys, and other secret plaintext must never be
persisted as canonical authority. Historical verification must not require the
current secret value.

## 11. Provider-result authority

An RCV-021 provider-result record is authority only for:

“This provider returned this result or metadata under this recorded Run.”

It is not factual truth. The record preserves result identity, provider
response/result envelope, provider identity, adapter/version, relevant
timestamps, provider item identity/metadata, and result status.

Unselected result metadata remains RCV-021 history only and is not a Capture.

## 12. Result binding to RCV-020

An accepted result artifact selected for observation must re-enter the normal
RCV-020 path. RCV-021 authorizes the research-bound observation request.

RCV-020 is the sole authority for the resulting `EXTERNAL`
ObservationOccurrence, RetrievalAttempt, Capture, raw object, comparison,
retention, and AuthenticatedHandoff. RCV-021 creates no parallel versions of
those authorities.

Each accepted retrievable result creates a distinct RCV-020
ObservationOccurrence bound to the ResearchRun and result identity. Each
successful retrieval creates a distinct historical attempt and Capture
identity.

Equivalent content or identical bytes may share physical storage, but must
not collapse distinct ResearchRuns, ObservationOccurrences,
RetrievalAttempts, or Captures. A result listing is not automatically a
separate Capture; it is captured separately only when explicitly selected as
an artifact by the recorded strategy.

## 13. Parsing and extraction boundary

RCV-021 parsing is limited to provider protocol and result-envelope integrity,
including provider response, pagination, result identity, and target identity.
RCV-020 parsing may validate the observed format required for Capture.

Text extraction, semantic extraction, AI extraction, Claim extraction, Claim
matching, and evidence analysis cannot retroactively invalidate a valid
ResearchRun, ObservationOccurrence, or Capture. Those operations belong to
RCV-022 or later authority.

## 14. Partial results

V1 has no `PARTIAL` Run outcome. Successful individual result observations
remain valid independently.

If the declared completion condition fails, the Run resolves `FAILED`. If the
immutable deadline expires first, the Run resolves `TIMED_OUT`. No inferred
percentage or completeness authority exists.

## 15. Time authority

At minimum, historical records preserve:

- `operationCreatedAt`;
- `runCreatedAt`;
- `executionStartedAt`;
- `terminalAt`;
- `resultObservedAt`.

Provider/source publication or event time is retained when supplied. Source
or world time, observation time, and downstream RCV-019 `knowledgeAt` are
distinct. Historical verification never substitutes current clock values.

## 16. Retention and replayability

RCV-020 owns raw-object retention and availability authority. RCV-021 owns
operation, Run, query/strategy, and result-envelope history only; it creates
no second raw-retention authority.

Raw loss may make replayability false, but must not invalidate authenticated
historical operation, result, Capture, or Handoff authority.

## 17. Coverage

RCV-021 V1 creates no coverage authority. Run outcomes and result counts are
historical operational facts only. They do not imply search completeness,
source completeness, or research exhaustiveness. RCV-020 monitoring coverage
is not reused as research completeness.

## 18. Handoff

RCV-020 AuthenticatedHandoff remains the sole downstream handoff authority.
RCV-021 creates no parallel handoff class.

One ResearchRun may yield multiple RCV-020 Capture/Handoff records. Each is
bound to its exact Capture/result lineage and uses the frozen RCV-020
idempotency and conflict semantics. Multiple downstream targets remain
possible only under those RCV-020 rules.

## 19. Current-state independence

Historical verification may use only persisted historical authority. It must
not depend on current source pages, endpoints, provider behavior,
configuration, parser implementation, scheduler state, credential value,
raw availability except for replayability, current Claim state, or external
truth.

Re-execution creates new historical authority. No newer Run substitutes for an
older Run.

## 20. Determinism

Canonical bytes, hashes, versions, identity checks, lifecycle classification,
Retry/Rerun validation, and historical verification are deterministic from
supplied persisted inputs.

External search and provider behavior are nondeterministic by nature. The
Contract records what occurred and does not require repeating a query today to
reproduce yesterday.

## 21. No repair and immutability

Historical authority is append-only and immutable as applicable. Malformed,
mismatched, unsupported, incomplete, duplicate-conflicting, or
lineage-invalid state fails closed.

Corrections create new authorized authority. Implementations must never:

- UPDATE history as repair;
- DELETE history as repair;
- rewrite canonical or hash values;
- substitute a newer Run;
- consult current state as repair.

## 22. RCV-022 and later boundary

RCV-022 or later owns Claim extraction, Claim matching, evidence
support/refutation, evidence strength, source trust, source independence,
semantic similarity authority, and factual interpretation.

RCV-021 stops once active research has produced historically bound
observations and provenance.

## 23. Explicit non-goals

RCV-021 does not provide truth or falsity, world-absence inference, evidence
judgment, Claim adjudication, Claim extraction, source profiles, trust,
ranking, independence, global completeness, semantic/AI similarity authority,
direct RCV-019 mutation, mutable current-state authority, vendor durability,
UI/editorial workflow, autonomous policy research, or production scheduler
semantics.

## 24. Invariants

1. A ResearchOperation may exist without a Claim.
2. Subject types and trigger types are closed as specified above.
3. Operation, Run, attempt, and result identities remain distinct.
4. Same identity plus same canonical is idempotent; divergent canonical fails
   closed.
5. Retry is same-Run technical lineage; Rerun is a new Run after terminal
   completion.
6. `SUCCESS_NO_RESULTS` is exact no-result authority and never world absence.
7. Accepted research results re-enter RCV-020 for observation and Capture.
8. Equivalent bytes never collapse distinct historical observations.
9. RCV-020 owns Capture, retention, comparison, coverage, and Handoff
   authority.
10. Raw loss changes replayability, not historical authentication.
11. Historical verification has no current-state fallback.
12. Corrections are new authority; historical records are never repaired.
13. RCV-021 does not perform RCV-022 semantics.

## 25. Contract status

This document is an RCV-021 Contract V1 draft for audit. It is not frozen.
Freezing requires an independent authority and semantic parity review. No
Design, migration, production implementation, or test is authorized by this
draft.
