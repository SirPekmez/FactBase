import { Pool, PoolClient, QueryResultRow } from "pg";
import {
  isRcv016PositiveSafeIntegerV1,
  Rcv016PositiveSafeIntegerV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  RCV016_SNAPSHOT_WRITE_ISOLATION,
  Rcv016DatabaseError,
  Rcv016SnapshotHeaderInsertV1,
  Rcv016SnapshotMembershipInsertCollectionsV1,
  Rcv016SnapshotRepositoryV1,
  Rcv016SnapshotWriteTransactionV1,
  Rcv016TraversalPolicySnapshotRecordV1,
} from "./rcv016RepositoryContract";

type Rcv016PostgresPool = Pick<Pool, "connect">;

function safeInteger(value: unknown, field: string): Rcv016PositiveSafeIntegerV1 {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!isRcv016PositiveSafeIntegerV1(parsed)) {
    throw new Rcv016DatabaseError(field, "PostgreSQL returned a non-positive-safe integer");
  }
  return parsed;
}

function mapPolicy(row: QueryResultRow): Rcv016TraversalPolicySnapshotRecordV1 {
  return {
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    definitionHash: row.definition_hash,
    maxRoots: safeInteger(row.max_roots, "policy.maxRoots"),
    maxNodes: safeInteger(row.max_nodes, "policy.maxNodes"),
    maxEdges: safeInteger(row.max_edges, "policy.maxEdges"),
    maxDepth: safeInteger(row.max_depth, "policy.maxDepth"),
    maxCanonicalSnapshotBytes: safeInteger(
      row.max_canonical_snapshot_bytes,
      "policy.maxCanonicalSnapshotBytes",
    ),
    allowedRelationships: row.allowed_relationships,
    deterministicOrdering: row.deterministic_ordering,
    visitedSemantics: row.visited_semantics,
  };
}

async function insertRows<T>(
  client: PoolClient,
  sql: string,
  rows: readonly T[],
  values: (row: T) => readonly unknown[],
): Promise<void> {
  for (const row of rows) await client.query(sql, [...values(row)]);
}

