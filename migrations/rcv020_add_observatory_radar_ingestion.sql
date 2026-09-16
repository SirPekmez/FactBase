-- RCV-020 Observatory / Radar / Ingestion Authority V1.
-- Additive migration; apply only after rcv019_add_temporal_evidence_evolution.sql.

BEGIN;

CREATE TYPE public.rcv020_trigger_origin AS ENUM ('SCHEDULED', 'EXTERNAL', 'OPERATOR');
CREATE TYPE public.rcv020_occurrence_outcome AS ENUM ('SUCCEEDED', 'FAILED', 'MISSED', 'SKIPPED');
CREATE TYPE public.rcv020_attempt_outcome AS ENUM (
  'CAPTURED_CHANGED', 'CAPTURED_UNCHANGED', 'CAPTURED_EMPTY', 'FAILED'
);
CREATE TYPE public.rcv020_lifecycle_event_type AS ENUM (
  'ACTIVATED', 'RETIRED', 'PAUSED', 'RESUMED'
);
CREATE TYPE public.rcv020_failure_code AS ENUM (
  'DNS_FAILURE', 'CONNECTION_FAILURE', 'TIMEOUT', 'HTTP_FAILURE',
  'AUTHENTICATION_FAILURE', 'RATE_LIMITED', 'UNSAFE_REDIRECT',
  'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA', 'MALFORMED_RESPONSE',
  'PARSER_FAILURE', 'CAPTURE_INTEGRITY_FAILURE', 'SOURCE_REMOVED',
  'ACCESS_RESTRICTED', 'CONFIGURATION_ERROR', 'INTERNAL_ERROR',
  'OTHER_UNCLASSIFIED'
);
CREATE TYPE public.rcv020_retention_event_type AS ENUM (
  'DELETED', 'EXPIRED', 'RESTRICTED', 'LOST', 'AVAILABILITY_CHANGED'
);
CREATE TYPE public.rcv020_comparison_result AS ENUM ('FIRST_OBSERVED', 'CHANGED', 'UNCHANGED');

CREATE TABLE public.rcv020_logical_sources (
  logical_source_id UUID PRIMARY KEY,
  organization_identity TEXT NOT NULL,
  source_class TEXT NOT NULL,
  jurisdiction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  identity_canonical JSONB NOT NULL,
  identity_hash BYTEA NOT NULL,
  CONSTRAINT chk_rcv020_logical_source_identity
    CHECK (char_length(organization_identity) > 0 AND char_length(source_class) > 0),
  CONSTRAINT chk_rcv020_logical_source_hash
    CHECK (octet_length(identity_hash) = 32),
  CONSTRAINT uq_rcv020_logical_source_identity_hash UNIQUE (identity_hash)
);

