import type {
  DerivationUsageDecision,
  DeterministicRuleDefinition,
  JsonValue,
} from "../types/derivation";
import {
  canonicalizeAndHash as exportedCanonicalizeAndHash,
  getCanonicalJsonArtifactHash as exportedGetCanonicalJsonArtifactHash,
} from "./canonicalJson";
import {
  getDerivationExecutionIdentity as exportedGetDerivationExecutionIdentity,
} from "./derivationExecutionIdentity";
import {
  appendArrayElement as exportedAppendArrayElement,
  createSafeWeakSet as exportedCreateSafeWeakSet,
  getDerivationSafeRuntimeArtifactHash as exportedGetDerivationSafeRuntimeArtifactHash,
  loadedFunctionSource as exportedLoadedFunctionSource,
  safeDeepFreeze as exportedSafeDeepFreeze,
  safeFreeze as exportedSafeFreeze,
  safeSha256 as exportedSafeSha256,
  safeWeakSetAdd as exportedSafeWeakSetAdd,
  safeWeakSetHas as exportedSafeWeakSetHas,
} from "./derivationSafeRuntime";

function initializeInterpreterBindings() {
  return Object.freeze({
    canonicalizeAndHash: exportedCanonicalizeAndHash,
    getCanonicalJsonArtifactHash: exportedGetCanonicalJsonArtifactHash,
    getDerivationExecutionIdentity: exportedGetDerivationExecutionIdentity,
    appendArrayElement: exportedAppendArrayElement,
    createSafeWeakSet: exportedCreateSafeWeakSet,
    getDerivationSafeRuntimeArtifactHash:
      exportedGetDerivationSafeRuntimeArtifactHash,
    loadedFunctionSource: exportedLoadedFunctionSource,
    safeDeepFreeze: exportedSafeDeepFreeze,
    safeFreeze: exportedSafeFreeze,
    safeSha256: exportedSafeSha256,
    safeWeakSetAdd: exportedSafeWeakSetAdd,
    safeWeakSetHas: exportedSafeWeakSetHas,
  });
}

const INTERPRETER_BINDINGS = initializeInterpreterBindings();

const SUPPORTED_DSL_ID = "factbase-derivation-rule-dsl";
const SUPPORTED_DSL_VERSION = "1";
const SUPPORTED_INTERPRETER_ID = "factbase-derivation-rule-interpreter";
const SUPPORTED_INTERPRETER_VERSION = "1";
const MANIFEST_DECISION_CODE = "included_in_manifest" as const;
const initializedExecutionIdentity =
  INTERPRETER_BINDINGS.getDerivationExecutionIdentity();
const EXECUTION_CONTRACT_ID = initializedExecutionIdentity.contractId;
const EXECUTION_CONTRACT_VERSION = initializedExecutionIdentity.contractVersion;
const EXECUTION_CONTRACT_HASH = initializedExecutionIdentity.contractHash;
const EXECUTION_RUNTIME_ID = initializedExecutionIdentity.runtimeId;
const EXECUTION_RUNTIME_VERSION = initializedExecutionIdentity.runtimeVersion;

interface NeutralSnapshot {
  claimVersion: { id: string };
  evidenceRelations: Array<{
    relationId: string;
    assessments: Array<{ id: string }>;
    assessmentGraph: {
      integrity: {
        anomalies: Array<{ code: string; assessmentIds: string[] }>;
      };
    };
  }>;
}

export interface DeterministicInterpretation {
  usageDecisions: DerivationUsageDecision[];
  output: JsonValue;
}

export interface DeterministicExecution extends DeterministicInterpretation {
  outputCanonical: string;
  outputHash: string;
  outputSchema: { id: string; version: string };
  interpreterArtifactHash: string;
  executionIdentity: ReturnType<typeof exportedGetDerivationExecutionIdentity>;
}

function initializeDeterministicExecutionRegistry() {
  const finalizedExecutions = INTERPRETER_BINDINGS.createSafeWeakSet();
  return INTERPRETER_BINDINGS.safeFreeze({
    add(value: object): void {
      INTERPRETER_BINDINGS.safeWeakSetAdd(finalizedExecutions, value);
    },
    has(value: object): boolean {
      return INTERPRETER_BINDINGS.safeWeakSetHas(finalizedExecutions, value);
    },
  });
}

const DETERMINISTIC_EXECUTION_REGISTRY =
  initializeDeterministicExecutionRegistry();

