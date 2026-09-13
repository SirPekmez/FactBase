import { Rcv019PostgresReadRepository, Rcv019ReadQueryable } from "./rcv019PostgresReadRepository";
import { verifyRcv019ReadBundle, Rcv019VerifiedRead } from "./rcv019ReadVerifier";

export async function readAndVerifyRcv019Analysis(pool: Rcv019ReadQueryable, analysisId: unknown): Promise<Rcv019VerifiedRead | null> {
  const bundle = await new Rcv019PostgresReadRepository(pool).loadAnalysisById(analysisId);
  return bundle === null ? null : verifyRcv019ReadBundle(bundle);
}

export class Rcv019ReadService {
  constructor(private readonly pool: Rcv019ReadQueryable) {}
  readAnalysis(analysisId: unknown): Promise<Rcv019VerifiedRead | null> { return readAndVerifyRcv019Analysis(this.pool, analysisId); }
}
