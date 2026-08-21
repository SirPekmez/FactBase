import { randomUUID } from "node:crypto";
import { Pool, PoolClient, QueryResultRow } from "pg";
import databasePool from "../db";
import { TrustedOperationContext } from "../types/operationContext";
import { runInTransaction } from "./transaction";

export const EVIDENCE_RELATIONS = [
  "supports",
  "contradicts",
  "contextualizes",
] as const;

export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

export const ASSESSMENT_METHODS = [
  "manual",
  "rules_based",
  "model_assisted",
  "imported",
] as const;
export type AssessmentMethod = (typeof ASSESSMENT_METHODS)[number];

export const ASSESSMENT_RESPONSE_RELATIONS = [
  "supports",
  "disputes",
  "contextualizes",
] as const;
export type AssessmentResponseRelation =
  (typeof ASSESSMENT_RESPONSE_RELATIONS)[number];

export interface CreateEvidenceInput {
  claimId: string;
  versionId: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceType?: string;
  locator?: string;
  quotedText?: string;
  snapshotHash?: string;
  retrievedAt: Date;
  relation: EvidenceRelation;
}

export interface CreateEvidenceAssessmentInput {
  claimId: string;
  versionId: string;
  evidenceId: string;
  sourceQuality?: number;
  relevance?: number;
  directness?: number;
  recency?: number;
  independence?: number;
  assessmentMethod: AssessmentMethod;
  rationale: string;
  respondsToAssessmentId?: string;
  responseRelation?: AssessmentResponseRelation;
  operationContext?: TrustedOperationContext;
}

interface IdRow extends QueryResultRow {
  id: string;
}

interface AssessmentChainRow extends QueryResultRow {
  id: string;
  claim_version_evidence_id: string;
  responds_to_assessment_id: string | null;
}

interface EvidenceRow extends QueryResultRow {
  id: string;
  source_url: string | null;
  source_title: string | null;
  source_type: string | null;
  locator: string | null;
  quoted_text: string | null;
  snapshot_hash: string | null;
  retrieved_at: Date;
  created_at: Date;
}

interface EvidenceRelationRow extends QueryResultRow {
  id: string;
  claim_version_id: string;
  evidence_id: string;
  relation: EvidenceRelation;
  created_at: Date;
}

interface AssessmentRow extends QueryResultRow {
  id: string;
  claim_version_evidence_id: string;
  source_quality: string | number | null;
  relevance: string | number | null;
  directness: string | number | null;
  recency: string | number | null;
  independence: string | number | null;
  assessment_method: string | null;
  rationale: string | null;
  assessed_by: string | null;
  initiator_type: string | null;
  initiator_id: string | null;
  responds_to_assessment_id: string | null;
  response_relation: string | null;
  assessed_at: Date;
}

type EvidencePool = Pick<Pool, "connect">;

export class ClaimVersionNotFoundError extends Error {
  constructor(
    public readonly claimId: string,
    public readonly versionId: string,
  ) {
    super(`Version ${versionId} was not found for claim ${claimId}`);
    this.name = "ClaimVersionNotFoundError";
  }
}

export class EvidenceRelationNotFoundError extends Error {
  constructor(
    public readonly versionId: string,
    public readonly evidenceId: string,
  ) {
    super(`Evidence ${evidenceId} is not related to version ${versionId}`);
    this.name = "EvidenceRelationNotFoundError";
  }
}

export class AssessmentResponseTargetNotFoundError extends Error {
  constructor(
    public readonly assessmentId: string,
    public readonly claimVersionEvidenceId: string,
  ) {
    super(
      `Assessment ${assessmentId} was not found for evidence relation ${claimVersionEvidenceId}`,
    );
    this.name = "AssessmentResponseTargetNotFoundError";
  }
}

export type AssessmentGraphConflictReason =
  | "existing_cycle"
  | "would_create_cycle"
  | "cross_relation_ancestor"
  | "missing_ancestor";

export class AssessmentGraphConflictError extends Error {
  constructor(public readonly reason: AssessmentGraphConflictReason) {
    super(`Assessment response graph conflict: ${reason}`);
    this.name = "AssessmentGraphConflictError";
  }
}