function finalizeDeterministicExecution(
  execution: DeterministicExecution,
): DeterministicExecution {
  INTERPRETER_BINDINGS.safeDeepFreeze(execution);
  const finalized = execution;
  DETERMINISTIC_EXECUTION_REGISTRY.add(finalized);
  return finalized as DeterministicExecution;
}

export function assertFinalizedDeterministicExecution(
  value: DeterministicExecution,
): DeterministicExecution {
  if (
    typeof value !== "object" ||
    value === null ||
    !DETERMINISTIC_EXECUTION_REGISTRY.has(value)
  ) {
    throw new Error("Deterministic execution was not finalized by the bound interpreter");
  }
  const currentExecutionIdentity =
    INTERPRETER_BINDINGS.getDerivationExecutionIdentity();
  if (
    value.interpreterArtifactHash !== getDerivationInterpreterArtifactHash() ||
    value.executionIdentity.contractId !== currentExecutionIdentity.contractId ||
    value.executionIdentity.contractVersion !==
      currentExecutionIdentity.contractVersion ||
    value.executionIdentity.contractHash !== currentExecutionIdentity.contractHash ||
    value.executionIdentity.runtimeId !== currentExecutionIdentity.runtimeId ||
    value.executionIdentity.runtimeVersion !== currentExecutionIdentity.runtimeVersion
  ) {
    throw new Error("Deterministic execution identity mismatch");
  }
  const verified = INTERPRETER_BINDINGS.canonicalizeAndHash({
    schema: value.outputSchema,
    result: value.output,
  });
  if (
    verified.canonical !== value.outputCanonical ||
    verified.hash !== value.outputHash
  ) {
    throw new Error("Deterministic execution canonical binding mismatch");
  }
  return value;
}

export function interpretDeterministicRule(
  definition: DeterministicRuleDefinition,
  snapshot: NeutralSnapshot,
  inputHash: string,
): DeterministicInterpretation {
  if (
    definition.dsl.id !== SUPPORTED_DSL_ID ||
    definition.dsl.version !== SUPPORTED_DSL_VERSION ||
    definition.interpreter.id !== SUPPORTED_INTERPRETER_ID ||
    definition.interpreter.version !== SUPPORTED_INTERPRETER_VERSION ||
    definition.interpreter.artifactHash !== getDerivationInterpreterArtifactHash() ||
    definition.interpreter.execution.contractId !== EXECUTION_CONTRACT_ID ||
    definition.interpreter.execution.contractVersion !==
      EXECUTION_CONTRACT_VERSION ||
    definition.interpreter.execution.contractHash !== EXECUTION_CONTRACT_HASH ||
    definition.interpreter.execution.runtimeId !== EXECUTION_RUNTIME_ID ||
    definition.interpreter.execution.runtimeVersion !== EXECUTION_RUNTIME_VERSION ||
    definition.output.operation !== "input_manifest"
  ) {
    throw new Error("Unsupported deterministic derivation rule contract");
  }

  const evidenceDecisions: DerivationUsageDecision[] = [];
  const assessmentDecisions: DerivationUsageDecision[] = [];
  const evidenceOutput: JsonValue[] = [];
  const assessmentOutput: JsonValue[] = [];
  const graphAnomalyOutput: JsonValue[] = [];

  for (
    let relationIndex = 0;
    relationIndex < snapshot.evidenceRelations.length;
    relationIndex += 1
  ) {
    const relation = snapshot.evidenceRelations[relationIndex];
    const evidenceDecision: DerivationUsageDecision = {
      inputKind: "evidence_relation",
      inputId: relation.relationId,
      usage: "used",
      decisionCode: MANIFEST_DECISION_CODE,
    };
    INTERPRETER_BINDINGS.appendArrayElement(evidenceDecisions, evidenceDecision);
    INTERPRETER_BINDINGS.appendArrayElement(evidenceOutput, {
      id: evidenceDecision.inputId,
      usage: evidenceDecision.usage,
      decisionCode: evidenceDecision.decisionCode,
    });

    for (
      let assessmentIndex = 0;
      assessmentIndex < relation.assessments.length;
      assessmentIndex += 1
    ) {
      const assessmentDecision: DerivationUsageDecision = {
        inputKind: "assessment",
        inputId: relation.assessments[assessmentIndex].id,
        usage: "used",
        decisionCode: MANIFEST_DECISION_CODE,
      };
      INTERPRETER_BINDINGS.appendArrayElement(
        assessmentDecisions,
        assessmentDecision,
      );
      INTERPRETER_BINDINGS.appendArrayElement(assessmentOutput, {
        id: assessmentDecision.inputId,
        usage: assessmentDecision.usage,
        decisionCode: assessmentDecision.decisionCode,
      });
    }

    const anomalies = relation.assessmentGraph.integrity.anomalies;
    for (
      let anomalyIndex = 0;
      anomalyIndex < anomalies.length;
      anomalyIndex += 1
    ) {
      const anomaly = anomalies[anomalyIndex];
      INTERPRETER_BINDINGS.appendArrayElement(graphAnomalyOutput, {
        claimVersionEvidenceId: relation.relationId,
        code: anomaly.code,
        assessmentIds: anomaly.assessmentIds,
      });
    }
  }

  const usageDecisions: DerivationUsageDecision[] = [];
  for (let index = 0; index < evidenceDecisions.length; index += 1) {
    INTERPRETER_BINDINGS.appendArrayElement(
      usageDecisions,
      evidenceDecisions[index],
    );
  }
  for (let index = 0; index < assessmentDecisions.length; index += 1) {
    INTERPRETER_BINDINGS.appendArrayElement(
      usageDecisions,
      assessmentDecisions[index],
    );
  }

  return {
    usageDecisions,
    output: {
      operation: "input_manifest",
      claimVersionId: snapshot.claimVersion.id,
      inputHash,
      evidenceRelations: evidenceOutput,
      assessments: assessmentOutput,
      assessmentGraphAnomalies: graphAnomalyOutput,
    },
  };
}

