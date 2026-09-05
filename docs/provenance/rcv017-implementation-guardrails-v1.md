# RCV-017 Implementation Guardrails, Version 1

## Status, scope, and precedence

This document is normative for implementation conformance. It does not create
or change RCV-017 domain semantics.

The frozen domain contract remains authoritative:

- [RCV-017 Claim Evidence Dependency Analysis Contract V1](./rcv017-claim-evidence-dependency-contract-v1.md)
- [RCV-017 TypeScript Contract V1](../../src/contracts/rcv017ClaimEvidenceDependencyContractV1.ts)

These Guardrails constrain implementation ownership, persistence boundaries,
verification, and required evidence. Any conflict with the frozen Contract is
a defect in this document or an implementation defect. A Guardrail cannot add
a finding, Canonical field, relationship classification, state, score, current
selection, or other domain meaning.

RCV-016 and RCV-014 remain frozen and unchanged. RCV-017 implementations bind
RCV-016 historical objects without reinterpreting them and never consume
RCV-014 assessments as dependency-analysis input.

### Ownership notation

- **B** — ClaimEvidenceDependencyAnalysis Builder.
- **W** — Write-Verifier and authenticated finalized-result handoff.
- **DB** — PostgreSQL owns the complete listed physical invariant.
- **DB-PARTIAL** — PostgreSQL enforces only the relational or structural subset
  of a contract-mapped invariant. PostgreSQL does not own the full semantic
  invariant. `DB-PARTIAL` is reporting notation only.
- **R** — Read-Verifier.
- **—** — the layer intentionally does not own the invariant.

`DB-PARTIAL` is not an implementation classification. Every implementation
component still has exactly one classification: `CONTRACT-MAPPED` or
`PURE TECHNICAL INFRASTRUCTURE`.

## Guardrail 1: Analysis Invariant Registry

The Registry contains exactly AI-01 through AI-37. Every invariant requires at
least one positive conformance test where meaningful and at least one
meaningful adversarial or negative test where meaningful. Checkbox-only
completion and positive-path-only evidence are insufficient.

