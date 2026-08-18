import { RequestHandler, Router } from "express";
import { createClaimController } from "../controllers/claimController";
import { createClaimVersionController } from "../controllers/claimVersionController";

export function buildClaimsRouter(
  createHandler: RequestHandler = createClaimController,
  createVersionHandler: RequestHandler = createClaimVersionController,
) {
  const router = Router();

  router.post("/", createHandler);
  router.post("/:claimId/versions", createVersionHandler);

  return router;
}

const router = buildClaimsRouter();

export default router;
