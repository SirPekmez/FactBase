# RCV-022 Semantic Analysis Contract V1

Contract status: draft for review. Runtime implementation and implementation
design are not authorized by this document.

## 1. Purpose and authority boundary

RCV-022 is FactBase's immutable semantic-analysis authority for authenticated
ClaimVersions and authenticated EvidenceFragments. It makes visible which
historical material was evaluated, how it was matched, which method produced
the assessment, and what relation was recorded.

RCV-022 is transparent, reproducible, traceable, and historically verifiable.
It is not truth adjudication, a credibility system, a source-trust system, a
research scheduler, a retrieval system, or a final public verdict layer.

The only V1 authority entities are:

1. `EvidenceFragment`;
2. `ClaimEvidenceMatch`;
3. `EvidenceAssessment`;
4. `SemanticAnalysisEnvelope`.

There is no separate HumanReview or MethodProvenance entity in V1.

`reviewStatus` is a closed provenance value of `NOT_REVIEWED` or `REVIEWED`.
For `MIXED` method provenance, `acceptanceStatus` is a separate closed
provenance value of `PENDING`, `ACCEPTED`, or `REJECTED`. Neither status is a
truth judgment or a relation, and neither changes `SUPPORTS`, `REFUTES`,
`INSUFFICIENT`, or `UNRELATED`. A disagreement or override is represented by a
new Assessment, not by mutating an existing Assessment.

## 2. Canonicalization and immutable identity

Every RCV-022 authority uses a versioned canonical schema, RFC 8785/JCS UTF-8
canonical bytes, and SHA-256 lowercase hexadecimal hash. Canonical fields are
exactly the fields listed in this Contract. A physical Design may choose
columns and types but may not add, remove, rename, or reinterpret semantic
hash fields.

Logical identities are assigned immutable identities. A content hash
authenticates content; it is not a substitute for an assigned identity. Equal
bytes do not collapse distinct historical occurrences.

Invalid, missing, unsupported, or divergent authority fails closed. No
verifier repairs or normalizes persisted authority.

## 3. EvidenceFragment identity and authority

An EvidenceFragment has an assigned immutable `fragmentId`. One identity means
one exact fragment occurrence and binding to one authenticated RCV-020 Capture.
The identity is not derived from content alone.

Every Fragment binds exactly:

- `captureId`;
- `captureCanonicalVersion`;
- `captureCanonicalHash`;
- `captureRepresentationHash`;
- `fragmentKind`;
- `locator`;
- `contentBinding`;
- `extractionAuthority`.

Changing the Capture binding, fragment kind, locator, content binding, or
extraction authority requires a new `fragmentId`. Distinct occurrences and
locations remain distinct even when their bytes are equal.

The exact Fragment canonical fields, in order, are:

```text
schema
canonicalVersion
fragmentId
captureId
captureCanonicalVersion
captureCanonicalHash
captureRepresentationHash
fragmentKind
locator
contentBinding
extractionAuthority
```

`fragmentKind` is a closed value of `TEXT`, `STRUCTURED`, or `IMAGE_REGION`.
`locator` is a closed tagged object with the exact shapes defined below. No
locator normalization is performed. No frozen RCV-020 or repository
fragment-locator convention exists; the following V1 representation is
therefore the complete authority, not an implementation-defined path syntax.

```text
WHOLE_TEXT:
  { kind: "WHOLE_TEXT" }

UTF8_BYTE_RANGE:
  { kind: "UTF8_BYTE_RANGE", startByte, endByteExclusive }

STRUCTURED_PATH:
  { kind: "STRUCTURED_PATH", segments }

IMAGE_REGION:
  {
    kind: "IMAGE_REGION",
    coordinateSystemId: "raw-pixel-v1",
    coordinateSystemVersion: 1,
    imageWidth, imageHeight,
    x, y, width, height
  }
```

`WHOLE_TEXT` is the only whole-representation text locator. A
`UTF8_BYTE_RANGE` is measured against authenticated Capture representation
bytes, has non-negative safe-integer `startByte`, safe-integer
`endByteExclusive > startByte`, and uses the half-open interval
`[startByte, endByteExclusive)`. A structured `segments`
array is ordered from root to leaf and contains exactly `{ kind: "KEY", key }`
or `{ kind: "INDEX", index }`; `key` is the exact persisted UTF-8 string and
`index` is a non-negative integer using zero-based array indexing (`0` is the
first element). Negative, one-based, relative, and current-parser-dependent
interpretations are invalid. An empty segment array denotes the structured
root.

