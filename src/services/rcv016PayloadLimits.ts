import {
  RCV016_BOUNDED_PAYLOAD_FIELDS_V1,
  Rcv016PayloadLimitsV1,
  Rcv016PositiveSafeIntegerV1,
} from "../contracts/rcv016ProvenanceContractV1";
import {
  assertRcv016TextHash,
  canonicalizeRcv016,
  validateRcv016Sha256Hex,
} from "./rcv016Canonical";
import {
  Rcv016ValidationError,
  expectRcv016ExactObject,
  expectRcv016NonEmptyString,
  expectRcv016PositiveSafeInteger,
  freezeRcv016,
} from "./rcv016Validation";

export const RCV016_PAYLOAD_LIMIT_FIELD_NAMES =
  RCV016_BOUNDED_PAYLOAD_FIELDS_V1;

const PAYLOAD_LIMIT_KEYS = [
  "limitsId",
  "limitsVersion",
  ...RCV016_PAYLOAD_LIMIT_FIELD_NAMES,
  "definitionCanonical",
  "definitionHash",
] as const;

export function validateRcv016PayloadLimits(
  value: unknown,
): Readonly<Rcv016PayloadLimitsV1> {
  const input = expectRcv016ExactObject(value, PAYLOAD_LIMIT_KEYS, "payloadLimits");
  const limitsId = expectRcv016NonEmptyString(
    input.limitsId,
    "payloadLimits.limitsId",
  );
  const limitsVersion = expectRcv016NonEmptyString(
    input.limitsVersion,
    "payloadLimits.limitsVersion",
  );

  const definition: Record<string, string | number> = {
    limitsId,
    limitsVersion,
  };
  const validatedLimits: Record<string, Rcv016PositiveSafeIntegerV1> = {};
  for (const name of RCV016_PAYLOAD_LIMIT_FIELD_NAMES) {
    const validated = expectRcv016PositiveSafeInteger(
      input[name],
      `payloadLimits.${name}`,
    ) as Rcv016PositiveSafeIntegerV1;
    validatedLimits[name] = validated;
    definition[name] = validated;
  }

  const definitionCanonical = expectRcv016NonEmptyString(
    input.definitionCanonical,
    "payloadLimits.definitionCanonical",
  );
  validateRcv016Sha256Hex(
    input.definitionHash,
    "payloadLimits.definitionHash",
  );
  const definitionHash = assertRcv016TextHash(
    definitionCanonical,
    input.definitionHash,
    "payloadLimits.definitionHash",
  );
  const expectedDefinition = canonicalizeRcv016(definition).canonical;
  if (definitionCanonical !== expectedDefinition) {
    throw new Rcv016ValidationError(
      "payloadLimits.definitionCanonical",
      "must equal JCS over limitsId, limitsVersion, and the 20 limit fields",
    );
  }

  return freezeRcv016({
    limitsId,
    limitsVersion,
    ...validatedLimits,
    definitionCanonical,
    definitionHash,
  }) as unknown as Readonly<Rcv016PayloadLimitsV1>;
}
