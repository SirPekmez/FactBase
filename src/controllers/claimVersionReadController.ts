import { Request, Response } from "express";
import {
  diffClaimVersions,
  getClaimVersionDetails,
} from "../services/claimVersionReadService";
import { ClaimVersionNotFoundError } from "../services/evidenceService";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReadVersionOperation = typeof getClaimVersionDetails;
type DiffVersionsOperation = typeof diffClaimVersions;

export function buildGetClaimVersionController(
  readVersion: ReadVersionOperation = getClaimVersionDetails,
) {
  return async function getClaimVersionController(req: Request, res: Response) {
    const claimId =
      typeof req.params.claimId === "string" ? req.params.claimId : undefined;
    const versionId =
      typeof req.params.versionId === "string"
        ? req.params.versionId
        : undefined;
    if (
      !claimId ||
      !versionId ||
      !uuidPattern.test(claimId) ||
      !uuidPattern.test(versionId)
    ) {
      return res.status(400).json({ error: "Invalid claim or version id" });
    }

    try {
      return res.status(200).json(await readVersion(claimId, versionId));
    } catch (error) {
      if (error instanceof ClaimVersionNotFoundError) {
        return res.status(404).json({ error: "Claim version not found" });
      }
      return res.status(500).json({ error: "Claim version could not be read" });
    }
  };
}

export function buildDiffClaimVersionsController(
  diffVersions: DiffVersionsOperation = diffClaimVersions,
) {
  return async function diffClaimVersionsController(
    req: Request,
    res: Response,
  ) {
    const claimId =
      typeof req.params.claimId === "string" ? req.params.claimId : undefined;
    const fromVersionId =
      typeof req.params.fromVersionId === "string"
        ? req.params.fromVersionId
        : undefined;
    const toVersionId =
      typeof req.params.toVersionId === "string"
        ? req.params.toVersionId
        : undefined;
    if (
      !claimId ||
      !fromVersionId ||
      !toVersionId ||
      !uuidPattern.test(claimId) ||
      !uuidPattern.test(fromVersionId) ||
      !uuidPattern.test(toVersionId)
    ) {
      return res.status(400).json({ error: "Invalid claim or version id" });
    }

    try {
      return res
        .status(200)
        .json(await diffVersions(claimId, fromVersionId, toVersionId));
    } catch (error) {
      if (error instanceof ClaimVersionNotFoundError) {
        return res.status(404).json({ error: "Claim version not found" });
      }
      return res.status(500).json({ error: "Claim versions could not be diffed" });
    }
  };
}

export const getClaimVersionController = buildGetClaimVersionController();
export const diffClaimVersionsController = buildDiffClaimVersionsController();
