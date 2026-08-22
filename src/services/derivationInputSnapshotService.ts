import { PoolClient, QueryResultRow } from "pg";
import {
  canonicalizePostgreSqlNumeric as exportedCanonicalizePostgreSqlNumeric,
  getCanonicalDecimalArtifactHash as exportedGetCanonicalDecimalArtifactHash,
} from "./canonicalDecimal";
import {
  buildDerivationAssessmentGraph as exportedBuildDerivationAssessmentGraph,
  getDerivationAssessmentGraphArtifactHash as exportedGetDerivationAssessmentGraphArtifactHash,
} from "./derivationAssessmentGraph";
import {
  canonicalizeAndHash as exportedCanonicalizeAndHash,
  getCanonicalJsonArtifactHash as exportedGetCanonicalJsonArtifactHash,
} from "./canonicalJson";
import {
  getDerivationExecutionIdentity as exportedGetDerivationExecutionIdentity,
} from "./derivationExecutionIdentity";
import {
  assertDerivationInputSchemaV1 as exportedAssertDerivationInputSchemaV1,
  getDerivationInputSchemaV1ArtifactHash as exportedGetDerivationInputSchemaV1ArtifactHash,
} from "./derivationInputSchemaV1";
import {
  appendArrayElement as exportedAppendArrayElement,
  createSafeWeakSet as exportedCreateSafeWeakSet,
  getDerivationSafeRuntimeArtifactHash as exportedGetDerivationSafeRuntimeArtifactHash,
  loadedFunctionSource as exportedLoadedFunctionSource,
  safeLowerCase as exportedSafeLowerCase,
  safeDeepFreeze as exportedSafeDeepFreeze,
  safeFreeze as exportedSafeFreeze,
  safeSha256 as exportedSafeSha256,
  safeWeakSetAdd as exportedSafeWeakSetAdd,
  safeWeakSetHas as exportedSafeWeakSetHas,
} from "./derivationSafeRuntime";
import {
  DERIVATION_INPUT_SCHEMA_ID,
  DERIVATION_INPUT_SCHEMA_VERSION,
  DERIVATION_SNAPSHOT_BUILDER_ID,
  DERIVATION_SNAPSHOT_BUILDER_VERSION,
} from "../types/derivation";

function initializeSnapshotBuilderBindings() {
  return Object.freeze({
    canonicalizePostgreSqlNumeric: exportedCanonicalizePostgreSqlNumeric,
    getCanonicalDecimalArtifactHash: exportedGetCanonicalDecimalArtifactHash,
    buildDerivationAssessmentGraph: exportedBuildDerivationAssessmentGraph,
    getDerivationAssessmentGraphArtifactHash:
      exportedGetDerivationAssessmentGraphArtifactHash,
    canonicalizeAndHash: exportedCanonicalizeAndHash,
    getCanonicalJsonArtifactHash: exportedGetCanonicalJsonArtifactHash,
    getDerivationExecutionIdentity: exportedGetDerivationExecutionIdentity,
    assertDerivationInputSchemaV1: exportedAssertDerivationInputSchemaV1,
    getDerivationInputSchemaV1ArtifactHash:
      exportedGetDerivationInputSchemaV1ArtifactHash,
    appendArrayElement: exportedAppendArrayElement,
    createSafeWeakSet: exportedCreateSafeWeakSet,
    getDerivationSafeRuntimeArtifactHash:
      exportedGetDerivationSafeRuntimeArtifactHash,
    loadedFunctionSource: exportedLoadedFunctionSource,
    safeLowerCase: exportedSafeLowerCase,
    safeDeepFreeze: exportedSafeDeepFreeze,
    safeFreeze: exportedSafeFreeze,
    safeSha256: exportedSafeSha256,
    safeWeakSetAdd: exportedSafeWeakSetAdd,
    safeWeakSetHas: exportedSafeWeakSetHas,
  });
}

