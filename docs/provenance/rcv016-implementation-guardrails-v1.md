# RCV-016 Implementation and Verification Guardrails, Version 1

## 1. Status, scope, and precedence

This document contains **implementation and verification guardrails** for
RCV-016. It is not a new domain contract and defines no new RCV-016 domain
semantics.

The frozen contract artifacts remain authoritative:

- [RCV-016 Evidence Provenance & Source Independence Contract V1](./rcv016-evidence-provenance-contract-v1.md);
- [RCV-016 TypeScript contract V1](../../src/contracts/rcv016ProvenanceContractV1.ts).

The approved physical PostgreSQL boundary is implemented by:

- [RCV-016 additive migration](../../migrations/rcv016_add_evidence_provenance.sql).

RCV-015 is referenced only as an unchanged boundary:

- [RCV-015 Reproducibility Contract V1](../derivations/rcv015-reproducibility-contract-v1.md);
- `factbase-derivation-input` / `1` remains unchanged.

If this document conflicts with either frozen RCV-016 contract artifact, the
contract artifact prevails. The migration is evidence of the approved physical
enforcement boundary; it does not redefine contract semantics. Every guardrail
below is traceable either to existing frozen semantics or to pure technical
infrastructure. A guardrail change must not silently extend the contract.

## 2. Enforcement-layer principle

### 2.1 Builder and Write Verifier

The Builder and Write Verifier own:

- complete validation of the closed typed model;
- RFC-8785/JCS generation;
- validation of internal Payload Limits;
- complete Foundation semantics and typed-reference validation;
- Snapshot Canonical construction and deterministic ordering;
- Canonical Membership parity before persistence;
- `derivedUnrecordedStates` construction;
- closed build-time diagnostics;
- finalization of the deeply immutable in-memory Snapshot model; and
- the prohibition on live re-query changing that model after finalization.

### 2.2 PostgreSQL

PostgreSQL owns:

- exact persistence of application-supplied Canonical `TEXT`;
- the UTF8 installation precondition;
- SHA-256 binding over the UTF8 bytes of stored Canonical `TEXT`;
- typed foreign keys and closed relational literals;
- the complete 17-row allow matrix and default deny;
- temporal discriminants, alias direction, and same-family Supersession;
- relational Policy and Payload Limits identity/value binding;
- seven typed Membership tables and duplicate-key rejection;
- append-only enforcement and `NO ACTION` historical foreign keys; and
- normal transaction atomicity for Snapshot header and Membership inserts.

PostgreSQL is **not** a normative RFC-8785/JCS engine. Database acceptance of
Canonical `TEXT` is not proof of complete Contract validity.

### 2.3 Read Verifier

The Read Verifier owns:

- unchanged historical Canonical `TEXT` reads;
- SHA-256 recomputation over its UTF8 bytes;
- full RFC-8785/JCS and closed-schema verification;
- reconstruction and exact comparison of Canonical and relational Membership;
- reproduction of `derivedUnrecordedStates` from the finalized Snapshot scope;
- complete Foundation, Policy, Payload Limits, Conflict, and Cycle verification;
- neutral corruption detection; and
- the prohibition on repair, rewrite, silent normalization, or winner selection.

## 3. Guardrail 1: Snapshot Invariant Registry

In the registry, `N/A – intentionally not enforced at this layer` means that
the layer has no enforcement responsibility for that invariant. It does not
weaken the invariant. Section references are to the frozen Markdown contract;
`T:` names the corresponding TypeScript contract declaration or constant.

