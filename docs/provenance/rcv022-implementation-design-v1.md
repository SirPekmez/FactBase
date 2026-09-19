# RCV-022 Semantic Analysis Implementation Design V1

Design status: targeted correction draft for independent audit. This document
implements the corrected RCV-022 Semantic Analysis Contract V1 but does not
change that Contract, any upstream authority, or any semantic relation. The
previous Design was frozen against the pre-repair Contract and is invalidated
until this tool-participation correction is independently re-audited and
re-snapshot-locked.

## 1. Design boundary and repository patterns

The corrected Contract is the sole semantic authority. Its verified SHA-256 is
`5fc81fdb891d5c823d49ea0de710f455ff222ef3229c78ff4bd42ba243d5b01a`.

The design reuses the repository patterns already proven by Claim Historical
Authority, RCV-019, RCV-020, and RCV-021:

- `src/services/canonicalJson.ts` and `canonicalize` 2.1.0 provide the shared
  RFC 8785/JCS UTF-8 canonicalization and SHA-256 lowercase-hex helper;
- canonical text plus canonical hash are persisted together and independently
  recomputed by readers;
- immutable history uses the existing PostgreSQL `BEFORE UPDATE OR DELETE`
  trigger pattern with SQLSTATE `55000`;
- writer primitives accept a caller-owned `PoolClient` and never own
  `BEGIN`, `COMMIT`, or `ROLLBACK`;
- historical readers use a repeatable-read, read-only PostgreSQL transaction,
  SELECT-only projections, deterministic failure precedence, and no writer
  import;
- migrations are additive, ordered SQL files under `migrations/`, and fresh
  disposable PostgreSQL integration tests replay the complete sorted migration
  chain.

No existing RCV-020 fragment locator, image-dimension, RCV-022 method
provenance, or Envelope membership schema exists. The Contract's exact shapes
therefore remain the only semantic source for those values; this Design does
not silently borrow current parser, UI, decoder, or model state.

The future additive migration is exactly
`migrations/rcv022_add_semantic_analysis_authority.sql`. It runs after the
complete existing migration chain, including Claim Historical Authority and
RCV-020, and creates only the four semantic tables, two support tables, their
indexes, checks, foreign keys, admission/deferred validation triggers, and
immutable triggers. It does not alter an upstream table or backfill an
existing Fragment, Match, Assessment, or Envelope.

## 2. Physical authority model

Exactly four tables are semantic authority tables:

1. `public.rcv022_evidence_fragments`;
2. `public.rcv022_claim_evidence_matches`;
3. `public.rcv022_evidence_assessments`;
4. `public.rcv022_semantic_analysis_envelopes`.

Two additional tables are strictly non-authoritative relational projections
used only to enforce Envelope membership foreign keys and duplicate/order
rules:

5. `public.rcv022_envelope_match_refs`;
6. `public.rcv022_envelope_assessment_refs`.

The two support tables are not fifth or sixth semantic entities. Their rows
are immutable projections of the ordered arrays already authenticated by the
Envelope canonical object. A verifier compares both projections with the
canonical arrays and fails closed on any mismatch.

Every semantic table stores `canonical_version INTEGER`, `canonical TEXT`, and
`canonical_hash TEXT`. The canonical text is the exact persisted RFC 8785/JCS
UTF-8 representation; JSON/JSONB columns described below are validation and
query projections, never an alternative authority.

### 2.1 EvidenceFragment

Table: `public.rcv022_evidence_fragments`.

Primary key: `fragment_id UUID`.

Columns:

```text
fragment_id UUID NOT NULL PRIMARY KEY
canonical_version INTEGER NOT NULL CHECK (canonical_version = 1)
canonical TEXT NOT NULL
canonical_hash TEXT NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$')
capture_id UUID NOT NULL
capture_canonical_version TEXT NOT NULL CHECK (capture_canonical_version = 'RCV020-CANONICAL-V1')
capture_canonical_hash TEXT NOT NULL CHECK (capture_canonical_hash ~ '^[0-9a-f]{64}$')
capture_representation_hash TEXT NOT NULL CHECK (capture_representation_hash ~ '^[0-9a-f]{64}$')
fragment_kind TEXT NOT NULL CHECK (fragment_kind IN ('TEXT','STRUCTURED','IMAGE_REGION'))
locator JSONB NOT NULL
content_binding JSONB NOT NULL
extraction_authority JSONB NOT NULL
```

`capture_canonical_version` is the authenticated RCV-020 canonical version
string (`RCV020-CANONICAL-V1` in the current frozen authority). The writer and
reader require `capture_canonical_hash = rcv020_captures.capture_hash` and
`capture_representation_hash = rcv020_captures.content_hash`. The Capture
primary-key foreign key is necessary but does not replace this hash parity
check.

ObservationOccurrence and AuthenticatedHandoff are not physical columns in the
core six-table model. They remain optional upstream context. If either context
materially affects matching or assessment, the exact semantic input consumed
by that method is committed in the applicable ordered input-hash array;
otherwise it is invocation-only and has no RCV-022 authority effect. The
arrays are cryptographic commitments only: they do not encode upstream type,
identity, table, or a globally resolvable typed reference. RCV-022 therefore
does not claim typed occurrence or Handoff lineage from a hash alone. No
hashless occurrence or Handoff context can affect Fragment identity, Match
validity, Assessment relation, or Envelope validity. The core Fragment does
not itself claim occurrence-specific provenance; that optional provenance is
represented only through a hash-bound Match or Assessment input.

The canonical Fragment object contains exactly the Contract fields:

```text
schema canonicalVersion fragmentId captureId captureCanonicalVersion
captureCanonicalHash captureRepresentationHash fragmentKind locator
contentBinding extractionAuthority
```

The nested validators enforce the exact Contract variants. `IMAGE_REGION`
geometry exists only in `locator`; `contentBinding` stores only
`sourceRepresentationHash`, which must equal `captureRepresentationHash`.
The writer validates image dimensions against the exact Capture representation
before inserting the immutable row. It does not obtain dimensions from current
metadata or UI state.

There is no uniqueness constraint on content hashes, locators, or canonical
payloads. Equal bytes and equal payloads can belong to distinct assigned
Fragment identities.

### 2.2 ClaimEvidenceMatch

Table: `public.rcv022_claim_evidence_matches`.

Primary key: `match_id UUID`.

Columns:

```text
match_id UUID NOT NULL PRIMARY KEY
canonical_version INTEGER NOT NULL CHECK (canonical_version = 1)
canonical TEXT NOT NULL
canonical_hash TEXT NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$')
claim_id UUID NOT NULL
claim_canonical_version INTEGER NOT NULL CHECK (claim_canonical_version = 1)
claim_canonical_hash TEXT NOT NULL CHECK (claim_canonical_hash ~ '^[0-9a-f]{64}$')
claim_version_id UUID NOT NULL
claim_version_canonical_version INTEGER NOT NULL CHECK (claim_version_canonical_version = 1)
claim_version_canonical_hash TEXT NOT NULL CHECK (claim_version_canonical_hash ~ '^[0-9a-f]{64}$')
evidence_fragment_id UUID NOT NULL
evidence_fragment_canonical_version INTEGER NOT NULL CHECK (evidence_fragment_canonical_version = 1)
evidence_fragment_canonical_hash TEXT NOT NULL CHECK (evidence_fragment_canonical_hash ~ '^[0-9a-f]{64}$')
matcher_identity TEXT NOT NULL
matcher_version TEXT NOT NULL
matcher_hash TEXT NOT NULL CHECK (matcher_hash ~ '^[0-9a-f]{64}$')
matcher_input_canonical_hashes JSONB NOT NULL
```

