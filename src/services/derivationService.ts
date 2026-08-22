import { randomUUID } from "node:crypto";
import { Pool, QueryResultRow } from "pg";
import databasePool from "../db";
import {
  CANONICALIZATION_ID,
  CANONICALIZATION_VERSION,
  CreateDerivationInput,
  DerivationRuleRevision,
  DerivationUsageDecision,
  HASH_ALGORITHM,
  JsonValue,
  RecordedProcessAuditInput,
} from "../types/derivation";
import {
  canonicalizeAndHash as exportedCanonicalizeAndHash,
  validateCanonicalTimestamp as exportedValidateCanonicalTimestamp,
} from "./canonicalJson";
import {
  getDerivationExecutionIdentity as exportedGetDerivationExecutionIdentity,
} from "./derivationExecutionIdentity";
import {
  getDerivationSnapshotBuilderIdentity as exportedGetDerivationSnapshotBuilderIdentity,
  assertFinalizedDerivationSnapshotResult,
  loadDerivationInputSnapshot as exportedLoadDerivationInputSnapshot,
} from "./derivationInputSnapshotService";
import {
  getDerivationInterpreterArtifactHash as exportedGetDerivationInterpreterArtifactHash,
  assertFinalizedDeterministicExecution,
  executeDeterministicRule as exportedExecuteDeterministicRule,
} from "./derivationRuleInterpreter";
import {
  loadDerivationRuleRevision as exportedLoadDerivationRuleRevision,
} from "./derivationRuleService";
import { runInTransaction as exportedRunInTransaction } from "./transaction";

const canonicalizeAndHash = exportedCanonicalizeAndHash;
const validateCanonicalTimestamp = exportedValidateCanonicalTimestamp;
const getDerivationExecutionIdentity = exportedGetDerivationExecutionIdentity;
const getDerivationSnapshotBuilderIdentity =
  exportedGetDerivationSnapshotBuilderIdentity;
const loadFinalizedDerivationInputSnapshot = exportedLoadDerivationInputSnapshot;
const verifyFinalizedDerivationInputSnapshot =
  assertFinalizedDerivationSnapshotResult;
const getDerivationInterpreterArtifactHash =
  exportedGetDerivationInterpreterArtifactHash;
const executeFinalizedDeterministicRule = exportedExecuteDeterministicRule;
const verifyFinalizedDeterministicExecution =
  assertFinalizedDeterministicExecution;
const loadDerivationRuleRevision = exportedLoadDerivationRuleRevision;
const runInTransaction = exportedRunInTransaction;

interface DerivationRow extends QueryResultRow {
  id: string;
  created_at: Date;
}

type DerivationPool = Pick<Pool, "connect">;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function hasOnlyKeys(value: object, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function canonicalUuid(value: string): string {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!pattern.test(value)) {
    throw new Error(`Invalid derivation input UUID: ${value}`);
  }
  return value.toLowerCase();
}