| ID | Short description | Contract source | Builder / Write responsibility | PostgreSQL responsibility | Read-Verifier responsibility | Positive test class | Negative / adversarial test class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SI-01 | Snapshot Canonical uses the frozen Schema, Builder, canonicalization, and hash identities. | §§12, 20; T: `Rcv016ProvenanceSnapshotCanonicalV1`, `Rcv016SnapshotBuilderIdentityV1` | Emit exactly the frozen literals and the loaded Builder artifact hash. | Enforce separately stored V1 identity literals and hash formats. | Verify every identity and reject unsupported versions. | Builder-identity golden Snapshot. | Wrong schema, Builder, canonicalization, algorithm, or artifact hash. |
| SI-02 | Canonical bytes are RFC-8785/JCS under Builder and Read-Verifier authority. | §§12, 20, 21; T: `RCV016_CANONICALIZATION_ID`, `RCV016_CANONICALIZATION_VERSION` | Generate JCS bytes from the closed model. | N/A – intentionally not enforced at this layer. Store exact `TEXT`; do not claim full JCS. | Verify full RFC-8785/JCS byte equality. | Official JCS vectors and canonical Snapshot. | Non-JCS JSON with matching stored hash; U+0000 and Unicode edge cases. |
| SI-03 | Snapshot hash binds exactly the Canonical UTF8 bytes. | §§12, 20, 21; T: `RCV016_HASH_ALGORITHM` | Hash the generated UTF8 bytes with SHA-256. | Recompute SHA-256 over stored `TEXT` converted to UTF8. | Recompute and compare without reserialization. | Known Canonical bytes and fixed hash. | Changed text or hash; JSON reserialization in the hash path. |
| SI-04 | `snapshotId` and Snapshot persistence `createdAt` are outside Canonical identity. | §20; T: `RCV016_SNAPSHOT_CANONICAL_EXCLUDED_NON_CONTENT_V1` | Never serialize either field into Snapshot Canonical. | Store header identity/time separately. | Reject either field inside Canonical; do not include them in hash reconstruction. | Two persistence records with identical content bytes. | Canonical containing `snapshotId` or persistence time. |
| SI-05 | Included historical Version and Statement `createdAt` values remain Canonical. | §§2, 8, 20; T: Snapshot Version and Statement canonical field declarations | Serialize required historical `createdAt` values exactly. | Persist server-controlled historical `created_at`. | Verify required presence and persisted-value parity. | Snapshot with all historical timestamps. | Omitted, changed, or substituted observation/validity time. |
| SI-06 | Five Statement categories remain disjoint. | §§2, 20; T: `Rcv016ProvenanceStatementV1`, `Rcv016ProvenanceSnapshotCanonicalV1` | Place each closed Statement in exactly its family array. | Keep five typed Statement and Membership tables. | Validate disjoint arrays and reject double representation. | Snapshot containing all five families once. | Umbrella `statements`, wrong family array, or duplicate serialization. |
| SI-07 | ArtifactVersion Capture times have one Canonical representation. | §§18, 20; T: `Rcv016ArtifactVersionCaptureV1`, `Rcv016ArtifactVersionSnapshotCanonicalV1` | Bind `publishedAt`, `observedAt`, and `retrievedAt` only through `captureCanonical`. | Store no second relational Canonical source of truth for those values. | Reject outer duplicate Capture-time fields and validate the envelope. | Both Capture representations in Snapshot. | Extra outer Capture-time field or divergent duplicate value. |
| SI-08 | Exactly seven typed Snapshot Membership families exist. | §§11, 13.2, 21; T: `Rcv016ProvenanceSnapshotMembershipV1`, canonical-key union, `RCV016_SNAPSHOT_STATEMENT_CLOSURE_V1` | Derive exactly seven typed families from the finalized model. | Enforce seven separate typed Membership tables and foreign keys. | Read and project exactly those seven families. | One valid key in every family. | Generic type/ID pair, eighth family, or wrong typed target. |
| SI-09 | Membership Canonical Keys use the frozen total order. | §§11, 21; T: Membership category and role order constants | Sort by category, ArtifactVersion role, and canonical UUID as defined. | N/A – intentionally not enforced at this layer; SQL row order is irrelevant. | Normalize relational keys with the same total order before comparison. | Permuted discovery and SQL row orders yield identical bytes. | Wrong category/role/UUID ordering or duplicate key. |
| SI-10 | Canonical and relational Membership share one finalized construction source and are compared again on read. | §21; T: `RCV016_MEMBERSHIP_CONSTRUCTION_V1`, `RCV016_MEMBERSHIP_PARITY_DIAGNOSTIC_CODE` | Derive Canonical keys and intended inserts from the same finalized model and compare before write. | Persist header and typed rows atomically; N/A for parsing Canonical parity. | Reconstruct both sides and report `snapshot_membership_mismatch` on difference. | End-to-end valid Snapshot write/read. | Extra, missing, wrong-family, or wrong-role Membership. |
| SI-11 | `derivedUnrecordedStates` is required, closed, and read-derived. | §§6, 6.1, 20; T: `Rcv016DerivedUnrecordedStateV1` | Emit the required array, including `[]`, with exact entry shapes. | N/A – intentionally not enforced at this layer; no derived-state table or Canonical parsing. | Validate shape and reproduce the array. | Member without applicable Knowledge State. | Omitted/null array, extra field, wrong state/scope, or duplicate. |
| SI-12 | Its subject domain is the deduplicated set of ArtifactVersion Membership IDs. | §§6.1, 13.2; T: `RCV016_DERIVED_UNRECORDED_STATE_SEMANTICS_V1`, `RCV016_ARTIFACT_VERSION_MEMBERSHIP_DERIVATION_V1` | Deduplicate subject IDs while retaining distinct `root` and `included` Membership keys. | Preserve both valid Membership keys through the typed composite key. | Deduplicate IDs for reproduction without collapsing Membership keys. | Same ArtifactVersion as `root` and `included` yields at most one derived entry. | Two derived entries or collapse of the two Membership keys. |
| SI-13 | Only KnowledgeStateStatements in the same finalized Snapshot affect derived state. | §§6, 6.1, 13.2; T: derived-unrecorded semantics and Snapshot closure constants | Inspect only KnowledgeStateStatements included in the finalized model. | N/A – intentionally not enforced at this layer. | Use only the Snapshot's KnowledgeStateStatement Membership. | Included `unknown`, `partial`, or `known` suppresses derivation. | Live but non-member KnowledgeStateStatement changes the result. |
| SI-14 | Later live database changes never alter an existing Snapshot. | §§6.1, 12, 14, 21 | Stop all live re-query after finalization. | Preserve immutable rows; transaction machinery is technical only. | Verify persisted historical scope, never current live provenance. | Repeatable-read live-drift concurrency test. | Late insert changes bytes, Membership, diagnostics, derived state, or hash. |
| SI-15 | `conflictDiagnostics` is exactly `[]` in V1. | §7; T: conflict catalog constants and `Rcv016ConflictDiagnosticsV1` | Always emit `[]`; infer no Conflict from text or multiplicity. | N/A – intentionally not enforced at this layer. | Require `[]` for catalog V1. | Multiple parents, dispute text, and historical states still yield `[]`. | Positive code or free-text Conflict inference. |
| SI-16 | Cycle Diagnostics use only the closed V1 catalog and the bounded traversed subgraph. | §7 Cycle Diagnostic Catalog and §13.1; T: cycle catalog/code/payload declarations and `RCV016_TRAVERSAL_DEPTH_SEMANTICS_V1` | Build directed, rotation-normalized, deterministically sorted diagnostics only from traversed in-scope edges. | N/A – intentionally not enforced at this layer. | Recompute identity/order and validate the closed payload against the same bounded graph. | A→B→C→A inside the depth boundary with repeated discovery. | Unknown code, out-of-scope edge, reverse equivalence, malformed path, or duplicate identity. |
| SI-17 | Traversal Policy identity, definition hash, concrete values, and V1 limit interpretation remain bound. | §§13, 13.1–13.3, 20; T: `Rcv016TraversalPolicyV1` and traversal supporting-semantics constants | Validate the complete closed definition, apply the frozen root/depth/counting rules, and bind its values into Snapshot Canonical. | Enforce immutable relational values, hash binding, and Snapshot composite FK. | Verify definition Canonical, hash, relational values, Snapshot parity, and bounded-closure interpretation without latest fallback. | Exact reused Policy instance and depth-boundary fixture. | Same ID/version with changed limit, relation set, ordering, hash, depth convention, or counting domain. |
| SI-18 | Payload Limits are versioned and immutably bound. | §22; T: `Rcv016PayloadLimitsV1` | Validate all 20 limits and use the explicitly referenced instance. | Enforce immutable ID/version, relational ranges, and definition hash binding. | Verify closed definition and all governed payloads without latest fallback. | Boundary-minus-one and boundary writes under an explicit instance. | Boundary-plus-one, changed definition, or implicit current instance. |
| SI-19 | Snapshot header and typed Membership persist atomically. | §§12, 21; migration transaction boundary | Prepare one complete intended write and use one transaction. | Commit header and all Membership rows together or roll back together. | Treat missing/extra rows as corruption, never as a draft. | Full write and forced rollback. | Partial commit or draft/status interpretation. |
| SI-20 | Read-time Integrity diagnostics never modify original Canonical bytes or history. | §§12, 21, 24 | N/A – intentionally not enforced at this layer after persistence. | Append-only guards prevent ordinary rewrite/delete. | Report neutral diagnostics with no repair, rewrite, or normalization. | Valid read returns unchanged bytes. | Hash/Membership corruption followed by attempted auto-repair. |
| SI-21 | Append-only preserves history; it does not establish Truth. | §§1, 10, 11 | Corrections create new Versions or Statements. | Reject regular UPDATE/DELETE for all 19 RCV-016 tables. | Return historical rows without truth inference. | Correction inserts a new historical object and both remain visible. | UPDATE/DELETE correction or truth derived from preservation. |
| SI-22 | No automatic Truth, Trust, Quality, Independence, Weight, Ranking, or Winner semantics exist. | §§1, 7, 9, 15; T: excluded-semantics constants | Emit no such result or score. | N/A – intentionally not enforced at this layer beyond absence of schema objects. | Emit no such interpretation while verifying. | Neutral provenance/history result shape. | 100 copies/sources, `known`, no cycle, or common upstream produces a score/winner. |
| SI-23 | URL, hash, title, domain, and handle do not automatically determine identity. | §§1, 5, 15, 23 | Require explicit Source/Artifact identity decisions. | Do not impose identity UNIQUE constraints on these attributes. | Preserve explicit historical identities without merging. | Equal hashes/URLs under distinct explicit identities. | Automatic merge/split or inferred provenance from metadata similarity. |
| SI-24 | `unrecorded` is distinct from `unknown`. | §§1, 6, 6.1; T: public and persisted Knowledge State declarations | Persist only `unknown`, `partial`, or `known`; derive `unrecorded` only by the closed rule. | Reject `unrecorded` in KnowledgeStateStatement rows. | Distinguish persisted State from derived absence. | No Statement derives `unrecorded`; explicit `unknown` suppresses it. | Persisted `unrecorded` or conversion between the two. |
| SI-25 | `legacy_unbound` is read-derived Legacy Binding State, never Knowledge State. | §§3, 5, 24; T: Legacy Binding State declarations | Do not persist or migrate the value and do not bind heuristically. | N/A – intentionally not enforced at this layer beyond absence of a column/table/state literal. | Derive only from zero bindings in the relevant scope and show all historical bindings otherwise. | Legacy Evidence with zero or multiple bindings. | Persisted Legacy state, Knowledge State conversion, heuristic binding, or winner selection. |
| SI-26 | Supersession is not current or winner selection. | §§1, 10; T: same-family Supersession fields/constants | Validate same-family target and retain both Statements. | Enforce five self-FKs, target existence, and self/cross-family rejection. | Return full Supersession history without preference. | Valid chain with all Statements visible. | `isCurrent`, winner, hide-old, or cross-family Supersession. |
| SI-27 | Unknown dependency is not Independence. | §§1, 6, 15 | Do not infer Independence from missing or unknown provenance. | N/A – intentionally not enforced at this layer beyond closed literals. | Preserve neutral Knowledge State meaning. | `unknown` and missing dependency remain neutral. | Independence emitted from either case. |
| SI-28 | Multiple upstream Artifacts do not constitute Conflict. | §§1, 7 | Retain all allowed Statements and emit no V1 Conflict. | Permit multiple historical/parallel allowed Statements. | Return them with `conflictDiagnostics = []`. | Two legitimate parents. | Winner, priority, or Conflict inferred from multiplicity. |
| SI-29 | RCV-015 and `factbase-derivation-input` / `1` remain unchanged. | §§1, 3, 14; T: RCV-016 boundary constants | Build an independent ProvenanceSnapshot; do not inject it into RCV-015 input V1. | Apply additive RCV-016 objects only; no RCV-015 backfill or alteration. | Do not reinterpret historical RCV-015 bytes or hashes. | Schema/file non-regression and historical hash fixture. | Input V1 extension, silent V2, backfill, or hash reinterpretation. |

