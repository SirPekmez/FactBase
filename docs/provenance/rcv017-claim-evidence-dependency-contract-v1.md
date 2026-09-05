# RCV-017 Claim Evidence Dependency Analysis Contract, Version 1

Analysis schema ID: `factbase-claim-evidence-dependency-analysis`

Analysis schema version: `1`

Policy schema ID: `factbase-dependency-analysis-policy`

Policy schema version: `1`

Relationship-classification catalog ID: `factbase-dependency-relationship-classification`

Relationship-classification catalog version: `1`

Algorithm ID: `factbase-claim-evidence-dependency-algorithm`

Algorithm version: `1`

Canonicalization identity: `jcs-rfc8785` / `1`

Hash algorithm: `sha-256`

This document and
`src/contracts/rcv017ClaimEvidenceDependencyContractV1.ts` are the two
normative representations of the RCV-017 V1 contract. They are semantic
mirrors. An input or result allowed by only one representation is invalid.

RCV-017 performs deterministic structural analysis over explicitly selected
ClaimVersion evidence relations and one exact finalized RCV-016
ProvenanceSnapshot. It does not establish truth, credibility, quality, trust,
independence, evidential weight, rank, confidence, a winner, or current state.

## 1. Constitution

1. The V1 domain object is `ClaimEvidenceDependencyAnalysis`.
2. It is a separate immutable artifact. It does not extend, repair, or mutate
   an RCV-016 ProvenanceSnapshot.
3. One analysis binds one exact ClaimVersion, explicit evidence-relation and
   EvidenceArtifactBinding selections, one exact finalized RCV-016 Snapshot,
   one exact immutable policy, and one exact analysis algorithm identity.
4. Absence of recorded dependency, common ancestry, or graph intersection
   never establishes independence.
5. RCV-017 V1 has no graph-derived independent/not-independent state and no
   independence score, probability, confidence, or rank.
6. RCV-014 independence assessments are attributed historical assessments,
   not deterministic RCV-017 input or graph facts.
7. Later live state never changes an existing analysis. New information needs
   a new explicit input and/or new ProvenanceSnapshot and a new analysis.
8. Every schema and enum is closed and default-deny. Unsupported future
   identities and unknown properties are invalid.
9. Limit breaches and integrity failures are technical failures, never
   semantic findings.
10. RCV-017 never repairs or rewrites historical input.

## 2. Primitive representations

Every UUID-bearing field is a lowercase canonical textual UUID of the form
`8-4-4-4-12`. Acceptance performs no normalization. Uppercase or mixed-case
UUID text is invalid.

UUID-bearing fields are:

- `claimVersionId`;
- `claimVersionEvidenceRelationId`;
- `evidenceId`;
- `evidenceArtifactBindingStatementId`;
- `artifactVersionId` and `upstreamArtifactVersionId`;
- every ArtifactVersion ID in a witness or knowledge finding;
- every ArtifactProvenanceStatement ID in a witness;
- every KnowledgeStateStatement ID in a knowledge finding;
- `provenanceSnapshotId`;
- `policyId` and `dependencyAnalysisPolicyId`;
- `analysisId` in the persistence envelope.

Every hash is exactly 64 lowercase hexadecimal characters representing
SHA-256 bytes. Matching hashes never imply domain identity. Hash-bearing fields
are `provenanceSnapshotHash`, `dependencyAnalysisPolicyHash`,
`algorithmArtifactHash`, policy `canonicalHash`, and analysis `canonicalHash`.

Every limit and `policyVersion` is a positive finite safe integer. Zero,
negative values, non-integers, non-finite numbers, and unsafe integers are
invalid.

Persistence timestamps use exact UTC ISO-8601 text with six fractional digits:
`YYYY-MM-DDTHH:mm:ss.ffffffZ`. No offset or shortened fraction is accepted.

## 3. Closed input direction model

Input directions, in normative rank order, are:

1. `supports`
2. `contradicts`
3. `contextualizes`

Finding directions are exactly `supports` and `contradicts`, in that order.
`contextualizes` is retained in exact analysis input but is excluded from all
V1 comparison findings. Cross-direction findings are invalid. No direction is
netted against another and no ratio, majority, or balance is computed.

## 4. Selected ClaimVersion evidence relations

`evidenceRelations` is a non-empty array of closed objects containing exactly:

```text
claimVersionEvidenceRelationId
evidenceId
direction
```

