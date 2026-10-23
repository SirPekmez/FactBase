# RCV-021 Deadline Provenance – owner-selected working basis V1

Status: owner-selected technical working basis, not frozen, not overall PASS.
Owner decision in the FactBase chat on 2026-10-13: versioned structured
Deadline provenance in the existing optional field; legacy free text remains
unchanged and must not receive unproven stronger qualification.

Contract working-basis SHA256:
`0275261ee20decf2f1194ad40b052bed77dafad5742e756cc75ed7a45baaed46`.
The Contract remains unchanged and draft.

## Recorded representation

For a new deadline-caused FAILED resolution, `failureAuthority` is the exact
JCS JSON string containing precisely these string fields:

- schema = `RCV021-DEADLINE-PROVENANCE-V1`;
- cause = `RUN_DEADLINE_EXPIRED`;
- runId = the authenticated Run UUID;
- runCanonicalHash = its exact canonical SHA256;
- attemptId = the authenticated Attempt UUID;
- attemptCanonicalHash = its exact canonical SHA256;
- deadlineAt = the immutable deadline from that exact Run.

The outer immutable AttemptResolution canonical bytes/hash bind the entire
string. Parent identities, fields, hashes, exact key set, types and canonical
inner bytes must agree. A schema tag or a word substring alone is not proof.
This records technical diagnostic cause authority; it does not prove a real
timer fired or imply a truth/evidence judgment. No new Attempt terminal state
is introduced. Ordinary FAILED still permits absent/NULL provenance and
ordinary optional diagnostic text.

## Historical evidence and consumers

Legacy strings, including RUN_DEADLINE_EXPIRED or NOT_DEADLINE_RELATED, remain
byte-for-byte unchanged. Full outer canonical authentication can hold while
applicable deadline-cause qualification is UNKNOWN. The read result exposes
canonicalVerified separately from deadlineQualification; verified is false
when required deadline evidence is UNKNOWN. A consumer requiring qualified
history must call the explicit full-evidence boundary, not ignore the result.
Unsupported or unrecognized provenance formats are not promoted to VERIFIED.
Recognized malformed or falsely bound structured records fail closed.

A Run terminal that crosses the deadline with an active Attempt requires
FAILED for the Attempt and TIMED_OUT for the Run, independent of the requested
Run outcome. A supplied pure context is not a completeness proof.

Historical Scheduler evaluation uses its recorded evaluation timestamp, never
current wall clock or future terminal records. Nonterminal history at/after
the deadline is UNKNOWN. An unresolved Attempt without a historical evaluation
bound is likewise UNKNOWN; predeadline active prefixes remain valid bounded
history. Timestamp ties do not invent an execution-event order.

A decision-created Run is output, not predecision evidence. Its entire
creation authority is independently authenticated before exclusion: exact
identity linkage, creation time equal to the decision evaluation, canonical
bytes/hash/fields, valid Run creation and the null predecessor produced by
Scheduler V1. The initial activation prefix and per-decision prefix use this
same distinction. This authenticates creation, not later execution outcomes.

## Source-level implementation scope

The source correction includes the provenance parser/builder, pure deadline
assessment, historical qualification result, strict measured SQL row-set
handling, a client-bound historical loader, and both Scheduler reader and
writer full-evidence gates. The writer gate covers the ordering before both
new-write and idempotent-return branches. Source tests use real exported
functions and instrumented clients; these are not physical database proofs.

Still OPEN: full runtime terminal-write context, complete Child-writer lock
participation, direct SQL admission, executed full replay on PostgreSQL,
fresh connection/restart/no-repair requalification, and the earlier harness
failure-retention/cleanup/publication findings. The independent preparatory
ASTRA High source review does not replace the final overall audit.

No authority promotion or frozen-gate claim follows from this source change.
Changes to this schema, parent hashing, deadline assessment, source/context
loading, consumer gates, fixtures or harness invalidate their respective
source evidence and require new bounded proofs. Historical records are never
repaired, backfilled, rehashed or substituted by newer Runs.


## Terminal-write context candidate (2026-10-14; source scope)

The repository writes inside an owned savepoint in the caller transaction.
Every affected Operation is locked in UUID order. All writers using this
repository require measured READ COMMITTED isolation before parent reads or
mutation: a parent lock alone cannot refresh a REPEATABLE READ snapshot.
Caller client access must be exclusive until completion; direct SQL bypass is
not qualified by this repository protocol.

Terminal admission loads the actual Run, predecessor ancestry, Starts,
Attempts, resolutions and complete ProviderResult set on the same connection.
Caller-supplied lists are proposals, not completeness evidence. Existing
terminal Runs reject new or divergent execution-child authority and permit
only exact immutable replay. Selection admission uses measured parent mapping,
strict scalar semantics and post-insert graph validation. Operation-only
lifecycle changes are validated independently of affected Runs.

New Run creation is fully validated before successful scope release, after
same-scope predecessor terminals have been measured; failures roll back the
owned scope. This order permits atomic predecessor completion plus rerun.
No rejected scope is reported successful. Primary, savepoint rollback/release,
outer rollback and connection-release failures retain their raw identities
without contextual domain rewriting. The standalone wrapper also requires an
actual COMMIT command acknowledgement; this is not historical lifecycle proof.

This candidate does not close physical isolation/lock/race gates, connection
ownership, direct SQL admission, or harness/publication qualification. SQL
clients in source tests are instrumented models. PostgreSQL concurrency,
fresh connection, restart and recovery proofs remain required. Changes to
isolation, lock participation, graph filtering, mutation order, savepoint or
failure retention invalidate this source evidence. No overall PASS, authority
promotion or snapshot lock is authorized by a source test result.


## Owned transaction and recovery source step (2026-10-14)

Standalone RCV021 writes require a pool lease. Caller-owned clients must use
persistRcv021BundleWithinTransaction; the standalone API no longer accepts
raw clients. Native idle admission probes a unique SAVEPOINT: only a query
failure with an own data SQLSTATE descriptor equal to 25P01 admits BEGIN.
Successful or unknown probe results reject ownership takeover. A successful
probe is released as its own transient scope; no full caller COMMIT/ROLLBACK
is issued. Failed/ambiguous acquired leases are discarded via release(true).
Disconnect may abort an open transaction; this is not proof of unchanged
physical caller state or historical rollback success.

The shared boundary retains unexpected probe/inspection failures before
foreign introspection, checks BEGIN/COMMIT/ROLLBACK acknowledgements, awaits
synchronous or asynchronous release, and returns results only after cleanup.
Ambiguous BEGIN/COMMIT transport failures remain failures even if best-effort
rollback succeeds. Both Scheduler writer success branches use this boundary.
The RCV021 historical reader preserves RR READ ONLY using its snapshot-read
mode. Scheduler historical reader retains primary and release failures,
including hostile failure inspection errors; ordinary mapped errors preserve
the raw cause. Existing Scheduler historical snapshot semantics are unchanged
and still require coherent physical qualification.

Source tests use instrumented clients. Native PostgreSQL idle probes, pool
lease destruction, cleanup and transaction lifecycle are NOT physically
qualified by these tests. Process non-zero, serialization/fallback reporting,
canonical publication, historical helper succession and overall gates remain
OPEN. The missing original Batch-family helper bytes cannot be replaced by
these repository changes or by transcripts containing earlier PASS claims.
Ownership, query protocol, cleanup mapping or wrapper changes invalidate this
source evidence. Contract, migration and prior frozen authorities are unchanged
in this step.