## 4. Guardrail 2: Finalized Snapshot Only

Every canonically derived Snapshot value is produced exclusively from one
finalized, deeply immutable in-memory Snapshot model. This includes:

- the root set and Traversal result;
- all Canonical arrays and their ordering;
- the seven Membership-key families;
- `derivedUnrecordedStates`;
- Cycle Diagnostics and the empty V1 Conflict Diagnostics; and
- the resulting Canonical bytes and hash.

After finalization, no live database query may change Canonical bytes,
Membership, derived states, diagnostics, or hash. The Read Verifier likewise
uses only the persisted historical objects and typed Membership bound to the
Snapshot when reproducing it. It must not supplement that scope with unscoped
live provenance.

This guardrail expresses Snapshot reproducibility, not real-world completeness.
The finalized model remains relative to its root set, Traversal Policy, and
recorded Knowledge State.

### 4.1 Concurrency consequences

- Snapshot graph loading and construction use a `REPEATABLE READ` transaction.
- Typed Foundation targets are checked race-free in the same write transaction.
- Row or advisory locks are technical implementation details only. They do not
  create validity, current, latest, winner, Truth, or Trust semantics.
- Provenance committed after the Snapshot read view was established is not
  retroactively included in that Snapshot. A later Snapshot may include it.
- A technical retry must rebuild or revalidate against one explicitly defined
  transaction view; it must not merge observations from different attempts
  into one finalized model.

