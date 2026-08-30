# RCV-016 Evidence Provenance & Source Independence Contract, Version 1

Contract ID: `factbase-evidence-provenance-contract`

Contract version: `1`

This document is the sole normative semantic contract for RCV-016. Earlier
notes, proposals, and architecture sketches are non-normative wherever they
differ from this document. RCV-016 documents provenance and documented source
relationships. It does not decide factual truth or assign evidence weight.

The central machine-readable V1 allow matrix is
`src/contracts/rcv016ProvenanceContractV1.ts`. That matrix is normative and
default-deny: a subject-type, relationship, and object-type combination not
listed there is invalid under RCV-016 V1.

## 1. Constitution

The following invariants are mandatory:

1. `Source` is a stable FactBase identity of an information actor, publisher,
   account, or system. It is an identity, not a metadata version and not a
   truth, credibility, quality, or independence statement.
2. `SourceVersion` is one append-only historical metadata version of exactly
   one `Source`. Source identity or organizational relationships never connect
   `SourceVersion` nodes.
3. `Artifact` is the stable FactBase identity of an information object. It is
   not a URL and not a concrete observed version.
4. `ArtifactVersion` is one append-only concrete observed or captured
   historical version of exactly one `Artifact`.
5. URL equality does not prove Artifact identity.
6. Hash equality does not prove Artifact identity or provenance.
7. Similar titles, domains, handles, publisher names, source types, or text do
   not prove identity or provenance.
8. Content provenance connects only `ArtifactVersion` to `ArtifactVersion`.
9. Artifact attribution connects only `ArtifactVersion` to `SourceVersion`.
10. Source identity and organizational relationships connect only `Source` to
    `Source`.
11. Evidence binding connects only `Evidence` to `ArtifactVersion`.
12. Everything outside the V1 allow matrix is invalid. RCV-016 has no open
    relationship enum and no untyped universal-edge semantics.
13. Provenance is persisted as an attributed historical statement. A graph
    edge is only a representation of such a statement, never the primary naked
    persistence fact.
14. `cites` proves that a reference was documented. It does not automatically
    prove information dependency.
15. Multiple upstream artifacts do not automatically constitute a conflict.
16. Missing known dependency never means known independence.
17. Different Sources never automatically mean independent information.
18. Common Source control never automatically means identical content.
19. `independent` is not an RCV-016 provenance relationship.
20. `unrecorded` is not `unknown`; `unknown` is not `independent`; `partial` is
    not quantitative; and `known` does not assert complete real-world
    knowledge.
21. `conflicting` is not a Knowledge State.
22. `legacy_unbound` is not a Knowledge State.
23. Legacy Evidence must not receive heuristic provenance.
24. Evidence-to-ArtifactVersion bindings are historical statements.
25. Corrections create new versions or statements. Historical contract objects
    are not regularly updated or deleted.
26. Append-only proves preservation, not truth.
27. `created_at`, `observed_at`, and asserted real-world validity are separate
    concepts.
28. For a time-interval-capable statement, a null `valid_to` means that the
    asserted end is unknown; it does not assert that the statement is
    currently active. For every other statement, null validity fields mean
    only that a real-world validity interval is not applicable.
29. Supersession neither deletes nor repairs an older statement.
30. Snapshot completeness is relative to its root set, traversal policy, and
    recorded Knowledge State.
31. Contract-limit failures are technical diagnostics, not provenance or
    Knowledge State statements.
32. RCV-015 `factbase-derivation-input/1` remains unchanged.

## 2. Canonical model

The canonical layering is:

```text
Identity -> Version -> Statement -> Snapshot
```

### Identity

- `Source`
- `Artifact`

### Version

- `SourceVersion`
- `ArtifactVersion`

### Statement

- `ArtifactProvenanceStatement`
- `SourceRelationshipStatement`
- `ArtifactSourceAttribution`
- `EvidenceArtifactBinding`
- `KnowledgeStateStatement`

`ProvenanceStatement` is the closed umbrella union of exactly those five
statement families. It has no sixth or open family. `ProvenanceStatement` is
not a synonym for `ArtifactProvenanceStatement`; the latter is exactly one
member of the union.

The machine contract distinguishes
`Rcv016ProvenanceStatementFamilyV1`, the union of the five family-name
literals, from `Rcv016ProvenanceStatementV1`, the discriminated union of five
closed statement objects. Every object contains its literal `family`, its
family-typed `statementId`, `observedAt`, `initiator`, `rationale`,
`foundation`, family-typed `supersedesStatementId`, and `createdAt`. Nullable
fields are present as JSON null. The five members bind only:

- `ArtifactProvenanceStatement`: `subjectArtifactVersionId`, one of the seven
  content-provenance relationships, and `objectArtifactVersionId`;
- `SourceRelationshipStatement`: `subjectSourceId`, one of the five Source
  relationships, and `objectSourceId`;
- `ArtifactSourceAttribution`: `subjectArtifactVersionId`, one of the four
  attribution relationships, and `objectSourceVersionId`;
- `EvidenceArtifactBinding`: `subjectEvidenceId`, `bound_to`, and
  `objectArtifactVersionId`;
- `KnowledgeStateStatement`: `subjectArtifactVersionId`, scope
  `upstream_provenance`, and one persisted state: `unknown`, `partial`, or
  `known`.

Within `SourceRelationshipStatement`, only `part_of`, `controlled_by`, and
`operated_by` are time-interval-capable and carry `validFrom` and `validTo` as a
canonical timestamp or JSON null. `alias_of`, `successor_of`, and all other four
Statement families carry both fields as JSON null. No free subject type, object
type, relationship, state, or additional property exists in the closed object
union.

Every relationship statement is historical and attributed. No relationship is
stored as an unattributed objective edge truth.

### Snapshot

- `ProvenanceSnapshot`

`Evidence` remains the existing FactBase Evidence object. RCV-016 adds a
historical normalized binding from Evidence to one concrete ArtifactVersion;
it does not redefine Evidence as Source, Artifact, or ArtifactVersion.

## 3. Superseded and rejected design alternatives

The following four earlier ideas are expressly superseded and rejected. They
must not coexist as parallel semantics:

1. **Rejected: `conflicting` as a Knowledge State.** The only V1 Knowledge
   States are `unrecorded`, `unknown`, `partial`, and `known`. Conflict is a
   separate neutral diagnostic category. Its V1 catalog is empty, so neither
   semantic incompatibility nor explicit dispute produces a V1 Conflict.
2. **Rejected: `legacy_unbound` as a Knowledge State.** `legacy_unbound` is
   exclusively a read-derived Legacy Binding State and diagnostic literal for
   existing Legacy Evidence that has no EvidenceArtifactBinding in the
   relevant read or Snapshot scope. It is not persisted and is not a migration
   state, relationship, ProvenanceStatement, automatic provenance assertion,
   `unknown`, or `independent`.