| ID | Normative invariant | B ownership | W ownership | PostgreSQL ownership | R ownership | Required positive evidence | Required adversarial/negative evidence |
|---|---|---|---|---|---|---|---|
| AI-01 | Closed schema and default-deny identities, enums, unions, and object fields. | Produce only the exact V1 closed model. | Reject unsupported or open finalized input. | CHECK exact relational literals and identities. | Reject unknown identity, field, enum, or finding. | Valid closed policy and analysis. | Extra key, fifth finding, unsupported version or identity. |
| AI-02 | Canonical UUID and hash primitives are exact. PostgreSQL UUID coercion does not satisfy textual Contract acceptance. | Validate lowercase canonical UUID text and lowercase 64-hex hashes without normalization. | Repeat full textual validation before DB handoff; never lowercase or trim. | Store typed UUID identity and enforce DB-visible lowercase hash format only; original UUID spelling is not owned by DB. | Validate every UUID string in Canonical and every hash independently. | Canonical lowercase UUID and exact SHA-256 text. | Uppercase, mixed-case, alternate spelling, padded UUID, uppercase or malformed hash. |
| AI-03 | Canonical text is exact RFC-8785/JCS. | Generate exact JCS. | Preserve exact Builder text; no serialization replacement. | Not an owner of JCS validity; store opaque TEXT. | Parse safely, recanonicalize, and require byte equality. | JCS with non-ASCII, escapes, numbers, and U+0000 representation. | Matching-hash non-JCS, whitespace, key order, or escaping drift. |
| AI-04 | SHA-256 binds the exact UTF-8 Canonical text. | Hash exact generated UTF-8 bytes. | Recompute over the supplied exact text. | Require stored hash to equal SHA-256 of stored TEXT UTF-8 bytes. | Independently recompute exact stored bytes. | Exact Canonical/hash round trip. | Altered bytes, hash, normalization, or newline. |
| AI-05 | `analysisId` and DB/server `createdAt` are persistence metadata outside Canonical. | Exclude both fields. | Allocate one valid analysis ID and never supply semantic created time. | Store exact analysis ID and server-controlled creation time. | Do not expect either inside Canonical or hash identity. | Different IDs/times leave Canonical unchanged. | Either field injected into Canonical or used for latest selection. |
| AI-06 | ClaimVersion and evidence-relation inputs are explicit, exact, non-empty, and historically bound. | Validate exact relation ID, Evidence ID, direction, ClaimVersion ownership, uniqueness, and binding coverage. | Preserve the finalized relation projection and verify locked targets. | Enforce typed rows, FKs, literal direction, uniqueness, and enforceable target parity. | Reconstruct exact input and verify Canonical/relational parity without live enrichment. | Multiple explicit relations including contextualizes. | Foreign relation, Evidence mismatch, duplicate relation, empty input, relation without binding. |
| AI-07 | Selected binding and branch identity is exactly relation ID plus binding statement ID. | Validate explicit bindings, Evidence/Artifact parity, Snapshot membership, global binding uniqueness, and branch uniqueness. | Preserve exact authenticated binding rows. | Enforce branch PK, global per-analysis binding uniqueness, FKs, and structural Snapshot membership. | Reconstruct branches and verify exact historical parity. | Same Evidence with multiple explicitly selected bindings. | Latest/first/winner binding, duplicate branch, foreign or mismatched binding. |
| AI-08 | Analysis binds one exact RCV-016 Snapshot ID and hash. | Build only from that finalized Snapshot. | Lock and verify exact ID/hash; no substitution. | FK Snapshot ID and use RCV-017-local exact-hash validation; do not change RCV-016. | Verify exact Snapshot contract, JCS, hash, and scope. | Exact Snapshot binding. | Wrong hash, missing ID, newer/current Snapshot substitution. |
| AI-09 | Analysis binds one exact Policy ID, version, and hash. | Apply the exact immutable definition. | Lock and verify exact composite identity. | Composite FK to immutable Policy ID/version/hash. | Verify exact policy Canonical, relational values, and hash. | P/v1 with P/v2 also present still uses P/v1. | Latest/default fallback, wrong version, hash drift. |
| AI-10 | Algorithm ID, version, and artifact hash are exact and supported. | Bind the exact implementation artifact. | Reject unsupported or malformed identity. | Enforce V1 ID/version literals and hash format; no registry required. | Default-deny unsupported implementation identity. | Supported algorithm artifact. | Unsupported version, altered artifact hash, implicit upgrade. |
| AI-11 | Supports and contradicts are separate; contextualizes is input-only and excluded from findings. | Partition directions exactly. | Preserve result without netting. | CHECK finding directions; allow contextualized input membership only. | Reject contextualized or cross-direction findings. | Separate supporting and contradicting fixtures. | Cross-direction, contextualized finding, ratio, majority, or balance. |
| AI-12 | Relationship catalog is exact: cites is reference-only; exactly six relationships are dependency-bearing. | Apply the immutable catalog and exact enabled subset. | Verify exact Policy binding. | CHECK six allowed enabled literals, uniqueness, non-empty set, and reject cites. | Reproduce using the exact catalog and Policy subset. | Each of six relationships enabled individually. | Cites enabled, unknown relationship, empty set, semantic reclassification. |
| AI-13 | Reflexive closure uses minimum-distance downstream-to-upstream traversal and an inclusive non-expanded depth boundary. | Own complete graph traversal and closure semantics. | Preserve finalized result; do not rerun traversal. | No SQL graph traversal; only structural FKs. | Reproduce closure and depth exclusively from the bound Snapshot. | Multiple paths, boundary node, and minimum-distance fixture. | First-discovery depth, reverse traversal, cites traversal, boundary expansion. |
| AI-14 | V1 has exactly four finding types and no generic payload family. | Emit only the four closed variants. | Reject any finalized projection with another family. | Four typed table families and exact type CHECKs; no generic JSON finding table. | Reconstruct and default-deny any fifth type. | All four finding variants. | Fifth, catch-all, unknown, score, or independence finding. |
| AI-15 | Shared-artifact finding identity and membership are exact. | Produce one `(direction, artifactVersionId)` finding with all eligible branches. | Preserve exact header/members. | Enforce natural identity, typed members, uniqueness, and aggregate member/anchor structure. | Reproduce anchors, directions, and complete member set. | Two or more branches sharing one anchor. | One member, wrong anchor, missing/extra member, contextualized member. |
| AI-16 | Common-upstream findings are upstream-centric, exact, and not merged into clusters. | Produce one finding per direction/upstream with all eligible members. | Preserve exact finding/member/witness projection. | Enforce natural identity, typed members, FKs, and member cardinality structurally. | Reproduce closure membership and overlapping findings. | Non-transitive overlapping upstream sets. | Connected-component merge, one member, foreign upstream, missing member. |
| AI-17 | Each common member has one normalized minimal witness; anchor witness is zero-edge and not a DependencyPath. | Prove path validity, shortest edge count, and ASCII statement-ID tie-break. | Preserve the authenticated witness exactly. | **DB-PARTIAL:** enforce rows, zero-based ordinals, FKs, uniqueness, adjacency/path shape where designed; do not prove shortest path, lexical tie-break, or semantic minimality. | Reproduce all paths needed to prove exact minimal witness and tie-break. | Shortest path, equal-length lexical tie, and anchor witness. | Wrong start/end, foreign edge, ordinal gap, repeated node, longer or wrong tied path. |
| AI-18 | Negative finding is one canonical unordered same-direction pair with differing anchors and disjoint reflexive closures. | Prove pair eligibility and closure disjointness. | Preserve exact canonical pair. | **DB-PARTIAL:** enforce pair identity, distinct selected branches, same finding direction, and textual UUID tuple ordering under deterministic C collation; do not prove closure disjointness. | Reproduce closures and prove the negative condition. | Two disjoint eligible branches. | Same branch, reversed pair, same anchor, intersecting closure, cross-direction pair. |
| AI-19 | Dependency-knowledge-incomplete findings use only bound-Snapshot unknown/partial statements and exact derived-unrecorded evidence; known does not cancel. | Derive full finding and exact evidence solely from finalized Snapshot Canonical. | Preserve authenticated finalized evidence and reject an inconsistent mirror without live reconstruction. | **DB-PARTIAL:** enforce typed child rows, structural references, and unknown/partial scope/state where relationally available; do not reproduce RCV-016 derived state. | Reproduce Snapshot `derivedUnrecordedStates`, validate all statement evidence, union, ordering, and full parity. | Unknown, partial, derived-unrecorded, and coexisting known fixtures. | Empty evidence, known-only evidence, foreign/live statement, foreign derived-unrecorded semantic membership. |
| AI-20 | All Canonical arrays use the explicit total order; caller and SQL row order are nonsemantic. | Sort using exact category, direction, branch, UUID, and witness rules. | Preserve exact bytes and rows. | Enforce only order-dependent structural checks explicitly assigned, such as negative pair text order; relational row order is nonsemantic. | Normalize relational rows by Contract rules and require Canonical order. | Input/SQL permutation matrix. | Discovery order or native UUID order changes Canonical/hash. |
| AI-21 | Exact duplicate inputs, branches, finding identities, members, set-valued evidence, and repeated witness nodes are rejected without silent deduplication. | Validate the complete duplicate matrix. | Preserve complete finalized multiplicity without deduplication. | Enforce PK/UNIQUE subsets and deferred structural duplicates. | Detect remaining Canonical and relational duplicates. | Legitimate same Evidence/Artifact across distinct branch identities. | Every forbidden duplicate class and silent collapse. |
| AI-22 | Seven exact positive-safe-integer limits use their frozen whole-analysis/per-branch domains; breach is whole-analysis failure. | Own semantic counting, traversal depth, findings, and exact Canonical bytes. | Recheck applicable input counts and exact Canonical byte size. | Persist exact positive-safe policy values and enforce only explicitly designed structural checks; not semantic traversal interpretation. | Reproduce all seven limit domains. | Boundary-valid fixtures for all limits. | Zero/unsafe limit, each overflow, truncation, partial success. |
| AI-23 | Dependency traversal is cycle-safe and cannot derive conflict or manipulation. | Expand once per branch at minimum distance and select simple witnesses. | Preserve finalized output without rerunning cycles. | No SQL graph engine or duplicated cycle diagnostic. | Reproduce cycle-safe results from the bound Snapshot only. | Dependency cycle with deterministic reachable findings. | Infinite expansion, repeated-node witness, cycle-to-conflict/manipulation inference. |
| AI-24 | Canonical is the complete semantic representation and relational rows are its exact typed projection. Neither overrides the other. | Produce Canonical and relational projection from one finalized model. | Verify authenticated same-model projection before atomic persistence. | **DB-PARTIAL:** store exact Canonical/hash and enforce typed relational/FK/uniqueness subsets; do not repair or prove all graph semantics. | Reconstruct every typed family and prove complete Canonical/relational semantic parity. | Exact round-trip of every input/finding/witness family. | Missing/extra/wrong row, Canonical drift, repair in either direction. |
| AI-25 | Every referenced historical target is exact and valid within the analysis write/read boundary. | Validate exact ClaimVersion, relation, Evidence, binding, ArtifactVersion, Snapshot, statements, and Policy. | Lock deterministic exact targets in one transaction. | Enforce NO ACTION FKs and exact structurally representable references. | Verify bound historical targets without latest/current inference. | Complete exact target fixture. | Missing target, identity mismatch, deletion race, URL/hash identity inference. |
| AI-26 | Historical multiplicity is retained; minimal witness selection is not current/best/winner selection. | Keep complete bound Snapshot history while selecting one deterministic witness. | Persist exact finalized result. | Permit legitimate historical multiplicity under distinct natural keys. | Verify all relevant historical statements remain inspectable. | Multiple paths, bindings, and supersession history. | Latest/winner reduction or hiding alternate history. |
| AI-27 | All fifteen planned RCV-017 tables are historical append-only. | Corrections produce new analysis/policy identities or versions. | Expose insert-only repository operations. | Reject normal UPDATE and DELETE on all fifteen tables. | Perform observational reads only. | Insert new correction while old history remains. | UPDATE/DELETE policy, analysis, finding, member, witness, or evidence row. |
| AI-28 | Analysis header, inputs, four finding families, members, witnesses, and knowledge evidence persist atomically. | Produce one complete finalized bundle. | Use one transaction and return success only after commit. | Commit all rows or roll back all rows, including deferred-validation failure. | Treat any missing/extra family as corruption, never draft state. | Complete write and readback. | Failure at every insert family and commit leaves no analysis rows. |
| AI-29 | Finalized Analysis Only: later live state cannot alter inputs, findings, witnesses, ordering, Canonical, or hash. | Finalize one immutable result from explicit inputs and Snapshot. | Accept only the authenticated result and never reopen discovery. | Persist supplied projection only; DB does not discover missing analysis content from live state. | Verify exact historical analysis without supplementing later rows. | Later Provenance, Binding, KnowledgeState, SourceRelationship, ArtifactVersion, and SourceVersion exclusion. | Repository/verifier live enrichment, refresh, recompute-in-place, latest selection. |
| AI-30 | No repair, rewrite, normalization, or recompute-and-store occurs on integrity failure. | Fail instead of manufacturing a result. | Fail without fallback or replacement write. | Append-only protections reject mutation. | Report neutral corruption and perform no writes. | Valid verification leaves bytes/rows unchanged. | Hash, Canonical, finding, witness, Policy, or parity corruption triggers repair. |
| AI-31 | No deterministic graph-derived independence or not-independent conclusion exists. | Emit no such state, field, or finding. | Reject semantic expansion. | No schema column/table/literal for graph-derived independence. | Never interpret findings as independence. | Neutral structural findings. | Disjoint/known graphs produce independence, probability, confidence, or rank. |
| AI-32 | No score, confidence, weight, rank, truth, credibility, quality, trust, majority, winner, current, latest, effective, or best semantics exist. | Produce none. | Expose none and perform no fallback. | No corresponding schema/query selection. | Return neutral integrity/structure results only. | Closed result/API/schema audit. | Any prohibited field, aggregate, ORDER BY-latest, or semantic output. |
| AI-33 | RCV-014 assessments are excluded from Canonical, Policy, finding generation, persistence, and verification. | Do not load or use RCV-014 values. | Do not accept them in the bundle. | No FK/table/column or query dependency on RCV-014 assessments. | Do not weight or override findings with assessments. | RCV-014 data coexists without affecting output. | High/low assessment changes RCV-017 finding. |
| AI-34 | Source organizational relationships are display-only outside Canonical and never dependency edges. | Exclude SourceRelationshipStatements from analysis semantics. | Do not add contextual rows. | No Source context table or dependency query. | Do not load Source relationships to reproduce findings. | Source context present but output unchanged. | Controlled-by/part-of creates dependency or common upstream. |
| AI-35 | RCV-016 schema, Canonical, hash, Membership, derived state, diagnostics, and migration remain immutable. | Consume exact finalized Snapshot without modification. | Bind exact Snapshot ID/hash. | Add only RCV-017 objects; no RCV-016 DDL or derived-state table. | Verify existing RCV-016 contract independently. | Frozen hash/schema regression. | Any RCV-016 file, table, Snapshot byte, or meaning changes. |
| AI-36 | RCV-018 and RCV-020 boundaries are preserved: no general uncertainty/conflict resolution or manipulation/Sybil/deception semantics. | Emit only V1 dependency-structure findings. | Reject extra semantics. | No corresponding tables/literals. | Do not infer later-RCV meanings. | Neutral incomplete-knowledge and structural results. | Conflict winner, laundering, manipulation, intent, or deception finding. |
| AI-37 | Validation, unsupported-version, limit, and integrity-parity failures remain technical non-domain failures. | Throw technical failure; emit no partial analysis. | Preserve category/cause without domain mapping. | Return technical relational/database failures. | Report neutral technical/integrity diagnostics. | Each closed error category. | Error mapped to unknown, partial, conflict, contradiction, independence, confidence, or semantic success. |