Required Guardrail 2 tests include a late Provenance insert, a late
KnowledgeStateStatement insert, a Foundation target race, SQL/discovery-order
permutations, and reproduction using only the persisted Snapshot scope.

## 5. Guardrail 3: No Semantic Invention Traceability

Every semantically relevant application or database component must have
exactly one classification.

### 5.1 `CONTRACT-MAPPED`

The component record identifies:

- the Contract section and invariant implemented;
- accepted input semantics;
- produced output semantics; and
- allowed failure semantics.

Components requiring this classification include the SourceVersion metadata
validator, ArtifactVersion Capture validator, Foundation validator, Payload
validator, Traversal Builder, Snapshot Builder, Write Verifier, Read Verifier,
Membership projector, `derivedUnrecordedStates` Builder, Cycle Diagnostic
Builder, semantic repositories, and Snapshot persistence service.

### 5.2 `PURE TECHNICAL INFRASTRUCTURE`

The component record identifies its technical purpose and explains why it
creates no domain meaning. Typical examples are a database connection factory,
transaction wrapper, semantics-neutral retry mechanism, advisory/row-lock
helper, hash-byte utility, and migration runner.

`UNMAPPED SEMANTIC BEHAVIOR` is prohibited. Infrastructure becomes
`CONTRACT-MAPPED` if it starts selecting domain data, changing Canonical
content, interpreting history, or creating a domain-facing result.