The top-level `claimVersionId` is not repeated. Each exact relation must belong
to that ClaimVersion and reference the declared Evidence. Duplicate relation
IDs are invalid. Every relation requires one or more selected bindings.

Input order has no semantic meaning. Canonical order is ascending ASCII
`claimVersionEvidenceRelationId`.

## 5. Selected binding input and branch identity

`selectedBindings` is a non-empty array of closed objects containing exactly:

```text
claimVersionEvidenceRelationId
evidenceArtifactBindingStatementId
evidenceId
artifactVersionId
```

The selected relation must exist in `evidenceRelations`; both records must
declare the same `evidenceId`. The exact RCV-016 EvidenceArtifactBinding must:

- be a member of the bound ProvenanceSnapshot;
- have the selected statement ID;
- bind that Evidence ID to that ArtifactVersion ID.

One branch is identified by this closed object:

```text
{
  claimVersionEvidenceRelationId,
  evidenceArtifactBindingStatementId
}
```

No concatenated key, hidden ordinal, latest binding, current binding, first
binding, or winning binding exists. Each selected binding creates one branch.
The same Evidence or ArtifactVersion may legitimately occur in several
different branches.

Duplicate binding statement IDs and duplicate branch keys are invalid.
Canonical binding and branch order is relation UUID ASCII, then binding
statement UUID ASCII.

## 6. Exact RCV-016 Snapshot binding

The analysis binds exactly `provenanceSnapshotId` and
`provenanceSnapshotHash`. The complete RCV-016 Canonical is not duplicated.
Verification resolves that exact historical record and validates its frozen
RCV-016 identity independently. There is no current/latest fallback.

The Snapshot must contain all selected bindings, branch anchors, provenance
statements used by traversal or witnesses, and Knowledge State material used
by findings. No later database state may supply analysis content.

## 7. Relationship-classification catalog

The exact V1 mapping is:

| RCV-016 relationship | RCV-017 classification |
|---|---|
| `cites` | `reference_only` |
| `quotes` | `recorded_informational_dependency` |
| `incorporates` | `recorded_informational_dependency` |
| `reposts` | `recorded_informational_dependency` |
| `syndicated_from` | `recorded_informational_dependency` |
| `derived_from` | `recorded_informational_dependency` |
| `uses_information_from` | `recorded_informational_dependency` |

The catalog has no third classification. The policy may enable a non-empty
subset of the six dependency-bearing relationships. `cites`, unknown
relationships, duplicates, or semantic reclassification are invalid.

Canonical enabled-relationship order follows this fixed dependency catalog
order: `quotes`, `incorporates`, `reposts`, `syndicated_from`, `derived_from`,
`uses_information_from`.

## 8. DependencyAnalysisPolicy V1

The policy is an immutable independently canonicalized object. Its closed
Canonical contains exactly, in this semantic field manifest:

```text
schemaId
schemaVersion
policyId
policyVersion
relationshipClassificationCatalogId
relationshipClassificationCatalogVersion
enabledDependencyRelationships
evidenceDirectionPartitionRule
reflexiveClosureRule
commonUpstreamRule
negativeFindingRule
knowledgeLimitationRule
witnessSelectionRule
findingVocabularyRule
cycleHandlingRule
deterministicOrderingRule
maxEvidenceRelations
maxBindings
maxArtifactVersions
maxStatements
maxDependencyDepth
maxFindings
maxCanonicalBytes
canonicalizationId
canonicalizationVersion
hashAlgorithm
```

The exact rule literals are:

| Field | Literal |
|---|---|
| `evidenceDirectionPartitionRule` | `supports_and_contradicts_separate_contextualizes_excluded` |
| `reflexiveClosureRule` | `anchor_depth_zero_then_enabled_dependency_edges_minimum_distance` |
| `commonUpstreamRule` | `same_exact_artifact_version_in_two_or_more_reflexive_branch_closures` |
| `negativeFindingRule` | `unordered_same_direction_pair_with_disjoint_reflexive_closures` |
| `knowledgeLimitationRule` | `snapshot_unknown_partial_or_derived_unrecorded_in_reached_set` |
| `witnessSelectionRule` | `fewest_edges_then_ascii_statement_id_sequence` |
| `findingVocabularyRule` | `rcv017_closed_four_finding_vocabulary_v1` |
| `cycleHandlingRule` | `expand_once_per_branch_at_minimum_distance` |
| `deterministicOrderingRule` | `rcv017_explicit_total_order_v1` |