3. **Rejected: naked provenance edges as the primary persistence model.** V1
   persists attributed historical statements. Any displayed or traversed edge
   is derived from a statement and retains that statement identity.
4. **Rejected: embedding the complete provenance graph directly in
   `factbase-derivation-input/2` during RCV-016.** RCV-016 introduces an
   independent immutable ProvenanceSnapshot. Input V1 remains unchanged, and
   an input V2 may be introduced only by a later RCV when a derivation actually
   consumes provenance.

## 4. Default-deny relationship schema

The tuple order is `Subject | Relationship | Object`. These are the complete
allowed V1 combinations.

### Artifact content provenance

Direction is always downstream to upstream.

| Subject | Relationship | Object |
|---|---|---|
| ArtifactVersion | `cites` | ArtifactVersion |
| ArtifactVersion | `quotes` | ArtifactVersion |
| ArtifactVersion | `incorporates` | ArtifactVersion |
| ArtifactVersion | `reposts` | ArtifactVersion |
| ArtifactVersion | `syndicated_from` | ArtifactVersion |
| ArtifactVersion | `derived_from` | ArtifactVersion |
| ArtifactVersion | `uses_information_from` | ArtifactVersion |

These relationships document content provenance. They do not assign truth,
quality, credibility, weight, or independence.

### Artifact attribution

| Subject | Relationship | Object |
|---|---|---|
| ArtifactVersion | `authored_by` | SourceVersion |
| ArtifactVersion | `published_by` | SourceVersion |
| ArtifactVersion | `hosted_by` | SourceVersion |
| ArtifactVersion | `issued_by` | SourceVersion |

Attribution is not information dependency.

### Source relationships

| Subject | Relationship | Object |
|---|---|---|
| Source | `alias_of` | Source |
| Source | `successor_of` | Source |
| Source | `part_of` | Source |
| Source | `controlled_by` | Source |
| Source | `operated_by` | Source |

`alias_of` is semantically symmetric but is persisted in exactly one canonical
direction. Compare the lowercase canonical UUID strings of the two Sources by
ascending ASCII lexicographic order. The smaller canonical Source ID is the
subject and the larger canonical Source ID is the object. Self-alias is invalid.
The reverse tuple is the same alias assertion and must not be persisted as a
second statement. Reads are symmetric, and the persisted direction has no
domain meaning. `successor_of` is directed successor to predecessor. `part_of`,
`controlled_by`, and `operated_by` are directed and may be time-bound.

### Evidence binding

| Subject | Relationship | Object |
|---|---|---|
| Evidence | `bound_to` | ArtifactVersion |

Any other type combination or relationship, including `fact_checked_by`, is
invalid in V1. Supersession is statement metadata and is not a provenance-node
relationship in this allow matrix.

## 5. Evidence binding and legacy Evidence

An `EvidenceArtifactBinding` records that one existing Evidence object was
bound to exactly one concrete ArtifactVersion by that historical binding
statement. The binding is append-only; it is not a freely overwritten solitary
foreign key treated as timeless historical truth.

A correction creates a new binding and may supersede an older binding within
the same statement family. The older binding remains fully readable.

Legacy Evidence must not be assigned an Artifact, ArtifactVersion, Source, or
provenance relationship automatically from any of the following:

- URL;
- domain;
- title;
- text similarity;
- content or snapshot hash;
- publisher name;
- source type.

`legacy_unbound` is the sole closed Legacy Binding read-state and diagnostic
literal. It is derived only when an existing Legacy Evidence has zero
EvidenceArtifactBindings in the relevant read or Snapshot scope. It is not
persisted and is not a migration state, Knowledge State, `unknown`,
`independent`, ProvenanceStatement, relationship, Snapshot relationship, or
automatic provenance assertion; it is not part of Snapshot Canonical V1. If at
least one historical binding exists in that scope, `legacy_unbound` is not
returned. No latest, current, or winner binding is selected, and all historical
bindings remain visible.

> Migration may preserve historical uncertainty; it must never manufacture
> historical provenance.

## 6. Knowledge State

The only V1 Knowledge State scope is `upstream_provenance`.

The subject of a V1 KnowledgeStateStatement is exactly one ArtifactVersion.

The closed V1 states are:

- `unrecorded`: no documented state of knowledge exists in the declared scope;
- `unknown`: the scope was explicitly considered and provenance could not be
  determined;
- `partial`: provenance is partly documented and the recorded state is
  expressly incomplete;
- `known`: concrete provenance is documented in the scope.

`known` does not mean complete real-world provenance. `unknown` does not mean
independent. `unrecorded` and `unknown` are distinct. `partial` has no numeric
meaning. No state creates or implies independence.

Only `unknown`, `partial`, and `known` may be persisted in a
KnowledgeStateStatement. `unrecorded` must not be persisted. It is derived
exclusively when the defined read or snapshot scope contains no applicable
KnowledgeStateStatement for the ArtifactVersion and `upstream_provenance`.
Persisting `unrecorded` would contradict its meaning because that persisted row
would itself be a documented state of knowledge. No latest or winner resolution
is implied when multiple historical KnowledgeStateStatements are visible.

A `KnowledgeStateStatement` is itself attributed, historical, append-only, and
eligible only for same-family supersession.

### 6.1 Derived Unrecorded State in Snapshot Canonical V1

`DerivedUnrecordedStateV1` is a closed, read-derived Snapshot-Canonical value
with exactly these three required camelCase fields and no others:

```text
{
  artifactVersionId: <lowercase canonical ArtifactVersion UUID>,
  scope: "upstream_provenance",
  state: "unrecorded"
}
```

No field is nullable or optional. In particular, the value has no
`observedAt`, `createdAt`, `validFrom`, or `validTo`: it is not a persisted
Statement and asserts no separate observation, persistence, or real-world
validity time. `scope` and `state` are serialized explicitly rather than being
implied by the array name.

The exact subject domain is the set of ArtifactVersions represented by an
ArtifactVersion typed Snapshot Membership with role `root` or `included` in
the finalized Snapshot in-memory model. No Source, SourceVersion, Statement,
Evidence, other entity family, or ArtifactVersion outside that Membership set
is eligible.

For each ArtifactVersion in that subject domain, inspect only the
KnowledgeStateStatements included in the same finalized Snapshot model whose
`subjectArtifactVersionId` equals that ArtifactVersion and whose `scope` is
`upstream_provenance`. If that set is empty, derive exactly one
`DerivedUnrecordedStateV1` for the ArtifactVersion. If it contains at least one
Statement, derive none. Multiple historical `unknown`, `partial`, or `known`
Statements may coexist and the existence of any one of them is sufficient to
prevent derivation. The rule performs no latest, current, winner,
Supersession, or fachliche-priority resolution. Live database rows outside the
finalized Snapshot model cannot affect this derivation.

