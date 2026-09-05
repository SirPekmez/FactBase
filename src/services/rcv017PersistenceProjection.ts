import {
  Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1,
  Rcv017DependencyAnalysisPolicyCanonicalV1,
  Rcv017FindingV1,
  Rcv017Sha256HexV1,
} from "../contracts/rcv017ClaimEvidenceDependencyContractV1";
import { freezeRcv016 } from "./rcv016Validation";

export interface Rcv017PersistenceProjectionV1 {
  readonly policyHeader: Readonly<Record<string, unknown>>;
  readonly policyRelationships: readonly Readonly<Record<string, unknown>>[];
  readonly analysisHeader: Readonly<Record<string, unknown>>;
  readonly evidenceRelations: readonly Readonly<Record<string, unknown>>[];
  readonly bindings: readonly Readonly<Record<string, unknown>>[];
  readonly sharedArtifactFindings: readonly Readonly<Record<string, unknown>>[];
  readonly sharedArtifactMembers: readonly Readonly<Record<string, unknown>>[];
  readonly commonUpstreamFindings: readonly Readonly<Record<string, unknown>>[];
  readonly commonUpstreamMembers: readonly Readonly<Record<string, unknown>>[];
  readonly commonUpstreamWitnessSteps: readonly Readonly<Record<string, unknown>>[];
  readonly noCommonUpstreamFindings: readonly Readonly<Record<string, unknown>>[];
  readonly knowledgeIncompleteFindings: readonly Readonly<Record<string, unknown>>[];
  readonly knowledgeAffectedArtifacts: readonly Readonly<Record<string, unknown>>[];
  readonly knowledgeStateEvidence: readonly Readonly<Record<string, unknown>>[];
  readonly derivedUnrecordedEvidence: readonly Readonly<Record<string, unknown>>[];
}

function branchFields(branch: {
  readonly claimVersionEvidenceRelationId: string;
  readonly evidenceArtifactBindingStatementId: string;
}): Readonly<Record<string, unknown>> {
  return {
    claimVersionEvidenceRelationId: branch.claimVersionEvidenceRelationId,
    evidenceArtifactBindingStatementId:
      branch.evidenceArtifactBindingStatementId,
  };
}

