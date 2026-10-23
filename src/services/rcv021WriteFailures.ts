export interface Rcv021RetainedFailure { readonly phase: "primary" | "rollback" | "savepoint-release" | "connection-release"; readonly error: unknown; }
/** Raw failure identities are retained without introspection or JSON exposure. */
export class Rcv021WriteFailureGroup extends Error {
  declare readonly failures: readonly Rcv021RetainedFailure[];
  readonly name = "Rcv021WriteFailureGroup";
  constructor(failures: readonly Rcv021RetainedFailure[]) {
    super("Multiple RCV-021 write/cleanup failures retained; transaction outcome is not verified");
    Object.defineProperty(this, "failures", { value: Object.freeze(failures.map(failure => Object.freeze({ phase: failure.phase, error: failure.error }))), enumerable: false });
  }
}
export function throwRcv021RetainedFailures(failures: readonly Rcv021RetainedFailure[]): void {
  if (failures.length === 1) throw failures[0].error;
  if (failures.length > 1) throw new Rcv021WriteFailureGroup(failures);
}