There is deliberately no relation, `matchDecision`, or matcher-output column.
Only the assigned `match_id` identifies the pairing. No uniqueness constraint
deduplicates different assigned identities, even when every dependency and
matcher field happens to match.

### 2.3 EvidenceAssessment

Table: `public.rcv022_evidence_assessments`.

Primary key: `assessment_id UUID`.

Columns:

```text
assessment_id UUID NOT NULL PRIMARY KEY
canonical_version INTEGER NOT NULL CHECK (canonical_version = 1)
canonical TEXT NOT NULL
canonical_hash TEXT NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$')
claim_evidence_match_id UUID NOT NULL
claim_evidence_match_canonical_version INTEGER NOT NULL CHECK (claim_evidence_match_canonical_version = 1)
claim_evidence_match_canonical_hash TEXT NOT NULL CHECK (claim_evidence_match_canonical_hash ~ '^[0-9a-f]{64}$')
claim_id UUID NOT NULL
claim_canonical_version INTEGER NOT NULL CHECK (claim_canonical_version = 1)
claim_canonical_hash TEXT NOT NULL CHECK (claim_canonical_hash ~ '^[0-9a-f]{64}$')
claim_version_id UUID NOT NULL
claim_version_canonical_version INTEGER NOT NULL CHECK (claim_version_canonical_version = 1)
claim_version_canonical_hash TEXT NOT NULL CHECK (claim_version_canonical_hash ~ '^[0-9a-f]{64}$')
evidence_fragment_id UUID NOT NULL
evidence_fragment_canonical_version INTEGER NOT NULL CHECK (evidence_fragment_canonical_version = 1)
evidence_fragment_canonical_hash TEXT NOT NULL CHECK (evidence_fragment_canonical_hash ~ '^[0-9a-f]{64}$')
assessment_result JSONB NOT NULL
method_provenance JSONB NOT NULL
relation TEXT GENERATED ALWAYS AS (assessment_result ->> 'relation') STORED
method_type TEXT GENERATED ALWAYS AS (method_provenance ->> 'methodType') STORED
assessed_at TIMESTAMPTZ NOT NULL
```

The canonical Assessment object contains exactly the Contract fields, including
`assessmentResult { relation, rationale }` and the embedded tagged
`methodProvenance`. `assessment_result` and `method_provenance` are parsed
JSONB projections for SQL validation; the canonical text is authoritative.
The writer and reader require exact key sets, exact closed relation values,
exact method variant keys, omission of not-applicable fields, and parity
between every projection and the canonical object. `structuredOutputHash` has
only one authority location: the embedded method provenance.

`toolParticipation` is stored only inside the existing
`method_provenance` JSONB projection and its canonical object. It is not a
separate relational column, table, foreign key, or ToolExecution authority;
the existing canonical text plus methodProvenance projection is sufficient
for database admission and historical verification. Therefore
`NEW_COLUMN_REQUIRED = NO`, `NEW_TABLE_REQUIRED = NO`, and
`NEW_FK_REQUIRED = NO`.

`assessed_at` is serialized to the Contract's canonical UTC timestamp form
before canonical construction. It is provenance, not a truth time or cutoff.
No uniqueness rule prevents multiple immutable Assessments for one Match.

### 2.4 SemanticAnalysisEnvelope

Table: `public.rcv022_semantic_analysis_envelopes`.

Primary key: `envelope_id UUID`.

Columns:

```text
envelope_id UUID NOT NULL PRIMARY KEY
canonical_version INTEGER NOT NULL CHECK (canonical_version = 1)
canonical TEXT NOT NULL
canonical_hash TEXT NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$')
claim_id UUID NOT NULL
claim_canonical_version INTEGER NOT NULL CHECK (claim_canonical_version = 1)
claim_canonical_hash TEXT NOT NULL CHECK (claim_canonical_hash ~ '^[0-9a-f]{64}$')
claim_version_id UUID NOT NULL
claim_version_canonical_version INTEGER NOT NULL CHECK (claim_version_canonical_version = 1)
claim_version_canonical_hash TEXT NOT NULL CHECK (claim_version_canonical_hash ~ '^[0-9a-f]{64}$')
analysis_cutoff_at TIMESTAMPTZ NOT NULL
analysis_at TIMESTAMPTZ NOT NULL
match_refs JSONB NOT NULL
assessment_refs JSONB NOT NULL
analysis_method_identity TEXT NOT NULL
analysis_method_version TEXT NOT NULL
analysis_method_hash TEXT NOT NULL CHECK (analysis_method_hash ~ '^[0-9a-f]{64}$')
```

`match_refs` and `assessment_refs` are exact ordered arrays of
`{ id, canonicalVersion, canonicalHash }`. They are stored in canonical form
and repeated as support rows described below. A zero-length `match_refs` array
requires a zero-length `assessment_refs` array. Ordering affects canonical
identity only; it is not a ranking or evidentiary weight.

`analysis_method_*` authenticates only Envelope assembly, member selection,
ordering, or contextualization. It cannot authenticate, replace, rewrite, or
reinterpret any Assessment's method provenance or relation.

### 2.5 Membership support tables

`public.rcv022_envelope_match_refs`:

```text
envelope_id UUID NOT NULL
ordinal INTEGER NOT NULL CHECK (ordinal >= 0)
match_id UUID NOT NULL
match_canonical_version INTEGER NOT NULL CHECK (match_canonical_version = 1)
match_canonical_hash TEXT NOT NULL CHECK (match_canonical_hash ~ '^[0-9a-f]{64}$')
PRIMARY KEY (envelope_id, ordinal)
UNIQUE (envelope_id, match_id)
```

`public.rcv022_envelope_assessment_refs`:

```text
envelope_id UUID NOT NULL
ordinal INTEGER NOT NULL CHECK (ordinal >= 0)
assessment_id UUID NOT NULL
assessment_canonical_version INTEGER NOT NULL CHECK (assessment_canonical_version = 1)
assessment_canonical_hash TEXT NOT NULL CHECK (assessment_canonical_hash ~ '^[0-9a-f]{64}$')
PRIMARY KEY (envelope_id, ordinal)
UNIQUE (envelope_id, assessment_id)
```

These constraints enforce unique identities and preserve array order without
creating semantic authority. The support rows contain only the referenced
identity, its canonical version/hash, and the Envelope ordinal; they contain
no canonical text, independent identity, independent semantic hash, or
relation. The
deferred database validator requires contiguous ordinals starting at zero and
compares rows ordered by ordinal with the canonical JSON arrays. Duplicate
IDs, gaps, row-array divergence, or a non-empty assessment projection for an
empty Match array abort COMMIT. The reader repeats the comparison and fails
closed if a controlled corruption fixture bypasses production admission.

## 3. Dependency graph and foreign keys

All foreign keys use `ON DELETE NO ACTION ON UPDATE NO ACTION`. No RCV-022
foreign key cascades, repairs, or current-state substitutions.

The semantic graph is:

```text
rcv022_evidence_fragments
  -> rcv020_captures

rcv022_claim_evidence_matches
  -> claim_identity_authorities
  -> claim_version_authorities
  -> rcv022_evidence_fragments

rcv022_evidence_assessments
  -> rcv022_claim_evidence_matches
  -> claim_identity_authorities
  -> claim_version_authorities
  -> rcv022_evidence_fragments

rcv022_semantic_analysis_envelopes
  -> claim_identity_authorities
  -> claim_version_authorities

envelope_match_refs
  -> semantic_analysis_envelopes
  -> claim_evidence_matches

envelope_assessment_refs
  -> semantic_analysis_envelopes
  -> evidence_assessments
```

