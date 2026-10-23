-- RCV-021 Active Research Orchestration V1.
-- Additive migration; apply only after rcv020_add_observatory_radar_ingestion.sql.
-- Cross-row lifecycle, lineage, and manifest rules remain verifier authority.

BEGIN;

CREATE TYPE public.rcv021_subject_type AS ENUM (
  'RCV020_CAPTURE',
  'RCV020_OBSERVATION_OCCURRENCE',
  'RCV020_RESEARCH_TRIGGER_REQUEST',
  'AUTHENTICATED_OPERATOR_REQUEST',
  'HISTORICAL_CLAIM_IDENTITY'
);

CREATE TYPE public.rcv021_trigger_type AS ENUM (
  'OPERATOR',
  'RCV020_RESEARCH_REQUEST'
);

CREATE TYPE public.rcv021_operation_event_type AS ENUM ('CLOSED');

CREATE TYPE public.rcv021_run_event_type AS ENUM ('STARTED');

CREATE TYPE public.rcv021_run_terminal_outcome AS ENUM (
  'SUCCESS_WITH_RESULTS',
  'SUCCESS_NO_RESULTS',
  'FAILED',
  'TIMED_OUT'
);

CREATE TYPE public.rcv021_attempt_terminal_outcome AS ENUM (
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE public.research_operations (
  operation_id UUID PRIMARY KEY,
  subject_binding_id UUID NOT NULL,
  trigger_binding_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  scope_canonical TEXT NOT NULL,
  operation_created_at TIMESTAMPTZ NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT chk_rcv021_operation_purpose CHECK (char_length(purpose) > 0),
  CONSTRAINT chk_rcv021_operation_scope CHECK (char_length(scope_canonical) > 0),
  CONSTRAINT chk_rcv021_operation_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_operation_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_operation_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.research_operation_subject_bindings (
  subject_binding_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  subject_type public.rcv021_subject_type NOT NULL,
  capture_id UUID,
  observation_occurrence_id UUID,
  research_trigger_request_id UUID,
  operator_request_id UUID,
  historical_claim_id UUID,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_subject_operation
    FOREIGN KEY (operation_id) REFERENCES public.research_operations (operation_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_rcv021_subject_capture
    FOREIGN KEY (capture_id) REFERENCES public.rcv020_captures (capture_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv021_subject_occurrence
    FOREIGN KEY (observation_occurrence_id)
    REFERENCES public.rcv020_observation_occurrences (occurrence_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv021_subject_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_subject_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_subject_hash CHECK (octet_length(canonical_hash) = 32),
  CONSTRAINT chk_rcv021_subject_exactly_one_reference
    CHECK (num_nonnulls(capture_id, observation_occurrence_id,
                        research_trigger_request_id, operator_request_id,
                        historical_claim_id) = 1),
  CONSTRAINT chk_rcv021_subject_discriminator_reference CHECK (
    (subject_type = 'RCV020_CAPTURE' AND capture_id IS NOT NULL
      AND observation_occurrence_id IS NULL AND research_trigger_request_id IS NULL
      AND operator_request_id IS NULL AND historical_claim_id IS NULL)
    OR
    (subject_type = 'RCV020_OBSERVATION_OCCURRENCE' AND observation_occurrence_id IS NOT NULL
      AND capture_id IS NULL AND research_trigger_request_id IS NULL
      AND operator_request_id IS NULL AND historical_claim_id IS NULL)
    OR
    (subject_type = 'RCV020_RESEARCH_TRIGGER_REQUEST' AND research_trigger_request_id IS NOT NULL
      AND capture_id IS NULL AND observation_occurrence_id IS NULL
      AND operator_request_id IS NULL AND historical_claim_id IS NULL)
    OR
    (subject_type = 'AUTHENTICATED_OPERATOR_REQUEST' AND operator_request_id IS NOT NULL
      AND capture_id IS NULL AND observation_occurrence_id IS NULL
      AND research_trigger_request_id IS NULL AND historical_claim_id IS NULL)
    OR
    (subject_type = 'HISTORICAL_CLAIM_IDENTITY' AND historical_claim_id IS NOT NULL
      AND capture_id IS NULL AND observation_occurrence_id IS NULL
      AND research_trigger_request_id IS NULL AND operator_request_id IS NULL)
  )
);

CREATE TABLE public.research_operation_trigger_bindings (
  trigger_binding_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  trigger_type public.rcv021_trigger_type NOT NULL,
  initiator_identity TEXT,
  authorization_canonical TEXT,
  execution_owner TEXT,
  trigger_request_id UUID,
  originating_capture_id UUID,
  originating_occurrence_id UUID,
  rule_identity TEXT,
  rule_version INTEGER,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_trigger_operation
    FOREIGN KEY (operation_id) REFERENCES public.research_operations (operation_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_rcv021_trigger_capture
    FOREIGN KEY (originating_capture_id) REFERENCES public.rcv020_captures (capture_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv021_trigger_occurrence
    FOREIGN KEY (originating_occurrence_id)
    REFERENCES public.rcv020_observation_occurrences (occurrence_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv021_trigger_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_trigger_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_trigger_hash CHECK (octet_length(canonical_hash) = 32),
  CONSTRAINT chk_rcv021_trigger_origin_xor
    CHECK (num_nonnulls(originating_capture_id, originating_occurrence_id) <= 1),
  CONSTRAINT chk_rcv021_trigger_fields CHECK (
    (trigger_type = 'OPERATOR'
      AND initiator_identity IS NOT NULL AND char_length(initiator_identity) > 0
      AND authorization_canonical IS NOT NULL AND char_length(authorization_canonical) > 0
      AND execution_owner IS NOT NULL AND char_length(execution_owner) > 0
      AND trigger_request_id IS NULL
      AND originating_capture_id IS NULL
      AND originating_occurrence_id IS NULL
      AND rule_identity IS NULL
      AND rule_version IS NULL)
    OR
    (trigger_type = 'RCV020_RESEARCH_REQUEST'
      AND execution_owner IS NOT NULL AND char_length(execution_owner) > 0
      AND trigger_request_id IS NOT NULL
      AND rule_identity IS NOT NULL AND char_length(rule_identity) > 0
      AND rule_version IS NOT NULL AND rule_version >= 1
      AND initiator_identity IS NULL
      AND authorization_canonical IS NULL)
  )
);

CREATE TABLE public.research_operation_lifecycle_events (
  event_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL,
  event_type public.rcv021_operation_event_type NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  actor_identity TEXT NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_operation_event_operation
    FOREIGN KEY (operation_id) REFERENCES public.research_operations (operation_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT uq_rcv021_operation_event_type UNIQUE (operation_id, event_type),
  CONSTRAINT chk_rcv021_operation_event_actor CHECK (char_length(actor_identity) > 0),
  CONSTRAINT chk_rcv021_operation_event_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_operation_event_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_operation_event_hash CHECK (octet_length(canonical_hash) = 32)
);

ALTER TABLE public.research_operations
  ADD CONSTRAINT fk_rcv021_operation_subject
    FOREIGN KEY (subject_binding_id)
    REFERENCES public.research_operation_subject_bindings (subject_binding_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT fk_rcv021_operation_trigger
    FOREIGN KEY (trigger_binding_id)
    REFERENCES public.research_operation_trigger_bindings (trigger_binding_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.research_runs (
  run_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL,
  strategy_identity TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  provider_identity TEXT NOT NULL,
  adapter_identity TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  execution_parameters_canonical TEXT NOT NULL,
  run_created_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  predecessor_run_id UUID,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_run_operation
    FOREIGN KEY (operation_id) REFERENCES public.research_operations (operation_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv021_run_predecessor
    FOREIGN KEY (predecessor_run_id) REFERENCES public.research_runs (run_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv021_run_strategy CHECK (char_length(strategy_identity) > 0),
  CONSTRAINT chk_rcv021_run_strategy_version CHECK (strategy_version >= 1),
  CONSTRAINT chk_rcv021_run_provider CHECK (char_length(provider_identity) > 0),
  CONSTRAINT chk_rcv021_run_adapter CHECK (char_length(adapter_identity) > 0
                                            AND char_length(adapter_version) > 0),
  CONSTRAINT chk_rcv021_run_execution_parameters CHECK (char_length(execution_parameters_canonical) > 0),
  CONSTRAINT chk_rcv021_run_deadline CHECK (deadline_at >= run_created_at),
  CONSTRAINT chk_rcv021_run_predecessor CHECK (predecessor_run_id IS NULL OR predecessor_run_id <> run_id),
  CONSTRAINT chk_rcv021_run_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_run_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_run_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.research_run_lifecycle_events (
  event_id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  event_type public.rcv021_run_event_type NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  execution_authority TEXT NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_run_event_run
    FOREIGN KEY (run_id) REFERENCES public.research_runs (run_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT uq_rcv021_run_event_type UNIQUE (run_id, event_type),
  CONSTRAINT chk_rcv021_run_event_authority CHECK (char_length(execution_authority) > 0),
  CONSTRAINT chk_rcv021_run_event_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_run_event_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_run_event_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.research_run_terminal_resolutions (
  resolution_id UUID PRIMARY KEY,
  run_id UUID NOT NULL UNIQUE,
  outcome public.rcv021_run_terminal_outcome NOT NULL,
  terminal_at TIMESTAMPTZ NOT NULL,
  completion_authority TEXT NOT NULL,
  result_manifest_canonical TEXT NOT NULL,
  result_manifest_hash BYTEA NOT NULL,
  result_count BIGINT NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_terminal_run
    FOREIGN KEY (run_id) REFERENCES public.research_runs (run_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv021_terminal_authority CHECK (char_length(completion_authority) > 0),
  CONSTRAINT chk_rcv021_terminal_count CHECK (result_count >= 0),
  CONSTRAINT chk_rcv021_terminal_manifest CHECK (char_length(result_manifest_canonical) > 0),
  CONSTRAINT chk_rcv021_terminal_manifest_hash CHECK (octet_length(result_manifest_hash) = 32),
  CONSTRAINT chk_rcv021_terminal_outcome_shape CHECK (
    (outcome = 'SUCCESS_NO_RESULTS' AND result_count = 0 AND result_manifest_canonical = '[]')
    OR (outcome = 'SUCCESS_WITH_RESULTS' AND result_count > 0)
    OR outcome IN ('FAILED', 'TIMED_OUT')
  ),
  CONSTRAINT chk_rcv021_terminal_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_terminal_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_terminal_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.research_attempts (
  attempt_id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  attempt_number BIGINT NOT NULL,
  predecessor_attempt_id UUID,
  started_at TIMESTAMPTZ NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_attempt_run
    FOREIGN KEY (run_id) REFERENCES public.research_runs (run_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv021_attempt_predecessor
    FOREIGN KEY (predecessor_attempt_id, run_id)
    REFERENCES public.research_attempts (attempt_id, run_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT uq_rcv021_attempt_run_number UNIQUE (run_id, attempt_number),
  CONSTRAINT uq_rcv021_attempt_id_run UNIQUE (attempt_id, run_id),
  CONSTRAINT chk_rcv021_attempt_number CHECK (attempt_number >= 1),
  CONSTRAINT chk_rcv021_attempt_predecessor CHECK (predecessor_attempt_id IS NULL OR predecessor_attempt_id <> attempt_id),
  CONSTRAINT chk_rcv021_attempt_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_attempt_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_attempt_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.research_attempt_resolutions (
  resolution_id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL UNIQUE,
  outcome public.rcv021_attempt_terminal_outcome NOT NULL,
  terminal_at TIMESTAMPTZ NOT NULL,
  failure_authority TEXT,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_attempt_resolution_attempt
    FOREIGN KEY (attempt_id) REFERENCES public.research_attempts (attempt_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv021_attempt_resolution_failure CHECK (
    (outcome = 'FAILED' AND (failure_authority IS NULL OR char_length(failure_authority) > 0))
    OR (outcome = 'SUCCEEDED' AND failure_authority IS NULL)
  ),
  CONSTRAINT chk_rcv021_attempt_resolution_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_attempt_resolution_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_attempt_resolution_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.research_provider_results (
  result_id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  provider_item_identity TEXT NOT NULL,
  provider_envelope_canonical TEXT NOT NULL,
  provider_identity TEXT NOT NULL,
  adapter_identity TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  result_observed_at TIMESTAMPTZ NOT NULL,
  provider_source_time TIMESTAMPTZ,
  protocol_result_status TEXT NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_provider_result_run
    FOREIGN KEY (run_id) REFERENCES public.research_runs (run_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv021_provider_item CHECK (char_length(provider_item_identity) > 0),
  CONSTRAINT chk_rcv021_provider_envelope CHECK (char_length(provider_envelope_canonical) > 0),
  CONSTRAINT chk_rcv021_provider_identity CHECK (char_length(provider_identity) > 0),
  CONSTRAINT chk_rcv021_provider_adapter CHECK (char_length(adapter_identity) > 0
                                                AND char_length(adapter_version) > 0),
  CONSTRAINT chk_rcv021_provider_status CHECK (char_length(protocol_result_status) > 0),
  CONSTRAINT chk_rcv021_provider_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_provider_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_provider_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.research_result_selections (
  selection_id UUID PRIMARY KEY,
  provider_result_id UUID NOT NULL,
  selection_authorization TEXT NOT NULL,
  selected_artifact_identity TEXT NOT NULL,
  observation_occurrence_id UUID NOT NULL UNIQUE,
  selected_at TIMESTAMPTZ NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv021_selection_provider_result
    FOREIGN KEY (provider_result_id) REFERENCES public.research_provider_results (result_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv021_selection_authorization CHECK (char_length(selection_authorization) > 0),
  CONSTRAINT chk_rcv021_selection_artifact CHECK (char_length(selected_artifact_identity) > 0),
  CONSTRAINT chk_rcv021_selection_version CHECK (canonical_version = 1),
  CONSTRAINT chk_rcv021_selection_canonical CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_rcv021_selection_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE INDEX idx_rcv021_operation_created
  ON public.research_operations (operation_created_at, operation_id);
CREATE INDEX idx_rcv021_subject_capture
  ON public.research_operation_subject_bindings (capture_id)
  WHERE capture_id IS NOT NULL;
CREATE INDEX idx_rcv021_subject_occurrence
  ON public.research_operation_subject_bindings (observation_occurrence_id)
  WHERE observation_occurrence_id IS NOT NULL;
CREATE INDEX idx_rcv021_subject_trigger_request
  ON public.research_operation_subject_bindings (research_trigger_request_id)
  WHERE research_trigger_request_id IS NOT NULL;
CREATE INDEX idx_rcv021_subject_operator_request
  ON public.research_operation_subject_bindings (operator_request_id)
  WHERE operator_request_id IS NOT NULL;
CREATE INDEX idx_rcv021_subject_claim
  ON public.research_operation_subject_bindings (historical_claim_id)
  WHERE historical_claim_id IS NOT NULL;
CREATE INDEX idx_rcv021_trigger_type
  ON public.research_operation_trigger_bindings (trigger_type);
CREATE INDEX idx_rcv021_operation_event_time
  ON public.research_operation_lifecycle_events (operation_id, event_at, event_id);
CREATE INDEX idx_rcv021_run_identity_time
  ON public.research_runs (operation_id, run_created_at, run_id);
CREATE INDEX idx_rcv021_run_predecessor
  ON public.research_runs (predecessor_run_id)
  WHERE predecessor_run_id IS NOT NULL;
CREATE INDEX idx_rcv021_run_event_time
  ON public.research_run_lifecycle_events (run_id, event_at, event_id);
CREATE INDEX idx_rcv021_terminal_run_time
  ON public.research_run_terminal_resolutions (run_id, terminal_at);
CREATE INDEX idx_rcv021_attempt_run_time
  ON public.research_attempts (run_id, started_at, attempt_id);
CREATE INDEX idx_rcv021_attempt_resolution_time
  ON public.research_attempt_resolutions (attempt_id, terminal_at);
CREATE INDEX idx_rcv021_provider_run_time
  ON public.research_provider_results (run_id, result_observed_at, result_id);
CREATE INDEX idx_rcv021_provider_item
  ON public.research_provider_results (provider_item_identity);
CREATE INDEX idx_rcv021_selection_provider
  ON public.research_result_selections (provider_result_id);
CREATE INDEX idx_rcv021_selection_time
  ON public.research_result_selections (selected_at, selection_id);

CREATE OR REPLACE FUNCTION public.rcv021_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'RCV-021 authoritative history is append-only: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'research_operations',
    'research_operation_subject_bindings',
    'research_operation_trigger_bindings',
    'research_operation_lifecycle_events',
    'research_runs',
    'research_run_lifecycle_events',
    'research_run_terminal_resolutions',
    'research_attempts',
    'research_attempt_resolutions',
    'research_provider_results',
    'research_result_selections'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rcv021_guard_immutable()',
      'trg_rcv021_immutable_' || table_name, table_name
    );
  END LOOP;
END;
$$;

COMMIT;
