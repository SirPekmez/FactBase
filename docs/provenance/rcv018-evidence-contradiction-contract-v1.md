# RCV-018 Evidence Contradiction Contract V1

## 1. Purpose and scope

RCV-018 defines a deterministic, historically reproducible comparison of two
structured Evidence Assertions. It can report comparability, an explicitly
proven incompatibility, a contradiction, and the derived state UNRESOLVED.
It operates on recorded structured data; it does not establish that a source
was interpreted correctly.

FactBase's North Star remains: make the evidentiary support for a claim
transparent, reproducible, and traceable without introducing truth, credibility,
ranking, or belief semantics.

## 2. Non-goals and boundaries

RCV-018 does not perform natural-language interpretation, ontology reasoning,
unit conversion, temporal or jurisdiction inference, quality or credibility
scoring, confidence or probability calculation, truth resolution, winner
selection, recommendation, majority logic, or intent/deception/manipulation,
Sybil, or laundering analysis. RCV-017 is immutable and is not modified.

RCV-017 KNOWLEDGE_INCOMPLETE remains its own authoritative state. It is never
copied, renamed, or generalized into UNRESOLVED. RCV-014 assessments are not an
eligibility or incompatibility gate.

RCV-017 `supports` and `contradicts` labels are historical evidence-direction
metadata only. They do not independently establish RCV-018 comparability,
incompatibility, CONTRADICTION, or UNRESOLVED. Those results require the
authenticated Evidence Assertion, Comparison Domain equality, and explicit
mutually-exclusive-pair proof defined below.

RCV-018 consumes already structured historical Evidence Assertions. It does not
derive subject, property, or value semantics from free-form source prose and does
not authenticate extraction or source-interpretation correctness.

## 3. Primitive types

- `LowercaseUuidV1`: canonical lowercase UUID text (`8-4-4-4-12`), with no
  whitespace, alternate spelling, or normalization.
- `VersionV1`: positive JavaScript-safe integer, minimum `1`.
- `Sha256HexV1`: exactly 64 lowercase hexadecimal characters.
- `TokenV1`: ASCII text matching `^[A-Za-z0-9._:-]+$`, length 1..128,
  case-sensitive, with no trimming, folding, aliases, or synonym normalization.

## 4. ValueDomainV1

```text
{ valueDomainId, valueDomainVersion, kind, allowedValues }
```

`kind` is exactly `CLOSED_SYMBOLIC_STATE`. `allowedValues` is non-empty,
unique, immutable/version-bound, and strictly ascending by exact ASCII lexical
order. Singleton domains are valid. A pair requires two distinct values, so a
self-pair is always rejected. Values are exact `TokenV1` tokens; no aliases or
implicit normalization exist.

The Value Domain Canonical is the JCS UTF-8 representation of exactly these
semantic fields. `valueDomainHash` is SHA-256 of those exact bytes.

## 5. ComparisonDomainV1

```text
{
  comparisonDomainId, comparisonDomainVersion, propertyId,
  valueDomainId, valueDomainVersion, valueDomainHash,
  comparisonKeySchema, ruleFamily, incompatibilityPairs
}
```

`comparisonKeySchema` is an ordered array of required descriptors:
`{ key: TokenV1, type: "UUID" | "TOKEN" }`. Keys are unique and strictly
ascending. No optional, wildcard, extension, numeric, temporal, array, object,
or boolean context types are supported.

`ruleFamily` is exactly `EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR`.
`incompatibilityPairs` contain exactly two distinct allowed values, ordered
lexically within each pair and ordered by left then right member across the
array. Self-pairs, duplicate pairs, inverse duplicates, and unknown values are
rejected.

The Comparison Domain Canonical is JCS UTF-8 over exactly the fields above;
`comparisonDomainHash` is SHA-256 over its exact bytes. Hash fields are not
recursive Canonical members.

## 6. EvidenceAssertionV1

```text
{
  assertionId, subjectId, propertyId,
  comparisonDomainId, comparisonDomainVersion, comparisonDomainHash,
  valueDomainId, valueDomainVersion, valueDomainHash,
  value, comparisonContext, evidenceBasis, historicalBindings
}
```

All fields are required and immutable. There is no `assertionVersion`, prose,
timestamp, diagnostic, or storage metadata. `assertionId` is explicit logical
identity. The assertion Canonical is JCS UTF-8 over exactly the listed fields,
including the domain hashes and excluding `assertionHash` and Canonical text.
`assertionHash` is SHA-256 over the exact Canonical bytes.

`comparisonContext` is a sorted array of `{ key, type, value }` entries. It must
contain exactly one entry for every schema key, with exact type and value parity,
no extra or duplicate key, and no normalization. `subjectId` equality is a
separate mandatory comparability invariant.

`EvidenceBasisEntryV1` is exactly:

```text
{ evidenceRelationId, evidenceId, artifactVersionId, statementKind, statementId }
```

`StatementRefV1` is exactly `{ statementKind, statementId }`. `statementKind` is
one of `ArtifactProvenanceStatement`, `SourceRelationshipStatement`,
`ArtifactSourceAttribution`, `EvidenceArtifactBinding`, or
`KnowledgeStateStatement`; `statementId` is `LowercaseUuidV1`. Together they
form the exact historical statement identity. The array is non-empty,
duplicate-free, and ordered lexically by evidence relation ID, evidence ID,
ArtifactVersion ID, statement kind, then statement ID. The uniqueness tuple
includes all five members. The same UUID under different kinds is a different
identity; the same kind and UUID is the same identity. No `bindingId`, count,
score, ranking, assessment, or prose is included.

`HistoricalBindingV1` is the closed tagged union of `CLAIM_VERSION`, `STATEMENT`,
`ARTIFACT_VERSION`, `RCV016_SNAPSHOT` (ID plus hash), and `RCV017_ANALYSIS`
(ID plus hash). The array is non-empty, duplicate-free, and ordered by kind then
identifier tuple. Only bindings that materially affect meaning or reproducibility
may be included; no live references or RCV-014 assessment bindings are allowed.

Its exact alternatives are:

```text
{ kind: "CLAIM_VERSION", claimVersionId }
{ kind: "STATEMENT", statementKind, statementId }
{ kind: "ARTIFACT_VERSION", artifactVersionId }
{ kind: "RCV016_SNAPSHOT", snapshotId, snapshotHash }
{ kind: "RCV017_ANALYSIS", analysisId, analysisHash }
```

For `kind = "STATEMENT"`, `statementKind` participates in identity, duplicate
checks, and ordering. The closed family mapping is:

```text
ArtifactProvenanceStatement -> public.artifact_provenance_statements
SourceRelationshipStatement -> public.source_relationship_statements
ArtifactSourceAttribution -> public.artifact_source_attributions
EvidenceArtifactBinding -> public.evidence_artifact_bindings
KnowledgeStateStatement -> public.knowledge_state_statements
```

These are explanatory mappings of frozen RCV-016 family identifiers, not
free-form semantic table names. A kind selects exactly one family; resolution
never searches alternate families, applies precedence, or consults current/latest
state. Invalid kind/ID pairs, missing IDs, absent IDs in the selected family,
and unrelated evidence-basis tuples are `REJECT_UNSUPPORTED`.

## 7. Integrity and comparability

Value Domain and Comparison Domain Canonical/hash parity, schema, and versions
must be independently verified before semantic comparison. Any malformed,
unsupported, non-JCS, or hash-mismatched state is `REJECT_UNSUPPORTED`.

After both assertions and their referenced domains are valid, assertions are
`COMPARABLE` iff subject, property, domain identity/version/hash, value-domain
identity/version/hash, and every context entry match exactly. Otherwise the
valid result is `NOT_COMPARABLE`.

## 8. Incompatibility and contradiction

For comparable assertions, the unordered lexical pair of values is looked up in
the explicit pair set. A listed pair yields `INCOMPATIBILITY_PROVEN`; absence
yields `INCOMPATIBILITY_NOT_PROVEN`. No compatibility is inferred from absence.

`CONTRADICTION` is produced only by `COMPARABLE` plus
`INCOMPATIBILITY_PROVEN`. It is binary, pairwise, and symmetric. Participant
order is normalized by ascending `assertionId`; equal IDs with different hashes
are rejected.

Every valid V1 contradiction is structurally `UNRESOLVED`, because no V1
resolution or winner rule exists. UNRESOLVED is derived, not a separate
persisted semantic family.

The minimal witness is a derived view containing the normalized assertion IDs and
hashes, domain identity/version/hash, and exact incompatibility pair. It adds no
graph path or prose.

## 9. Canonical identity and findings

Logical IDs and semantic content hashes are distinct. Duplicate semantic content
is detected by exact Canonical/hash equality; it does not replace logical-ID
duplicate rules. No content-derived UUID is used.

Contradiction finding identity is the normalized semantic tuple above. V1 has no
logical `findingId`. `findingHash` is SHA-256 over the non-redundant JCS finding
Canonical containing the finding type, normalized participants, domain identity
and hash, and incompatibility pair. The witness is a derived proof view, not a
duplicated Canonical subtree.

## 10. Machine vocabulary

`COMPARABLE`, `NOT_COMPARABLE`, `INCOMPATIBILITY_PROVEN`,
`INCOMPATIBILITY_NOT_PROVEN`, `CONTRADICTION`, `UNRESOLVED`, and
`REJECT_UNSUPPORTED` are the complete V1 machine vocabulary.
`UNCERTAINTY`, `CONFLICT`, and `EVIDENCE_CONFLICT` are documentation-only
umbrella terms.