The Claim Historical Authority foreign keys authenticate identity existence;
writer and reader parity checks authenticate the referenced canonical version
and hash. The RCV-020 Capture foreign key similarly authenticates existence of
the Capture row while the writer/reader validates its immutable canonical and
representation hashes. Optional ObservationOccurrence, AuthenticatedHandoff,
RCV-019, and RCV-021 context have no core RCV-022 foreign key or column.

No FK is added from core RCV-022 to an RCV-021 Result, Selection, or Handoff.
Selected-result to Capture lineage remains separately gated.

The migration creates dependency indexes for every non-PK foreign-key column:
`idx_rcv022_fragments_capture`, `idx_rcv022_matches_claim_version`,
`idx_rcv022_matches_fragment`, `idx_rcv022_assessments_match`,
`idx_rcv022_assessments_claim_version`, `idx_rcv022_assessments_fragment`,
`idx_rcv022_envelopes_claim_version`, and the support-table primary/unique
indexes. Indexes are lookup aids only and carry no semantic authority.

The migration uses these named foreign keys, all with NO ACTION on update and
delete:

```text
fk_rcv022_fragment_capture
  evidence_fragments(capture_id) -> rcv020_captures(capture_id)
fk_rcv022_match_claim
  claim_evidence_matches(claim_id) -> claim_identity_authorities(claim_id)
fk_rcv022_match_claim_version
  claim_evidence_matches(claim_version_id) -> claim_version_authorities(claim_version_id)
fk_rcv022_match_fragment
  claim_evidence_matches(evidence_fragment_id) -> evidence_fragments(fragment_id)
fk_rcv022_assessment_match
  evidence_assessments(claim_evidence_match_id) -> claim_evidence_matches(match_id)
fk_rcv022_assessment_claim
  evidence_assessments(claim_id) -> claim_identity_authorities(claim_id)
fk_rcv022_assessment_claim_version
  evidence_assessments(claim_version_id) -> claim_version_authorities(claim_version_id)
fk_rcv022_assessment_fragment
  evidence_assessments(evidence_fragment_id) -> evidence_fragments(fragment_id)
fk_rcv022_envelope_claim
  semantic_analysis_envelopes(claim_id) -> claim_identity_authorities(claim_id)
fk_rcv022_envelope_claim_version
  semantic_analysis_envelopes(claim_version_id) -> claim_version_authorities(claim_version_id)
fk_rcv022_match_ref_envelope
  envelope_match_refs(envelope_id) -> semantic_analysis_envelopes(envelope_id)
fk_rcv022_match_ref_match
  envelope_match_refs(match_id) -> claim_evidence_matches(match_id)
fk_rcv022_assessment_ref_envelope
  envelope_assessment_refs(envelope_id) -> semantic_analysis_envelopes(envelope_id)
fk_rcv022_assessment_ref_assessment
  envelope_assessment_refs(assessment_id) -> evidence_assessments(assessment_id)
```

The physical plan therefore has four semantic tables, two support tables, and
fourteen foreign keys. The two optional non-canonical context FKs are
intentionally absent from the core model; they would create hashless context
that is not part of the frozen Fragment authority. Primary keys are the
assigned identities listed above.
The only additional uniqueness constraints are `(envelope_id, match_id)` and
`(envelope_id, assessment_id)` on the two support tables, plus
`(envelope_id, ordinal)` as each support-table primary key. No payload or hash
uniqueness is introduced.

### 3.1 RCV-020 Capture adapter

`src/services/rcv022Rcv020CaptureAdapter.ts` is a read/write boundary adapter,
not a new authority. It selects the immutable Capture row and validates its
persisted `canonical` against the frozen `canonicalizeRcv020Capture` helper,
then verifies `capture_hash` and `content_hash` as lowercase SHA-256 values.
The Fragment writer records the resulting `capture_canonical_version`,
`capture_canonical_hash`, and `capture_representation_hash`; the reader repeats
the same parity checks without consulting current source metadata. If a bound
ObservationOccurrence, Handoff, RCV-019, or RCV-021 context is used by a
caller, the exact semantic input consumed by that method is committed in the
applicable ordered `matcherInputCanonicalHashes` or
`methodProvenance.inputCanonicalHashes` array. These arrays authenticate only
the immutable input-hash commitments; they do not encode upstream type,
identity, table/entity, or a globally resolvable typed historical reference.
The core RCV-022 verifier validates the array structure, canonical parity, and
hash immutability, but does not resolve, search for, or claim typed RCV-019 or
RCV-021 lineage from a hash alone. A caller may separately supply typed
upstream authority plus canonical bytes for an external hash-equality
comparison; that comparison does not add typed lineage to persisted RCV-022
authority. Core Fragments do not persist or require any such optional binding.

## 4. Constraint and immutability plan

The migration adds checks for canonical version `1`, lowercase 64-character
SHA-256 hashes, non-null canonical text, and the closed top-level kind/relation
values that can be safely enforced in SQL. PostgreSQL does not reimplement
RFC 8785/JCS, but it does enforce admission parity so a canonical row cannot
be committed with disagreeing duplicated projections.

Additional SQL checks are exact non-authoritative projections: Fragment
`capture_canonical_version = 'RCV020-CANONICAL-V1'`; dependency hash columns
match the lowercase-hex shape; `fragment_kind` is one of the three Contract
kinds; Assessment has generated `relation` and `method_type` projections from
its JSONB objects with checks for the four relations and four method types;
`assessed_at`, `analysis_at`, and `analysis_cutoff_at` are microsecond-precise
UTC timestamps; and support ordinals are non-negative. A generated projection
is never accepted without canonical-text parity.

Four `BEFORE INSERT` triggers, one on each semantic authority table, call the
single dispatch function `rcv022_validate_authority_projection()`. The
function first parses `NEW.canonical` as JSONB; parse failure rejects the
insert before any projection is read. For every required Contract key it then
requires explicit key existence (conceptually `canonical_jsonb ? 'k'`) and,
unless the Contract explicitly permits JSON null for that field, rejects
`canonical_jsonb -> 'k' = 'null'::jsonb`. Missing keys and JSON null are never
treated as the same value. Every required duplicated SQL column or JSONB
projection must be non-NULL. Scalar extraction validates the JSON type/domain
before conversion and compares with NULL-safe `IS DISTINCT FROM` semantics;
object/array projections use the equivalent
`NEW.projection IS NOT NULL AND (canonical_jsonb -> 'field') IS NOT DISTINCT
FROM NEW.projection` predicate. No SQL UNKNOWN result can admit a row.

For each embedded Contract object (`locator`, `contentBinding`,
`extractionAuthority`, `assessmentResult`, `methodProvenance`, `matchRefs`,
`assessmentRefs`), the validator checks the exact variant key set: missing or
extra keys, forbidden JSON null, wrong variant keys, and present
NOT_APPLICABLE keys are rejected. Conditional fields are exact:
`toolParticipation` is mandatory in `MODEL_ASSISTED` and `MIXED`, is a JSON
string, and is exactly `USED` or `NOT_USED`; null, omission, aliases, boolean
values, `UNKNOWN`, and `UNSPECIFIED` are invalid. It is the persisted
determinant, not a value inferred from `toolContextHash`, model configuration,
provider state, method or process hashes, output hashes, or input hashes. When
it is `USED`, `toolContextHash` must be present, non-null, and a valid
lowercase SHA-256 hash. When it is `NOT_USED`, `toolContextHash` must be
absent; JSON null, empty strings, and placeholder hashes are invalid.
`acceptanceStatus` is present only for MIXED; non-MIXED variants must omit it.
`samplingParameters` uses the Contract's ordered entries shape and its hash is
the SHA-256 of its exact JCS UTF-8 bytes. The Envelope `matchRefs` and
`assessmentRefs` keys must exist and be JSON arrays; `[]` is valid, while a
missing key, JSON null, or SQL-NULL projection is invalid. An empty array is
never inferred from a missing or null value.