Within `derivedUnrecordedStates`, `artifactVersionId` is the unique semantic
key. At most one entry per ArtifactVersion is valid and exact duplicates are
forbidden. Entries are sorted by lowercase canonical `artifactVersionId` in
ascending ASCII-lexicographic order. The complete total-order key is
`(canonicalArtifactVersionId)` and is independent of SQL row, discovery,
traversal-encounter, or insertion order.

Every entry and the enclosing Snapshot object are canonicalized under
`jcs-rfc8785` / `1`. `derivedUnrecordedStates` is a required Snapshot-Canonical
field; when the derived set is empty its value is exactly `[]`, never omitted.

This derived value is not a database entity, Statement family, Membership
family, relationship, or Allow-Matrix entry. It has no Foundation,
Supersession, or independent `createdAt`. It means only that the finalized
Snapshot model contains no applicable KnowledgeStateStatement for that
included ArtifactVersion and `upstream_provenance`. It does not mean
`unknown`, `partial`, `known`, conflicting, `legacy_unbound`, independent, no
real-world provenance, no dependency, low evidence, current state, Truth, or
completeness.

Examples are normative applications of that rule:

- If the Snapshot contains ArtifactVersion A and no applicable
  KnowledgeStateStatement, the array contains exactly A's `unrecorded` entry.
- If the Snapshot contains A and an `unknown` Statement for A and
  `upstream_provenance`, the array contains no entry for A.
- If the Snapshot contains A with `partial` and B with no applicable Statement,
  the array contains only B's entry.
- If the Snapshot contains historical `unknown` and `known` Statements for A,
  the array contains no entry for A and derives no current or winner State.

## 7. Conflict

Conflict is not a Knowledge State. Multiple upstream parents are not
automatically conflicting. A future Conflict diagnosis could exist only where a
closed, newly versioned diagnostic-catalog rule proves that documented
statements cannot semantically hold at the same time. V1 defines no such
positive rule.

Conflict in V1 is exclusively a deterministic read or graph diagnostic
category. Because its V1 catalog has no positive code or rule, no V1 input
produces a Conflict diagnosis. Semantically incompatible statements and
explicit dispute still produce no Conflict under V1. Conflict is not a
Knowledge State, provenance relationship, additional allow matrix, or
persisted universal statement relationship.

The diagnosis does not change, delete, supersede, hide, prioritize, or assign
truth to any statement. RCV-016 selects no winner, assigns no score, and
performs no automatic resolution.

The V1 conflict diagnostic catalog has ID
`factbase-provenance-conflict-diagnostics`, version `1`, and exactly zero
diagnostic codes: `[]`. Consequently `conflictDiagnostics` is always `[]` in
V1. Multiple upstream parents, multiple authors, publishers or hosts,
historically different Knowledge States, and supersession never create a V1
Conflict. If no closed rule proves incompatibility, no Conflict is diagnosed.
A future positive rule requires a new catalog version. Cycle diagnosis remains
separate.

### Cycle Diagnostic Catalog V1

The closed build-time Cycle catalog has ID
`factbase-provenance-cycle-diagnostics`, version `1`, and exactly one code:
`artifact_provenance_cycle_detected`. No additional code is valid under catalog
V1. Cycle is not Conflict.

Its only inputs are statements using the seven V1 ArtifactVersion-to-
ArtifactVersion content-provenance relationships. Its payload contains exactly
`code`, `artifactVersionIds`, and `statementIds`. `artifactVersionIds` is the
closed directed path with its first node repeated as its last node;
`statementIds` contains exactly one ArtifactProvenanceStatement ID for each
directed edge, in path order.

For canonical rotation, enumerate every rotation of that directed edge
sequence, close each rotated node path, encode the pair `artifactVersionIds`
and `statementIds` with RFC-8785/JCS, and select the ascending ASCII-
lexicographically smallest bytes. Direction is retained; reversing the path is
not equivalent unless it independently describes the same directed cycle via
the documented statements. The diagnostic identity key is SHA-256 over the
RFC-8785/JCS payload containing exactly `code`, `artifactVersionIds`, and
`statementIds`; JCS determines object-member order. Exact duplicate identity
keys are invalid. Multiple diagnostics sort by catalog-code ordinal and then
diagnostic identity key, ascending ASCII lexicographically.

## 8. Temporal semantics

- `created_at` is the server-controlled immutable time at which FactBase
  persistently created the record. It makes no claim about observation or
  real-world validity.
- `observed_at` is the time at which the documented condition was observed or
  established.
- `valid_from` and `valid_to` are the asserted real-world validity interval of
  a time-dependent statement.

In the V1 statement union, only the `part_of`, `controlled_by`, and `operated_by`
members of `SourceRelationshipStatement` are time-interval-capable. Their
canonical objects use `validFrom` and `validTo`, each a canonical timestamp or
JSON null. For only these three relationships, null `validFrom` means that the
beginning of the asserted validity is unknown, and null `validTo` means that
the end of the asserted validity is unknown; null `validTo` does not mean
currently active. If both bounds are set, `validFrom <= validTo`.

For `alias_of`, `successor_of`, every ArtifactProvenanceStatement, every
ArtifactSourceAttribution, EvidenceArtifactBinding, and KnowledgeStateStatement,
`validFrom` and `validTo` must both be JSON null. For these non-time-interval-
capable discriminants, null means only **not applicable: no real-world validity
interval assertion**. It does not mean unknown start, unknown end, currently
active, beginning of time, or forever. The Statement-family and relationship
discriminants therefore determine the sole meaning of the two null fields.

Rules:

1. The unknown-beginning and unknown-end meanings apply only to `part_of`,
   `controlled_by`, and `operated_by`, as discriminated above.
2. The not-applicable meaning applies to every other closed V1 Statement type,
   as discriminated above.
3. `observed_at` need not fall within an asserted validity interval.
4. `created_at` may be later than `observed_at` and later than the asserted
   validity interval.

## 9. Initiator, foundation, and rationale

`initiator` identifies the person or defined process that caused the statement
to be recorded in FactBase. It is not the actor in the documented real-world
event. Trusted initiator fields are set or validated server-side and are never
accepted as untrusted client attribution.

The closed statement field is JSON null or an object containing exactly `type`
and `id`. `type` is one of the existing FactBase initiator literals `human`,
`system`, `importer`, or `agent`; `id` is a non-empty string or JSON null.

