# RCV-018 Implementation Guardrails V1

These guardrails implement the normative RCV-018 Contract V1. They add no
semantic vocabulary or behavior beyond that Contract.

## Semantic safety

- Do not invent semantics outside the Contract.
- Do not infer contradiction from natural language, LLM output, keywords,
  synonyms, fuzzy similarity, source reputation, evidence quantity, recency,
  majority, or RCV-017 direction labels.
- Do not treat caller-selected pair subsets as a complete analysis, and do not
  silently omit invalid or otherwise eligible assertions or pairs.
- Do not infer Evidence Assertion values from free-form source text; assertions
  arrive as structured historical inputs.
- Resolve only typed statement identities. `statementKind` must be one of the
  five Contract values and selects exactly one frozen RCV-016 family. Never
  resolve a bare untyped `statementId`, search all families, apply precedence,
  fall back to another family, or use current/live state to disambiguate.
- Include `statementKind` in Evidence Basis duplicate, ordering, Canonical, and
  relational-parity checks. The same UUID in different families is distinct. A
  SQL-only discriminator or hidden registry may not change semantic identity
  outside Canonical.
- Do not perform unit conversion, temporal/jurisdiction inference, ontology
  inference, or extraction-fidelity claims.
- Do not add quality, credibility, confidence, probability, ranking, winner,
  truth/falsehood, recommendation, intent, deception, manipulation, Sybil, or
  laundering semantics.
- RCV-014 values never gate eligibility or incompatibility.

## Validation and Canonical integrity

- Accept only the closed primitive grammars and closed object fields in the
  Contract; never trim, case-fold, normalize, alias, or default values.
- Verify domain Canonical/hash parity before comparability. Hash mismatch,
  malformed/non-JCS Canonical, unsupported type/version, and invalid structure
  are `REJECT_UNSUPPORTED`.
- Enforce one authenticated Canonical/hash per logical ID and version for every
  Value Domain and Comparison Domain, and one authenticated Canonical/hash per
  assertion ID. Conflicts are `REJECT_UNSUPPORTED`.
- Enforce all cross-object parity and relational Evidence Basis parity; existence
  of individual IDs is insufficient. Frankenstein tuples are rejected.
- For HistoricalBinding `kind = "STATEMENT"`, enforce the same typed
  `statementKind` + `statementId` validation and prohibit alternate-family
  lookup or verifier repair.
- Preserve exact RFC-8785/JCS UTF-8 text and SHA-256 bytes. Do not reconstruct
  Canonical in SQL, verify hashes without Canonical parity, or include timestamps,
  storage metadata, display labels, diagnostics, or row order.
- Builder output may be canonicalized into required order; persisted malformed
  ordering must be rejected, never silently sorted or repaired.

## Historical and semantic boundaries

- Bind only materially relevant historical identifiers from the closed binding
  union and evidence-basis tuple. Never consult current/latest/live state.
- Keep RCV-017 KNOWLEDGE_INCOMPLETE distinct; do not reinterpret it as
  UNRESOLVED.
- `CONTRADICTION` requires valid comparability and the explicit mutually
  exclusive pair rule. No other incompatibility rule family is permitted.
- UNRESOLVED is derived from a valid contradiction and is not an independent
  persisted semantic family.
- Persist and verify the complete RCV018AnalysisV1 scope and contradiction set.
  Replay every unordered assertion pair exactly once; reject omitted or extra
  findings and never accept a partial result.
- Enforce the exact seven-field RCV018AnalysisV1 shape. Reject unknown or extra
  semantic fields, optional extension fields, and implementation metadata that
  could influence Canonical or hashing. Preserve exact projection parity for all
  assertion, Value Domain, Comparison Domain, contract-binding, algorithm-binding,
  and contradiction-hash entries.

## Component and transaction boundaries

- The Builder is pure and deterministic.
- The Write-Verifier is pure and authenticates the exact Builder object handed to
  the repository; do not clone, serialize/parse, rebuild, or regenerate IDs.
- The PostgreSQL Repository owns exactly one atomic write transaction.
- The Read Repository is exact-ID only, read-only, and returns raw persisted data.
- The Read-Verifier receives that exact returned bundle, has no database handle,
  independently verifies Canonical/hash and semantic parity, and never writes.
- No verifier or repository repair, retry, fallback, upsert, duplicate-as-success,
  ID regeneration, or competing outer transaction is allowed.

## Persistence boundary

Persistence is required for historical auditability and independent inspection
of exact past conclusions. Physical table names, columns, keys, constraints,
migration order, and SQL are outside this document and require a later design
phase. RCV-017 files and semantics remain unchanged.

## Forbidden implementation content

Do not embed transport/UI concerns, authorization-policy invention, source
selection, evidence discovery, ranking, recommendation, or application-layer
semantic enrichment. Test-only corruption mechanisms must never be confused with
normal production read behavior and must restore state deterministically.