Finally the validator requires
`NEW.canonical_hash = public.rcv016_sha256_text(NEW.canonical)` over the exact
persisted canonical text bytes. The admission check does not reimplement RFC
8785/JCS ordering; the writer and historical reader still perform exact
schema/JCS verification. Malformed canonical JSON, a missing required key,
forbidden JSON null, SQL-NULL projection, wrong JSON type/domain, exact-object
shape mismatch, projection mismatch, or hash mismatch raises an exception
before the row can be admitted. The four triggers are:

```text
trg_rcv022_validate_fragment_insert_projection
trg_rcv022_validate_match_insert_projection
trg_rcv022_validate_assessment_insert_projection
trg_rcv022_validate_envelope_insert_projection
```

The Fragment trigger compares `locator`, `content_binding`, and
`extraction_authority`; the Assessment trigger compares `assessment_result`
and `method_provenance`; the Envelope trigger compares `match_refs` and
`assessment_refs`; all four also compare every duplicated identity,
dependency, method, and timestamp column.

Membership parity is a database invariant, not merely a writer or verifier
check. One `rcv022_validate_envelope_membership_commit()` function is attached
as `AFTER INSERT DEFERRABLE INITIALLY DEFERRED` constraint triggers to the
Envelope table and both support tables:

```text
trg_rcv022_validate_envelope_membership_on_envelope
trg_rcv022_validate_envelope_membership_on_match_ref
trg_rcv022_validate_envelope_membership_on_assessment_ref
```

At commit, using the final transaction-visible state, the function validates
both arrays exactly: equal count; contiguous ordinals `0..N-1`; equal order;
equal identity; equal canonical version; equal canonical hash; and no
duplicates, missing rows, or extra rows. It additionally requires every
Assessment member's authenticated `claim_evidence_match_id` to correspond to
exactly one Match support row in the same Envelope. An empty canonical array
must have zero support rows. Intermediate incomplete states are permitted
inside the caller-owned transaction, but any final mismatch aborts COMMIT.
The deferred triggers run for direct SQL inserts as well as writer inserts,
so bypassing the application writer cannot commit an incomplete projection.

One reusable `rcv022_guard_immutable()` function is installed. It is attached
to all four authority tables and both membership support tables with
`BEFORE UPDATE OR DELETE` triggers. Every attempted mutation fails with
SQLSTATE `55000`; no semantic or projection row can be repaired in place.

The trigger set is exactly six immutable triggers:

```text
trg_rcv022_immutable_evidence_fragments
trg_rcv022_immutable_claim_evidence_matches
trg_rcv022_immutable_evidence_assessments
trg_rcv022_immutable_semantic_analysis_envelopes
trg_rcv022_immutable_envelope_match_refs
trg_rcv022_immutable_envelope_assessment_refs
```

The six immutable triggers reject every UPDATE or DELETE. The admission and
deferred validation triggers above do not provide a repair path; after a
successful commit, neither an Envelope nor its support projections can drift.

No new trigger is installed on RCV-020 or Claim Historical Authority tables.
Those upstream migrations already protect their immutable rows. Existing
conditional Claim/ClaimVersion protection and RCV-020 Capture protection are
the dependency boundary; RCV-022 does not over-protect unrelated mutable
administrative source columns.

The writer role receives SELECT and INSERT on the six new tables and no
UPDATE/DELETE/TRUNCATE privilege. The historical reader role receives USAGE
on schema `public` and SELECT on the four authority tables, two support tables,
and the required upstream authority tables; it receives no INSERT, UPDATE,
DELETE, TRUNCATE, CREATE TEMP, DDL, sequence, trigger, or locking privilege.
Existing deployment role names are reused; the migration does not invent a
new semantic or application role.

## 5. Canonical module and embedded validation

The future canonical module is `src/services/rcv022Canonical.ts`. It imports
only `canonicalizeAndHash` from `src/services/canonicalJson.ts` and contains
pure builders with no database reads:

```text
buildEvidenceFragmentCanonical(input)
buildClaimEvidenceMatchCanonical(input)
buildEvidenceAssessmentCanonical(input)
buildSemanticAnalysisEnvelopeCanonical(input)
canonicalizeSamplingParameters(input)
validateLocatorAndContentBinding(input)
validateMethodProvenance(input)
```

Each builder constructs exactly the Contract field set and then canonicalizes
the object. All strings are passed exactly as persisted. No trimming, case
folding, Unicode rewriting, parser normalization, model lookup, or current
metadata lookup occurs.

The module validates:

- `locator` variants and zero-based structured indexes;
- image dimensions and half-open bounds;
- TEXT/STRUCTURED/IMAGE_REGION compatibility;
- DIRECT/DERIVED extraction authority;
- exact `assessmentResult` relation/rationale;
- all four exact method provenance variants, including sampling parameter
  entries, review/acceptance status, the authenticated
  `toolParticipation`/`toolContextHash` conditional, and omitted
  not-applicable keys;
- ordered unique Envelope references and zero-member rules.

Canonical hash means SHA-256 of the exact canonical string's UTF-8 bytes,
lowercase hexadecimal. The database never recomputes JCS.

The Design preserves these exact top-level field sets and order:

```text
EvidenceFragment:
  schema canonicalVersion fragmentId captureId captureCanonicalVersion
  captureCanonicalHash captureRepresentationHash fragmentKind locator
  contentBinding extractionAuthority

ClaimEvidenceMatch:
  schema canonicalVersion matchId claimId claimCanonicalVersion
  claimCanonicalHash claimVersionId claimVersionCanonicalVersion
  claimVersionCanonicalHash evidenceFragmentId evidenceFragmentCanonicalVersion
  evidenceFragmentCanonicalHash matcherIdentity matcherVersion matcherHash
  matcherInputCanonicalHashes

EvidenceAssessment:
  schema canonicalVersion assessmentId claimEvidenceMatchId
  claimEvidenceMatchCanonicalVersion claimEvidenceMatchCanonicalHash claimId
  claimCanonicalVersion claimCanonicalHash claimVersionId
  claimVersionCanonicalVersion claimVersionCanonicalHash evidenceFragmentId
  evidenceFragmentCanonicalVersion evidenceFragmentCanonicalHash
  assessmentResult methodProvenance assessedAt

SemanticAnalysisEnvelope:
  schema canonicalVersion envelopeId claimId claimCanonicalVersion
  claimCanonicalHash claimVersionId claimVersionCanonicalVersion
  claimVersionCanonicalHash analysisCutoffAt analysisAt matchRefs
  assessmentRefs analysisMethodIdentity analysisMethodVersion analysisMethodHash
```

Embedded object shapes are also frozen in the implementation validator:

```text
locator: WHOLE_TEXT | UTF8_BYTE_RANGE | STRUCTURED_PATH | IMAGE_REGION
contentBinding: TEXT | STRUCTURED | IMAGE_REGION
extractionAuthority: DIRECT | DERIVED
assessmentResult: { relation, rationale }
matchRefs/assessmentRefs item: { id, canonicalVersion, canonicalHash }
methodProvenance variants:
  DETERMINISTIC = methodType methodIdentity methodVersion methodHash
    inputCanonicalHashes structuredOutputHash reviewStatus
  MODEL_ASSISTED = methodType methodIdentity methodVersion methodHash
    providerIdentity modelIdentity modelVersion processIdentity processVersion
    processHash promptTemplateHash systemInstructionHash samplingParameters
    samplingParametersHash inputCanonicalHashes rawOutputHash
    structuredOutputHash retryIdentity reviewStatus toolParticipation
    [toolContextHash]
  HUMAN = methodType methodIdentity methodVersion methodHash reviewerIdentity
    reviewProcessIdentity reviewProcessVersion reviewProcessHash
    inputCanonicalHashes structuredOutputHash reviewStatus
  MIXED = methodType methodIdentity methodVersion methodHash providerIdentity
    modelIdentity modelVersion processIdentity processVersion processHash
    promptTemplateHash systemInstructionHash samplingParameters
    samplingParametersHash inputCanonicalHashes rawOutputHash
    structuredOutputHash retryIdentity reviewerIdentity reviewProcessIdentity
    reviewProcessVersion reviewProcessHash reviewStatus acceptanceStatus
    toolParticipation
    [toolContextHash]
samplingParameters: { schema, canonicalVersion, entries: [{ name, value }] }
```

The canonical builder requires `toolParticipation` in MODEL_ASSISTED and
MIXED input. It emits `toolParticipation: "USED"` together with
`toolContextHash` only when the immutable input declares `USED`; it emits
`toolParticipation: "NOT_USED"` and omits `toolContextHash` entirely when the
declaration is `NOT_USED`. It never emits JSON null or a placeholder. The
field is inside `methodProvenance`, so changing it changes the canonical
EvidenceAssessment bytes and hash. The builder validates the exact enum and
conditional hash domain without consulting runtime or provider state.

No SQL column, generated projection, JSONB key, or support row adds a
canonical semantic field. Any duplicated dependency column is checked against
the canonical object and is never independently authoritative.

### 5.1 Timestamp storage and lossless runtime boundary

`assessed_at`, `analysis_at`, and `analysis_cutoff_at` are PostgreSQL
`TIMESTAMPTZ(6)` columns. They represent absolute instants only; no local-time
interpretation is permitted. Their canonical value is exactly the UTC string
shape `YYYY-MM-DDTHH:mm:ss.ffffffZ`: UTC only, literal trailing `Z`, exactly
six fractional-second digits, and no omitted, shorter, longer, offset, or
locale-dependent form. The exact string is inserted into the canonical object.

The existing repository read convention is reused at the database boundary:
each relevant value is selected as exact text using
`to_char(column AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
The service validates the canonical string's calendar and microsecond syntax,
binds that string explicitly as `TIMESTAMPTZ`, and immediately serializes the
persisted value with the same UTC formatter. Canonical string -> PostgreSQL
`TIMESTAMPTZ(6)` -> canonical string must compare byte-for-byte equal; any
mismatch rejects admission or verification. PostgreSQL's microsecond precision
is authoritative: no millisecond rounding, truncation, timezone conversion,
or normalization repair is permitted.

The PostgreSQL driver must not return these columns through its default
JavaScript `Date` parser. The reader requests the formatted text above and
passes it through the frozen canonical timestamp validator. JavaScript `Date`
is not a semantic conversion authority, and JavaScript `Number` must not carry
epoch microseconds or any timestamp integer beyond IEEE-754 exactness. If
timestamp arithmetic is ever required, it uses exact components or `BigInt`;
no arithmetic is needed for the core path.

The historical verifier applies the identical text round-trip rule to all
three fields and fails closed on persisted/canonical mismatch. It does not use
current locale, process timezone, `Date` serialization, or lossy numeric
conversion.

The accepted timestamp domain is the intersection of PostgreSQL's finite
`TIMESTAMPTZ(6)` instants, non-BC instants, and values that serialize and parse
byte-exactly in the frozen four-digit canonical form. `infinity` and
`-infinity` are explicitly invalid; they are never sentinel dates, open-ended
times, or alternate serialized values. BC-era values are explicitly invalid
because the canonical form has no era designator. A UTC year is valid only when
it is representable by exactly four decimal digits (`0000` through `9999`,
subject to the actual PostgreSQL/ISO calendar intersection); no synthetic year
zero, signed year, or five-digit year is introduced.

The decisive admission and verification condition is therefore all of the
following: PostgreSQL accepts a finite value; it is not BC or either infinity
token; the UTC formatter emits exactly `YYYY-MM-DDTHH:mm:ss.ffffffZ`; parsing
that string back to `TIMESTAMPTZ(6)` yields the same instant; and formatting
the round-tripped value again yields identical canonical bytes. Any failure
rejects admission or fails historical verification closed. PostgreSQL's wider
timestamp domain cannot create an RCV-022 authority outside this intersection.

## 6. Image creation-time validation boundary

The repository has no proven image decoder or Capture-representation dimension
provider. The Design therefore requires an explicit writer dependency,
`CaptureRepresentationInspector`, for `IMAGE_REGION` creation:

```text
inspect(captureId, captureRepresentationHash)
  -> { representationHash, imageWidth, imageHeight }