## 6. Forbidden implementation shortcuts

Each of the following is a Guardrail violation:

- “latest row wins”;
- “highest version wins”;
- “a superseding Statement is current”;
- “the same URL means the same Artifact”;
- “the same hash means the same Artifact”;
- “a different Source means independent information”;
- “a missing dependency means independence”;
- “multiple Sources increase Truth”;
- “`known` means complete real-world provenance”;
- “`partial` is percentage completeness”;
- inferring Conflict Diagnostics from free text;
- persisting `legacy_unbound`;
- persisting `unrecorded`;
- changing Canonical content from a live read after Snapshot finalization;
- using an SQL parser or serializer as the normative JCS authority;
- repairing or rewriting corrupted Canonical data during read;
- treating database acceptance as proof of full Contract validity; or
- selecting a latest/current Policy, Payload Limits instance, binding, or
  Statement when the Contract requires an explicit version or full history.

## 7. Error-separation guardrail

The following are technical or application error categories, not RCV-016
domain states:

- `validation_error`;
- `canonicalization_error`;
- `payload_limit_error`;
- `relational_integrity_error`;
- `hash_integrity_error`;
- `snapshot_membership_mismatch`;
- `unsupported_contract_version`; and
- `database_failure`.

None may be translated into `unknown`, `partial`, `known`, `unrecorded`,
Conflict, or Independence unless a future explicit Contract version says so.
An Integrity diagnostic reports a verification condition; it does not alter
Knowledge State or assert conflicting provenance.

