import { Pool, PoolClient, QueryResultRow } from "pg";
import databasePool from "../db";
import { ClaimVersionNotFoundError } from "./evidenceService";
import { runInTransaction } from "./transaction";

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
  created_at: Date;
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
  retrieved_at: Date;
  evidence_created_at: Date;
  relation_created_at: Date;
}

interface AssessmentRow extends QueryResultRow {
  id: string;
  relation_id: string;
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
  parent_assessment_id: string | null;
  parent_relation_id: string | null;
  assessed_at: Date;
}

export const ASSESSMENT_GRAPH_ANOMALY_CODES = [
  "missing_parent",
  "cross_relation_parent",
  "incomplete_response_pair",
  "invalid_response_relation",
  "self_response",
  "cycle",
] as const;

export type AssessmentGraphAnomalyCode =
  (typeof ASSESSMENT_GRAPH_ANOMALY_CODES)[number];

export interface AssessmentGraphAnomaly {
  code: AssessmentGraphAnomalyCode;
  assessmentIds: string[];
  relatedAssessmentId: string | null;
  relatedClaimVersionEvidenceId: string | null;
  rawResponseRelation: string | null;
}

interface AssessmentGraph {
  unparentedAssessmentIds: string[];
  integrity: {
    status: "valid" | "anomalies_detected";
    anomalies: AssessmentGraphAnomaly[];
  };
}

type ReadPool = Pick<Pool, "connect">;

function optionalNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

const responseRelations = new Set([
  "supports",
  "disputes",
  "contextualizes",
]);

