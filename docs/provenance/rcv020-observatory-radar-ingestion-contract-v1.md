# RCV-020 Observatory / Radar / Ingestion Authority Contract V1

## 1. Purpose and scope

RCV-020 defines the minimum authoritative semantics by which FactBase
observes configured sources and preserves a reproducible history of that
observation. It makes the source, monitoring configuration, attempted work,
captured representation, failures, changes, and achieved coverage visible.

FactBase's North Star remains:

> FactBase macht sichtbar, wie gut eine Behauptung nach dem aktuellen Stand der
> dokumentierten Evidenz gestützt oder widerlegt wird — transparent,
> reproduzierbar und nachvollziehbar.

RCV-020 contributes by making discovery itself observable, reproducible,
time-authenticated, source-authenticated, coverage-aware, and historically
reconstructable. It does not decide truth, support, contradiction, credibility,
or evidential strength.

Its authority stops before evidential assessment:

`Source registry → observation occurrence → retrieval attempt → capture →
change/revision result → optional derived classification/trigger →
authenticated downstream handoff → existing evidence pipeline`.

## 2. Authority boundaries and non-goals

RCV-020 observation authority is distinct from:

- derived extraction;
- evidence ingestion;
- evidential assessment;
- source trust, reputation, credibility, and independence judgment.

Registration or official status never means that a source is true, trusted,
correct, or authoritative for every claim. Observation never means support.
Non-observation never means falsity. A successful empty response never means
that nothing existed in the world.

RCV-020 does not own active research execution, search-engine orchestration,
claim-extraction authority, source profiling, independence scoring, editorial
commentary, global-web completeness, or direct mutation of RCV-019 history.

## 3. Authoritative identity hierarchy

The identity hierarchy is:

`LogicalSource → Monitor → MonitorConfigurationVersion`.

`LogicalSource` is the stable identity of the real-world publishing/source
entity being observed, independent of any endpoint. This identity describes
what FactBase monitors; it does not assert truth, trust, credibility, support,
or epistemic superiority. A LogicalSource may have many Monitors.

`Monitor` is one endpoint/retrieval relationship belonging to one
LogicalSource. RSS and API monitoring of one authority are separate Monitors.
Adding or replacing an endpoint does not automatically create a new
LogicalSource.

`MonitorConfigurationVersion` is an immutable version of one Monitor. One
Monitor has many versions over time. Multiple Monitors may operate in parallel
for one LogicalSource.

## 4. Monitor configuration authority

A MonitorConfigurationVersion must preserve at least:

- Monitor and LogicalSource identity;
- endpoint/request identity and retrieval method;
- authentication reference, never secret material;
- expected media/content constraints;
- cadence or trigger eligibility;
- jurisdiction, language, geographic, and topical scope where applicable;
- safety and access-policy limits;
- adapter identity/version;
- parser identity/version where capture-side parsing is authoritative;
- retention policy/version;
- explicit active effective interval;
- deterministic canonical form and cryptographic hash.

Activation and retirement are explicit, immutable lifecycle authority. A
future activation may be scheduled. Historical effective intervals cannot be
edited. A correction creates a new configuration version. A cadence, adapter,
parser, endpoint, authentication-reference, or policy change creates a new
version. Temporary pause/resume is represented by append-only pause/resume or
disabled scheduling events, not by rewriting configuration history.

Configuration versions for one Monitor must not overlap. Parallel endpoints
use distinct Monitor identities. The same logical source may therefore have
parallel, independently versioned monitoring relationships without ambiguous
configuration authority.

## 5. ObservationOccurrence authority

An ObservationOccurrence is the immutable unit of expected or externally
triggered monitoring work. It has a stable identity and references:

- LogicalSource;
- Monitor;
- MonitorConfigurationVersion;
- trigger origin: `SCHEDULED`, `EXTERNAL`, or `OPERATOR`;
- trigger-specific authority;
- due/creation timestamps appropriate to the trigger;
- an explicit evaluation/cutoff authority;
- its final occurrence outcome.

The final occurrence outcome vocabulary is closed to:

- `SUCCEEDED`;
- `FAILED`;
- `MISSED`;
- `SKIPPED`.

Terminal resolution is explicit and deterministic:

- `SUCCEEDED` means at least one RetrievalAttempt produced a valid
  authoritative Capture before the immutable terminal evaluation boundary;
- `FAILED` means at least one RetrievalAttempt occurred, no authoritative
  Capture succeeded, and the occurrence reached that boundary with a
  classified failure;