`rationale` is the human-readable explanation for the statement. `foundation`
is the structured documented basis of the statement when one is available.
Rationale alone is not structured proof of origin.

In every closed Statement object, `rationale` is a non-empty string or JSON
null and `foundation` is a Foundation V1 object or JSON null.

Neither initiator nor foundation makes a statement objectively true.

## 10. Supersession

`supersedes_statement_id` means that the new statement was recorded as a later
correction or replacement of the referenced statement. It does not:

- delete the older row;
- repair or mutate the older statement;
- hide the older statement;
- automatically make the new statement true;
- automatically resolve a conflict.

Only same-family supersession is allowed. Self-supersession, cross-family
supersession, and references to nonexistent statements are invalid. The older
statement remains fully readable. No supersession is inferred merely because
a newer statement exists.

## 11. Append-only contract

The closed logical list of historical RCV-016 contract objects is:

- `Source`;
- `SourceVersion`;
- `Artifact`;
- `ArtifactVersion`;
- `ArtifactProvenanceStatement`;
- `SourceRelationshipStatement`;
- `ArtifactSourceAttribution`;
- `EvidenceArtifactBinding`;
- `KnowledgeStateStatement`;
- `ProvenanceSnapshot`;
- `ProvenanceSnapshotMembership`.

A `ProvenanceSnapshotMembership` is an independent historical contract object
and a closed discriminated union. Every member has a typed
`provenanceSnapshotId`, literal `targetType`, one target-specific typed ID, and
`membershipRole`:

- `ArtifactVersion` uses `artifactVersionId` and permits `root` or `included`;
- `SourceVersion` uses `sourceVersionId` and permits only `included`;
- `ArtifactProvenanceStatement` uses `artifactProvenanceStatementId` and
  permits only `included`;
- `SourceRelationshipStatement` uses `sourceRelationshipStatementId` and
  permits only `included`;
- `ArtifactSourceAttribution` uses `artifactSourceAttributionId` and permits
  only `included`;
- `EvidenceArtifactBinding` uses `evidenceArtifactBindingId` and permits only
  `included`;
- `KnowledgeStateStatement` uses `knowledgeStateStatementId` and permits only
  `included`.

There is no generic `contractObjectType` plus `contractObjectId` form and no
polymorphic Universal-Membership edge. Membership is immutable and append-only,
and it must not be updated or deleted after Snapshot finalization.

The canonical Membership-key projection excludes the enclosing
`provenanceSnapshotId` and consists of exactly these seven closed object
variants, with no additional fields:

- `{ targetType: "ArtifactVersion", membershipRole: "root" | "included",
  artifactVersionId: <lowercase canonical UUID> }`;
- `{ targetType: "SourceVersion", membershipRole: "included",
  sourceVersionId: <lowercase canonical UUID> }`;
- `{ targetType: "ArtifactProvenanceStatement", membershipRole: "included",
  artifactProvenanceStatementId: <lowercase canonical UUID> }`;
- `{ targetType: "SourceRelationshipStatement", membershipRole: "included",
  sourceRelationshipStatementId: <lowercase canonical UUID> }`;
- `{ targetType: "ArtifactSourceAttribution", membershipRole: "included",
  artifactSourceAttributionId: <lowercase canonical UUID> }`;
- `{ targetType: "EvidenceArtifactBinding", membershipRole: "included",
  evidenceArtifactBindingId: <lowercase canonical UUID> }`;
- `{ targetType: "KnowledgeStateStatement", membershipRole: "included",
  knowledgeStateStatementId: <lowercase canonical UUID> }`.

Each key is canonicalized with RFC-8785/JCS. Category order is exactly:
`ArtifactVersion`, `SourceVersion`, `ArtifactProvenanceStatement`,
`SourceRelationshipStatement`, `ArtifactSourceAttribution`,
`EvidenceArtifactBinding`, `KnowledgeStateStatement`. Within ArtifactVersion,
role order is `root` before `included`, followed by the lowercase canonical UUID
in ascending ASCII-lexicographic order. Every other category sorts by its
lowercase canonical UUID in ascending ASCII-lexicographic order. The complete
total-order key is `(categoryRank, roleRank-if-applicable, canonicalId)`. No two
different Membership keys may share a total-order key, and exact key duplicates
are invalid. Snapshot Canonical contains the key objects in exactly this order;
physical SQL row order has no meaning.

The future implementation must protect the corresponding explicitly named
RCV-016 tables at both the application-service boundary and PostgreSQL contract
boundary. Normal operation allows INSERT and rejects UPDATE and DELETE. This is
scoped to the closed RCV-016 historical table list; it is not a global policy
for every FactBase table.

Append-only means that the historical record is retained. It does not mean that
the recorded statement is true.

Threat boundary: RCV-016 does not claim physical immutability against a database
superuser, storage manipulation, backup restore, compromised infrastructure, or
other actors outside the application and PostgreSQL contract boundaries.

## 12. ProvenanceSnapshot

RCV-016 introduces an independent immutable `ProvenanceSnapshot`. It
deterministically binds, as applicable to its declared scope:

- root ArtifactVersions;
- included ArtifactVersions;
- relevant SourceVersions;
- ArtifactSourceAttributions;
- ArtifactProvenanceStatements;
- SourceRelationshipStatements;
- EvidenceArtifactBindings when included by scope;
- KnowledgeStateStatements;
- deterministic diagnostics;
- Snapshot Schema identity;
- Traversal Policy identity;
- Builder identity;
- canonical bytes;
- SHA-256 hash.

The fixed V1 identities are:

- Snapshot Schema: `factbase-provenance-snapshot` / `1`;
- Snapshot Builder: `factbase-provenance-snapshot-builder` / `1`;
- canonicalization: `jcs-rfc8785` / `1`;
- hash algorithm: `sha-256`.

The loaded Builder artifact hash is bound separately. Schema identity describes
the structure and semantics; Builder identity and artifact hash identify the
concrete loaded construction implementation. A structural or semantic Snapshot
change requires a new Snapshot Schema version. A semantics-relevant Builder
change requires at least a new Builder artifact hash.

The snapshot must retain the identities of the statements from which graph
representations are produced. It must not collapse attributed statements into
unattributed edges.

> A complete Provenance Snapshot is complete only under its declared root set,
> traversal policy and recorded knowledge state; it does not claim complete
> knowledge of real-world provenance.

Historical reads retain persisted canonical bytes. Technical corruption,
reference mismatch, cycle, conflict, and limit diagnostics do not repair or
reinterpret those bytes and do not become provenance statements.

## 13. Traversal Policy V1

Every V1 snapshot names an explicit versioned Traversal Policy. The policy must
use schema `factbase-provenance-traversal-policy` version `1` and contain
exactly:

- `policyId`;
- `policyVersion`;
- `maxRoots`;
- `maxNodes`;
- `maxEdges`;
- `maxDepth`;
- `maxCanonicalSnapshotBytes`;
- `allowedRelationships`;
- `deterministicOrdering`;
- `visitedSemantics`;
- `definitionCanonical`;
- `definitionHash`.

Content-provenance traversal direction is downstream to upstream. Limits are
semantic contract inputs identified by policy ID and version; operative
wall-clock timeouts and available RAM do not define the semantic boundary.

The only V1 deterministic-ordering value is
`schema_category_then_canonical_key_lexicographic_v1`. Snapshot arrays first
follow their closed Snapshot Schema category order. Within an ID-only category,
canonical lowercase UUID strings are sorted in ascending ASCII lexicographic
order. Statement-backed relationships are sorted by canonical subject type,
canonical subject ID, relationship string, canonical object type, canonical
object ID, and statement ID, each ascending ASCII lexicographically. Diagnostics
are sorted by their schema-defined diagnostic-code order and then by their
canonical diagnostic identity key. No locale-sensitive comparison is allowed.

The only V1 visited-semantics value is
`expand_node_once_include_statement_once_diagnose_cycles_v1`. Each node is
expanded at most once, identified by its canonical node type and canonical ID.
Each included relationship statement is included at most once, identified by
its statement family and canonical statement ID. Encountering an already
visited node does not expand it again; the statement that reaches it remains
eligible for inclusion within the declared limits. A directed path back to a
node already on that traversal path produces a deterministic cycle diagnosis.

`maxRoots`, `maxNodes`, `maxEdges`, `maxDepth`, and
`maxCanonicalSnapshotBytes` must each be a finite positive safe integer
greater than zero. Zero, negative values, fractional values, `NaN`, infinity,
and unsafe integers are invalid. Because TypeScript types alone cannot enforce
that runtime value domain after casts or deserialization, every future runtime
boundary must validate all five values fail-closed before accepting or using a
V1 policy.

`allowedRelationships` contains exactly all seven ArtifactVersion-to-
ArtifactVersion content-provenance relationships, once each, in ascending ASCII
lexicographic order: `cites`, `derived_from`, `incorporates`, `quotes`,
`reposts`, `syndicated_from`, `uses_information_from`. A subset, duplicate,
additional relationship, or different order is invalid. Attribution, Source
relationships, and Evidence bindings are included only by the exact predicates
in Section 13.2 and are never used for content-upstream traversal.

### 13.1 Root domain and traversal depth

A V1 Snapshot Builder input contains at least one root ArtifactVersion ID.
Every supplied root ID must already be a lowercase canonical UUID and must
resolve to an ArtifactVersion in the complete in-memory Builder universe.
Duplicate root IDs are invalid input and are rejected; the Builder never
silently deduplicates them. `maxRoots` counts the supplied valid root IDs before
canonical ordering. The caller's root order has no semantic meaning.
`rootArtifactVersionIds` is the same duplicate-free set sorted by lowercase
canonical UUID in ascending ASCII lexicographic order.

Traversal depth is eligible directed content-provenance edge distance. Every
root has depth zero. The effective depth of an ArtifactVersion is the minimum
number of eligible downstream-to-upstream ArtifactProvenanceStatement edges on
any path from any root. It is therefore independent of root order, collection
order, statement discovery order, and which path is encountered first.

An ArtifactVersion whose effective depth is less than or equal to `maxDepth`
is in the reached ArtifactVersion set. A reached ArtifactVersion whose
effective depth is strictly less than `maxDepth` is expanded exactly once. A
node at exactly `maxDepth` is included but is not expanded. An otherwise
eligible statement leaving a node at `maxDepth`, its upstream object, and any
further path reached only through that statement are outside this Snapshot's
traversal scope; the crossing statement is not retained. This is a successful
bounded closure, not a limit failure and not a partial Snapshot.

The conceptual result is determined from minimum distances, not procedural
first discovery. An implementation may discover a shorter path after a longer
path only if it produces exactly the same reached set, expanded-subject set,
included ArtifactProvenanceStatement set, Membership, diagnostics, Canonical
bytes, and hash as the minimum-distance definition.

Cycle Diagnostics are produced only from the directed traversed subgraph: the
included ArtifactProvenanceStatements whose downstream subject has effective
depth strictly less than `maxDepth`. Edges outside that scope are neither
included nor diagnosed. `maxDepth` zero is an invalid V1 policy value and no
Snapshot can be built from it. For the sole root A in the graph A -> B -> C ->
A, valid `maxDepth` one or two does not include the complete cycle;
`maxDepth` three does and produces the V1 cycle diagnosis. Multiple roots can
place more subjects below the boundary; the same minimum-distance rule applies.

### 13.2 Exact Snapshot closure

The Builder input may contain valid objects outside one Snapshot's scope. Such
foreign or unreached objects are not members merely because they were supplied.
Starting with the final reached ArtifactVersion set defined in Section 13.1,
V1 computes these result sets without depending on iteration or discovery
order:

1. Include every eligible ArtifactProvenanceStatement whose downstream subject
   has effective depth strictly less than `maxDepth`. Its upstream object is
   reached at a depth no greater than `maxDepth`. Statement identity, not its
   endpoint pair, controls duplicate inclusion, so distinct historical
   statements remain distinct.
2. Include every ArtifactSourceAttribution whose subject ArtifactVersion is in
   the reached set. Include exactly every SourceVersion referenced by one or
   more of those included attributions. No other rule independently introduces
   a SourceVersion.
3. Let the represented Source identity set be the distinct `sourceId` values of
   the included SourceVersions. Include every SourceRelationshipStatement only
   when both its subject Source ID and object Source ID are in that represented
   set. Source relationships never recursively expand that set, never introduce
   another SourceVersion, and never form a second traversal closure.
4. Include every EvidenceArtifactBinding whose object ArtifactVersion is in the
   reached set. V1 has no separate Evidence-ID or binding-scope selector for
   Snapshot construction.
5. Include every KnowledgeStateStatement whose subject ArtifactVersion is in
   the reached set. V1 permits only scope `upstream_provenance`; every historical
   statement satisfying this predicate is retained without latest, current,
   winner, or Supersession reduction.

ArtifactVersion Membership role derivation is exact. Every supplied root
produces its `root` key. Every ArtifactVersion that is the upstream object of at
least one included ArtifactProvenanceStatement produces its `included` key. A
root reached as such an upstream object therefore has both distinct keys; they
are not collapsed. An ArtifactVersion produces at most one key per role.

The closed five-family rule is:

| Family | Inclusion predicate | Expands Artifact traversal | Expands Source closure | Historical multiplicity preserved | Can affect `derivedUnrecordedStates` |
| --- | --- | --- | --- | --- | --- |
| `ArtifactProvenanceStatement` | downstream subject depth is strictly less than `maxDepth` | yes, downstream to upstream | no | yes, by statement ID | no |
| `SourceRelationshipStatement` | both Source endpoints are represented by included SourceVersions | no | no | yes, by statement ID | no |
| `ArtifactSourceAttribution` | subject ArtifactVersion is reached | no | no | yes, by statement ID | no |
| `EvidenceArtifactBinding` | object ArtifactVersion is reached | no | no | yes, by statement ID | no |
| `KnowledgeStateStatement` | subject ArtifactVersion is reached and scope is `upstream_provenance` | no | no | yes, by statement ID | yes, by presence only |

The deterministic conceptual assembly order is: validate and sort roots;
compute minimum eligible-edge distances and the reached ArtifactVersion set;
derive the included ArtifactProvenanceStatements; derive attributions and their
SourceVersions; derive the local Source relationships; derive Evidence bindings
and Knowledge State statements; generate the seven typed Membership families;
derive `derivedUnrecordedStates` from the finalized Membership and its included
KnowledgeStateStatements; generate build-time diagnostics; and finally apply
the frozen category and total orders before Canonical assembly. This sequence
defines result sets, not observable procedural discovery order.

Objects required by an included result must resolve fail-closed in the complete
in-memory Builder universe. In particular, every root and every endpoint of an
included ArtifactProvenanceStatement must resolve to an ArtifactVersion, and
every included ArtifactSourceAttribution must resolve its referenced
SourceVersion. The `sourceId` already carried by each included SourceVersion is
the complete mapping needed to evaluate the local Source relationship
predicate; no Source object or eighth Membership family is introduced. Missing
references on supplied objects that remain outside the exact closure do not by
themselves make those objects members and do not affect the Snapshot.

`derivedUnrecordedStates` examines only KnowledgeStateStatements included by
the rule above and ArtifactVersion IDs present in finalized `root` or
`included` Membership. Supplied but unincluded or later live statements do not
affect it. Source relationships and Supersession do not select or alter the
derived result.

### 13.3 Limit counting and failure

`maxRoots` counts supplied valid root IDs; duplicates are invalid before any
count-based acceptance. `maxNodes` counts distinct reached ArtifactVersion IDs.
`maxEdges` counts included traversed ArtifactProvenanceStatements, each by its
statement ID; it does not count the four non-traversal statement families.
`maxDepth` supplies the successful bounded-closure rule in Section 13.1.
`maxCanonicalSnapshotBytes` counts the exact UTF-8 byte length of the fully
assembled RFC-8785/JCS Snapshot Canonical.

Exceeding `maxRoots`, `maxNodes`, `maxEdges`, or
`maxCanonicalSnapshotBytes` rejects the entire build with a technical traversal
or payload-limit error. The Builder does not truncate a result and returns no
successful partial Snapshot. Reaching the `maxDepth` boundary does not reject;
it excludes expansion and edges beyond that declared scope exactly as Section
13.1 defines. None of these outcomes implies `unknown`, `partial`,
`unrecorded`, Conflict, independence, truth, or real-world completeness.

One `(policyId, policyVersion)` pair binds exactly one definition hash.
Different concrete limits require a different policy version or identity. V1
sets no production limit numbers. A concrete versioned deployment or
environment policy instance is required before Snapshot use and does not alter
the Core Contract semantics.

If any contract limit is exceeded, no partial snapshot may be persisted or
reported as complete. A technical limit diagnosis is not a Knowledge State or
provenance assertion.

## 14. RCV-015 boundary

RCV-016 does not change `factbase-derivation-input/1`, any historical RCV-015
canonical bytes, or any historical RCV-015 hash. It performs no silent V1
extension and introduces no derivation input V2.

A future derivation that consumes provenance:

1. must never read live provenance as its historical input;
2. must bind one concrete immutable ProvenanceSnapshot;
3. must use an explicitly new input and rule schema version introduced by a
   later RCV.

## 15. Excluded semantics

RCV-016 does not define or calculate:

- truth score or degree of proof;
- credibility or trustworthiness score;
- source-quality ranking;
- evidence weighting;
- majority vote;
- winner or preferred statement;
- factual conflict resolution;
- automatic independence;
- automatic identity or provenance based on metadata or content similarity.

One hundred copies, reposts, syndicated publications, Sources, accounts, or
domains never automatically mean one hundred independent confirmations.

## 16. Mandatory future implementation gate: Attack 25

Implementation of RCV-016 is not complete until the central allow matrix is
enforced independently at both boundaries:

1. service runtime;
2. PostgreSQL.

The mandatory test gate requires:

- one positive test for every allow-matrix row;
- negative cross-type tests;
- rejection of an unknown relationship type;
- rejection after a compile-time bypass or runtime cast;
- rejection of a direct illegal SQL INSERT;
- a parity proof between the service and PostgreSQL allow matrices;
- no public untyped universal-edge API;
- rejection of a future relationship such as `fact_checked_by` under V1;
- append-only UPDATE and DELETE negative tests for every protected table;
- same-family supersession positive tests;
- self-supersession negative tests;
- cross-family supersession negative tests;
- nonexistent supersession-reference negative tests.

Default deny applies even when TypeScript types have been bypassed. Database
acceptance must not depend on the service having validated the tuple first.

## 17. SourceVersion Metadata Schema V1

The closed metadata schema has ID `factbase-source-version-metadata`, version
`1`, canonicalization `jcs-rfc8785` / `1`, and hash algorithm `sha-256`.

Its top-level object contains exactly `schema`, `displayName`, and
`observedLocators`. `schema` contains exactly `id` and `version`.
`displayName` is a non-empty string or JSON `null`. `observedLocators` is an
array. At least a non-null `displayName` or one Locator is required. Nullable
fields remain present as JSON `null` and are never omitted.

Each Locator contains exactly `kind`, `value`, and `namespace`. `kind` is
exactly one of `homepage_url`, `profile_url`, `handle`, or
`external_identifier`. `value` is a non-empty string. `homepage_url` and
`profile_url` require `namespace` to be JSON `null`; `handle` and
`external_identifier` require a non-empty namespace string. URL values must be
absolute URLs but are retained exactly as observed.

Locators are sorted by kind, namespace, and value using ascending ASCII
lexicographic comparison; JSON `null` sorts before strings. Exact duplicate
tuples are invalid. No URL normalization, case folding, Unicode normalization,
or trimming changes canonical data.