const SNAPSHOT_BUILDER_BINDINGS = initializeSnapshotBuilderBindings();
const INPUT_SCHEMA_ID = DERIVATION_INPUT_SCHEMA_ID;
const INPUT_SCHEMA_VERSION = DERIVATION_INPUT_SCHEMA_VERSION;
const SNAPSHOT_BUILDER_ID = DERIVATION_SNAPSHOT_BUILDER_ID;
const SNAPSHOT_BUILDER_VERSION = DERIVATION_SNAPSHOT_BUILDER_VERSION;

interface VersionRow extends QueryResultRow {
  id: string;
  claim_id: string;
  version_number: number;
  title: string;
  normalized_statement: string;
  language: string;
  claim_type: string;
  status: string;
  publication_status: string;
  change_reason: string;
  based_on_version_id: string | null;
  actor_type: string | null;
  actor_id: string | null;
  source_type: string | null;
  source_reference: string | null;
  request_id: string | null;
  created_at_canonical: string;
}

interface EvidenceRow extends QueryResultRow {
  relation_id: string;
  evidence_id: string;
  relation: string;
  source_url: string | null;
  source_title: string | null;
  source_type: string | null;
  locator: string | null;
  quoted_text: string | null;
  snapshot_hash: string | null;
  retrieved_at_canonical: string;
  evidence_created_at_canonical: string;
  relation_created_at_canonical: string;
}

interface AssessmentRow extends QueryResultRow {
  id: string;
  relation_id: string;
  source_quality_decimal: string | null;
  relevance_decimal: string | null;
  directness_decimal: string | null;
  recency_decimal: string | null;
  independence_decimal: string | null;
  assessment_method: string | null;
  rationale: string | null;
  assessed_by: string | null;
  initiator_type: string | null;
  initiator_id: string | null;
  responds_to_assessment_id: string | null;
  response_relation: string | null;
  parent_assessment_id: string | null;
  parent_relation_id: string | null;
  rubric_id: string | null;
  rubric_version: string | null;
  recency_reference_type: string | null;
  recency_reference_at_canonical: string | null;
  rule_set_id: string | null;
  rule_set_version: string | null;
  model_id: string | null;
  model_version: string | null;
  model_process_type: string | null;
  model_process_version: string | null;
  import_reference_type: string | null;
  import_reference: string | null;
  assessed_at_canonical: string;
}

interface ComparisonRow extends QueryResultRow {
  assessment_id: string;
  comparison_claim_version_evidence_id: string;
}

export interface DerivationSnapshotResult {
  snapshot: {
    schema: { id: string; version: string };
    claimVersion: { id: string; [key: string]: unknown };
    evidenceRelations: Array<{
      relationId: string;
      assessments: Array<{ id: string }>;
      assessmentGraph: {
        integrity: { anomalies: Array<{ code: string; assessmentIds: string[] }> };
      };
      [key: string]: unknown;
    }>;
  };
  inputCanonical: string;
  inputHash: string;
  evidenceRelationIds: string[];
  assessmentRelations: Array<{ assessmentId: string; relationId: string }>;
  builderIdentity: DerivationSnapshotBuilderIdentity;
}

export class DerivationClaimVersionNotFoundError extends Error {
  constructor(public readonly claimVersionId: string) {
    super(`Claim version ${claimVersionId} was not found`);
    this.name = "DerivationClaimVersionNotFoundError";
  }
}

function initializeSnapshotResultRegistry() {
  const finalizedResults = SNAPSHOT_BUILDER_BINDINGS.createSafeWeakSet();
  return SNAPSHOT_BUILDER_BINDINGS.safeFreeze({
    add(value: object): void {
      SNAPSHOT_BUILDER_BINDINGS.safeWeakSetAdd(finalizedResults, value);
    },
    has(value: object): boolean {
      return SNAPSHOT_BUILDER_BINDINGS.safeWeakSetHas(finalizedResults, value);
    },
  });
}

