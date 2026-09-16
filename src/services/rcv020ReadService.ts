import { Rcv020PostgresReadRepository, Rcv020ReadPool } from "./rcv020PostgresReadRepository";
import { verifyRcv020ReadBundle, Rcv020ReadVerificationError, Rcv020VerifiedRead } from "./rcv020ReadVerifier";

export class Rcv020ReadService {
  private readonly repository: Rcv020PostgresReadRepository;
  constructor(repositoryOrPool: Rcv020PostgresReadRepository | Rcv020ReadPool) {
    this.repository = repositoryOrPool instanceof Rcv020PostgresReadRepository
      ? repositoryOrPool
      : new Rcv020PostgresReadRepository(repositoryOrPool);
  }

  async readOccurrence(occurrenceId: string): Promise<Rcv020VerifiedRead | null> {
    const bundle = await this.repository.loadByOccurrenceId(occurrenceId);
    if (bundle === null) return null;
    return verifyRcv020ReadBundle(bundle);
  }
  verifyOccurrence(occurrenceId: string): Promise<Rcv020VerifiedRead | null> { return this.readOccurrence(occurrenceId); }
}

export { Rcv020ReadVerificationError };