function verifyRuleRevision(rule: DerivationRuleRevision) {
  const canonical = canonicalizeAndHash(rule.definition);
  if (
    canonical.canonical !== rule.definitionCanonical ||
    canonical.hash !== rule.definitionHash
  ) {
    throw new Error("Derivation rule definition hash mismatch");
  }
  if (
    rule.reproducibilityMode === "deterministic_rules" &&
    (
      rule.interpreterExecutionContractId !==
        getDerivationExecutionIdentity().contractId ||
      rule.interpreterExecutionContractVersion !==
        getDerivationExecutionIdentity().contractVersion ||
      rule.interpreterExecutionContractHash !==
        getDerivationExecutionIdentity().contractHash ||
      rule.interpreterRuntimeId !== getDerivationExecutionIdentity().runtimeId ||
      rule.interpreterRuntimeVersion !==
        getDerivationExecutionIdentity().runtimeVersion ||
      rule.interpreterArtifactHash !== getDerivationInterpreterArtifactHash() ||
      rule.interpreterArtifactHash !==
        (rule.definition as Extract<typeof rule.definition, { dsl: unknown }>)
          .interpreter.artifactHash ||
      (rule.definition as Extract<typeof rule.definition, { dsl: unknown }>)
        .interpreter.execution.contractId !==
        getDerivationExecutionIdentity().contractId ||
      (rule.definition as Extract<typeof rule.definition, { dsl: unknown }>)
        .interpreter.execution.contractVersion !==
        getDerivationExecutionIdentity().contractVersion ||
      (rule.definition as Extract<typeof rule.definition, { dsl: unknown }>)
        .interpreter.execution.contractHash !==
        getDerivationExecutionIdentity().contractHash ||
      (rule.definition as Extract<typeof rule.definition, { dsl: unknown }>)
        .interpreter.execution.runtimeId !==
        getDerivationExecutionIdentity().runtimeId ||
      (rule.definition as Extract<typeof rule.definition, { dsl: unknown }>)
        .interpreter.execution.runtimeVersion !==
        getDerivationExecutionIdentity().runtimeVersion
    )
  ) {
    throw new Error("Derivation interpreter artifact hash mismatch");
  }
  const snapshotBuilder = getDerivationSnapshotBuilderIdentity();
  if (
    rule.snapshotBuilderId !== snapshotBuilder.id ||
    rule.snapshotBuilderVersion !== snapshotBuilder.version ||
    rule.snapshotBuilderArtifactHash !== snapshotBuilder.artifactHash
  ) {
    throw new Error("Derivation snapshot builder artifact hash mismatch");
  }
}

