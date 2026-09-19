# FactBase Claim Historical Authority Contract V1

## 1. Purpose and scope

This Contract defines the minimum immutable historical authority required to
authenticate an RCV-009 Claim identity and an RCV-009 ClaimVersion semantic
content. It exists so a later consumer such as RCV-022 can prove exactly which
historical proposition version it analyzed.

This Contract does not redefine RCV-009 Claim semantics, add Claim fields, or
make a semantic-equivalence decision. RCV-009 remains the upstream owner of
the `public.claims` and `public.claim_versions` identities and source rows.
This Contract adds a separate historical-authentication boundary over those
identities and the specified ClaimVersion content.

The storage shape, table names, SQL types, indexes, triggers, migration order,
and repository APIs are implementation-design matters and are intentionally
not fixed here.

## 2. Normative authority identities

The upstream RCV-009 identities are:

- Claim identity: `claims.id`, a UUID;
- ClaimVersion identity: `claim_versions.id`, a UUID;
- ClaimVersion logical ordering identity: `(claim_id, version_number)`.

One V1 Claim Identity Authority object authenticates one Claim identity. One
V1 ClaimVersion Semantic Authority object authenticates one ClaimVersion
identity. Authority-object identity is distinct from canonical-content hash.
Equal canonical content does not merge distinct logical identities.

The Claim table has no semantic Claim fields in the RCV-009 schema. Claim V1
therefore has identity authority only. The ClaimVersion authority carries the
complete V1 proposition-content representation permitted by the existing
RCV-009 fields.

## 3. Claim Identity Authority

The Claim Identity Authority canonical schema is:

```text
schema: "factbase-claim-identity-authority"
canonicalVersion: 1
claimId: lowercase canonical UUID text
```

The exact canonical object has exactly these keys, with no additional or
omitted keys:

```json
{
  "schema": "factbase-claim-identity-authority",
  "canonicalVersion": 1,
  "claimId": "..."
}
```

All fields are required and non-null. `claimId` must equal the persisted
RCV-009 Claim identity exactly. This object authenticates identity and parent
binding only; it does not assert a semantic proposition.

## 4. ClaimVersion Semantic Authority

The ClaimVersion Semantic Authority canonical schema is:

```text
schema: "factbase-claim-version-authority"
canonicalVersion: 1
claimId: lowercase canonical UUID text
claimVersionId: lowercase canonical UUID text
versionNumber: positive persisted RCV-009 integer
title: exact persisted text
normalizedStatement: exact persisted text
language: exact persisted text
claimType: exact persisted text
```

The exact canonical object has exactly these keys, with no additional or
omitted keys:

```json
{
  "schema": "factbase-claim-version-authority",
  "canonicalVersion": 1,
  "claimId": "...",
  "claimVersionId": "...",
  "versionNumber": 1,
  "title": "...",
  "normalizedStatement": "...",
  "language": "...",
  "claimType": "..."
}
```

There are no nulls in this V1 canonical object because each included RCV-009
source field is required. `title`, `normalizedStatement`, `language`, and
`claimType` are copied exactly as persisted. The authority layer performs no
trimming, Unicode rewriting, case folding, parser normalization, or current
normalization.

The included fields are the complete V1 semantic representation. RCV-009
fields `status`, `publication_status`, `change_reason`,
`based_on_version_id`, `actor_type`, `actor_id`, `source_type`,
`source_reference`, `request_id`, and `created_at` are not ClaimVersion
proposition fields in this Contract. They remain upstream metadata and must
not affect RCV-022 semantic identity or interpretation. No subject, domain,
temporal, population, geographic, causal, or other structured Claim field is
introduced by this Contract.

## 5. Canonicalization and hashing

Both authority schemas use RFC 8785 JSON Canonicalization Scheme (JCS) over
UTF-8 bytes. Object ordering is the ordering defined by JCS; no database row
order, locale, collation, or insertion order is semantic.

The hash is SHA-256 over the exact canonical UTF-8 bytes and is represented as
lowercase hexadecimal. Canonical version `1` is the only supported V1 version.
Unknown versions, malformed canonical text, non-canonical text, and hash
mismatches fail closed. Canonical text and its hash are both persisted
authority; one cannot be regenerated as a repair substitute for the other.

## 6. Source-row parity

The Claim Identity Authority must satisfy:

```text
authority.claimId = RCV-009 claims.id
```

The ClaimVersion Semantic Authority must satisfy exact parity for all of:

```text
claimId
claimVersionId
versionNumber
title
normalizedStatement
language
claimType
```

The canonical-to-source mappings are exact:

```text
claimId           <- claim_versions.claim_id
claimVersionId    <- claim_versions.id
versionNumber     <- claim_versions.version_number
title             <- claim_versions.title
normalizedStatement <- claim_versions.normalized_statement
language          <- claim_versions.language
claimType         <- claim_versions.claim_type
```

The authority layer never overwrites, trims, normalizes, or substitutes source
row values. Any source-row mismatch is a historical integrity failure.

## 7. Immutability and append-only history

Authority objects are append-only and immutable after authentication. Their
canonical text, canonical version, hash, and identity bindings cannot be
updated or deleted.

After a ClaimVersion is authenticated under this Contract, each of its
authenticated semantic source fields is immutable: UPDATE or DELETE of the
ClaimVersion row that changes or removes any such field is rejected. Physical
enforcement belongs to the future Implementation Design, but must be
database-level rather than application discipline alone.

