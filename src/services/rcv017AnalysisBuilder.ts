import {
  RCV017_ALGORITHM_ID,
  RCV017_ALGORITHM_VERSION,
  RCV017_ANALYSIS_SCHEMA_ID,
  RCV017_ANALYSIS_SCHEMA_VERSION,
  RCV017_CANONICALIZATION_ID,
  RCV017_CANONICALIZATION_VERSION,
  RCV017_DEPENDENCY_BEARING_RELATIONSHIPS_V1,
  RCV017_HASH_ALGORITHM,
  RCV017_INPUT_DIRECTIONS_V1,
  RCV017_POLICY_CANONICAL_FIELDS_V1,
  RCV017_POLICY_RULES_V1,
  RCV017_POLICY_SCHEMA_ID,
  RCV017_POLICY_SCHEMA_VERSION,
  RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_ID,
  RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_VERSION,
  Rcv017BranchKeyV1,
  Rcv017CanonicalUuidV1,
  Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1,
  Rcv017DependencyAnalysisPolicyCanonicalV1,
  Rcv017EvidenceRelationInputV1,
  Rcv017FindingV1,
  Rcv017NormalizedWitnessV1,
  Rcv017SelectedBindingInputV1,
  Rcv017Sha256HexV1,
  Rcv017TechnicalFailureCategoryV1,
} from "../contracts/rcv017ClaimEvidenceDependencyContractV1";
import {
  Rcv016ArtifactProvenanceStatementV1,
  Rcv016KnowledgeStateStatementV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  canonicalizeRcv016,
  sha256Rcv016Text,
} from "./rcv016Canonical";
import {
  assertFinalizedRcv016SnapshotBuilderResult,
  Rcv016SnapshotBuilderResultV1,
} from "./rcv016SnapshotBuilder";
import { freezeRcv016 } from "./rcv016Validation";
import {
  projectRcv017Persistence,
  Rcv017PersistenceProjectionV1,
} from "./rcv017PersistenceProjection";

export abstract class Rcv017TechnicalError extends Error {
  abstract readonly code: Rcv017TechnicalFailureCategoryV1;
  protected constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
  }
}

export class Rcv017ValidationError extends Rcv017TechnicalError {
  readonly code = "validation_failure" as const;
  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv017ValidationError";
  }
}

export class Rcv017UnsupportedVersionError extends Rcv017TechnicalError {
  readonly code = "unsupported_version" as const;
  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv017UnsupportedVersionError";
  }
}

export class Rcv017LimitError extends Rcv017TechnicalError {
  readonly code = "limit_failure" as const;
  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv017LimitError";
  }
}

export class Rcv017IntegrityParityError extends Rcv017TechnicalError {
  readonly code = "integrity_parity_failure" as const;
  constructor(path: string, message: string) {
    super(path, message);
    this.name = "Rcv017IntegrityParityError";
  }
}

export interface Rcv017DependencyAnalysisPolicyEnvelopeV1 {
  readonly definition: Rcv017DependencyAnalysisPolicyCanonicalV1;
  readonly canonical: string;
  readonly hash: Rcv017Sha256HexV1;
}

export interface Rcv017AnalysisBuilderInputV1 {
  readonly claimVersionId: string;
  readonly evidenceRelations: readonly Rcv017EvidenceRelationInputV1[];
  readonly selectedBindings: readonly Rcv017SelectedBindingInputV1[];
  readonly provenanceSnapshot: {
    readonly snapshotId: string;
    readonly builderResult: Rcv016SnapshotBuilderResultV1;
  };
  readonly dependencyAnalysisPolicy: Rcv017DependencyAnalysisPolicyEnvelopeV1;
  readonly algorithmIdentity: {
    readonly algorithmId: string;
    readonly algorithmVersion: string;
    readonly algorithmArtifactHash: string;
  };
}

export interface Rcv017AnalysisBuilderResultV1 {
  readonly analysis: Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1;
  readonly canonical: string;
  readonly hash: Rcv017Sha256HexV1;
  readonly policy: Rcv017DependencyAnalysisPolicyEnvelopeV1;
  readonly projection: Rcv017PersistenceProjectionV1;
}