The policy envelope contains exact JCS `canonical` text and its
`canonicalHash`. Concrete numeric policy values are not defaults in this
contract; a concrete valid policy must explicitly supply all seven limits.

## 9. Reflexive dependency closure and depth

For each supports/contradicts branch, its reflexive closure contains its bound
ArtifactVersion at depth zero. Traversal then follows downstream-to-upstream
RCV-016 ArtifactProvenanceStatements whose relationship is both
dependency-bearing and enabled by the exact policy.

Depth is minimum eligible edge distance from the branch anchor. A node at
exactly `maxDependencyDepth` is included but not expanded. Its outgoing edge
and object beyond the boundary are outside that traversal path. Minimum valid
`maxDependencyDepth` is 1; zero is invalid policy.

Each ArtifactVersion is expanded at most once per branch at its minimum
distance, or by a provably equivalent deterministic method. Discovery order
never controls depth or witnesses. `cites` is ignored for closure traversal.

## 10. Limit domains

The seven policy limits are:

| Limit | Exact measured domain |
|---|---|
| `maxEvidenceRelations` | Selected evidence-relation records in the whole analysis |
| `maxBindings` | Selected binding records in the whole analysis |
| `maxArtifactVersions` | Distinct ArtifactVersion IDs reached across all branches |
| `maxStatements` | Distinct dependency-bearing ArtifactProvenanceStatement IDs considered across all branches |
| `maxDependencyDepth` | Inclusive minimum edge distance, applied per branch traversal |
| `maxFindings` | Final Canonical finding count in the whole analysis |
| `maxCanonicalBytes` | Exact UTF-8 byte length of final JCS analysis Canonical |

Any breach is a technical whole-analysis failure. Truncation, partial success,
or a semantic incomplete finding caused by a limit is forbidden.

## 11. Cycle semantics

Traversal is cycle-safe and cannot create infinite paths. Each node is expanded
once per branch at minimum distance. A normalized witness is simple and cannot
repeat an ArtifactVersion.

RCV-017 does not duplicate RCV-016 cycle diagnostics and has no separate V1
traversal-diagnostic array. RCV-016 cycle diagnostics remain bound Snapshot
context. A cycle is not conflict, manipulation, contradiction, or deception.

## 12. Normalized witness

A witness is a closed object containing exactly:

```text
artifactVersionIds
artifactProvenanceStatementIds
```

Rules:

- `artifactVersionIds` is non-empty.
- Its length equals statement-ID length plus one.
- Its first ID is the member branch anchor.
- Its last ID is the finding's exact common upstream.
- Every statement connects the adjacent ArtifactVersions downstream to
  upstream.
- Every statement and ArtifactVersion is in the bound Snapshot.
- Every relationship is dependency-bearing and enabled by policy.
- No ArtifactVersion repeats.
- Choose the fewest-edge witness.
- If several shortest witnesses exist, compare their ordered statement-ID
  arrays element by element using ASCII ordering; choose the first differing
  lower ID. Equal prefixes sort before longer arrays, although shortest-path
  ties necessarily have equal lengths.

An anchor witness contains one ArtifactVersion and no statement IDs. It is not
a DependencyPath. No alternative-path count is Canonical.

## 13. Closed finding vocabulary

V1 contains exactly, in category-rank order:

1. `RECORDED_SHARED_ARTIFACT_VERSION`
2. `RECORDED_COMMON_UPSTREAM`
3. `NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE`
4. `DEPENDENCY_KNOWLEDGE_INCOMPLETE`

There is no fifth, generic, unknown, future, independence, strength, or score
finding. `RECORDED_DEPENDENCY_PATH` is witness structure, not a finding.

### 13.1 `RECORDED_SHARED_ARTIFACT_VERSION`

Closed fields:

```text
type
direction
artifactVersionId
members
```

Identity is `(direction, artifactVersionId)`. `members` contains at least two
distinct branch keys, all having that direction and that exact bound
ArtifactVersion. Members are branch-key sorted. No witness is required because
binding IDs are already recoverable from branch keys.

### 13.2 `RECORDED_COMMON_UPSTREAM`

Closed fields:

```text
type
direction
upstreamArtifactVersionId
members
```

Identity is `(direction, upstreamArtifactVersionId)`. At least two distinct
member objects are required. Each closed member contains exactly `branchKey`
and `witness`. Every member has that direction, and every witness ends at the
exact upstream ID. At least one member witness has a positive edge count.