CREATE TABLE public.rcv020_monitors (
  monitor_id UUID PRIMARY KEY,
  logical_source_id UUID NOT NULL,
  monitor_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  identity_canonical JSONB NOT NULL,
  identity_hash BYTEA NOT NULL,
  CONSTRAINT fk_rcv020_monitor_source
    FOREIGN KEY (logical_source_id) REFERENCES public.rcv020_logical_sources (logical_source_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_monitor_kind CHECK (char_length(monitor_kind) > 0),
  CONSTRAINT chk_rcv020_monitor_hash CHECK (octet_length(identity_hash) = 32),
  CONSTRAINT uq_rcv020_monitor_source_pair UNIQUE (monitor_id, logical_source_id),
  CONSTRAINT uq_rcv020_monitor_identity_hash UNIQUE (identity_hash)
);

CREATE TABLE public.rcv020_monitor_configuration_versions (
  monitor_configuration_version_id UUID PRIMARY KEY,
  monitor_id UUID NOT NULL,
  version_number BIGINT NOT NULL,
  endpoint_request_canonical TEXT NOT NULL,
  endpoint_request_hash TEXT NOT NULL,
  retrieval_method TEXT NOT NULL,
  authentication_reference TEXT,
  expected_media_constraints TEXT NOT NULL,
  trigger_eligibility TEXT NOT NULL,
  scope_canonical TEXT NOT NULL,
  safety_policy_canonical TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  parser_id TEXT,
  parser_version TEXT,
  retention_policy TEXT NOT NULL,
  retention_policy_version INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  canonical JSONB NOT NULL,
  canonical_hash BYTEA NOT NULL,
  CONSTRAINT fk_rcv020_config_monitor
    FOREIGN KEY (monitor_id) REFERENCES public.rcv020_monitors (monitor_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_config_version_number CHECK (version_number >= 1),
  CONSTRAINT chk_rcv020_config_effective_interval
    CHECK (effective_until IS NULL OR effective_from < effective_until),
  CONSTRAINT chk_rcv020_config_retention
    CHECK (retention_policy IN ('PERMANENT_RAW', 'TEMPORARY_RAW', 'METADATA_HASH_ONLY')),
  CONSTRAINT chk_rcv020_config_retention_version CHECK (retention_policy_version >= 1),
  CONSTRAINT chk_rcv020_config_hashes
    CHECK (
      endpoint_request_hash ~ '^[0-9a-f]{64}$' AND
      octet_length(canonical_hash) = 32 AND
      char_length(retrieval_method) > 0 AND char_length(adapter_id) > 0 AND
      char_length(adapter_version) > 0
    ),
  CONSTRAINT uq_rcv020_config_monitor_version UNIQUE (monitor_id, version_number),
  CONSTRAINT uq_rcv020_config_id_monitor UNIQUE (monitor_configuration_version_id, monitor_id)
);

CREATE TABLE public.rcv020_configuration_lifecycle_events (
  event_id UUID PRIMARY KEY,
  monitor_configuration_version_id UUID NOT NULL,
  event_type public.rcv020_lifecycle_event_type NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  actor_policy_identity TEXT NOT NULL,
  reason TEXT,
  event_sequence BIGINT NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv020_lifecycle_config
    FOREIGN KEY (monitor_configuration_version_id)
    REFERENCES public.rcv020_monitor_configuration_versions (monitor_configuration_version_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_lifecycle_sequence CHECK (event_sequence >= 1),
  CONSTRAINT chk_rcv020_lifecycle_actor CHECK (char_length(actor_policy_identity) > 0),
  CONSTRAINT chk_rcv020_lifecycle_hash CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uq_rcv020_lifecycle_config_sequence
    UNIQUE (monitor_configuration_version_id, event_sequence)
);

CREATE TABLE public.rcv020_observation_occurrences (
  occurrence_id UUID PRIMARY KEY,
  logical_source_id UUID NOT NULL,
  monitor_id UUID NOT NULL,
  monitor_configuration_version_id UUID NOT NULL,
  trigger_origin public.rcv020_trigger_origin NOT NULL,
  trigger_canonical TEXT NOT NULL,
  trigger_hash TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  trigger_received_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  evaluation_policy_version INTEGER NOT NULL,
  evaluation_cutoff_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  CONSTRAINT fk_rcv020_occurrence_source
    FOREIGN KEY (logical_source_id) REFERENCES public.rcv020_logical_sources (logical_source_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_occurrence_monitor
    FOREIGN KEY (monitor_id, logical_source_id)
    REFERENCES public.rcv020_monitors (monitor_id, logical_source_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_occurrence_config
    FOREIGN KEY (monitor_configuration_version_id, monitor_id)
    REFERENCES public.rcv020_monitor_configuration_versions
      (monitor_configuration_version_id, monitor_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_occurrence_trigger_hash CHECK (trigger_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_rcv020_occurrence_policy_version CHECK (evaluation_policy_version >= 1),
  CONSTRAINT chk_rcv020_occurrence_trigger_time_shape CHECK (
    (trigger_origin = 'SCHEDULED' AND scheduled_at IS NOT NULL) OR
    (trigger_origin = 'EXTERNAL' AND trigger_received_at IS NOT NULL) OR
    (trigger_origin = 'OPERATOR' AND requested_at IS NOT NULL)
  ),
  CONSTRAINT chk_rcv020_occurrence_hash CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uq_rcv020_occurrence_config_pair
    UNIQUE (occurrence_id, monitor_configuration_version_id)
);

CREATE TABLE public.rcv020_observation_occurrence_resolutions (
  resolution_id UUID PRIMARY KEY,
  occurrence_id UUID NOT NULL UNIQUE,
  outcome public.rcv020_occurrence_outcome NOT NULL,
  evaluation_cutoff_at TIMESTAMPTZ NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL,
  skip_reason TEXT,
  skip_actor_policy_identity TEXT,
  terminalization_policy_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv020_occurrence_resolution
    FOREIGN KEY (occurrence_id) REFERENCES public.rcv020_observation_occurrences (occurrence_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_occurrence_resolution_times
    CHECK (evaluated_at >= evaluation_cutoff_at),
  CONSTRAINT chk_rcv020_occurrence_resolution_skip
    CHECK (
      (outcome = 'SKIPPED' AND char_length(coalesce(skip_reason, '')) > 0 AND
       char_length(coalesce(skip_actor_policy_identity, '')) > 0) OR
      (outcome <> 'SKIPPED' AND skip_reason IS NULL AND skip_actor_policy_identity IS NULL)
    ),
  CONSTRAINT chk_rcv020_occurrence_resolution_policy CHECK (terminalization_policy_version >= 1),
  CONSTRAINT chk_rcv020_occurrence_resolution_hash CHECK (canonical_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv020_retrieval_attempts (
  attempt_id UUID PRIMARY KEY,
  occurrence_id UUID NOT NULL,
  previous_attempt_id UUID,
  retry_number BIGINT NOT NULL,
  retrieval_started_at TIMESTAMPTZ NOT NULL,
  attempt_deadline_at TIMESTAMPTZ NOT NULL,
  adapter_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  request_canonical TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  CONSTRAINT fk_rcv020_attempt_occurrence
    FOREIGN KEY (occurrence_id) REFERENCES public.rcv020_observation_occurrences (occurrence_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_attempt_previous
    FOREIGN KEY (previous_attempt_id) REFERENCES public.rcv020_retrieval_attempts (attempt_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_attempt_retry_number CHECK (retry_number >= 1),
  CONSTRAINT chk_rcv020_attempt_deadline CHECK (attempt_deadline_at >= retrieval_started_at),
  CONSTRAINT chk_rcv020_attempt_hashes
    CHECK (request_hash ~ '^[0-9a-f]{64}$' AND canonical_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_rcv020_attempt_adapter CHECK (char_length(adapter_id) > 0 AND char_length(adapter_version) > 0),
  CONSTRAINT uq_rcv020_attempt_occurrence_retry UNIQUE (occurrence_id, retry_number),
  CONSTRAINT uq_rcv020_attempt_occurrence_pair UNIQUE (attempt_id, occurrence_id)
);

CREATE TABLE public.rcv020_retrieval_attempt_resolutions (
  attempt_resolution_id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL UNIQUE,
  retrieval_completed_at TIMESTAMPTZ NOT NULL,
  outcome public.rcv020_attempt_outcome NOT NULL,
  failure_taxonomy_version INTEGER,
  failure_code public.rcv020_failure_code,
  diagnostic_canonical TEXT,
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv020_attempt_resolution
    FOREIGN KEY (attempt_id) REFERENCES public.rcv020_retrieval_attempts (attempt_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_attempt_resolution_failure
    CHECK (
      (outcome = 'FAILED' AND failure_taxonomy_version >= 1 AND failure_code IS NOT NULL) OR
      (outcome <> 'FAILED' AND failure_taxonomy_version IS NULL AND failure_code IS NULL)
    ),
  CONSTRAINT chk_rcv020_attempt_resolution_hash CHECK (canonical_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv020_captures (
  capture_id UUID PRIMARY KEY,
  logical_source_id UUID NOT NULL,
  monitor_id UUID NOT NULL,
  monitor_configuration_version_id UUID NOT NULL,
  occurrence_id UUID NOT NULL,
  retrieval_attempt_id UUID NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  requested_target TEXT NOT NULL,
  final_url TEXT,
  redirect_canonical TEXT,
  response_status INTEGER NOT NULL,
  response_metadata_canonical TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_length NUMERIC NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL,
  canonical TEXT NOT NULL,
  capture_hash TEXT NOT NULL,
  retention_policy TEXT NOT NULL,
  retention_policy_version INTEGER NOT NULL,
  raw_object_identity TEXT,
  raw_object_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv020_capture_source
    FOREIGN KEY (logical_source_id) REFERENCES public.rcv020_logical_sources (logical_source_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_capture_monitor
    FOREIGN KEY (monitor_id, logical_source_id)
    REFERENCES public.rcv020_monitors (monitor_id, logical_source_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_capture_config
    FOREIGN KEY (monitor_configuration_version_id, monitor_id)
    REFERENCES public.rcv020_monitor_configuration_versions
      (monitor_configuration_version_id, monitor_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_capture_occurrence
    FOREIGN KEY (occurrence_id) REFERENCES public.rcv020_observation_occurrences (occurrence_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_capture_attempt
    FOREIGN KEY (retrieval_attempt_id, occurrence_id)
    REFERENCES public.rcv020_retrieval_attempts (attempt_id, occurrence_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_capture_request_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_rcv020_capture_byte_length CHECK (byte_length >= 0),
  CONSTRAINT chk_rcv020_capture_hashes
    CHECK (content_hash ~ '^[0-9a-f]{64}$' AND capture_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_rcv020_capture_retention
    CHECK (retention_policy IN ('PERMANENT_RAW', 'TEMPORARY_RAW', 'METADATA_HASH_ONLY')),
  CONSTRAINT chk_rcv020_capture_retention_version CHECK (retention_policy_version >= 1),
  CONSTRAINT chk_rcv020_capture_raw_reference
    CHECK ((retention_policy = 'METADATA_HASH_ONLY') OR
           (raw_object_identity IS NOT NULL AND raw_object_reference IS NOT NULL))
);

CREATE TABLE public.rcv020_capture_comparisons (
  comparison_id UUID PRIMARY KEY,
  current_capture_id UUID NOT NULL,
  prior_capture_id UUID,
  comparison_algorithm_id TEXT NOT NULL,
  comparison_algorithm_version INTEGER NOT NULL,
  input_canonical TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result public.rcv020_comparison_result NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv020_comparison_current
    FOREIGN KEY (current_capture_id) REFERENCES public.rcv020_captures (capture_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_comparison_prior
    FOREIGN KEY (prior_capture_id) REFERENCES public.rcv020_captures (capture_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_comparison_ids
    CHECK (prior_capture_id IS NULL OR prior_capture_id <> current_capture_id),
  CONSTRAINT chk_rcv020_comparison_algorithm CHECK (comparison_algorithm_version >= 1),
  CONSTRAINT chk_rcv020_comparison_hashes
    CHECK (input_hash ~ '^[0-9a-f]{64}$' AND canonical_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uq_rcv020_comparison_current_algorithm
    UNIQUE (current_capture_id, comparison_algorithm_id, comparison_algorithm_version)
);

CREATE TABLE public.rcv020_quarantined_payloads (
  quarantine_id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL,
  reason public.rcv020_failure_code NOT NULL,
  policy_canonical TEXT NOT NULL,
  object_identity TEXT,
  payload_hash TEXT,
  byte_length NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv020_quarantine_attempt
    FOREIGN KEY (attempt_id) REFERENCES public.rcv020_retrieval_attempts (attempt_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_quarantine_hash
    CHECK (payload_hash IS NULL OR payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_rcv020_quarantine_length CHECK (byte_length IS NULL OR byte_length >= 0)
);

CREATE TABLE public.rcv020_retention_availability_events (
  event_id UUID PRIMARY KEY,
  capture_id UUID NOT NULL,
  event_type public.rcv020_retention_event_type NOT NULL,
  reason TEXT NOT NULL,
  policy_legal_basis TEXT,
  event_at TIMESTAMPTZ NOT NULL,
  resulting_availability TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv020_retention_capture
    FOREIGN KEY (capture_id) REFERENCES public.rcv020_captures (capture_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_retention_sequence CHECK (event_sequence >= 1),
  CONSTRAINT chk_rcv020_retention_reason CHECK (char_length(reason) > 0),
  CONSTRAINT chk_rcv020_retention_hash CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uq_rcv020_retention_capture_sequence UNIQUE (capture_id, event_sequence)
);

CREATE TABLE public.rcv020_authenticated_handoffs (
  handoff_id UUID PRIMARY KEY,
  capture_id UUID NOT NULL,
  logical_source_id UUID NOT NULL,
  monitor_id UUID NOT NULL,
  monitor_configuration_version_id UUID NOT NULL,
  occurrence_id UUID NOT NULL,
  retrieval_attempt_id UUID NOT NULL,
  capture_hash TEXT NOT NULL,
  raw_object_identity TEXT,
  raw_availability_snapshot TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source_published_at TIMESTAMPTZ,
  source_artifact_identity TEXT,
  derived_extraction_reference TEXT,
  derived_extraction_version TEXT,
  derived_extraction_hash TEXT,
  provenance_manifest TEXT NOT NULL,
  handoff_canonical TEXT NOT NULL,
  handoff_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_rcv020_handoff_capture
    FOREIGN KEY (capture_id) REFERENCES public.rcv020_captures (capture_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_handoff_source
    FOREIGN KEY (logical_source_id) REFERENCES public.rcv020_logical_sources (logical_source_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_handoff_monitor
    FOREIGN KEY (monitor_id, logical_source_id)
    REFERENCES public.rcv020_monitors (monitor_id, logical_source_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_handoff_config
    FOREIGN KEY (monitor_configuration_version_id, monitor_id)
    REFERENCES public.rcv020_monitor_configuration_versions
      (monitor_configuration_version_id, monitor_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_handoff_occurrence
    FOREIGN KEY (occurrence_id) REFERENCES public.rcv020_observation_occurrences (occurrence_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv020_handoff_attempt
    FOREIGN KEY (retrieval_attempt_id, occurrence_id)
    REFERENCES public.rcv020_retrieval_attempts (attempt_id, occurrence_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv020_handoff_hashes
    CHECK (capture_hash ~ '^[0-9a-f]{64}$' AND handoff_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_rcv020_handoff_idempotency CHECK (char_length(idempotency_key) > 0),
  CONSTRAINT uq_rcv020_handoff_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_rcv020_monitors_source ON public.rcv020_monitors (logical_source_id);
CREATE INDEX idx_rcv020_configs_monitor_effective
  ON public.rcv020_monitor_configuration_versions (monitor_id, effective_from);
CREATE INDEX idx_rcv020_lifecycle_config_time
  ON public.rcv020_configuration_lifecycle_events
    (monitor_configuration_version_id, event_at, event_sequence);
CREATE INDEX idx_rcv020_occurrences_scope_time
  ON public.rcv020_observation_occurrences
    (logical_source_id, monitor_id, monitor_configuration_version_id, due_at);
CREATE INDEX idx_rcv020_attempts_occurrence_time
  ON public.rcv020_retrieval_attempts (occurrence_id, retrieval_started_at);
CREATE INDEX idx_rcv020_attempt_resolutions_outcome
  ON public.rcv020_retrieval_attempt_resolutions (outcome, retrieval_completed_at);
CREATE INDEX idx_rcv020_captures_monitor_observed
  ON public.rcv020_captures (monitor_id, observed_at);
CREATE INDEX idx_rcv020_captures_content_hash
  ON public.rcv020_captures (content_hash);
CREATE INDEX idx_rcv020_comparisons_prior
  ON public.rcv020_capture_comparisons (prior_capture_id);
CREATE INDEX idx_rcv020_quarantine_attempt
  ON public.rcv020_quarantined_payloads (attempt_id, created_at);
CREATE INDEX idx_rcv020_retention_capture_time
  ON public.rcv020_retention_availability_events (capture_id, event_at, event_sequence);
CREATE INDEX idx_rcv020_handoffs_capture
  ON public.rcv020_authenticated_handoffs (capture_id, created_at);

CREATE OR REPLACE FUNCTION public.rcv020_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'RCV-020 authoritative history is append-only: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv020_validate_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  e RECORD;
  state TEXT := 'NOT_ACTIVATED';
  prior_at TIMESTAMPTZ := NULL;
  cfg RECORD;
BEGIN
  SELECT * INTO cfg
    FROM public.rcv020_monitor_configuration_versions
   WHERE monitor_configuration_version_id = NEW.monitor_configuration_version_id;
  FOR e IN
    SELECT event_type, event_at, event_sequence
      FROM public.rcv020_configuration_lifecycle_events
     WHERE monitor_configuration_version_id = NEW.monitor_configuration_version_id
     ORDER BY event_at, event_sequence, event_id
  LOOP
    IF prior_at IS NOT NULL AND e.event_at < prior_at THEN
      RAISE EXCEPTION 'RCV-020 lifecycle event time decreases' USING ERRCODE = '23514';
    END IF;
    prior_at := e.event_at;
    IF e.event_type = 'ACTIVATED' AND state = 'NOT_ACTIVATED' THEN
      state := 'ACTIVE';
    ELSIF e.event_type = 'PAUSED' AND state = 'ACTIVE' THEN
      state := 'PAUSED';
    ELSIF e.event_type = 'RESUMED' AND state = 'PAUSED' THEN
      state := 'ACTIVE';
    ELSIF e.event_type = 'RETIRED' AND (state = 'ACTIVE' OR state = 'PAUSED') THEN
      state := 'RETIRED';
    ELSE
      RAISE EXCEPTION 'RCV-020 invalid lifecycle transition % from %', e.event_type, state
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF cfg.effective_from IS DISTINCT FROM (
    SELECT min(event_at) FROM public.rcv020_configuration_lifecycle_events
     WHERE monitor_configuration_version_id = NEW.monitor_configuration_version_id
       AND event_type = 'ACTIVATED'
  ) THEN
    RAISE EXCEPTION 'RCV-020 activation/effective interval contradiction' USING ERRCODE = '23514';
  END IF;
  IF cfg.effective_until IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rcv020_configuration_lifecycle_events
     WHERE monitor_configuration_version_id = NEW.monitor_configuration_version_id
       AND event_type = 'RETIRED'
  ) AND cfg.effective_until IS DISTINCT FROM (
    SELECT max(event_at) FROM public.rcv020_configuration_lifecycle_events
     WHERE monitor_configuration_version_id = NEW.monitor_configuration_version_id
       AND event_type = 'RETIRED'
  ) THEN
    RAISE EXCEPTION 'RCV-020 retirement/effective interval contradiction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv020_validate_config_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflict_exists BOOLEAN;
  config_id UUID;
  monitor_id_value UUID;
BEGIN
  config_id := CASE WHEN TG_TABLE_NAME = 'rcv020_monitor_configuration_versions'
    THEN NEW.monitor_configuration_version_id
    ELSE NEW.monitor_configuration_version_id END;
  SELECT monitor_id INTO monitor_id_value
    FROM public.rcv020_monitor_configuration_versions
   WHERE monitor_configuration_version_id = config_id;
  SELECT EXISTS (
    SELECT 1
      FROM public.rcv020_monitor_configuration_versions a
      JOIN public.rcv020_monitor_configuration_versions b
        ON b.monitor_id = a.monitor_id
       AND b.monitor_configuration_version_id <> a.monitor_configuration_version_id
       AND a.effective_from < COALESCE(
         (SELECT min(event_at) FROM public.rcv020_configuration_lifecycle_events
           WHERE monitor_configuration_version_id = b.monitor_configuration_version_id
             AND event_type = 'RETIRED'),
         b.effective_until, 'infinity'::timestamptz)
       AND b.effective_from < COALESCE(
         (SELECT min(event_at) FROM public.rcv020_configuration_lifecycle_events
           WHERE monitor_configuration_version_id = a.monitor_configuration_version_id
             AND event_type = 'RETIRED'),
         a.effective_until, 'infinity'::timestamptz)
     WHERE a.monitor_configuration_version_id = config_id
  ) INTO conflict_exists;
  IF conflict_exists THEN
    RAISE EXCEPTION 'RCV-020 overlapping configuration versions for Monitor %', monitor_id_value
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv020_validate_attempt_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_attempt RECORD;
  parent_outcome public.rcv020_attempt_outcome;
  cycle_found BOOLEAN;
BEGIN
  IF NEW.attempt_deadline_at > (
    SELECT evaluation_cutoff_at FROM public.rcv020_observation_occurrences
     WHERE occurrence_id = NEW.occurrence_id
  ) THEN
    RAISE EXCEPTION 'RCV-020 attempt deadline exceeds occurrence cutoff' USING ERRCODE = '23514';
  END IF;
  IF NEW.previous_attempt_id IS NOT NULL THEN
    SELECT a.* INTO parent_attempt
      FROM public.rcv020_retrieval_attempts a
     WHERE a.attempt_id = NEW.previous_attempt_id;
    IF parent_attempt.occurrence_id <> NEW.occurrence_id OR parent_attempt.retry_number + 1 <> NEW.retry_number THEN
      RAISE EXCEPTION 'RCV-020 invalid retry predecessor' USING ERRCODE = '23514';
    END IF;
    SELECT outcome INTO parent_outcome
      FROM public.rcv020_retrieval_attempt_resolutions
     WHERE attempt_id = NEW.previous_attempt_id;
    IF parent_outcome IS DISTINCT FROM 'FAILED'::public.rcv020_attempt_outcome THEN
      RAISE EXCEPTION 'RCV-020 retry predecessor is not terminal FAILED' USING ERRCODE = '23514';
    END IF;
    IF NEW.retrieval_started_at <= (
      SELECT retrieval_completed_at FROM public.rcv020_retrieval_attempt_resolutions
       WHERE attempt_id = NEW.previous_attempt_id
    ) THEN
      RAISE EXCEPTION 'RCV-020 retry starts before predecessor resolution' USING ERRCODE = '23514';
    END IF;
  END IF;
  WITH RECURSIVE chain(attempt_id, previous_attempt_id) AS (
    SELECT attempt_id, previous_attempt_id FROM public.rcv020_retrieval_attempts
     WHERE attempt_id = NEW.attempt_id
    UNION ALL
    SELECT a.attempt_id, a.previous_attempt_id
      FROM public.rcv020_retrieval_attempts a JOIN chain c ON a.attempt_id = c.previous_attempt_id
  )
  SELECT EXISTS (SELECT 1 FROM chain WHERE previous_attempt_id = NEW.attempt_id) INTO cycle_found;
  IF cycle_found THEN
    RAISE EXCEPTION 'RCV-020 retry lineage cycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv020_validate_attempt_capture_parity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  attempt_id_value UUID;
  current_capture_value UUID;
  capture_count BIGINT;
  comparison_count BIGINT;
  comparison_result public.rcv020_comparison_result;
BEGIN
  IF TG_TABLE_NAME = 'rcv020_retrieval_attempt_resolutions' THEN
    attempt_id_value := NEW.attempt_id;
  ELSIF TG_TABLE_NAME = 'rcv020_captures' THEN
    attempt_id_value := NEW.retrieval_attempt_id;
  ELSE
    current_capture_value := NEW.current_capture_id;
    SELECT retrieval_attempt_id INTO attempt_id_value
      FROM public.rcv020_captures WHERE capture_id = current_capture_value;
  END IF;
  FOR r IN
    SELECT ar.attempt_id, ar.outcome
      FROM public.rcv020_retrieval_attempt_resolutions ar
     WHERE ar.attempt_id = attempt_id_value
  LOOP
    SELECT count(*) INTO capture_count
      FROM public.rcv020_captures c WHERE c.retrieval_attempt_id = r.attempt_id;
    IF r.outcome = 'FAILED' AND capture_count <> 0 THEN
      RAISE EXCEPTION 'RCV-020 FAILED attempt has Capture' USING ERRCODE = '23514';
    ELSIF r.outcome <> 'FAILED' AND capture_count <> 1 THEN
      RAISE EXCEPTION 'RCV-020 successful attempt must have exactly one Capture' USING ERRCODE = '23514';
    END IF;
    IF r.outcome = 'CAPTURED_EMPTY' THEN
      SELECT count(*) INTO comparison_count FROM public.rcv020_capture_comparisons
       WHERE current_capture_id = (SELECT capture_id FROM public.rcv020_captures WHERE retrieval_attempt_id = r.attempt_id);
      IF comparison_count <> 0 THEN
        RAISE EXCEPTION 'RCV-020 EMPTY attempt cannot have CaptureComparison' USING ERRCODE = '23514';
      END IF;
    ELSIF r.outcome IN ('CAPTURED_CHANGED', 'CAPTURED_UNCHANGED') THEN
      SELECT count(*) INTO comparison_count
        FROM public.rcv020_capture_comparisons
       WHERE current_capture_id = (SELECT capture_id FROM public.rcv020_captures WHERE retrieval_attempt_id = r.attempt_id);
      SELECT result INTO comparison_result
        FROM public.rcv020_capture_comparisons
       WHERE current_capture_id = (SELECT capture_id FROM public.rcv020_captures WHERE retrieval_attempt_id = r.attempt_id)
       LIMIT 1;
      IF comparison_count <> 1 OR
         (r.outcome = 'CAPTURED_UNCHANGED' AND comparison_result <> 'UNCHANGED') OR
         (r.outcome = 'CAPTURED_CHANGED' AND comparison_result NOT IN ('FIRST_OBSERVED', 'CHANGED')) THEN
        RAISE EXCEPTION 'RCV-020 attempt/comparison parity failure' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv020_validate_occurrence_resolution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempts BIGINT;
  unresolved BIGINT;
  successes BIGINT;
  failures BIGINT;
BEGIN
  SELECT count(*) INTO attempts FROM public.rcv020_retrieval_attempts
   WHERE occurrence_id = NEW.occurrence_id;
  SELECT count(*) INTO unresolved
    FROM public.rcv020_retrieval_attempts a
   WHERE a.occurrence_id = NEW.occurrence_id
     AND NOT EXISTS (SELECT 1 FROM public.rcv020_retrieval_attempt_resolutions r WHERE r.attempt_id = a.attempt_id);
  SELECT count(*) INTO successes
    FROM public.rcv020_retrieval_attempt_resolutions r
    JOIN public.rcv020_retrieval_attempts a ON a.attempt_id = r.attempt_id
   WHERE a.occurrence_id = NEW.occurrence_id AND r.outcome <> 'FAILED';
  SELECT count(*) INTO failures
    FROM public.rcv020_retrieval_attempt_resolutions r
    JOIN public.rcv020_retrieval_attempts a ON a.attempt_id = r.attempt_id
   WHERE a.occurrence_id = NEW.occurrence_id AND r.outcome = 'FAILED';
  IF NEW.outcome IN ('MISSED', 'SKIPPED') AND attempts <> 0 THEN
    RAISE EXCEPTION 'RCV-020 % occurrence has retrieval attempts', NEW.outcome USING ERRCODE = '23514';
  ELSIF NEW.outcome = 'SUCCEEDED' AND successes = 0 THEN
    RAISE EXCEPTION 'RCV-020 SUCCEEDED occurrence lacks successful attempt' USING ERRCODE = '23514';
  ELSIF NEW.outcome = 'FAILED' AND (attempts = 0 OR successes <> 0 OR failures = 0 OR unresolved <> 0) THEN
    RAISE EXCEPTION 'RCV-020 FAILED occurrence resolution parity failure' USING ERRCODE = '23514';
  ELSIF NEW.outcome = 'SUCCEEDED' AND unresolved <> 0 THEN
    RAISE EXCEPTION 'RCV-020 SUCCEEDED occurrence has unresolved attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv020_validate_comparison()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_capture RECORD;
  prior_capture RECORD;
BEGIN
  IF NEW.prior_capture_id IS NULL THEN
    IF NEW.result <> 'FIRST_OBSERVED' THEN
      RAISE EXCEPTION 'RCV-020 non-first comparison requires prior Capture' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT monitor_id, observed_at INTO current_capture
    FROM public.rcv020_captures WHERE capture_id = NEW.current_capture_id;
  SELECT monitor_id, observed_at INTO prior_capture
    FROM public.rcv020_captures WHERE capture_id = NEW.prior_capture_id;
  IF current_capture.monitor_id IS DISTINCT FROM prior_capture.monitor_id THEN
    RAISE EXCEPTION 'RCV-020 comparison crosses Monitors' USING ERRCODE = '23514';
  END IF;
  IF prior_capture.observed_at >= current_capture.observed_at THEN
    RAISE EXCEPTION 'RCV-020 comparison prior Capture is not strictly earlier' USING ERRCODE = '23514';
  END IF;
  IF NEW.result = 'FIRST_OBSERVED' THEN
    RAISE EXCEPTION 'RCV-020 FIRST_OBSERVED cannot reference prior Capture' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_rcv020_lifecycle_validate
AFTER INSERT ON public.rcv020_configuration_lifecycle_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv020_validate_lifecycle();
CREATE CONSTRAINT TRIGGER trg_rcv020_config_overlap
AFTER INSERT ON public.rcv020_monitor_configuration_versions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv020_validate_config_overlap();
CREATE CONSTRAINT TRIGGER trg_rcv020_attempt_lineage
AFTER INSERT ON public.rcv020_retrieval_attempts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv020_validate_attempt_lineage();
CREATE CONSTRAINT TRIGGER trg_rcv020_attempt_capture_parity
AFTER INSERT ON public.rcv020_retrieval_attempt_resolutions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv020_validate_attempt_capture_parity();
CREATE CONSTRAINT TRIGGER trg_rcv020_capture_parity
AFTER INSERT ON public.rcv020_captures
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv020_validate_attempt_capture_parity();
CREATE CONSTRAINT TRIGGER trg_rcv020_comparison_parity
AFTER INSERT ON public.rcv020_capture_comparisons
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv020_validate_attempt_capture_parity();
CREATE CONSTRAINT TRIGGER trg_rcv020_comparison_direction
AFTER INSERT ON public.rcv020_capture_comparisons
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv020_validate_comparison();
CREATE CONSTRAINT TRIGGER trg_rcv020_occurrence_resolution_validate
AFTER INSERT ON public.rcv020_observation_occurrence_resolutions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv020_validate_occurrence_resolution();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'rcv020_logical_sources', 'rcv020_monitors',
    'rcv020_monitor_configuration_versions', 'rcv020_configuration_lifecycle_events',
    'rcv020_observation_occurrences', 'rcv020_observation_occurrence_resolutions',
    'rcv020_retrieval_attempts', 'rcv020_retrieval_attempt_resolutions',
    'rcv020_captures', 'rcv020_capture_comparisons', 'rcv020_quarantined_payloads',
    'rcv020_retention_availability_events', 'rcv020_authenticated_handoffs'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rcv020_guard_immutable()',
      'trg_rcv020_immutable_' || table_name, table_name
    );
  END LOOP;
END;
$$;

COMMIT;