An `IMAGE_REGION` uses the exact authenticated Capture representation's
positive-integer `imageWidth` and `imageHeight`, non-negative integer x/y raw
pixels, origin at the top-left, x increasing rightward, y increasing
downward, positive-integer `width` and `height`, and the half-open rectangle
`[x, x + width) × [y, y + height)`. Its coordinate system identity and
version are fixed above. The repository has no prior image-coordinate
authority, so this raw-pixel form is the smallest V1 shape that avoids
normalized-coordinate or parser/model semantics. OCR is not required.

The exact IMAGE_REGION validity conditions are `imageWidth >= 1`,
`imageHeight >= 1`, `x >= 0`, `y >= 0`, `width >= 1`, `height >= 1`,
`x + width <= imageWidth`, and `y + height <= imageHeight`. An out-of-bounds
region is invalid and fails closed. There is no clipping, wrapping, implicit
resizing, normalization, or coordinate conversion.

At Fragment-authority creation, `imageWidth` and `imageHeight` must be
validated against the exact authenticated Capture representation bound by
`captureRepresentationHash`. They may not come from current mutable metadata,
UI state, unrelated image metadata, a different representation, or an
unverified derived image. The dimensions are immutable EvidenceFragment
authority and historical verification authenticates them as part of the
canonical locator; current decoder state is not a substitute.

`contentBinding` is exactly one of:

```text
TEXT:
  { kind: "TEXT", utf8Text, contentHash }

STRUCTURED:
  { kind: "STRUCTURED", canonicalVersion, canonical, canonicalHash }

IMAGE_REGION:
  { kind: "IMAGE_REGION", sourceRepresentationHash }
```

For `TEXT`, `utf8Text` is exact UTF-8 content and `contentHash` is the
lowercase SHA-256 of those UTF-8 bytes. For `STRUCTURED`, `canonicalVersion`
is the authenticated upstream representation version, `canonical` is its exact
canonical representation, and `canonicalHash` is the corresponding lowercase
SHA-256. For `IMAGE_REGION`, `sourceRepresentationHash` must equal the
Fragment's `captureRepresentationHash`; the locator alone owns coordinate
system, dimensions, and region geometry. Text content is compatible only with
`WHOLE_TEXT` or `UTF8_BYTE_RANGE`; structured content is compatible only with
`STRUCTURED_PATH`; image content is compatible only with `IMAGE_REGION`.
Invalid tag combinations fail closed.

`extractionAuthority` is exactly one of:

```text
DIRECT:
  { kind: "DIRECT" }

DERIVED:
  { kind: "DERIVED", extractorIdentity, extractorVersion, extractorHash }
```

Candidate proposition extraction is non-authoritative for Claim identity. It
cannot create or revise a Claim or ClaimVersion; acceptance must use the
upstream RCV-009 Claim authority path.

ObservationOccurrence provenance is conditional. It is required when the
Fragment asserts occurrence-specific provenance. An RCV-020 AuthenticatedHandoff
is optional for core RCV-022 analysis and, when supplied, must be independently
authenticated. Exact RCV-021 selected-result to RCV-020 Capture lineage is not
a core RCV-022 prerequisite.

## 4. Claim and ClaimVersion binding

Every RCV-022 authority that depends on Claim semantics binds authenticated
Claim Historical Authority V1. The Claim binding is exactly:

```text
claimId
claimCanonicalVersion
claimCanonicalHash
```

The ClaimVersion binding is exactly:

```text
claimId
claimVersionId
claimVersionCanonicalVersion
claimVersionCanonicalHash
```

Current Claim or ClaimVersion row content never substitutes for missing
historical authority.

## 5. ClaimEvidenceMatch identity and authority

A ClaimEvidenceMatch has an assigned immutable `matchId`. It is the authority
that records an evaluated ClaimVersion–EvidenceFragment pairing under one exact
matcher authority and matcher-relevant input context. It does not determine the
semantic relation.

The exact Match canonical fields, in order, are:

```text
schema
canonicalVersion
matchId
claimId
claimCanonicalVersion
claimCanonicalHash
claimVersionId
claimVersionCanonicalVersion
claimVersionCanonicalHash
evidenceFragmentId
evidenceFragmentCanonicalVersion
evidenceFragmentCanonicalHash
matcherIdentity
matcherVersion
matcherHash
matcherInputCanonicalHashes
```

