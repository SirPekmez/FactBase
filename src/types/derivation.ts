import { TrustedOperationContext } from "./operationContext";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const CANONICALIZATION_ID = "jcs-rfc8785" as const;
export const CANONICALIZATION_VERSION = "1" as const;
export const HASH_ALGORITHM = "sha-256" as const;
export const DERIVATION_DSL_ID = "factbase-derivation-rule-dsl" as const;
export const DERIVATION_DSL_VERSION = "1" as const;
export const DERIVATION_INTERPRETER_ID =
  "factbase-derivation-rule-interpreter" as const;
export const DERIVATION_INTERPRETER_VERSION = "1" as const;
export const DERIVATION_EXECUTION_CONTRACT_ID =
  "factbase-derivation-interpreter-execution" as const;
export const DERIVATION_EXECUTION_CONTRACT_VERSION = "1" as const;
export const DERIVATION_RUNTIME_ID = "node-v8" as const;
export const DERIVATION_INPUT_SCHEMA_ID = "factbase-derivation-input" as const;
export const DERIVATION_INPUT_SCHEMA_VERSION = "1" as const;
export const DERIVATION_SNAPSHOT_BUILDER_ID =
  "factbase-derivation-snapshot-builder" as const;
export const DERIVATION_SNAPSHOT_BUILDER_VERSION = "1" as const;
export const DERIVATION_MANIFEST_DECISION_CODE =
  "included_in_manifest" as const;

export const DERIVATION_EXECUTION_METHODS = [
  "deterministic_rules",
  "recorded_process",
] as const;
export type DerivationExecutionMethod =
  (typeof DERIVATION_EXECUTION_METHODS)[number];

export const DERIVATION_INPUT_KINDS = [
  "evidence_relation",
  "assessment",
] as const;
export type DerivationInputKind = (typeof DERIVATION_INPUT_KINDS)[number];

export const DERIVATION_INPUT_USAGES = ["used"] as const;
export type DerivationInputUsage = (typeof DERIVATION_INPUT_USAGES)[number];

export interface RuleDecisionCode {
  inputKind: DerivationInputKind;
  usage: "used";
  code: typeof DERIVATION_MANIFEST_DECISION_CODE;
}

export interface DeterministicRuleDefinition {
  dsl: { id: typeof DERIVATION_DSL_ID; version: typeof DERIVATION_DSL_VERSION };
  interpreter: {
    id: typeof DERIVATION_INTERPRETER_ID;
    version: typeof DERIVATION_INTERPRETER_VERSION;
    artifactHash: string;
    execution: {
      contractId: typeof DERIVATION_EXECUTION_CONTRACT_ID;
      contractVersion: typeof DERIVATION_EXECUTION_CONTRACT_VERSION;
      contractHash: string;
      runtimeId: typeof DERIVATION_RUNTIME_ID;
      runtimeVersion: string;
    };
  };
  output: { operation: "input_manifest" };
}

export interface RecordedProcessRuleDefinition {
  contract: { id: "factbase-recorded-process-rule"; version: "1" };
  audit: { schemaId: "factbase-recorded-process-audit"; schemaVersion: "1" };
}

export type DerivationRuleDefinition =
  | DeterministicRuleDefinition
  | RecordedProcessRuleDefinition;

export interface CreateDerivationRuleRevisionInput {
  ruleId: string;
  ruleVersion: string;
  derivationType: string;
  inputSchemaId: string;
  inputSchemaVersion: string;
  outputSchemaId: string;
  outputSchemaVersion: string;
  reproducibilityMode: DerivationExecutionMethod;
  definition: unknown;
}

export interface DerivationRuleRevision {
  id: string;
  ruleId: string;
  ruleVersion: string;
  derivationType: string;
  definition: DerivationRuleDefinition;
  definitionCanonical: string;
  definitionHash: string;
  inputSchemaId: string;
  inputSchemaVersion: string;
  outputSchemaId: string;
  outputSchemaVersion: string;
  canonicalizationId: typeof CANONICALIZATION_ID;
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  hashAlgorithm: typeof HASH_ALGORITHM;
  reproducibilityMode: DerivationExecutionMethod;
  interpreterId: typeof DERIVATION_INTERPRETER_ID | null;
  interpreterVersion: typeof DERIVATION_INTERPRETER_VERSION | null;
  interpreterArtifactHash: string | null;
  interpreterExecutionContractId: typeof DERIVATION_EXECUTION_CONTRACT_ID | null;
  interpreterExecutionContractVersion:
    | typeof DERIVATION_EXECUTION_CONTRACT_VERSION
    | null;
  interpreterExecutionContractHash: string | null;
  interpreterRuntimeId: typeof DERIVATION_RUNTIME_ID | null;
  interpreterRuntimeVersion: string | null;
  snapshotBuilderId: typeof DERIVATION_SNAPSHOT_BUILDER_ID;
  snapshotBuilderVersion: typeof DERIVATION_SNAPSHOT_BUILDER_VERSION;
  snapshotBuilderArtifactHash: string;
  decisionCodes: RuleDecisionCode[];
  createdAt: Date;
}

export interface DerivationUsageDecision {
  inputKind: DerivationInputKind;
  inputId: string;
  usage: "used";
  decisionCode: typeof DERIVATION_MANIFEST_DECISION_CODE;
}

export interface RecordedReference {
  id: string;
  version: string;
}

export interface RecordedImportReference {
  referenceType: "import_run" | "external_record";
  reference: string;
}

export interface RuntimeEnvironmentComponent {
  id: string;
  version: string;
}

export interface RecordedProcessAuditInput {
  processId: string;
  processVersion: string;
  implementationId: string;
  implementationVersion: string;
  parameters: JsonValue;
  modelReference?: RecordedReference;
  workflowReference?: RecordedReference;
  importReference?: RecordedImportReference;
  randomSeed?: string;
  runtimeEnvironment?: RuntimeEnvironmentComponent[];
  startedAt: string;
  completedAt: string;
}

export interface RecordedProcessExecution {
  usageDecisions: DerivationUsageDecision[];
  output: JsonValue;
  audit: RecordedProcessAuditInput;
}

export interface CreateDerivationInput {
  claimVersionId: string;
  ruleRevisionId: string;
  operationContext?: TrustedOperationContext;
  recordedProcess?: RecordedProcessExecution;
}

export const REPRODUCIBILITY_ANOMALY_CODES = [
  "rule_definition_parse_error",
  "rule_definition_not_canonical",
  "rule_definition_contract_invalid",
  "rule_definition_hash_mismatch",
  "interpreter_artifact_hash_mismatch",
  "interpreter_execution_identity_mismatch",
  "snapshot_builder_artifact_hash_mismatch",
  "input_canonical_parse_error",
  "input_canonical_not_canonical",
  "input_canonical_structure_error",
  "input_hash_mismatch",
  "output_canonical_parse_error",
  "output_canonical_not_canonical",
  "output_hash_mismatch",
  "recorded_process_audit_parse_error",
  "recorded_process_audit_not_canonical",
  "recorded_process_audit_hash_mismatch",
  "input_reference_mismatch",
  "deterministic_output_mismatch",
] as const;
export type ReproducibilityAnomalyCode =
  (typeof REPRODUCIBILITY_ANOMALY_CODES)[number];
