import { Request, Response } from "express";
import {
  ASSESSMENT_METHODS,
  ASSESSMENT_RESPONSE_RELATIONS,
  IMPORT_REFERENCE_TYPES,
  MODEL_PROCESS_TYPES,
  RECENCY_REFERENCE_TYPES,
  AssessmentGraphConflictError,
  AssessmentResponseTargetNotFoundError,
  ClaimVersionNotFoundError,
  CreateEvidenceAssessmentInput,
  CreateEvidenceInput,
  EVIDENCE_RELATIONS,
  EvidenceRelationNotFoundError,
  IndependenceComparisonError,
  createEvidenceAssessment,
  createEvidenceForClaimVersion,
} from "../services/evidenceService";
import {
  ASSESSMENT_INITIATOR_TYPES,
  AssessmentInitiatorType,
  TrustedOperationContext,
} from "../types/operationContext";

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
  "recencyReferenceType",
  "recencyReferenceAt",
  "independenceComparisonRelationIds",
  "ruleSetId",
  "ruleSetVersion",
  "modelId",
  "modelVersion",
  "modelProcessType",
  "modelProcessVersion",
  "importReferenceType",
  "importReference",
  "respondsToAssessmentId",
  "responseRelation",
] as const;

const assessmentDimensionFields = assessmentFields.slice(0, 5);

type CreateEvidenceOperation = typeof createEvidenceForClaimVersion;
type CreateAssessmentOperation = typeof createEvidenceAssessment;
type ResolveOperationContext = (
  req: Request,
  res: Response,
) => TrustedOperationContext | undefined;

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