export function inspectAssessmentParentChain(
  rows: ReadonlyArray<{
    id: string;
    claim_version_evidence_id: string;
    responds_to_assessment_id: string | null;
  }>,
  parentAssessmentId: string,
  newAssessmentId: string,
  relationId: string,
): AssessmentGraphConflictReason | undefined {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const visited = new Set<string>();
  let currentId: string | null = parentAssessmentId;

  while (currentId !== null) {
    if (currentId === newAssessmentId) {
      return "would_create_cycle";
    }
    if (visited.has(currentId)) {
      return "existing_cycle";
    }
    visited.add(currentId);

    const current = rowsById.get(currentId);
    if (!current) {
      return "missing_ancestor";
    }
    if (current.claim_version_evidence_id !== relationId) {
      return "cross_relation_ancestor";
    }
    currentId = current.responds_to_assessment_id;
  }

  return undefined;
}

function optionalNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

export async function createEvidenceForClaimVersion(
  input: CreateEvidenceInput,
  pool: EvidencePool = databasePool,
) {
  return runInTransaction(
    pool,
    "Evidence creation failed and the transaction could not be rolled back",
    async (client) => {
      const versionResult = await client.query<IdRow>(
        `SELECT id
        FROM public.claim_versions
        WHERE id = $1 AND claim_id = $2`,
        [input.versionId, input.claimId],
      );

      if (!versionResult.rows[0]) {
        throw new ClaimVersionNotFoundError(input.claimId, input.versionId);
      }

      const evidenceId = randomUUID();
      const relationId = randomUUID();
      const evidenceResult = await client.query<EvidenceRow>(
        `INSERT INTO public.evidence (
          id,
          source_url,
          source_title,
          source_type,
          locator,
          quoted_text,
          snapshot_hash,
          retrieved_at,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        RETURNING
          id,
          source_url,
          source_title,
          source_type,
          locator,
          quoted_text,
          snapshot_hash,
          retrieved_at,
          created_at`,
        [
          evidenceId,
          input.sourceUrl ?? null,
          input.sourceTitle ?? null,
          input.sourceType ?? null,
          input.locator ?? null,
          input.quotedText ?? null,
          input.snapshotHash ?? null,
          input.retrievedAt,
        ],
      );
      const evidence = evidenceResult.rows[0];
      if (!evidence) {
        throw new Error("Evidence insert returned no row");
      }

      const relationResult = await client.query<EvidenceRelationRow>(
        `INSERT INTO public.claim_version_evidence (
          id,
          claim_version_id,
          evidence_id,
          relation,
          created_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        RETURNING id, claim_version_id, evidence_id, relation, created_at`,
        [relationId, input.versionId, evidence.id, input.relation],
      );
      const relation = relationResult.rows[0];
      if (!relation) {
        throw new Error("Evidence relation insert returned no row");
      }

      return {
        claimId: input.claimId,
        versionId: input.versionId,
        evidence: {
          id: evidence.id,
          sourceUrl: evidence.source_url,
          sourceTitle: evidence.source_title,
          sourceType: evidence.source_type,
          locator: evidence.locator,
          quotedText: evidence.quoted_text,
          snapshotHash: evidence.snapshot_hash,
          retrievedAt: evidence.retrieved_at,
          createdAt: evidence.created_at,
          relation: relation.relation,
          relationId: relation.id,
          relationCreatedAt: relation.created_at,
        },
      };
    },
  );
}

