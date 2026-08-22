import {
  canonicalizePostgreSqlNumeric as exportedCanonicalizePostgreSqlNumeric,
  getCanonicalDecimalArtifactHash as exportedGetCanonicalDecimalArtifactHash,
} from "./canonicalDecimal";
import {
  getCanonicalJsonArtifactHash as exportedGetCanonicalJsonArtifactHash,
  validateCanonicalTimestamp as exportedValidateCanonicalTimestamp,
} from "./canonicalJson";
import {
  appendArrayElement as exportedAppendArrayElement,
  findTextIndex as exportedFindTextIndex,
  getDerivationSafeRuntimeArtifactHash as exportedGetDerivationSafeRuntimeArtifactHash,
  loadedFunctionSource as exportedLoadedFunctionSource,
  safeArrayIsArray as exportedSafeArrayIsArray,
  safeGetPrototypeOf as exportedSafeGetPrototypeOf,
  getLoadedObjectPrototype as exportedGetLoadedObjectPrototype,
  safeJsonStringifyString as exportedSafeJsonStringifyString,
  safeNumberIsSafeInteger as exportedSafeNumberIsSafeInteger,
  safeOwnKeys as exportedSafeOwnKeys,
  safeRegExpExec as exportedSafeRegExpExec,
  safeSha256 as exportedSafeSha256,
} from "./derivationSafeRuntime";
import {
  DERIVATION_INPUT_SCHEMA_ID,
  DERIVATION_INPUT_SCHEMA_VERSION,
} from "../types/derivation";

function initializeInputSchemaV1Bindings() {
  return Object.freeze({
    canonicalizePostgreSqlNumeric: exportedCanonicalizePostgreSqlNumeric,
    appendArrayElement: exportedAppendArrayElement,
    getCanonicalDecimalArtifactHash: exportedGetCanonicalDecimalArtifactHash,
    getCanonicalJsonArtifactHash: exportedGetCanonicalJsonArtifactHash,
    validateCanonicalTimestamp: exportedValidateCanonicalTimestamp,
    findTextIndex: exportedFindTextIndex,
    getDerivationSafeRuntimeArtifactHash:
      exportedGetDerivationSafeRuntimeArtifactHash,
    loadedFunctionSource: exportedLoadedFunctionSource,
    safeArrayIsArray: exportedSafeArrayIsArray,
    safeGetPrototypeOf: exportedSafeGetPrototypeOf,
    getLoadedObjectPrototype: exportedGetLoadedObjectPrototype,
    safeJsonStringifyString: exportedSafeJsonStringifyString,
    safeNumberIsSafeInteger: exportedSafeNumberIsSafeInteger,
    safeOwnKeys: exportedSafeOwnKeys,
    safeRegExpExec: exportedSafeRegExpExec,
    safeSha256: exportedSafeSha256,
  });
}

const INPUT_SCHEMA_BINDINGS = initializeInputSchemaV1Bindings();
const canonicalizePostgreSqlNumeric =
  INPUT_SCHEMA_BINDINGS.canonicalizePostgreSqlNumeric;
const appendArrayElement = INPUT_SCHEMA_BINDINGS.appendArrayElement;
const getCanonicalDecimalArtifactHash =
  INPUT_SCHEMA_BINDINGS.getCanonicalDecimalArtifactHash;
const getCanonicalJsonArtifactHash =
  INPUT_SCHEMA_BINDINGS.getCanonicalJsonArtifactHash;
const validateCanonicalTimestamp = INPUT_SCHEMA_BINDINGS.validateCanonicalTimestamp;
const findTextIndex = INPUT_SCHEMA_BINDINGS.findTextIndex;
const getDerivationSafeRuntimeArtifactHash =
  INPUT_SCHEMA_BINDINGS.getDerivationSafeRuntimeArtifactHash;
