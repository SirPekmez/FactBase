-- RCV-015 reproducible, append-only derivation provenance.
-- Apply only after rcv014_finalize_evidence_assessment_contract.sql.

BEGIN;

CREATE TABLE public.derivation_rule_revisions (
  id UUID PRIMARY KEY,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  derivation_type TEXT NOT NULL,
  definition_canonical TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  input_schema_id TEXT NOT NULL,
  input_schema_version TEXT NOT NULL,
  output_schema_id TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  canonicalization_id TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  reproducibility_mode TEXT NOT NULL,
  interpreter_id TEXT NULL,
  interpreter_version TEXT NULL,
  interpreter_artifact_hash TEXT NULL,
  interpreter_execution_contract_id TEXT NULL,
  interpreter_execution_contract_version TEXT NULL,
  interpreter_execution_contract_hash TEXT NULL,
  interpreter_runtime_id TEXT NULL,
  interpreter_runtime_version TEXT NULL,
  snapshot_builder_id TEXT NOT NULL,
  snapshot_builder_version TEXT NOT NULL,
  snapshot_builder_artifact_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT uq_derivation_rule_revisions_rule
    UNIQUE (rule_id, rule_version),

  CONSTRAINT uq_derivation_rule_revisions_contract
    UNIQUE (
      id,
      reproducibility_mode,
      input_schema_id,
      input_schema_version,
      output_schema_id,
      output_schema_version,
      canonicalization_id,
      canonicalization_version,
      hash_algorithm,
      definition_hash
    ),

  CONSTRAINT uq_derivation_rule_revisions_interpreter_execution
    UNIQUE (
      id,
      interpreter_artifact_hash,
      interpreter_execution_contract_id,
      interpreter_execution_contract_version,
      interpreter_execution_contract_hash,
      interpreter_runtime_id,
      interpreter_runtime_version
    ),

  CONSTRAINT uq_derivation_rule_revisions_snapshot_builder
    UNIQUE (
      id,
      snapshot_builder_id,
      snapshot_builder_version,
      snapshot_builder_artifact_hash
    ),

  CONSTRAINT chk_derivation_rule_revisions_non_empty
    CHECK (
      char_length(btrim(rule_id)) > 0 AND
      char_length(btrim(rule_version)) > 0 AND
      char_length(btrim(derivation_type)) > 0 AND
      char_length(definition_canonical) > 0 AND
      char_length(btrim(input_schema_id)) > 0 AND
      char_length(btrim(input_schema_version)) > 0 AND
      char_length(btrim(output_schema_id)) > 0 AND
      char_length(btrim(output_schema_version)) > 0
    ),

  CONSTRAINT chk_derivation_rule_revisions_definition_hash
    CHECK (definition_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT chk_derivation_rule_revisions_canonicalization
    CHECK (
      canonicalization_id = 'jcs-rfc8785' AND
      canonicalization_version = '1' AND
      hash_algorithm = 'sha-256'
    ),

  CONSTRAINT chk_derivation_rule_revisions_mode
    CHECK (
      reproducibility_mode IN ('deterministic_rules', 'recorded_process')
    ),

  CONSTRAINT chk_derivation_rule_revisions_interpreter
    CHECK (
      (
        reproducibility_mode = 'deterministic_rules' AND
        interpreter_id = 'factbase-derivation-rule-interpreter' AND
        interpreter_version = '1' AND
        interpreter_artifact_hash ~ '^[0-9a-f]{64}$' AND
        interpreter_execution_contract_id =
          'factbase-derivation-interpreter-execution' AND
        interpreter_execution_contract_version = '1' AND
        interpreter_execution_contract_hash ~ '^[0-9a-f]{64}$' AND
        interpreter_runtime_id = 'node-v8' AND
        char_length(btrim(interpreter_runtime_version)) > 0
      ) OR (
        reproducibility_mode = 'recorded_process' AND
        interpreter_id IS NULL AND
        interpreter_version IS NULL AND
        interpreter_artifact_hash IS NULL AND
        interpreter_execution_contract_id IS NULL AND
        interpreter_execution_contract_version IS NULL AND
        interpreter_execution_contract_hash IS NULL AND
        interpreter_runtime_id IS NULL AND
        interpreter_runtime_version IS NULL
      )
    ),

  CONSTRAINT chk_derivation_rule_revisions_snapshot_builder
    CHECK (
      input_schema_id = 'factbase-derivation-input' AND
      input_schema_version = '1' AND
      snapshot_builder_id = 'factbase-derivation-snapshot-builder' AND
      snapshot_builder_version = '1' AND
      snapshot_builder_artifact_hash ~ '^[0-9a-f]{64}$'
    )
);

CREATE TABLE public.derivation_rule_decision_codes (
  rule_revision_id UUID NOT NULL,
  input_kind TEXT NOT NULL,
  usage TEXT NOT NULL,
  decision_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_derivation_rule_decision_codes
    PRIMARY KEY (rule_revision_id, input_kind, usage, decision_code),

  CONSTRAINT fk_derivation_rule_decision_codes_revision
    FOREIGN KEY (rule_revision_id)
    REFERENCES public.derivation_rule_revisions (id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT chk_derivation_rule_decision_codes_kind
    CHECK (input_kind IN ('evidence_relation', 'assessment')),

  CONSTRAINT chk_derivation_rule_decision_codes_usage
    CHECK (usage = 'used'),

  CONSTRAINT chk_derivation_rule_decision_codes_manifest
    CHECK (decision_code = 'included_in_manifest')
);

CREATE TABLE public.derivations (
  id UUID PRIMARY KEY,
  claim_version_id UUID NOT NULL,
  rule_revision_id UUID NOT NULL,
  rule_definition_hash TEXT NOT NULL,
  interpreter_artifact_hash TEXT NULL,
  interpreter_execution_contract_id TEXT NULL,
  interpreter_execution_contract_version TEXT NULL,
  interpreter_execution_contract_hash TEXT NULL,
  interpreter_runtime_id TEXT NULL,
  interpreter_runtime_version TEXT NULL,
  snapshot_builder_id TEXT NOT NULL,
  snapshot_builder_version TEXT NOT NULL,
  snapshot_builder_artifact_hash TEXT NOT NULL,
  execution_method TEXT NOT NULL,
  input_schema_id TEXT NOT NULL,
  input_schema_version TEXT NOT NULL,
  input_canonical TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_schema_id TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  output_canonical TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  canonicalization_id TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  initiator_type TEXT NULL,
  initiator_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT uq_derivations_identity_context
    UNIQUE (id, rule_revision_id, claim_version_id),

  CONSTRAINT fk_derivations_claim_version
    FOREIGN KEY (claim_version_id)
    REFERENCES public.claim_versions (id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_derivations_rule_contract
    FOREIGN KEY (
      rule_revision_id,
      execution_method,
      input_schema_id,
      input_schema_version,
      output_schema_id,
      output_schema_version,
      canonicalization_id,
      canonicalization_version,
      hash_algorithm,
      rule_definition_hash
    )
    REFERENCES public.derivation_rule_revisions (
      id,
      reproducibility_mode,
      input_schema_id,
      input_schema_version,
      output_schema_id,
      output_schema_version,
      canonicalization_id,
      canonicalization_version,
      hash_algorithm,
      definition_hash
    )
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_derivations_interpreter_execution
    FOREIGN KEY (
      rule_revision_id,
      interpreter_artifact_hash,
      interpreter_execution_contract_id,
      interpreter_execution_contract_version,
      interpreter_execution_contract_hash,
      interpreter_runtime_id,
      interpreter_runtime_version
    )
    REFERENCES public.derivation_rule_revisions (
      id,
      interpreter_artifact_hash,
      interpreter_execution_contract_id,
      interpreter_execution_contract_version,
      interpreter_execution_contract_hash,
      interpreter_runtime_id,
      interpreter_runtime_version
    )
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_derivations_snapshot_builder
    FOREIGN KEY (
      rule_revision_id,
      snapshot_builder_id,
      snapshot_builder_version,
      snapshot_builder_artifact_hash
    )
    REFERENCES public.derivation_rule_revisions (
      id,
      snapshot_builder_id,
      snapshot_builder_version,
      snapshot_builder_artifact_hash
    )
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT chk_derivations_canonical_text
    CHECK (
      char_length(input_canonical) > 0 AND
      char_length(output_canonical) > 0
    ),

  CONSTRAINT chk_derivations_hashes
    CHECK (
      input_hash ~ '^[0-9a-f]{64}$' AND
      output_hash ~ '^[0-9a-f]{64}$' AND
      rule_definition_hash ~ '^[0-9a-f]{64}$'
    ),

  CONSTRAINT chk_derivations_interpreter_artifact
    CHECK (
      (
        execution_method = 'deterministic_rules' AND
        interpreter_artifact_hash ~ '^[0-9a-f]{64}$' AND
        interpreter_execution_contract_id =
          'factbase-derivation-interpreter-execution' AND
        interpreter_execution_contract_version = '1' AND
        interpreter_execution_contract_hash ~ '^[0-9a-f]{64}$' AND
        interpreter_runtime_id = 'node-v8' AND
        char_length(btrim(interpreter_runtime_version)) > 0
      ) OR (
        execution_method = 'recorded_process' AND
        interpreter_artifact_hash IS NULL AND
        interpreter_execution_contract_id IS NULL AND
        interpreter_execution_contract_version IS NULL AND
        interpreter_execution_contract_hash IS NULL AND
        interpreter_runtime_id IS NULL AND
        interpreter_runtime_version IS NULL
      )
    ),

  CONSTRAINT chk_derivations_snapshot_builder
    CHECK (
      input_schema_id = 'factbase-derivation-input' AND
      input_schema_version = '1' AND
      snapshot_builder_id = 'factbase-derivation-snapshot-builder' AND
      snapshot_builder_version = '1' AND
      snapshot_builder_artifact_hash ~ '^[0-9a-f]{64}$'
    ),

  CONSTRAINT chk_derivations_initiator_type
    CHECK (
      initiator_type IS NULL OR
      initiator_type IN ('human', 'system', 'importer', 'agent')
    ),

  CONSTRAINT chk_derivations_initiator_identity
    CHECK (initiator_id IS NULL OR initiator_type IS NOT NULL)
);

CREATE INDEX idx_derivations_claim_version
  ON public.derivations (claim_version_id, created_at, id);

CREATE INDEX idx_derivations_rule_input
  ON public.derivations (rule_revision_id, input_hash);

CREATE INDEX idx_derivations_reproducibility
  ON public.derivations (
    rule_revision_id,
    execution_method,
    input_hash,
    output_hash
  );

CREATE TABLE public.derivation_evidence_inputs (
  derivation_id UUID NOT NULL,
  rule_revision_id UUID NOT NULL,
  claim_version_id UUID NOT NULL,
  claim_version_evidence_id UUID NOT NULL,
  input_kind TEXT NOT NULL,
  usage TEXT NOT NULL,
  decision_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_derivation_evidence_inputs
    PRIMARY KEY (derivation_id, claim_version_evidence_id),

  CONSTRAINT fk_derivation_evidence_inputs_derivation
    FOREIGN KEY (derivation_id, rule_revision_id, claim_version_id)
    REFERENCES public.derivations (id, rule_revision_id, claim_version_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_derivation_evidence_inputs_relation
    FOREIGN KEY (claim_version_evidence_id, claim_version_id)
    REFERENCES public.claim_version_evidence (id, claim_version_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_derivation_evidence_inputs_decision
    FOREIGN KEY (rule_revision_id, input_kind, usage, decision_code)
    REFERENCES public.derivation_rule_decision_codes (
      rule_revision_id,
      input_kind,
      usage,
      decision_code
    )
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT chk_derivation_evidence_inputs_kind
    CHECK (input_kind = 'evidence_relation')
);

CREATE INDEX idx_derivation_evidence_inputs_relation
  ON public.derivation_evidence_inputs (claim_version_evidence_id);

CREATE TABLE public.derivation_assessment_inputs (
  derivation_id UUID NOT NULL,
  rule_revision_id UUID NOT NULL,
  claim_version_id UUID NOT NULL,
  claim_version_evidence_id UUID NOT NULL,
  assessment_id UUID NOT NULL,
  input_kind TEXT NOT NULL,
  usage TEXT NOT NULL,
  decision_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_derivation_assessment_inputs
    PRIMARY KEY (derivation_id, assessment_id),

  CONSTRAINT fk_derivation_assessment_inputs_derivation
    FOREIGN KEY (derivation_id, rule_revision_id, claim_version_id)
    REFERENCES public.derivations (id, rule_revision_id, claim_version_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_derivation_assessment_inputs_relation
    FOREIGN KEY (claim_version_evidence_id, claim_version_id)
    REFERENCES public.claim_version_evidence (id, claim_version_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_derivation_assessment_inputs_assessment
    FOREIGN KEY (assessment_id, claim_version_evidence_id)
    REFERENCES public.evidence_assessments (id, claim_version_evidence_id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_derivation_assessment_inputs_decision
    FOREIGN KEY (rule_revision_id, input_kind, usage, decision_code)
    REFERENCES public.derivation_rule_decision_codes (
      rule_revision_id,
      input_kind,
      usage,
      decision_code
    )
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT chk_derivation_assessment_inputs_kind
    CHECK (input_kind = 'assessment')
);

CREATE INDEX idx_derivation_assessment_inputs_assessment
  ON public.derivation_assessment_inputs (assessment_id);

CREATE TABLE public.derivation_recorded_process_audits (
  derivation_id UUID PRIMARY KEY,
  process_id TEXT NOT NULL,
  process_version TEXT NOT NULL,
  implementation_id TEXT NOT NULL,
  implementation_version TEXT NOT NULL,
  parameters_canonical TEXT NOT NULL,
  model_reference_id TEXT NULL,
  model_reference_version TEXT NULL,
  workflow_reference_id TEXT NULL,
  workflow_reference_version TEXT NULL,
  import_reference_type TEXT NULL,
  import_reference TEXT NULL,
  random_seed TEXT NULL,
  runtime_environment_canonical TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  audit_canonical TEXT NOT NULL,
  audit_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT fk_derivation_process_audits_derivation
    FOREIGN KEY (derivation_id)
    REFERENCES public.derivations (id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT chk_derivation_process_audits_non_empty
    CHECK (
      char_length(btrim(process_id)) > 0 AND
      char_length(btrim(process_version)) > 0 AND
      char_length(btrim(implementation_id)) > 0 AND
      char_length(btrim(implementation_version)) > 0 AND
      char_length(parameters_canonical) > 0 AND
      char_length(audit_canonical) > 0
    ),

  CONSTRAINT chk_derivation_process_audits_model_pair
    CHECK (
      (model_reference_id IS NULL AND model_reference_version IS NULL) OR
      (
        model_reference_id IS NOT NULL AND
        char_length(btrim(model_reference_id)) > 0 AND
        model_reference_version IS NOT NULL AND
        char_length(btrim(model_reference_version)) > 0
      )
    ),

  CONSTRAINT chk_derivation_process_audits_workflow_pair
    CHECK (
      (workflow_reference_id IS NULL AND workflow_reference_version IS NULL) OR
      (
        workflow_reference_id IS NOT NULL AND
        char_length(btrim(workflow_reference_id)) > 0 AND
        workflow_reference_version IS NOT NULL AND
        char_length(btrim(workflow_reference_version)) > 0
      )
    ),

  CONSTRAINT chk_derivation_process_audits_import_pair
    CHECK (
      (import_reference_type IS NULL AND import_reference IS NULL) OR
      (
        import_reference_type IN ('import_run', 'external_record') AND
        import_reference IS NOT NULL AND
        char_length(btrim(import_reference)) > 0
      )
    ),

  CONSTRAINT chk_derivation_process_audits_time
    CHECK (completed_at >= started_at),

  CONSTRAINT chk_derivation_process_audits_hash
    CHECK (audit_hash ~ '^[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION public.validate_rcv015_process_audit(
  derivation_uuid UUID
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  derivation_method TEXT;
  audit_count BIGINT;
BEGIN
  SELECT execution_method
  INTO derivation_method
  FROM public.derivations
  WHERE id = derivation_uuid;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)
  INTO audit_count
  FROM public.derivation_recorded_process_audits
  WHERE derivation_id = derivation_uuid;

  IF derivation_method = 'recorded_process' AND audit_count <> 1 THEN
    RAISE EXCEPTION 'recorded_process requires exactly one process audit'
      USING ERRCODE = '23514',
        CONSTRAINT = 'chk_derivations_recorded_process_audit';
  END IF;

  IF derivation_method = 'deterministic_rules' AND audit_count <> 0 THEN
    RAISE EXCEPTION 'deterministic_rules must not have a process audit'
      USING ERRCODE = '23514',
        CONSTRAINT = 'chk_derivations_recorded_process_audit';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rcv015_derivation_process_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.validate_rcv015_process_audit(OLD.derivation_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.validate_rcv015_process_audit(NEW.derivation_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rcv015_derivation_audit_requirement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.validate_rcv015_process_audit(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_derivations_rcv015_process_audit
AFTER INSERT OR UPDATE ON public.derivations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_rcv015_derivation_audit_requirement();

CREATE CONSTRAINT TRIGGER trg_process_audits_rcv015_requirement
AFTER INSERT OR UPDATE OR DELETE
ON public.derivation_recorded_process_audits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_rcv015_derivation_process_audit();

COMMIT;
