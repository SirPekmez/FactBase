import { randomUUID } from "node:crypto";
import { Pool, PoolClient, QueryResultRow } from "pg";
import databasePool from "../db";
import {
  CANONICALIZATION_ID,
  CANONICALIZATION_VERSION,
  DERIVATION_DSL_ID,
  DERIVATION_DSL_VERSION,
  DERIVATION_EXECUTION_METHODS,
  DERIVATION_INTERPRETER_ID,
  DERIVATION_INTERPRETER_VERSION,
  DERIVATION_EXECUTION_CONTRACT_ID,
  DERIVATION_EXECUTION_CONTRACT_VERSION,
  DERIVATION_RUNTIME_ID,
  DERIVATION_INPUT_SCHEMA_ID,
  DERIVATION_INPUT_SCHEMA_VERSION,
  DERIVATION_MANIFEST_DECISION_CODE,
  DerivationExecutionMethod,
  DerivationRuleDefinition,
  DerivationRuleRevision,
  DeterministicRuleDefinition,
  HASH_ALGORITHM,
  RecordedProcessRuleDefinition,
  RuleDecisionCode,
  CreateDerivationRuleRevisionInput,
} from "../types/derivation";
import {
  canonicalizeAndHash as exportedCanonicalizeAndHash,
} from "./canonicalJson";
import {
  getDerivationExecutionIdentity as exportedGetDerivationExecutionIdentity,
} from "./derivationExecutionIdentity";
import {
  getDerivationSnapshotBuilderIdentity as exportedGetDerivationSnapshotBuilderIdentity,
} from "./derivationInputSnapshotService";
import {
  getDerivationInterpreterArtifactHash as exportedGetDerivationInterpreterArtifactHash,
} from "./derivationRuleInterpreter";
import { runInTransaction as exportedRunInTransaction } from "./transaction";

const canonicalizeAndHash = exportedCanonicalizeAndHash;
const getDerivationExecutionIdentity = exportedGetDerivationExecutionIdentity;
const getDerivationSnapshotBuilderIdentity =
  exportedGetDerivationSnapshotBuilderIdentity;
const getDerivationInterpreterArtifactHash =
  exportedGetDerivationInterpreterArtifactHash;
const runInTransaction = exportedRunInTransaction;

interface RuleRevisionRow extends QueryResultRow {
  id: string;
  rule_id: string;
  rule_version: string;
  derivation_type: string;
  definition_canonical: string;
  definition_hash: string;
  input_schema_id: string;
  input_schema_version: string;
  output_schema_id: string;
  output_schema_version: string;
  canonicalization_id: typeof CANONICALIZATION_ID;
  canonicalization_version: typeof CANONICALIZATION_VERSION;
  hash_algorithm: typeof HASH_ALGORITHM;
  reproducibility_mode: DerivationExecutionMethod;
  interpreter_id: typeof DERIVATION_INTERPRETER_ID | null;
  interpreter_version: typeof DERIVATION_INTERPRETER_VERSION | null;
  interpreter_artifact_hash: string | null;
  interpreter_execution_contract_id: typeof DERIVATION_EXECUTION_CONTRACT_ID | null;
  interpreter_execution_contract_version:
    | typeof DERIVATION_EXECUTION_CONTRACT_VERSION
    | null;
  interpreter_execution_contract_hash: string | null;
  interpreter_runtime_id: typeof DERIVATION_RUNTIME_ID | null;
  interpreter_runtime_version: string | null;
  snapshot_builder_id: DerivationRuleRevision["snapshotBuilderId"];
  snapshot_builder_version: DerivationRuleRevision["snapshotBuilderVersion"];
  snapshot_builder_artifact_hash: string;
  created_at: Date;
}

interface DecisionCodeRow extends QueryResultRow {
  input_kind: RuleDecisionCode["inputKind"];
  usage: RuleDecisionCode["usage"];
  decision_code: typeof DERIVATION_MANIFEST_DECISION_CODE;
}

type RulePool = Pick<Pool, "connect">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function manifestDecisionCodes(): RuleDecisionCode[] {
  return ["assessment", "evidence_relation"].map((inputKind) => ({
    inputKind: inputKind as RuleDecisionCode["inputKind"],
    usage: "used",
    code: DERIVATION_MANIFEST_DECISION_CODE,
  }));
}

