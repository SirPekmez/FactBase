# FactBase Claim Historical Authority v1 — Implementation Design

Status: design-only; no migration, runtime implementation, or RCV-022 Contract is introduced by this document.

This Design implements the frozen **FactBase Claim Historical Authority v1 Contract**. The Contract remains authoritative. RCV-009 continues to own the upstream `claims` and `claim_versions` identities and schema; this Design adds the minimum immutable shadow authority needed by later historical consumers.

## 1. Design invariants

The physical design shall provide:

- one immutable identity authority for each authenticated Claim;
- one immutable semantic snapshot authority for each authenticated ClaimVersion;
- exact RFC 8785/JCS UTF-8 canonical bytes and lowercase hexadecimal SHA-256 hashes;
- source-row parity checks without treating mutable source rows as the historical snapshot;
- atomic source-row plus authority creation for newly authenticated rows;
- explicit unauthenticated treatment for pre-adoption rows;
- SELECT-only historical verification with no repair;
- no change to RCV-009, RCV-014, RCV-017, RCV-018, RCV-019, RCV-020, RCV-021, Scheduler, or Policy v1 semantics.

No field outside the frozen Contract's canonical schemas is semantic authority.

## 2. Existing schema reality

### `public.claims`

The RCV-009 migration creates:

| Column | Type | Nullability | Authority |
|---|---|---|---|
| `id` | `UUID` | `NOT NULL` | primary key |

There are no other columns, indexes, or RCV-009 triggers. The table has no delete/update cascade behavior. Existing service code inserts the row inside its own transaction and commits internally.

### `public.claim_versions`

The RCV-009 migration creates:

| Column | Type | Nullability |
|---|---|---|
| `id` | `UUID` | `NOT NULL` |
| `claim_id` | `UUID` | `NOT NULL` |
| `version_number` | `INTEGER` | `NOT NULL` |
| `title` | `TEXT` | `NOT NULL` |
| `normalized_statement` | `TEXT` | `NOT NULL` |
| `language` | `TEXT` | `NOT NULL` |
| `claim_type` | `TEXT` | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL` |
| `publication_status` | `TEXT` | `NOT NULL` |
| `change_reason` | `TEXT` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |

RCV-010 additionally adds nullable `based_on_version_id`, `actor_type`, `actor_id`, `source_type`, `source_reference`, and `request_id`, plus a self-FK for `based_on_version_id` and indexes on `based_on_version_id` and `request_id`.

The existing constraints are:

- primary key `id`;
- `claim_id -> claims(id)` with `ON DELETE NO ACTION ON UPDATE NO ACTION`;
- unique `(claim_id, version_number)`;
- `version_number > 0`;
- RCV-010 `based_on_version_id -> claim_versions(id)` with `NO ACTION`.

There are currently no immutable triggers. The application services are append-oriented, but that is not an independent historical guarantee. `createClaimWithInitialVersion` and `createClaimVersion` each own `BEGIN`/`COMMIT`; neither writes Claim Historical Authority rows.

## 3. Additive authority storage

The future migration shall add two shadow tables and shall not add semantic columns to the RCV-009 source tables.

### Claim authority

Table name: `claim_identity_authorities`.

One row authenticates one Claim identity. Exact columns:

| Column | Type | Nullability | Rule |
|---|---|---|---|
| `claim_id` | `UUID` | `NOT NULL` | primary key and source Claim identity |
| `canonical_version` | `INTEGER` | `NOT NULL` | check equals `1` |
| `canonical` | `TEXT` | `NOT NULL` | exact persisted JCS UTF-8 JSON text |
| `canonical_hash` | `TEXT` | `NOT NULL` | lowercase hexadecimal SHA-256; check `^[0-9a-f]{64}$` |

No `authority_created_at` is required. A wall-clock creation timestamp is not part of the Contract's semantic authority and must not be used for historical meaning. If operational audit metadata is later required, it is a separate non-canonical concern and requires its own authority decision.

Primary key: `claim_id`.

Foreign key: `claim_id -> public.claims(id)` with `ON DELETE NO ACTION ON UPDATE NO ACTION`.

Uniqueness: the primary key permits at most one v1 authority per Claim identity. No second row for the same Claim is an alternate authority.

Checks: `canonical_version = 1`; canonical text is present; hash is exactly 64 lowercase hexadecimal characters. JCS validity and hash parity are independently verified by the reader; PostgreSQL must not normalize the canonical text.

### ClaimVersion authority

Table name: `claim_version_authorities`.

One row authenticates one ClaimVersion identity and carries the immutable semantic snapshot needed without consulting mutable source content. Exact columns:

| Column | Type | Nullability | Rule |
|---|---|---|---|
| `claim_version_id` | `UUID` | `NOT NULL` | primary key and source ClaimVersion identity |
| `claim_id` | `UUID` | `NOT NULL` | parent Claim identity |
| `version_number` | `INTEGER` | `NOT NULL` | positive; matches source row |
| `title` | `TEXT` | `NOT NULL` | exact source string |
| `normalized_statement` | `TEXT` | `NOT NULL` | exact source string; not re-normalized |
| `language` | `TEXT` | `NOT NULL` | exact source string |
| `claim_type` | `TEXT` | `NOT NULL` | exact source string |
| `canonical_version` | `INTEGER` | `NOT NULL` | check equals `1` |
| `canonical` | `TEXT` | `NOT NULL` | exact persisted JCS UTF-8 JSON text |
| `canonical_hash` | `TEXT` | `NOT NULL` | lowercase hexadecimal SHA-256; check `^[0-9a-f]{64}$` |

The semantic fields are deliberately duplicated. Canonical bytes and their hash are the historical representation, while the duplicated fields permit direct source-parity checks and independent reconstruction without falling back to a current service representation.

Primary key: `claim_version_id`.

Foreign keys, all `ON DELETE NO ACTION ON UPDATE NO ACTION`:

1. `claim_version_id -> public.claim_versions(id)`;
2. `claim_id -> public.claims(id)`;
3. `claim_id -> claim_identity_authorities(claim_id)`.

The first two FKs enforce source existence. The third ensures a ClaimVersion authority cannot exist without an authenticated parent Claim. The relationship between the authority's `(claim_version_id, claim_id)` pair and the source row is also checked by the writer and verifier because RCV-009 does not expose a matching composite unique key.

Uniqueness: primary key for one authority per ClaimVersion identity, plus unique `(claim_id, version_number)` so two authorities cannot authenticate competing content for one logical version. `version_number > 0` is checked. `canonical_version = 1`, canonical presence, and lowercase 64-hex hash shape are checked.

An index on `claim_version_authorities(claim_id)` supports parent and Claim-scoped verification. Primary-key and unique indexes provide identity lookups; no current-pointer or high-water field is introduced.

## 4. Canonical bytes and hashing

Canonical bytes are persisted as exact UTF-8 JSON text in `canonical`. Persisting the bytes is required: reconstructing later from mutable source rows or current normalization rules would not prove the historical proposition. The hash is persisted separately as lowercase hexadecimal text so the exact Contract representation is visible to SQL readers and independent tooling.

The canonical objects are exactly:

```json
{"schema":"factbase-claim-identity-authority","canonicalVersion":1,"claimId":"<UUID>"}
```

```json
{"schema":"factbase-claim-version-authority","canonicalVersion":1,"claimId":"<UUID>","claimVersionId":"<UUID>","versionNumber":<positive integer>,"title":"<exact string>","normalizedStatement":"<exact string>","language":"<exact string>","claimType":"<exact string>"}
```

The object keys above are the complete key sets. No status, publication, change reason, timestamps, actor fields, source references, or future semantic fields enter either canonical object. `null` is not used in these v1 canonical objects because every included source field is `NOT NULL` in the actual schema.

Canonicalization is RFC 8785/JCS using the repository's existing `src/services/canonicalJson.ts` and its frozen `canonicalize` package version `2.1.0`. The implementation must not create a second canonicalizer, trim strings, case-fold, Unicode-normalize, or re-run a parser/model. SHA-256 is computed over the canonical UTF-8 bytes and rendered as lowercase hexadecimal.

## 5. Parity and immutability

Parity has three layers:

1. **Insertion-time:** within the same transaction, the writer reads the inserted source values and constructs the authority from those exact values. It refuses an identity or field mismatch and refuses to authenticate an existing source row without a corresponding authority creation operation.
2. **Database enforcement:** authority-to-source FKs prevent source deletion while authority exists. A database guard rejects UPDATE or DELETE of an authenticated source Claim/ClaimVersion. This guard is conditional for source rows so pre-adoption legacy rows remain identifiable and are not silently converted into authenticated history.
3. **Independent verification:** the reader selects both source and authority rows, checks identity and every semantic field, recomputes the canonical object from the immutable authority snapshot, and checks canonical bytes and hash. It never treats the source row as the historical substitute.

Authority rows themselves are unconditionally immutable. A reusable future guard function, `factbase_claim_authority_guard_immutable`, is attached to both authority tables and raises on UPDATE or DELETE. A second table-aware source guard, `factbase_claim_source_guard_authenticated`, is attached to `public.claims` and `public.claim_versions`; it rejects a mutation when a corresponding authority exists. The FKs remain the final deletion barrier and use NO ACTION, never CASCADE.

Claim has no mutable semantic fields, but its authenticated identity must not be deleted or changed. ClaimVersion's four authenticated semantic fields cannot be changed or deleted after authority binding. A revision is a new source ClaimVersion and a new authority row.

## 6. Atomic creation and existing service composability

New authenticated creation must be one caller-owned transaction:

**Initial Claim + ClaimVersion**

1. `BEGIN` in the caller-owned transaction.
2. Insert `public.claims`.
3. Construct and insert `claim_identity_authorities` from the inserted Claim id.
4. Insert the initial `public.claim_versions` row using the existing RCV-009 creation semantics.
5. Construct and insert `claim_version_authorities` from the returned exact source fields.
6. Verify source parity and canonical/hash parity before `COMMIT`.
7. `ROLLBACK` on every failure; no source or authority row may remain.

**ClaimVersion revision**

1. `BEGIN` in the caller-owned transaction.
2. Lock the Claim row using the existing revision serialization rule, then authenticate the parent Claim authority.
3. Read the current source version and enforce the existing `basedOnVersionNumber` rule.
4. Insert the next positive version using the existing source fields and metadata behavior.
5. Construct and insert its ClaimVersion authority in the same transaction.
6. Verify parity, then `COMMIT`; otherwise `ROLLBACK`.

The current `claimService.ts` and `claimVersionService.ts` commit internally and therefore cannot be called and followed by an authority insert while preserving atomicity. This is an implementation composability gap, not a Contract defect and not a reason to duplicate source semantics. Later implementation must expose transaction-neutral primitives or a caller-owned transaction callback and route both source creation and authority creation through that one path. Idempotent retry may authenticate an already identical authority; divergent authority for one identity fails closed.

## 7. Legacy and reauthorization

No marker column or silent backfill is added. A source Claim or ClaimVersion row with no corresponding authority row is `UNAUTHENTICATED_LEGACY` for historical purposes. Hashing its current values is not backfill and is not authentication. A consumer requiring this Contract fails closed when the required authority is absent; a verifier may report the explicit legacy state rather than mislabeling it as authenticated corruption.

Rows created by the new authenticated path are expected to have authority atomically. If that path observes a missing authority where one should have been created, it reports a missing-authority/atomicity failure rather than treating the row as legacy.

V1 does not pre-design a reauthorization table or event. A future explicit reauthorization requires a later Contract and authority identity capable of distinguishing the new authorization point; it cannot overwrite this one-per-identity row or assert retroactive authenticity. The new authority begins at the explicit reauthorization point only.

### Version progression

For newly authenticated revisions, the writer must create exactly the next positive `version_number` after the transactionally authenticated current version. A skipped number is not accepted as a newly authenticated sequence. Existing legacy gaps remain unauthenticated and are not repaired or filled. Every prior authenticated ClaimVersion remains permanently addressable; changing any of its four semantic fields creates a new ClaimVersion identity and authority rather than mutating the old row. Whether an upstream proposition should receive a different Claim identity remains an RCV-009 identity decision, not an inference made here.

## 8. Canonical module and writer APIs

Pure helpers reuse the existing canonical module:

- `buildClaimIdentityCanonical({ claimId })` returns the exact Claim object and `canonicalizeAndHash` result;
- `buildClaimVersionCanonical({ claimId, claimVersionId, versionNumber, title, normalizedStatement, language, claimType })` returns the exact ClaimVersion object and result.

They perform no database access, no normalization, and no current-state lookup.

The minimal future writer surface is transaction-neutral:

- `persistClaimIdentityAuthorityWithinTransaction(client, claimRow)`;
- `persistClaimVersionAuthorityWithinTransaction(client, claimVersionRow)`;
- higher-level creation callbacks that compose the existing Claim/ClaimVersion inserts with those primitives under one caller-owned transaction.

The writer verifies source identity, parent authority, canonical version, and exact hash; it does not authenticate legacy rows by reading and hashing them outside an explicit creation operation. Existing identical authority can be returned idempotently; any divergent duplicate is rejected.

## 9. Independent reader/verifier and SELECT-only operation

The reader is a separate repository/verifier. It may import only the pure canonical helpers, never writer or creation orchestration. For a Claim it selects the source id and Claim authority, checks the FK identity, reconstructs the exact identity object, and compares persisted canonical text and lowercase hash. For a ClaimVersion it selects the source row, authority row, and parent Claim authority; it checks all ids, version number, four semantic fields, parent relationship, canonical version, canonical text, and hash.

The reader does not use a current service response, current normalization code, mutable metadata, current model, or current source row as a substitute for the authority snapshot. It never INSERTs, UPDATEs, DELETEs, creates temp tables, normalizes persisted data, or acquires `FOR UPDATE`/`FOR SHARE` locks.

A dedicated verification role receives SELECT on `public.claims`, `public.claim_versions`, `claim_identity_authorities`, and `claim_version_authorities`, and no INSERT, UPDATE, DELETE, CREATE, or TEMP privilege. Valid authenticated rows pass under that role; legacy and corrupt rows fail closed without changing any table.

## 10. Failure taxonomy and deterministic precedence

The later implementation may map these concepts to repository error codes, but it must preserve this deterministic order and never use row order or locale-sensitive ordering:

1. `REPAIR_ATTEMPT` or `CURRENT_STATE_SUBSTITUTION` when verification is asked to write, normalize, or use current mutable semantics;
2. `UNAUTHENTICATED_LEGACY` when the source exists but required authority is absent in a historical lookup;
3. `MISSING_CLAIM_AUTHORITY` / `MISSING_CLAIMVERSION_AUTHORITY` when an authenticated-use operation requires the absent row;
4. `UNSUPPORTED_CANONICAL_VERSION`;
5. `MALFORMED_AUTHORITY`;
6. `CLAIM_IDENTITY_MISMATCH`;
7. `CLAIMVERSION_IDENTITY_MISMATCH`;
8. `PARENT_CLAIM_MISMATCH`;
9. `VERSION_NUMBER_MISMATCH`;
10. `SOURCE_PARITY_MISMATCH`;
11. `CANONICAL_MISMATCH`;
12. `HASH_MISMATCH`;
13. `DUPLICATE_AUTHORITY`;
14. `MUTATION_DETECTED`.

The reader evaluates one canonical identity path and then one ClaimVersion path; if several defects exist in one class, ties use canonical path UTF-8 byte order followed by immutable identity UTF-8 byte order. A duplicate identity is never resolved by “latest” or by current row order. The legacy state is not silently downgraded to a valid authority.

## 11. Corruption and physical-proof plan

The future implementation proof uses fresh disposable PostgreSQL and covers, independently and under the SELECT-only role:

- missing Claim authority and missing ClaimVersion authority;
- wrong Claim id, ClaimVersion id, parent id, or version number;
- wrong title, normalized statement, language, or claim type;
- unsupported canonical version;
- malformed canonical bytes;
- canonical text mismatch and wrong lowercase hash;
- wrong parent authority and cross-Claim authority;
- source-row mutation attempt, authority-row UPDATE/DELETE attempt, and duplicate authority attempt;
- pre-adoption legacy rows, with no silent backfill;
- source/authority disagreement and parent/source disagreement;
- before/after row snapshots proving no repair;
- valid authenticated rows surviving reconnect/restart and independent reader construction.

Each corruption fixture must fail closed, return the deterministic primary failure, and leave persisted bytes structurally unchanged. Insertion order and query order are varied where practical.

## 12. Future migration shape (design only)

The later migration is additive and contains:

- **2 tables:** `claim_identity_authorities`, `claim_version_authorities`;
- **4 foreign keys:** one Claim-authority-to-Claim FK; three ClaimVersion-authority FKs to its source ClaimVersion, source Claim, and parent Claim authority; all NO ACTION for DELETE and UPDATE;
- **2 primary keys:** `claim_id` and `claim_version_id`;
- **1 logical uniqueness constraint:** `(claim_id, version_number)` on ClaimVersion authority, in addition to its primary key;
- checks for canonical version `1`, positive version number, canonical presence, and lowercase 64-hex hash;
- **1 reusable immutable guard function** for authority rows and **1 source-authenticated guard function**;
- **4 triggers:** immutable guard on each authority table, authenticated-source guard on `public.claims`, and authenticated-source guard on `public.claim_versions`;
- an index on `claim_version_authorities(claim_id)`; primary-key and unique indexes are provided by PostgreSQL.

No source columns, source unique constraints, cascades, current pointer, high-water mark, or migration backfill is introduced. Exact SQL, trigger body, grants, and names are implementation work after this Design is approved.

## 13. Downstream binding and dependency impact

Future RCV-022 lookup binds a Claim by `(claimId, canonicalVersion, canonicalHash)` and a ClaimVersion by `(claimId, claimVersionId, canonicalVersion, canonicalHash)`. The ClaimVersion authority hash is the proposition-content authority. RCV-022 need not trust current source text after authority authentication, except that the independent verifier may check source parity.

RCV-014 remains optional assessment context and is unchanged. RCV-017's existing ClaimVersion-id bindings remain valid but do not substitute for this authority. RCV-018 retains assertion/comparison and contradiction authority. RCV-019 temporal state hashes do not authenticate Claim or ClaimVersion content. RCV-020 observation authority is unchanged. RCV-021 identity and lifecycle authority are unchanged. Scheduler and Policy v1 are unaffected. Regression proof later replays all existing migrations and focused suites with zero frozen-authority drift.

## 14. Implementation sequence

The smallest later sequence is:

1. **Wave A — physical authority migration:** add the two tables, constraints, FKs, indexes, guard functions, and triggers; prove legacy rows remain unauthenticated and no source authority is backfilled.
2. **Wave B — canonical core and transaction-neutral writer:** reuse `canonicalJson.ts`, add pure builders and composable source-plus-authority creation; prove atomicity, parity, idempotent identical retry, and divergent failure.
3. **Wave C — independent reader/verifier:** add SELECT-only verification, deterministic failures, no-repair, and current-state independence.
4. **Wave D — fresh PostgreSQL adversarial proof:** run corruption, mutation, restart, role, migration replay, and regression tests, then perform a separate test review and snapshot each completed scope.

No wave begins automatically from this Design. RCV-022 Contract drafting remains gated on physical Claim Historical Authority implementation, proof, review, and snapshot lock.

## 15. Design audit

Against the frozen Contract: **MISSING = 0; WEAKENED = 0; EXPANDED = 0; CONTRADICTORY = 0; AMBIGUOUS = 0; SEMANTIC INVENTION = 0; LEGACY AUTHENTICITY LEAKAGE = 0; CURRENT-STATE-SUBSTITUTION RISK = 0.**

The only identified implementation concern is the existing service-owned transaction boundary. It is explicitly classified as a composability gap for later implementation, not smuggled into the Contract or solved by a duplicate write path.

Open design-shaping questions: **0**.
