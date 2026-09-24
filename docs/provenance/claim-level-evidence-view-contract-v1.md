# Claim-Level Evidence View Contract V1

Contract status: DRAFT FOR REVIEW

## 1. Purpose and scope

This Contract defines a deterministic, read-time Claim-Level Evidence View
over authenticated RCV-022 semantic-analysis authorities. The view makes the
authenticated Assessment occurrences selected by an explicit scope visible
for exactly one ClaimVersion. It collects and exposes existing semantic
authority; it does not create a new evidence judgment.

This Contract does not change RCV-022, RCV-018, RCV-020, RCV-021, or any other
upstream authority. It defines no database schema, persistence mechanism,
service, query, migration, execution receipt, or implementation strategy.

## 2. Boundaries and non-goals

The view MUST NOT:

- determine truth, falsity, probability, confidence, or editorial acceptance;
- calculate support, refutation, or other evidentiary scores;
- apply majority, arithmetic, weighting, ranking, or preference semantics;
- rank sources, MethodsProvenance, Assessments, Envelopes, or occurrences;
- select a preferred Assessment or MethodProvenance;
- merge ClaimVersions, Claims, or cross-Claim results;
- infer contradiction across Envelopes or across ClaimVersions;
- claim global evidence, source, retrieval, observation, or research
  completeness;
- discover Envelopes dynamically from current state, time, or database order;
- synthesize explanations, editorial conclusions, or human-review authority;
- create a persisted aggregation authority, execution receipt, cache authority,
  or dynamic historical snapshot authority.

“Aggregation” in this Contract means deterministic collection and projection
of already authenticated authorities only.

## 3. Subject

One view concerns exactly one authenticated immutable ClaimVersion.

The view MUST bind the exact ClaimVersion identity, canonical version, and
canonical hash. Every scoped Envelope and every included Assessment occurrence
MUST bind that same ClaimVersion. A predecessor, successor, or semantically
similar ClaimVersion MUST NOT be inherited, merged, or substituted.

The conceptual ClaimVersionRef is the exact persisted ClaimVersion identity,
canonical version, and canonical hash. Its canonical Claim identity binding is
verified transitively from the authenticated ClaimVersion authority.

The Claim identity remains traceable through the authenticated ClaimVersion;
this Contract does not define Claim-level rollup semantics.

## 4. Explicit closed Envelope scope

The First Slice accepts an explicitly supplied closed Envelope manifest. Each
entry MUST be an exact authenticated RCV-022 Envelope reference containing:

```text
{ envelopeId, canonicalVersion, canonicalHash }
```

The manifest is a set: an exact duplicate Envelope reference is malformed, and
conflicting references for one Envelope identity are not an alternate
selection. An empty manifest is valid and produces an empty view; it means only
that no Envelope occurrence was placed in this requested scope.

The supplied manifest defines the entire candidate universe. No automatic
selection rule exists. In particular, the view MUST NOT select:

- all Envelopes;
- latest Envelopes or latest analysis runs;
- trusted or approved Envelopes;
- Envelopes before a cutoff;
- Envelopes by current Claim, source, scheduler, provider, method, or runtime
  state.

No separate AnalysisRun authority is required to identify an exact Envelope.
If a later layer requires run grouping or dynamic selection, that layer MUST
define a separate immutable authority and Contract.

## 5. Envelope authentication and candidate enumeration

Every scoped Envelope MUST be independently authenticated using its persisted
canonical authority and exact ordered membership. Its canonical
`assessmentRefs` and the corresponding membership projection MUST agree.

Candidates MUST be derived only from the exact ordered AssessmentRefs of the
authenticated scoped Envelopes. The view MUST NOT scan for other Assessments,
Matches, or Envelopes that appear relevant.

One candidate occurrence is one authenticated membership occurrence of one
AssessmentRef in one scoped Envelope. The persisted Envelope ordinal is part
of that occurrence. The occurrence is not a new Assessment authority.

## 6. Whole-view failure and inclusion

An Assessment occurrence is includable only when its scoped Envelope and all
RCV-022 authorities required for authentication succeed, including the
transitive Claim, ClaimVersion, EvidenceFragment, Capture, Match, Assessment,
MethodProvenance, reference, membership, closure, and relation checks required
by the frozen authorities.

If any explicitly scoped Envelope, Assessment occurrence, or transitive
authority fails verification, the entire view MUST fail closed. The view MUST
NOT return a partial successful result, silently drop the invalid candidate,
downgrade the failure to a warning, repair persisted state, or substitute
current state.