### Test evidence rule

Each Registry row is incomplete until its positive and meaningful negative
evidence has executed. A static checkbox, type-only assertion, or happy-path
test cannot substitute for the adversarial evidence specified above.

### Canonical and relational parity is AI-24

There is no Guardrail 4. Canonical contains the complete semantic
representation. Relational tables are the typed integrity and query
projection. Neither silently overrides the other. A mismatch is neutral
integrity corruption.

Forbidden responses to mismatch include:

- rebuilding Canonical from rows;
- rebuilding rows from Canonical;
- selecting either representation as current;
- silently recalculating findings or witnesses; or
- repairing and persisting a replacement.

The Read-Verifier reports the mismatch without modification.

### Technical error boundary

The closed Phase-1 technical categories are:

- `validation_failure`;
- `unsupported_version`;
- `limit_failure`;
- `integrity_parity_failure`.

No technical failure becomes unknown, partial, conflict, contradiction,
independence, confidence, or semantic success. A limit or integrity failure
cannot return a partial-success analysis.

## Guardrail 2: Finalized Analysis Only

All persisted RCV-017 Canonical content and relational projections originate
solely from one authenticated finalized `ClaimEvidenceDependencyAnalysis`
result. This includes:

- `evidenceRelations`;
- `selectedBindings` and branch identities;
- all four finding families;
- finding members;
- normalized witnesses;
- knowledge evidence;
- deterministic ordering;
- exact Canonical bytes; and
- exact Canonical hash.