There is no `matchDecision` field. The existence of a Match records an
evaluated pairing; it does not mean SUPPORTS, REFUTES, INSUFFICIENT, or
UNRELATED. Absence of a Match is never historical UNRELATED authority.

V1 has no separate authoritative matcher-output value beyond the existence of
the evaluated Match and its immutable matcher/input authority. A future
matcher output with independent semantic meaning would require a later
Contract; it is not hidden in V1.

A Match may be reused by multiple EvidenceAssessments only while all of its
ClaimVersion binding, EvidenceFragment binding, matcher identity/version/hash,
and matcher-relevant input context remain identical. Any change to those
inputs requires a new Match identity.

## 6. EvidenceAssessment identity and relation authority

An EvidenceAssessment has an assigned immutable `assessmentId`. One identity
represents one semantic assessment of one Match under one method/provenance,
input, review, and assessment-time context. One Match may have many immutable
Assessments.

The exact Assessment canonical fields, in order, are:

```text
schema
canonicalVersion
assessmentId
claimEvidenceMatchId
claimEvidenceMatchCanonicalVersion
claimEvidenceMatchCanonicalHash
claimId
claimCanonicalVersion
claimCanonicalHash
claimVersionId
claimVersionCanonicalVersion
claimVersionCanonicalHash
evidenceFragmentId
evidenceFragmentCanonicalVersion
evidenceFragmentCanonicalHash
assessmentResult
methodProvenance
assessedAt
```

`assessmentResult` is exactly:

```text
{ relation, rationale }
```

`rationale` is exact immutable UTF-8 text. It is explanatory assessment
authority and is not a substitute for the closed relation value.

The closed V1 relation set is exactly:

- `SUPPORTS` — the authenticated Fragment materially entails the Claim within
  the declared context;
- `REFUTES` — the authenticated Fragment materially entails an incompatible
  proposition within the declared context;
- `INSUFFICIENT` — the material is semantically relevant but does not establish
  support or refutation, including partial scope, missing qualifiers, temporal
  mismatch, context mismatch, or insufficient specificity;
- `UNRELATED` — the material has no material semantic pertinence to the Claim.

Exactly one relation is permitted per Assessment. `PARTIAL_SUPPORT`,
`PARTIAL_REFUTATION`, and `MIXED` are not V1 relations. Mixed material must be
split into separate EvidenceFragments where semantically valid; otherwise the
input fails closed as unsupported semantic input.

No search result, failed retrieval, unavailable source, missing source, absent
passage, or absence of evidence automatically means REFUTES. Only explicit
authenticated evidence-of-absence propositions may support or refute an
absence Claim.

Authoritative assessment requires an atomic Claim proposition. Compound Claims
must be decomposed upstream; RCV-022 does not conceal subclaims behind one
coarse relation.

## 7. Method provenance

`EvidenceAssessment.methodProvenance` authenticates the method that produced
that Assessment's semantic relation and rationale. It is one embedded
immutable canonical tagged object inside the Assessment. It is not a separate
authority entity and has the explicit
discriminator `methodType`. The only values are `DETERMINISTIC`,
`MODEL_ASSISTED`, `HUMAN`, and `MIXED`. No variant has extra keys or null
placeholders; not-applicable fields are omitted. Missing required provenance
fails closed. `structuredOutputHash` and, where applicable, `rawOutputHash`
occur only inside this object.

`reviewStatus` is exactly `NOT_REVIEWED` or `REVIEWED` in every variant.
`acceptanceStatus` occurs only in `MIXED` and is exactly `PENDING`, `ACCEPTED`,
or `REJECTED`. These are provenance statuses only; they do not alter the
assessment relation.

No frozen repository sampling-parameter schema exists. V1 therefore freezes
`samplingParameters` as the exact object:

```text
{
  schema: "factbase-rcv022-sampling-parameters",
  canonicalVersion: 1,
  entries: [ { name, value }, ... ]
}
```

Each `entries` item has exactly `name` and `value`; names are unique and the
array is ordered by UTF-8 byte order of `name`. `value` is exactly a string, a
finite number, or a boolean; nulls, objects, and arrays are forbidden. An
empty `entries` array is allowed only when the actual execution exposed no
sampling parameters, never as fabricated metadata.

