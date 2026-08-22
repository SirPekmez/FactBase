import type {
  AssessmentGraphAnomaly,
  AssessmentGraphAnomalyCode,
} from "./claimVersionReadService";
import {
  appendArrayElement as exportedAppendArrayElement,
  copyArrayRange as exportedCopyArrayRange,
  findTextIndex as exportedFindTextIndex,
  getDerivationSafeRuntimeArtifactHash as exportedGetDerivationSafeRuntimeArtifactHash,
  loadedFunctionSource as exportedLoadedFunctionSource,
  safeJsonStringifyString as exportedSafeJsonStringifyString,
  safeSha256 as exportedSafeSha256,
  sortArrayCopy as exportedSortArrayCopy,
} from "./derivationSafeRuntime";

function initializeAssessmentGraphBindings() {
  return Object.freeze({
    appendArrayElement: exportedAppendArrayElement,
    copyArrayRange: exportedCopyArrayRange,
    findTextIndex: exportedFindTextIndex,
    getDerivationSafeRuntimeArtifactHash:
      exportedGetDerivationSafeRuntimeArtifactHash,
    loadedFunctionSource: exportedLoadedFunctionSource,
    safeJsonStringifyString: exportedSafeJsonStringifyString,
    safeSha256: exportedSafeSha256,
    sortArrayCopy: exportedSortArrayCopy,
  });
}

const GRAPH_BINDINGS = initializeAssessmentGraphBindings();
const appendArrayElement = GRAPH_BINDINGS.appendArrayElement;
const copyArrayRange = GRAPH_BINDINGS.copyArrayRange;
const findTextIndex = GRAPH_BINDINGS.findTextIndex;
const getDerivationSafeRuntimeArtifactHash =
  GRAPH_BINDINGS.getDerivationSafeRuntimeArtifactHash;
const loadedFunctionSource = GRAPH_BINDINGS.loadedFunctionSource;
const safeJsonStringifyString = GRAPH_BINDINGS.safeJsonStringifyString;
const safeSha256 = GRAPH_BINDINGS.safeSha256;
const sortArrayCopy = GRAPH_BINDINGS.sortArrayCopy;

const GRAPH_CODES: ReadonlyArray<AssessmentGraphAnomalyCode> = [
  "missing_parent",
  "cross_relation_parent",
  "incomplete_response_pair",
  "invalid_response_relation",
  "self_response",
  "cycle",
];

interface SnapshotGraphAssessment {
  id: string;
  responds_to_assessment_id: string | null;
  response_relation: string | null;
  parent_assessment_id: string | null;
  parent_relation_id: string | null;
}

export interface DerivationAssessmentGraph {
  unparentedAssessmentIds: string[];
  integrity: {
    status: "valid" | "anomalies_detected";
    anomalies: AssessmentGraphAnomaly[];
  };
}

function graphCodeIndex(code: AssessmentGraphAnomalyCode): number {
  for (let index = 0; index < GRAPH_CODES.length; index += 1) {
    if (GRAPH_CODES[index] === code) return index;
  }
  return -1;
}

function responseRelationIsValid(value: string): boolean {
  return value === "supports" || value === "disputes" || value === "contextualizes";
}

function encodeNullable(value: string | null): string {
  return value === null ? "null" : safeJsonStringifyString(value);
}

function encodeStringArray(values: ReadonlyArray<string>): string {
  let result = "[";
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) result += ",";
    result += safeJsonStringifyString(values[index]);
  }
  return `${result}]`;
}

function anomalyKey(anomaly: AssessmentGraphAnomaly): string {
  return `[${encodeStringArray(anomaly.assessmentIds)},${encodeNullable(
    anomaly.relatedAssessmentId,
  )},${encodeNullable(anomaly.relatedClaimVersionEvidenceId)},${encodeNullable(
    anomaly.rawResponseRelation,
  )}]`;
}