const SNAPSHOT_RESULT_REGISTRY = initializeSnapshotResultRegistry();

function finalizeSnapshotResult(
  result: DerivationSnapshotResult,
): DerivationSnapshotResult {
  SNAPSHOT_BUILDER_BINDINGS.safeDeepFreeze(result);
  const finalized = result;
  SNAPSHOT_RESULT_REGISTRY.add(finalized);
  return finalized as DerivationSnapshotResult;
}

export function assertFinalizedDerivationSnapshotResult(
  value: DerivationSnapshotResult,
): DerivationSnapshotResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !SNAPSHOT_RESULT_REGISTRY.has(value)
  ) {
    throw new Error("Derivation snapshot result was not finalized by the bound builder");
  }
  const currentIdentity = getDerivationSnapshotBuilderIdentity();
  if (
    value.builderIdentity.id !== currentIdentity.id ||
    value.builderIdentity.version !== currentIdentity.version ||
    value.builderIdentity.artifactHash !== currentIdentity.artifactHash
  ) {
    throw new Error("Derivation snapshot result builder identity mismatch");
  }
  const verified = SNAPSHOT_BUILDER_BINDINGS.canonicalizeAndHash(value.snapshot);
  if (
    verified.canonical !== value.inputCanonical ||
    verified.hash !== value.inputHash
  ) {
    throw new Error("Derivation snapshot result canonical binding mismatch");
  }
  return value;
}

function uuid(value: string | null): string | null {
  return value === null ? null : SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(value);
}

function decimal(value: string | null): string | null {
  return value === null
    ? null
    : SNAPSHOT_BUILDER_BINDINGS.canonicalizePostgreSqlNumeric(value);
}

function assessmentsForRelation(
  assessments: ReadonlyArray<AssessmentRow>,
  relationId: string,
): AssessmentRow[] {
  const result: AssessmentRow[] = [];
  for (let index = 0; index < assessments.length; index += 1) {
    if (
      SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(
        assessments[index].relation_id,
      ) === relationId
    ) {
      SNAPSHOT_BUILDER_BINDINGS.appendArrayElement(result, assessments[index]);
    }
  }
  return result;
}

function comparisonsForAssessment(
  comparisons: ReadonlyArray<ComparisonRow>,
  assessmentId: string,
): string[] {
  const result: string[] = [];
  for (let index = 0; index < comparisons.length; index += 1) {
    if (
      SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(
        comparisons[index].assessment_id,
      ) === assessmentId
    ) {
      SNAPSHOT_BUILDER_BINDINGS.appendArrayElement(
        result,
        SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(
          comparisons[index].comparison_claim_version_evidence_id,
        ),
      );
    }
  }
  return result;
}