const loadedFunctionSource = INPUT_SCHEMA_BINDINGS.loadedFunctionSource;
const safeArrayIsArray = INPUT_SCHEMA_BINDINGS.safeArrayIsArray;
const safeGetPrototypeOf = INPUT_SCHEMA_BINDINGS.safeGetPrototypeOf;
const getLoadedObjectPrototype = INPUT_SCHEMA_BINDINGS.getLoadedObjectPrototype;
const safeJsonStringifyString = INPUT_SCHEMA_BINDINGS.safeJsonStringifyString;
const safeNumberIsSafeInteger = INPUT_SCHEMA_BINDINGS.safeNumberIsSafeInteger;
const safeOwnKeys = INPUT_SCHEMA_BINDINGS.safeOwnKeys;
const safeRegExpExec = INPUT_SCHEMA_BINDINGS.safeRegExpExec;
const safeSha256 = INPUT_SCHEMA_BINDINGS.safeSha256;
const INPUT_SCHEMA_ID = DERIVATION_INPUT_SCHEMA_ID;
const INPUT_SCHEMA_VERSION = DERIVATION_INPUT_SCHEMA_VERSION;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVIDENCE_RELATIONS = ["supports", "contradicts", "contextualizes"] as const;
const GRAPH_CODES = [
  "missing_parent",
  "cross_relation_parent",
  "incomplete_response_pair",
  "invalid_response_relation",
  "self_response",
  "cycle",
] as const;

type SchemaObject = Record<string, unknown>;

export class DerivationInputSchemaV1Error extends Error {
  constructor(public readonly path: string, message: string) {
    super(`Invalid ${INPUT_SCHEMA_ID}/${INPUT_SCHEMA_VERSION} at ${path}: ${message}`);
    this.name = "DerivationInputSchemaV1Error";
  }
}

function fail(path: string, message: string): never {
  throw new DerivationInputSchemaV1Error(path, message);
}

function objectWithKeys(
  value: unknown,
  keys: ReadonlyArray<string>,
  path: string,
): SchemaObject {
  if (
    value === null ||
    typeof value !== "object" ||
    safeArrayIsArray(value) ||
    safeGetPrototypeOf(value) !== getLoadedObjectPrototype()
  ) {
    return fail(path, "expected a plain object");
  }
  const actualKeys = safeOwnKeys(value);
  if (actualKeys.length !== keys.length) {
    return fail(path, "unexpected or missing field");
  }
  for (let index = 0; index < actualKeys.length; index += 1) {
    const key = actualKeys[index];
    if (typeof key !== "string" || findTextIndex(keys, key) === -1) {
      return fail(path, "unexpected or missing field");
    }
  }
  return value as SchemaObject;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!safeArrayIsArray(value)) return fail(path, "expected an array");
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "expected a string");
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : stringValue(value, path);
}

function uuidValue(value: unknown, path: string): string {
  const text = stringValue(value, path);
  if (safeRegExpExec(UUID_PATTERN, text) === null) {
    return fail(path, "expected a lowercase canonical UUID");
  }
  return text;
}

function nullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : uuidValue(value, path);
}

function timestampValue(value: unknown, path: string): string {
  try {
    return validateCanonicalTimestamp(value);
  } catch {
    return fail(path, "expected YYYY-MM-DDTHH:mm:ss.ffffffZ");
  }
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : timestampValue(value, path);
}

function decimalValue(value: unknown, path: string): string | null {
  if (value === null) return null;
  const text = stringValue(value, path);
  try {
    if (canonicalizePostgreSqlNumeric(text) !== text) {
      return fail(path, "expected a canonical decimal string");
    }
  } catch {
    return fail(path, "expected a canonical decimal string");
  }
  return text;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSorted(values: ReadonlyArray<string>, path: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareText(values[index - 1], values[index]) > 0) {
      fail(path, "expected deterministic ascending order");
    }
  }
}

