import { Pool, PoolClient, QueryResultRow } from "pg";
import {
  Rcv017IntegrityParityError,
  Rcv017TechnicalError,
} from "./rcv017AnalysisBuilder";
import {
  assertVerifiedRcv017AnalysisWrite,
  Rcv017VerifiedAnalysisWriteV1,
} from "./rcv017WriteVerifier";

type Rcv017PostgresPool = Pick<Pool, "connect">;
type ProjectionRow = Readonly<Record<string, unknown>>;

export class Rcv017PersistenceError extends Error {
  readonly code = "persistence_failure" as const;
  constructor(
    public readonly path: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`${path}: ${message}`);
    this.name = "Rcv017PersistenceError";
  }
}

export interface Rcv017PersistedAnalysisResultV1 {
  readonly analysisId: string;
  readonly analysisHash: string;
  readonly analysisSchemaId: string;
  readonly analysisSchemaVersion: string;
}

const INSERT_ORDER = [
  "claim_evidence_dependency_analyses",
  "dependency_analysis_evidence_relations",
  "dependency_analysis_bindings",
  "dependency_analysis_shared_artifact_findings",
  "dependency_analysis_shared_artifact_members",
  "dependency_analysis_common_upstream_findings",
  "dependency_analysis_common_upstream_members",
  "dependency_analysis_common_upstream_witness_steps",
  "dependency_analysis_no_common_upstream_findings",
  "dependency_analysis_knowledge_incomplete_findings",
  "dependency_analysis_knowledge_affected_artifacts",
  "dependency_analysis_knowledge_state_evidence",
  "dependency_analysis_derived_unrecorded_evidence",
] as const;

function text(row: ProjectionRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Rcv017IntegrityParityError(`projection.${key}`, "expected exact TEXT");
  }
  return value;
}

function integer(row: ProjectionRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Rcv017IntegrityParityError(`projection.${key}`, "expected exact safe integer");
  }
  return value;
}

function nullableText(row: ProjectionRow, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new Rcv017IntegrityParityError(`projection.${key}`, "expected exact nullable TEXT");
  }
  return value;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function requireCount(
  rows: readonly QueryResultRow[],
  expected: number,
  path: string,
): void {
  if (rows.length !== expected) {
    throw new Rcv017IntegrityParityError(path, "exact historical target set was not found");
  }
}

function same(row: QueryResultRow, key: string, expected: unknown): boolean {
  return String(row[key]) === String(expected);
}