export function executeDeterministicRule(
  definition: DeterministicRuleDefinition,
  snapshot: NeutralSnapshot,
  inputHash: string,
  outputSchemaId: string,
  outputSchemaVersion: string,
): DeterministicExecution {
  const interpreted = interpretDeterministicRule(definition, snapshot, inputHash);
  const outputEnvelope: JsonValue = {
    schema: { id: outputSchemaId, version: outputSchemaVersion },
    result: interpreted.output,
  };
  const canonicalOutput =
    INTERPRETER_BINDINGS.canonicalizeAndHash(outputEnvelope);
  return finalizeDeterministicExecution({
    usageDecisions: interpreted.usageDecisions,
    output: interpreted.output,
    outputCanonical: canonicalOutput.canonical,
    outputHash: canonicalOutput.hash,
    outputSchema: { id: outputSchemaId, version: outputSchemaVersion },
    interpreterArtifactHash: getDerivationInterpreterArtifactHash(),
    executionIdentity: INTERPRETER_BINDINGS.getDerivationExecutionIdentity(),
  });
}

export function getDerivationInterpreterArtifactHash(): string {
  return LOADED_INTERPRETER_ARTIFACT_HASH;
}

const LOADED_INTERPRETER_ARTIFACT_HASH = INTERPRETER_BINDINGS.safeSha256(
  [
    "factbase-loaded-interpreter-artifact-v1",
    "private-module-captures-v2",
    SUPPORTED_DSL_ID,
    SUPPORTED_DSL_VERSION,
    SUPPORTED_INTERPRETER_ID,
    SUPPORTED_INTERPRETER_VERSION,
    MANIFEST_DECISION_CODE,
    EXECUTION_CONTRACT_ID,
    EXECUTION_CONTRACT_VERSION,
    EXECUTION_CONTRACT_HASH,
    EXECUTION_RUNTIME_ID,
    EXECUTION_RUNTIME_VERSION,
    INTERPRETER_BINDINGS.getDerivationSafeRuntimeArtifactHash(),
    INTERPRETER_BINDINGS.getCanonicalJsonArtifactHash(),
    INTERPRETER_BINDINGS.loadedFunctionSource(initializeInterpreterBindings),
    INTERPRETER_BINDINGS.loadedFunctionSource(
      initializeDeterministicExecutionRegistry,
    ),
    INTERPRETER_BINDINGS.loadedFunctionSource(
      INTERPRETER_BINDINGS.canonicalizeAndHash,
    ),
    INTERPRETER_BINDINGS.loadedFunctionSource(
      INTERPRETER_BINDINGS.appendArrayElement,
    ),
    INTERPRETER_BINDINGS.loadedFunctionSource(interpretDeterministicRule),
    INTERPRETER_BINDINGS.loadedFunctionSource(executeDeterministicRule),
    INTERPRETER_BINDINGS.loadedFunctionSource(finalizeDeterministicExecution),
    INTERPRETER_BINDINGS.loadedFunctionSource(
      assertFinalizedDeterministicExecution,
    ),
    INTERPRETER_BINDINGS.loadedFunctionSource(
      getDerivationInterpreterArtifactHash,
    ),
  ].join("\n"),
);