`samplingParametersHash` is the lowercase SHA-256 of the exact RFC 8785/JCS
UTF-8 bytes of that `samplingParameters` object.

In every method variant, `inputCanonicalHashes` is an ordered array of
immutable lowercase canonical hashes; its order is part of the authority.

The exact canonical keys for each tagged variant are:

```text
DETERMINISTIC:
  methodType methodIdentity methodVersion methodHash inputCanonicalHashes
  structuredOutputHash reviewStatus

MODEL_ASSISTED:
  methodType methodIdentity methodVersion methodHash providerIdentity
  modelIdentity modelVersion processIdentity processVersion processHash
  promptTemplateHash systemInstructionHash samplingParameters
  samplingParametersHash inputCanonicalHashes rawOutputHash
  structuredOutputHash retryIdentity reviewStatus [toolContextHash]

HUMAN:
  methodType methodIdentity methodVersion methodHash reviewerIdentity
  reviewProcessIdentity reviewProcessVersion reviewProcessHash
  inputCanonicalHashes structuredOutputHash reviewStatus

MIXED:
  methodType methodIdentity methodVersion methodHash providerIdentity
  modelIdentity modelVersion processIdentity processVersion processHash
  promptTemplateHash systemInstructionHash samplingParameters
  samplingParametersHash inputCanonicalHashes rawOutputHash
  structuredOutputHash retryIdentity reviewerIdentity reviewProcessIdentity
  reviewProcessVersion reviewProcessHash reviewStatus acceptanceStatus
  [toolContextHash]
```

`toolContextHash` is required in `MODEL_ASSISTED` and `MIXED` exactly when
tools materially participated in execution; otherwise it is omitted. The
fields omitted from `DETERMINISTIC` are provider/model/process/prompt/system,
sampling, tool-context, raw-output, retry, reviewer, review-process, and
acceptance fields. The fields omitted from `HUMAN` are provider/model/process,
prompt/system, sampling, tool-context, raw-output, retry, and acceptance
fields. `MIXED` includes the exact union shown above, with no other key. A
human disagreement or override is a new Assessment; an existing Assessment
is never mutated.

## 8. SemanticAnalysisEnvelope

An Envelope has an assigned immutable `envelopeId` and binds exactly one
authenticated ClaimVersion, one analysis cutoff, one analysis method, one Match
member set, and one Assessment member set. It is not a multi-Claim aggregate.

The exact Envelope canonical fields, in order, are:

```text
schema
canonicalVersion
envelopeId
claimId
claimCanonicalVersion
claimCanonicalHash
claimVersionId
claimVersionCanonicalVersion
claimVersionCanonicalHash
analysisCutoffAt
analysisAt
matchRefs
assessmentRefs
analysisMethodIdentity
analysisMethodVersion
analysisMethodHash
```

`matchRefs` are ordered immutable entries exactly shaped as:

```text
{ id, canonicalVersion, canonicalHash }
```

`assessmentRefs` have the same shape. Each corresponding array contains unique
referenced identities: no duplicate `id` may occur within `matchRefs`, and no
duplicate `id` may occur within `assessmentRefs`. Repeating a reference is
invalid and fails closed; it cannot increase evidentiary weight, support
strength, occurrence semantics, or contradiction evidence. Ordering remains
semantically significant because the arrays are canonicalized exactly as
persisted. Every Match binds the Envelope's ClaimVersion. Every Assessment
references a Match present exactly once in `matchRefs`; no foreign ClaimVersion
member is permitted. Multiple different Assessments may reference the same
Match, and multiple different Matches remain distinct identities. Evidence-
Fragments are bound transitively through Matches.

An Envelope may contain zero `matchRefs`. Zero Matches means exactly: no
ClaimVersion–EvidenceFragment pairing was included as an evaluated Match in
this analysis context. Zero Matches must not mean or imply `UNRELATED`,
`INSUFFICIENT`, `REFUTES`, absence of evidence, evidence of absence, no
relevant evidence, no later evidence, exhaustive retrieval, or that research
found nothing. Because every Assessment must reference a Match present in
`matchRefs`, zero Matches necessarily means `assessmentRefs` is exactly empty.
Zero Matches and zero Assessments are distinct but compatible states. A
zero-Assessment Envelope means that no semantic Assessment was produced or
accepted in that analysis context; it is not `UNRELATED`, `INSUFFICIENT`,
`REFUTES`, or evidence-of-absence authority.