async function lockHistoricalTargets(
  client: PoolClient,
  write: Rcv017VerifiedAnalysisWriteV1,
): Promise<void> {
  const projection = write.projection;
  const header = projection.analysisHeader;
  const policy = projection.policyHeader;

  const claimVersionId = text(header, "claimVersionId");
  const claim = await client.query(
    "SELECT id FROM public.claim_versions WHERE id = $1 FOR KEY SHARE",
    [claimVersionId],
  );
  requireCount(claim.rows, 1, "claimVersionId");

  const relationIds = projection.evidenceRelations.map((row) =>
    text(row, "claimVersionEvidenceRelationId"));
  const relations = await client.query(
    `SELECT id, claim_version_id, evidence_id, relation
       FROM public.claim_version_evidence
      WHERE id = ANY($1::uuid[])
      ORDER BY id::text COLLATE "C"
      FOR KEY SHARE`,
    [uniqueSorted(relationIds)],
  );
  requireCount(relations.rows, relationIds.length, "evidenceRelations");
  const expectedRelations = new Map(projection.evidenceRelations.map((row) => [
    text(row, "claimVersionEvidenceRelationId"), row,
  ]));
  for (const row of relations.rows) {
    const expected = expectedRelations.get(String(row.id)) as ProjectionRow | undefined;
    if (
      !expected || !same(row, "claim_version_id", claimVersionId) ||
      !same(row, "evidence_id", text(expected, "evidenceId")) ||
      !same(row, "relation", text(expected, "direction"))
    ) {
      throw new Rcv017IntegrityParityError("evidenceRelations", "historical relation parity failed");
    }
  }

  const evidenceIds = uniqueSorted(projection.evidenceRelations.map((row) => text(row, "evidenceId")));
  const evidence = await client.query(
    `SELECT id FROM public.evidence
      WHERE id = ANY($1::uuid[])
      ORDER BY id::text COLLATE "C"
      FOR KEY SHARE`,
    [evidenceIds],
  );
  requireCount(evidence.rows, evidenceIds.length, "evidenceIds");

  const snapshotId = text(header, "provenanceSnapshotId");
  const snapshotHash = text(header, "provenanceSnapshotHash");
  const snapshot = await client.query(
    `SELECT id, snapshot_hash FROM public.provenance_snapshots
      WHERE id = $1 AND snapshot_hash = $2
      FOR KEY SHARE`,
    [snapshotId, snapshotHash],
  );
  requireCount(snapshot.rows, 1, "provenanceSnapshot");

  const policyId = text(policy, "policyId");
  const policyVersion = integer(policy, "policyVersion");
  const policyHash = text(policy, "definitionHash");
  const policyTarget = await client.query(
    `SELECT policy_id, policy_version, definition_hash
       FROM public.dependency_analysis_policies
      WHERE policy_id = $1 AND policy_version = $2 AND definition_hash = $3
      FOR KEY SHARE`,
    [policyId, policyVersion, policyHash],
  );
  requireCount(policyTarget.rows, 1, "dependencyAnalysisPolicy");

  const bindingIds = uniqueSorted(projection.bindings.map((row) =>
    text(row, "evidenceArtifactBindingStatementId")));
  const bindings = await client.query(
    `SELECT id, evidence_id, artifact_version_id
       FROM public.evidence_artifact_bindings
      WHERE id = ANY($1::uuid[])
      ORDER BY id::text COLLATE "C"
      FOR KEY SHARE`,
    [bindingIds],
  );
  requireCount(bindings.rows, bindingIds.length, "selectedBindings");
  const expectedBindings = new Map(projection.bindings.map((row) => [
    text(row, "evidenceArtifactBindingStatementId"), row,
  ]));
  for (const row of bindings.rows) {
    const expected = expectedBindings.get(String(row.id)) as ProjectionRow | undefined;
    if (
      !expected || !same(row, "evidence_id", text(expected, "evidenceId")) ||
      !same(row, "artifact_version_id", text(expected, "artifactVersionId"))
    ) {
      throw new Rcv017IntegrityParityError("selectedBindings", "historical binding parity failed");
    }
  }
  const bindingMembership = await client.query(
    `SELECT evidence_artifact_binding_id
       FROM public.provenance_snapshot_evidence_artifact_bindings
      WHERE snapshot_id = $1
        AND evidence_artifact_binding_id = ANY($2::uuid[])
      ORDER BY evidence_artifact_binding_id::text COLLATE "C"
      FOR KEY SHARE`,
    [snapshotId, bindingIds],
  );
  requireCount(bindingMembership.rows, bindingIds.length, "selectedBindings.snapshotMembership");

  const artifactIds = uniqueSorted([
    ...projection.bindings.map((row) => text(row, "artifactVersionId")),
    ...projection.sharedArtifactFindings.map((row) => text(row, "artifactVersionId")),
    ...projection.commonUpstreamFindings.map((row) => text(row, "upstreamArtifactVersionId")),
    ...projection.commonUpstreamWitnessSteps.map((row) => text(row, "artifactVersionId")),
    ...projection.knowledgeAffectedArtifacts.map((row) => text(row, "artifactVersionId")),
    ...projection.derivedUnrecordedEvidence.map((row) => text(row, "artifactVersionId")),
  ]);
  if (artifactIds.length > 0) {
    const artifacts = await client.query(
      `SELECT id FROM public.provenance_artifact_versions
        WHERE id = ANY($1::uuid[])
        ORDER BY id::text COLLATE "C"
        FOR KEY SHARE`,
      [artifactIds],
    );
    requireCount(artifacts.rows, artifactIds.length, "artifactVersionIds");
  }

  const witnessStatementIds = uniqueSorted(projection.commonUpstreamWitnessSteps
    .map((row) => nullableText(row, "artifactProvenanceStatementId"))
    .filter((value): value is string => value !== null));
  if (witnessStatementIds.length > 0) {
    const statements = await client.query(
      `SELECT id FROM public.artifact_provenance_statements
        WHERE id = ANY($1::uuid[])
        ORDER BY id::text COLLATE "C"
        FOR KEY SHARE`,
      [witnessStatementIds],
    );
    requireCount(statements.rows, witnessStatementIds.length, "witnessStatements");
    const membership = await client.query(
      `SELECT artifact_provenance_statement_id
         FROM public.provenance_snapshot_artifact_provenance_statements
        WHERE snapshot_id = $1
          AND artifact_provenance_statement_id = ANY($2::uuid[])
        ORDER BY artifact_provenance_statement_id::text COLLATE "C"
        FOR KEY SHARE`,
      [snapshotId, witnessStatementIds],
    );
    requireCount(membership.rows, witnessStatementIds.length, "witnessStatements.snapshotMembership");
  }

  const knowledgeIds = uniqueSorted(projection.knowledgeStateEvidence.map((row) =>
    text(row, "knowledgeStateStatementId")));
  if (knowledgeIds.length > 0) {
    const statements = await client.query(
      `SELECT id FROM public.knowledge_state_statements
        WHERE id = ANY($1::uuid[])
        ORDER BY id::text COLLATE "C"
        FOR KEY SHARE`,
      [knowledgeIds],
    );
    requireCount(statements.rows, knowledgeIds.length, "knowledgeStateStatements");
    const membership = await client.query(
      `SELECT knowledge_state_statement_id
         FROM public.provenance_snapshot_knowledge_state_statements
        WHERE snapshot_id = $1
          AND knowledge_state_statement_id = ANY($2::uuid[])
        ORDER BY knowledge_state_statement_id::text COLLATE "C"
        FOR KEY SHARE`,
      [snapshotId, knowledgeIds],
    );
    requireCount(membership.rows, knowledgeIds.length, "knowledgeStateStatements.snapshotMembership");
  }
}