function graphCodeIndex(value: string): number {
  return findTextIndex(GRAPH_CODES, value);
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

function anomalyKey(value: SchemaObject): string {
  return `[${encodeStringArray(value.assessmentIds as string[])},${encodeNullable(
    value.relatedAssessmentId as string | null,
  )},${encodeNullable(value.relatedClaimVersionEvidenceId as string | null)},${encodeNullable(
    value.rawResponseRelation as string | null,
  )}]`;
}

function validateNullablePair(
  value: unknown,
  keys: ReadonlyArray<string>,
  path: string,
): void {
  if (value === null) return;
  const pair = objectWithKeys(value, keys, path);
  let hasPersistedValue = false;
  for (let index = 0; index < keys.length; index += 1) {
    const pairValue = nullableString(pair[keys[index]], `${path}.${keys[index]}`);
    if (pairValue !== null) hasPersistedValue = true;
  }
  if (!hasPersistedValue) fail(path, "absent optional context must be JSON null");
}

function validateAssessment(value: unknown, path: string): SchemaObject {
  const assessment = objectWithKeys(value, [
    "id", "claimVersionEvidenceId", "sourceQuality", "relevance", "directness",
    "recency", "independence", "rubric", "recencyContext",
    "independenceComparisonRelationIds", "method", "rationale", "initiator",
    "responseTo", "legacyAssessedBy", "assessedAt",
  ], path);
  uuidValue(assessment.id, `${path}.id`);
  uuidValue(assessment.claimVersionEvidenceId, `${path}.claimVersionEvidenceId`);
  decimalValue(assessment.sourceQuality, `${path}.sourceQuality`);
  decimalValue(assessment.relevance, `${path}.relevance`);
  decimalValue(assessment.directness, `${path}.directness`);
  decimalValue(assessment.recency, `${path}.recency`);
  decimalValue(assessment.independence, `${path}.independence`);
  validateNullablePair(assessment.rubric, ["id", "version"], `${path}.rubric`);
  if (assessment.recencyContext !== null) {
    const context = objectWithKeys(
      assessment.recencyContext,
      ["referenceType", "referenceAt"],
      `${path}.recencyContext`,
    );
    const referenceType = nullableString(
      context.referenceType,
      `${path}.recencyContext.referenceType`,
    );
    const referenceAt = nullableTimestamp(
      context.referenceAt,
      `${path}.recencyContext.referenceAt`,
    );
    if (referenceType === null && referenceAt === null) {
      fail(
        `${path}.recencyContext`,
        "absent optional context must be JSON null",
      );
    }
  }
  const comparisons = arrayValue(
    assessment.independenceComparisonRelationIds,
    `${path}.independenceComparisonRelationIds`,
  );
  const comparisonIds: string[] = [];
  for (let index = 0; index < comparisons.length; index += 1) {
    appendArrayElement(comparisonIds, uuidValue(
      comparisons[index],
      `${path}.independenceComparisonRelationIds[${index}]`,
    ));
  }
  assertSorted(comparisonIds, `${path}.independenceComparisonRelationIds`);
  const method = objectWithKeys(
    assessment.method,
    ["type", "ruleSet", "model", "imported"],
    `${path}.method`,
  );
  nullableString(method.type, `${path}.method.type`);
  validateNullablePair(method.ruleSet, ["id", "version"], `${path}.method.ruleSet`);
  validateNullablePair(
    method.model,
    ["id", "version", "processType", "processVersion"],
    `${path}.method.model`,
  );
  validateNullablePair(
    method.imported,
    ["referenceType", "reference"],
    `${path}.method.imported`,
  );
  nullableString(assessment.rationale, `${path}.rationale`);
  if (assessment.initiator !== null) {
    const initiator = objectWithKeys(
      assessment.initiator,
      ["type", "id"],
      `${path}.initiator`,
    );
    stringValue(initiator.type, `${path}.initiator.type`);
    nullableString(initiator.id, `${path}.initiator.id`);
  }
  if (assessment.responseTo !== null) {
    const response = objectWithKeys(
      assessment.responseTo,
      ["assessmentId", "relation"],
      `${path}.responseTo`,
    );
    const assessmentId = nullableUuid(
      response.assessmentId,
      `${path}.responseTo.assessmentId`,
    );
    const relation = nullableString(
      response.relation,
      `${path}.responseTo.relation`,
    );
    if (assessmentId === null && relation === null) {
      fail(`${path}.responseTo`, "absent optional context must be JSON null");
    }
  }
  nullableString(assessment.legacyAssessedBy, `${path}.legacyAssessedBy`);
  timestampValue(assessment.assessedAt, `${path}.assessedAt`);
  return assessment;
}

function validateGraph(
  value: unknown,
  assessmentIds: ReadonlyArray<string>,
  path: string,
): void {
  const graph = objectWithKeys(value, ["unparentedAssessmentIds", "integrity"], path);
  const unparented = arrayValue(graph.unparentedAssessmentIds, `${path}.unparentedAssessmentIds`);
  let previousAssessmentIndex = -1;
  for (let index = 0; index < unparented.length; index += 1) {
    const id = uuidValue(unparented[index], `${path}.unparentedAssessmentIds[${index}]`);
    const assessmentIndex = findTextIndex(assessmentIds, id);
    if (assessmentIndex === -1 || assessmentIndex <= previousAssessmentIndex) {
      fail(`${path}.unparentedAssessmentIds`, "expected assessment order without duplicates");
    }
    previousAssessmentIndex = assessmentIndex;
  }
  const integrity = objectWithKeys(graph.integrity, ["status", "anomalies"], `${path}.integrity`);
  const status = stringValue(integrity.status, `${path}.integrity.status`);
  if (status !== "valid" && status !== "anomalies_detected") {
    fail(`${path}.integrity.status`, "unknown graph integrity status");
  }
  const anomalies = arrayValue(integrity.anomalies, `${path}.integrity.anomalies`);
  if ((anomalies.length === 0) !== (status === "valid")) {
    fail(`${path}.integrity`, "status does not match anomaly presence");
  }
  let previousCodeIndex = -1;
  let previousKey = "";
  for (let index = 0; index < anomalies.length; index += 1) {
    const anomalyPath = `${path}.integrity.anomalies[${index}]`;
    const anomaly = objectWithKeys(anomalies[index], [
      "code", "assessmentIds", "relatedAssessmentId",
      "relatedClaimVersionEvidenceId", "rawResponseRelation",
    ], anomalyPath);
    const code = stringValue(anomaly.code, `${anomalyPath}.code`);
    const codeIndex = graphCodeIndex(code);
    if (codeIndex === -1) fail(`${anomalyPath}.code`, "unknown V1 graph code");
    const ids = arrayValue(anomaly.assessmentIds, `${anomalyPath}.assessmentIds`);
    const validatedIds: string[] = [];
    for (let idIndex = 0; idIndex < ids.length; idIndex += 1) {
      appendArrayElement(
        validatedIds,
        uuidValue(ids[idIndex], `${anomalyPath}.assessmentIds[${idIndex}]`),
      );
    }
    if (code === "cycle") assertSorted(validatedIds, `${anomalyPath}.assessmentIds`);
    nullableUuid(anomaly.relatedAssessmentId, `${anomalyPath}.relatedAssessmentId`);
    nullableUuid(
      anomaly.relatedClaimVersionEvidenceId,
      `${anomalyPath}.relatedClaimVersionEvidenceId`,
    );
    nullableString(anomaly.rawResponseRelation, `${anomalyPath}.rawResponseRelation`);
    const key = anomalyKey(anomaly);
    if (
      codeIndex < previousCodeIndex ||
      (codeIndex === previousCodeIndex && compareText(key, previousKey) < 0)
    ) {
      fail(`${path}.integrity.anomalies`, "expected deterministic anomaly order");
    }
    previousCodeIndex = codeIndex;
    previousKey = key;
  }
}

export function assertDerivationInputSchemaV1(value: unknown): void {
  const root = objectWithKeys(value, ["schema", "claimVersion", "evidenceRelations"], "$input");
  const schema = objectWithKeys(root.schema, ["id", "version"], "$input.schema");
  if (schema.id !== INPUT_SCHEMA_ID || schema.version !== INPUT_SCHEMA_VERSION) {
    fail("$input.schema", "unsupported schema identity");
  }
  const claim = objectWithKeys(root.claimVersion, [
    "id", "claimId", "versionNumber", "title", "normalizedStatement", "language",
    "claimType", "status", "publicationStatus", "changeReason", "basedOnVersionId",
    "actor", "source", "requestId", "createdAt",
  ], "$input.claimVersion");
  uuidValue(claim.id, "$input.claimVersion.id");
  uuidValue(claim.claimId, "$input.claimVersion.claimId");
  if (
    typeof claim.versionNumber !== "number" ||
    !safeNumberIsSafeInteger(claim.versionNumber) ||
    claim.versionNumber <= 0
  ) {
    fail("$input.claimVersion.versionNumber", "expected a positive safe integer number");
  }
  stringValue(claim.title, "$input.claimVersion.title");
  stringValue(claim.normalizedStatement, "$input.claimVersion.normalizedStatement");
  stringValue(claim.language, "$input.claimVersion.language");
  stringValue(claim.claimType, "$input.claimVersion.claimType");
  stringValue(claim.status, "$input.claimVersion.status");
  stringValue(claim.publicationStatus, "$input.claimVersion.publicationStatus");
  stringValue(claim.changeReason, "$input.claimVersion.changeReason");
  nullableUuid(claim.basedOnVersionId, "$input.claimVersion.basedOnVersionId");
  const actor = objectWithKeys(claim.actor, ["type", "id"], "$input.claimVersion.actor");
  nullableString(actor.type, "$input.claimVersion.actor.type");
  nullableString(actor.id, "$input.claimVersion.actor.id");
  const source = objectWithKeys(
    claim.source,
    ["type", "reference"],
    "$input.claimVersion.source",
  );
  nullableString(source.type, "$input.claimVersion.source.type");
  nullableString(source.reference, "$input.claimVersion.source.reference");
  nullableUuid(claim.requestId, "$input.claimVersion.requestId");
  timestampValue(claim.createdAt, "$input.claimVersion.createdAt");

  const relations = arrayValue(root.evidenceRelations, "$input.evidenceRelations");
  let previousRelationKey = "";
  for (let index = 0; index < relations.length; index += 1) {
    const path = `$input.evidenceRelations[${index}]`;
    const relation = objectWithKeys(relations[index], [
      "relationId", "evidenceId", "relation", "relationCreatedAt", "evidence",
      "assessments", "assessmentGraph",
    ], path);
    const relationId = uuidValue(relation.relationId, `${path}.relationId`);
    uuidValue(relation.evidenceId, `${path}.evidenceId`);
    const relationType = stringValue(relation.relation, `${path}.relation`);
    if (findTextIndex(EVIDENCE_RELATIONS, relationType) === -1) {
      fail(`${path}.relation`, "unknown Evidence relation");
    }
    const relationCreatedAt = timestampValue(relation.relationCreatedAt, `${path}.relationCreatedAt`);
    const relationKey = `${relationCreatedAt}\u0000${relationId}`;
    if (index > 0 && compareText(relationKey, previousRelationKey) < 0) {
      fail("$input.evidenceRelations", "expected createdAt/id order");
    }
    previousRelationKey = relationKey;
    const evidence = objectWithKeys(relation.evidence, [
      "sourceUrl", "sourceTitle", "sourceType", "locator", "quotedText",
      "snapshotHash", "retrievedAt", "createdAt",
    ], `${path}.evidence`);
    nullableString(evidence.sourceUrl, `${path}.evidence.sourceUrl`);
    nullableString(evidence.sourceTitle, `${path}.evidence.sourceTitle`);
    nullableString(evidence.sourceType, `${path}.evidence.sourceType`);
    nullableString(evidence.locator, `${path}.evidence.locator`);
    nullableString(evidence.quotedText, `${path}.evidence.quotedText`);
    nullableString(evidence.snapshotHash, `${path}.evidence.snapshotHash`);
    timestampValue(evidence.retrievedAt, `${path}.evidence.retrievedAt`);
    timestampValue(evidence.createdAt, `${path}.evidence.createdAt`);
    const assessments = arrayValue(relation.assessments, `${path}.assessments`);
    const assessmentIds: string[] = [];
    let previousAssessmentKey = "";
    for (let assessmentIndex = 0; assessmentIndex < assessments.length; assessmentIndex += 1) {
      const assessmentPath = `${path}.assessments[${assessmentIndex}]`;
      const assessment = validateAssessment(assessments[assessmentIndex], assessmentPath);
      const assessmentId = assessment.id as string;
      if (assessment.claimVersionEvidenceId !== relationId) {
        fail(`${assessmentPath}.claimVersionEvidenceId`, "does not match containing relation");
      }
      const assessmentKey = `${assessment.assessedAt as string}\u0000${assessmentId}`;
      if (assessmentIndex > 0 && compareText(assessmentKey, previousAssessmentKey) < 0) {
        fail(`${path}.assessments`, "expected assessedAt/id order");
      }
      previousAssessmentKey = assessmentKey;
      appendArrayElement(assessmentIds, assessmentId);
    }
    validateGraph(relation.assessmentGraph, assessmentIds, `${path}.assessmentGraph`);
  }
}

const INPUT_SCHEMA_V1_ARTIFACT_HASH = safeSha256(
  [
    "factbase-derivation-input-schema-v1",
    "private-module-captures-v2",
    INPUT_SCHEMA_ID,
    INPUT_SCHEMA_VERSION,
    UUID_PATTERN.source,
    UUID_PATTERN.flags,
    ...EVIDENCE_RELATIONS,
    ...GRAPH_CODES,
    getDerivationSafeRuntimeArtifactHash(),
    getCanonicalDecimalArtifactHash(),
    getCanonicalJsonArtifactHash(),
    loadedFunctionSource(initializeInputSchemaV1Bindings),
    loadedFunctionSource(canonicalizePostgreSqlNumeric),
    loadedFunctionSource(appendArrayElement),
    loadedFunctionSource(validateCanonicalTimestamp),
    loadedFunctionSource(findTextIndex),
    loadedFunctionSource(safeArrayIsArray),
    loadedFunctionSource(safeGetPrototypeOf),
    loadedFunctionSource(getLoadedObjectPrototype),
    loadedFunctionSource(safeJsonStringifyString),
    loadedFunctionSource(safeNumberIsSafeInteger),
    loadedFunctionSource(safeOwnKeys),
    loadedFunctionSource(safeRegExpExec),
    loadedFunctionSource(safeSha256),
    loadedFunctionSource(fail),
    loadedFunctionSource(objectWithKeys),
    loadedFunctionSource(arrayValue),
    loadedFunctionSource(stringValue),
    loadedFunctionSource(nullableString),
    loadedFunctionSource(uuidValue),
    loadedFunctionSource(nullableUuid),
    loadedFunctionSource(timestampValue),
    loadedFunctionSource(nullableTimestamp),
    loadedFunctionSource(decimalValue),
    loadedFunctionSource(compareText),
    loadedFunctionSource(assertSorted),
    loadedFunctionSource(graphCodeIndex),
    loadedFunctionSource(encodeNullable),
    loadedFunctionSource(encodeStringArray),
    loadedFunctionSource(anomalyKey),
    loadedFunctionSource(validateNullablePair),
    loadedFunctionSource(validateAssessment),
    loadedFunctionSource(validateGraph),
    loadedFunctionSource(assertDerivationInputSchemaV1),
  ].join("\n"),
);

export function getDerivationInputSchemaV1ArtifactHash(): string {
  return INPUT_SCHEMA_V1_ARTIFACT_HASH;
}
