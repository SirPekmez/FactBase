# RCV-015 Reproducible Derivation Contract, Version 1

RCV-015 records how an output was produced from one concrete claim-version
snapshot. It does not define a truth score, degree of proof, aggregate,
weighting, ranking, winner, threshold, or conflict resolution.

## Canonical representation

- JSON structures use RFC 8785 / JCS.
- Canonicalization ID is `jcs-rfc8785`, version `1`.
- Hash algorithm is `sha-256` over the canonical UTF-8 bytes.
- UUIDs are lowercase.
- PostgreSQL timestamps use UTC ISO-8601 with six fractional digits.
- Strings are not trimmed, case-folded, or Unicode-normalized.
- Hash equality means equal documented canonical bytes only. It does not mean
  equal truth, meaning, evidence quality, or factual support.

PostgreSQL `NUMERIC` assessment dimensions are represented as canonical decimal
strings, not JavaScript numbers. `NULL` remains JSON `null`. Decimal strings use
`0`, `1`, or `0.<digits ending in 1-9>`. No precision is silently discarded.

## Snapshot and inputs

Every derivation is bound to one claim version and records:

- a complete canonical input snapshot and its hash;
- normalized FK references to every evidence relation and assessment present in
  that snapshot;
- exactly one `used` decision with the technical code `included_in_manifest`
  for each candidate.
- snapshot-builder ID `factbase-derivation-snapshot-builder`, version `1`, and
  the loaded builder artifact hash on both the rule revision and derivation.

The snapshot-builder artifact covers the complete snapshot build source from
its SQL field selection, mappings and ordering through the final schema
envelope, JCS bytes, and input hash, together with the
versioned PostgreSQL-NUMERIC canonicalizer artifact, the RCV-015-specific
assessment-graph builder artifact, the isolated loaded JCS artifact, UTC
timestamp formatting, UUID normalization, comparator ordering, and the loaded
safe-runtime/execution-contract identity. Snapshot construction uses captured
intrinsics and own-property array insertion instead of dynamic prototype
dispatch. Artifact-critical cross-module functions, including the JCS/hash
entry point, are privately captured during module initialization; replacing a
public CommonJS/module-namespace export after that initialization cannot change
the bytes produced under the already initialized artifact identity. JCS receives
a validated copy in a private realm whose intrinsic
objects were frozen during module initialization. A post-load mutation of the
covered main-realm globals or prototypes cannot alter snapshot bytes under the
same builder identity. A source change in any covered component changes the
artifact hash and cannot execute an existing rule revision as the same builder
identity.

The interpreter and snapshot builder each initialize their artifact-critical
captures through one explicit module initializer. The loaded source of that
initializer and the loaded sources/artifact hashes of the captured functions
are part of the respective artifact hash. Changing a direct capture to a
wrapper, or otherwise changing bytes- or semantics-relevant binding
initialization, therefore changes the artifact identity. A static capture label
alone is not proof of initialization semantics.

The builder and deterministic interpreter return module-finalized result
objects. A private loaded-module registry, deeply frozen result, embedded
artifact identity, and canonical-value verification bind each handoff to the
module instance that created it. The derivation service only validates and
persists those finalized values; a cloned or wrapped replacement is rejected.
The service does not recreate deterministic input/output envelopes or hashes.

The canonical JSON artifact also binds the complete private-realm initializer,
the captured VM functions, realm factories, isolated canonicalizer, and realm
freezing program. Regular-expression identities include both source and flags.

### Input schema governance

`input_schema_id = factbase-derivation-input` and `input_schema_version = 1`
identify the stable semantic and structural contract of the canonical input
bytes described below. The snapshot-builder identity answers a different
question:

- input schema ID/version: which stable data contract the bytes implement;
- snapshot-builder ID/version/artifact hash: which concrete loaded builder
  implementation produced the bytes.

An artifact hash does not replace a schema version, and a schema version does
not identify an implementation. A change to the snapshot-builder artifact
alone does not permit a semantic or structural change under the same
`input_schema_version`. Pure implementation changes that preserve the exact
canonical data structure, meaning, null handling, ordering, graph diagnostics,
and `input_canonical` bytes for every valid domain input do not require a schema
version bump; their concrete implementation remains distinguishable through a
different builder artifact hash.