- `MISSED` means zero RetrievalAttempts occurred by the evaluation boundary;
- `SKIPPED` means execution was explicitly skipped by operator or policy before
  retrieval execution.

Prior failed attempts remain visible when a later retry succeeds and the
occurrence becomes SUCCEEDED. An attempt that started before the boundary but
has not completed is not a successful Capture at that boundary. It is resolved
according to the immutable scheduling/adapter deadline rule (normally a
classified `TIMEOUT`), after which the occurrence becomes FAILED; it is never
reclassified as MISSED merely because completion was late. No terminal outcome
may depend on the time of a later query.

`DISABLED` and `NOT_APPLICABLE` are not occurrence outcomes. If monitoring
was not due because a Monitor/configuration was disabled or a schedule did
not apply, no artificial ObservationOccurrence is created. Such states are
preserved by configuration and scheduling authority so the absence of an
occurrence remains explainable.

For scheduled occurrences, `scheduledAt` is the scheduler-authenticated due
time. For external occurrences, the external event identity and receipt time
are authoritative; FactBase makes no statement about events never delivered.
For operator occurrences, the actor/policy and request time are authoritative.

## 6. RetrievalAttempt authority

RetrievalAttempt is a separate immutable execution identity linked to exactly
one ObservationOccurrence. One occurrence may have zero, one, or many
attempts.

Each attempt preserves:

- attempt identity and parent occurrence;
- previous-attempt identity for retries where applicable;
- `retrievalStartedAt` and `retrievalCompletedAt`;
- MonitorConfigurationVersion and adapter identity/version;
- deterministic request/query authority;
- attempt outcome;
- failure classification and safe diagnostic metadata where applicable.

Retries never replace earlier attempts. A failed first attempt followed by a
successful retry remains fully reconstructable.

## 7. MISSED and SKIPPED

`MISSED` means a due ObservationOccurrence for which no RetrievalAttempt
occurred by its authoritative evaluation boundary. The boundary is determined
from the occurrence due time, scheduling policy/version, grace/deadline rule,
and immutable `evaluatedAt` or equivalent evaluation authority.

`SKIPPED` means a due occurrence explicitly not executed under an operator or
policy decision. It requires an immutable reason, actor or policy identity,
timestamp, and audit authority. SKIPPED is not FAILED.

## 8. Attempt outcomes and failure taxonomy

RetrievalAttempt outcomes are closed to:

- `CAPTURED_CHANGED`;
- `CAPTURED_UNCHANGED`;
- `CAPTURED_EMPTY`;
- `FAILED`.

`FAILED` never means empty, unchanged, no content, or absence of a world fact.

The versioned initial failure taxonomy is:

`DNS_FAILURE`, `CONNECTION_FAILURE`, `TIMEOUT`, `HTTP_FAILURE`,
`AUTHENTICATION_FAILURE`, `RATE_LIMITED`, `UNSAFE_REDIRECT`,
`PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA`, `MALFORMED_RESPONSE`,
`PARSER_FAILURE`, `CAPTURE_INTEGRITY_FAILURE`, `SOURCE_REMOVED`,
`ACCESS_RESTRICTED`, `CONFIGURATION_ERROR`, `INTERNAL_ERROR`,
`OTHER_UNCLASSIFIED`.

`OTHER_UNCLASSIFIED` is permitted only with taxonomy version and preserved
safe diagnostic information. Later taxonomy versions must not silently
reclassify historical failures.

`PARSER_FAILURE` applies only to capture-side parsing, decoding, or validation
required to establish the authoritative observed representation. A later
failure in derived text extraction, entity or claim extraction, AI
classification, summarization, or other derived processing must not
retroactively invalidate a valid Capture; it is recorded against the derived
operation instead.

## 9. Capture authority

Capture is immutable authority for the representation FactBase successfully
observed. A Capture must preserve at least:

- capture identity;
- LogicalSource, Monitor, and MonitorConfigurationVersion identities;
- ObservationOccurrence and RetrievalAttempt identities;
- requested URL/query identity;
- final URL and redirect chain where applicable;
- response/status metadata and relevant headers;
- media type and byte length;
- FactBase-authenticated `observedAt`;
- representation/content hash;
- capture canonical and capture-canonical hash;
- original retention policy/reference authority;
- raw-object identity/reference when bytes are retained.

Capture identity, original metadata, hash, observedAt, and original retention
authority are never mutated after creation.

