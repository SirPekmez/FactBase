-- RCV-011 append-only assessment provenance and explicit assessment responses.
-- Apply only after rcv010_add_provenance_and_evidence.sql.

BEGIN;

ALTER TABLE public.evidence_assessments
  ADD COLUMN initiator_type TEXT NULL,
  ADD COLUMN initiator_id TEXT NULL,
  ADD COLUMN responds_to_assessment_id UUID NULL,
  ADD COLUMN response_relation TEXT NULL,

  ADD CONSTRAINT uq_evidence_assessments_id_relation
    UNIQUE (id, claim_version_evidence_id),

  ADD CONSTRAINT chk_evidence_assessments_initiator_type
    CHECK (
      initiator_type IS NULL OR
      initiator_type IN ('human', 'system', 'importer', 'agent')
    ),

  ADD CONSTRAINT chk_evidence_assessments_initiator_identity
    CHECK (initiator_id IS NULL OR initiator_type IS NOT NULL),

  ADD CONSTRAINT chk_evidence_assessments_response_pair
    CHECK (
      (responds_to_assessment_id IS NULL AND response_relation IS NULL) OR
      (responds_to_assessment_id IS NOT NULL AND response_relation IS NOT NULL)
    ),

  ADD CONSTRAINT chk_evidence_assessments_response_relation
    CHECK (
      response_relation IS NULL OR
      response_relation IN ('supports', 'disputes', 'contextualizes')
    ),

  ADD CONSTRAINT chk_evidence_assessments_no_self_response
    CHECK (
      responds_to_assessment_id IS NULL OR
      responds_to_assessment_id <> id
    ),

  ADD CONSTRAINT chk_evidence_assessments_has_dimension
    CHECK (
      source_quality IS NOT NULL OR
      relevance IS NOT NULL OR
      directness IS NOT NULL OR
      recency IS NOT NULL OR
      independence IS NOT NULL
    ) NOT VALID,

  ADD CONSTRAINT chk_evidence_assessments_method
    CHECK (
      assessment_method IS NOT NULL AND
      assessment_method IN ('manual', 'rules_based', 'model_assisted', 'imported')
    ) NOT VALID,

  ADD CONSTRAINT chk_evidence_assessments_rationale
    CHECK (
      rationale IS NOT NULL AND
      char_length(btrim(rationale)) >= 1 AND
      char_length(rationale) <= 4000
    ) NOT VALID,

  ADD CONSTRAINT fk_evidence_assessments_response_same_relation
    FOREIGN KEY (responds_to_assessment_id, claim_version_evidence_id)
    REFERENCES public.evidence_assessments (id, claim_version_evidence_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION;

CREATE INDEX idx_evidence_assessments_response_relation
  ON public.evidence_assessments (
    responds_to_assessment_id,
    claim_version_evidence_id
  );

COMMIT;