Any structural or semantic change requires a new input schema version. This
includes adding, removing, or renaming a field; changing a field's meaning,
null semantics, value representation, or semantically relevant list order;
changing a nested object or the schema envelope; changing the graph-diagnostic
catalog, code meanings, or anomaly structure; and changing Evidence,
Assessment, comparator, parent, or response representation. Such a change must
not be emitted as `factbase-derivation-input` version `1`.

### Input schema `factbase-derivation-input` / `1`

The top-level object contains exactly:

- `schema`: `{ "id": "factbase-derivation-input", "version": "1" }`;
- `claimVersion`: the complete claim-version object defined below;
- `evidenceRelations`: the ordered list defined below.

`claimVersion` contains `id`, `claimId`, `versionNumber`, `title`,
`normalizedStatement`, `language`, `claimType`, `status`,
`publicationStatus`, `changeReason`, `basedOnVersionId`, `actor`, `source`,
`requestId`, and `createdAt`. `actor` always has `type` and `id`; `source`
always has `type` and `reference`. `basedOnVersionId`, `requestId`, and nullable
actor/source members are JSON `null` when absent; the containing `actor` and
`source` objects are not omitted. `versionNumber` is a positive JSON integer
number. Claim/version IDs and non-null predecessor/request IDs are lowercase
UUID strings. Title, statement, language, type, state, publication state, and
change reason are JSON strings; no number/string coercion is permitted.

Each `evidenceRelations` item contains `relationId`, `evidenceId`, `relation`,
`relationCreatedAt`, `evidence`, `assessments`, and `assessmentGraph`.
`evidence` contains `sourceUrl`, `sourceTitle`, `sourceType`, `locator`,
`quotedText`, `snapshotHash`, `retrievedAt`, and `createdAt`. Nullable source
metadata remains present as JSON `null`.
Relation and Evidence IDs are lowercase UUID strings; `relation` and non-null
Evidence metadata are JSON strings. Relation/Evidence timestamps are canonical
timestamp strings.

Each assessment contains exactly `id`, `claimVersionEvidenceId`,
`sourceQuality`, `relevance`, `directness`, `recency`, `independence`, `rubric`,
`recencyContext`, `independenceComparisonRelationIds`, `method`, `rationale`,
`initiator`, `responseTo`, `legacyAssessedBy`, and `assessedAt`.

- Assessment dimensions are JSON `null` or lossless canonical decimal strings
  as defined above. JSON numbers are not substituted for those strings.
- `rubric`, `recencyContext`, `initiator`, and `responseTo` are JSON `null` when
  their persisted pair/context is absent. Otherwise their documented nested
  members remain explicit, including nullable IDs.
- `method` is always present with `type`, `ruleSet`, `model`, and `imported`;
  absent method-specific provenance is represented by JSON `null`.
- An all-`null` object is not an alternative absent representation for
  `rubric`, `recencyContext`, `responseTo`, `ruleSet`, `model`, or `imported`.
- Non-null `rubric` has `id` and `version`; `recencyContext` has `referenceType`
  and `referenceAt`; and `initiator` has `type` and `id`. Non-null `ruleSet` has
  `id` and `version`; `model` has `id`, `version`, `processType`, and
  `processVersion`; and `imported` has `referenceType` and `reference`.
- `independenceComparisonRelationIds` contains lowercase relation UUIDs ordered
  lexicographically by relation ID.
- `responseTo` contains `assessmentId` and `relation`; it is distinct from the
  Evidence-to-Claim relation.

Assessment IDs, relation IDs, response IDs, comparator IDs, and non-null graph
reference IDs are lowercase UUID strings. `assessedAt` and a non-null
`recencyContext.referenceAt` are canonical timestamp strings. Other non-null
assessment provenance, rationale, method, response-relation, and legacy values
are JSON strings. Lists are JSON arrays and documented nested records are JSON
objects; neither representation is interchangeable.

`assessmentGraph` contains `unparentedAssessmentIds` and `integrity`.
`integrity` contains `status` and `anomalies`. Every anomaly contains `code`,
`assessmentIds`, `relatedAssessmentId`, `relatedClaimVersionEvidenceId`, and
`rawResponseRelation`; unavailable values remain JSON `null`. The complete V1
code catalog, in deterministic diagnostic order, is:

1. `missing_parent`
2. `cross_relation_parent`
3. `incomplete_response_pair`
4. `invalid_response_relation`
5. `self_response`
6. `cycle`

`integrity.status` is the JSON string `valid` exactly when `anomalies` is empty
and otherwise `anomalies_detected`. `unparentedAssessmentIds`, `assessmentIds`,
and `anomalies` are JSON arrays. Each anomaly is a closed JSON object containing
exactly the five fields listed above.

Evidence relations are ordered by persisted relation `created_at`, then relation
ID. Assessments are ordered by `assessed_at`, then assessment ID. Comparator IDs
are ordered by comparison relation ID. Graph anomalies use the code order above
and then their deterministic technical anomaly key. Unparented assessment IDs
retain assessment order; IDs in a detected multi-node cycle are lexicographically
ordered. JCS determines object-member ordering in the final bytes; it does not
replace these semantic array orders.

All UUIDs are lowercase. All PostgreSQL timestamps use UTC with exactly six
fractional digits. Every declared field remains present; SQL `NULL` becomes JSON
`null` and is never omitted, defaulted to zero, or interpreted. Usage decisions
and decision codes are deliberately outside the raw snapshot and therefore are
not part of `input_canonical` or `input_hash`.

RCV-015 DSL/rule V1 does not permit `not_used` or rule-specific decision codes.
Those require a later version and an explicit semantic decision. Usage is not
part of the raw input hash. The snapshot retains raw evidence relations,
assessment-response edges, RCV-014 metadata, independence comparisons, legacy
nulls, and technical graph anomalies without interpreting them.

## Rule revisions

Rule revisions contain their complete canonical definition and hash. A
`rule_id`/`rule_version` pair is unique and must never be changed semantically.
Later semantic changes require a new rule version.

Each derivation copies the verified rule-definition hash. Deterministic rule
revisions and derivations also store the SHA-256 hash initialized from the
loaded interpreter, final output-envelope construction, JCS/output-hash
implementation, and runtime V1 constants. Historical hashes remain visible in
the read model; ID and version labels alone are not treated as artifact proof.

Deterministic rule revisions and derivations also persist the versioned
interpreter execution-contract hash and loaded Node/V8 identity. The neutral V1
interpreter avoids mutable prototype helpers in its valid execution path. This
is a JavaScript execution-contract identity, not native binary, operating-system,
hardware, or hostile-process-memory attestation.

`deterministic_rules` uses the versioned FactBase derivation DSL and interpreter.
`recorded_process` uses a canonical process-audit envelope and does not claim
bit-for-bit repeatability.

Process-audit timestamps are caller-supplied canonical UTC strings in the exact
form `YYYY-MM-DDTHH:mm:ss.ffffffZ`. They are stored and read without conversion
through JavaScript `Date`.

Rule revisions and derivations are append-only through application services.
RCV-015 intentionally adds no global database append-only trigger.

Resource ceilings, payload-size limits, secret classification/redaction, and
runtime-environment allowlists remain explicit follow-up work. Successful
RCV-015 writes preserve the accepted canonical bytes; the contract does not
promise acceptance of arbitrarily large or deeply nested inputs.

## Output

The output is a neutral, schema-identified canonical JSON envelope with its own
hash. Its eventual factual meaning belongs to the rule revision and a later
degree-of-proof contract. RCV-015 does not infer such meaning.

For deterministic rules, the same rule revision and input hash must produce the
same output hash. Divergent outputs remain stored and are reported as a neutral
technical reproducibility anomaly. Neither output is selected as a winner.

Historical reads always retain the persisted canonical text. Syntactically
invalid JSON is returned as raw canonical text with a `null` parsed value and a
neutral `*_parse_error` diagnostic. Valid but non-canonical JSON receives a
neutral `*_not_canonical` diagnostic. Hash mismatches remain independent, so a
parse error never hides byte-level hash drift. Reads do not repair or reinterpret
the persisted bytes.

A syntactically valid input whose structure does not satisfy the persisted V1
input schema remains visible as raw text and receives the neutral technical
diagnostic `input_canonical_structure_error`. Reference comparison is skipped
for that damaged structure; no repair or inferred replacement structure is
created.
