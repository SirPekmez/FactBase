import { RequestHandler, Router } from "express";
import { createClaimController } from "../controllers/claimController";
import { createClaimVersionController } from "../controllers/claimVersionController";
import {
  createEvidenceAssessmentController,
  createEvidenceController,
} from "../controllers/evidenceController";
import {
  diffClaimVersionsController,
  getClaimVersionController,
} from "../controllers/claimVersionReadController";

export function buildClaimsRouter(
  createHandler: RequestHandler = createClaimController,
  createVersionHandler: RequestHandler = createClaimVersionController,
  createEvidenceHandler: RequestHandler = createEvidenceController,
  createAssessmentHandler: RequestHandler = createEvidenceAssessmentController,
  getVersionHandler: RequestHandler = getClaimVersionController,
  diffVersionsHandler: RequestHandler = diffClaimVersionsController,
) {
  const router = Router();

  router.post("/", createHandler);
  router.post("/:claimId/versions", createVersionHandler);
  router.post(
    "/:claimId/versions/:versionId/evidence",
    createEvidenceHandler,
  );
  router.post(
    "/:claimId/versions/:versionId/evidence/:evidenceId/assessment",
    createAssessmentHandler,
  );
  router.get(
    "/:claimId/versions/:fromVersionId/diff/:toVersionId",
    diffVersionsHandler,
  );
  router.get("/:claimId/versions/:versionId", getVersionHandler);

  return router;
}

const router = buildClaimsRouter();

export default router;