The schema contains no `sourceKind`, arbitrary metadata object, or
organization/account relationship fields. Names, URLs, domains, handles,
external identifiers, and Metadata do not prove Source identity, provenance,
Trust, Credibility, Quality, or Independence.

## 18. ArtifactVersion Capture Schema V1

The closed capture schema has ID `factbase-artifact-version-capture`, version
`1`, canonicalization `jcs-rfc8785` / `1`, and hash algorithm `sha-256`.

Its top-level object contains exactly `schema`, `locator`, `mediaType`, `title`,
`publishedAt`, `observedAt`, `retrievedAt`, and `representation`. Nullable
members remain present as JSON `null`. `locator`, `mediaType`, and `title` are
non-empty strings or null. A non-null Media Type is lowercase ASCII and has no
free parameters. `publishedAt` and `retrievedAt` are canonical timestamps or
null; `observedAt` is required. Timestamps use UTC ISO-8601 with exactly six
fractional digits.

`representation` is exactly one of:

- `captured_bytes`: `hashAlgorithm` is `sha-256`, `contentHash` is 64 lowercase
  hexadecimal characters, and `retrievedAt` is required;
- `metadata_only`: `hashAlgorithm` and `contentHash` are JSON `null`, and
  `retrievedAt` is nullable.

Capture Canonical is RFC-8785/JCS over that closed envelope; Capture Hash binds
the envelope. `contentHash` binds only the defined captured bytes.
`metadata_only` expressly claims no byte capture. URL, title, and hash never
establish Artifact or ArtifactVersion identity and never establish provenance
direction.

## 19. Foundation Schema V1

Foundation is optional. If present, it uses schema
`factbase-provenance-foundation` / `1` and contains exactly `schema` and a
non-empty `items` array. Items form a closed discriminated union:

1. `evidence_reference` requires one lowercase UUID `evidenceId`;
2. `artifact_version_reference` requires one lowercase UUID
   `artifactVersionId`;
3. `imported_assertion` requires `referenceType` equal to `import_run` or
   `external_record` and a non-empty `reference`;
4. `deterministic_method` requires non-empty `methodId`, non-empty
   `methodVersion`, and a non-empty `inputReferences` array. Each input is
   exactly an Evidence ID, ArtifactVersion ID, or ProvenanceSnapshot ID.

Foundation ordering is a total ascending ASCII-lexicographic order over these
variant-specific keys:

- `evidence_reference`: (`kind`, `evidenceId`);
- `artifact_version_reference`: (`kind`, `artifactVersionId`);
- `imported_assertion`: (`kind`, `referenceType`, `reference`);
- `deterministic_method`: (`kind`, `methodId`, `methodVersion`, complete
  canonicalized `inputReferences`).

Each deterministic-method input uses (`referenceType`, `referenceId`) as its
total key. Inputs are first sorted by that key and exact duplicates are
rejected; the RFC-8785/JCS representation of the complete sorted input array is
the Foundation-item key's final tie-breaker. Exact duplicate Foundation items
are invalid. No two semantically different items may share a sort key. Every
referenced internal ID must exist with the declared type. `manual_review` is
not a Foundation type. Manual action belongs to Initiator/method context and
does not create a structured basis by itself.

No Foundation kind proves Truth, Trust, Quality, Independence, factual
correctness, authenticity, completeness, or correct interpretation. Rationale
is human-readable explanation and never substitutes for structured Foundation.

## 20. Snapshot Canonical Identity V1

The following list is closed and is the sole normative field language for the
Snapshot content Canonical object. It contains exactly these serialized
camelCase top-level fields:

1. `snapshotSchemaId`;
2. `snapshotSchemaVersion`;
3. `builderId`;
4. `builderVersion`;
5. `builderArtifactHash`;
6. `canonicalizationId`;
7. `canonicalizationVersion`;
8. `hashAlgorithm`;
9. `policyId`;
10. `policyVersion`;
11. `definitionHash`;
12. `maxRoots`;
13. `maxNodes`;
14. `maxEdges`;
15. `maxDepth`;
16. `maxCanonicalSnapshotBytes`;
17. `allowedRelationships`;
18. `deterministicOrdering`;
19. `visitedSemantics`;
20. `rootArtifactVersionIds`;
21. `artifactVersions`;
22. `sourceVersions`;
23. `artifactProvenanceStatements`;
24. `sourceRelationshipStatements`;
25. `artifactSourceAttributions`;
26. `evidenceArtifactBindings`;
27. `knowledgeStateStatements`;
28. `derivedUnrecordedStates`;
29. `buildTimeCycleDiagnostics`;
30. `conflictDiagnostics`;
31. `membershipKeys`.

`policyId`, `policyVersion`, and `definitionHash` bind the Traversal Policy
identity. Its five concrete limit values are serialized directly as `maxRoots`,
`maxNodes`, `maxEdges`, `maxDepth`, and `maxCanonicalSnapshotBytes`; there is no
Traversal-limits container or alternative field group. `allowedRelationships`
is exactly the duplicate-free ASCII-lexicographically sorted array of all seven
V1 content-provenance relationship literals. `deterministicOrdering` is exactly
`schema_category_then_canonical_key_lexicographic_v1`, and `visitedSemantics`
is exactly
`expand_node_once_include_statement_once_diagnose_cycles_v1`.

The five Statement arrays are disjoint. Each serializes exactly its closed
object member from `Rcv016ProvenanceStatementV1`, including relationship or
state, typed references, `observedAt`, `validFrom`, `validTo`, Initiator,
Rationale, Foundation, same-family Supersession, and Statement `createdAt`.
There is no additional umbrella `statements` array and no Statement is
serialized a second time through a specialist category.

Each SourceVersion canonical member contains exactly `sourceVersionId`,
`sourceId`, `versionNumber`, `metadataSchemaIdentity`, `metadataCanonical`,
`metadataHash`, `observedAt`, and its own historical `createdAt`.

Each ArtifactVersion canonical member contains exactly `artifactVersionId`,
`artifactId`, `versionNumber`, `captureSchemaId`, `captureSchemaVersion`,
`captureCanonical`, `captureHash`, and its own historical `createdAt`.
`publishedAt`, `observedAt`, and `retrievedAt` are represented exclusively
inside the validated `factbase-artifact-version-capture` / `1`
`captureCanonical` envelope and are not serialized again as independent
ArtifactVersion Snapshot fields. The Snapshot Builder obtains their semantics
only from that validated envelope. Future relational columns may support
navigation or validation but must not become a second canonical source of
truth. Representation kind and content-hash semantics likewise remain bound
inside `captureCanonical`; the ArtifactVersion's own `createdAt` remains
outside the Capture envelope and is included in Snapshot Canonical.