function transactionFor(client: PoolClient): Rcv016SnapshotWriteTransactionV1 {
  return {
    async loadTraversalPolicyByIdentity(policyId, policyVersion) {
      const result = await client.query(
        `SELECT
          policy_id, policy_version, definition_hash,
          max_roots, max_nodes, max_edges, max_depth,
          max_canonical_snapshot_bytes, allowed_relationships,
          deterministic_ordering, visited_semantics
        FROM public.provenance_traversal_policies
        WHERE policy_id = $1 AND policy_version = $2`,
        [policyId, policyVersion],
      );
      return result.rowCount === 1 ? mapPolicy(result.rows[0]) : null;
    },

    async lockEvidenceForReferenceVerification(evidenceId) {
      const result = await client.query(
        "SELECT id FROM public.evidence WHERE id = $1 FOR KEY SHARE",
        [evidenceId],
      );
      return result.rowCount === 1;
    },

    async lockArtifactVersionForReferenceVerification(artifactVersionId) {
      const result = await client.query(
        "SELECT id FROM public.provenance_artifact_versions WHERE id = $1 FOR KEY SHARE",
        [artifactVersionId],
      );
      return result.rowCount === 1;
    },

    async lockProvenanceSnapshotForReferenceVerification(snapshotId) {
      const result = await client.query(
        "SELECT id FROM public.provenance_snapshots WHERE id = $1 FOR KEY SHARE",
        [snapshotId],
      );
      return result.rowCount === 1;
    },

    async insertSnapshotHeader(header: Rcv016SnapshotHeaderInsertV1) {
      await client.query(
        `INSERT INTO public.provenance_snapshots (
          id, snapshot_schema_id, snapshot_schema_version,
          builder_id, builder_version, builder_artifact_hash,
          canonicalization_id, canonicalization_version, hash_algorithm,
          policy_id, policy_version, definition_hash,
          max_roots, max_nodes, max_edges, max_depth,
          max_canonical_snapshot_bytes, allowed_relationships,
          deterministic_ordering, visited_semantics,
          snapshot_canonical, snapshot_hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
        )`,
        [
          header.snapshotId,
          header.snapshotSchemaId,
          header.snapshotSchemaVersion,
          header.builderId,
          header.builderVersion,
          header.builderArtifactHash,
          header.canonicalizationId,
          header.canonicalizationVersion,
          header.hashAlgorithm,
          header.policyId,
          header.policyVersion,
          header.definitionHash,
          header.maxRoots,
          header.maxNodes,
          header.maxEdges,
          header.maxDepth,
          header.maxCanonicalSnapshotBytes,
          [...header.allowedRelationships],
          header.deterministicOrdering,
          header.visitedSemantics,
          header.snapshotCanonical,
          header.snapshotHash,
        ],
      );
    },

    async insertSnapshotArtifactVersions(rows) {
      await insertRows(
        client,
        `INSERT INTO public.provenance_snapshot_artifact_versions
          (snapshot_id, artifact_version_id, membership_role)
        VALUES ($1, $2, $3)`,
        rows,
        (row) => [row.snapshotId, row.artifactVersionId, row.membershipRole],
      );
    },

    async insertSnapshotSourceVersions(rows) {
      await insertRows(
        client,
        `INSERT INTO public.provenance_snapshot_source_versions
          (snapshot_id, source_version_id) VALUES ($1, $2)`,
        rows,
        (row) => [row.snapshotId, row.sourceVersionId],
      );
    },

    async insertSnapshotArtifactProvenanceStatements(rows) {
      await insertRows(
        client,
        `INSERT INTO public.provenance_snapshot_artifact_provenance_statements
          (snapshot_id, artifact_provenance_statement_id) VALUES ($1, $2)`,
        rows,
        (row) => [row.snapshotId, row.artifactProvenanceStatementId],
      );
    },

    async insertSnapshotSourceRelationshipStatements(rows) {
      await insertRows(
        client,
        `INSERT INTO public.provenance_snapshot_source_relationship_statements
          (snapshot_id, source_relationship_statement_id) VALUES ($1, $2)`,
        rows,
        (row) => [row.snapshotId, row.sourceRelationshipStatementId],
      );
    },

    async insertSnapshotArtifactSourceAttributions(rows) {
      await insertRows(
        client,
        `INSERT INTO public.provenance_snapshot_artifact_source_attributions
          (snapshot_id, artifact_source_attribution_id) VALUES ($1, $2)`,
        rows,
        (row) => [row.snapshotId, row.artifactSourceAttributionId],
      );
    },

    async insertSnapshotEvidenceArtifactBindings(rows) {
      await insertRows(
        client,
        `INSERT INTO public.provenance_snapshot_evidence_artifact_bindings
          (snapshot_id, evidence_artifact_binding_id) VALUES ($1, $2)`,
        rows,
        (row) => [row.snapshotId, row.evidenceArtifactBindingId],
      );
    },

    async insertSnapshotKnowledgeStateStatements(rows) {
      await insertRows(
        client,
        `INSERT INTO public.provenance_snapshot_knowledge_state_statements
          (snapshot_id, knowledge_state_statement_id) VALUES ($1, $2)`,
        rows,
        (row) => [row.snapshotId, row.knowledgeStateStatementId],
      );
    },
  };
}

export class Rcv016PostgresSnapshotRepository implements Rcv016SnapshotRepositoryV1 {
  constructor(private readonly pool: Rcv016PostgresPool) {}

  async withRcv016WriteTransaction<T>(
    options: { readonly isolation: typeof RCV016_SNAPSHOT_WRITE_ISOLATION },
    operation: (transaction: Rcv016SnapshotWriteTransactionV1) => Promise<T>,
  ): Promise<T> {
    if (options.isolation !== RCV016_SNAPSHOT_WRITE_ISOLATION) {
      throw new Rcv016DatabaseError(
        "transaction.isolation",
        "RCV-016 Snapshot writes require repeatable_read",
      );
    }
    const client = await this.pool.connect();
    let transactionStarted = false;
    let destroyClient = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      transactionStarted = true;
      const isolation = await client.query("SHOW transaction_isolation");
      if (isolation.rows[0]?.transaction_isolation !== "repeatable read") {
        throw new Rcv016DatabaseError(
          "transaction.isolation",
          "PostgreSQL did not establish repeatable read",
        );
      }
      const result = await operation(transactionFor(client));
      await client.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          destroyClient = true;
          throw new Rcv016DatabaseError(
            "transaction.rollback",
            "PostgreSQL rollback failed",
            { originalError: error, rollbackError },
          );
        }
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  }
}