There is one finding per identity containing all eligible members. Overlapping
member sets for different upstream IDs remain separate and are never merged
into an origin cluster.

### 13.3 `NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE`

Closed fields:

```text
type
direction
lowerBranchKey
upperBranchKey
```

Identity is `(direction, lowerBranchKey, upperBranchKey)`. It contains exactly
two distinct same-direction branches in canonical branch-key order. Their
anchors differ and their reflexive closures have an empty intersection. It has
no fabricated witness and does not repeat policy or Snapshot fields.

Its only meaning is that no exact shared upstream ArtifactVersion was found in
the exact finalized Snapshot under the exact policy. It never means
independence or absence of hidden dependency.

### 13.4 `DEPENDENCY_KNOWLEDGE_INCOMPLETE`

Closed fields:

```text
type
branchKey
affectedArtifactVersionIds
knowledgeStateStatementIds
derivedUnrecordedArtifactVersionIds
```

Identity is the branch key. The branch must be eligible for comparison.
`knowledgeStateStatementIds` contains only bound-Snapshot statements with scope
`upstream_provenance` and state `unknown` or `partial` for ArtifactVersions in
the branch's reached set. `known` is never included and does not cancel a
coexisting unknown/partial statement.

`derivedUnrecordedArtifactVersionIds` contains only ArtifactVersions appearing
in the bound Snapshot's exact `derivedUnrecordedStates`. At least one knowledge
statement ID or derived-unrecorded ID is required.

`affectedArtifactVersionIds` is the exact duplicate-free normalized union of
the subject ArtifactVersion IDs of both evidence sources. All three ID arrays
are ascending ASCII and duplicate-free.

## 14. Canonical analysis model

`ClaimEvidenceDependencyAnalysisCanonicalV1` is a closed object with exactly
these 17 fields:

```text
schemaId
schemaVersion
claimVersionId
evidenceRelations
selectedBindings
provenanceSnapshotId
provenanceSnapshotHash
dependencyAnalysisPolicyId
dependencyAnalysisPolicyVersion
dependencyAnalysisPolicyHash
algorithmId
algorithmVersion
algorithmArtifactHash
canonicalizationId
canonicalizationVersion
hashAlgorithm
findings
```

The policy identity and hash must exactly match the independently verified
policy Canonical. The algorithm fields must match the V1 algorithm constants.
There is no separate Builder identity: deterministic analysis behavior is
owned by the exact algorithm identity and artifact hash, and a second identity
would be redundant.

The analysis contains no `analysisId`, `createdAt`, counts, Source context,
RCV-014 assessment value, score, confidence, rank, truth, credibility, quality,
trust, independence, current/latest/winner, or repair field.

## 15. Persistence envelope boundary

Persistence is not implemented by this phase, but its semantic boundary is a
closed four-field envelope:

```text
analysisId
createdAt
canonical
canonicalHash
```

`analysisId` is a lowercase canonical UUID persistence identity. It is not
derived from Canonical bytes or any domain value. `createdAt` is DB/server-owned
persistence metadata. Both are outside Canonical semantic identity.

`canonical` is the exact JCS text and `canonicalHash` is SHA-256 over its exact
UTF-8 bytes. No parsing, trimming, Unicode normalization, newline insertion,
or database-side reconstruction is permitted at the persistence boundary.

## 16. Canonicalization and hashing

Both policy and analysis use RFC 8785/JCS identity `jcs-rfc8785` / `1` and
`sha-256`. The hash input is the exact UTF-8 encoding of the JCS text. A hash of
an alternative serialization is invalid. Hash equality never merges domain
identity.

## 17. Total ordering

All string comparisons below are ascending ASCII over accepted lowercase UUID
text. Explicit direction rank is supports, contradicts, contextualizes.

1. Evidence relations: relation ID.
2. Selected bindings and branches: relation ID, then binding statement ID.
3. Finding categories: the four-type rank in section 13.
4. Shared findings: direction rank, then `artifactVersionId`.
5. Common findings: direction rank, then `upstreamArtifactVersionId`.
6. Negative findings: direction rank, lower branch key, upper branch key.
7. Knowledge findings: branch key.
8. Finding members: branch key.
9. Set-valued UUID arrays: UUID ASCII.
10. Witness statement and ArtifactVersion arrays retain path order.

Caller array order has no semantic effect. Exact Canonical arrays must already
be in their required order; validators do not silently sort malformed input.

## 18. Duplicate rules

Reject, without silent deduplication:

- duplicate evidence-relation IDs;
- duplicate selected binding statement IDs;
- duplicate branch keys;
- duplicate enabled dependency relationships;
- duplicate finding identities;
- duplicate finding-member branches;
- duplicate common-upstream member branches;
- duplicate affected ArtifactVersion IDs;
- duplicate KnowledgeStateStatement IDs;
- duplicate derived-unrecorded ArtifactVersion IDs;
- a repeated ArtifactVersion inside one witness.

Do not reject legitimate recurrence across different semantic identities, such
as the same Evidence or ArtifactVersion in distinct branches, one upstream
reached by several branches, overlapping findings, or historical statement
multiplicity.

## 19. Internal and historical parity invariants

Validation must establish:

1. Every selected relation belongs to the top-level ClaimVersion.
2. Every selected binding names an existing selected relation.
3. Relation and binding Evidence IDs match.
4. The exact binding statement binds that Evidence to the declared anchor.
5. Binding statements and anchors are bound-Snapshot members.
6. Snapshot ID and hash match the exact verified RCV-016 Snapshot.
7. Policy ID, version, and hash match the exact verified policy.
8. Every finding member names an existing branch.
9. Finding direction equals every member relation direction.
10. Shared-finding members have the finding's exact anchor.
11. Common witnesses start at member anchors and end at the finding upstream.
12. Negative branches differ, have different anchors, and have disjoint
    reflexive closures.
13. Knowledge findings name existing eligible branches.
14. Knowledge evidence refers only to the branch's reached set and bound
    Snapshot.
15. No finding references foreign input, live state, or an unselected binding.

These are contract invariants. Future Builder/Verifier implementations must
enforce them without weakening or reinterpreting them.

## 20. RCV-016 Knowledge source rule

`DEPENDENCY_KNOWLEDGE_INCOMPLETE` is derived exclusively from the bound,
finalized RCV-016 ProvenanceSnapshot:

- Snapshot-contained KnowledgeStateStatements;
- Snapshot Canonical `derivedUnrecordedStates`.

No live KnowledgeState query is allowed. There is no latest/current/winner or
supersession reduction. Historical multiplicity remains, and known does not
cancel unknown or partial. This finding describes bounded dependency-knowledge
limitations; it is not a new RCV-016 Knowledge State.

## 21. RCV-014 separation

RCV-014 independence assessments:

- are absent from Canonical RCV-017 analysis;
- are not policy inputs;
- are not weights or finding evidence;
- do not alter finding generation;
- are never converted to graph facts.

They may be displayed separately by a future consumer without entering the
RCV-017 Canonical identity.

## 22. Source organizational context exclusion

RCV-016 SourceRelationshipStatements are display-only historical context for
RCV-017 V1. They do not affect closures, witnesses, findings, or policy.
Source context is excluded entirely from Canonical V1. A consumer may load it
separately from the exact bound Snapshot and preserve its recorded validity
fields without determining current temporal applicability.

## 23. Historical multiplicity

A minimal witness is deterministic evidence for one finding only. It never
means other paths do not exist, that the witness is current or best, or that it
wins over another historical statement. The complete bound Snapshot remains
inspectable. Supersession does not select a current statement.

## 24. Live-state prohibition

After analysis finalization, later ArtifactProvenanceStatements,
SourceRelationshipStatements, EvidenceArtifactBindings,
KnowledgeStateStatements, SourceVersions, or ArtifactVersions cannot change
Canonical, hash, findings, or witnesses. New data requires new explicit input
and/or a new Snapshot followed by a new immutable analysis.

## 25. Default deny and error boundary

Every object described here is closed: additional properties are invalid.
Every enum and discriminated union is closed. Unsupported schema, policy,
algorithm, catalog, canonicalization, or hash identities fail closed. Unknown
relationships, directions, and finding types fail closed. There is no
best-effort future parsing.

The technical categories are:

- `validation_failure`
- `unsupported_version`
- `limit_failure`
- `integrity_parity_failure`

This contract does not prescribe production error classes. It does require
that technical failures never become unknown, incomplete knowledge, conflict,
contradiction, independence, partial success, or another domain finding.

## 26. Explicitly prohibited semantics

RCV-017 V1 contains no semantic field equivalent to a score, confidence,
weight, rank, truth, credibility, quality, trust, independence, strength,
majority, support ratio, corroboration count, or source count.

It contains no current, latest, winner, effective, active, best, repair,
rewrite, automatic retry, heuristic binding, identity inference, independent
observation, manipulation, deception, or source reputation semantic.

