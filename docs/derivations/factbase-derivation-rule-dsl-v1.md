# FactBase Derivation Rule DSL, Version 1

DSL ID: `factbase-derivation-rule-dsl`

DSL version: `1`

Interpreter ID: `factbase-derivation-rule-interpreter`

Interpreter version: `1`

Execution contract ID: `factbase-derivation-interpreter-execution`

Execution contract version: `1`

At module initialization, SHA-256 binds the loaded interpreter function source,
the final schema-identified output-envelope and JCS/hash path, and every runtime
V1 constant in a versioned in-memory fingerprint. The frozen
hash is stored on the rule revision and copied to every derivation. Replacing the
compiled file after module loading cannot change this loaded-implementation
identity. ID and version alone are not an artifact identity.

The execution contract additionally persists its own hash plus the loaded Node
and V8 versions. Its hash binds a safe-runtime artifact initialized with captured
intrinsics. The valid DSL-V1 execution path uses strict equality, property reads,
numeric `for` loops, and own array-element definition through that loaded
safe-runtime. It does not dispatch through mutable `Array.prototype` methods and
does not use ordinary array index assignment, which could invoke an inherited
numeric accessor. Post-load replacement of the covered globals or prototypes
or of the publicly exported canonicalization/hash function therefore cannot
alter the V1 result under the same initialized identity: the interpreter holds
private module-initialization captures of its artifact-critical dependencies.
Rule definitions
and snapshots have already passed plain JSON/JCS validation before execution,
so accessors and proxies are not execution inputs. The identity does not claim
operating-system, native-binary, hardware, pre-initialization compromise, or
hostile-process-memory attestation.

This version is deliberately infrastructure-only. It has no conditions,
arithmetic, decimal operations, score operations, relation-direction logic,
assessment-response logic, current-time access, randomness, network access,
filesystem access, environment access, or external callbacks.

The DSL consumes `factbase-derivation-input` version `1` as defined by the
RCV-015 reproducibility contract. The input schema version identifies that
stable data contract; the snapshot-builder artifact hash independently
identifies its concrete implementation. A new builder artifact alone does not
permit the DSL to treat a structurally or semantically changed snapshot as
input schema version `1`.

A definition contains exactly:

- the DSL identifier and the interpreter ID, version, and executing artifact
  hash;
- the single output operation `input_manifest`.

The interpreter includes every evidence-relation and assessment candidate
exactly once with the fixed technical values `used` and
`included_in_manifest`. DSL V1 cannot define decision codes or `not_used`.
`input_manifest` outputs only stable input identifiers, those fixed manifest
decisions, the input hash, and technical assessment-graph anomalies. It performs
no factual interpretation.

Any future conditional selection, decimal comparison, assessment weighting, or
degree-of-proof behavior requires a new DSL and interpreter version after a
separate semantic decision.
`not_used` and rule-specific decision codes likewise require a later DSL/rule
version and an explicit semantic decision.