Every successful RetrievalAttempt creates one distinct immutable Capture
identity. Captures with identical content or representation hashes remain
distinct. Capture identity is not content identity and is not blob/object
identity. Physical raw storage may deduplicate identical bytes, but historical
observation occurrences and Capture records must never be collapsed.

Bytes received by a failed attempt do not automatically become Capture
authority. Unsafe, oversized, malformed, unsupported, or integrity-failed
payloads may be retained as explicitly marked diagnostic or quarantine
material under security and retention policy, but they are not authenticated
Captures unless they independently satisfy all Capture requirements.

## 10. Observed, authenticated, and replayable

These are distinct properties:

- `OBSERVED`: FactBase successfully captured a representation at `observedAt`;
- `AUTHENTICATED`: persisted identities, provenance, canonical form, and hash
  validate;
- `REPLAYABLE`: authenticated raw bytes remain available and can be replayed.

A Capture may remain OBSERVED and AUTHENTICATED after it is no longer
REPLAYABLE. Observation authenticity does not assert long-term byte
availability.

## 11. Raw retention and availability

Retention policy classes are:

- `PERMANENT_RAW`;
- `TEMPORARY_RAW`;
- `METADATA_HASH_ONLY`.

The policy and its version are capture authority. Raw bytes may be retained
in immutable content-addressed storage, retained temporarily, or not retained
where policy or law prohibits it.

Later deletion, expiry, restriction, loss, or unavailability never mutates a
Capture. It is represented by an append-only Retention/Availability event
containing event identity, capture identity, event type, reason, policy or
legal basis where applicable, timestamp, resulting availability semantics, and
canonical/hash authority when persisted.

After raw deletion, FactBase may state that representation hash H was observed
at time T, but must not claim that the bytes remain replayable. The Contract
therefore distinguishes observation authenticity from content replayability.

## 12. Time semantics

RCV-020 keeps these dimensions distinct:

`scheduledAt`, `triggerReceivedAt`, `requestedAt`, `retrievalStartedAt`,
`retrievalCompletedAt`, `observedAt`, `sourcePublishedAt`,
`sourceModifiedAt`, `handoffCreatedAt`, downstream `knowledgeAt`, and
world-event time.

`observedAt` is the FactBase-authenticated time at which the successful
representation was captured and finalized. `sourcePublishedAt` and
`sourceModifiedAt` are optional source-asserted metadata and may be absent or
unreliable. They never substitute for observedAt.

World-event time is outside RCV-020 authority unless supplied as independently
authenticated later data. `observedAt` never substitutes for downstream
RCV-019 `knowledgeAt`; RCV-019 remains the authority for its own historical
knowledge time.

## 13. Request and query authority

Where request semantics affect result meaning, the attempt must preserve a
deterministic request/query canonical form and hash, relevant parameters,
method, target identity, and configuration/version reference. Secrets and
tokens must never be persisted as canonical authority.

## 14. Empty results

`CAPTURED_EMPTY` means that FactBase successfully executed one exact,
authenticated request/query and the source returned zero items or an empty
result under the adapter's frozen deterministic rules. Request/query
canonicalization and hashing make that result reproducible.

EMPTY means only: “this source returned an empty result to this exact request
at this time.” It never means that nothing existed, that an event did not
happen, that no evidence exists, or that a claim is false.

## 15. Unchanged results

`CAPTURED_UNCHANGED` requires an explicit prior Capture or source-revision
authority, reproducible comparison inputs, and a deterministic comparison
algorithm identity/version.

RCV-020 authoritative equality is limited to raw-byte equality or deterministic
representation equality. Semantic similarity, AI similarity, or inferred
meaningful-content equality is derived and non-authoritative in RCV-020.

## 16. Change and revision authority

The model must distinguish first observation, changed representation, unchanged
representation, empty result, redirect/replacement, and observable deletion,
withdrawal, or correction signals. Where available, source-provided revision
identity is retained. Observation occurrence identity remains distinct from
content identity, capture identity, and source-revision identity.

Repeated identical observations remain separate occurrences because they are
material to coverage and operational history.

## 17. Coverage authority

Coverage describes observation behavior, never truth. For scheduled monitoring,
the denominator is all due ObservationOccurrences during the requested
interval under valid active MonitorConfigurationVersions, evaluated with the
immutable cutoff authority defined in this Contract.

Retries do not increase the denominator. `DISABLED` and `NOT_APPLICABLE` do
not fabricate occurrences and do not enter the denominator as expected work.

Transparent coverage counts include at least:

`EXPECTED`, `ATTEMPTED`, `SUCCEEDED`, `FAILED`, `MISSED`, and `SKIPPED`.