export async function loadDerivationInputSnapshot(
  client: PoolClient,
  claimVersionId: string,
): Promise<DerivationSnapshotResult> {
  const versionResult = await client.query<VersionRow>(
    `SELECT
      id, claim_id, version_number, title, normalized_statement, language,
      claim_type, status, publication_status, change_reason,
      based_on_version_id, actor_type, actor_id, source_type,
      source_reference, request_id,
      to_char(
        created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS created_at_canonical
    FROM public.claim_versions
    WHERE id = $1`,
    [claimVersionId],
  );
  const version = versionResult.rows[0];
  if (!version) {
    throw new DerivationClaimVersionNotFoundError(claimVersionId);
  }

  const evidenceResult = await client.query<EvidenceRow>(
    `SELECT
      cve.id AS relation_id,
      e.id AS evidence_id,
      cve.relation,
      e.source_url,
      e.source_title,
      e.source_type,
      e.locator,
      e.quoted_text,
      e.snapshot_hash,
      to_char(
        e.retrieved_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS retrieved_at_canonical,
      to_char(
        e.created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS evidence_created_at_canonical,
      to_char(
        cve.created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS relation_created_at_canonical
    FROM public.claim_version_evidence cve
    INNER JOIN public.evidence e ON e.id = cve.evidence_id
    WHERE cve.claim_version_id = $1
    ORDER BY cve.created_at, cve.id`,
    [claimVersionId],
  );

  const assessmentResult = await client.query<AssessmentRow>(
    `SELECT
      ea.id,
      ea.claim_version_evidence_id AS relation_id,
      ea.source_quality::text AS source_quality_decimal,
      ea.relevance::text AS relevance_decimal,
      ea.directness::text AS directness_decimal,
      ea.recency::text AS recency_decimal,
      ea.independence::text AS independence_decimal,
      ea.assessment_method,
      ea.rationale,
      ea.assessed_by,
      ea.initiator_type,
      ea.initiator_id,
      ea.responds_to_assessment_id,
      ea.response_relation,
      parent.id AS parent_assessment_id,
      parent.claim_version_evidence_id AS parent_relation_id,
      ea.rubric_id,
      ea.rubric_version,
      ea.recency_reference_type,
      CASE WHEN ea.recency_reference_at IS NULL THEN NULL ELSE to_char(
        ea.recency_reference_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) END AS recency_reference_at_canonical,
      ea.rule_set_id,
      ea.rule_set_version,
      ea.model_id,
      ea.model_version,
      ea.model_process_type,
      ea.model_process_version,
      ea.import_reference_type,
      ea.import_reference,
      to_char(
        ea.assessed_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS assessed_at_canonical
    FROM public.evidence_assessments ea
    INNER JOIN public.claim_version_evidence cve
      ON cve.id = ea.claim_version_evidence_id
    LEFT JOIN public.evidence_assessments parent
      ON parent.id = ea.responds_to_assessment_id
    WHERE cve.claim_version_id = $1
    ORDER BY ea.assessed_at, ea.id`,
    [claimVersionId],
  );

  const comparisonResult = await client.query<ComparisonRow>(
    `SELECT
      eaic.assessment_id,
      eaic.comparison_claim_version_evidence_id
    FROM public.evidence_assessment_independence_comparisons eaic
    INNER JOIN public.evidence_assessments ea ON ea.id = eaic.assessment_id
    INNER JOIN public.claim_version_evidence cve
      ON cve.id = ea.claim_version_evidence_id
    WHERE cve.claim_version_id = $1
    ORDER BY eaic.assessment_id, eaic.comparison_claim_version_evidence_id`,
    [claimVersionId],
  );

  const evidenceRelations: DerivationSnapshotResult["snapshot"]["evidenceRelations"] = [];
  for (let evidenceIndex = 0; evidenceIndex < evidenceResult.rows.length; evidenceIndex += 1) {
    const evidence = evidenceResult.rows[evidenceIndex];
    const relationId = SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(
      evidence.relation_id,
    );
    const relationAssessments = assessmentsForRelation(
      assessmentResult.rows,
      relationId,
    );
    const mappedAssessments: Array<{ id: string; [key: string]: unknown }> = [];
    const graphAssessments: Array<{
      id: string;
      responds_to_assessment_id: string | null;
      response_relation: string | null;
      parent_assessment_id: string | null;
      parent_relation_id: string | null;
    }> = [];
    for (
      let assessmentIndex = 0;
      assessmentIndex < relationAssessments.length;
      assessmentIndex += 1
    ) {
      const assessment = relationAssessments[assessmentIndex];
      const assessmentId = SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(
        assessment.id,
      );
      SNAPSHOT_BUILDER_BINDINGS.appendArrayElement(mappedAssessments, {
        id: assessmentId,
        claimVersionEvidenceId: relationId,
        sourceQuality: decimal(assessment.source_quality_decimal),
        relevance: decimal(assessment.relevance_decimal),
        directness: decimal(assessment.directness_decimal),
        recency: decimal(assessment.recency_decimal),
        independence: decimal(assessment.independence_decimal),
        rubric:
          assessment.rubric_id === null && assessment.rubric_version === null
            ? null
            : { id: assessment.rubric_id, version: assessment.rubric_version },
        recencyContext:
          assessment.recency_reference_type === null &&
          assessment.recency_reference_at_canonical === null
            ? null
            : {
                referenceType: assessment.recency_reference_type,
                referenceAt: assessment.recency_reference_at_canonical,
              },
        independenceComparisonRelationIds: comparisonsForAssessment(
          comparisonResult.rows,
          assessmentId,
        ),
        method: {
          type: assessment.assessment_method,
          ruleSet:
            assessment.rule_set_id === null && assessment.rule_set_version === null
              ? null
              : { id: assessment.rule_set_id, version: assessment.rule_set_version },
          model:
            assessment.model_id === null &&
            assessment.model_version === null &&
            assessment.model_process_type === null &&
            assessment.model_process_version === null
              ? null
              : {
                  id: assessment.model_id,
                  version: assessment.model_version,
                  processType: assessment.model_process_type,
                  processVersion: assessment.model_process_version,
                },
          imported:
            assessment.import_reference_type === null &&
            assessment.import_reference === null
              ? null
              : {
                  referenceType: assessment.import_reference_type,
                  reference: assessment.import_reference,
                },
        },
        rationale: assessment.rationale,
        initiator:
          assessment.initiator_type === null
            ? null
            : { type: assessment.initiator_type, id: assessment.initiator_id },
        responseTo:
          assessment.responds_to_assessment_id === null &&
          assessment.response_relation === null
            ? null
            : {
                assessmentId: uuid(assessment.responds_to_assessment_id),
                relation: assessment.response_relation,
              },
        legacyAssessedBy: assessment.assessed_by,
        assessedAt: assessment.assessed_at_canonical,
      });
      SNAPSHOT_BUILDER_BINDINGS.appendArrayElement(graphAssessments, {
        id: assessmentId,
        responds_to_assessment_id: uuid(assessment.responds_to_assessment_id),
        response_relation: assessment.response_relation,
        parent_assessment_id: uuid(assessment.parent_assessment_id),
        parent_relation_id: uuid(assessment.parent_relation_id),
      });
    }
    SNAPSHOT_BUILDER_BINDINGS.appendArrayElement(evidenceRelations, {
      relationId,
      evidenceId: SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(evidence.evidence_id),
      relation: evidence.relation,
      relationCreatedAt: evidence.relation_created_at_canonical,
      evidence: {
        sourceUrl: evidence.source_url,
        sourceTitle: evidence.source_title,
        sourceType: evidence.source_type,
        locator: evidence.locator,
        quotedText: evidence.quoted_text,
        snapshotHash: evidence.snapshot_hash,
        retrievedAt: evidence.retrieved_at_canonical,
        createdAt: evidence.evidence_created_at_canonical,
      },
      assessments: mappedAssessments,
      assessmentGraph: SNAPSHOT_BUILDER_BINDINGS.buildDerivationAssessmentGraph(
        graphAssessments,
        relationId,
      ),
    });
  }

  const evidenceRelationIds: string[] = [];
  for (let index = 0; index < evidenceRelations.length; index += 1) {
    SNAPSHOT_BUILDER_BINDINGS.appendArrayElement(
      evidenceRelationIds,
      evidenceRelations[index].relationId,
    );
  }
  const assessmentRelations: Array<{ assessmentId: string; relationId: string }> = [];
  for (let index = 0; index < assessmentResult.rows.length; index += 1) {
    SNAPSHOT_BUILDER_BINDINGS.appendArrayElement(assessmentRelations, {
      assessmentId: SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(
        assessmentResult.rows[index].id,
      ),
      relationId: SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(
        assessmentResult.rows[index].relation_id,
      ),
    });
  }

  const snapshot: DerivationSnapshotResult["snapshot"] = {
    schema: {
      id: INPUT_SCHEMA_ID,
      version: INPUT_SCHEMA_VERSION,
    },
    claimVersion: {
      id: SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(version.id),
      claimId: SNAPSHOT_BUILDER_BINDINGS.safeLowerCase(version.claim_id),
      versionNumber: version.version_number,
      title: version.title,
      normalizedStatement: version.normalized_statement,
      language: version.language,
      claimType: version.claim_type,
      status: version.status,
      publicationStatus: version.publication_status,
      changeReason: version.change_reason,
      basedOnVersionId: uuid(version.based_on_version_id),
      actor: { type: version.actor_type, id: version.actor_id },
      source: { type: version.source_type, reference: version.source_reference },
      requestId: uuid(version.request_id),
      createdAt: version.created_at_canonical,
    },
    evidenceRelations,
  };
  SNAPSHOT_BUILDER_BINDINGS.assertDerivationInputSchemaV1(snapshot);
  const canonicalInput = SNAPSHOT_BUILDER_BINDINGS.canonicalizeAndHash(snapshot);

  return finalizeSnapshotResult({
    snapshot,
    inputCanonical: canonicalInput.canonical,
    inputHash: canonicalInput.hash,
    evidenceRelationIds,
    assessmentRelations,
    builderIdentity: getDerivationSnapshotBuilderIdentity(),
  });
}