It excludes exactly the following non-content concepts. These labels are not
serialized fields of the Snapshot Canonical object:

1. `snapshotId`;
2. `snapshotPersistenceCreatedAt`;
3. `databaseTransactionIds`;
4. `lockInformation`;
5. `physicalTableAndIndexNames`;
6. `sqlRowOrder`;
7. `queryPlans`;
8. `connectionAndSessionData`;
9. `readTimeSnapshotCorruptionDiagnostics`.

The `created_at` values of included historical Versions and Statements remain
included because they are part of those records. Excluding Snapshot identity
and persistence time ensures that identical documented provenance under the
same Policy has the same content hash regardless of when or how it is stored.

## 21. Membership-to-Canonical Parity V1

One finalized, deeply immutable in-memory Snapshot model is the sole source of
construction truth. It produces the exact seven canonical Membership-key
variants, sorts them by the total order defined in section 11, and embeds those
objects in the RFC-8785/JCS Snapshot Canonical. Snapshot SHA-256 and typed
Membership inserts are produced from that same finalized model.

Read verification must preserve and inspect persisted Canonical bytes, verify
syntax, RFC-8785/JCS, and SHA-256, and extract the canonical Membership-key
objects. Typed relational Membership is projected to exactly the same seven
closed key variants and canonically sorted. The normalized sets are compared
exactly and independently of physical SQL row order. A difference produces the
neutral Integrity diagnostic `snapshot_membership_mismatch`. Reads perform no
repair, Canonical rewrite, or Membership rewrite.

V1 has no `membership_manifest_hash`. The Snapshot hash already binds the full
canonical Membership keys, and typed reconstruction is compared directly with
those hashed keys. A second hash would create an additional drift surface
without binding additional semantics.

## 22. Payload Limits Schema V1

The versioned limits schema family is
`factbase-provenance-payload-limits` / `1`. Before any governed write, a
concrete versioned Limits instance is required. V1 defines no numeric production
values.

The closed instance contains exactly:

- `limitsId`, `limitsVersion`;
- `sourceMetadataCanonicalBytes`, `sourceLocatorCount`;
- `displayNameCodepoints`, `displayNameUtf8Bytes`;
- `locatorStringCodepoints`, `locatorStringUtf8Bytes`;
- `artifactCaptureCanonicalBytes`;
- `artifactLocatorCodepoints`, `artifactLocatorUtf8Bytes`;
- `mediaTypeCodepoints`, `mediaTypeUtf8Bytes`;
- `titleCodepoints`, `titleUtf8Bytes`;
- `rationaleCodepoints`, `rationaleUtf8Bytes`;
- `foundationCanonicalBytes`, `foundationItemCount`,
  `foundationInputReferenceCount`;
- `foundationReferenceCodepoints`, `foundationReferenceUtf8Bytes`;
- `definitionCanonical`, `definitionHash`.

Every numeric field is a finite positive safe integer greater than zero. Zero,
negative, fractional, `NaN`, infinite, and unsafe values are invalid. One
`(limitsId, limitsVersion)` pair binds exactly one `definitionHash`. No concrete
production value is defined by this Core Contract. Snapshot
`maxCanonicalSnapshotBytes` remains exclusively a Traversal Policy limit and is
not duplicated in the PayloadLimits instance.

`definitionCanonical` is RFC-8785/JCS over `limitsId`, `limitsVersion`, and all
twenty numeric limit fields in the closed field set above; it excludes
`definitionCanonical` and `definitionHash` themselves. `definitionHash` is the
SHA-256 hash of those canonical UTF-8 bytes.

Validation performs an input preflight and then checks the actual canonical
UTF-8 byte length. Oversize is a technical error. Historical values are never
truncated, partially persisted, converted to a Knowledge State, or interpreted
as Conflict or missing provenance.

## 23. Version Creation Rules V1

Every change to canonical Source Metadata creates a new SourceVersion. This
includes display-name change and Locator addition, removal, kind, value, or
namespace change. An identical canonical reobservation does not require a new
SourceVersion. V1 does not mix a separate observation-event semantic into
SourceVersion.

The machine contract names these change dimensions, not schema fields:
`displayNameChange` maps to `displayName`; `locatorAdditionOrRemoval` maps to
`observedLocators`; and `locatorKindChange`, `locatorValueChange`, and
`locatorNamespaceChange` map respectively to `observedLocators.kind`,
`observedLocators.value`, and `observedLocators.namespace`.

Every new concrete capture event creates a new ArtifactVersion under an
explicitly chosen Artifact identity. This includes new observations or changes
to locator, Media Type, title, publication, observation or retrieval time,
representation kind, content hash, or captured bytes. None of those facts
automatically creates a new Artifact identity. Existing Versions are never
mutated.

The ArtifactVersion change dimensions are `concreteCaptureEvent`,
`locatorChange`, `mediaTypeChange`, `titleChange`, `publicationTimeChange`,
`observationTimeChange`, `retrievalTimeChange`, `representationKindChange`,
`contentHashChange`, and `capturedBytesChange`. They map respectively to the
`newConcreteCaptureEvent` event; the camelCase paths `locator`, `mediaType`,
`title`, `publishedAt`, `observedAt`, `retrievedAt`, `representation.kind`, and
`representation.contentHash`; and the `capturedBytesChanged` capture-input event
bound into the envelope through `representation.hashAlgorithm` and
`representation.contentHash`. It is an event dimension, not a fictitious
Capture-envelope field.

## 24. Availability and Diagnostic Separation V1

Availability is not part of RCV-016 V1. No availability or current-status field
is defined. A later-unreachable original changes no historical SourceVersion,
ArtifactVersion, or Statement. A future append-only AvailabilityObservation
model requires a new Contract or RCV.

The closed diagnostic categories are `conflict`, `cycle`, `integrity`, `limit`,
and `legacy_binding`. Their meanings do not overlap:

- cycle is not Conflict;
- limit is not `unknown`;
- Integrity is not conflicting provenance;
- `legacy_unbound` is not a Knowledge State;
- `legacy_unbound` is read-derived only and not persisted;
- a missing KnowledgeStateStatement is not `unknown`;
- absence of an applicable KnowledgeStateStatement deterministically yields
  `unrecorded` in the defined scope.

Read-time Integrity diagnostics about damaged persisted Snapshot data are not
part of the original Snapshot Canonical. Build-time graph diagnostics are part
of Snapshot Canonical under the closed Snapshot Schema.

## 25. Implementation boundary

This contract defines semantics only. RCV-016 feature services, controllers,
routes, migrations, database changes, persistence schemas, and executable test
suites are outside this contract-file creation step and must be introduced only
after a separate review and authorization.