function parseDeterministicDefinition(
  value: Record<string, unknown>,
): DeterministicRuleDefinition {
  if (!hasOnlyKeys(value, ["dsl", "interpreter", "output"])) {
    throw new Error("Unknown deterministic rule definition field");
  }
  if (
    !isRecord(value.dsl) ||
    !hasOnlyKeys(value.dsl, ["id", "version"]) ||
    value.dsl.id !== DERIVATION_DSL_ID ||
    value.dsl.version !== DERIVATION_DSL_VERSION ||
    !isRecord(value.interpreter) ||
    !hasOnlyKeys(value.interpreter, ["id", "version", "artifactHash", "execution"]) ||
    value.interpreter.id !== DERIVATION_INTERPRETER_ID ||
    value.interpreter.version !== DERIVATION_INTERPRETER_VERSION ||
    typeof value.interpreter.artifactHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.interpreter.artifactHash) ||
    !isRecord(value.interpreter.execution) ||
    !hasOnlyKeys(value.interpreter.execution, [
      "contractId", "contractVersion", "contractHash", "runtimeId", "runtimeVersion",
    ]) ||
    value.interpreter.execution.contractId !== DERIVATION_EXECUTION_CONTRACT_ID ||
    value.interpreter.execution.contractVersion !== DERIVATION_EXECUTION_CONTRACT_VERSION ||
    typeof value.interpreter.execution.contractHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.interpreter.execution.contractHash) ||
    value.interpreter.execution.runtimeId !== DERIVATION_RUNTIME_ID ||
    typeof value.interpreter.execution.runtimeVersion !== "string" ||
    value.interpreter.execution.runtimeVersion.trim() === "" ||
    !isRecord(value.output) ||
    !hasOnlyKeys(value.output, ["operation"]) ||
    value.output.operation !== "input_manifest"
  ) {
    throw new Error("Unsupported deterministic rule definition");
  }
  return {
    dsl: { id: DERIVATION_DSL_ID, version: DERIVATION_DSL_VERSION },
    interpreter: {
      id: DERIVATION_INTERPRETER_ID,
      version: DERIVATION_INTERPRETER_VERSION,
      artifactHash: value.interpreter.artifactHash,
      execution: {
        contractId: DERIVATION_EXECUTION_CONTRACT_ID,
        contractVersion: DERIVATION_EXECUTION_CONTRACT_VERSION,
        contractHash: value.interpreter.execution.contractHash,
        runtimeId: DERIVATION_RUNTIME_ID,
        runtimeVersion: value.interpreter.execution.runtimeVersion,
      },
    },
    output: { operation: "input_manifest" },
  };
}

function parseRecordedDefinition(
  value: Record<string, unknown>,
): RecordedProcessRuleDefinition {
  if (!hasOnlyKeys(value, ["contract", "audit"])) {
    throw new Error("Unknown recorded-process rule definition field");
  }
  if (
    !isRecord(value.contract) ||
    !hasOnlyKeys(value.contract, ["id", "version"]) ||
    value.contract.id !== "factbase-recorded-process-rule" ||
    value.contract.version !== "1" ||
    !isRecord(value.audit) ||
    !hasOnlyKeys(value.audit, ["schemaId", "schemaVersion"]) ||
    value.audit.schemaId !== "factbase-recorded-process-audit" ||
    value.audit.schemaVersion !== "1"
  ) {
    throw new Error("Unsupported recorded-process rule definition");
  }
  return {
    contract: { id: "factbase-recorded-process-rule", version: "1" },
    audit: {
      schemaId: "factbase-recorded-process-audit",
      schemaVersion: "1",
    },
  };
}

export function validateRuleDefinition(
  value: unknown,
  mode: DerivationExecutionMethod,
): DerivationRuleDefinition {
  if (!isRecord(value)) {
    throw new Error("Rule definition must be an object");
  }
  return mode === "deterministic_rules"
    ? parseDeterministicDefinition(value)
    : parseRecordedDefinition(value);
}