function compareAnomalies(
  left: AssessmentGraphAnomaly,
  right: AssessmentGraphAnomaly,
): number {
  const codeDifference = graphCodeIndex(left.code) - graphCodeIndex(right.code);
  if (codeDifference !== 0) return codeDifference;
  const leftKey = anomalyKey(left);
  const rightKey = anomalyKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function findAssessment(
  assessments: ReadonlyArray<SnapshotGraphAssessment>,
  id: string,
): SnapshotGraphAssessment | null {
  for (let index = 0; index < assessments.length; index += 1) {
    if (assessments[index].id === id) return assessments[index];
  }
  return null;
}

export function buildDerivationAssessmentGraph(
  assessments: ReadonlyArray<SnapshotGraphAssessment>,
  relationId: string,
): DerivationAssessmentGraph {
  const anomalies: AssessmentGraphAnomaly[] = [];
  const unparentedAssessmentIds: string[] = [];

  for (let index = 0; index < assessments.length; index += 1) {
    const assessment = assessments[index];
    const parentId = assessment.responds_to_assessment_id;
    const responseRelation = assessment.response_relation;
    const hasParent = parentId !== null;
    const hasRelation = responseRelation !== null;

    if (!hasParent) appendArrayElement(unparentedAssessmentIds, assessment.id);
    if (hasParent !== hasRelation) {
      appendArrayElement(anomalies, {
        code: "incomplete_response_pair",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: assessment.parent_relation_id,
        rawResponseRelation: responseRelation,
      });
    }
    if (responseRelation !== null && !responseRelationIsValid(responseRelation)) {
      appendArrayElement(anomalies, {
        code: "invalid_response_relation",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: assessment.parent_relation_id,
        rawResponseRelation: responseRelation,
      });
    }
    if (parentId === null) continue;
    if (parentId === assessment.id) {
      appendArrayElement(anomalies, {
        code: "self_response",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: assessment.parent_relation_id,
        rawResponseRelation: responseRelation,
      });
      continue;
    }
    if (assessment.parent_assessment_id === null) {
      appendArrayElement(anomalies, {
        code: "missing_parent",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: null,
        rawResponseRelation: responseRelation,
      });
      continue;
    }
    if (assessment.parent_relation_id !== relationId) {
      appendArrayElement(anomalies, {
        code: "cross_relation_parent",
        assessmentIds: [assessment.id],
        relatedAssessmentId: parentId,
        relatedClaimVersionEvidenceId: assessment.parent_relation_id,
        rawResponseRelation: responseRelation,
      });
    }
  }

  const processed: string[] = [];
  for (let index = 0; index < assessments.length; index += 1) {
    const assessment = assessments[index];
    if (findTextIndex(processed, assessment.id) !== -1) continue;
    const path: string[] = [];
    let currentId: string | null = assessment.id;

    while (currentId !== null && findTextIndex(processed, currentId) === -1) {
      const cycleStart = findTextIndex(path, currentId);
      if (cycleStart !== -1) {
        const cycleIds = sortArrayCopy(copyArrayRange(path, cycleStart), (left, right) =>
          left < right ? -1 : left > right ? 1 : 0,
        );
        if (cycleIds.length > 1) {
          appendArrayElement(anomalies, {
            code: "cycle",
            assessmentIds: cycleIds,
            relatedAssessmentId: null,
            relatedClaimVersionEvidenceId: relationId,
            rawResponseRelation: null,
          });
        }
        break;
      }
      const current = findAssessment(assessments, currentId);
      if (current === null) break;
      appendArrayElement(path, currentId);
      const parentId = current.responds_to_assessment_id;
      if (
        parentId === null ||
        parentId === current.id ||
        current.parent_assessment_id === null ||
        current.parent_relation_id !== relationId
      ) {
        break;
      }
      currentId = parentId;
    }
    for (let pathIndex = 0; pathIndex < path.length; pathIndex += 1) {
      if (findTextIndex(processed, path[pathIndex]) === -1) {
        appendArrayElement(processed, path[pathIndex]);
      }
    }
  }

  const sortedAnomalies = sortArrayCopy(anomalies, compareAnomalies);
  return {
    unparentedAssessmentIds,
    integrity: {
      status: sortedAnomalies.length === 0 ? "valid" : "anomalies_detected",
      anomalies: sortedAnomalies,
    },
  };
}

const DERIVATION_GRAPH_ARTIFACT_HASH = safeSha256(
  [
    "factbase-derivation-assessment-graph-v1",
    "private-module-captures-v2",
    getDerivationSafeRuntimeArtifactHash(),
    ...GRAPH_CODES,
    loadedFunctionSource(initializeAssessmentGraphBindings),
    loadedFunctionSource(appendArrayElement),
    loadedFunctionSource(copyArrayRange),
    loadedFunctionSource(findTextIndex),
    loadedFunctionSource(safeJsonStringifyString),
    loadedFunctionSource(safeSha256),
    loadedFunctionSource(sortArrayCopy),
    loadedFunctionSource(graphCodeIndex),
    loadedFunctionSource(responseRelationIsValid),
    loadedFunctionSource(encodeNullable),
    loadedFunctionSource(encodeStringArray),
    loadedFunctionSource(anomalyKey),
    loadedFunctionSource(compareAnomalies),
    loadedFunctionSource(findAssessment),
    loadedFunctionSource(buildDerivationAssessmentGraph),
  ].join("\n"),
);

export function getDerivationAssessmentGraphArtifactHash(): string {
  return DERIVATION_GRAPH_ARTIFACT_HASH;
}