## 11. Default-deny rules

Structural or integrity invalidity (including invalid IDs, versions, hashes,
tokens, fields, types, ordering, domains, values, pairs, bindings, or Canonical)
is `REJECT_UNSUPPORTED`. A valid but different subject, property, domain, or
context value is `NOT_COMPARABLE`. A valid same-domain pair is evaluated only by
the explicit pair rule as described above.

No fallback, repair, sorting during verification, current/latest lookup, or
implicit normalization is permitted.

## 12. Complete analysis scope

An RCV-018 V1 analysis operates over one finite, explicit, historically bound,
duplicate-free, deterministically ordered set of Evidence Assertions. It is not
a caller-selected pair evaluator. For `N` valid assertions, every unordered pair
is evaluated exactly once (`N * (N - 1) / 2`). Invalid assertions reject the
analysis and are never silently omitted. No pair may be excluded by caller
preference, current/latest filtering, RCV-014 values, RCV-017 direction,
evidence count, source identity, or existing findings.

## 13. RCV018AnalysisV1 envelope

The complete historical result is represented by the following exact closed
`RCV018AnalysisV1` object. No other semantic fields are permitted:

```text
{
  analysisId,
  assertions: [{ assertionId, assertionHash }],
  valueDomains: [{ valueDomainId, valueDomainVersion, valueDomainHash }],
  comparisonDomains: [{ comparisonDomainId, comparisonDomainVersion, comparisonDomainHash }],
  contractBinding: { contractId, contractVersion, contractHash },
  algorithmBinding: { algorithmId, algorithmVersion, algorithmHash },
  contradictionFindingHashes
}
```

`contractBinding` and `algorithmBinding` are closed logical identity/version/hash
tuples. No runtime, deployment, database, timestamp, or machine metadata is
included. Repeated fields are ordered by assertion ID; value domain ID then
version; comparison domain ID then version; and finding hash in strict lexical
order. Duplicates are rejected. The envelope binds the complete input scope,
governing domain/rule scope, and complete contradiction set. Completeness is
independently proved by replay of every unordered pair; negative pair outcomes
are not required as individually persisted records.

`analysisCanonical` is exact RFC-8785/JCS UTF-8 over exactly the seven semantic
envelope fields above, and `analysisHash` is SHA-256 over those exact bytes. It excludes
timestamps, storage metadata, diagnostics, display labels, row order, and
current/latest state. `analysisId` is an explicit logical `LowercaseUuidV1`.

## 14. Cross-object and identity integrity

For each assertion, authenticated Comparison Domain and Value Domain identity,
version, and hash must match the assertion exactly. The domain property and value
domain references must match; the assertion value must be in the authenticated
allowed set; and the context must satisfy the authenticated key schema. Evidence
basis tuples must correspond to one exact valid historical relational state, not
merely to individually existing IDs. Any cross-object, relational, or hash
integrity failure is `REJECT_UNSUPPORTED`, never `NOT_COMPARABLE`.

Evidence-basis and STATEMENT historical-binding validation authenticates the
typed statement identity against the selected RCV-016 family. A matching UUID in
another family is not an acceptable substitute.

Each `(valueDomainId, valueDomainVersion)` maps to exactly one authenticated
Canonical/hash, and each `(comparisonDomainId, comparisonDomainVersion)` maps to
exactly one authenticated Canonical/hash. Conflicting content for one logical
ID/version is `REJECT_UNSUPPORTED`. Likewise, one `assertionId` maps to exactly
one authenticated assertion Canonical/hash; semantic reuse with different content
is `REJECT_UNSUPPORTED` and is not an implicit assertion version.

An empty `comparisonKeySchema` is valid and requires `comparisonContext` to be
exactly `[]`. An empty `incompatibilityPairs` set is valid; comparable assertions
then produce `INCOMPATIBILITY_NOT_PROVEN` unless a pair is explicitly present.

`assertions` may be empty or contain one assertion. In either case the candidate
pair count is zero and `contradictionFindingHashes` must be exactly `[]`. No
minimum assertion count is imposed in V1.

## 15. Persistence and future architecture

Persistence is required to keep exact historical analytical results inspectable,
independently verifiable, and auditable without depending on future replay
availability. This is an auditability decision, not architectural symmetry.

Persistence includes the complete `RCV018AnalysisV1` envelope and its complete
contradiction finding hash set. A persisted result is valid only when independent
replay over the exact authenticated input set produces the same complete set: no
omitted and no extra contradiction finding is accepted.

Future V1 implementation therefore requires a pure Builder, pure Write-Verifier,
one atomic PostgreSQL Repository transaction, exact-ID read-only Read Repository,
and independent Read-Verifier. A database migration is required, but physical
tables and SQL are intentionally unspecified here. No verifier has a database
handle or repair authority.
