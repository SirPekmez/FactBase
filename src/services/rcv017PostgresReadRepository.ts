import { Pool, PoolClient, QueryResultRow } from "pg";
import { Rcv016HistoricalSnapshotReadV1 } from "./rcv016ReadRepositoryContract";
import { Rcv016PostgresHistoricalReadRepository } from "./rcv016PostgresReadRepository";

type ReadPool = Pick<Pool, "connect">;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class Rcv017ReadRepositoryError extends Error {
  readonly code = "validation_failure" as const;
  constructor(message: string) { super(message); this.name = "Rcv017ReadRepositoryError"; }
}

export interface Rcv017PersistedAnalysisReadBundleV1 {
  readonly header: Row;
  readonly policyHeader: Row | null;
  readonly policyRelationships: readonly Row[];
  readonly evidenceRelations: readonly Row[];
  readonly bindings: readonly Row[];
  readonly sharedArtifactFindings: readonly Row[];
  readonly sharedArtifactMembers: readonly Row[];
  readonly commonUpstreamFindings: readonly Row[];
  readonly commonUpstreamMembers: readonly Row[];
  readonly commonUpstreamWitnessSteps: readonly Row[];
  readonly noCommonUpstreamFindings: readonly Row[];
  readonly knowledgeIncompleteFindings: readonly Row[];
  readonly knowledgeAffectedArtifacts: readonly Row[];
  readonly knowledgeStateEvidence: readonly Row[];
  readonly derivedUnrecordedEvidence: readonly Row[];
  readonly historicalClaimVersion: Row | null;
  readonly historicalEvidenceRelations: readonly Row[];
  readonly historicalEvidenceIds: readonly string[];
  readonly rcv016SnapshotRead: Rcv016HistoricalSnapshotReadV1 | null;
}

export interface Rcv017AnalysisReadRepositoryV1 {
  loadAnalysisById(analysisId: string): Promise<Rcv017PersistedAnalysisReadBundleV1 | null>;
}

function integer(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("PostgreSQL returned an unsafe integer");
  return result;
}

async function rows(client: PoolClient, sql: string, analysisId: string): Promise<QueryResultRow[]> {
  return (await client.query(sql, [analysisId])).rows;
}