The First Slice has no semantic exclusion policy:

- scoped and valid means included;
- scoped and invalid means whole-view failure;
- not explicitly scoped means not a candidate.

There is no valid-but-excluded result state and no quality, trust, confidence,
relevance, preferred-method, or preferred-Assessment exclusion.

A malformed ViewSpec or malformed explicit manifest is a view-input failure.
Otherwise, underlying RCV-022 failure concepts and their deterministic
precedence remain authoritative. This Contract adds no broad replacement
failure taxonomy.

## 7. Assessment identity and occurrence

The result MUST preserve the distinction between immutable Assessment identity
and Envelope occurrence.

The derived AssessmentManifest contains each unique authenticated Assessment
reference once. The derived OccurrenceManifest contains every actual scoped
Envelope membership occurrence, preserving at least:

```text
EnvelopeRef
AssessmentRef
persisted Envelope ordinal
```

The same immutable Assessment MAY occur in multiple valid Envelopes. It remains
one Assessment identity with multiple occurrences. A duplicate Assessment in
one Envelope remains invalid under RCV-022 and cannot increase counts or
weight.

## 8. Provenance and historical bindings

Every included Assessment MUST remain reconstructably traceable through the
authenticated chain:

```text
Claim
  -> ClaimVersion
  -> EvidenceFragment
  -> RCV-020 Capture authority
  -> ClaimEvidenceMatch
  -> EvidenceAssessment
  -> embedded MethodProvenance
```

Its Envelope occurrence MUST additionally retain:

```text
SemanticAnalysisEnvelope
  -> assessment membership
  -> persisted ordinal
  -> analysisCutoffAt
  -> analysisAt and Envelope analysis-method provenance
```

Every link MUST use exact immutable identity, canonical version, and canonical
hash material where the upstream authority defines it. Display names,
current rows, or inferred lineage are insufficient.

## 9. Analysis cutoff

The First Slice introduces no global cutoff.

Each scoped RCV-022 Envelope retains its frozen `analysisCutoffAt` meaning:
it is the immutable Envelope-local latest historical authority/evidence
eligibility boundary for that Envelope. The view MUST NOT reinterpret,
replace, weaken, or recompute that meaning.

`analysisCutoffAt` is not a global view cutoff, truth time, Claim-validity
time, or proof that later evidence does not exist. The view MUST NOT use it to
discover or select Envelopes. There is no “all Envelopes before T”, latest
before cutoff, current-clock selection, dynamic historical candidate query, or
global cutoff authority in the First Slice.

## 10. Historical reproducibility and completeness

For this First Slice, the explicit closed Envelope manifest is sufficient to
define the candidate universe. No global SnapshotRef is required. The manifest,
the authenticated Envelope authorities, and their exact ordered AssessmentRefs
are the complete scope input for the read-time projection.

Dynamic scope selection remains out of scope. If introduced later, it MUST use
separate immutable selection or snapshot authority.

The only completeness claim permitted is:

> All Assessment occurrences referenced by the explicit closed Envelope scope
> were deterministically enumerated and considered.

This is **scope-relative enumeration completeness**. It MUST NOT be expressed
as a claim that all relevant or available Envelopes were selected, all
evidence for the ClaimVersion exists, all source material was observed, all
research was performed, or global evidence is complete. No unqualified
`complete = true` claim is authorized.

## 11. MethodProvenance and relations

MethodProvenance MUST be preserved and exposed as provenance only. The method
types `DETERMINISTIC`, `MODEL_ASSISTED`, `HUMAN`, and `MIXED` have no ordering,
priority, or evidentiary weight. Human, model, deterministic, or latest-method
preference is forbidden.

The view MUST preserve the exact RCV-022 relation values:

```text
SUPPORTS
REFUTES
INSUFFICIENT
UNRELATED
```

It MAY display these values across multiple Envelopes, but MUST NOT synthesize
a new relation or resolve a mixed relation set.

RCV-022 contradiction remains Envelope-local. If one Envelope contains
`SUPPORTS` and another contains `REFUTES`, the view MAY expose both but MUST
NOT infer a new RCV-022 contradiction. Any cross-Envelope contradiction rule
requires a separate Contract.