type PlainObject = Record<string, unknown>;
type Branch = {
  readonly branchKey: Rcv017BranchKeyV1;
  readonly direction: "supports" | "contradicts";
  readonly anchorArtifactVersionId: string;
};
type Witness = {
  readonly artifactVersionIds: readonly string[];
  readonly statementIds: readonly string[];
};
type Closure = {
  readonly witnesses: ReadonlyMap<string, Witness>;
  readonly consideredStatementIds: ReadonlySet<string>;
};

const FINALIZED_ANALYSIS_RESULTS = new WeakSet<object>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const INPUT_KEYS = [
  "claimVersionId",
  "evidenceRelations",
  "selectedBindings",
  "provenanceSnapshot",
  "dependencyAnalysisPolicy",
  "algorithmIdentity",
] as const;
const RELATION_KEYS = [
  "claimVersionEvidenceRelationId",
  "evidenceId",
  "direction",
] as const;
const BINDING_KEYS = [
  "claimVersionEvidenceRelationId",
  "evidenceArtifactBindingStatementId",
  "evidenceId",
  "artifactVersionId",
] as const;
const POLICY_ENVELOPE_KEYS = ["definition", "canonical", "hash"] as const;
const ALGORITHM_KEYS = [
  "algorithmId",
  "algorithmVersion",
  "algorithmArtifactHash",
] as const;
const DIRECTION_RANK = { supports: 0, contradicts: 1 } as const;
const FINDING_RANK = {
  RECORDED_SHARED_ARTIFACT_VERSION: 0,
  RECORDED_COMMON_UPSTREAM: 1,
  NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE: 2,
  DEPENDENCY_KNOWLEDGE_INCOMPLETE: 3,
} as const;

function ascii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactObject(value: unknown, keys: readonly string[], path: string): PlainObject {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Rcv017ValidationError(path, "expected a plain object");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    throw new Rcv017ValidationError(path, "unexpected or missing field");
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
      throw new Rcv017ValidationError(path, "fields must be enumerable data properties");
    }
  }
  return value as PlainObject;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Rcv017ValidationError(path, "expected an array");
  return value;
}

function uuid(value: unknown, path: string): Rcv017CanonicalUuidV1 {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Rcv017ValidationError(path, "expected a lowercase canonical UUID");
  }
  return value as Rcv017CanonicalUuidV1;
}

function hash(value: unknown, path: string): Rcv017Sha256HexV1 {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new Rcv017ValidationError(path, "expected lowercase SHA-256 hex");
  }
  return value as Rcv017Sha256HexV1;
}

function positive(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Rcv017ValidationError(path, "expected a positive safe integer");
  }
  return value;
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new Rcv017ValidationError(path, "duplicates are forbidden");
  }
}

function branchCompare(
  left: Rcv017BranchKeyV1,
  right: Rcv017BranchKeyV1,
): number {
  return ascii(
    left.claimVersionEvidenceRelationId,
    right.claimVersionEvidenceRelationId,
  ) || ascii(
    left.evidenceArtifactBindingStatementId,
    right.evidenceArtifactBindingStatementId,
  );
}

