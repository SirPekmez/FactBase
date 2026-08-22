import { Pool, QueryResultRow } from "pg";
import databasePool from "../db";
import {
  DERIVATION_MANIFEST_DECISION_CODE,
  REPRODUCIBILITY_ANOMALY_CODES,
  ReproducibilityAnomalyCode,
} from "../types/derivation";
import {
  canonicalizeJson as exportedCanonicalizeJson,
  sha256 as exportedSha256,
} from "./canonicalJson";
import {
  getDerivationExecutionIdentity as exportedGetDerivationExecutionIdentity,
} from "./derivationExecutionIdentity";
import {
  getDerivationSnapshotBuilderIdentity as exportedGetDerivationSnapshotBuilderIdentity,
} from "./derivationInputSnapshotService";
import {
  assertDerivationInputSchemaV1 as exportedAssertDerivationInputSchemaV1,
} from "./derivationInputSchemaV1";
import {
  getDerivationInterpreterArtifactHash as exportedGetDerivationInterpreterArtifactHash,
} from "./derivationRuleInterpreter";
import {
  loadDerivationRuleRevisionForRead as exportedLoadDerivationRuleRevisionForRead,
} from "./derivationRuleService";
import { runInTransaction as exportedRunInTransaction } from "./transaction";

const sha256 = exportedSha256;
const canonicalizeJson = exportedCanonicalizeJson;
const getDerivationExecutionIdentity = exportedGetDerivationExecutionIdentity;
const getDerivationSnapshotBuilderIdentity =
  exportedGetDerivationSnapshotBuilderIdentity;
const assertDerivationInputSchemaV1 = exportedAssertDerivationInputSchemaV1;
const getDerivationInterpreterArtifactHash =
  exportedGetDerivationInterpreterArtifactHash;
const loadDerivationRuleRevisionForRead =
  exportedLoadDerivationRuleRevisionForRead;
const runInTransaction = exportedRunInTransaction;

interface DerivationRow extends QueryResultRow {
  id: string;
  claim_version_id: string;
  rule_revision_id: string;
  rule_definition_hash: string;
  interpreter_artifact_hash: string | null;
  interpreter_execution_contract_id: string | null;
  interpreter_execution_contract_version: string | null;
  interpreter_execution_contract_hash: string | null;
  interpreter_runtime_id: string | null;
  interpreter_runtime_version: string | null;
  snapshot_builder_id: string;
  snapshot_builder_version: string;
  snapshot_builder_artifact_hash: string;
  execution_method: "deterministic_rules" | "recorded_process";
  input_schema_id: string;
  input_schema_version: string;
  input_canonical: string;
  input_hash: string;
  output_schema_id: string;
  output_schema_version: string;
  output_canonical: string;
  output_hash: string;
  canonicalization_id: string;
  canonicalization_version: string;
  hash_algorithm: string;
  initiator_type: string | null;
  initiator_id: string | null;
  created_at: Date;
}

interface InputRow extends QueryResultRow {
  input_id: string;
  relation_id: string | null;
  usage: "used";
  decision_code: typeof DERIVATION_MANIFEST_DECISION_CODE;
}

interface ProcessAuditRow extends QueryResultRow {
  process_id: string;
  process_version: string;
  implementation_id: string;
  implementation_version: string;
  parameters_canonical: string;
  model_reference_id: string | null;
  model_reference_version: string | null;
  workflow_reference_id: string | null;
  workflow_reference_version: string | null;
  import_reference_type: string | null;
  import_reference: string | null;
  random_seed: string | null;
  runtime_environment_canonical: string | null;
  started_at_canonical: string;
  completed_at_canonical: string;
  audit_canonical: string;
  audit_hash: string;
  created_at: Date;
}

interface PeerRow extends QueryResultRow {
  id: string;
  output_hash: string;
}

type ReadPool = Pick<Pool, "connect">;

export class DerivationNotFoundError extends Error {
  constructor(public readonly derivationId: string) {
    super(`Derivation ${derivationId} was not found`);
    this.name = "DerivationNotFoundError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface CanonicalJsonInspection {
  value: unknown;
  parseError: boolean;
  notCanonical: boolean;
}

function inspectCanonicalJson(value: string): CanonicalJsonInspection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return { value: null, parseError: true, notCanonical: false };
  }
  try {
    return {
      value: parsed,
      parseError: false,
      notCanonical: canonicalizeJson(parsed) !== value,
    };
  } catch {
    return { value: parsed, parseError: false, notCanonical: true };
  }
}

