import { ResultSelection, RunTerminalResolution, ProviderResult, ResearchRun, ResearchAttempt, AttemptResolution } from "../contracts/rcv021ActiveResearchContractV1";
import { Rcv021PgPool } from "./rcv021PostgresRepository";
import { persistRcv021Bundle } from "./rcv021PostgresRepository";
import { Rcv021WriteBundle } from "./rcv021WriteVerifier";
import { bindRcv021SelectionToRcv020 } from "./rcv021BindingAdapter";
import { Rcv020PersistenceInput } from "./rcv020PersistenceService";
import { Rcv020PgPool } from "./rcv020PostgresRepository";

/** Explicit deterministic execution output for the Wave-5 integration seam. */
export interface Rcv021DeterministicExecution {
  readonly run: ResearchRun;
  readonly attempts: readonly ResearchAttempt[];
  readonly attemptResolutions: readonly AttemptResolution[];
  readonly providerResults: readonly ProviderResult[];
  readonly terminal: RunTerminalResolution;
}

export interface Rcv021IntegratedSliceInput {
  /** Creation, bindings, lifecycle, and attempt authority. */
  readonly creation: Rcv021WriteBundle;
  /** Deterministic executor output; no provider or clock access occurs here. */
  readonly execution: Rcv021DeterministicExecution;
  /** Optional immutable T1 selection, persisted after terminalization. */
  readonly selection?: ResultSelection;
  /** Optional ordinary frozen RCV-020 EXTERNAL input for T2. */
  readonly rcv020?: Rcv020PersistenceInput;
}

export interface Rcv021IntegratedSliceResult {
  readonly t0ProviderResultCount: number;
  readonly t1SelectionId?: string;
  readonly t2OccurrenceId?: string;
}

/**
 * Composes the already-authoritative RCV-021 and RCV-020 boundaries. Each
 * phase is explicit: creation, T0 results, terminal resolution, T1 selection,
 * and optional RCV-020 T2 binding. No provider, scheduler, clock, or current
 * state is consulted by this seam.
 */
export async function persistRcv021IntegratedSlice(
  pool: Rcv021PgPool & Rcv020PgPool,
  input: Rcv021IntegratedSliceInput,
): Promise<Rcv021IntegratedSliceResult> {
  await persistRcv021Bundle(pool, input.creation);

  // T0 is independently valid: a ProviderResult may be persisted before any
  // selection or terminal resolution exists.
  if (input.execution.providerResults.length > 0) {
    await persistRcv021Bundle(pool, { providerResults: input.execution.providerResults });
  }

  // Terminal resolution receives the immutable execution context again so the
  // pure write verifier can authenticate the manifest without reading state.
  await persistRcv021Bundle(pool, {
    operations: input.creation.operations,
    subjects: input.creation.subjects,
    triggers: input.creation.triggers,
    runs: [input.execution.run],
    runLifecycleEvents: input.creation.runLifecycleEvents,
    attempts: input.execution.attempts,
    attemptResolutions: input.execution.attemptResolutions,
    providerResults: input.execution.providerResults,
    runTerminalResolutions: [input.execution.terminal],
  });

  // T1 is independent of downstream RCV-020 success. Deliberately omit the
  // ProviderResult row here: it already exists and must not be reclassified as
  // a late result after terminalization.
  if (input.selection) await persistRcv021Bundle(pool, { resultSelections: [input.selection] });

  if (input.selection && input.rcv020) {
    const binding = await bindRcv021SelectionToRcv020(pool, input.selection, input.rcv020);
    return Object.freeze({
      t0ProviderResultCount: input.execution.providerResults.length,
      t1SelectionId: input.selection.selectionId,
      t2OccurrenceId: binding.occurrenceId,
    });
  }
  return Object.freeze({
    t0ProviderResultCount: input.execution.providerResults.length,
    t1SelectionId: input.selection?.selectionId,
  });
}