export function projectRcv017Persistence(
  analysis: Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1,
  analysisCanonical: string,
  analysisHash: Rcv017Sha256HexV1,
  policy: Rcv017DependencyAnalysisPolicyCanonicalV1,
  policyCanonical: string,
  policyHash: Rcv017Sha256HexV1,
): Rcv017PersistenceProjectionV1 {
  const sharedArtifactFindings: Record<string, unknown>[] = [];
  const sharedArtifactMembers: Record<string, unknown>[] = [];
  const commonUpstreamFindings: Record<string, unknown>[] = [];
  const commonUpstreamMembers: Record<string, unknown>[] = [];
  const commonUpstreamWitnessSteps: Record<string, unknown>[] = [];
  const noCommonUpstreamFindings: Record<string, unknown>[] = [];
  const knowledgeIncompleteFindings: Record<string, unknown>[] = [];
  const knowledgeAffectedArtifacts: Record<string, unknown>[] = [];
  const knowledgeStateEvidence: Record<string, unknown>[] = [];
  const derivedUnrecordedEvidence: Record<string, unknown>[] = [];

  for (const finding of analysis.findings as readonly Rcv017FindingV1[]) {
    if (finding.type === "RECORDED_SHARED_ARTIFACT_VERSION") {
      sharedArtifactFindings.push({
        direction: finding.direction,
        artifactVersionId: finding.artifactVersionId,
      });
      for (const member of finding.members) {
        sharedArtifactMembers.push({
          direction: finding.direction,
          artifactVersionId: finding.artifactVersionId,
          ...branchFields(member),
        });
      }
    } else if (finding.type === "RECORDED_COMMON_UPSTREAM") {
      commonUpstreamFindings.push({
        direction: finding.direction,
        upstreamArtifactVersionId: finding.upstreamArtifactVersionId,
      });
      for (const member of finding.members) {
        commonUpstreamMembers.push({
          direction: finding.direction,
          upstreamArtifactVersionId: finding.upstreamArtifactVersionId,
          ...branchFields(member.branchKey),
        });
        for (
          let ordinal = 0;
          ordinal < member.witness.artifactVersionIds.length;
          ordinal += 1
        ) {
          commonUpstreamWitnessSteps.push({
            provenanceSnapshotId: analysis.provenanceSnapshotId,
            direction: finding.direction,
            upstreamArtifactVersionId: finding.upstreamArtifactVersionId,
            ...branchFields(member.branchKey),
            ordinal,
            artifactVersionId: member.witness.artifactVersionIds[ordinal],
            artifactProvenanceStatementId:
              member.witness.artifactProvenanceStatementIds[ordinal] ?? null,
          });
        }
      }
    } else if (
      finding.type === "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE"
    ) {
      noCommonUpstreamFindings.push({
        direction: finding.direction,
        lowerClaimVersionEvidenceRelationId:
          finding.lowerBranchKey.claimVersionEvidenceRelationId,
        lowerEvidenceArtifactBindingStatementId:
          finding.lowerBranchKey.evidenceArtifactBindingStatementId,
        upperClaimVersionEvidenceRelationId:
          finding.upperBranchKey.claimVersionEvidenceRelationId,
        upperEvidenceArtifactBindingStatementId:
          finding.upperBranchKey.evidenceArtifactBindingStatementId,
      });
    } else {
      knowledgeIncompleteFindings.push(branchFields(finding.branchKey));
      for (const artifactVersionId of finding.affectedArtifactVersionIds) {
        knowledgeAffectedArtifacts.push({
          ...branchFields(finding.branchKey),
          artifactVersionId,
        });
      }
      for (const knowledgeStateStatementId of finding.knowledgeStateStatementIds) {
        knowledgeStateEvidence.push({
          provenanceSnapshotId: analysis.provenanceSnapshotId,
          ...branchFields(finding.branchKey),
          knowledgeStateStatementId,
        });
      }
      for (
        const artifactVersionId of finding.derivedUnrecordedArtifactVersionIds
      ) {
        derivedUnrecordedEvidence.push({
          ...branchFields(finding.branchKey),
          artifactVersionId,
        });
      }
    }
  }

  const policyHeader = {
    ...policy,
    enabledDependencyRelationships: undefined,
    definitionCanonical: policyCanonical,
    definitionHash: policyHash,
  };
  delete (policyHeader as Record<string, unknown>).enabledDependencyRelationships;
  const analysisHeader = {
    analysisSchemaId: analysis.schemaId,
    analysisSchemaVersion: analysis.schemaVersion,
    claimVersionId: analysis.claimVersionId,
    provenanceSnapshotId: analysis.provenanceSnapshotId,
    provenanceSnapshotHash: analysis.provenanceSnapshotHash,
    dependencyAnalysisPolicyId: analysis.dependencyAnalysisPolicyId,
    dependencyAnalysisPolicyVersion: analysis.dependencyAnalysisPolicyVersion,
    dependencyAnalysisPolicyHash: analysis.dependencyAnalysisPolicyHash,
    algorithmId: analysis.algorithmId,
    algorithmVersion: analysis.algorithmVersion,
    algorithmArtifactHash: analysis.algorithmArtifactHash,
    canonicalizationId: analysis.canonicalizationId,
    canonicalizationVersion: analysis.canonicalizationVersion,
    hashAlgorithm: analysis.hashAlgorithm,
    analysisCanonical,
    analysisHash,
  };

  return freezeRcv016({
    policyHeader,
    policyRelationships: policy.enabledDependencyRelationships.map(
      (relationship) => ({
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        relationship,
      }),
    ),
    analysisHeader,
    evidenceRelations: analysis.evidenceRelations.map((value) => ({ ...value })),
    bindings: analysis.selectedBindings.map((value) => ({
      provenanceSnapshotId: analysis.provenanceSnapshotId,
      ...value,
    })),
    sharedArtifactFindings,
    sharedArtifactMembers,
    commonUpstreamFindings,
    commonUpstreamMembers,
    commonUpstreamWitnessSteps,
    noCommonUpstreamFindings,
    knowledgeIncompleteFindings,
    knowledgeAffectedArtifacts,
    knowledgeStateEvidence,
    derivedUnrecordedEvidence,
  }) as Rcv017PersistenceProjectionV1;
}