After finalization, no implementation layer may query later live state to
change those values. In particular, the repository and Read-Verifier must not
supplement the finalized analysis using later:

- ArtifactProvenanceStatements;
- EvidenceArtifactBindings;
- KnowledgeStateStatements;
- SourceRelationshipStatements;
- ArtifactVersions; or
- SourceVersions.

New information requires new explicit inputs and/or a new finalized RCV-016
ProvenanceSnapshot followed by a new RCV-017 analysis. Recompute-in-place,
refresh, repair, latest/current enrichment, and a retry against newer semantic
state are prohibited.

### Derived-unrecorded ownership

RCV-016 `derivedUnrecordedStates` is finalized Snapshot Canonical derived data.
It is not a standalone DB entity, RCV-016 Statement family, or relational
Membership table. RCV-017 must not add an RCV-016 derived-state table.

- **B** derives RCV-017 knowledge findings only from the exact finalized
  Snapshot and proves every derived-unrecorded ArtifactVersion reference.
- **W** preserves the authenticated finalized result, verifies exact Snapshot
  ID/hash, and rejects an inconsistent handoff without consulting live state.
- **DB-PARTIAL** stores structural ArtifactVersion references and enforceable
  analysis/Snapshot identities only. PostgreSQL does not own semantic
  membership in `derivedUnrecordedStates`.
