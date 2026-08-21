export const ASSESSMENT_INITIATOR_TYPES = [
  "human",
  "system",
  "importer",
  "agent",
] as const;

export type AssessmentInitiatorType =
  (typeof ASSESSMENT_INITIATOR_TYPES)[number];

export interface TrustedOperationContext {
  initiator?: {
    type: AssessmentInitiatorType;
    id: string | null;
  };
}
