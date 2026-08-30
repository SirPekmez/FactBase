import { Pool, PoolClient, QueryResultRow } from "pg";
import { Rcv016ProvenanceSnapshotIdV1 } from "../contracts/rcv016ProvenanceContractV1";
import {
  Rcv016HistoricalObjectReadV1,
  Rcv016HistoricalSnapshotReadRepositoryV1,
  Rcv016HistoricalSnapshotReadV1,
} from "./rcv016ReadRepositoryContract";

type Rcv016PostgresReadPool = Pick<Pool, "connect">;

const PAYLOAD_COLUMNS = `
  l.limits_id AS limits_id, l.limits_version AS limits_version,
  l.schema_id AS limits_schema_id, l.schema_version AS limits_schema_version,
  l.source_metadata_canonical_bytes, l.source_locator_count,
  l.display_name_codepoints, l.display_name_utf8_bytes,
  l.locator_string_codepoints, l.locator_string_utf8_bytes,
  l.artifact_capture_canonical_bytes, l.artifact_locator_codepoints,
  l.artifact_locator_utf8_bytes, l.media_type_codepoints,
  l.media_type_utf8_bytes, l.title_codepoints, l.title_utf8_bytes,
  l.rationale_codepoints, l.rationale_utf8_bytes,
  l.foundation_canonical_bytes, l.foundation_item_count,
  l.foundation_input_reference_count, l.foundation_reference_codepoints,
  l.foundation_reference_utf8_bytes,
  l.definition_canonical AS limits_definition_canonical,
  l.definition_hash AS limits_definition_hash`;

const utc = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function safeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("PostgreSQL returned an unsafe integer");
  return parsed;
}

function payloadLimits(row: QueryResultRow): unknown {
  return {
    limitsId: row.limits_id,
    limitsVersion: row.limits_version,
    sourceMetadataCanonicalBytes: safeInteger(row.source_metadata_canonical_bytes),
    sourceLocatorCount: safeInteger(row.source_locator_count),
    displayNameCodepoints: safeInteger(row.display_name_codepoints),
    displayNameUtf8Bytes: safeInteger(row.display_name_utf8_bytes),
    locatorStringCodepoints: safeInteger(row.locator_string_codepoints),
    locatorStringUtf8Bytes: safeInteger(row.locator_string_utf8_bytes),
    artifactCaptureCanonicalBytes: safeInteger(row.artifact_capture_canonical_bytes),
    artifactLocatorCodepoints: safeInteger(row.artifact_locator_codepoints),
    artifactLocatorUtf8Bytes: safeInteger(row.artifact_locator_utf8_bytes),
    mediaTypeCodepoints: safeInteger(row.media_type_codepoints),
    mediaTypeUtf8Bytes: safeInteger(row.media_type_utf8_bytes),
    titleCodepoints: safeInteger(row.title_codepoints),
    titleUtf8Bytes: safeInteger(row.title_utf8_bytes),
    rationaleCodepoints: safeInteger(row.rationale_codepoints),
    rationaleUtf8Bytes: safeInteger(row.rationale_utf8_bytes),
    foundationCanonicalBytes: safeInteger(row.foundation_canonical_bytes),
    foundationItemCount: safeInteger(row.foundation_item_count),
    foundationInputReferenceCount: safeInteger(row.foundation_input_reference_count),
    foundationReferenceCodepoints: safeInteger(row.foundation_reference_codepoints),
    foundationReferenceUtf8Bytes: safeInteger(row.foundation_reference_utf8_bytes),
    definitionCanonical: row.limits_definition_canonical,
    definitionHash: row.limits_definition_hash,
  };
}

function foundationValue(canonical: unknown): unknown {
  if (canonical === null) return null;
  if (typeof canonical !== "string") throw new Error("PostgreSQL returned invalid Foundation TEXT");
  return JSON.parse(canonical);
}

function historical(value: unknown, row: QueryResultRow): Rcv016HistoricalObjectReadV1 {
  return {
    value,
    payloadLimits: payloadLimits(row),
    foundationCanonical: row.foundation_canonical ?? null,
    foundationHash: row.foundation_hash ?? null,
  };
}

function common(row: QueryResultRow): Record<string, unknown> {
  return {
    statementId: row.id,
    observedAt: row.observed_at,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    initiator: row.initiator_type === null
      ? null
      : { type: row.initiator_type, id: row.initiator_id },
    rationale: row.rationale,
    foundation: foundationValue(row.foundation_canonical),
    supersedesStatementId: row.supersedes_statement_id,
    createdAt: row.created_at,
  };
}

async function memberIds(
  client: PoolClient,
  table: string,
  idColumn: string,
  snapshotId: string,
): Promise<string[]> {
  const result = await client.query(
    `SELECT ${idColumn}::text AS id FROM public.${table} WHERE snapshot_id = $1`,
    [snapshotId],
  );
  return result.rows.map((row) => row.id);
}