async function loadRcv017(
  client: PoolClient,
  analysisId: string,
): Promise<Omit<Rcv017PersistedAnalysisReadBundleV1, "rcv016SnapshotRead"> | null> {
  const headerResult = await client.query(
    `SELECT analysis_id::text AS "analysisId", analysis_schema_id AS "analysisSchemaId",
      analysis_schema_version AS "analysisSchemaVersion", claim_version_id::text AS "claimVersionId",
      provenance_snapshot_id::text AS "provenanceSnapshotId", provenance_snapshot_hash AS "provenanceSnapshotHash",
      dependency_analysis_policy_id::text AS "dependencyAnalysisPolicyId",
      dependency_analysis_policy_version AS "dependencyAnalysisPolicyVersion",
      dependency_analysis_policy_hash AS "dependencyAnalysisPolicyHash", algorithm_id AS "algorithmId",
      algorithm_version AS "algorithmVersion", algorithm_artifact_hash AS "algorithmArtifactHash",
      canonicalization_id AS "canonicalizationId", canonicalization_version AS "canonicalizationVersion",
      hash_algorithm AS "hashAlgorithm", analysis_canonical AS "analysisCanonical",
      analysis_hash AS "analysisHash",
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
     FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1`,
    [analysisId],
  );
  if (headerResult.rowCount !== 1) return null;
  const header = headerResult.rows[0] as Row;
  (header as Record<string, unknown>).dependencyAnalysisPolicyVersion =
    integer(header.dependencyAnalysisPolicyVersion);
  const policyResult = await client.query(
    `SELECT policy_id::text AS "policyId", policy_version AS "policyVersion", schema_id AS "schemaId",
      schema_version AS "schemaVersion", relationship_classification_catalog_id AS "relationshipClassificationCatalogId",
      relationship_classification_catalog_version AS "relationshipClassificationCatalogVersion",
      evidence_direction_partition_rule AS "evidenceDirectionPartitionRule", reflexive_closure_rule AS "reflexiveClosureRule",
      common_upstream_rule AS "commonUpstreamRule", negative_finding_rule AS "negativeFindingRule",
      knowledge_limitation_rule AS "knowledgeLimitationRule", witness_selection_rule AS "witnessSelectionRule",
      finding_vocabulary_rule AS "findingVocabularyRule", cycle_handling_rule AS "cycleHandlingRule",
      deterministic_ordering_rule AS "deterministicOrderingRule", max_evidence_relations AS "maxEvidenceRelations",
      max_bindings AS "maxBindings", max_artifact_versions AS "maxArtifactVersions", max_statements AS "maxStatements",
      max_dependency_depth AS "maxDependencyDepth", max_findings AS "maxFindings", max_canonical_bytes AS "maxCanonicalBytes",
      canonicalization_id AS "canonicalizationId", canonicalization_version AS "canonicalizationVersion",
      hash_algorithm AS "hashAlgorithm", definition_canonical AS "definitionCanonical", definition_hash AS "definitionHash"
     FROM public.dependency_analysis_policies
     WHERE policy_id=$1 AND policy_version=$2 AND definition_hash=$3`,
    [header.dependencyAnalysisPolicyId, header.dependencyAnalysisPolicyVersion, header.dependencyAnalysisPolicyHash],
  );
  const policyHeader = policyResult.rowCount === 1 ? policyResult.rows[0] as Row : null;
  if (policyHeader) {
    for (const key of ["policyVersion","maxEvidenceRelations","maxBindings","maxArtifactVersions","maxStatements","maxDependencyDepth","maxFindings","maxCanonicalBytes"]) {
      (policyHeader as Record<string, unknown>)[key] = integer(policyHeader[key]);
    }
  }
  const policyRelationships = policyHeader === null ? [] : (await client.query(
    `SELECT policy_id::text AS "policyId", policy_version AS "policyVersion", relationship
     FROM public.dependency_analysis_policy_relationships WHERE policy_id=$1 AND policy_version=$2`,
    [policyHeader.policyId, policyHeader.policyVersion],
  )).rows.map((row) => ({ ...row, policyVersion: integer(row.policyVersion) }));

  const evidenceRelations = await rows(client, `SELECT claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId", evidence_id::text AS "evidenceId", direction FROM public.dependency_analysis_evidence_relations WHERE analysis_id=$1`, analysisId);
  const bindings = await rows(client, `SELECT provenance_snapshot_id::text AS "provenanceSnapshotId", claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId", evidence_artifact_binding_statement_id::text AS "evidenceArtifactBindingStatementId", evidence_id::text AS "evidenceId", artifact_version_id::text AS "artifactVersionId" FROM public.dependency_analysis_bindings WHERE analysis_id=$1`, analysisId);
  const sharedArtifactFindings = await rows(client, `SELECT direction,artifact_version_id::text AS "artifactVersionId" FROM public.dependency_analysis_shared_artifact_findings WHERE analysis_id=$1`, analysisId);
  const sharedArtifactMembers = await rows(client, `SELECT direction,artifact_version_id::text AS "artifactVersionId",claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId",evidence_artifact_binding_statement_id::text AS "evidenceArtifactBindingStatementId" FROM public.dependency_analysis_shared_artifact_members WHERE analysis_id=$1`, analysisId);
  const commonUpstreamFindings = await rows(client, `SELECT direction,upstream_artifact_version_id::text AS "upstreamArtifactVersionId" FROM public.dependency_analysis_common_upstream_findings WHERE analysis_id=$1`, analysisId);
  const commonUpstreamMembers = await rows(client, `SELECT direction,upstream_artifact_version_id::text AS "upstreamArtifactVersionId",claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId",evidence_artifact_binding_statement_id::text AS "evidenceArtifactBindingStatementId" FROM public.dependency_analysis_common_upstream_members WHERE analysis_id=$1`, analysisId);
  const commonUpstreamWitnessSteps = (await rows(client, `SELECT provenance_snapshot_id::text AS "provenanceSnapshotId",direction,upstream_artifact_version_id::text AS "upstreamArtifactVersionId",claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId",evidence_artifact_binding_statement_id::text AS "evidenceArtifactBindingStatementId",ordinal,artifact_version_id::text AS "artifactVersionId",artifact_provenance_statement_id::text AS "artifactProvenanceStatementId" FROM public.dependency_analysis_common_upstream_witness_steps WHERE analysis_id=$1`, analysisId)).map((row) => ({ ...row, ordinal: integer(row.ordinal) }));
  const noCommonUpstreamFindings = await rows(client, `SELECT direction,lower_claim_version_evidence_relation_id::text AS "lowerClaimVersionEvidenceRelationId",lower_evidence_artifact_binding_statement_id::text AS "lowerEvidenceArtifactBindingStatementId",upper_claim_version_evidence_relation_id::text AS "upperClaimVersionEvidenceRelationId",upper_evidence_artifact_binding_statement_id::text AS "upperEvidenceArtifactBindingStatementId" FROM public.dependency_analysis_no_common_upstream_findings WHERE analysis_id=$1`, analysisId);
  const knowledgeIncompleteFindings = await rows(client, `SELECT claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId",evidence_artifact_binding_statement_id::text AS "evidenceArtifactBindingStatementId" FROM public.dependency_analysis_knowledge_incomplete_findings WHERE analysis_id=$1`, analysisId);
  const knowledgeAffectedArtifacts = await rows(client, `SELECT claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId",evidence_artifact_binding_statement_id::text AS "evidenceArtifactBindingStatementId",artifact_version_id::text AS "artifactVersionId" FROM public.dependency_analysis_knowledge_affected_artifacts WHERE analysis_id=$1`, analysisId);
  const knowledgeStateEvidence = await rows(client, `SELECT provenance_snapshot_id::text AS "provenanceSnapshotId",claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId",evidence_artifact_binding_statement_id::text AS "evidenceArtifactBindingStatementId",knowledge_state_statement_id::text AS "knowledgeStateStatementId" FROM public.dependency_analysis_knowledge_state_evidence WHERE analysis_id=$1`, analysisId);
  const derivedUnrecordedEvidence = await rows(client, `SELECT claim_version_evidence_relation_id::text AS "claimVersionEvidenceRelationId",evidence_artifact_binding_statement_id::text AS "evidenceArtifactBindingStatementId",artifact_version_id::text AS "artifactVersionId" FROM public.dependency_analysis_derived_unrecorded_evidence WHERE analysis_id=$1`, analysisId);

  const claim = await client.query(`SELECT id::text AS id FROM public.claim_versions WHERE id=$1`, [header.claimVersionId]);
  const relationIds = evidenceRelations.map((row) => row.claimVersionEvidenceRelationId);
  const historicalRelations = relationIds.length === 0 ? { rows: [] } : await client.query(
    `SELECT id::text AS "claimVersionEvidenceRelationId",claim_version_id::text AS "claimVersionId",evidence_id::text AS "evidenceId",relation AS direction FROM public.claim_version_evidence WHERE id=ANY($1::uuid[])`,
    [relationIds],
  );
  const evidenceIds = [...new Set(evidenceRelations.map((row) => String(row.evidenceId)))];
  const evidence = evidenceIds.length === 0 ? { rows: [] } : await client.query(`SELECT id::text AS id FROM public.evidence WHERE id=ANY($1::uuid[])`, [evidenceIds]);
  return {
    header,
    policyHeader,
    policyRelationships,
    evidenceRelations,
    bindings,
    sharedArtifactFindings,
    sharedArtifactMembers,
    commonUpstreamFindings,
    commonUpstreamMembers,
    commonUpstreamWitnessSteps,
    noCommonUpstreamFindings,
    knowledgeIncompleteFindings,
    knowledgeAffectedArtifacts,
    knowledgeStateEvidence,
    derivedUnrecordedEvidence,
    historicalClaimVersion: claim.rowCount === 1 ? claim.rows[0] as Row : null,
    historicalEvidenceRelations: historicalRelations.rows,
    historicalEvidenceIds: evidence.rows.map((row) => String(row.id)),
  };
}

/** CONTRACT-MAPPED exact-ID retrieval boundary; it performs no verification or repair. */
export class Rcv017PostgresAnalysisReadRepository implements Rcv017AnalysisReadRepositoryV1 {
  private readonly snapshotRepository: Rcv016PostgresHistoricalReadRepository;
  constructor(private readonly pool: ReadPool) {
    this.snapshotRepository = new Rcv016PostgresHistoricalReadRepository(pool);
  }

  async loadAnalysisById(analysisId: string): Promise<Rcv017PersistedAnalysisReadBundleV1 | null> {
    if (typeof analysisId !== "string" || !UUID.test(analysisId)) {
      throw new Rcv017ReadRepositoryError("analysisId must be a lowercase canonical UUID");
    }
    const client = await this.pool.connect();
    let began = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      began = true;
      const partial = await loadRcv017(client, analysisId);
      await client.query("COMMIT");
      began = false;
      if (partial === null) return null;
      const snapshot = await this.snapshotRepository.loadHistoricalSnapshotById(
        String(partial.header.provenanceSnapshotId) as never,
      );
      return { ...partial, rcv016SnapshotRead: snapshot };
    } catch (error) {
      if (began) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