`SUCCEEDED` includes changed, unchanged, and empty successful captures.
Coverage reports must expose the denominator and outcome counts rather than
imply universal or exhaustive search.

## 18. Coverage evaluation and event-driven coverage

Determining MISSED or a terminal coverage result requires immutable evaluation
authority: occurrence due time, grace/deadline rule, scheduling policy/version,
and evaluation cutoff/evaluatedAt. Retrospective mutable interpretation is
forbidden.

For EXTERNAL-triggered monitoring, coverage measures processing of external
events actually received and accepted by FactBase. FactBase must not infer
events that were never delivered. Upstream delivery completeness is UNKNOWN
unless an authenticated external sequence, ledger, manifest, or delivery
receipt proves what should have been delivered. Scheduled denominators must
not be reused to imply upstream event completeness.

## 19. Trigger origins and non-occurrence states

The generic trigger-origin vocabulary is `SCHEDULED`, `EXTERNAL`, and
`OPERATOR`. Trigger-specific authority is preserved without creating
incompatible occurrence models.

Disabled, paused, retired, and non-applicable conditions belong to Monitor,
configuration, and scheduling authority. They explain why no occurrence was
created and are not terminal occurrence outcomes.

## 20. Derived extraction and AI

Derived extraction includes titles, authors, dates, text, entities, claim
candidates, topics, duplicate candidates, summaries, links, and
prioritization. It is never authority over raw observation.

Persisted derived output must reference its input Capture, parser/tool/model
identity and version where applicable, configuration or prompt identity where
required, and deterministic canonical/hash authority where persisted.

AI may assist with classification, entity and claim-candidate extraction,
duplicate detection, source linking, prioritization, and research-query
generation. AI may not authoritatively establish source existence, source
identity, observed bytes, observedAt, truth, support, contradiction,
authoritative UNCHANGED, world-event time, or upstream event completeness.

## 21. Authenticated handoff to evidence ingestion

RCV-020 owns an immutable observation-side handoff record. Downstream evidence
ingestion owns evidence creation. RCV-020 never directly mutates RCV-019.

The handoff preserves at least:

- handoff identity;
- Capture, LogicalSource, Monitor, and MonitorConfigurationVersion identities;
- ObservationOccurrence and RetrievalAttempt identities;
- capture hash and raw-object reference/availability state;
- observedAt and optional source publication metadata;
- source-provided artifact identity where available;
- derived extraction reference/version/hash where used;
- provenance manifest;
- handoff canonical/hash;
- handoff creation time.

The same capture may feed multiple later Claims. Each downstream Claim retains
the same Capture and provenance authority.

The handoff records an immutable snapshot of raw-object identity/reference and
availability/retention authority as known at handoff creation. It must not
embed a mutable live storage-state lookup. Relevant Retention/Availability
event identities may be referenced. Later deletion, restriction, expiry, loss,
or unavailability creates new append-only events and never rewrites historical
handoff content.

The same logical capture-to-ingestion handoff must not create duplicate
underlying evidence authority. Its deterministic idempotency identity is the
canonical tuple of Capture identity, downstream ingestion namespace/target,
handoff purpose/version, and applicable derivation identity. A divergent
derivation or configuration is a distinct handoff version or explicit
conflict, never an overwrite.

## 22. Optional research-trigger boundary

RCV-020 may persist a minimal immutable research-trigger request, but does not
execute research. Such a request contains trigger identity, originating
Capture or ObservationOccurrence, trigger type, deterministic rule
identity/version, createdAt, optional canonical query specification/hash, and
the downstream execution owner.

Research execution, status, and results belong to a future Research
Orchestration RCV. Any later search result that becomes an observation must
enter through the normal ObservationOccurrence → RetrievalAttempt → Capture
path.

## 23. Switzerland pilot

Switzerland is pilot and implementation scope only. The core schema is not
Switzerland-specific; jurisdiction and source class are data.

Potential pilot classes include federal and cantonal authorities, courts,
legislative/parliamentary sources, statistical authorities, public
health/science institutions, universities and research institutions, official
registers, public datasets, official press releases, selected news feeds, and
scientific publication feeds. No vendor or fixed source list is frozen here.

## 24. Storage authority

The Contract permits a hybrid implementation. PostgreSQL or equivalent
authoritative metadata storage may hold identities, metadata, canonical forms,
hashes, outcomes, relationships, coverage, retries, handoffs, and retention
events. Immutable content-addressed object/blob storage may hold raw bytes and
large artifacts.