function witnessCompare(left: Witness, right: Witness): number {
  if (left.statementIds.length !== right.statementIds.length) {
    return left.statementIds.length - right.statementIds.length;
  }
  for (let index = 0; index < left.statementIds.length; index += 1) {
    const compared = ascii(left.statementIds[index], right.statementIds[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function validatePolicy(value: unknown): Rcv017DependencyAnalysisPolicyEnvelopeV1 {
  const envelope = exactObject(value, POLICY_ENVELOPE_KEYS, "dependencyAnalysisPolicy");
  const definition = exactObject(
    envelope.definition,
    RCV017_POLICY_CANONICAL_FIELDS_V1,
    "dependencyAnalysisPolicy.definition",
  );
  if (
    definition.schemaId !== RCV017_POLICY_SCHEMA_ID ||
    definition.schemaVersion !== RCV017_POLICY_SCHEMA_VERSION ||
    definition.relationshipClassificationCatalogId !==
      RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_ID ||
    definition.relationshipClassificationCatalogVersion !==
      RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_VERSION ||
    definition.canonicalizationId !== RCV017_CANONICALIZATION_ID ||
    definition.canonicalizationVersion !== RCV017_CANONICALIZATION_VERSION ||
    definition.hashAlgorithm !== RCV017_HASH_ALGORITHM
  ) {
    throw new Rcv017UnsupportedVersionError(
      "dependencyAnalysisPolicy.definition",
      "unsupported schema, catalog, canonicalization, or hash identity",
    );
  }
  uuid(definition.policyId, "dependencyAnalysisPolicy.definition.policyId");
  positive(definition.policyVersion, "dependencyAnalysisPolicy.definition.policyVersion");
  for (const [field, expected] of Object.entries(RCV017_POLICY_RULES_V1)) {
    if (definition[field] !== expected) {
      throw new Rcv017ValidationError(
        `dependencyAnalysisPolicy.definition.${field}`,
        "unexpected frozen rule literal",
      );
    }
  }
  for (const field of [
    "maxEvidenceRelations", "maxBindings", "maxArtifactVersions",
    "maxStatements", "maxDependencyDepth", "maxFindings", "maxCanonicalBytes",
  ]) positive(definition[field], `dependencyAnalysisPolicy.definition.${field}`);

  const enabled = array(
    definition.enabledDependencyRelationships,
    "dependencyAnalysisPolicy.definition.enabledDependencyRelationships",
  );
  if (enabled.length === 0 || enabled.some((item) => typeof item !== "string")) {
    throw new Rcv017ValidationError(
      "dependencyAnalysisPolicy.definition.enabledDependencyRelationships",
      "expected a non-empty relationship array",
    );
  }
  unique(enabled as string[], "dependencyAnalysisPolicy.definition.enabledDependencyRelationships");
  let previousRank = -1;
  for (const relationship of enabled as string[]) {
    const rank = (RCV017_DEPENDENCY_BEARING_RELATIONSHIPS_V1 as readonly string[])
      .indexOf(relationship);
    if (rank < 0 || rank <= previousRank) {
      throw new Rcv017ValidationError(
        "dependencyAnalysisPolicy.definition.enabledDependencyRelationships",
        "must be a catalog-ordered subset of dependency-bearing relationships",
      );
    }
    previousRank = rank;
  }
  if (typeof envelope.canonical !== "string" || envelope.canonical.length === 0) {
    throw new Rcv017ValidationError("dependencyAnalysisPolicy.canonical", "expected non-empty TEXT");
  }
  const expectedHash = hash(envelope.hash, "dependencyAnalysisPolicy.hash");
  const encoded = canonicalizeRcv016(definition);
  if (encoded.canonical !== envelope.canonical || String(encoded.hash) !== expectedHash) {
    throw new Rcv017IntegrityParityError(
      "dependencyAnalysisPolicy",
      "Canonical/hash does not bind the exact closed policy definition",
    );
  }
  return freezeRcv016({
    definition: JSON.parse(encoded.canonical),
    canonical: encoded.canonical,
    hash: String(encoded.hash) as Rcv017Sha256HexV1,
  }) as Rcv017DependencyAnalysisPolicyEnvelopeV1;
}

function validateRelations(value: unknown): Rcv017EvidenceRelationInputV1[] {
  const values = array(value, "evidenceRelations");
  if (values.length === 0) throw new Rcv017ValidationError("evidenceRelations", "must be non-empty");
  const result = values.map((item, index) => {
    const path = `evidenceRelations[${index}]`;
    const object = exactObject(item, RELATION_KEYS, path);
    const direction = object.direction;
    if (!(RCV017_INPUT_DIRECTIONS_V1 as readonly unknown[]).includes(direction)) {
      throw new Rcv017ValidationError(`${path}.direction`, "unexpected evidence direction");
    }
    return {
      claimVersionEvidenceRelationId: uuid(object.claimVersionEvidenceRelationId, `${path}.claimVersionEvidenceRelationId`),
      evidenceId: uuid(object.evidenceId, `${path}.evidenceId`),
      direction,
    } as Rcv017EvidenceRelationInputV1;
  });
  unique(result.map((item) => item.claimVersionEvidenceRelationId), "evidenceRelations");
  return result.sort((left, right) => ascii(
    left.claimVersionEvidenceRelationId,
    right.claimVersionEvidenceRelationId,
  ));
}

function validateBindings(value: unknown): Rcv017SelectedBindingInputV1[] {
  const values = array(value, "selectedBindings");
  if (values.length === 0) throw new Rcv017ValidationError("selectedBindings", "must be non-empty");
  const result = values.map((item, index) => {
    const path = `selectedBindings[${index}]`;
    const object = exactObject(item, BINDING_KEYS, path);
    return {
      claimVersionEvidenceRelationId: uuid(object.claimVersionEvidenceRelationId, `${path}.claimVersionEvidenceRelationId`),
      evidenceArtifactBindingStatementId: uuid(object.evidenceArtifactBindingStatementId, `${path}.evidenceArtifactBindingStatementId`),
      evidenceId: uuid(object.evidenceId, `${path}.evidenceId`),
      artifactVersionId: uuid(object.artifactVersionId, `${path}.artifactVersionId`),
    } as Rcv017SelectedBindingInputV1;
  });
  unique(result.map((item) => item.evidenceArtifactBindingStatementId), "selectedBindings");
  unique(result.map((item) => `${item.claimVersionEvidenceRelationId}\u0000${item.evidenceArtifactBindingStatementId}`), "selectedBindings.branchKey");
  return result.sort((left, right) => branchCompare(left, right));
}

function buildClosure(
  branch: Branch,
  outgoing: ReadonlyMap<string, readonly Rcv016ArtifactProvenanceStatementV1[]>,
  enabled: ReadonlySet<string>,
  maxDepth: number,
  snapshotArtifacts: ReadonlySet<string>,
): Closure {
  const root: Witness = {
    artifactVersionIds: [branch.anchorArtifactVersionId],
    statementIds: [],
  };
  const witnesses = new Map<string, Witness>([[branch.anchorArtifactVersionId, root]]);
  const considered = new Set<string>();
  const queue: Witness[] = [root];
  const expanded = new Set<string>();
  while (queue.length > 0) {
    queue.sort(witnessCompare);
    const path = queue.shift() as Witness;
    const node = path.artifactVersionIds[path.artifactVersionIds.length - 1];
    if (witnesses.get(node) !== path || expanded.has(node)) continue;
    expanded.add(node);
    if (path.statementIds.length >= maxDepth) continue;
    for (const statement of outgoing.get(node) ?? []) {
      if (!enabled.has(statement.relationship)) continue;
      considered.add(statement.statementId);
      const upstream = statement.objectArtifactVersionId;
      if (!snapshotArtifacts.has(upstream)) {
        throw new Rcv017IntegrityParityError(
          "provenanceSnapshot",
          `statement references absent ArtifactVersion ${upstream}`,
        );
      }
      if (path.artifactVersionIds.includes(upstream)) continue;
      const candidate: Witness = {
        artifactVersionIds: [...path.artifactVersionIds, upstream],
        statementIds: [...path.statementIds, statement.statementId],
      };
      const previous = witnesses.get(upstream);
      if (previous === undefined || witnessCompare(candidate, previous) < 0) {
        witnesses.set(upstream, candidate);
        queue.push(candidate);
      }
    }
  }
  return { witnesses, consideredStatementIds: considered };
}

function findingCompare(left: Rcv017FindingV1, right: Rcv017FindingV1): number {
  const category = FINDING_RANK[left.type] - FINDING_RANK[right.type];
  if (category !== 0) return category;
  if (left.type === "RECORDED_SHARED_ARTIFACT_VERSION" && right.type === left.type) {
    return DIRECTION_RANK[left.direction] - DIRECTION_RANK[right.direction] ||
      ascii(left.artifactVersionId, right.artifactVersionId);
  }
  if (left.type === "RECORDED_COMMON_UPSTREAM" && right.type === left.type) {
    return DIRECTION_RANK[left.direction] - DIRECTION_RANK[right.direction] ||
      ascii(left.upstreamArtifactVersionId, right.upstreamArtifactVersionId);
  }
  if (left.type === "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE" && right.type === left.type) {
    return DIRECTION_RANK[left.direction] - DIRECTION_RANK[right.direction] ||
      branchCompare(left.lowerBranchKey, right.lowerBranchKey) ||
      branchCompare(left.upperBranchKey, right.upperBranchKey);
  }
  if (left.type === "DEPENDENCY_KNOWLEDGE_INCOMPLETE" && right.type === left.type) {
    return branchCompare(left.branchKey, right.branchKey);
  }
  return 0;
}

export function assertFinalizedRcv017AnalysisResult(
  value: unknown,
): Rcv017AnalysisBuilderResultV1 {
  if (
    value === null || typeof value !== "object" ||
    !FINALIZED_ANALYSIS_RESULTS.has(value)
  ) {
    throw new Rcv017ValidationError(
      "analysisBuilderResult",
      "result was not finalized by the RCV-017 Analysis Builder",
    );
  }
  return value as Rcv017AnalysisBuilderResultV1;
}

export function buildRcv017ClaimEvidenceDependencyAnalysis(
  value: unknown,
): Rcv017AnalysisBuilderResultV1 {
  const input = exactObject(value, INPUT_KEYS, "analysisBuilderInput");
  const claimVersionId = uuid(input.claimVersionId, "claimVersionId");
  const relations = validateRelations(input.evidenceRelations);
  const bindings = validateBindings(input.selectedBindings);
  const policy = validatePolicy(input.dependencyAnalysisPolicy);
  const definition = policy.definition;
  if (relations.length > definition.maxEvidenceRelations) {
    throw new Rcv017LimitError("evidenceRelations", "exceeds maxEvidenceRelations");
  }
  if (bindings.length > definition.maxBindings) {
    throw new Rcv017LimitError("selectedBindings", "exceeds maxBindings");
  }

  const snapshotEnvelope = exactObject(
    input.provenanceSnapshot,
    ["snapshotId", "builderResult"],
    "provenanceSnapshot",
  );
  const snapshotId = uuid(snapshotEnvelope.snapshotId, "provenanceSnapshot.snapshotId");
  const snapshotResult = assertFinalizedRcv016SnapshotBuilderResult(
    snapshotEnvelope.builderResult,
  );
  if (sha256Rcv016Text(snapshotResult.canonical) !== snapshotResult.hash) {
    throw new Rcv017IntegrityParityError(
      "provenanceSnapshot",
      "Snapshot hash does not bind exact Canonical TEXT",
    );
  }

  const algorithm = exactObject(
    input.algorithmIdentity,
    ALGORITHM_KEYS,
    "algorithmIdentity",
  );
  if (
    algorithm.algorithmId !== RCV017_ALGORITHM_ID ||
    algorithm.algorithmVersion !== RCV017_ALGORITHM_VERSION
  ) {
    throw new Rcv017UnsupportedVersionError(
      "algorithmIdentity",
      "unsupported analysis algorithm identity",
    );
  }
  const algorithmArtifactHash = hash(
    algorithm.algorithmArtifactHash,
    "algorithmIdentity.algorithmArtifactHash",
  );

  const relationById = new Map(relations.map((item) => [item.claimVersionEvidenceRelationId, item]));
  const bindingsByRelation = new Map<string, number>();
  const snapshotBindings = new Map<string, (typeof snapshotResult.snapshot.evidenceArtifactBindings)[number]>(
    snapshotResult.snapshot.evidenceArtifactBindings.map((item) => [item.statementId, item]),
  );
  const snapshotBindingMembership = new Set<string>(
    snapshotResult.membership.evidenceArtifactBindings.map(
      (item) => item.evidenceArtifactBindingId,
    ),
  );
  const snapshotArtifacts = new Set<string>(
    snapshotResult.snapshot.artifactVersions.map((item) => item.artifactVersionId),
  );
  for (const binding of bindings) {
    const relation = relationById.get(binding.claimVersionEvidenceRelationId);
    if (!relation) throw new Rcv017ValidationError("selectedBindings", "references an unselected relation");
    if (relation.evidenceId !== binding.evidenceId) {
      throw new Rcv017IntegrityParityError("selectedBindings", "relation Evidence parity failed");
    }
    const statement = snapshotBindings.get(binding.evidenceArtifactBindingStatementId);
    if (!statement || !snapshotBindingMembership.has(binding.evidenceArtifactBindingStatementId)) {
      throw new Rcv017IntegrityParityError("selectedBindings", "binding is not in the finalized Snapshot");
    }
    if (
      String(statement.subjectEvidenceId) !== binding.evidenceId ||
      String(statement.objectArtifactVersionId) !== binding.artifactVersionId
    ) {
      throw new Rcv017IntegrityParityError("selectedBindings", "binding historical row parity failed");
    }
    if (!snapshotArtifacts.has(binding.artifactVersionId)) {
      throw new Rcv017IntegrityParityError("selectedBindings", "branch anchor is not in the finalized Snapshot");
    }
    bindingsByRelation.set(
      binding.claimVersionEvidenceRelationId,
      (bindingsByRelation.get(binding.claimVersionEvidenceRelationId) ?? 0) + 1,
    );
  }
  for (const relation of relations) {
    if (!bindingsByRelation.has(relation.claimVersionEvidenceRelationId)) {
      throw new Rcv017ValidationError("evidenceRelations", "each selected relation requires a binding");
    }
  }

  const outgoing = new Map<string, Rcv016ArtifactProvenanceStatementV1[]>();
  for (const statement of snapshotResult.snapshot.artifactProvenanceStatements) {
    const rows = outgoing.get(statement.subjectArtifactVersionId) ?? [];
    rows.push(statement);
    outgoing.set(statement.subjectArtifactVersionId, rows);
  }
  for (const rows of outgoing.values()) rows.sort((left, right) => ascii(left.statementId, right.statementId));
  const enabled = new Set<string>(definition.enabledDependencyRelationships);
  const branches: Branch[] = bindings.flatMap((binding) => {
    const direction = relationById.get(binding.claimVersionEvidenceRelationId)?.direction;
    if (direction === "contextualizes" || direction === undefined) return [];
    return [{
      branchKey: {
        claimVersionEvidenceRelationId: binding.claimVersionEvidenceRelationId,
        evidenceArtifactBindingStatementId: binding.evidenceArtifactBindingStatementId,
      },
      direction,
      anchorArtifactVersionId: binding.artifactVersionId,
    } as Branch];
  });
  const closures = new Map<Branch, Closure>();
  const reached = new Set<string>();
  const consideredStatements = new Set<string>();
  for (const branch of branches) {
    const closure = buildClosure(
      branch,
      outgoing,
      enabled,
      definition.maxDependencyDepth,
      snapshotArtifacts,
    );
    closures.set(branch, closure);
    for (const artifactVersionId of closure.witnesses.keys()) reached.add(artifactVersionId);
    for (const statementId of closure.consideredStatementIds) consideredStatements.add(statementId);
  }
  if (reached.size > definition.maxArtifactVersions) {
    throw new Rcv017LimitError("artifactVersions", "exceeds maxArtifactVersions");
  }
  if (consideredStatements.size > definition.maxStatements) {
    throw new Rcv017LimitError("artifactProvenanceStatements", "exceeds maxStatements");
  }

  const findings: Rcv017FindingV1[] = [];
  for (const direction of ["supports", "contradicts"] as const) {
    const partition = branches.filter((branch) => branch.direction === direction);
    const byAnchor = new Map<string, Branch[]>();
    for (const branch of partition) {
      const members = byAnchor.get(branch.anchorArtifactVersionId) ?? [];
      members.push(branch);
      byAnchor.set(branch.anchorArtifactVersionId, members);
    }
    for (const [artifactVersionId, members] of byAnchor) {
      if (members.length < 2) continue;
      findings.push({
        type: "RECORDED_SHARED_ARTIFACT_VERSION",
        direction,
        artifactVersionId,
        members: members.map((member) => member.branchKey).sort(branchCompare),
      } as unknown as Rcv017FindingV1);
    }

    for (const upstreamArtifactVersionId of [...reached].sort(ascii)) {
      const members = partition.filter((branch) =>
        closures.get(branch)?.witnesses.has(upstreamArtifactVersionId));
      if (members.length < 2) continue;
      const memberValues = members.map((branch) => {
        const witness = closures.get(branch)?.witnesses.get(upstreamArtifactVersionId) as Witness;
        return {
        branchKey: branch.branchKey,
        witness: {
          artifactVersionIds: witness.artifactVersionIds,
          artifactProvenanceStatementIds: witness.statementIds,
        } as unknown as Rcv017NormalizedWitnessV1,
      }; }).sort((left, right) => branchCompare(left.branchKey, right.branchKey));
      if (memberValues.every((member) => member.witness.artifactProvenanceStatementIds.length === 0)) continue;
      findings.push({
        type: "RECORDED_COMMON_UPSTREAM",
        direction,
        upstreamArtifactVersionId,
        members: memberValues,
      } as unknown as Rcv017FindingV1);
    }

    for (let lower = 0; lower < partition.length; lower += 1) {
      for (let upper = lower + 1; upper < partition.length; upper += 1) {
        const left = partition[lower];
        const right = partition[upper];
        if (left.anchorArtifactVersionId === right.anchorArtifactVersionId) continue;
        const leftClosure = closures.get(left)?.witnesses as ReadonlyMap<string, Witness>;
        const rightClosure = closures.get(right)?.witnesses as ReadonlyMap<string, Witness>;
        if ([...leftClosure.keys()].some((item) => rightClosure.has(item))) continue;
        const [lowerBranch, upperBranch] = branchCompare(left.branchKey, right.branchKey) < 0
          ? [left.branchKey, right.branchKey]
          : [right.branchKey, left.branchKey];
        findings.push({
          type: "NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE",
          direction,
          lowerBranchKey: lowerBranch,
          upperBranchKey: upperBranch,
        } as Rcv017FindingV1);
      }
    }
  }

  const knowledgeByArtifact = new Map<string, Rcv016KnowledgeStateStatementV1[]>();
  for (const statement of snapshotResult.snapshot.knowledgeStateStatements) {
    if (statement.scope !== "upstream_provenance" || !(["unknown", "partial"] as string[]).includes(statement.state)) continue;
    const values = knowledgeByArtifact.get(statement.subjectArtifactVersionId) ?? [];
    values.push(statement);
    knowledgeByArtifact.set(statement.subjectArtifactVersionId, values);
  }
  const derived = new Set<string>(
    snapshotResult.snapshot.derivedUnrecordedStates.map((item) => item.artifactVersionId),
  );
  for (const branch of branches) {
    const closure = closures.get(branch) as Closure;
    const statementIds: string[] = [];
    const derivedIds: string[] = [];
    const affected = new Set<string>();
    for (const artifactVersionId of closure.witnesses.keys()) {
      const statements = knowledgeByArtifact.get(artifactVersionId) ?? [];
      if (statements.length > 0) {
        affected.add(artifactVersionId);
        statementIds.push(...statements.map((item) => item.statementId));
      }
      if (derived.has(artifactVersionId)) {
        affected.add(artifactVersionId);
        derivedIds.push(artifactVersionId);
      }
    }
    if (statementIds.length === 0 && derivedIds.length === 0) continue;
    statementIds.sort(ascii);
    derivedIds.sort(ascii);
    findings.push({
      type: "DEPENDENCY_KNOWLEDGE_INCOMPLETE",
      branchKey: branch.branchKey,
      affectedArtifactVersionIds: [...affected].sort(ascii),
      knowledgeStateStatementIds: statementIds,
      derivedUnrecordedArtifactVersionIds: derivedIds,
    } as unknown as Rcv017FindingV1);
  }
  findings.sort(findingCompare);
  if (findings.length > definition.maxFindings) {
    throw new Rcv017LimitError("findings", "exceeds maxFindings");
  }

  const analysis = {
    schemaId: RCV017_ANALYSIS_SCHEMA_ID,
    schemaVersion: RCV017_ANALYSIS_SCHEMA_VERSION,
    claimVersionId,
    evidenceRelations: relations,
    selectedBindings: bindings,
    provenanceSnapshotId: snapshotId,
    provenanceSnapshotHash: snapshotResult.hash,
    dependencyAnalysisPolicyId: definition.policyId,
    dependencyAnalysisPolicyVersion: definition.policyVersion,
    dependencyAnalysisPolicyHash: policy.hash,
    algorithmId: RCV017_ALGORITHM_ID,
    algorithmVersion: RCV017_ALGORITHM_VERSION,
    algorithmArtifactHash,
    canonicalizationId: RCV017_CANONICALIZATION_ID,
    canonicalizationVersion: RCV017_CANONICALIZATION_VERSION,
    hashAlgorithm: RCV017_HASH_ALGORITHM,
    findings,
  } as unknown as Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1;
  const encoded = canonicalizeRcv016(analysis);
  if (Buffer.byteLength(encoded.canonical, "utf8") > definition.maxCanonicalBytes) {
    throw new Rcv017LimitError("analysisCanonical", "exceeds maxCanonicalBytes");
  }
  const frozenAnalysis = freezeRcv016(analysis) as Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1;
  const projection = projectRcv017Persistence(
    frozenAnalysis,
    encoded.canonical,
    String(encoded.hash) as Rcv017Sha256HexV1,
    definition,
    policy.canonical,
    policy.hash,
  );
  const result = freezeRcv016({
    analysis: frozenAnalysis,
    canonical: encoded.canonical,
    hash: String(encoded.hash) as Rcv017Sha256HexV1,
    policy,
    projection,
  }) as unknown as Rcv017AnalysisBuilderResultV1;
  FINALIZED_ANALYSIS_RESULTS.add(result);
  return result;
}