No graph-derived independence
state is persisted or returned. `independence_not_inferable` is a normative
interpretation invariant, not a Canonical finding.

## 27. RCV-018 and RCV-020 boundaries

RCV-017 describes dependency-knowledge limitation but not general uncertainty,
argumentation, contradiction resolution, belief, or conflict semantics; those
remain RCV-018+. It creates no manipulation, Sybil, laundering, intent,
deception, or credibility finding; RCV-020 may later consume its exact
structural findings without changing them.

## 28. Markdown and TypeScript parity table

The following 32 contract dimensions must remain exact mirrors. The TypeScript
types carry closed object shapes; exported constants carry normative catalogs,
field manifests, ranks, rules, and prohibitions.

| # | Contract dimension | Markdown owner | TypeScript owner |
|---:|---|---|---|
| 1 | Analysis schema identity | Header, section 14 | `RCV017_ANALYSIS_SCHEMA_ID`, `RCV017_ANALYSIS_SCHEMA_VERSION` |
| 2 | Policy schema identity | Header, section 8 | `RCV017_POLICY_SCHEMA_ID`, `RCV017_POLICY_SCHEMA_VERSION` |
| 3 | Algorithm identity | Header, section 14 | `RCV017_ALGORITHM_ID`, `RCV017_ALGORITHM_VERSION` |
| 4 | Catalog identity | Header, section 7 | `RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_ID`, version |
| 5 | Canonicalization | Header, section 16 | `RCV017_CANONICALIZATION_ID`, version |
| 6 | Hash algorithm | Header, sections 2 and 16 | `RCV017_HASH_ALGORITHM` |
| 7 | UUID representation | Section 2 | `Rcv017CanonicalUuidV1`, `isRcv017CanonicalUuidV1` |
| 8 | Hash representation | Section 2 | `Rcv017Sha256HexV1`, `isRcv017Sha256HexV1` |
| 9 | Positive limits | Sections 2 and 10 | `Rcv017PositiveSafeIntegerV1`, predicate |
| 10 | Direction enums/ranks | Sections 3 and 17 | direction arrays and `RCV017_DIRECTION_RANK_V1` |
| 11 | Relationship catalog | Section 7 | `RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_V1` |
| 12 | Enabled-relationship constraint | Sections 7 and 8 | `Rcv017DependencyBearingRelationshipV1` and array |
| 13 | Evidence-relation input | Section 4 | `Rcv017EvidenceRelationInputV1` |
| 14 | Binding input | Section 5 | `Rcv017SelectedBindingInputV1` |
| 15 | Branch key | Section 5 | `Rcv017BranchKeyV1` |
| 16 | Witness | Section 12 | `Rcv017NormalizedWitnessV1`, `RCV017_WITNESS_RULES_V1` |
| 17 | Finding vocabulary/rank | Section 13 | finding-type array and rank |
| 18 | Shared-artifact finding | Section 13.1 | `Rcv017RecordedSharedArtifactVersionFindingV1` |
| 19 | Common-upstream finding | Section 13.2 | `Rcv017RecordedCommonUpstreamFindingV1` |
| 20 | Negative finding | Section 13.3 | `Rcv017NoRecordedCommonUpstreamWithinScopeFindingV1` |
| 21 | Knowledge finding | Section 13.4 | `Rcv017DependencyKnowledgeIncompleteFindingV1` |
| 22 | Policy fields/rules | Section 8 | policy interface, field manifest, rule constants |
| 23 | Seven limit domains | Section 10 | limit field array and counting constants |
| 24 | Analysis Canonical fields | Section 14 | analysis interface and 17-field manifest |
| 25 | Persistence boundary | Section 15 | persistence interface and four-field manifest |
| 26 | Ordering | Section 17 | `RCV017_ORDERING_V1` |
| 27 | Duplicate rejection | Section 18 | `RCV017_DUPLICATE_RULES_V1` |
| 28 | Knowledge source | Section 20 | `RCV017_KNOWLEDGE_SOURCE_RULE_V1` |
| 29 | Technical failures | Section 25 | `RCV017_TECHNICAL_FAILURE_CATEGORIES_V1` |
| 30 | No RCV-014/Source semantics | Sections 21–22 | exported false invariant flags |
| 31 | No scores/current/independence | Sections 1 and 26 | exported false invariant flags and closed manifests |
| 32 | Finalized-only/no repair | Sections 23–25 | live-state and repair false flags |