async function insertRows(
  client: PoolClient,
  sql: string,
  rows: readonly ProjectionRow[],
  values: (row: ProjectionRow) => readonly unknown[],
): Promise<void> {
  for (const row of rows) await client.query(sql, [...values(row)]);
}

async function insertProjection(
  client: PoolClient,
  write: Rcv017VerifiedAnalysisWriteV1,
): Promise<void> {
  const id = write.analysisId;
  const p = write.projection;
  const h = p.analysisHeader;
  await client.query(
    `INSERT INTO public.claim_evidence_dependency_analyses (
      analysis_id, analysis_schema_id, analysis_schema_version, claim_version_id,
      provenance_snapshot_id, provenance_snapshot_hash,
      dependency_analysis_policy_id, dependency_analysis_policy_version,
      dependency_analysis_policy_hash, algorithm_id, algorithm_version,
      algorithm_artifact_hash, canonicalization_id, canonicalization_version,
      hash_algorithm, analysis_canonical, analysis_hash
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, text(h, "analysisSchemaId"), text(h, "analysisSchemaVersion"),
      text(h, "claimVersionId"), text(h, "provenanceSnapshotId"),
      text(h, "provenanceSnapshotHash"), text(h, "dependencyAnalysisPolicyId"),
      integer(h, "dependencyAnalysisPolicyVersion"), text(h, "dependencyAnalysisPolicyHash"),
      text(h, "algorithmId"), text(h, "algorithmVersion"), text(h, "algorithmArtifactHash"),
      text(h, "canonicalizationId"), text(h, "canonicalizationVersion"),
      text(h, "hashAlgorithm"), text(h, "analysisCanonical"), text(h, "analysisHash")],
  );

  await insertRows(client,
    `INSERT INTO public.dependency_analysis_evidence_relations
      (analysis_id,claim_version_evidence_relation_id,evidence_id,direction)
     VALUES ($1,$2,$3,$4)`, p.evidenceRelations,
    (r) => [id, text(r, "claimVersionEvidenceRelationId"), text(r, "evidenceId"), text(r, "direction")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_bindings
      (analysis_id,provenance_snapshot_id,claim_version_evidence_relation_id,
       evidence_artifact_binding_statement_id,evidence_id,artifact_version_id)
     VALUES ($1,$2,$3,$4,$5,$6)`, p.bindings,
    (r) => [id, text(r, "provenanceSnapshotId"), text(r, "claimVersionEvidenceRelationId"),
      text(r, "evidenceArtifactBindingStatementId"), text(r, "evidenceId"), text(r, "artifactVersionId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_shared_artifact_findings
      (analysis_id,direction,artifact_version_id) VALUES ($1,$2,$3)`, p.sharedArtifactFindings,
    (r) => [id, text(r, "direction"), text(r, "artifactVersionId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_shared_artifact_members
      (analysis_id,direction,artifact_version_id,claim_version_evidence_relation_id,
       evidence_artifact_binding_statement_id) VALUES ($1,$2,$3,$4,$5)`, p.sharedArtifactMembers,
    (r) => [id, text(r, "direction"), text(r, "artifactVersionId"),
      text(r, "claimVersionEvidenceRelationId"), text(r, "evidenceArtifactBindingStatementId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_common_upstream_findings
      (analysis_id,direction,upstream_artifact_version_id) VALUES ($1,$2,$3)`, p.commonUpstreamFindings,
    (r) => [id, text(r, "direction"), text(r, "upstreamArtifactVersionId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_common_upstream_members
      (analysis_id,direction,upstream_artifact_version_id,claim_version_evidence_relation_id,
       evidence_artifact_binding_statement_id) VALUES ($1,$2,$3,$4,$5)`, p.commonUpstreamMembers,
    (r) => [id, text(r, "direction"), text(r, "upstreamArtifactVersionId"),
      text(r, "claimVersionEvidenceRelationId"), text(r, "evidenceArtifactBindingStatementId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_common_upstream_witness_steps
      (analysis_id,provenance_snapshot_id,direction,upstream_artifact_version_id,
       claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,
       ordinal,artifact_version_id,artifact_provenance_statement_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, p.commonUpstreamWitnessSteps,
    (r) => [id, text(r, "provenanceSnapshotId"), text(r, "direction"),
      text(r, "upstreamArtifactVersionId"), text(r, "claimVersionEvidenceRelationId"),
      text(r, "evidenceArtifactBindingStatementId"), integer(r, "ordinal"),
      text(r, "artifactVersionId"), nullableText(r, "artifactProvenanceStatementId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_no_common_upstream_findings
      (analysis_id,direction,lower_claim_version_evidence_relation_id,
       lower_evidence_artifact_binding_statement_id,upper_claim_version_evidence_relation_id,
       upper_evidence_artifact_binding_statement_id) VALUES ($1,$2,$3,$4,$5,$6)`, p.noCommonUpstreamFindings,
    (r) => [id, text(r, "direction"), text(r, "lowerClaimVersionEvidenceRelationId"),
      text(r, "lowerEvidenceArtifactBindingStatementId"), text(r, "upperClaimVersionEvidenceRelationId"),
      text(r, "upperEvidenceArtifactBindingStatementId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_knowledge_incomplete_findings
      (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
     VALUES ($1,$2,$3)`, p.knowledgeIncompleteFindings,
    (r) => [id, text(r, "claimVersionEvidenceRelationId"), text(r, "evidenceArtifactBindingStatementId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_knowledge_affected_artifacts
      (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,
       artifact_version_id) VALUES ($1,$2,$3,$4)`, p.knowledgeAffectedArtifacts,
    (r) => [id, text(r, "claimVersionEvidenceRelationId"),
      text(r, "evidenceArtifactBindingStatementId"), text(r, "artifactVersionId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_knowledge_state_evidence
      (analysis_id,provenance_snapshot_id,claim_version_evidence_relation_id,
       evidence_artifact_binding_statement_id,knowledge_state_statement_id)
     VALUES ($1,$2,$3,$4,$5)`, p.knowledgeStateEvidence,
    (r) => [id, text(r, "provenanceSnapshotId"), text(r, "claimVersionEvidenceRelationId"),
      text(r, "evidenceArtifactBindingStatementId"), text(r, "knowledgeStateStatementId")]);
  await insertRows(client,
    `INSERT INTO public.dependency_analysis_derived_unrecorded_evidence
      (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,
       artifact_version_id) VALUES ($1,$2,$3,$4)`, p.derivedUnrecordedEvidence,
    (r) => [id, text(r, "claimVersionEvidenceRelationId"),
      text(r, "evidenceArtifactBindingStatementId"), text(r, "artifactVersionId")]);
}

export class Rcv017PostgresAnalysisRepository {
  static readonly insertOrder = INSERT_ORDER;

  constructor(private readonly pool: Rcv017PostgresPool) {}

  async persistAnalysis(value: unknown): Promise<Rcv017PersistedAnalysisResultV1> {
    const write = assertVerifiedRcv017AnalysisWrite(value);
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw new Rcv017PersistenceError("transaction.connect", "PostgreSQL connection failed", error);
    }
    let transactionStarted = false;
    let destroyClient = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      transactionStarted = true;
      const isolation = await client.query("SHOW transaction_isolation");
      if (isolation.rows[0]?.transaction_isolation !== "repeatable read") {
        throw new Rcv017PersistenceError(
          "transaction.isolation",
          "PostgreSQL did not establish repeatable read",
        );
      }
      await lockHistoricalTargets(client, write);
      await insertProjection(client, write);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("COMMIT");
      transactionStarted = false;
      return Object.freeze({
        analysisId: write.analysisId,
        analysisHash: write.analysisHash,
        analysisSchemaId: write.analysisSchemaId,
        analysisSchemaVersion: write.analysisSchemaVersion,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          destroyClient = true;
          throw new Rcv017PersistenceError(
            "transaction.rollback",
            "PostgreSQL rollback failed",
            { originalError: error, rollbackError },
          );
        }
      }
      if (error instanceof Rcv017TechnicalError || error instanceof Rcv017PersistenceError) {
        throw error;
      }
      throw new Rcv017PersistenceError("transaction.write", "PostgreSQL analysis write failed", error);
    } finally {
      client.release(destroyClient);
    }
  }
}