function defaultResolveOperationContext(
  _req: Request,
  res: Response,
): TrustedOperationContext | undefined {
  const context = (res.locals as Record<string, unknown> | undefined)
    ?.operationContext;
  if (context === undefined) {
    return undefined;
  }
  if (!isRecord(context)) {
    throw new Error("Invalid trusted operation context");
  }

  const initiator = context.initiator;
  if (initiator === undefined) {
    return {};
  }
  if (
    !isRecord(initiator) ||
    typeof initiator.type !== "string" ||
    !ASSESSMENT_INITIATOR_TYPES.includes(
      initiator.type as (typeof ASSESSMENT_INITIATOR_TYPES)[number],
    ) ||
    !(
      initiator.id === null ||
      (typeof initiator.id === "string" && initiator.id.trim() !== "")
    )
  ) {
    throw new Error("Invalid trusted assessment initiator");
  }

  return {
    initiator: {
      type: initiator.type as AssessmentInitiatorType,
      id: initiator.id,
    },
  };
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

  for (const field of assessmentDimensionFields) {
    const value = body[field];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      return undefined;
    }
  }

  if (!assessmentDimensionFields.some((field) => body[field] !== undefined)) {
    return undefined;
  }
  if (
    typeof body.assessmentMethod !== "string" ||
    !ASSESSMENT_METHODS.includes(
      body.assessmentMethod as (typeof ASSESSMENT_METHODS)[number],
    ) ||
    typeof body.rationale !== "string" ||
    body.rationale.trim().length === 0 ||
    Array.from(body.rationale).length > 4000
  ) {
    return undefined;
  }

  const hasRecency = body.recency !== undefined;
  const hasRecencyType = body.recencyReferenceType !== undefined;
  const hasRecencyAt = body.recencyReferenceAt !== undefined;
  if (
    hasRecency !== hasRecencyType ||
    hasRecency !== hasRecencyAt ||
    (hasRecencyType &&
      (typeof body.recencyReferenceType !== "string" ||
        !RECENCY_REFERENCE_TYPES.includes(
          body.recencyReferenceType as (typeof RECENCY_REFERENCE_TYPES)[number],
        ))) ||
    (hasRecencyAt &&
      (typeof body.recencyReferenceAt !== "string" ||
        !timestampPattern.test(body.recencyReferenceAt) ||
        !Number.isFinite(Date.parse(body.recencyReferenceAt))))
  ) {
    return undefined;
  }

  const hasIndependence = body.independence !== undefined;
  if (hasIndependence !== (body.independenceComparisonRelationIds !== undefined)) {
    return undefined;
  }
  let normalizedComparisonRelationIds: string[] | undefined;
  if (
    hasIndependence &&
    (!Array.isArray(body.independenceComparisonRelationIds) ||
      body.independenceComparisonRelationIds.length === 0 ||
      body.independenceComparisonRelationIds.some(
        (value) => typeof value !== "string" || !uuidPattern.test(value),
      ))
  ) {
    return undefined;
  }
  if (hasIndependence) {
    normalizedComparisonRelationIds = (
      body.independenceComparisonRelationIds as string[]
    ).map((value) => value.toLowerCase());
    if (
      new Set(normalizedComparisonRelationIds).size !==
      normalizedComparisonRelationIds.length
    ) {
      return undefined;
    }
  }

  const methodStringFields = [
    "ruleSetId",
    "ruleSetVersion",
    "modelId",
    "modelVersion",
    "modelProcessVersion",
    "importReference",
  ] as const;
  if (methodStringFields.some((field) => !isOptionalNonEmptyString(body[field]))) {
    return undefined;
  }

  const hasRuleSet = body.ruleSetId !== undefined || body.ruleSetVersion !== undefined;
  const hasModel =
    body.modelId !== undefined ||
    body.modelVersion !== undefined ||
    body.modelProcessType !== undefined ||
    body.modelProcessVersion !== undefined;
  const hasImport =
    body.importReferenceType !== undefined || body.importReference !== undefined;

  if (
    (body.assessmentMethod === "manual" && (hasRuleSet || hasModel || hasImport)) ||
    (body.assessmentMethod === "rules_based" &&
      (typeof body.ruleSetId !== "string" ||
        typeof body.ruleSetVersion !== "string" ||
        hasModel ||
        hasImport)) ||
    (body.assessmentMethod === "model_assisted" &&
      (typeof body.modelId !== "string" ||
        typeof body.modelVersion !== "string" ||
        typeof body.modelProcessType !== "string" ||
        !MODEL_PROCESS_TYPES.includes(
          body.modelProcessType as (typeof MODEL_PROCESS_TYPES)[number],
        ) ||
        typeof body.modelProcessVersion !== "string" ||
        hasRuleSet ||
        hasImport)) ||
    (body.assessmentMethod === "imported" &&
      (typeof body.importReferenceType !== "string" ||
        !IMPORT_REFERENCE_TYPES.includes(
          body.importReferenceType as (typeof IMPORT_REFERENCE_TYPES)[number],
        ) ||
        typeof body.importReference !== "string" ||
        hasRuleSet ||
        hasModel))
  ) {
    return undefined;
  }

  const hasResponseTarget = body.respondsToAssessmentId !== undefined;
  const hasResponseRelation = body.responseRelation !== undefined;
  if (
    hasResponseTarget !== hasResponseRelation ||
    (hasResponseTarget &&
      (typeof body.respondsToAssessmentId !== "string" ||
        !uuidPattern.test(body.respondsToAssessmentId))) ||
    (hasResponseRelation &&
      (typeof body.responseRelation !== "string" ||
        !ASSESSMENT_RESPONSE_RELATIONS.includes(
          body.responseRelation as (typeof ASSESSMENT_RESPONSE_RELATIONS)[number],
        )))
  ) {
    return undefined;
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
    assessmentMethod:
      body.assessmentMethod as CreateEvidenceAssessmentInput["assessmentMethod"],
    rationale: body.rationale,
    recencyReferenceType:
      body.recencyReferenceType as CreateEvidenceAssessmentInput["recencyReferenceType"],
    recencyReferenceAt:
      typeof body.recencyReferenceAt === "string"
        ? new Date(body.recencyReferenceAt)
        : undefined,
    independenceComparisonRelationIds: normalizedComparisonRelationIds,
    ruleSetId: body.ruleSetId as string | undefined,
    ruleSetVersion: body.ruleSetVersion as string | undefined,
    modelId: body.modelId as string | undefined,
    modelVersion: body.modelVersion as string | undefined,
    modelProcessType:
      body.modelProcessType as CreateEvidenceAssessmentInput["modelProcessType"],
    modelProcessVersion: body.modelProcessVersion as string | undefined,
    importReferenceType:
      body.importReferenceType as CreateEvidenceAssessmentInput["importReferenceType"],
    importReference: body.importReference as string | undefined,
    respondsToAssessmentId: body.respondsToAssessmentId as string | undefined,
    responseRelation:
      body.responseRelation as CreateEvidenceAssessmentInput["responseRelation"],
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
  resolveOperationContext: ResolveOperationContext = defaultResolveOperationContext,
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
      const operationContext = resolveOperationContext(req, res);
      return res
        .status(201)
        .json(await createAssessment({ ...input, operationContext }));
    } catch (error) {
      if (error instanceof EvidenceRelationNotFoundError) {
        return res.status(404).json({ error: "Evidence relation not found" });
      }
      if (error instanceof AssessmentResponseTargetNotFoundError) {
        return res
          .status(404)
          .json({ error: "Assessment response target not found" });
      }
      if (error instanceof AssessmentGraphConflictError) {
        return res.status(409).json({
          error: "Assessment response graph conflict",
          reason: error.reason,
        });
      }
      if (error instanceof IndependenceComparisonError) {
        return res.status(
          error.reason === "not_found_or_wrong_version" ? 404 : 400,
        ).json({
          error: "Invalid independence comparison relations",
          reason: error.reason,
        });
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