function mapRuleRevisionWithDefinition(
  row: RuleRevisionRow,
  decisionRows: DecisionCodeRow[],
  definition: DerivationRuleDefinition | null,
): Omit<DerivationRuleRevision, "definition"> & {
  definition: DerivationRuleDefinition | null;
} {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    derivationType: row.derivation_type,
    definition,
    definitionCanonical: row.definition_canonical,
    definitionHash: row.definition_hash,
    inputSchemaId: row.input_schema_id,
    inputSchemaVersion: row.input_schema_version,
    outputSchemaId: row.output_schema_id,
    outputSchemaVersion: row.output_schema_version,
    canonicalizationId: row.canonicalization_id,
    canonicalizationVersion: row.canonicalization_version,
    hashAlgorithm: row.hash_algorithm,
    reproducibilityMode: row.reproducibility_mode,
    interpreterId: row.interpreter_id,
    interpreterVersion: row.interpreter_version,
    interpreterArtifactHash: row.interpreter_artifact_hash,
    interpreterExecutionContractId: row.interpreter_execution_contract_id,
    interpreterExecutionContractVersion: row.interpreter_execution_contract_version,
    interpreterExecutionContractHash: row.interpreter_execution_contract_hash,
    interpreterRuntimeId: row.interpreter_runtime_id,
    interpreterRuntimeVersion: row.interpreter_runtime_version,
    snapshotBuilderId: row.snapshot_builder_id,
    snapshotBuilderVersion: row.snapshot_builder_version,
    snapshotBuilderArtifactHash: row.snapshot_builder_artifact_hash,
    decisionCodes: decisionRows
      .map((code) => ({
        inputKind: code.input_kind,
        usage: code.usage,
        code: code.decision_code,
      }))
      .sort((left, right) => {
        const leftKey = `${left.inputKind}\u0000${left.usage}\u0000${left.code}`;
        const rightKey = `${right.inputKind}\u0000${right.usage}\u0000${right.code}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }),
    createdAt: row.created_at,
  };
}

function mapRuleRevision(
  row: RuleRevisionRow,
  decisionRows: DecisionCodeRow[],
): DerivationRuleRevision {
  const definition = validateRuleDefinition(
    JSON.parse(row.definition_canonical) as unknown,
    row.reproducibility_mode,
  );
  return mapRuleRevisionWithDefinition(row, decisionRows, definition) as DerivationRuleRevision;
}

export type DerivationRuleRevisionReadIntegrity =
  | "valid"
  | "parse_error"
  | "invalid_contract";

export interface DerivationRuleRevisionReadResult {
  rule: Omit<DerivationRuleRevision, "definition"> & {
    definition: DerivationRuleDefinition | null;
  };
  definitionIntegrity: DerivationRuleRevisionReadIntegrity;
}

export async function loadDerivationRuleRevision(
  client: PoolClient,
  id: string,
): Promise<DerivationRuleRevision> {
  const result = await client.query<RuleRevisionRow>(
    `SELECT * FROM public.derivation_rule_revisions WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Derivation rule revision ${id} was not found`);
  }
  const decisionResult = await client.query<DecisionCodeRow>(
    `SELECT input_kind, usage, decision_code
    FROM public.derivation_rule_decision_codes
    WHERE rule_revision_id = $1
    ORDER BY input_kind, usage, decision_code`,
    [id],
  );
  const mapped = mapRuleRevision(row, decisionResult.rows);
  const expectedCodes = manifestDecisionCodes();
  if (JSON.stringify(mapped.decisionCodes) !== JSON.stringify(expectedCodes)) {
    throw new Error("Persisted decision codes do not match the rule definition");
  }
  return mapped;
}

export async function loadDerivationRuleRevisionForRead(
  client: PoolClient,
  id: string,
): Promise<DerivationRuleRevisionReadResult> {
  const result = await client.query<RuleRevisionRow>(
    `SELECT * FROM public.derivation_rule_revisions WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Derivation rule revision ${id} was not found`);
  }
  const decisionResult = await client.query<DecisionCodeRow>(
    `SELECT input_kind, usage, decision_code
    FROM public.derivation_rule_decision_codes
    WHERE rule_revision_id = $1
    ORDER BY input_kind, usage, decision_code`,
    [id],
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.definition_canonical) as unknown;
  } catch {
    return {
      rule: mapRuleRevisionWithDefinition(row, decisionResult.rows, null),
      definitionIntegrity: "parse_error",
    };
  }
  try {
    return {
      rule: mapRuleRevisionWithDefinition(
        row,
        decisionResult.rows,
        validateRuleDefinition(parsed, row.reproducibility_mode),
      ),
      definitionIntegrity: "valid",
    };
  } catch {
    return {
      rule: mapRuleRevisionWithDefinition(row, decisionResult.rows, null),
      definitionIntegrity: "invalid_contract",
    };
  }
}

export async function createDerivationRuleRevision(
  input: CreateDerivationRuleRevisionInput,
  pool: RulePool = databasePool,
): Promise<DerivationRuleRevision> {
  for (const [field, value] of Object.entries({
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    derivationType: input.derivationType,
    inputSchemaId: input.inputSchemaId,
    inputSchemaVersion: input.inputSchemaVersion,
    outputSchemaId: input.outputSchemaId,
    outputSchemaVersion: input.outputSchemaVersion,
  })) {
    requireNonEmpty(value, field);
  }
  if (!DERIVATION_EXECUTION_METHODS.includes(input.reproducibilityMode)) {
    throw new Error("Unsupported derivation reproducibility mode");
  }
  if (
    input.inputSchemaId !== DERIVATION_INPUT_SCHEMA_ID ||
    input.inputSchemaVersion !== DERIVATION_INPUT_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported derivation input schema contract");
  }

  const suppliedDefinition = canonicalizeAndHash(input.definition);
  const definition = validateRuleDefinition(
    JSON.parse(suppliedDefinition.canonical) as unknown,
    input.reproducibilityMode,
  );
  const definitionResult = canonicalizeAndHash(definition);
  const executionIdentity = getDerivationExecutionIdentity();
  const snapshotBuilderIdentity = getDerivationSnapshotBuilderIdentity();
  if (
    input.reproducibilityMode === "deterministic_rules" &&
    (
      (definition as DeterministicRuleDefinition).interpreter.artifactHash !==
        getDerivationInterpreterArtifactHash() ||
      (definition as DeterministicRuleDefinition).interpreter.execution.contractId !==
        executionIdentity.contractId ||
      (definition as DeterministicRuleDefinition).interpreter.execution.contractVersion !==
        executionIdentity.contractVersion ||
      (definition as DeterministicRuleDefinition).interpreter.execution.contractHash !==
        executionIdentity.contractHash ||
      (definition as DeterministicRuleDefinition).interpreter.execution.runtimeId !==
        executionIdentity.runtimeId ||
      (definition as DeterministicRuleDefinition).interpreter.execution.runtimeVersion !==
        executionIdentity.runtimeVersion
    )
  ) {
    throw new Error("Derivation interpreter artifact hash mismatch");
  }
  const id = randomUUID();
  return runInTransaction(
    pool,
    "Rule revision creation failed and the transaction could not be rolled back",
    async (client) => {
      await client.query(
        `INSERT INTO public.derivation_rule_revisions (
          id, rule_id, rule_version, derivation_type,
          definition_canonical, definition_hash,
          input_schema_id, input_schema_version,
          output_schema_id, output_schema_version,
          canonicalization_id, canonicalization_version, hash_algorithm,
          reproducibility_mode, interpreter_id, interpreter_version,
          interpreter_artifact_hash,
          interpreter_execution_contract_id,
          interpreter_execution_contract_version,
          interpreter_execution_contract_hash,
          interpreter_runtime_id, interpreter_runtime_version,
          snapshot_builder_id, snapshot_builder_version,
          snapshot_builder_artifact_hash, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, CURRENT_TIMESTAMP
        )`,
        [
          id, input.ruleId, input.ruleVersion, input.derivationType,
          definitionResult.canonical, definitionResult.hash,
          input.inputSchemaId, input.inputSchemaVersion,
          input.outputSchemaId, input.outputSchemaVersion,
          CANONICALIZATION_ID, CANONICALIZATION_VERSION, HASH_ALGORITHM,
          input.reproducibilityMode,
          input.reproducibilityMode === "deterministic_rules"
            ? DERIVATION_INTERPRETER_ID
            : null,
          input.reproducibilityMode === "deterministic_rules"
            ? DERIVATION_INTERPRETER_VERSION
            : null,
          input.reproducibilityMode === "deterministic_rules"
            ? (definition as DeterministicRuleDefinition).interpreter.artifactHash
            : null,
          input.reproducibilityMode === "deterministic_rules"
            ? executionIdentity.contractId : null,
          input.reproducibilityMode === "deterministic_rules"
            ? executionIdentity.contractVersion : null,
          input.reproducibilityMode === "deterministic_rules"
            ? executionIdentity.contractHash : null,
          input.reproducibilityMode === "deterministic_rules"
            ? executionIdentity.runtimeId : null,
          input.reproducibilityMode === "deterministic_rules"
            ? executionIdentity.runtimeVersion : null,
          snapshotBuilderIdentity.id,
          snapshotBuilderIdentity.version,
          snapshotBuilderIdentity.artifactHash,
        ],
      );
      for (const decision of manifestDecisionCodes()) {
        await client.query(
          `INSERT INTO public.derivation_rule_decision_codes (
            rule_revision_id, input_kind, usage, decision_code, created_at
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [id, decision.inputKind, decision.usage, decision.code],
        );
      }
      return loadDerivationRuleRevision(client, id);
    },
  );
}
