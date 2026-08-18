import { RequestHandler, Router } from "express";
import { createClaimController } from "../controllers/claimController";

export function buildClaimsRouter(
  handler: RequestHandler = createClaimController,
) {
  const router = Router();

  router.post("/", handler);

  return router;
}

const router = buildClaimsRouter();

export default router;
