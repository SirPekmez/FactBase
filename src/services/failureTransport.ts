/** Transport phases are context, never classifications of the original failure. */
export type FailureTransportPhase = "primary" | "rollback" | "connection-release" | "session-reset" | "verification" | "inspection";
export interface RetainedFailure {
  readonly phase: FailureTransportPhase;
  readonly error: unknown;
}

/** Receives caller-owned plain entries; never inspects or mutates their error values. */
export class FailureTransportGroup extends Error {
  declare readonly failures: readonly RetainedFailure[];
  readonly name = "FailureTransportGroup";

  constructor(failures: readonly RetainedFailure[]) {
    super("Multiple failures retained");
    Object.defineProperty(this, "failures", {
      value: Object.freeze(failures.map(({ phase, error }) => Object.freeze({ phase, error }))),
      enumerable: false,
    });
  }
}

export function throwRetainedFailures(failures: readonly RetainedFailure[]): void {
  if (failures.length === 1) throw failures[0].error;
  if (failures.length > 1) throw new FailureTransportGroup(failures);
}