`analysisMethodIdentity`, `analysisMethodVersion`, and `analysisMethodHash`
authenticate only the method or process that assembled, selected, ordered, or
contextualized the Envelope and its member set. They do not replace
`EvidenceAssessment.methodProvenance`, determine or rewrite an Assessment
relation, authenticate a semantic Assessment, substitute for missing
Assessment provenance, reinterpret an existing Assessment, or turn an
Assessment into a different relation. Assessment semantic authority remains
exclusively in each EvidenceAssessment. If assembly is deterministic, these
fields remain Envelope-level assembly/context authority only. Historical
verification must use their persisted values and never current mutable method
state.

`analysisCutoffAt` is mandatory and immutable. It is the latest historical
authority/evidence boundary eligible for that Envelope. It is not truth time,
Claim-validity time, or proof that later evidence does not exist.
`analysisAt` records analysis provenance and is distinct from the cutoff.

Changing the cutoff requires a new Envelope. A changed cutoff alone does not
require a new Assessment when an existing authenticated Assessment remains
valid under the new Envelope and its own inputs are unchanged.

## 9. Temporal and upstream context

The following times remain distinct: source publication time, RCV-020
observation/retrieval time, RCV-019 `knowledgeAt`, RCV-021 research time,
Claim-validity context, `analysisCutoffAt`, and `analysisAt`.

`knowledgeAt` is FactBase knowledge time, not truth time. Claim-validity
context is part of the authenticated ClaimVersion semantics and is not replaced
by analysis cutoff. No current temporal state may substitute for an explicit
historical dependency.

RCV-019 temporal context is optional. If bound, it must use the exact
authenticated timeline or point identity/hash and knowledgeAt context.

RCV-021 research provenance is optional. It may bind authenticated Operation,
Run, ProviderResult, or ResultSelection records where available. Core RCV-022
semantic analysis does not require integrated RCV-021-to-RCV-020 lineage.

## 10. Contradiction boundary

A contradiction finding is a derived result within one Envelope and one
authenticated ClaimVersion context. It requires at least one SUPPORTS
Assessment and one REFUTES Assessment in that context. INSUFFICIENT and
UNRELATED do not create contradiction. No cross-Claim contradiction authority
exists in RCV-022, and no separate contradiction entity is introduced.

RCV-018 remains authoritative for structured EvidenceAssertion validation,
authentication, structured historical comparison, cross-Claim comparison,
comparison-domain comparability, incompatibility, and its own contradiction
derivation. RCV-022 may prepare structured input for RCV-018 but does not own
RCV-018 authority.

## 11. Reanalysis and reproducibility

A new model, method, prompt, relevant input, relevant context, or other
assessment-relevant change requires a new EvidenceAssessment. A changed
matcher authority or matcher input requires a new ClaimEvidenceMatch. A changed
ClaimVersion, cutoff, analysis method, or Envelope member set requires a new
SemanticAnalysisEnvelope. Existing authorities coexist immutably.

V1 defines no `supersedes`, `comparesTo`, or `derivedFrom` semantic relation.

The following guarantees are distinct:

1. historical verification of what was persisted then;
2. deterministic recomputation from frozen inputs and deterministic method;
3. stochastic re-execution, for which bit-identical output is not guaranteed;
4. reanalysis under a new method, which creates new immutable authority.

## 12. Source-trust and source-independence boundary

RCV-022 V1 does not own SourceTrust. Existing RCV-014 evidence-assessment
fields are not adopted as SourceTrust authority, and RCV-022 performs no source
credibility inference.

RCV-022 V1 excludes source-independence authority entirely. Existing RCV-014
independence material cannot affect canonical identity, matching, assessment
relation, contradiction, or Envelope validity.

## 13. Failure and verification semantics

The Contract requires fail-closed concepts for:

- `MISSING_AUTHORITY`;
- `UNSUPPORTED_VERSION`;
- `MALFORMED_DATA`;
- `IDENTITY_MISMATCH`;
- `LINEAGE_MISMATCH`;
- `CANONICAL_MISMATCH`;
- `HASH_MISMATCH`;
- `FRAGMENT_BOUNDARY_MISMATCH`;
- `CLAIM_SCOPE_MISMATCH`;
- `TEMPORAL_CONTEXT_MISMATCH`;
- `METHOD_AUTHORITY_MISMATCH`;
- `INVALID_RELATION`;
- `DUPLICATE_CONFLICT`;
- `CONTRADICTION_INPUT_MISMATCH`;
- `CURRENT_STATE_SUBSTITUTION`;
- `UNSUPPORTED_SEMANTIC_INPUT`;
- `REPAIR_ATTEMPT`.

Conceptual precedence is deterministic:

1. structural authority failures;
2. lineage, identity, and hash-authority failures;
3. scope, temporal, and method failures;
4. valid relation and contradiction findings.

Same-class tie-breaking must be independent of database row order.

## 14. No-repair and current-state independence

Readers and verifiers perform no INSERT, UPDATE, DELETE, normalization repair,
reinterpretation repair, hash repair, or authority repair. Invalid persisted
semantic authority remains invalid.

Historical verification uses explicit immutable authority only. Forbidden
substitutes include current ClaimVersion rows without Claim Historical
Authority, current models, parsers, matchers, source metadata, RCV-021
Operation/Run state, Scheduler state, and current normalization behavior.

## 15. Downstream boundary and North Star

RCV-022 does not own Claim-level aggregation, aggregate support scores, truth
verdicts, public confidence, source ranking, competing-Claim ranking, final
editorial or human acceptance, or final user-facing explanation synthesis.

FactBase's North Star is:

> Make visible how well a claim is supported or refuted by the current state of
> documented evidence — transparently, reproducibly, and traceably.

RCV-022 contributes by exposing which authenticated Fragment matched which
authenticated ClaimVersion, using which method, with which relation, under
which historical context, without deciding final truth.

## 16. Authority compatibility and non-goals

- Claim Historical Authority V1 remains the sole Claim and ClaimVersion
  historical identity/content authority.
- RCV-020 remains the sole Capture, ObservationOccurrence, RetrievalAttempt,
  representation, and AuthenticatedHandoff authority.
- RCV-019 remains the temporal and historical knowledge authority.
- RCV-021 remains active-research authority and creates no parallel Capture,
  Handoff, Claim, or semantic-analysis authority.
- RCV-014 and RCV-017 remain unchanged and are not authenticated SourceTrust or
  SourceIndependence dependencies of RCV-022 V1.
- Scheduler and Policy remain temporal eligibility machinery only.

RCV-022 does not retrieve sources, schedule research, create Capture authority,
infer Claim identity, perform source-trust or independence analysis, or replace
RCV-018 structured comparison.

## 17. Contract audit and readiness

This draft was audited against the completed RCV-022 Discovery and correction
closure, Claim Historical Authority V1, RCV-014, RCV-017, RCV-018, RCV-019,
RCV-020, RCV-021, and the Scheduler/Policy boundary.

Audit result:

```text
MISSING = 0
WEAKENED = 0
EXPANDED = 0
CONTRADICTORY = 0
AMBIGUOUS = 0
SEMANTIC_INVENTION = 0
AUTHORITY_LEAKAGE = 0
CURRENT_STATE_SUBSTITUTION_RISK = 0
RELATION_SET_DRIFT = 0
UNRELATED_REPRESENTATION_DRIFT = 0
METHOD_PROVENANCE_DRIFT = 0
CUTOFF_REASSESSMENT_DRIFT = 0
ZERO_MATCH_AMBIGUITY = 0
METHOD_PROVENANCE_AMBIGUITY = 0
ANALYSIS_METHOD_ASSESSMENT_METHOD_AMBIGUITY = 0
LOCATOR_AMBIGUITY = 0
STRUCTURED_PATH_AMBIGUITY = 0
IMAGE_REGION_AMBIGUITY = 0
ENVELOPE_MEMBER_DUPLICATE_AMBIGUITY = 0
EMBEDDED_CANONICAL_FIELD_AMBIGUITY = 0
RCV018_OWNERSHIP_LEAKAGE = 0
RCV020_TRUST_LEAKAGE = 0
RCV021_RESEARCH_LEAKAGE = 0
SCHEDULER_LEAKAGE = 0
TRUTH_ADJUDICATION_LEAKAGE = 0
OPEN_CONTRACT_QUESTIONS = 0
```

This Contract draft does not authorize a Design, migration, implementation, or
runtime behavior.
