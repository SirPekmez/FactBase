-- RCV-014 reproducible evidence-assessment rubric and comparison context.
-- Apply only after rcv011_extend_evidence_assessments.sql.

BEGIN;

ALTER TABLE public.evidence_assessments
  ADD COLUMN rubric_id TEXT NULL,
  ADD COLUMN rubric_version TEXT NULL,
  ADD COLUMN recency_reference_type TEXT NULL,
  ADD COLUMN recency_reference_at TIMESTAMPTZ NULL,
  ADD COLUMN rule_set_id TEXT NULL,
  ADD COLUMN rule_set_version TEXT NULL,
  ADD COLUMN model_id TEXT NULL,
  ADD COLUMN model_version TEXT NULL,
  ADD COLUMN model_process_type TEXT NULL,
  ADD COLUMN model_process_version TEXT NULL,
  ADD COLUMN import_reference_type TEXT NULL,
  ADD COLUMN import_reference TEXT NULL,

  ADD CONSTRAINT chk_evidence_assessments_rcv014_rubric
    CHECK (
      rubric_id IS NOT NULL AND
      rubric_id = 'factbase-evidence-assessment' AND
      rubric_version IS NOT NULL AND
      rubric_version = '1'
    ) NOT VALID,

  ADD CONSTRAINT chk_evidence_assessments_rcv014_recency_context
    CHECK (
      (
        recency IS NULL AND
        recency_reference_type IS NULL AND
        recency_reference_at IS NULL
      ) OR (
        recency IS NOT NULL AND
        recency_reference_type IS NOT NULL AND
        recency_reference_type IN (
          'current_state_at',
          'event_at',
          'period_ending_at'
        ) AND
        recency_reference_at IS NOT NULL
      )
    ) NOT VALID,

  ADD CONSTRAINT chk_evidence_assessments_rcv014_method_provenance
    CHECK (
      (
        assessment_method = 'manual' AND
        rule_set_id IS NULL AND rule_set_version IS NULL AND
        model_id IS NULL AND model_version IS NULL AND
        model_process_type IS NULL AND model_process_version IS NULL AND
        import_reference_type IS NULL AND import_reference IS NULL
      ) OR (
        assessment_method = 'rules_based' AND
        rule_set_id IS NOT NULL AND char_length(btrim(rule_set_id)) > 0 AND
        rule_set_version IS NOT NULL AND char_length(btrim(rule_set_version)) > 0 AND
        model_id IS NULL AND model_version IS NULL AND
        model_process_type IS NULL AND model_process_version IS NULL AND
        import_reference_type IS NULL AND import_reference IS NULL
      ) OR (
        assessment_method = 'model_assisted' AND
        rule_set_id IS NULL AND rule_set_version IS NULL AND
        model_id IS NOT NULL AND char_length(btrim(model_id)) > 0 AND
        model_version IS NOT NULL AND char_length(btrim(model_version)) > 0 AND
        model_process_type IS NOT NULL AND
        model_process_type IN ('workflow', 'prompt') AND
        model_process_version IS NOT NULL AND
          char_length(btrim(model_process_version)) > 0 AND
        import_reference_type IS NULL AND import_reference IS NULL
      ) OR (
        assessment_method = 'imported' AND
        rule_set_id IS NULL AND rule_set_version IS NULL AND
        model_id IS NULL AND model_version IS NULL AND
        model_process_type IS NULL AND model_process_version IS NULL AND
        import_reference_type IS NOT NULL AND
        import_reference_type IN ('import_run', 'external_record') AND
        import_reference IS NOT NULL AND char_length(btrim(import_reference)) > 0
      )
    ) NOT VALID;

ALTER TABLE public.claim_version_evidence
  ADD CONSTRAINT uq_claim_version_evidence_id_claim_version
    UNIQUE (id, claim_version_id);

CREATE TABLE public.evidence_assessment_independence_comparisons (
  assessment_id UUID NOT NULL,
  assessed_claim_version_evidence_id UUID NOT NULL,
  comparison_claim_version_evidence_id UUID NOT NULL,
  claim_version_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_evidence_assessment_independence_comparisons
    PRIMARY KEY (assessment_id, comparison_claim_version_evidence_id),

  CONSTRAINT fk_assessment_independence_assessment_relation
    FOREIGN KEY (assessment_id, assessed_claim_version_evidence_id)
    REFERENCES public.evidence_assessments (id, claim_version_evidence_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_assessment_independence_assessed_version
    FOREIGN KEY (assessed_claim_version_evidence_id, claim_version_id)
    REFERENCES public.claim_version_evidence (id, claim_version_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_assessment_independence_comparison_version
    FOREIGN KEY (comparison_claim_version_evidence_id, claim_version_id)
    REFERENCES public.claim_version_evidence (id, claim_version_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT chk_assessment_independence_not_self
    CHECK (
      assessed_claim_version_evidence_id <>
      comparison_claim_version_evidence_id
    )
);

CREATE INDEX idx_assessment_independence_comparison_relation
  ON public.evidence_assessment_independence_comparisons (
    comparison_claim_version_evidence_id
  );

CREATE OR REPLACE FUNCTION public.validate_rcv014_assessment_independence(
  assessment_uuid UUID
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  assessment_independence NUMERIC;
  assessment_rubric_id TEXT;
  assessment_rubric_version TEXT;
  comparison_count BIGINT;
BEGIN
  SELECT independence, rubric_id, rubric_version
  INTO assessment_independence, assessment_rubric_id, assessment_rubric_version
  FROM public.evidence_assessments
  WHERE id = assessment_uuid;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF assessment_rubric_id IS DISTINCT FROM 'factbase-evidence-assessment' OR
     assessment_rubric_version IS DISTINCT FROM '1' THEN
    RETURN;
  END IF;

  SELECT count(*)
  INTO comparison_count
  FROM public.evidence_assessment_independence_comparisons
  WHERE assessment_id = assessment_uuid;

  IF assessment_independence IS NOT NULL AND comparison_count = 0 THEN
    RAISE EXCEPTION 'RCV-014 independence requires at least one comparison relation'
      USING ERRCODE = '23514',
        CONSTRAINT = 'chk_evidence_assessments_rcv014_independence_context';
  END IF;

  IF assessment_independence IS NULL AND comparison_count <> 0 THEN
    RAISE EXCEPTION 'RCV-014 comparisons require a non-null independence value'
      USING ERRCODE = '23514',
        CONSTRAINT = 'chk_evidence_assessments_rcv014_independence_context';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rcv014_assessment_independence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.validate_rcv014_assessment_independence(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rcv014_independence_comparison()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.validate_rcv014_assessment_independence(OLD.assessment_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.validate_rcv014_assessment_independence(NEW.assessment_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_evidence_assessments_rcv014_independence
AFTER INSERT OR UPDATE ON public.evidence_assessments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_rcv014_assessment_independence();

CREATE CONSTRAINT TRIGGER trg_assessment_independence_comparisons_rcv014
AFTER INSERT OR UPDATE OR DELETE
ON public.evidence_assessment_independence_comparisons
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_rcv014_independence_comparison();

COMMIT;