Counts MAY be exposed only as descriptive facts, such as counts of Envelopes,
Assessment identities, occurrences, or relation values. Counts MUST NOT imply
strength, confidence, majority, weighting, probability, or truth, and no
arithmetic evidentiary operation is permitted.

## 12. Deterministic ordering

Ordering exists only for reproducibility and has no evidentiary weight.

Unless the ViewSpec explicitly makes caller order part of its identity, the
derived manifests MUST use these deterministic orders:

1. EnvelopeManifest: lexicographic order of the exact tuple
   `(envelopeId, canonicalVersion, canonicalHash)` using canonical lowercase
   UUID/hash text and numeric canonical version;
2. AssessmentManifest: lexicographic order of the exact tuple
   `(assessmentId, canonicalVersion, canonicalHash)` using the same rules;
3. OccurrenceManifest: the Envelope-reference order above, then ascending
   persisted Envelope ordinal.

Changing technical order MUST NOT change evidentiary meaning. Envelope-internal
assessment order remains the RCV-022 canonical identity/order already persisted
by that Envelope; it is not a ranking.

## 13. ViewSpec and ViewResult

Conceptually, a ViewSpec contains only:

- the exact ClaimVersion reference;
- the explicit closed Envelope manifest; and
- the applicable Claim-Level Contract/projection version.

The First Slice does not require separate `AdmissionPolicyVersion` or
`ProjectionVersion` authorities. The Claim-Level Contract version is the
minimum semantic versioning authority. Separate version identities require a
later independently versioned semantic need.

A ViewResult conceptually contains:

- the unique authenticated AssessmentManifest;
- the complete OccurrenceManifest;
- the Envelope provenance required for traceability; and
- the scope-relative enumeration completeness statement/status.

ViewSpec defines the requested input. ViewResult is a deterministic projection
of that input and authenticated persisted authorities; result content MUST NOT
feed back into ViewSpec identity.

## 14. Read-time projection and authentication independence

The First Slice is a deterministic read-time projection. It creates no
persisted AggregateView authority, materialized semantic snapshot, execution
receipt, cache authority, new semantic table, or new semantic identity beyond
the derived projection manifests.

The implementation MUST independently authenticate all scoped historical
authority. It MUST NOT treat a prior Reader boolean as the semantic oracle or
trust Writer admission as verification proof. Generic canonicalization and
hash primitives MAY be reused.

Verification and projection MUST be read-only semantically and MUST NOT repair
hashes, rebuild missing authority, alter ordinals, replace references, remove
invalid candidates, reconstruct history, or backfill authority.

## 15. Current-state, current-clock, and determinism rules

The view MUST NOT depend on current Claim state, source or Capture
configuration, matcher or method configuration, provider, model, tool,
Scheduler, Operation, Run, or other mutable runtime state as historical
authority.

The view MUST NOT use the current wall clock to select or reinterpret
historical inputs. Historical timestamps MAY be parsed and displayed under
their frozen authority rules only.

For the same exact ClaimVersion reference, Envelope manifest, persisted
authorities, and Contract version, the semantic result MUST be the same. It
MUST NOT depend on database natural row order, query encounter order, object
iteration order, current time, current configuration, or randomness.

## 16. Upstream boundaries

RCV-018 retains ownership of EvidenceAssertion validation, comparison, and
cross-Claim contradiction semantics. This view MUST NOT absorb those duties.

RCV-020 retains ownership of Capture, Observation, Retrieval, and source/
handoff provenance. This view makes no source, retrieval, or observation
completeness claim.

RCV-021 retains ownership of research strategy, Operation, Run, result
provenance, and active-research behavior. Integrated RCV-021 handoff is not
required for this First Slice, and this view makes no research-completeness
claim.

## 17. Explicit non-goals

The following are outside this Contract:

- support, refutation, confidence, or probability scores;
- majority winners or weighted relations;
- method or source weighting/ranking;
- preferred Assessments or MethodProvenance;
- truth verdicts or “likely true/false” conclusions;
- cross-Envelope contradiction;
- cross-Claim aggregation;
- global evidence completeness;
- dynamic Envelope discovery;
- explanation synthesis, editorial acceptance, or HITL authority;
- persisted aggregation authority, execution receipts, or dynamic snapshot
  semantics.

## 18. North Star

RCV-022 defines individual authenticated evidence relationships. This layer
adds a transparent, reproducible, scope-relative view of those authenticated
Assessments across explicitly named analysis Envelopes. It increases
visibility and traceability without changing evidentiary meaning.