- **R** loads and verifies the exact bound Snapshot, reproduces its exact
  `derivedUnrecordedStates`, and proves full RCV-017 Canonical/relational
  parity. A mismatch is neutral integrity corruption and is never repaired.

PostgreSQL must not parse Snapshot Canonical or reproduce the RCV-016
derivation.

### UUID acceptance and storage boundary

PostgreSQL UUID columns are technical relational identity storage. They do not
preserve or validate the caller's original spelling. Contract acceptance
occurs before PostgreSQL coercion.

Forbidden implementation behavior includes:

- lowercasing caller UUID text;
- trimming UUID input;
- accepting an alternate spelling and then normalizing it;
- relying on PostgreSQL UUID coercion as Contract validation; or
- claiming that PostgreSQL must reject uppercase textual UUID input.

Canonical JCS contains lowercase canonical UUID strings only. The Builder and
Write-Verifier validate before persistence; the Read-Verifier independently
validates Canonical strings.

When SQL must check Contract ASCII UUID ordering, it uses canonical textual
UUID representation under deterministic `C` collation, for example
`uuid_column::text COLLATE "C"`. Native PostgreSQL UUID comparison is not the
normative Canonical ordering boundary.

### No SQL semantic reconstruction

PostgreSQL must not become an RCV-017 graph-analysis engine. No SQL function,
trigger, query helper, or repository query may reproduce:

- RCV-016 `derivedUnrecordedStates`;
- dependency closure;
- minimum-distance discovery;
- common-upstream discovery;
- closure intersection;
- witness shortest-path calculation;
- witness lexical tie-breaking;
- complete finding generation;
- final Canonical ordering; or
- JCS canonicalization.

These are Builder and Read-Verifier semantics. SQL may enforce contract-mapped
relational integrity that requires no semantic graph reconstruction: typed
rows, FKs, uniqueness, ordinals, basic path shape, aggregate cardinality,
append-only behavior, exact text/hash binding, and transaction atomicity.

### Corrected physical Attack 24

Attack: a persisted RCV-017 derived-unrecorded evidence row references an
ArtifactVersion absent from the exact bound Snapshot
`derivedUnrecordedStates`.

Expected layered result:

1. A valid Builder result cannot contain this mismatch.
2. The authenticated Write-Verifier handoff rejects an inconsistent mirror.
3. Privileged raw SQL corruption may pass structural DB constraints when all
   relational FKs are valid.
4. PostgreSQL is not required to rederive RCV-016 state.
5. The Read-Verifier must detect exact semantic parity corruption.
6. No repair occurs.

This is intentional layered ownership, not a missing SQL constraint.

### Append-only history and atomicity

All fifteen planned RCV-017 tables are historical append-only. Normal
production interfaces expose no update or delete for Policy, Analysis,
finding, member, witness, or knowledge-evidence rows. Corrections create new
historical objects or Policy versions.