function validateUsageDecisions(
  rule: DerivationRuleRevision,
  decisions: DerivationUsageDecision[],
  evidenceIds: string[],
  assessmentIds: string[],
) {
  const normalized = decisions.map((decision) => ({
    ...decision,
    inputId: canonicalUuid(decision.inputId),
  }));
  const keys = normalized.map(
    (decision) => `${decision.inputKind}\u0000${decision.inputId}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("Every derivation candidate must be classified exactly once");
  }

  const expected = [
    ...evidenceIds.map((id) => `evidence_relation\u0000${id}`),
    ...assessmentIds.map((id) => `assessment\u0000${id}`),
  ].sort(compareText);
  if (JSON.stringify([...keys].sort(compareText)) !== JSON.stringify(expected)) {
    throw new Error("Derivation usage decisions do not cover the exact snapshot candidates");
  }

  for (const decision of normalized) {
    if (
      !rule.decisionCodes.some(
        (code) =>
          code.inputKind === decision.inputKind &&
          code.usage === decision.usage &&
          code.code === decision.decisionCode,
      )
    ) {
      throw new Error("Derivation usage decision uses an undeclared decision code");
    }
  }
  return normalized;
}

function validateReference(
  reference: { id: string; version: string } | undefined,
  field: string,
) {
  if (!reference) return null;
  if (!hasOnlyKeys(reference, ["id", "version"])) {
    throw new Error(`${field} contains an unknown field`);
  }
  requireNonEmpty(reference.id, `${field}.id`);
  requireNonEmpty(reference.version, `${field}.version`);
  return {
    id: reference.id,
    version: reference.version,
    referentiallyVerified: false,
  };
}

function buildRecordedProcessAudit(
  audit: RecordedProcessAuditInput,
  outputHash: string,
) {
  if (
    !hasOnlyKeys(audit, [
      "processId", "processVersion", "implementationId", "implementationVersion",
      "parameters", "modelReference", "workflowReference", "importReference",
      "randomSeed", "runtimeEnvironment", "startedAt", "completedAt",
    ])
  ) {
    throw new Error("Recorded process audit contains an unknown field");
  }
  requireNonEmpty(audit.processId, "processId");
  requireNonEmpty(audit.processVersion, "processVersion");
  requireNonEmpty(audit.implementationId, "implementationId");
  requireNonEmpty(audit.implementationVersion, "implementationVersion");
  const startedAt = validateCanonicalTimestamp(audit.startedAt);
  const completedAt = validateCanonicalTimestamp(audit.completedAt);
  if (completedAt < startedAt) {
    throw new Error("Recorded process completedAt must not precede startedAt");
  }
  if (audit.randomSeed !== undefined) {
    requireNonEmpty(audit.randomSeed, "randomSeed");
  }
  const model = validateReference(audit.modelReference, "modelReference");
  const workflow = validateReference(audit.workflowReference, "workflowReference");
  let imported: JsonValue = null;
  if (audit.importReference) {
    if (!hasOnlyKeys(audit.importReference, ["referenceType", "reference"])) {
      throw new Error("Import reference contains an unknown field");
    }
    if (!(["import_run", "external_record"] as const).includes(
      audit.importReference.referenceType,
    )) {
      throw new Error("Invalid import reference type");
    }
    requireNonEmpty(audit.importReference.reference, "importReference.reference");
    imported = {
      referenceType: audit.importReference.referenceType,
      reference: audit.importReference.reference,
      referentiallyVerified: false,
    };
  }
  if (audit.runtimeEnvironment !== undefined && !Array.isArray(audit.runtimeEnvironment)) {
    throw new Error("runtimeEnvironment must be an array when present");
  }
  const runtimeEnvironment = audit.runtimeEnvironment
    ? audit.runtimeEnvironment
        .map((component) => {
          if (!hasOnlyKeys(component, ["id", "version"])) {
            throw new Error("Runtime environment component contains an unknown field");
          }
          requireNonEmpty(component.id, "runtimeEnvironment.id");
          requireNonEmpty(component.version, "runtimeEnvironment.version");
          return { id: component.id, version: component.version };
        })
        .sort((left, right) =>
          compareText(`${left.id}\u0000${left.version}`, `${right.id}\u0000${right.version}`),
        )
    : null;
  if (
    runtimeEnvironment &&
    new Set(runtimeEnvironment.map(({ id, version }) => `${id}\u0000${version}`)).size !==
      runtimeEnvironment.length
  ) {
    throw new Error("Runtime environment components must be unique");
  }

  const parameters = canonicalizeAndHash(audit.parameters);
  const runtime = runtimeEnvironment
    ? canonicalizeAndHash(runtimeEnvironment)
    : null;
  const value: JsonValue = {
    schema: { id: "factbase-recorded-process-audit", version: "1" },
    process: { id: audit.processId, version: audit.processVersion },
    implementation: {
      id: audit.implementationId,
      version: audit.implementationVersion,
    },
    parameters: audit.parameters,
    references: { model, workflow, import: imported },
    randomSeed: audit.randomSeed ?? null,
    runtimeEnvironment,
    startedAt,
    completedAt,
    outputHash,
  };
  const canonical = canonicalizeAndHash(value);
  return {
    value,
    canonical: canonical.canonical,
    hash: canonical.hash,
    parametersCanonical: parameters.canonical,
    runtimeEnvironmentCanonical: runtime?.canonical ?? null,
    model,
    workflow,
    imported,
  };
}

export async function createDerivation(
  input: CreateDerivationInput,
  pool: DerivationPool = databasePool,
) {
  const claimVersionId = canonicalUuid(input.claimVersionId);
  const ruleRevisionId = canonicalUuid(input.ruleRevisionId);
  const derivationId = randomUUID();

  return runInTransaction(
    pool,
    "Derivation creation failed and the transaction could not be rolled back",
    async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");

      // The first domain read establishes the version snapshot before the rule is loaded.
      const snapshotResult = verifyFinalizedDerivationInputSnapshot(
        await loadFinalizedDerivationInputSnapshot(client, claimVersionId),
      );
      const rule = await loadDerivationRuleRevision(client, ruleRevisionId);
      verifyRuleRevision(rule);
      const snapshot = snapshotResult.snapshot as unknown as {
        schema: { id: string; version: string };
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
      };
      if (
        snapshot.schema.id !== rule.inputSchemaId ||
        snapshot.schema.version !== rule.inputSchemaVersion
      ) {
        throw new Error("Derivation snapshot schema does not match the rule revision");
      }

      let rawDecisions: DerivationUsageDecision[];
      let rawOutput: JsonValue;
      let deterministicOutput:
        | { outputCanonical: string; outputHash: string }
        | null = null;
      let rawAudit: RecordedProcessAuditInput | undefined;
      if (rule.reproducibilityMode === "deterministic_rules") {
        if (input.recordedProcess !== undefined) {
          throw new Error("deterministic_rules must not receive a recorded process");
        }
        const interpreted = verifyFinalizedDeterministicExecution(
          executeFinalizedDeterministicRule(
            rule.definition as Extract<typeof rule.definition, { dsl: unknown }>,
            snapshot,
            snapshotResult.inputHash,
            rule.outputSchemaId,
            rule.outputSchemaVersion,
          ),
        );
        rawDecisions = interpreted.usageDecisions;
        rawOutput = interpreted.output;
        deterministicOutput = interpreted;
      } else {
        if (!input.recordedProcess) {
          throw new Error("recorded_process requires a complete execution record");
        }
        if (
          !hasOnlyKeys(input.recordedProcess, ["usageDecisions", "output", "audit"])
        ) {
          throw new Error("Recorded process execution contains an unknown field");
        }
        rawDecisions = input.recordedProcess.usageDecisions;
        rawOutput = input.recordedProcess.output;
        rawAudit = input.recordedProcess.audit;
      }

      const decisions = validateUsageDecisions(
        rule,
        rawDecisions,
        snapshotResult.evidenceRelationIds,
        snapshotResult.assessmentRelations.map(({ assessmentId }) => assessmentId),
      );
      const recordedOutput = deterministicOutput
        ? null
        : canonicalizeAndHash({
            schema: { id: rule.outputSchemaId, version: rule.outputSchemaVersion },
            result: rawOutput,
          });
      const outputCanonical = deterministicOutput
        ? deterministicOutput.outputCanonical
        : recordedOutput!.canonical;
      const outputHash = deterministicOutput
        ? deterministicOutput.outputHash
        : recordedOutput!.hash;
      const processAudit = rawAudit
        ? buildRecordedProcessAudit(rawAudit, outputHash)
        : null;
      const initiator = input.operationContext?.initiator;
      if (initiator) {
        if (
          !(["human", "system", "importer", "agent"] as const).includes(
            initiator.type,
          ) ||
          !(initiator.id === null ||
            (typeof initiator.id === "string" && initiator.id.trim() !== ""))
        ) {
          throw new Error("Invalid trusted derivation initiator");
        }
      }

      const derivationResult = await client.query<DerivationRow>(
        `INSERT INTO public.derivations (
          id, claim_version_id, rule_revision_id, rule_definition_hash,
          interpreter_artifact_hash,
          interpreter_execution_contract_id,
          interpreter_execution_contract_version,
          interpreter_execution_contract_hash,
          interpreter_runtime_id, interpreter_runtime_version,
          snapshot_builder_id, snapshot_builder_version,
          snapshot_builder_artifact_hash, execution_method,
          input_schema_id, input_schema_version, input_canonical, input_hash,
          output_schema_id, output_schema_version, output_canonical, output_hash,
          canonicalization_id, canonicalization_version, hash_algorithm,
          initiator_type, initiator_id, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
          $23, $24, $25, $26, $27, CURRENT_TIMESTAMP
        ) RETURNING id, created_at`,
        [
          derivationId, claimVersionId, rule.id, rule.definitionHash,
          rule.interpreterArtifactHash,
          rule.interpreterExecutionContractId,
          rule.interpreterExecutionContractVersion,
          rule.interpreterExecutionContractHash,
          rule.interpreterRuntimeId,
          rule.interpreterRuntimeVersion,
          rule.snapshotBuilderId,
          rule.snapshotBuilderVersion,
          rule.snapshotBuilderArtifactHash,
          rule.reproducibilityMode,
          rule.inputSchemaId, rule.inputSchemaVersion,
          snapshotResult.inputCanonical, snapshotResult.inputHash,
          rule.outputSchemaId, rule.outputSchemaVersion,
          outputCanonical, outputHash,
          CANONICALIZATION_ID, CANONICALIZATION_VERSION, HASH_ALGORITHM,
          initiator?.type ?? null, initiator?.id ?? null,
        ],
      );
      const derivation = derivationResult.rows[0];
      if (!derivation) {
        throw new Error("Derivation insert returned no row");
      }

      const decisionsByKey = new Map(
        decisions.map((decision) => [
          `${decision.inputKind}\u0000${decision.inputId}`,
          decision,
        ]),
      );
      for (const relationId of snapshotResult.evidenceRelationIds) {
        const decision = decisionsByKey.get(`evidence_relation\u0000${relationId}`)!;
        await client.query(
          `INSERT INTO public.derivation_evidence_inputs (
            derivation_id, rule_revision_id, claim_version_id,
            claim_version_evidence_id, input_kind, usage, decision_code, created_at
          ) VALUES ($1, $2, $3, $4, 'evidence_relation', $5, $6, CURRENT_TIMESTAMP)`,
          [derivation.id, rule.id, claimVersionId, relationId, decision.usage, decision.decisionCode],
        );
      }
      for (const assessment of snapshotResult.assessmentRelations) {
        const decision = decisionsByKey.get(`assessment\u0000${assessment.assessmentId}`)!;
        await client.query(
          `INSERT INTO public.derivation_assessment_inputs (
            derivation_id, rule_revision_id, claim_version_id,
            claim_version_evidence_id, assessment_id, input_kind,
            usage, decision_code, created_at
          ) VALUES ($1, $2, $3, $4, $5, 'assessment', $6, $7, CURRENT_TIMESTAMP)`,
          [
            derivation.id, rule.id, claimVersionId, assessment.relationId,
            assessment.assessmentId, decision.usage, decision.decisionCode,
          ],
        );
      }

      if (processAudit && rawAudit) {
        await client.query(
          `INSERT INTO public.derivation_recorded_process_audits (
            derivation_id, process_id, process_version,
            implementation_id, implementation_version,
            parameters_canonical,
            model_reference_id, model_reference_version,
            workflow_reference_id, workflow_reference_version,
            import_reference_type, import_reference, random_seed,
            runtime_environment_canonical, started_at, completed_at,
            audit_canonical, audit_hash, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP
          )`,
          [
            derivation.id, rawAudit.processId, rawAudit.processVersion,
            rawAudit.implementationId, rawAudit.implementationVersion,
            processAudit.parametersCanonical,
            rawAudit.modelReference?.id ?? null,
            rawAudit.modelReference?.version ?? null,
            rawAudit.workflowReference?.id ?? null,
            rawAudit.workflowReference?.version ?? null,
            rawAudit.importReference?.referenceType ?? null,
            rawAudit.importReference?.reference ?? null,
            rawAudit.randomSeed ?? null,
            processAudit.runtimeEnvironmentCanonical,
            rawAudit.startedAt, rawAudit.completedAt,
            processAudit.canonical, processAudit.hash,
          ],
        );
      }

      return {
        id: derivation.id,
        claimVersionId,
        ruleRevisionId: rule.id,
        ruleDefinitionHash: rule.definitionHash,
        interpreterArtifactHash: rule.interpreterArtifactHash,
        interpreterExecutionIdentity:
          rule.reproducibilityMode === "deterministic_rules"
            ? {
                contractId: rule.interpreterExecutionContractId,
                contractVersion: rule.interpreterExecutionContractVersion,
                contractHash: rule.interpreterExecutionContractHash,
                runtimeId: rule.interpreterRuntimeId,
                runtimeVersion: rule.interpreterRuntimeVersion,
              }
            : null,
        snapshotBuilder: {
          id: rule.snapshotBuilderId,
          version: rule.snapshotBuilderVersion,
          artifactHash: rule.snapshotBuilderArtifactHash,
        },
        executionMethod: rule.reproducibilityMode,
        inputHash: snapshotResult.inputHash,
        outputHash,
        processAuditHash: processAudit?.hash ?? null,
        createdAt: derivation.created_at,
      };
    },
  );
}
