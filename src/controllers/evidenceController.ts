import { Request, Response } from "express";
import {
  ClaimVersionNotFoundError,
  CreateEvidenceAssessmentInput,
  CreateEvidenceInput,
  EVIDENCE_RELATIONS,
  EvidenceRelationNotFoundError,
  createEvidenceAssessment,
  createEvidenceForClaimVersion,
} from "../services/evidenceService";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const evidenceFields = [
  "sourceUrl",
  "sourceTitle",
  "sourceType",
  "locator",
  "quotedText",
  "snapshotHash",
  "retrievedAt",
  "relation",
] as const;

const assessmentFields = [
  "sourceQuality",
  "relevance",
  "directness",
  "recency",
  "independence",
  "assessmentMethod",
  "rationale",
  "assessedBy",
] as const;

type CreateEvidenceOperation = typeof createEvidenceForClaimVersion;
type CreateAssessmentOperation = typeof createEvidenceAssessment;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(
  values: Record<string, unknown>,
  fields: readonly string[],
) {
  return Object.keys(values).every((key) => fields.includes(key));
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim() !== "");
}

function parseEvidenceInput(
  claimId: string | undefined,
  versionId: string | undefined,
  body: unknown,
): CreateEvidenceInput | undefined {
  if (
    !claimId ||
    !versionId ||
    !uuidPattern.test(claimId) ||
    !uuidPattern.test(versionId) ||
    !isRecord(body) ||
    !hasOnlyFields(body, evidenceFields)
  ) {
    return undefined;
  }

  const sourceFields = evidenceFields.slice(0, 6);
  if (
    sourceFields.some((field) => !isOptionalNonEmptyString(body[field])) ||
    !sourceFields.some((field) => body[field] !== undefined) ||
    typeof body.retrievedAt !== "string" ||
    !timestampPattern.test(body.retrievedAt) ||
    !Number.isFinite(Date.parse(body.retrievedAt)) ||
    typeof body.relation !== "string" ||
    !EVIDENCE_RELATIONS.includes(
      body.relation as (typeof EVIDENCE_RELATIONS)[number],
    )
  ) {
    return undefined;
  }

  return {
    claimId,
    versionId,
    sourceUrl: body.sourceUrl as string | undefined,
    sourceTitle: body.sourceTitle as string | undefined,
    sourceType: body.sourceType as string | undefined,
    locator: body.locator as string | undefined,
    quotedText: body.quotedText as string | undefined,
    snapshotHash: body.snapshotHash as string | undefined,
    retrievedAt: new Date(body.retrievedAt),
    relation: body.relation as CreateEvidenceInput["relation"],
  };
}

function parseAssessmentInput(
  claimId: string | undefined,
  versionId: string | undefined,
  evidenceId: string | undefined,
  body: unknown,
): CreateEvidenceAssessmentInput | undefined {
  if (
    !claimId ||
    !versionId ||
    !evidenceId ||
    !uuidPattern.test(claimId) ||
    !uuidPattern.test(versionId) ||
    !uuidPattern.test(evidenceId) ||
    !isRecord(body) ||
    !hasOnlyFields(body, assessmentFields) ||
    Object.keys(body).length === 0
  ) {
    return undefined;
  }

  for (const field of assessmentFields.slice(0, 5)) {
    const value = body[field];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      return undefined;
    }
  }

  for (const field of assessmentFields.slice(5)) {
    if (!isOptionalNonEmptyString(body[field])) {
      return undefined;
    }
  }

  return {
    claimId,
    versionId,
    evidenceId,
    sourceQuality: body.sourceQuality as number | undefined,
    relevance: body.relevance as number | undefined,
    directness: body.directness as number | undefined,
    recency: body.recency as number | undefined,
    independence: body.independence as number | undefined,
    assessmentMethod: body.assessmentMethod as string | undefined,
    rationale: body.rationale as string | undefined,
    assessedBy: body.assessedBy as string | undefined,
  };
}

export function buildCreateEvidenceController(
  createEvidence: CreateEvidenceOperation = createEvidenceForClaimVersion,
) {
  return async function createEvidenceController(req: Request, res: Response) {
    const input = parseEvidenceInput(
      typeof req.params.claimId === "string" ? req.params.claimId : undefined,
      typeof req.params.versionId === "string"
        ? req.params.versionId
        : undefined,
      req.body,
    );
    if (!input) {
      return res.status(400).json({ error: "Invalid evidence request" });
    }

    try {
      return res.status(201).json(await createEvidence(input));
    } catch (error) {
      if (error instanceof ClaimVersionNotFoundError) {
        return res.status(404).json({ error: "Claim version not found" });
      }
      return res.status(500).json({ error: "Evidence could not be created" });
    }
  };
}

export function buildCreateEvidenceAssessmentController(
  createAssessment: CreateAssessmentOperation = createEvidenceAssessment,
) {
  return async function createEvidenceAssessmentController(
    req: Request,
    res: Response,
  ) {
    const input = parseAssessmentInput(
      typeof req.params.claimId === "string" ? req.params.claimId : undefined,
      typeof req.params.versionId === "string"
        ? req.params.versionId
        : undefined,
      typeof req.params.evidenceId === "string"
        ? req.params.evidenceId
        : undefined,
      req.body,
    );
    if (!input) {
      return res.status(400).json({ error: "Invalid assessment request" });
    }

    try {
      return res.status(201).json(await createAssessment(input));
    } catch (error) {
      if (error instanceof EvidenceRelationNotFoundError) {
        return res.status(404).json({ error: "Evidence relation not found" });
      }
      return res
        .status(500)
        .json({ error: "Evidence assessment could not be created" });
    }
  };
}

export const createEvidenceController = buildCreateEvidenceController();
export const createEvidenceAssessmentController =
  buildCreateEvidenceAssessmentController();