function compareAnomalies(
  left: AssessmentGraphAnomaly,
  right: AssessmentGraphAnomaly,
): number {
  const codeDifference =
    ASSESSMENT_GRAPH_ANOMALY_CODES.indexOf(left.code) -
    ASSESSMENT_GRAPH_ANOMALY_CODES.indexOf(right.code);
  if (codeDifference !== 0) {
    return codeDifference;
  }

  const leftKey = JSON.stringify([
    left.assessmentIds,
    left.relatedAssessmentId,
    left.relatedClaimVersionEvidenceId,
    left.rawResponseRelation,
  ]);
  const rightKey = JSON.stringify([
    right.assessmentIds,
    right.relatedAssessmentId,
    right.relatedClaimVersionEvidenceId,
    right.rawResponseRelation,
  ]);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function buildAssessmentGraph(
  assessments: ReadonlyArray<AssessmentRow>,
  relationId: string,
): AssessmentGraph {
  const anomalies: AssessmentGraphAnomaly[] = [];
  const assessmentsById = new Map(
    assessments.map((assessment) => [assessment.id, assessment]),
  );
  const unparentedAssessmentIds = assessments
    .filter((assessment) => assessment.responds_to_assessment_id === null)
    .map((assessment) => assessment.id);

  for (const assessment of assessments) {
    const parentId = assessment.responds_to_assessment_id;
    const responseRelation = assessment.response_relation;
    const hasParent = parentId !== null;
    const hasRelation = responseRelation !== null;

    if (hasParent !== hasRelation) {
      anomalies.push({
        code: "incomplete_response_pair",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: assessment.parent_relation_id,
        rawResponseRelation: responseRelation,
      });
    }

    if (responseRelation !== null && !responseRelations.has(responseRelation)) {
      anomalies.push({
        code: "invalid_response_relation",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: assessment.parent_relation_id,
        rawResponseRelation: responseRelation,
      });
    }

    if (parentId === null) {
      continue;
    }
    if (parentId === assessment.id) {
      anomalies.push({
        code: "self_response",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: assessment.parent_relation_id,
        rawResponseRelation: responseRelation,
      });
      continue;
    }
    if (assessment.parent_assessment_id === null) {
      anomalies.push({
        code: "missing_parent",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: null,
        rawResponseRelation: responseRelation,
      });
      continue;
    }
    if (assessment.parent_relation_id !== relationId) {
      anomalies.push({
        code: "cross_relation_parent",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: assessment.parent_relation_id,
        rawResponseRelation: responseRelation,
      });
    }
  }

  const processed = new Set<string>();
  for (const assessment of assessments) {
    if (processed.has(assessment.id)) {
      continue;
    }

    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let currentId: string | null = assessment.id;

    while (currentId !== null && !processed.has(currentId)) {
      const cycleStart = pathIndexes.get(currentId);
      if (cycleStart !== undefined) {
        const cycleIds = path.slice(cycleStart).sort();
        if (cycleIds.length > 1) {
          anomalies.push({
            code: "cycle",
            assessmentIds: cycleIds,
            relatedAssessmentId: null,
            relatedClaimVersionEvidenceId: relationId,
            rawResponseRelation: null,
          });
        }
        break;
      }

      const current = assessmentsById.get(currentId);
      if (!current) {
        break;
      }
      pathIndexes.set(currentId, path.length);
      path.push(currentId);

      const parentId = current.responds_to_assessment_id;
      if (
        parentId === null ||
        parentId === current.id ||
        current.parent_assessment_id === null ||
        current.parent_relation_id !== relationId
      ) {
        break;
      }
      currentId = parentId;
    }

    for (const id of path) {
      processed.add(id);
    }
  }

  anomalies.sort(compareAnomalies);
  return {
    unparentedAssessmentIds,
    integrity: {
      status: anomalies.length === 0 ? "valid" : "anomalies_detected",
      anomalies,
    },
  };
}

async function loadClaimVersion(
  client: PoolClient,
  claimId: string,
  versionId: string,
) {
  const versionResult = await client.query<VersionRow>(
    `SELECT
      id,
      claim_id,
      version_number,
      title,
      normalized_statement,
      language,
      claim_type,
      status,
      publication_status,
      change_reason,
      based_on_version_id,
      actor_type,
      actor_id,
      source_type,
      source_reference,
      request_id,
      created_at
    FROM public.claim_versions
    WHERE id = $1 AND claim_id = $2`,
    [versionId, claimId],
  );
  const version = versionResult.rows[0];
  if (!version) {
    throw new ClaimVersionNotFoundError(claimId, versionId);
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
      e.retrieved_at,
      e.created_at AS evidence_created_at,
      cve.created_at AS relation_created_at
    FROM public.claim_version_evidence cve
    INNER JOIN public.evidence e ON e.id = cve.evidence_id
    WHERE cve.claim_version_id = $1
    ORDER BY cve.created_at, cve.id`,
    [versionId],
  );

  const assessmentResult = await client.query<AssessmentRow>(
    `SELECT
      ea.id,
      ea.claim_version_evidence_id AS relation_id,
      ea.source_quality,
      ea.relevance,
      ea.directness,
      ea.recency,
      ea.independence,
      ea.assessment_method,
      ea.rationale,
      ea.assessed_by,
      ea.initiator_type,
      ea.initiator_id,
      ea.responds_to_assessment_id,
      ea.response_relation,
      parent.id AS parent_assessment_id,
      parent.claim_version_evidence_id AS parent_relation_id,
      ea.assessed_at
    FROM public.evidence_assessments ea
    INNER JOIN public.claim_version_evidence cve
      ON cve.id = ea.claim_version_evidence_id
    LEFT JOIN public.evidence_assessments parent
      ON parent.id = ea.responds_to_assessment_id
    WHERE cve.claim_version_id = $1
    ORDER BY ea.assessed_at, ea.id`,
    [versionId],
  );

  const assessmentsByRelation = new Map<string, AssessmentRow[]>();
  for (const assessment of assessmentResult.rows) {
    const assessments = assessmentsByRelation.get(assessment.relation_id) ?? [];
    assessments.push(assessment);
    assessmentsByRelation.set(assessment.relation_id, assessments);
  }

  return {
    claimId,
    version: {
      id: version.id,
      claimId: version.claim_id,
      versionNumber: version.version_number,
      title: version.title,
      normalizedStatement: version.normalized_statement,
      language: version.language,
      claimType: version.claim_type,
      status: version.status,
      publicationStatus: version.publication_status,
      changeReason: version.change_reason,
      basedOnVersionId: version.based_on_version_id,
      actor: {
        type: version.actor_type,
        id: version.actor_id,
      },
      source: {
        type: version.source_type,
        reference: version.source_reference,
      },
      requestId: version.request_id,
      createdAt: version.created_at,
    },
    evidence: evidenceResult.rows.map((evidence) => {
      const relationAssessments =
        assessmentsByRelation.get(evidence.relation_id) ?? [];
      return {
        id: evidence.evidence_id,
        relationId: evidence.relation_id,
        relation: evidence.relation,
        sourceUrl: evidence.source_url,
        sourceTitle: evidence.source_title,
        sourceType: evidence.source_type,
        locator: evidence.locator,
        quotedText: evidence.quoted_text,
        snapshotHash: evidence.snapshot_hash,
        retrievedAt: evidence.retrieved_at,
        createdAt: evidence.evidence_created_at,
        relationCreatedAt: evidence.relation_created_at,
        assessments: relationAssessments.map((assessment) => ({
          id: assessment.id,
          claimVersionEvidenceId: assessment.relation_id,
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
            assessment.responds_to_assessment_id === null &&
            assessment.response_relation === null
              ? null
              : {
                  assessmentId: assessment.responds_to_assessment_id,
                  relation: assessment.response_relation,
                },
          legacyAssessedBy: assessment.assessed_by,
          assessedAt: assessment.assessed_at,
        })),
        assessmentGraph: buildAssessmentGraph(
          relationAssessments,
          evidence.relation_id,
        ),
      };
    }),
  };
}

export type ClaimVersionDetails = Awaited<ReturnType<typeof loadClaimVersion>>;

export async function getClaimVersionDetails(
  claimId: string,
  versionId: string,
  pool: ReadPool = databasePool,
) {
  return runInTransaction(
    pool,
    "Claim version read failed and the transaction could not be rolled back",
    async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      return loadClaimVersion(client, claimId, versionId);
    },
  );
}

function changedValue<T>(from: T, to: T) {
  return Object.is(from, to) ? undefined : { from, to };
}

function objectsEqual(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function diffClaimVersions(
  claimId: string,
  fromVersionId: string,
  toVersionId: string,
  pool: ReadPool = databasePool,
) {
  return runInTransaction(
    pool,
    "Claim version diff failed and the transaction could not be rolled back",
    async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const from = await loadClaimVersion(client, claimId, fromVersionId);
      const to = await loadClaimVersion(client, claimId, toVersionId);

      const contentChanges = Object.fromEntries(
        [
          ["title", from.version.title, to.version.title],
          [
            "normalizedStatement",
            from.version.normalizedStatement,
            to.version.normalizedStatement,
          ],
          ["language", from.version.language, to.version.language],
          ["claimType", from.version.claimType, to.version.claimType],
        ].flatMap(([key, fromValue, toValue]) => {
          const change = changedValue(fromValue, toValue);
          return change ? [[key, change]] : [];
        }),
      );

      const provenanceEntries: Array<[string, unknown, unknown]> = [
        ["changeReason", from.version.changeReason, to.version.changeReason],
        ["actor", from.version.actor, to.version.actor],
        ["source", from.version.source, to.version.source],
        ["requestId", from.version.requestId, to.version.requestId],
        [
          "basedOnVersionId",
          from.version.basedOnVersionId,
          to.version.basedOnVersionId,
        ],
      ];
      const provenanceChanges = Object.fromEntries(
        provenanceEntries.flatMap(([key, fromValue, toValue]) => {
          const equal =
            typeof fromValue === "object" &&
            fromValue !== null &&
            typeof toValue === "object" &&
            toValue !== null
              ? objectsEqual(fromValue, toValue)
              : Object.is(fromValue, toValue);
          return equal ? [] : [[key, { from: fromValue, to: toValue }]];
        }),
      );

      const fromEvidence = new Map(from.evidence.map((item) => [item.id, item]));
      const toEvidence = new Map(to.evidence.map((item) => [item.id, item]));
      const added = [...toEvidence.keys()]
        .filter((id) => !fromEvidence.has(id))
        .sort();
      const removed = [...fromEvidence.keys()]
        .filter((id) => !toEvidence.has(id))
        .sort();
      const relationChanged = [...fromEvidence.keys()]
        .filter(
          (id) =>
            toEvidence.has(id) &&
            fromEvidence.get(id)?.relation !== toEvidence.get(id)?.relation,
        )
        .sort()
        .map((evidenceId) => ({
          evidenceId,
          from: fromEvidence.get(evidenceId)?.relation,
          to: toEvidence.get(evidenceId)?.relation,
        }));

      const fromAssessmentIds = new Set(
        from.evidence.flatMap((item) =>
          item.assessments.map((assessment) => assessment.id),
        ),
      );
      const assessmentAdded = to.evidence
        .flatMap((item) => item.assessments.map((assessment) => assessment.id))
        .filter((id) => !fromAssessmentIds.has(id))
        .sort();

      const stateChanges = Object.fromEntries(
        [
          ["status", from.version.status, to.version.status],
          [
            "publicationStatus",
            from.version.publicationStatus,
            to.version.publicationStatus,
          ],
        ].flatMap(([key, fromValue, toValue]) => {
          const change = changedValue(fromValue, toValue);
          return change ? [[key, change]] : [];
        }),
      );

      return {
        claimId,
        fromVersionId,
        toVersionId,
        contentChanges,
        provenanceChanges,
        evidenceChanges: { added, removed, relationChanged },
        assessmentChanges: { added: assessmentAdded },
        stateChanges,
      };
    },
  );
}
