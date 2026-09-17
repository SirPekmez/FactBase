import type { Rcv021PgPool } from "./rcv021PostgresRepository";
import { Rcv021PostgresReadRepository } from "./rcv021PostgresReadRepository";
import { verifyRcv021HistoricalGraph, Rcv021VerifiedHistoricalGraph } from "./rcv021ReadVerifier";

/** Historical read boundary: retrieval and independent verification are separate steps. */
export class Rcv021ReadService {
  constructor(private readonly repository: Rcv021PostgresReadRepository) {}
  static fromPool(pool: Rcv021PgPool): Rcv021ReadService { return new Rcv021ReadService(new Rcv021PostgresReadRepository(pool)); }
  async verifyOperation(operationId: string): Promise<Rcv021VerifiedHistoricalGraph | null> {
    const graph = await this.repository.loadByOperationId(operationId);
    return graph === null ? null : verifyRcv021HistoricalGraph(graph);
  }
}