const DERIVATION_SNAPSHOT_BUILDER_ARTIFACT_HASH =
  SNAPSHOT_BUILDER_BINDINGS.safeSha256(
  [
    "factbase-derivation-snapshot-builder-artifact-v1",
    "private-module-captures-v2",
    INPUT_SCHEMA_ID,
    INPUT_SCHEMA_VERSION,
    SNAPSHOT_BUILDER_ID,
    SNAPSHOT_BUILDER_VERSION,
    SNAPSHOT_BUILDER_BINDINGS.getDerivationExecutionIdentity().contractHash,
    SNAPSHOT_BUILDER_BINDINGS.getDerivationSafeRuntimeArtifactHash(),
    SNAPSHOT_BUILDER_BINDINGS.getCanonicalJsonArtifactHash(),
    SNAPSHOT_BUILDER_BINDINGS.getCanonicalDecimalArtifactHash(),
    SNAPSHOT_BUILDER_BINDINGS.getDerivationAssessmentGraphArtifactHash(),
    SNAPSHOT_BUILDER_BINDINGS.getDerivationInputSchemaV1ArtifactHash(),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(
      initializeSnapshotBuilderBindings,
    ),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(
      initializeSnapshotResultRegistry,
    ),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(
      SNAPSHOT_BUILDER_BINDINGS.canonicalizeAndHash,
    ),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(
      SNAPSHOT_BUILDER_BINDINGS.canonicalizePostgreSqlNumeric,
    ),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(
      SNAPSHOT_BUILDER_BINDINGS.buildDerivationAssessmentGraph,
    ),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(
      SNAPSHOT_BUILDER_BINDINGS.assertDerivationInputSchemaV1,
    ),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(uuid),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(decimal),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(assessmentsForRelation),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(comparisonsForAssessment),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(finalizeSnapshotResult),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(
      assertFinalizedDerivationSnapshotResult,
    ),
    SNAPSHOT_BUILDER_BINDINGS.loadedFunctionSource(
      loadDerivationInputSnapshot,
    ),
  ].join("\n"),
);

export interface DerivationSnapshotBuilderIdentity {
  id: typeof SNAPSHOT_BUILDER_ID;
  version: typeof SNAPSHOT_BUILDER_VERSION;
  artifactHash: string;
}

export function getDerivationSnapshotBuilderIdentity(): DerivationSnapshotBuilderIdentity {
  return {
    id: SNAPSHOT_BUILDER_ID,
    version: SNAPSHOT_BUILDER_VERSION,
    artifactHash: DERIVATION_SNAPSHOT_BUILDER_ARTIFACT_HASH,
  };
}