All historical FKs use `ON DELETE NO ACTION` and `ON UPDATE NO ACTION`; no
delete cascade exists. One transaction persists an Analysis header, exact
input Membership, four typed finding families, members, witnesses, and
knowledge evidence. Any failure rolls back the entire Analysis.

### Frozen migration conformance targets

The later migration must contain exactly these approved design targets:

| Object | Count |
|---|---:|
| Tables | 15 |
| Primary keys | 15 |
| Additional UNIQUE constraints | 3 |
| Foreign keys | 39 |
| CHECK constraints | 13 |
| Append-only triggers | 15 |
| Total triggers | 30 |
| Supporting functions | 3 |

If implementation proves a count impossible or wrong, work stops for explicit
architecture review. Migration code must not silently drift from this
inventory.

## Guardrail 3: No Semantic Invention Traceability

Every implementation component has exactly one classification.

### CONTRACT-MAPPED

The component record names its Contract rules, accepted inputs, outputs,
invariants, and allowed technical failures. Required examples are:

| Component | Classification |
|---|---|
| ClaimEvidenceDependencyAnalysis Builder | `CONTRACT-MAPPED` |
| DependencyAnalysisPolicy validator | `CONTRACT-MAPPED` |
| Finding generator | `CONTRACT-MAPPED` |
| Witness selector | `CONTRACT-MAPPED` |
| Write-Verifier | `CONTRACT-MAPPED` |
| Read-Verifier | `CONTRACT-MAPPED` |
| PostgreSQL repository semantic persistence boundary | `CONTRACT-MAPPED` |
| Typed relational projector | `CONTRACT-MAPPED` |

### PURE TECHNICAL INFRASTRUCTURE

The component record states its technical purpose and why it creates no domain
meaning. Required examples are:

| Component | Classification |
|---|---|
| Transaction wrapper | `PURE TECHNICAL INFRASTRUCTURE` |
| Deterministic lock ordering | `PURE TECHNICAL INFRASTRUCTURE` |
| SQL parameterization | `PURE TECHNICAL INFRASTRUCTURE` |
| Connection/pool handling | `PURE TECHNICAL INFRASTRUCTURE` |
| Zero-based witness ordinal storage | `PURE TECHNICAL INFRASTRUCTURE` |
| Exact hash-byte utility | `PURE TECHNICAL INFRASTRUCTURE` |
| Natural-FK/query helper | `PURE TECHNICAL INFRASTRUCTURE` |

A component that selects semantic input, changes Canonical, interprets graph
history, generates a finding, or creates a domain-facing result is
`CONTRACT-MAPPED` even if implemented inside infrastructure code. Any component
that cannot be classified exactly is an implementation-review failure.

### Permanent semantic-drift audit

Future implementation review statically searches RCV-017 production, schema,
SQL, and API surfaces for prohibited concepts:

- `independent`, `not_independent`, `independence_score`;
- confidence, weight, rank, truth, credibility, quality, or trust;
- majority, winner, current, latest, effective, or best;
- a generic finding JSON payload;
- SourceRelationship-driven informational dependency;
- RCV-014 assessment weighting;
- DB-side JCS;
- DB-side graph derivation; or
- persisted RCV-016 derived state.

Normative comments and tests may name a prohibited concept only to prove its
absence. Production behavior and schema remain free of it.

### North-Star gate

Implementation architecture is acceptable only where it improves:

- traceability;
- reproducibility;
- historical integrity; or
- transparent explanation of recorded dependency structure.

Complexity that protects no frozen invariant is rejected. Database acceptance
proves only its assigned physical subset; verified RCV-017 integrity never
means that a Claim is true, that evidence is credible, or that sources are
independent.

### Change control

These Guardrails may be clarified without Contract change only when the change
improves ownership wording, technical enforcement mapping, or test evidence
without altering a frozen field, finding, identity, relationship, ordering,
limit, or meaning.

Any proposed implementation that needs new domain meaning, a fourth finding,
RCV-016 mutation, RCV-014 input, SQL graph derivation, repair behavior, or
current/latest selection must stop before implementation for explicit Contract
or architecture review.