export async function createEvidenceAssessment(
  input: CreateEvidenceAssessmentInput,
  pool: EvidencePool = databasePool,
) {
  return runInTransaction(
    pool,
    "Evidence assessment creation failed and the transaction could not be rolled back",
    async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const relationResult = await client.query<IdRow>(
        `SELECT cve.id
        FROM public.claim_version_evidence cve
        INNER JOIN public.claim_versions cv
          ON cv.id = cve.claim_version_id
        WHERE cv.id = $1
          AND cv.claim_id = $2
          AND cve.evidence_id = $3
        FOR UPDATE OF cve`,
        [input.versionId, input.claimId, input.evidenceId],
      );
      const relation = relationResult.rows[0];

      if (!relation) {
        throw new EvidenceRelationNotFoundError(
          input.versionId,
          input.evidenceId,
        );
      }

      if (input.respondsToAssessmentId) {
        const responseTargetResult = await client.query<IdRow>(
          `SELECT id
          FROM public.evidence_assessments
          WHERE id = $1 AND claim_version_evidence_id = $2`,
          [input.respondsToAssessmentId, relation.id],
        );
        if (!responseTargetResult.rows[0]) {
          throw new AssessmentResponseTargetNotFoundError(
            input.respondsToAssessmentId,
            relation.id,
          );
        }

        const assessmentId = randomUUID();
        const chainResult = await client.query<AssessmentChainRow>(
            `WITH RECURSIVE ancestry AS (
              SELECT
                ea.id,
                ea.claim_version_evidence_id,
                ea.responds_to_assessment_id
              FROM public.evidence_assessments ea
              WHERE ea.id = $1

              UNION

              SELECT
                parent.id,
                parent.claim_version_evidence_id,
                parent.responds_to_assessment_id
              FROM ancestry
              INNER JOIN public.evidence_assessments parent
                ON parent.id = ancestry.responds_to_assessment_id
            )
            SELECT
              id,
              claim_version_evidence_id,
              responds_to_assessment_id
            FROM ancestry`,
            [input.respondsToAssessmentId],
          );
        const conflictReason = inspectAssessmentParentChain(
          chainResult.rows,
          input.respondsToAssessmentId,
          assessmentId,
          relation.id,
        );
        if (conflictReason) {
          throw new AssessmentGraphConflictError(conflictReason);
        }

        return insertEvidenceAssessment(
          client,
          input,
          relation.id,
          assessmentId,
        );
      }

      const assessmentId = randomUUID();
      return insertEvidenceAssessment(client, input, relation.id, assessmentId);
    },
  );
}

async function insertEvidenceAssessment(
  client: PoolClient,
  input: CreateEvidenceAssessmentInput,
  relationId: string,
  assessmentId: string,
) {
  const initiator = input.operationContext?.initiator;
  const assessmentResult = await client.query<AssessmentRow>(
    `INSERT INTO public.evidence_assessments (
      id,
      claim_version_evidence_id,
      source_quality,
      relevance,
      directness,
      recency,
      independence,
      assessment_method,
      rationale,
      assessed_by,
      initiator_type,
      initiator_id,
      responds_to_assessment_id,
      response_relation,
      assessed_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL,
      $10, $11, $12, $13, CURRENT_TIMESTAMP
    )
    RETURNING
      id,
      claim_version_evidence_id,
      source_quality,
      relevance,
      directness,
      recency,
      independence,
      assessment_method,
      rationale,
      assessed_by,
      initiator_type,
      initiator_id,
      responds_to_assessment_id,
      response_relation,
      assessed_at`,
    [
      assessmentId,
      relationId,
      input.sourceQuality ?? null,
      input.relevance ?? null,
      input.directness ?? null,
      input.recency ?? null,
      input.independence ?? null,
      input.assessmentMethod,
      input.rationale,
      initiator?.type ?? null,
      initiator?.id ?? null,
      input.respondsToAssessmentId ?? null,
      input.responseRelation ?? null,
    ],
  );
  const assessment = assessmentResult.rows[0];
  if (!assessment) {
    throw new Error("Evidence assessment insert returned no row");
  }

  return {
    claimId: input.claimId,
    versionId: input.versionId,
    evidenceId: input.evidenceId,
    assessment: {
      id: assessment.id,
      claimVersionEvidenceId: assessment.claim_version_evidence_id,
      sourceQuality: optionalNumber(assessment.source_quality),
      relevance: optionalNumber(assessment.relevance),
      directness: optionalNumber(assessment.directness),
      recency: optionalNumber(assessment.recency),
      independence: optionalNumber(assessment.independence),
      assessmentMethod: assessment.assessment_method,
      rationale: assessment.rationale,
      initiator:
        assessment.initiator_type === null
          ? null
          : {
              type: assessment.initiator_type,
              id: assessment.initiator_id,
            },
      responseTo:
        assessment.responds_to_assessment_id === null
          ? null
          : {
              assessmentId: assessment.responds_to_assessment_id,
              relation: assessment.response_relation,
            },
      legacyAssessedBy: assessment.assessed_by,
      assessedAt: assessment.assessed_at,
    },
  };
}