A semantic revision creates a new ClaimVersion authority. Existing authority
remains addressable and verifiable. No UPDATE-based repair path exists.

## 8. ClaimVersion versioning

Any change to `title`, `normalized_statement`, `language`, or `claim_type`
requires a new ClaimVersion identity and a new immutable authority object.
The prior ClaimVersion is never rewritten.

Newly authenticated service-created versions use the next positive integer
after the current version. A V1 authenticated history therefore has strictly
increasing version numbers with no skipped number in the newly created
sequence. Existing legacy gaps are not repaired or silently accepted as
historically authenticated.

A change to the proposition identity or scope that requires a different Claim
is an upstream RCV-009 Claim-identity decision. This layer and RCV-022 do not
infer whether differently worded propositions are the same Claim.

The RCV-009 schema has no structured subject, temporal, population,
geographic, causal, or qualifier fields. This Contract neither invents those
fields nor derives them from text.

## 9. Future RCV-022 binding

A future RCV-022 Claim binding must include:

```text
claimId
claimCanonicalVersion
claimCanonicalHash
```

A future RCV-022 ClaimVersion binding must include:

```text
claimId
claimVersionId
claimVersionCanonicalVersion
claimVersionCanonicalHash
```

The ClaimVersion canonical hash is the historical proposition-content
authority. The Claim identity hash authenticates the parent identity and does
not add semantic Claim content. RCV-022 must authenticate both bindings and
must never substitute current `claim_versions` row content for missing or
invalid authority.

## 10. Legacy rows and explicit re-authorization

Rows created before this authority exists are not historically authenticatable
merely by hashing their current values. Their current values cannot prove the
original canonical bytes or historical immutability.

Missing Claim or ClaimVersion authority therefore means
`UNAUTHENTICATED_LEGACY_AUTHORITY` for any consumer requiring this Contract.
The verifier fails closed. There is no silent backfill, retroactive
authenticity claim, or automatic migration of legacy rows.

V1 does not define a retroactive re-authorization mechanism. A future,
explicitly versioned re-authorization feature may create a new authority event
for the same source identity/content from the explicit authorization point.
That event is valid only from its explicit point forward; it must not mutate a
historical authority object or claim that the source content was authoritative
before that point.

## 11. Atomic authoritative creation

For newly adopted Claim and ClaimVersion creation, source identity/content and
the corresponding historical authority must be created atomically. No
committed state may cause a consumer to treat a new source row as authenticated
when its required authority is absent, nor treat an authority object as valid
when its required source identity/content was not created.

Exact transaction ownership and insert order are implementation-design
concerns. The atomicity obligation is normative.

## 12. No-repair and current-state independence

Readers and verifiers must not perform `INSERT`, `UPDATE`, `DELETE`, hash
generation as repair, canonical rewriting, normalization, or legacy
auto-backfill.

Historical verification uses persisted immutable authority. It must not use:

- current service output;
- current normalization logic;
- current ClaimVersion representation;
- current parser or model behavior;
- mutable Claim metadata;
- an RCV-019 state hash as a replacement for Claim/ClaimVersion authority.

Invalid or missing authority remains invalid or missing.

## 13. Failure semantics

Implementations must fail closed for these semantic conditions, without this
Contract prescribing final transport error codes:

- missing Claim authority;
- missing ClaimVersion authority;
- unsupported canonical version;
- malformed or non-canonical authority;
- Claim identity mismatch;
- ClaimVersion identity mismatch;
- parent Claim mismatch;
- version-number mismatch;
- source semantic parity mismatch;
- canonical reconstruction mismatch;
- hash mismatch;
- duplicate or conflicting authority;
- unauthenticated legacy authority;
- detected mutation of authenticated semantic content;
- repair attempt or current-state substitution.

No failure condition may be converted into a valid historical authority by
fallback, current-row lookup, or best-effort normalization.

## 14. Downstream boundaries

- **RCV-014:** unchanged. Assessment data is optional context and is not Claim
  or ClaimVersion authority.
- **RCV-017:** unchanged. Existing ClaimVersion-ID bindings remain valid but do
  not substitute for this historical authority.
- **RCV-018:** unchanged. Evidence Assertion and comparison authority remain
  separate.
- **RCV-019:** unchanged. Timeline and state hashes remain temporal-evidence
  authority and do not substitute for this Contract.
- **RCV-020:** unchanged. Observation, retrieval, Capture, and Handoff
  authority remain upstream observation authority.
- **RCV-021:** unchanged. Active-research authority and historical Claim IDs
  remain upstream; no active-research semantics are added here.
- **RCV-022:** future consumer. Its Contract freeze remains blocked until this
  authority is physically implemented, proven, test-reviewed, and
  snapshot-locked.

## 15. Non-goals

This Contract does not define:

- Claim semantic extraction or Claim equivalence;
- support, refutation, or evidence assessment;
- source trust or source independence;
- RCV-022 semantic analysis;
- RCV-018 comparison;
- source retrieval or active research;
- scheduling or cadence;
- legacy historical reconstruction;
- mutable current-Claim semantics;
- SQL tables, indexes, triggers, migrations, or repository APIs.

## 16. Contract status

This is the standalone FactBase Claim Historical Authority V1 Contract draft.
It is a prerequisite authority for a later Design and implementation step. It
does not itself authorize migration, production code, RCV-022 Contract work,
or runtime behavior.