## 8. Write gate

Before any successful application persistence, the Write Verifier establishes
all of the following:

1. the typed input and Contract version are valid;
2. every applicable Payload Limit is satisfied without truncation;
3. Foundation is closed, ordered, duplicate-free, and valid;
4. typed Foundation targets exist race-free in the write transaction;
5. the finalized deeply immutable model exists;
6. RFC-8785/JCS Canonical bytes and SHA-256 have been produced;
7. intended relational Membership and Canonical Membership were derived from
   that same model and match exactly;
8. `derivedUnrecordedStates` was generated from the finalized Snapshot scope;
9. closed build-time diagnostics were generated; and
10. one transaction persists exactly that finalized header and Membership.

Failure of any gate prevents partial historical persistence. The gate does not
select a current, latest, preferred, or true historical object.

## 9. Read-verification guardrail

A verified historical read:

1. reads stored Canonical `TEXT` unchanged;
2. recomputes SHA-256 over its UTF8 bytes;
3. verifies RFC-8785/JCS;
4. validates the complete closed schema and Contract version;
5. reconstructs the seven typed relational Membership families;
6. compares normalized Canonical and relational Membership exactly;
7. reproduces `derivedUnrecordedStates` from the Snapshot-bound scope;
8. verifies Foundation and its typed targets;
9. verifies Policy and Payload Limits definitions and bindings;
10. verifies Conflict and Cycle Diagnostics; and
11. reports neutral Integrity diagnostics for any failure.

It never rewrites, repairs, silently normalizes, selects a winner, or hides an
older, superseded, disputed, or otherwise historically visible Statement.

## 10. PostgreSQL boundary

PostgreSQL must fail closed for:

- an illegal relationship/type tuple or unknown relationship;
- an invalid relational Knowledge State or scope;
- temporal-discriminant violations;
- reverse/self Alias violations;
- cross-family, self, or missing-target Supersession;
- typed foreign-key violations;
- duplicate Membership keys;
- a stored Canonical-text/hash mismatch;
- UPDATE or DELETE of append-only RCV-016 history;
- deletion of referenced historical targets through `NO ACTION`; and
- invalid relational Policy or Payload Limits identities and values.

PostgreSQL intentionally does not claim to detect:

- non-JCS Canonical `TEXT` accompanied by its matching hash;
- an internal Metadata, Capture, Foundation, or Snapshot Canonical schema error;
- a fifth Foundation variant encoded in opaque Canonical `TEXT`;
- Canonical-to-relational Membership mismatch;
- incorrect `derivedUnrecordedStates`; or
- malformed Canonical Cycle or Conflict Diagnostics.