The Contract freezes identity, integrity, retention, and replayability
semantics, not a storage vendor. Derived text and extraction artifacts remain
capture-linked and versioned.

## 25. Security and access boundaries

RCV-020 ingestion must provide appropriate defenses for endpoint allowlists,
SSRF prevention, redirect restrictions, payload size limits, malformed payload
rejection, parser isolation, credential-reference protection, and source rate
limits.

Account security, login protection, user permissions, DDoS protection, and
generic application-abuse controls belong to the Security/Platform track.

Monitoring configuration and capture authority must be able to record access
policies, authentication requirements, rate limits, retention restrictions,
redistribution/copyright constraints, personal-data sensitivity, and other
applicable legal or contractual restrictions. This Contract does not make
legal conclusions.

## 26. Historical immutability and fail-closed behavior

Append-only authority applies to LogicalSource history, Monitor history,
MonitorConfigurationVersion, ObservationOccurrence, RetrievalAttempt,
Capture, failures, retries, activation/retirement, coverage, raw availability
events, handoffs, and trigger requests. Corrections are new authority.

Authoritative writes and verification fail closed on malformed identities,
canonical forms or hashes, invalid timestamps or enums, unsupported versions,
invalid occurrence/attempt relationships, impossible retry lineage, invalid or
overlapping configuration intervals, invalid request/query authority,
capture without a valid parent attempt, unsafe redirects, unsupported media,
oversized payloads, unverifiable integrity, or invalid handoff authority.

No invalid historical authority may be silently normalized, repaired, replaced
by current state, or rewritten.

## 27. Canonicalization, hashing, and versioning

Future implementations must provide deterministic canonical/hash identity for
MonitorConfigurationVersion, ObservationOccurrence where required,
RetrievalAttempt authority where required, Capture envelopes, request/query
authority, retained relationship manifests, Retention/Availability events,
handoffs, persisted derived extraction, and persisted research triggers.

The canonical inputs and determinism requirements are frozen here. Concrete
serialization bytes may be specified by the Implementation Design. Historical
records retain the exact Contract, canonical schema, failure taxonomy,
comparison algorithm, adapter, parser, retention policy, and handoff
canonical/idempotency versions used at creation.

## 28. RCV-019 and future RCV boundaries

The authenticated handoff is:

`RCV-020 Observation → authenticated handoff → downstream
evidence/provenance ingestion → claim/evidence pipeline → later RCV-019
temporal evolution`.

RCV-020 never alters an RCV-019 timeline. Future RCVs may add Research
Orchestration, Claim Extraction, historical source/evidence profiles,
independence analysis, editorial layers, methodology history, and continuous
re-evaluation without rewriting existing RCV-020 observations.

## 29. Explicit non-goals

RCV-020 does not provide truth, support, contradiction, trust, credibility,
reputation, source ranking, journalist/editorial commentary, historical source
profiles, final evidence independence, global-web completeness, active research
execution, claim-extraction authority, replacement for RCV-019, direct RCV-019
mutation, official-is-true inference, observed-is-supported inference,
not-observed-is-false inference, empty-is-false inference,
more-observations-is-stronger inference, AI observation authority, or rewriting
prior observation history.

## 30. Contract invariants

The following invariants are mandatory:

1. LogicalSource, Monitor, and MonitorConfigurationVersion identities remain
   distinct.
2. ObservationOccurrence and RetrievalAttempt identities remain distinct.
3. A due occurrence may be MISSED without an attempt; retries remain separate.
4. Occurrence outcomes are only SUCCEEDED, FAILED, MISSED, and SKIPPED.
5. DISABLED and NOT_APPLICABLE do not fabricate occurrences.
6. Capture authority never mutates after creation.
7. Raw availability changes are append-only events.
8. OBSERVED, AUTHENTICATED, and REPLAYABLE remain distinct.
9. EMPTY is an exact request result, never world absence.
10. UNCHANGED is deterministic comparison to explicit prior authority.
11. External coverage never implies undelivered upstream events.
12. AI and derived extraction never replace raw observation authority.
13. RCV-020 never directly mutates RCV-019 or uses current-state fallback.
14. Historical corrections create new authority and never silently repair old
    records.

## 31. Contract status

This document is RCV-020 Contract V1. It freezes the authority boundary and
semantic invariants discovered during RCV-020 discovery. The Implementation
Design may specify concrete schemas, adapters, storage, scheduling, and
serialization while remaining compatible with this Contract.
