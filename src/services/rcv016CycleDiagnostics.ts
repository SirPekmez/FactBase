import {
  Rcv016ArtifactProvenanceCycleDiagnosticV1,
  Rcv016ArtifactProvenanceStatementIdV1,
  Rcv016ArtifactVersionIdV1,
} from "../contracts/rcv016ProvenanceContractV1";
import { canonicalizeRcv016 } from "./rcv016Canonical";
import { freezeRcv016 } from "./rcv016Validation";

export interface Rcv016CycleEdgeV1 {
  readonly statementId: Rcv016ArtifactProvenanceStatementIdV1;
  readonly subjectArtifactVersionId: Rcv016ArtifactVersionIdV1;
  readonly objectArtifactVersionId: Rcv016ArtifactVersionIdV1;
  readonly relationship: string;
}

interface NormalizedDiagnostic {
  readonly diagnostic: Rcv016ArtifactProvenanceCycleDiagnosticV1;
  readonly identity: string;
}

function ascii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeCycle(
  nodes: readonly Rcv016ArtifactVersionIdV1[],
  statementIds: readonly Rcv016ArtifactProvenanceStatementIdV1[],
): NormalizedDiagnostic {
  let selected: Rcv016ArtifactProvenanceCycleDiagnosticV1 | null = null;
  let selectedCanonical: string | null = null;
  for (let shift = 0; shift < statementIds.length; shift += 1) {
    const rotatedNodes = [
      ...nodes.slice(shift, -1),
      ...nodes.slice(0, shift),
      nodes[shift],
    ] as unknown as [
      Rcv016ArtifactVersionIdV1,
      Rcv016ArtifactVersionIdV1,
      ...Rcv016ArtifactVersionIdV1[],
    ];
    const rotatedStatements = [
      ...statementIds.slice(shift),
      ...statementIds.slice(0, shift),
    ] as unknown as [
      Rcv016ArtifactProvenanceStatementIdV1,
      ...Rcv016ArtifactProvenanceStatementIdV1[],
    ];
    const candidate: Rcv016ArtifactProvenanceCycleDiagnosticV1 = {
      code: "artifact_provenance_cycle_detected",
      artifactVersionIds: rotatedNodes,
      statementIds: rotatedStatements,
    };
    const canonical = canonicalizeRcv016(candidate).canonical;
    if (selectedCanonical === null || ascii(canonical, selectedCanonical) < 0) {
      selected = candidate;
      selectedCanonical = canonical;
    }
  }
  const finalized = selected as Rcv016ArtifactProvenanceCycleDiagnosticV1;
  return {
    diagnostic: finalized,
    identity: canonicalizeRcv016(finalized).hash,
  };
}

export function buildRcv016CycleDiagnostics(
  inputEdges: readonly Rcv016CycleEdgeV1[],
): readonly Rcv016ArtifactProvenanceCycleDiagnosticV1[] {
  const edges = [...inputEdges].sort((left, right) =>
    ascii(left.subjectArtifactVersionId, right.subjectArtifactVersionId) ||
    ascii(left.objectArtifactVersionId, right.objectArtifactVersionId) ||
    ascii(left.relationship, right.relationship) ||
    ascii(left.statementId, right.statementId),
  );
  const bySubject = new Map<string, Rcv016CycleEdgeV1[]>();
  const nodes = new Set<Rcv016ArtifactVersionIdV1>();
  for (const edge of edges) {
    nodes.add(edge.subjectArtifactVersionId);
    nodes.add(edge.objectArtifactVersionId);
    const outgoing = bySubject.get(edge.subjectArtifactVersionId) ?? [];
    outgoing.push(edge);
    bySubject.set(edge.subjectArtifactVersionId, outgoing);
  }

  const found = new Map<string, Rcv016ArtifactProvenanceCycleDiagnosticV1>();
  const visit = (
    current: Rcv016ArtifactVersionIdV1,
    pathNodes: Rcv016ArtifactVersionIdV1[],
    pathStatements: Rcv016ArtifactProvenanceStatementIdV1[],
  ): void => {
    const outgoing = bySubject.get(current) ?? [];
    for (const edge of outgoing) {
      const cycleStart = pathNodes.indexOf(edge.objectArtifactVersionId);
      if (cycleStart >= 0) {
        const normalized = normalizeCycle(
          [...pathNodes.slice(cycleStart), edge.objectArtifactVersionId],
          [...pathStatements.slice(cycleStart), edge.statementId],
        );
        found.set(normalized.identity, normalized.diagnostic);
        continue;
      }
      visit(
        edge.objectArtifactVersionId,
        [...pathNodes, edge.objectArtifactVersionId],
        [...pathStatements, edge.statementId],
      );
    }
  };

  for (const node of [...nodes].sort(ascii)) {
    visit(node, [node], []);
  }
  const diagnostics = [...found.entries()]
    .sort(([left], [right]) => ascii(left, right))
    .map(([, diagnostic]) => diagnostic);
  return freezeRcv016(diagnostics) as readonly Rcv016ArtifactProvenanceCycleDiagnosticV1[];
}