The Builder and Write Verifier reject those errors on the normal write path.
The Read Verifier detects them on verified historical reads. Direct privileged
SQL inside the documented database threat boundary can therefore create bytes
that satisfy database checks without satisfying the complete Contract; such
database acceptance is never represented as full Contract verification.

## 11. Guardrail test requirements

- Every Snapshot Invariant Registry entry has at least one positive test and,
  where meaningful, one negative or adversarial test.
- Guardrail 2 has concurrency tests for the transaction read view, live drift,
  Foundation target existence, and order independence.
- Guardrail 3 has a traceability assertion for every application and database
  component capable of semantic behavior.
- Tests cover all 17 allow-matrix tuples, five Statement families, seven
  Membership families, four Foundation variants, twenty Payload Limit fields,
  and every closed diagnostic catalog.
- Coverage is measured by mapped and exercised V1 invariants, not by a
  percentage target.

## 12. Change control

A Guardrail-documentation change does not require Contract re-freeze when it
only improves references, adds tests, improves technical enforcement mapping,
or clarifies already frozen semantics without changing their meaning.

Explicit Contract change and version review are required before implementation
if a proposed change adds a domain state, changes identity or relationship
semantics, introduces current/latest/winner behavior, changes Canonical
content, changes Snapshot-derived meaning, or changes Knowledge State
semantics. Such a proposal must not be implemented merely by editing this
document.

## 13. Proposed project-wide traceability rule

No project-wide file is changed by this document. The following general rule
should later be placed in the repository's existing Architecture, Build Rule,
or Governance documentation after a separate review:

> Every semantic implementation component must map to an approved Contract
> rule, or be explicitly classified as pure technical infrastructure.

That future project-wide rule should define only traceability and review
mechanics. It must not copy or generalize RCV-016 domain semantics.

## 14. RCV-016 application implementation entry gate

Application implementation may begin only when all of the following are true:

- this Guardrail document exists and Guardrails 1–3 are complete;
- no new RCV-016 semantics were introduced by the Guardrails;
- the approved Integration Test Design maps one-to-one to the Registry;
- both frozen Contract files are unchanged;
- the physically verified migration is unchanged;
- RCV-015 and `factbase-derivation-input` / `1` are unchanged; and
- no Critical, High, or Medium Guardrail gap remains.

When all conditions hold, the gate output is:

```text
READY FOR RCV-016 APPLICATION LAYER TEST-FIRST
```

## 15. Adversarial interpretation checks

The following interpretations are expressly rejected by the existing Contract
and by these Guardrails:

1. “Finalized Snapshot only” means reproducibility within the declared scope,
   not real-world completeness.
2. “Verified read” means integrity and Contract conformance, not Truth.
3. Supersession never means current, winner, or preferred.
4. Policy use requires an explicit identity/version; it never means latest.
5. Row locking provides transaction safety and never domain validity.
6. Database acceptance never means complete Canonical or Contract validity.
7. Read-Verifier Integrity diagnostics never become Conflict Diagnostics.
8. Integrity mismatch never creates `unknown` or another Knowledge State.
9. Equal hashes never establish identity or provenance.
10. A retry may not merge read views or change a finalized Canonical result.
11. Foundation target existence does not establish Truth or correctness.
12. This Registry is subordinate to, and cannot override, the frozen Contract.
13. This document creates no relationship or Allow-Matrix entry.
14. Distinct `root` and `included` Membership keys are not collapsed; only the
    ArtifactVersion subject domain for derived-state calculation is
    deduplicated.
15. `unrecorded` remains read-derived and is never persisted.
16. `legacy_unbound` remains a read-derived Legacy Binding State, not a
    Knowledge State.
17. The V1 Conflict catalog remains empty.
18. RCV-015 input V1 and its historical Canonical/hash semantics remain
    unchanged.