async function exactExistingIds(
  client: PoolClient,
  table: "evidence" | "provenance_artifact_versions" | "provenance_snapshots",
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await client.query(
    `SELECT id::text AS id FROM public.${table} WHERE id = ANY($1::uuid[])`,
    [[...ids]],
  );
  return result.rows.map((row) => row.id);
}

function collectFoundationTargets(records: readonly Rcv016HistoricalObjectReadV1[]): {
  evidenceIds: string[];
  artifactVersionIds: string[];
  provenanceSnapshotIds: string[];
} {
  const targets = {
    evidenceIds: new Set<string>(),
    artifactVersionIds: new Set<string>(),
    provenanceSnapshotIds: new Set<string>(),
  };
  const add = (type: unknown, id: unknown): void => {
    if (typeof id !== "string") return;
    if (type === "evidence") targets.evidenceIds.add(id);
    if (type === "artifact_version") targets.artifactVersionIds.add(id);
    if (type === "provenance_snapshot") targets.provenanceSnapshotIds.add(id);
  };
  for (const record of records) {
    if (record.foundationCanonical === null || record.foundationCanonical === undefined) continue;
    const value = foundationValue(record.foundationCanonical) as { items?: unknown[] };
    if (!Array.isArray(value?.items)) continue;
    for (const item of value.items) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const object = item as Record<string, unknown>;
      if (object.kind === "evidence_reference") add("evidence", object.evidenceId);
      if (object.kind === "artifact_version_reference") add("artifact_version", object.artifactVersionId);
      if (object.kind === "deterministic_method" && Array.isArray(object.inputReferences)) {
        for (const reference of object.inputReferences) {
          if (reference !== null && typeof reference === "object" && !Array.isArray(reference)) {
            const input = reference as Record<string, unknown>;
            add(input.referenceType, input.referenceId);
          }
        }
      }
    }
  }
  return {
    evidenceIds: [...targets.evidenceIds].sort(),
    artifactVersionIds: [...targets.artifactVersionIds].sort(),
    provenanceSnapshotIds: [...targets.provenanceSnapshotIds].sort(),
  };
}

