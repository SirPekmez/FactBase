import { Request, Response } from "express";
import {
  ClaimNotFoundError,
  ClaimVersionConflictError,
  CreatedClaimVersion,
  CreateClaimVersionInput,
  createClaimVersion,
} from "../services/claimVersionService";

type CreateClaimVersionOperation = (
  input: CreateClaimVersionInput,
) => Promise<CreatedClaimVersion>;

const requestFields = [
  "basedOnVersionNumber",
  "title",
  "normalizedStatement",
  "language",
  "claimType",
  "changeReason",
] as const;

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCreateClaimVersionInput(
  claimId: string | undefined,
  body: unknown,
): CreateClaimVersionInput | undefined {
  if (
    !claimId ||
    !uuidPattern.test(claimId) ||
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    return undefined;
  }

  const values = body as Record<string, unknown>;
  const containsOnlyRequestFields = Object.keys(values).every((key) =>
    requestFields.includes(key as (typeof requestFields)[number]),
  );

  if (
    !containsOnlyRequestFields ||
    !Number.isSafeInteger(values.basedOnVersionNumber) ||
    (values.basedOnVersionNumber as number) <= 0 ||
    (values.basedOnVersionNumber as number) > POSTGRES_INTEGER_MAX
  ) {
    return undefined;
  }

  for (const field of requestFields.slice(1)) {
    if (typeof values[field] !== "string" || values[field].trim() === "") {
      return undefined;
    }
  }

  return {
    claimId,
    basedOnVersionNumber: values.basedOnVersionNumber as number,
    title: values.title as string,
    normalizedStatement: values.normalizedStatement as string,
    language: values.language as string,
    claimType: values.claimType as string,
    changeReason: values.changeReason as string,
  };
}

export function buildCreateClaimVersionController(
  createVersion: CreateClaimVersionOperation = createClaimVersion,
) {
  return async function createClaimVersionController(
    req: Request,
    res: Response,
  ) {
    const claimId =
      typeof req.params.claimId === "string" ? req.params.claimId : undefined;
    const input = readCreateClaimVersionInput(claimId, req.body);

    if (!input) {
      return res.status(400).json({
        error:
          "claimId must be a UUID; basedOnVersionNumber must be a positive integer no greater than 2147483647; title, normalizedStatement, language, claimType and changeReason must be non-empty strings; no other fields are accepted",
      });
    }

    try {
      const version = await createVersion(input);
      return res.status(201).json(version);
    } catch (error) {
      if (error instanceof ClaimNotFoundError) {
        return res.status(404).json({ error: "Claim not found" });
      }

      if (error instanceof ClaimVersionConflictError) {
        const response: {
          error: string;
          currentVersionNumber?: number;
        } = {
          error: "Claim version conflict",
        };

        if (error.currentVersionNumber !== undefined) {
          response.currentVersionNumber = error.currentVersionNumber;
        }

        return res.status(409).json(response);
      }

      return res.status(500).json({
        error: "Claim version could not be created",
      });
    }
  };
}

export const createClaimVersionController =
  buildCreateClaimVersionController();
