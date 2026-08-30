import {
  RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1,
  RCV016_DETERMINISTIC_ORDERING_V1,
  RCV016_VISITED_SEMANTICS_V1,
  Rcv016PositiveSafeIntegerV1,
  Rcv016TraversalPolicyV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  assertRcv016TextHash,
  canonicalizeRcv016,
  validateRcv016Sha256Hex,
} from "./rcv016Canonical";
import {
  Rcv016ValidationError,
  expectRcv016Array,
  expectRcv016ExactObject,
  expectRcv016NonEmptyString,
  expectRcv016PositiveSafeInteger,
  freezeRcv016,
} from "./rcv016Validation";

const POLICY_KEYS = [
  "policyId",
  "policyVersion",
  "maxRoots",
  "maxNodes",
  "maxEdges",
  "maxDepth",
  "maxCanonicalSnapshotBytes",
  "allowedRelationships",
  "deterministicOrdering",
  "visitedSemantics",
  "definitionCanonical",
  "definitionHash",
] as const;

export function validateRcv016TraversalPolicy(
  value: unknown,
): Readonly<Rcv016TraversalPolicyV1> {
  const input = expectRcv016ExactObject(value, POLICY_KEYS, "traversalPolicy");
  const policyId = expectRcv016NonEmptyString(
    input.policyId,
    "traversalPolicy.policyId",
  );
  const policyVersion = expectRcv016NonEmptyString(
    input.policyVersion,
    "traversalPolicy.policyVersion",
  );
  const maxRoots = expectRcv016PositiveSafeInteger(
    input.maxRoots,
    "traversalPolicy.maxRoots",
  ) as Rcv016PositiveSafeIntegerV1;
  const maxNodes = expectRcv016PositiveSafeInteger(
    input.maxNodes,
    "traversalPolicy.maxNodes",
  ) as Rcv016PositiveSafeIntegerV1;
  const maxEdges = expectRcv016PositiveSafeInteger(
    input.maxEdges,
    "traversalPolicy.maxEdges",
  ) as Rcv016PositiveSafeIntegerV1;
  const maxDepth = expectRcv016PositiveSafeInteger(
    input.maxDepth,
    "traversalPolicy.maxDepth",
  ) as Rcv016PositiveSafeIntegerV1;
  const maxCanonicalSnapshotBytes = expectRcv016PositiveSafeInteger(
    input.maxCanonicalSnapshotBytes,
    "traversalPolicy.maxCanonicalSnapshotBytes",
  ) as Rcv016PositiveSafeIntegerV1;
  const rawRelationships = expectRcv016Array(
    input.allowedRelationships,
    "traversalPolicy.allowedRelationships",
  );
  if (rawRelationships.length !== RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1.length) {
    throw new Rcv016ValidationError(
      "traversalPolicy.allowedRelationships",
      "expected the complete seven-value V1 relationship array",
    );
  }
  for (let index = 0; index < rawRelationships.length; index += 1) {
    if (rawRelationships[index] !== RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1[index]) {
      throw new Rcv016ValidationError(
        `traversalPolicy.allowedRelationships[${index}]`,
        "unexpected relationship or order",
      );
    }
  }
  if (input.deterministicOrdering !== RCV016_DETERMINISTIC_ORDERING_V1) {
    throw new Rcv016ValidationError(
      "traversalPolicy.deterministicOrdering",
      `expected ${RCV016_DETERMINISTIC_ORDERING_V1}`,
    );
  }
  if (input.visitedSemantics !== RCV016_VISITED_SEMANTICS_V1) {
    throw new Rcv016ValidationError(
      "traversalPolicy.visitedSemantics",
      `expected ${RCV016_VISITED_SEMANTICS_V1}`,
    );
  }
  const allowedRelationships = [
    ...RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1,
  ] as unknown as typeof RCV016_CONTENT_PROVENANCE_RELATIONSHIPS_V1;
  const definition = {
    policyId,
    policyVersion,
    maxRoots,
    maxNodes,
    maxEdges,
    maxDepth,
    maxCanonicalSnapshotBytes,
    allowedRelationships,
    deterministicOrdering: RCV016_DETERMINISTIC_ORDERING_V1,
    visitedSemantics: RCV016_VISITED_SEMANTICS_V1,
  };
  const definitionCanonical = expectRcv016NonEmptyString(
    input.definitionCanonical,
    "traversalPolicy.definitionCanonical",
  );
  validateRcv016Sha256Hex(input.definitionHash, "traversalPolicy.definitionHash");
  const definitionHash = assertRcv016TextHash(
    definitionCanonical,
    input.definitionHash,
    "traversalPolicy.definitionHash",
  );
  if (definitionCanonical !== canonicalizeRcv016(definition).canonical) {
    throw new Rcv016ValidationError(
      "traversalPolicy.definitionCanonical",
      "must equal JCS over the closed Traversal Policy definition fields",
    );
  }
  return freezeRcv016({
    ...definition,
    definitionCanonical,
    definitionHash,
  }) as Readonly<Rcv016TraversalPolicyV1>;
}