async function loadHistoricalSnapshot(
  client: PoolClient,
  snapshotId: Rcv016ProvenanceSnapshotIdV1,
): Promise<Rcv016HistoricalSnapshotReadV1 | null> {
  const headerResult = await client.query(
    `SELECT id::text AS id, snapshot_canonical, snapshot_hash,
      ${utc("created_at")} AS created_at,
      policy_id, policy_version
    FROM public.provenance_snapshots WHERE id = $1`,
    [snapshotId],
  );
  if (headerResult.rowCount !== 1) return null;
  const header = headerResult.rows[0];

  const artifactMembership = await client.query(
    `SELECT artifact_version_id::text AS id, membership_role
     FROM public.provenance_snapshot_artifact_versions WHERE snapshot_id = $1`,
    [snapshotId],
  );
  const sourceVersionIds = await memberIds(client, "provenance_snapshot_source_versions", "source_version_id", snapshotId);
  const artifactStatementIds = await memberIds(client, "provenance_snapshot_artifact_provenance_statements", "artifact_provenance_statement_id", snapshotId);
  const sourceStatementIds = await memberIds(client, "provenance_snapshot_source_relationship_statements", "source_relationship_statement_id", snapshotId);
  const attributionIds = await memberIds(client, "provenance_snapshot_artifact_source_attributions", "artifact_source_attribution_id", snapshotId);
  const bindingIds = await memberIds(client, "provenance_snapshot_evidence_artifact_bindings", "evidence_artifact_binding_id", snapshotId);
  const knowledgeIds = await memberIds(client, "provenance_snapshot_knowledge_state_statements", "knowledge_state_statement_id", snapshotId);
  const artifactVersionIds = [...new Set(artifactMembership.rows.map((row) => row.id as string))];

  const artifactVersionsResult = await client.query(
    `SELECT v.id::text AS id, v.artifact_id::text AS artifact_id, v.version_number,
      v.capture_schema_id, v.capture_schema_version, v.capture_canonical, v.capture_hash,
      ${utc("v.created_at")} AS created_at, ${PAYLOAD_COLUMNS}
     FROM public.provenance_artifact_versions v
     JOIN public.provenance_payload_limits l ON l.limits_id=v.payload_limits_id AND l.limits_version=v.payload_limits_version
     WHERE v.id = ANY($1::uuid[])`,
    [artifactVersionIds],
  );
  const artifactVersions = artifactVersionsResult.rows.map((row) => historical({
    artifactVersionId: row.id,
    artifactId: row.artifact_id,
    versionNumber: safeInteger(row.version_number),
    captureSchemaId: row.capture_schema_id,
    captureSchemaVersion: row.capture_schema_version,
    captureCanonical: row.capture_canonical,
    captureHash: row.capture_hash,
    createdAt: row.created_at,
  }, row));

  const sourceVersionsResult = await client.query(
    `SELECT v.id::text AS id, v.source_id::text AS source_id, v.version_number,
      v.metadata_schema_id, v.metadata_schema_version, v.metadata_canonical, v.metadata_hash,
      ${utc("v.observed_at")} AS observed_at, ${utc("v.created_at")} AS created_at,
      ${PAYLOAD_COLUMNS}
     FROM public.provenance_source_versions v
     JOIN public.provenance_payload_limits l ON l.limits_id=v.payload_limits_id AND l.limits_version=v.payload_limits_version
     WHERE v.id = ANY($1::uuid[])`,
    [sourceVersionIds],
  );
  const sourceVersions = sourceVersionsResult.rows.map((row) => historical({
    sourceVersionId: row.id,
    sourceId: row.source_id,
    versionNumber: safeInteger(row.version_number),
    metadataSchemaIdentity: { id: row.metadata_schema_id, version: row.metadata_schema_version },
    metadataCanonical: row.metadata_canonical,
    metadataHash: row.metadata_hash,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  }, row));

  const statementSelect = (table: string, ids: readonly string[], identity: string): Promise<{ rows: QueryResultRow[] }> => client.query(
    `SELECT s.id::text AS id, ${identity},
      ${utc("s.observed_at")} AS observed_at,
      CASE WHEN s.valid_from IS NULL THEN NULL ELSE ${utc("s.valid_from")} END AS valid_from,
      CASE WHEN s.valid_to IS NULL THEN NULL ELSE ${utc("s.valid_to")} END AS valid_to,
      s.initiator_type, s.initiator_id, s.rationale, s.foundation_canonical, s.foundation_hash,
      s.supersedes_statement_id::text AS supersedes_statement_id,
      ${utc("s.created_at")} AS created_at, ${PAYLOAD_COLUMNS}
     FROM public.${table} s
     JOIN public.provenance_payload_limits l ON l.limits_id=s.payload_limits_id AND l.limits_version=s.payload_limits_version
     WHERE s.id = ANY($1::uuid[])`,
    [[...ids]],
  );

  const artifactRows = (await statementSelect("artifact_provenance_statements", artifactStatementIds, "s.downstream_artifact_version_id::text AS subject_id, s.upstream_artifact_version_id::text AS object_id, s.relationship_type AS relationship_type")).rows;
  const sourceRows = (await statementSelect("source_relationship_statements", sourceStatementIds, "s.subject_source_id::text AS subject_id, s.object_source_id::text AS object_id, s.relationship_type AS relationship_type")).rows;
  const attributionRows = (await statementSelect("artifact_source_attributions", attributionIds, "s.artifact_version_id::text AS subject_id, s.source_version_id::text AS object_id, s.relationship_type AS relationship_type")).rows;
  const bindingRows = (await statementSelect("evidence_artifact_bindings", bindingIds, "s.evidence_id::text AS subject_id, s.artifact_version_id::text AS object_id, 'bound_to'::text AS relationship_type")).rows;
  const knowledgeRows = await client.query(
    `SELECT s.id::text AS id, s.artifact_version_id::text AS subject_id, s.scope, s.state,
      ${utc("s.observed_at")} AS observed_at, NULL::text AS valid_from, NULL::text AS valid_to,
      s.initiator_type, s.initiator_id, s.rationale, s.foundation_canonical, s.foundation_hash,
      s.supersedes_statement_id::text AS supersedes_statement_id,
      ${utc("s.created_at")} AS created_at, ${PAYLOAD_COLUMNS}
     FROM public.knowledge_state_statements s
     JOIN public.provenance_payload_limits l ON l.limits_id=s.payload_limits_id AND l.limits_version=s.payload_limits_version
     WHERE s.id = ANY($1::uuid[])`,
    [knowledgeIds],
  );

  const artifactProvenanceStatements = artifactRows.map((row) => historical({ family: "ArtifactProvenanceStatement", ...common(row), subjectArtifactVersionId: row.subject_id, relationship: row.relationship_type, objectArtifactVersionId: row.object_id }, row));
  const sourceRelationshipStatements = sourceRows.map((row) => historical({ family: "SourceRelationshipStatement", ...common(row), subjectSourceId: row.subject_id, relationship: row.relationship_type, objectSourceId: row.object_id }, row));
  const artifactSourceAttributions = attributionRows.map((row) => historical({ family: "ArtifactSourceAttribution", ...common(row), subjectArtifactVersionId: row.subject_id, relationship: row.relationship_type, objectSourceVersionId: row.object_id }, row));
  const evidenceArtifactBindings = bindingRows.map((row) => historical({ family: "EvidenceArtifactBinding", ...common(row), subjectEvidenceId: row.subject_id, relationship: "bound_to", objectArtifactVersionId: row.object_id }, row));
  const knowledgeStateStatements = knowledgeRows.rows.map((row) => historical({ family: "KnowledgeStateStatement", ...common(row), subjectArtifactVersionId: row.subject_id, scope: row.scope, state: row.state }, row));

  const policyResult = await client.query(
    `SELECT policy_id, policy_version, schema_id, schema_version,
      definition_canonical, definition_hash, max_roots, max_nodes, max_edges,
      max_depth, max_canonical_snapshot_bytes, allowed_relationships,
      deterministic_ordering, visited_semantics
     FROM public.provenance_traversal_policies
     WHERE policy_id = $1 AND policy_version = $2`,
    [header.policy_id, header.policy_version],
  );
  const policy = policyResult.rowCount === 1 ? policyResult.rows[0] : null;
  const traversalPolicy = policy === null ? null : {
    policyId: policy.policy_id,
    policyVersion: policy.policy_version,
    maxRoots: safeInteger(policy.max_roots),
    maxNodes: safeInteger(policy.max_nodes),
    maxEdges: safeInteger(policy.max_edges),
    maxDepth: safeInteger(policy.max_depth),
    maxCanonicalSnapshotBytes: safeInteger(policy.max_canonical_snapshot_bytes),
    allowedRelationships: policy.allowed_relationships,
    deterministicOrdering: policy.deterministic_ordering,
    visitedSemantics: policy.visited_semantics,
    definitionCanonical: policy.definition_canonical,
    definitionHash: policy.definition_hash,
  };

  const allStatements = [...artifactProvenanceStatements, ...sourceRelationshipStatements, ...artifactSourceAttributions, ...evidenceArtifactBindings, ...knowledgeStateStatements];
  const requestedTargets = collectFoundationTargets(allStatements);
  const foundationTargets = {
    evidenceIds: await exactExistingIds(client, "evidence", requestedTargets.evidenceIds),
    artifactVersionIds: await exactExistingIds(client, "provenance_artifact_versions", requestedTargets.artifactVersionIds),
    provenanceSnapshotIds: await exactExistingIds(client, "provenance_snapshots", requestedTargets.provenanceSnapshotIds),
  };

  return {
    header: {
      snapshotId: header.id,
      snapshotCanonical: header.snapshot_canonical,
      snapshotHash: header.snapshot_hash,
      persistenceCreatedAt: header.created_at,
    },
    relationalMembershipKeys: [
      ...artifactMembership.rows.map((row) => ({ targetType: "ArtifactVersion", membershipRole: row.membership_role, artifactVersionId: row.id })),
      ...sourceVersionIds.map((id) => ({ targetType: "SourceVersion", membershipRole: "included", sourceVersionId: id })),
      ...artifactStatementIds.map((id) => ({ targetType: "ArtifactProvenanceStatement", membershipRole: "included", artifactProvenanceStatementId: id })),
      ...sourceStatementIds.map((id) => ({ targetType: "SourceRelationshipStatement", membershipRole: "included", sourceRelationshipStatementId: id })),
      ...attributionIds.map((id) => ({ targetType: "ArtifactSourceAttribution", membershipRole: "included", artifactSourceAttributionId: id })),
      ...bindingIds.map((id) => ({ targetType: "EvidenceArtifactBinding", membershipRole: "included", evidenceArtifactBindingId: id })),
      ...knowledgeIds.map((id) => ({ targetType: "KnowledgeStateStatement", membershipRole: "included", knowledgeStateStatementId: id })),
    ],
    artifactVersions,
    sourceVersions,
    artifactProvenanceStatements,
    sourceRelationshipStatements,
    artifactSourceAttributions,
    evidenceArtifactBindings,
    knowledgeStateStatements,
    traversalPolicy,
    foundationTargets,
  };
}

/** CONTRACT-MAPPED exact historical PostgreSQL read boundary for RCV-016 V1. */
export class Rcv016PostgresHistoricalReadRepository implements Rcv016HistoricalSnapshotReadRepositoryV1 {
  constructor(private readonly pool: Rcv016PostgresReadPool) {}

  async loadHistoricalSnapshotById(
    snapshotId: Rcv016ProvenanceSnapshotIdV1,
  ): Promise<Rcv016HistoricalSnapshotReadV1 | null> {
    const client = await this.pool.connect();
    let began = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      began = true;
      const result = await loadHistoricalSnapshot(client, snapshotId);
      await client.query("COMMIT");
      began = false;
      return result;
    } catch (error) {
      if (began) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
