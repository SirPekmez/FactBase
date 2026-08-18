import express, { Router } from "express";
import authRouter from "./routes/auth";
import defaultClaimsRouter from "./routes/claims";

export function buildApp(claimsRouter: Router = defaultClaimsRouter) {
  const app = express();

  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/claims", claimsRouter);

  return app;
}

const app = buildApp();

export default app;