export async function getDerivationDetails(
  derivationId: string,
  pool: ReadPool = databasePool,
) {
  return runInTransaction(
    pool,
    "Derivation read failed and the transaction could not be rolled back",
    async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const derivationResult = await client.query<DerivationRow>(
        `SELECT * FROM public.derivations WHERE id = $1`,
        [derivationId],
      );
      const derivation = derivationResult.rows[0];
      if (!derivation) {
        throw new DerivationNotFoundError(derivationId);
      }
      const ruleRead = await loadDerivationRuleRevisionForRead(
        client,
        derivation.rule_revision_id,
      );
      const rule = ruleRead.rule;
      const evidenceResult = await client.query<InputRow>(
            `SELECT
              claim_version_evidence_id AS input_id,
              claim_version_evidence_id AS relation_id,
              usage,
              decision_code
            FROM public.derivation_evidence_inputs
            WHERE derivation_id = $1
            ORDER BY claim_version_evidence_id`,
            [derivation.id],
          );
      const assessmentResult = await client.query<InputRow>(
            `SELECT
              assessment_id AS input_id,
              claim_version_evidence_id AS relation_id,
              usage,
              decision_code
            FROM public.derivation_assessment_inputs
            WHERE derivation_id = $1
            ORDER BY assessment_id`,
            [derivation.id],
          );
      const auditResult = await client.query<ProcessAuditRow>(
            `SELECT
              process_id, process_version, implementation_id,
              implementation_version, parameters_canonical,
              model_reference_id, model_reference_version,
              workflow_reference_id, workflow_reference_version,
              import_reference_type, import_reference, random_seed,
              runtime_environment_canonical,
              to_char(started_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at_canonical,
              to_char(completed_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completed_at_canonical,
              audit_canonical, audit_hash, created_at
            FROM public.derivation_recorded_process_audits
            WHERE derivation_id = $1`,
            [derivation.id],
          );
      const peerResult = await client.query<PeerRow>(
            `SELECT id, output_hash
            FROM public.derivations
            WHERE rule_revision_id = $1
              AND execution_method = 'deterministic_rules'
              AND input_hash = $2
              AND rule_definition_hash = $3
              AND interpreter_artifact_hash IS NOT DISTINCT FROM $4
            ORDER BY id`,
            [
              derivation.rule_revision_id,
              derivation.input_hash,
              derivation.rule_definition_hash,
              derivation.interpreter_artifact_hash,
            ],
          );

      const anomalyCodes = new Set<ReproducibilityAnomalyCode>();
      const definitionInspection = inspectCanonicalJson(rule.definitionCanonical);
      if (definitionInspection.parseError) {
        anomalyCodes.add("rule_definition_parse_error");
      } else if (definitionInspection.notCanonical) {
        anomalyCodes.add("rule_definition_not_canonical");
      }
      if (ruleRead.definitionIntegrity === "invalid_contract") {
        anomalyCodes.add("rule_definition_contract_invalid");
      }
      if (
        sha256(rule.definitionCanonical) !== rule.definitionHash ||
        derivation.rule_definition_hash !== rule.definitionHash
      ) {
        anomalyCodes.add("rule_definition_hash_mismatch");
      }
      if (
        derivation.execution_method === "deterministic_rules" &&
        (
          derivation.interpreter_artifact_hash !== rule.interpreterArtifactHash ||
          derivation.interpreter_artifact_hash !==
            getDerivationInterpreterArtifactHash() ||
          rule.definition === null ||
          derivation.interpreter_artifact_hash !==
            (rule.definition as Extract<
              NonNullable<typeof rule.definition>,
              { dsl: unknown }
            >).interpreter.artifactHash
        )
      ) {
        anomalyCodes.add("interpreter_artifact_hash_mismatch");
      }
      const currentExecutionIdentity = getDerivationExecutionIdentity();
      const definitionExecution =
        derivation.execution_method === "deterministic_rules" &&
        rule.definition !== null
          ? (rule.definition as Extract<
              NonNullable<typeof rule.definition>,
              { dsl: unknown }
            >).interpreter.execution
          : null;
      if (
        derivation.execution_method === "deterministic_rules" &&
        (
          derivation.interpreter_execution_contract_id !==
            rule.interpreterExecutionContractId ||
          derivation.interpreter_execution_contract_version !==
            rule.interpreterExecutionContractVersion ||
          derivation.interpreter_execution_contract_hash !==
            rule.interpreterExecutionContractHash ||
          derivation.interpreter_runtime_id !== rule.interpreterRuntimeId ||
          derivation.interpreter_runtime_version !== rule.interpreterRuntimeVersion ||
          derivation.interpreter_execution_contract_id !==
            currentExecutionIdentity.contractId ||
          derivation.interpreter_execution_contract_version !==
            currentExecutionIdentity.contractVersion ||
          derivation.interpreter_execution_contract_hash !==
            currentExecutionIdentity.contractHash ||
          derivation.interpreter_runtime_id !== currentExecutionIdentity.runtimeId ||
          derivation.interpreter_runtime_version !==
            currentExecutionIdentity.runtimeVersion ||
          definitionExecution === null ||
          definitionExecution.contractId !== currentExecutionIdentity.contractId ||
          definitionExecution.contractVersion !==
            currentExecutionIdentity.contractVersion ||
          definitionExecution.contractHash !== currentExecutionIdentity.contractHash ||
          definitionExecution.runtimeId !== currentExecutionIdentity.runtimeId ||
          definitionExecution.runtimeVersion !== currentExecutionIdentity.runtimeVersion
        )
      ) {
        anomalyCodes.add("interpreter_execution_identity_mismatch");
      }
      const currentSnapshotBuilder = getDerivationSnapshotBuilderIdentity();
      if (
        derivation.snapshot_builder_id !== rule.snapshotBuilderId ||
        derivation.snapshot_builder_version !== rule.snapshotBuilderVersion ||
        derivation.snapshot_builder_artifact_hash !==
          rule.snapshotBuilderArtifactHash ||
        derivation.snapshot_builder_id !== currentSnapshotBuilder.id ||
        derivation.snapshot_builder_version !== currentSnapshotBuilder.version ||
        derivation.snapshot_builder_artifact_hash !==
          currentSnapshotBuilder.artifactHash
      ) {
        anomalyCodes.add("snapshot_builder_artifact_hash_mismatch");
      }
      if (sha256(derivation.input_canonical) !== derivation.input_hash) {
        anomalyCodes.add("input_hash_mismatch");
      }
      const inputInspection = inspectCanonicalJson(derivation.input_canonical);
      let inputStructureValid = false;
      if (inputInspection.parseError) {
        anomalyCodes.add("input_canonical_parse_error");
      } else {
        if (inputInspection.notCanonical) {
          anomalyCodes.add("input_canonical_not_canonical");
        }
        try {
          assertDerivationInputSchemaV1(inputInspection.value);
          inputStructureValid = true;
        } catch {
          anomalyCodes.add("input_canonical_structure_error");
        }
      }
      if (sha256(derivation.output_canonical) !== derivation.output_hash) {
        anomalyCodes.add("output_hash_mismatch");
      }
      const outputInspection = inspectCanonicalJson(derivation.output_canonical);
      if (outputInspection.parseError) {
        anomalyCodes.add("output_canonical_parse_error");
      } else if (outputInspection.notCanonical) {
        anomalyCodes.add("output_canonical_not_canonical");
      }
      const audit = auditResult.rows[0] ?? null;
      const auditInspection = audit
        ? inspectCanonicalJson(audit.audit_canonical)
        : null;
      const parametersInspection = audit
        ? inspectCanonicalJson(audit.parameters_canonical)
        : null;
      const runtimeInspection = audit?.runtime_environment_canonical
        ? inspectCanonicalJson(audit.runtime_environment_canonical)
        : null;
      if (audit) {
        if (
          auditInspection?.parseError ||
          parametersInspection?.parseError ||
          runtimeInspection?.parseError
        ) {
          anomalyCodes.add("recorded_process_audit_parse_error");
        } else if (
          auditInspection?.notCanonical ||
          parametersInspection?.notCanonical ||
          runtimeInspection?.notCanonical
        ) {
          anomalyCodes.add("recorded_process_audit_not_canonical");
        }
        const auditOutputHash =
          auditInspection?.value !== null &&
          typeof auditInspection?.value === "object" &&
          !Array.isArray(auditInspection.value)
            ? (auditInspection.value as { outputHash?: unknown }).outputHash
            : undefined;
        if (
          sha256(audit.audit_canonical) !== audit.audit_hash ||
          auditOutputHash !== derivation.output_hash
        ) {
          anomalyCodes.add("recorded_process_audit_hash_mismatch");
        }
      }

      const inputSnapshot = inputInspection.value as {
        evidenceRelations?: Array<{
          relationId: string;
          assessments?: Array<{ id: string }>;
        }>;
      } | null;
      const referencedEvidenceIds = evidenceResult.rows
        .map(({ input_id }) => input_id)
        .sort(compareText);
      const referencedAssessmentIds = assessmentResult.rows
        .map(({ input_id }) => input_id)
        .sort(compareText);
      if (inputStructureValid && inputSnapshot !== null) {
        const snapshotEvidenceIds = (inputSnapshot.evidenceRelations ?? [])
          .map(({ relationId }) => relationId)
          .sort(compareText);
        const snapshotAssessmentIds = (inputSnapshot.evidenceRelations ?? [])
          .flatMap(({ assessments = [] }) => assessments.map(({ id }) => id))
          .sort(compareText);
        if (
          JSON.stringify(snapshotEvidenceIds) !==
            JSON.stringify(referencedEvidenceIds) ||
          JSON.stringify(snapshotAssessmentIds) !==
            JSON.stringify(referencedAssessmentIds)
        ) {
          anomalyCodes.add("input_reference_mismatch");
        }
      }

      const distinctOutputHashes = [
        ...new Set(peerResult.rows.map(({ output_hash }) => output_hash)),
      ].sort(compareText);
      if (
        derivation.execution_method === "deterministic_rules" &&
        distinctOutputHashes.length > 1
      ) {
        anomalyCodes.add("deterministic_output_mismatch");
      }
      const codes = [...anomalyCodes].sort(
        (left, right) =>
          REPRODUCIBILITY_ANOMALY_CODES.indexOf(left) -
          REPRODUCIBILITY_ANOMALY_CODES.indexOf(right),
      );

      return {
        id: derivation.id,
        claimVersionId: derivation.claim_version_id,
        ruleRevision: rule,
        historicalRuleBinding: {
          definitionHash: derivation.rule_definition_hash,
          interpreterArtifactHash: derivation.interpreter_artifact_hash,
          interpreterExecutionIdentity:
            derivation.execution_method === "deterministic_rules"
              ? {
                  contractId: derivation.interpreter_execution_contract_id,
                  contractVersion:
                    derivation.interpreter_execution_contract_version,
                  contractHash: derivation.interpreter_execution_contract_hash,
                  runtimeId: derivation.interpreter_runtime_id,
                  runtimeVersion: derivation.interpreter_runtime_version,
                }
              : null,
          snapshotBuilder: {
            id: derivation.snapshot_builder_id,
            version: derivation.snapshot_builder_version,
            artifactHash: derivation.snapshot_builder_artifact_hash,
          },
        },
        executionMethod: derivation.execution_method,
        input: {
          schema: {
            id: derivation.input_schema_id,
            version: derivation.input_schema_version,
          },
          canonical: derivation.input_canonical,
          hash: derivation.input_hash,
          value: inputSnapshot,
          evidenceRelations: evidenceResult.rows.map((row) => ({
            id: row.input_id,
            usage: row.usage,
            decisionCode: row.decision_code,
          })),
          assessments: assessmentResult.rows.map((row) => ({
            id: row.input_id,
            claimVersionEvidenceId: row.relation_id,
            usage: row.usage,
            decisionCode: row.decision_code,
          })),
        },
        output: {
          schema: {
            id: derivation.output_schema_id,
            version: derivation.output_schema_version,
          },
          canonical: derivation.output_canonical,
          hash: derivation.output_hash,
          value: outputInspection.value,
        },
        processAudit: audit
          ? {
              process: { id: audit.process_id, version: audit.process_version },
              implementation: {
                id: audit.implementation_id,
                version: audit.implementation_version,
              },
              parameters: parametersInspection?.value ?? null,
              parametersCanonical: audit.parameters_canonical,
              modelReference:
                audit.model_reference_id === null
                  ? null
                  : {
                      id: audit.model_reference_id,
                      version: audit.model_reference_version,
                      referentiallyVerified: false,
                    },
              workflowReference:
                audit.workflow_reference_id === null
                  ? null
                  : {
                      id: audit.workflow_reference_id,
                      version: audit.workflow_reference_version,
                      referentiallyVerified: false,
                    },
              importReference:
                audit.import_reference_type === null
                  ? null
                  : {
                      referenceType: audit.import_reference_type,
                      reference: audit.import_reference,
                      referentiallyVerified: false,
                    },
              randomSeed: audit.random_seed,
              runtimeEnvironment:
                audit.runtime_environment_canonical === null
                  ? null
                  : runtimeInspection?.value ?? null,
              runtimeEnvironmentCanonical:
                audit.runtime_environment_canonical,
              startedAt: audit.started_at_canonical,
              completedAt: audit.completed_at_canonical,
              canonical: audit.audit_canonical,
              hash: audit.audit_hash,
              value: auditInspection?.value ?? null,
              createdAt: audit.created_at,
            }
          : null,
        initiator:
          derivation.initiator_type === null
            ? null
            : { type: derivation.initiator_type, id: derivation.initiator_id },
        reproducibility: {
          status: codes.length === 0 ? "valid" : "anomalies_detected",
          anomalies: codes.map((code) => ({
            code,
            ...(code === "deterministic_output_mismatch"
              ? {
                  derivationIds: peerResult.rows.map(({ id }) => id),
                  outputHashes: distinctOutputHashes,
                }
              : {}),
          })),
        },
        canonicalization: {
          id: derivation.canonicalization_id,
          version: derivation.canonicalization_version,
          hashAlgorithm: derivation.hash_algorithm,
        },
        createdAt: derivation.created_at,
      };
    },
  );
}
