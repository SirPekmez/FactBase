import { Request, Response } from "express";
import {
  CreatedClaim,
  CreateClaimInput,
  createClaimWithInitialVersion,
} from "../services/claimService";

type CreateClaimOperation = (input: CreateClaimInput) => Promise<CreatedClaim>;

const requestFields = [
  "title",
  "normalizedStatement",
  "language",
  "claimType",
] as const;

function readCreateClaimInput(body: unknown): CreateClaimInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  const values = body as Record<string, unknown>;
  const containsOnlyRequestFields = Object.keys(values).every((key) =>
    requestFields.includes(key as (typeof requestFields)[number]),
  );

  if (!containsOnlyRequestFields) {
    return undefined;
  }

  for (const field of requestFields) {
    if (typeof values[field] !== "string" || values[field].trim() === "") {
      return undefined;
    }
  }

  return {
    title: values.title as string,
    normalizedStatement: values.normalizedStatement as string,
    language: values.language as string,
    claimType: values.claimType as string,
  };
}

export function buildCreateClaimController(
  createClaim: CreateClaimOperation = createClaimWithInitialVersion,
) {
  return async function createClaimController(req: Request, res: Response) {
    const input = readCreateClaimInput(req.body);

    if (!input) {
      return res.status(400).json({
        error:
          "title, normalizedStatement, language and claimType are required and must be non-empty strings; no other fields are accepted",
      });
    }

    try {
      const claim = await createClaim(input);
      return res.status(201).json(claim);
    } catch {
      return res.status(500).json({
        error: "Claim could not be created",
      });
    }
  };
}

export const createClaimController = buildCreateClaimController();