```

The returned `representationHash` must equal the authenticated Capture
representation hash, and the returned dimensions must satisfy the Contract's
positive/bounds rules. If the inspector cannot access the exact representation
or cannot establish dimensions, the writer fails closed with
`UNSUPPORTED_SEMANTIC_INPUT`; it never consults current UI metadata, unrelated
image metadata, or an unverified derived image. The inspector's implementation
and any decoder identity are an implementation dependency, not a new semantic
authority entity.

For TEXT and STRUCTURED Fragments, no image inspector is needed. Historical
verification authenticates the persisted locator and its canonical/hash; it
does not require a current decoder or re-derive dimensions from source bytes.
This is deliberately an authentication guarantee, not a claim that hashing a
recorded dimension proves objective derivation from bytes.

## 7. Writer architecture

The future writer module is `src/services/rcv022Writer.ts`. Every public
primitive accepts a caller-owned `PoolClient` and performs no transaction
control. It never imports or calls a Reader as an authority shortcut.

Minimal primitives:

```text
persistEvidenceFragmentWithinTransaction(client, input, inspector?)
persistClaimEvidenceMatchWithinTransaction(client, input)
persistEvidenceAssessmentWithinTransaction(client, input)
persistSemanticAnalysisEnvelopeWithinTransaction(client, input)
```

Each primitive:

1. authenticates all upstream dependency IDs and canonical/hash bindings;
2. reads immutable persisted dependency authority within the caller's
   transaction;
3. constructs the exact canonical object with the pure module;
4. inserts the authority row and, for an Envelope, its support projections;
   database admission triggers validate canonical/projection parity and
   deferred constraint triggers validate final membership parity;
5. on an existing assigned identity, compares every source, dependency,
   canonical, and projection byte exactly;
6. returns the authenticated binding or fails closed.

The EvidenceAssessment writer receives the already-decided immutable
`toolParticipation` value in its provenance input. It validates the exact
`USED`/`NOT_USED` enum and applies the corresponding `toolContextHash`
presence rule before constructing canonical bytes. It never infers tool use
from hash presence, model configuration, available tools, provider state,
method/process hashes, raw output, or input hashes, and it never silently
adds, removes, or normalizes either field.

There is no generic legacy-authentication operation. A missing Claim,
ClaimVersion, Capture, or upstream authority is a deterministic failure, not
an invitation to hash current values.

The smallest integrated caller-owned transaction is:

```text
authenticate Claim Historical Authority
authenticate RCV-020 Capture authority
persist EvidenceFragment
persist ClaimEvidenceMatch
persist EvidenceAssessment
persist SemanticAnalysisEnvelope and ordered support refs
COMMIT (owned by caller)
```

If the caller is also creating upstream Claim, ClaimVersion, or Capture rows,
those upstream transaction-neutral primitives may precede this sequence in the
same outer transaction. RCV-022 never duplicates their creation semantics.
The proof injects failure after upstream authentication, after Fragment
insertion, after Match insertion, after Assessment insertion, after Envelope
insertion, after Match support projections, after Assessment support
projections, and immediately before COMMIT. Every failure leaves the
transaction uncommitted; the caller rolls it back, so no partial RCV-022 row
or support projection survives.

## 8. Idempotency and concurrency

Assigned identity is the idempotency key:

- same assigned ID plus byte-identical authority returns the existing
  authenticated row;
- same assigned ID plus any divergent dependency, canonical, projection, or
  hash fails with `DUPLICATE_CONFLICT`; changing `toolParticipation`, the
  presence of `toolContextHash`, or its value is likewise a divergent
  authority;
- distinct assigned IDs are never collapsed, even with identical payloads;
- a duplicate Match or Assessment reference within one Envelope fails before
  commit;
- a different Assessment may reference the same Match legitimately.

Inserts use PostgreSQL unique primary-key/unique-membership constraints and
`INSERT ... ON CONFLICT DO NOTHING` followed by exact parity comparison. No
last-write-wins update exists. Concurrent identical creation leaves one
persisted authoritative row and identical retry results; concurrent divergent
creation leaves the first committed authority and a deterministic divergence
failure for the other transaction. Concurrent Envelope Match membership
insertion is serialized by `UNIQUE (envelope_id, match_id)` and Assessment
membership insertion by `UNIQUE (envelope_id, assessment_id)`.

## 9. Historical reader and verifier

The future reader is `src/services/rcv022Reader.ts`. It may import only the
pure canonical module and frozen upstream read-verifier adapters. It must not
import or call `rcv022Writer.ts`, Claim services, current matchers, parsers,
models, or scheduler services.

The reader opens a repeatable-read `READ ONLY` transaction, performs SELECTs
against the four authority tables, two support tables, Claim Historical
Authority, and required RCV-020 authority, then commits/ends the read-only
transaction. It needs only `USAGE` and `SELECT` privileges. It never uses
`FOR UPDATE`, advisory locks, temporary tables, sequences, or any write.

Verification order is deterministic:

1. structural authority: required rows, supported versions, exact JSON/JSONB
   shapes, required zero-member and membership cardinality rules;
2. lineage, identity, canonical, and hash authority: upstream bindings,
   parent identities, FK membership, exact canonical reconstruction, and
   SHA-256 parity;
3. scope, temporal, and method authority: one ClaimVersion per Envelope,
   cutoff/analysis timestamps, tag compatibility, image bounds, method variant
   requirements, and optional input-hash commitment structure/parity. The core
   verifier does not resolve a typed RCV-019 or RCV-021 authority from a hash;
   any typed comparison is an external caller-supplied check only;
4. relation and contradiction projection: closed relation validity and the
   same-Envelope/same-ClaimVersion SUPPORTS plus REFUTES rule.

The reader collects failures and sorts by this precedence, then by failure
class path and UTF-8 byte order. Database row order can never select the
result. It returns immutable verified bindings and a deterministic contradiction
projection; it does not persist a ContradictionFinding.

For MODEL_ASSISTED and MIXED, the verifier reads `toolParticipation` from the
authenticated persisted canonical methodProvenance and applies the same
conditional rule: USED requires a present, non-null, valid lowercase
`toolContextHash`; NOT_USED requires the key to be absent. Presence of
`toolContextHash` never determines `toolParticipation`. The verifier proves
the immutable declaration, canonical/hash integrity, and declaration/hash
consistency, but does not independently attest external runtime truth beyond
authenticated persisted provenance. No current model, tool, provider, or
runtime state is consulted.

Before and after snapshots in every corruption test must be byte/structurally
equal. The verifier never inserts, updates, deletes, normalizes, regenerates,
or repairs any row.

## 10. Failure model

Design-level outcomes map directly to the Contract concepts:

```text
MISSING_AUTHORITY
UNSUPPORTED_VERSION
MALFORMED_DATA
IDENTITY_MISMATCH
LINEAGE_MISMATCH
CANONICAL_MISMATCH
HASH_MISMATCH
FRAGMENT_BOUNDARY_MISMATCH
CLAIM_SCOPE_MISMATCH
TEMPORAL_CONTEXT_MISMATCH
METHOD_AUTHORITY_MISMATCH
INVALID_RELATION
DUPLICATE_CONFLICT
CONTRADICTION_INPUT_MISMATCH
CURRENT_STATE_SUBSTITUTION
UNSUPPORTED_SEMANTIC_INPUT
REPAIR_ATTEMPT
```

The writer uses the same conceptual classes for rejected creation where
applicable; implementation error strings remain a later implementation choice.
The reader's deterministic precedence is structural, then lineage/identity/
canonical/hash, then scope/temporal/method, then relation/contradiction.

## 11. Contradiction projection

Contradiction is a read-time deterministic projection only. For one Envelope,
after every member and Assessment is authenticated, the reader reports a
contradiction exactly when the same authenticated ClaimVersion context contains
at least one `SUPPORTS` Assessment and one `REFUTES` Assessment. `INSUFFICIENT`
and `UNRELATED` do not create contradiction. There is no contradiction table,
cache, score, averaging, cross-Claim comparison, or truth verdict.

RCV-018 remains responsible for EvidenceAssertion validation, structured
comparison, cross-Claim comparability/incompatibility, and its own contradiction
authority.

## 12. Smallest complete vertical slice

The first physical slice uses a TEXT Fragment so it does not hide the
image-inspector dependency:

```text
fresh authenticated Claim and ClaimVersion
fresh authenticated RCV-020 Capture
EvidenceFragment with TEXT + WHOLE_TEXT
ClaimEvidenceMatch
one DETERMINISTIC EvidenceAssessment with SUPPORTS
SemanticAnalysisEnvelope with one ordered Match ref and one ordered Assessment ref
COMMIT in one caller-owned transaction
new process and new connection
restricted SELECT-only reader verification
one targeted persisted corruption
fail-closed verification with exact before/after equality proving no repair
```

This first successful path does not require REFUTES, INSUFFICIENT, UNRELATED,
contradiction projection, multiple Assessments, STRUCTURED or IMAGE_REGION
Fragments, MODEL_ASSISTED/HUMAN/MIXED methods, RCV-019, RCV-021, or any
RCV-022 ObservationOccurrence/Handoff binding. The upstream RCV-020 Capture
fixture still uses whatever RCV-020 parent rows its own authority requires.
Those RCV-022 proof expansions occur after the core slice passes.

The complete test matrix additionally covers STRUCTURED_PATH, IMAGE_REGION
with a test inspector, all four method provenance variants, zero-member
Envelopes, multiple Assessments for one Match, duplicate reference rejection,
concurrency, identical retry, divergent duplicate, and rollback after every
write stage.

The method-provenance structural matrix additionally proves, for both
MODEL_ASSISTED and MIXED, USED with a valid hash, USED with missing or JSON-null
hash, NOT_USED with absent hash, NOT_USED with present/null/placeholder hash,
missing/null/unsupported `toolParticipation`, and the valid MIXED
`acceptanceStatus` requirement. DETERMINISTIC and HUMAN fixtures containing
`toolParticipation` or `toolContextHash` are rejected as extra/not-applicable
keys. These are structural admission proofs only; no model or tool execution
is implemented in this Design.

## 13. Implementation waves

### Wave A — additive schema and guards

Create the four semantic tables, two support tables, exact FKs/checks/unique
constraints, dependency indexes, four INSERT admission-parity triggers, three
deferred membership-parity constraint triggers, and six immutable triggers.
Prove catalog shape, direct-SQL admission rejection, COMMIT-time parity, and
mutation rejection on fresh PostgreSQL. Do not alter any upstream migration or
source table.

The current Wave A migration candidate and its tests are
`IMPLEMENTATION_CANDIDATE_INVALIDATED_BY_CORRECTED_CONTRACT` and
`TEST_CANDIDATES_INVALIDATED_BY_CORRECTED_CONTRACT`, respectively, because
their pre-repair methodProvenance admission shape lacks mandatory
`toolParticipation`. They remain untouched in this Design correction. After
this Design is re-snapshot-locked, the future Wave A correction is limited to
the methodProvenance admission rule, corresponding structural fixtures, and
stale exact-shape assertions; unrelated physical proofs remain unchanged.

The explicit correction status is:

```text
CURRENT_WAVE_A_MIGRATION_STATUS = IMPLEMENTATION_CANDIDATE_INVALIDATED_BY_CORRECTED_CONTRACT
CURRENT_WAVE_A_TEST_STATUS = TEST_CANDIDATES_INVALIDATED_BY_CORRECTED_CONTRACT
FUTURE_WAVE_A_CORRECTION_SCOPE = methodProvenance admission, structural fixtures, and stale exact-shape assertions only
READY_FOR_RCV022_DESIGN_RESNAPSHOT = NO
READY_FOR_RCV022_WAVE_A_CORRECTION = NO
READY_FOR_RCV022_WAVE_A = NO
READY_FOR_RCV022_WAVE_B = NO
```

### Wave B — canonical core and transaction-neutral writers

Implement pure canonical builders and nested validators, then the four writer
primitives and the integrated caller-owned transaction path. Prove canonical/
hash parity, database admission parity, source/dependency parity, atomic
rollback, idempotency, divergent duplicate failure, and concurrency.

### Wave C — independent historical reader

Implement the SELECT-only reader/verifier, deterministic failure collection and
precedence, upstream authority adapters, zero-member semantics, tag/method
validation, and read-time contradiction projection. Prove writer independence,
restart independence, current-state independence, and no repair.

### Wave D — final integrated proof

Phase 1 uses the minimal TEXT + WHOLE_TEXT, SUPPORTS, DETERMINISTIC slice
above on a fresh disposable PostgreSQL 16.x UTF8 database, then performs
restart, restricted SELECT-only verification, one controlled corruption, and
the separate Test Review. Subsequent Wave-D proof expands incrementally to
the remaining relations, method variants, zero-member Envelopes, structured
paths, image regions, duplicate/member parity, contradiction projection,
optional hash-bound context, retry/divergence/concurrency, and the complete
corruption matrix. The RCV-021-to-RCV-020 selected-result lineage feature is
not part of these core waves and remains separately gated on real PostgreSQL
proof.

## 14. Physical proof and Test Review plan

Every wave uses the repository sequence:

```text
implementation -> fresh PostgreSQL Messbeweis -> separate Test Review
-> snapshot lock -> next wave
```

The eventual proof must include:

- full migration replay and exact six-table support/authority inventory;
- exact PK, FK target/action, CHECK, UNIQUE, index, and trigger catalog proof;
- canonical and hash parity for every top-level entity and embedded variant;
- Claim Historical Authority and Capture dependency authentication, plus
  optional RCV-019/RCV-021 input-hash commitment structure/parity (without
  typed upstream-lineage resolution);
- all four relation values and all four method provenance variants;
- MODEL_ASSISTED and MIXED `toolParticipation`/`toolContextHash` conditional
  matrix, plus rejection of tool fields in DETERMINISTIC and HUMAN;
- TEXT, STRUCTURED, and IMAGE_REGION tag compatibility, zero-based paths,
  image dimensions/bounds, and invalid-tag rejection;
- zero Matches, zero Assessments, and zero-Match-implies-zero-Assessment;
- ordered unique member arrays, duplicate rejection, same-Match multiple
  Assessments, and SUPPORTS-plus-REFUTES contradiction projection;
- transaction rollback after each authority/member insertion;
- identical retry, divergent duplicate, and concurrent identical/divergent
  creation;
- malformed canonical, wrong key, wrong version, wrong hash, dependency
  mismatch, relation/method corruption, parent mismatch, and multi-corruption
  deterministic precedence;
- SELECT-only role verification with no INSERT/UPDATE/DELETE/DDL/locks/temp
  privileges;
- restart/new-process verification and static reader import/write audits;
- exact before/after persisted-state equality for every verifier failure;
- unchanged Contract and all upstream authority hashes and regression suites.

The separate Test Review must mark each measured claim YES only when real
PostgreSQL persisted state was read back, an adversarial case was exercised,
and the result proves the claimed semantic boundary. A physical PASS alone is
not snapshot-lock authority.

The physical parity proof includes direct SQL, not only writer calls. The
admission cases explicitly cover malformed JSON and SQL/JSON null distinctions:

```text
required canonical key missing -> INSERT rejected
required canonical key = JSON null -> INSERT rejected
duplicated SQL projection = NULL -> INSERT rejected
embedded canonical object missing required key -> INSERT rejected
embedded canonical object with extra key -> INSERT rejected
NOT_APPLICABLE key present with JSON null -> INSERT rejected
structurally different projection -> INSERT rejected
matchRefs key missing -> INSERT rejected
matchRefs = JSON null -> INSERT rejected
matchRefs = [] with SQL-NULL projection -> INSERT rejected
equivalent assessmentRefs missing/null/SQL-NULL cases -> INSERT rejected
malformed canonical JSON -> INSERT rejected
object expected but string supplied (for example locator = "not-an-object") -> INSERT rejected
object expected but array supplied -> INSERT rejected
array expected but object supplied (for example matchRefs = {}) -> INSERT rejected
array expected but scalar supplied -> INSERT rejected
string expected but number supplied -> INSERT rejected
integer expected but string supplied (for example INDEX.index = "0") -> INSERT rejected
boolean/number/string scalar-domain mismatch -> INSERT rejected
methodProvenance expected object but scalar supplied -> INSERT rejected
assessmentResult expected object but array supplied -> INSERT rejected
samplingParameters.entries expected array but object supplied -> INSERT rejected
canonicalVersion/integer-domain field supplied with wrong JSON type -> INSERT rejected
correct canonical/projection row -> INSERT succeeds and persisted readback matches
canonical/projection mismatch on each semantic table -> INSERT rejected
Envelope canonical Match member with missing support row -> COMMIT rejected
extra support Match row -> COMMIT rejected
wrong support ordinal/order -> COMMIT rejected
wrong support canonical version/hash -> COMMIT rejected
equivalent Assessment membership mismatches -> COMMIT rejected
empty canonical arrays with zero support rows -> COMMIT succeeds
support row added to an empty canonical array -> COMMIT rejected
Assessment whose Match is absent from the same Envelope -> COMMIT rejected
```

The same physical admission proof includes the corrected method-provenance
matrix: MODEL_ASSISTED and MIXED with USED plus a valid hash succeed; USED with
missing, null, or invalid hash fails; NOT_USED with no toolContextHash
succeeds; NOT_USED with a present, null, empty, or placeholder hash fails;
missing, null, or unsupported `toolParticipation` fails; MIXED requires its
valid `acceptanceStatus`; and DETERMINISTIC/HUMAN reject either tool field as
not applicable. Each case uses otherwise-valid canonical/projection values so
the intended method-authority invariant, rather than an unrelated FK or hash
failure, is the rejection path.

The deferred constraint triggers inspect the final transaction-visible state,
so these checks cover staged intermediate states and direct-SQL bypasses.

Wrong JSON type is classified as `MALFORMED_DATA` or
`UNSUPPORTED_SEMANTIC_INPUT` according to the existing deterministic failure
classification and precedence. Database admission rejects it, and historical
verification of a deliberately corrupted persisted row fails closed without
repair.

The optional-input proof separately verifies that ordered
`matcherInputCanonicalHashes` and `methodProvenance.inputCanonicalHashes`
persist exactly, that canonical/hash parity authenticates those commitments,
that changing an input hash changes the authority, and that a divergent retry
with a changed input hash fails closed. Historical verification is run with no
current RCV-019/RCV-021 lookup. Core proof does not require typed upstream
resolution; if a future caller supplies typed upstream authority plus canonical
bytes, the test may demonstrate hash equality as an external comparison only,
never as persisted RCV-022 lineage.

The timestamp proof uses persisted PostgreSQL state, not formatting-only unit
tests. It covers all three fields (`assessed_at`, `analysis_at`, and
`analysis_cutoff_at`):

```text
exact six-digit microsecond round-trip -> succeeds
non-zero microseconds survive write/read unchanged -> PASS
canonical UTC value remains identical after process restart -> PASS
changing server/process local timezone does not change verification -> PASS
semantic timestamp path contains no JavaScript Date -> PASS
epoch-microsecond arithmetic, if introduced, uses no Number -> PASS
millisecond-truncated representation -> rejected or parity failure
altered microsecond digit -> authority/parity failure
infinity -> rejected at RCV-022 admission
-infinity -> rejected at RCV-022 admission
BC timestamp accepted by PostgreSQL syntax/storage -> RCV-022 admission rejected
PostgreSQL-accepted year outside the four-digit canonical domain -> rejected
canonical upper-bound representative, if PostgreSQL supports it -> round-trip succeeds
canonical lower-bound valid AD representative -> round-trip succeeds
direct SQL out-of-domain timestamp bypass attempt -> database invariant rejects
database readback reproduces exact canonical microsecond value -> PASS
```

## 15. Optional upstream context

RCV-019 and RCV-021 have no physical RCV-022 column, table, or foreign key in
the core six-table model. Core RCV-022 requires neither authority. The ordered
`matcherInputCanonicalHashes` and
`methodProvenance.inputCanonicalHashes` arrays are immutable cryptographic
commitments to the exact semantic input consumed by a Match or Assessment.
They do not encode upstream type, identity, table/entity name, RCV-019
timeline/point identity, RCV-021 Operation/Run/ProviderResult/ResultSelection
identity, or a globally resolvable typed historical reference. Accordingly,
RCV-022 v1 does not claim typed RCV-019 or RCV-021 lineage from a hash alone.

If RCV-019-derived information materially affects matching, its exact consumed
input hash is included in `matcherInputCanonicalHashes`; if it materially
affects an Assessment relation or rationale, the exact consumed input hash is
included in `methodProvenance.inputCanonicalHashes`. The same rule applies to
RCV-021-derived information. The core verifier validates array structure,
canonical parity, and immutable hash commitments, but never searches a hash
space, consults current RCV-019/RCV-021 rows, infers a type, or uses an
unstated registry/side channel to reconstruct upstream lineage. A caller may
separately supply typed upstream authority plus canonical bytes and compare
their hash with a committed input hash; that external comparison does not add
typed lineage to persisted RCV-022 authority.

If optional context merely helped discover or select candidate material and is
not bound through those frozen input-hash arrays, it is invocation-only and
outside persisted RCV-022 authority. It cannot affect Envelope validity,
member meaning, relation, or contradiction. No current Operation/Run state or
Scheduler state is a semantic dependency. The exact selected-result to Capture
lineage feature remains separately gated and outside core RCV-022.

SourceTrust and SourceIndependence remain outside RCV-022 V1. Existing RCV-014
independence material is never treated as a hashed dependency.

## 16. Explicit non-goals

This Design does not design Claim aggregation, support scores, truth verdicts,
public confidence, source ranking, source trust, source independence,
competing-Claim ranking, final editorial acceptance, final explanation
synthesis, a new RCV-018 authority, or the exact RCV-021 selected-result to
RCV-020 Capture lineage.

## 17. Internal design consistency audit

The Design was re-read against the corrected Contract and repository authority
boundaries. The following values are the required internal audit result before
independent Design audit:

```text
DESIGN_MISSING = 0
DESIGN_WEAKENED = 0
DESIGN_EXPANDED_BEYOND_REPAIR = 0
DESIGN_CONTRADICTORY = 0
DESIGN_AMBIGUOUS = 0
SEMANTIC_INVENTION = 0
AUTHORITY_LEAKAGE = 0
CURRENT_STATE_SUBSTITUTION_RISK = 0
SEMANTIC_AUTHORITY_ENTITY_COUNT = 4
PHYSICAL_TABLE_COUNT = 6
FK_COUNT = 14
CONTRACT_FIELD_DRIFT = 0
RELATION_SET_DRIFT = 0
METHOD_PROVENANCE_DRIFT = 0
LOCATOR_DRIFT = 0
CUTOFF_REASSESSMENT_DRIFT = 0
CLAIM_AUTHORITY_DRIFT = 0
RCV020_BINDING_DRIFT = 0
RCV018_OWNERSHIP_LEAKAGE = 0
RCV021_RESEARCH_LEAKAGE = 0
SCHEDULER_LEAKAGE = 0
TRUTH_ADJUDICATION_LEAKAGE = 0
TRANSACTION_BOUNDARY_AMBIGUITY = 0
VERIFIER_PRECEDENCE_AMBIGUITY = 0
TEST_PROOF_AMBIGUITY = 0
TOOL_PARTICIPATION_STORAGE_AMBIGUITY = 0
TOOL_PARTICIPATION_WRITER_AMBIGUITY = 0
TOOL_PARTICIPATION_ADMISSION_AMBIGUITY = 0
TOOL_PARTICIPATION_VERIFIER_AMBIGUITY = 0
TOOL_CONTEXT_CONDITIONAL_AMBIGUITY = 0
CIRCULAR_TOOL_CONTEXT_INFERENCE = 0
CLAIM_STRENGTH_OVERREACH = 0
FOUR_AUTHORITY_MODEL_DRIFT = 0
PHYSICAL_TABLE_SET_DRIFT = 0
FK_SET_DRIFT = 0
OPTIONAL_INPUT_MODEL_DRIFT = 0
NO_REPAIR_DRIFT = 0
OPEN_DESIGN_QUESTIONS = 0
```

This Design is not a migration, implementation, test file, or snapshot lock.
The corrected Contract is re-snapshot-locked, but this Design remains pending
the separate independent Design re-audit and re-snapshot. Wave A correction and
all later waves remain blocked until that gate passes.
