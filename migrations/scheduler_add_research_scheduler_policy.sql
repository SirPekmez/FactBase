-- FactBase Research Scheduler / Policy V1.
-- Additive migration; apply after rcv021_add_active_research_orchestration.sql.
-- The objects in this migration are Scheduler-owned and do not define RCV-022
-- semantic authority. Cross-row Scheduler semantics remain Writer/Reader
-- authority; this migration enforces only physical row-local invariants.

BEGIN;

CREATE TYPE public.scheduler_decision_value AS ENUM (
  'RUN_NOW',
  'NO_ACTION'
);

CREATE TYPE public.scheduler_decision_reason AS ENUM (
  'INITIAL_ELIGIBILITY',
  'INTERVAL_ELIGIBILITY',
  'ACTIVE_RUN',
  'OPERATION_CLOSED',
  'POLICY_DISABLED',
  'MISSED_SLOT_COALESCED'
);

CREATE TYPE public.scheduler_lifecycle_member_kind AS ENUM (
  'OPERATION_CREATED',
  'OPERATION_LIFECYCLE_EVENT',
  'RUN_CREATED',
  'RUN_LIFECYCLE_EVENT',
  'RUN_TERMINAL_RESOLUTION'
);

CREATE TABLE public.scheduler_policy_streams (
  policy_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fk_scheduler_stream_operation
    FOREIGN KEY (operation_id) REFERENCES public.research_operations (operation_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.scheduler_policy_versions (
  policy_id UUID NOT NULL,
  version BIGINT NOT NULL,
  enabled BOOLEAN NOT NULL,
  effective_at TIMESTAMPTZ(6) NOT NULL,
  first_eligibility_at TIMESTAMPTZ(6) NOT NULL,
  fixed_interval_micros BIGINT NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_scheduler_policy_versions PRIMARY KEY (policy_id, version),
  CONSTRAINT uq_scheduler_policy_versions_effective
    UNIQUE (policy_id, effective_at),
  CONSTRAINT fk_scheduler_policy_version_stream
    FOREIGN KEY (policy_id) REFERENCES public.scheduler_policy_streams (policy_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_scheduler_policy_version_positive CHECK (version >= 1),
  CONSTRAINT chk_scheduler_policy_interval_positive CHECK (fixed_interval_micros > 0),
  CONSTRAINT chk_scheduler_policy_canonical_version CHECK (canonical_version = 1),
  CONSTRAINT chk_scheduler_policy_canonical_nonempty CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_scheduler_policy_canonical_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.scheduler_lifecycle_prefix_manifests (
  manifest_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL,
  policy_id UUID NOT NULL,
  slot_index BIGINT NOT NULL,
  evaluation_at TIMESTAMPTZ(6) NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT uq_scheduler_manifest_decision_identity
    UNIQUE (operation_id, policy_id, slot_index),
  CONSTRAINT fk_scheduler_manifest_operation
    FOREIGN KEY (operation_id) REFERENCES public.research_operations (operation_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_scheduler_manifest_stream
    FOREIGN KEY (policy_id) REFERENCES public.scheduler_policy_streams (policy_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_scheduler_manifest_slot_nonnegative CHECK (slot_index >= 0),
  CONSTRAINT chk_scheduler_manifest_canonical_version CHECK (canonical_version = 1),
  CONSTRAINT chk_scheduler_manifest_canonical_nonempty CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_scheduler_manifest_canonical_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE TABLE public.scheduler_decisions (
  operation_id UUID NOT NULL,
  policy_id UUID NOT NULL,
  slot_index BIGINT NOT NULL,
  policy_version BIGINT NOT NULL,
  policy_version_canonical_hash BYTEA NOT NULL,
  scheduled_at TIMESTAMPTZ(6) NOT NULL,
  evaluation_at TIMESTAMPTZ(6) NOT NULL,
  decision public.scheduler_decision_value NOT NULL,
  reason public.scheduler_decision_reason NOT NULL,
  next_eligible_at TIMESTAMPTZ(6),
  manifest_id UUID NOT NULL,
  operation_manifest_hash BYTEA NOT NULL,
  previous_operation_id UUID,
  previous_policy_id UUID,
  previous_slot_index BIGINT,
  previous_decision_canonical_hash BYTEA,
  active_run_id UUID,
  active_run_creation_identity UUID,
  active_run_creation_hash BYTEA,
  active_run_historical_state TEXT,
  active_run_running_event_identity UUID,
  active_run_running_event_hash BYTEA,
  run_now_binding_identity TEXT,
  run_now_run_id UUID,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_scheduler_decisions PRIMARY KEY (operation_id, policy_id, slot_index),
  CONSTRAINT fk_scheduler_decision_operation
    FOREIGN KEY (operation_id) REFERENCES public.research_operations (operation_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_scheduler_decision_stream
    FOREIGN KEY (policy_id) REFERENCES public.scheduler_policy_streams (policy_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_scheduler_decision_policy_version
    FOREIGN KEY (policy_id, policy_version)
    REFERENCES public.scheduler_policy_versions (policy_id, version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_scheduler_decision_manifest
    FOREIGN KEY (manifest_id) REFERENCES public.scheduler_lifecycle_prefix_manifests (manifest_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_scheduler_decision_slot_nonnegative CHECK (slot_index >= 0),
  CONSTRAINT chk_scheduler_decision_policy_hash CHECK (octet_length(policy_version_canonical_hash) = 32),
  CONSTRAINT chk_scheduler_decision_manifest_hash CHECK (octet_length(operation_manifest_hash) = 32),
  CONSTRAINT chk_scheduler_decision_canonical_version CHECK (canonical_version = 1),
  CONSTRAINT chk_scheduler_decision_canonical_nonempty CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_scheduler_decision_canonical_hash CHECK (octet_length(canonical_hash) = 32),
  CONSTRAINT chk_scheduler_decision_predecessor_shape CHECK (
    (previous_operation_id IS NULL AND previous_policy_id IS NULL
      AND previous_slot_index IS NULL AND previous_decision_canonical_hash IS NULL)
    OR
    (previous_operation_id IS NOT NULL AND previous_policy_id IS NOT NULL
      AND previous_slot_index IS NOT NULL AND previous_decision_canonical_hash IS NOT NULL
      AND octet_length(previous_decision_canonical_hash) = 32)
  ),
  CONSTRAINT chk_scheduler_decision_reason_matrix CHECK (
    (decision = 'NO_ACTION' AND reason IN ('OPERATION_CLOSED', 'POLICY_DISABLED', 'ACTIVE_RUN'))
    OR
    (decision = 'RUN_NOW' AND reason IN ('INITIAL_ELIGIBILITY', 'INTERVAL_ELIGIBILITY', 'MISSED_SLOT_COALESCED'))
  ),
  CONSTRAINT chk_scheduler_decision_next_eligibility CHECK (
    ((reason IN ('OPERATION_CLOSED', 'POLICY_DISABLED')) AND next_eligible_at IS NULL)
    OR
    ((reason NOT IN ('OPERATION_CLOSED', 'POLICY_DISABLED')) AND next_eligible_at IS NOT NULL)
  ),
  CONSTRAINT chk_scheduler_decision_active_run_evidence CHECK (
    (reason <> 'ACTIVE_RUN'
      AND active_run_id IS NULL
      AND active_run_creation_identity IS NULL
      AND active_run_creation_hash IS NULL
      AND active_run_historical_state IS NULL
      AND active_run_running_event_identity IS NULL
      AND active_run_running_event_hash IS NULL)
    OR
    (reason = 'ACTIVE_RUN'
      AND active_run_id IS NOT NULL
      AND active_run_creation_identity IS NOT NULL
      AND active_run_creation_hash IS NOT NULL
      AND octet_length(active_run_creation_hash) = 32
      AND active_run_historical_state IN ('PLANNED', 'RUNNING')
      AND ((active_run_historical_state = 'PLANNED'
        AND active_run_running_event_identity IS NULL
        AND active_run_running_event_hash IS NULL)
        OR (active_run_historical_state = 'RUNNING'
          AND active_run_running_event_identity IS NOT NULL
          AND active_run_running_event_hash IS NOT NULL
          AND octet_length(active_run_running_event_hash) = 32)))
  ),
  CONSTRAINT chk_scheduler_decision_run_now_binding_evidence CHECK (
    (decision = 'RUN_NOW'
      AND run_now_binding_identity IS NOT NULL
      AND char_length(run_now_binding_identity) > 0
      AND run_now_run_id IS NOT NULL)
    OR
    (decision = 'NO_ACTION'
      AND run_now_binding_identity IS NULL
      AND run_now_run_id IS NULL)
  )
);

CREATE TABLE public.scheduler_lifecycle_prefix_members (
  manifest_id UUID NOT NULL,
  authority_kind public.scheduler_lifecycle_member_kind NOT NULL,
  authoritative_time TIMESTAMPTZ(6) NOT NULL,
  authority_identity TEXT NOT NULL,
  authority_canonical_version INTEGER NOT NULL,
  authority_canonical_hash BYTEA NOT NULL,
  CONSTRAINT pk_scheduler_manifest_members
    PRIMARY KEY (manifest_id, authority_kind, authority_identity),
  CONSTRAINT fk_scheduler_manifest_member_manifest
    FOREIGN KEY (manifest_id) REFERENCES public.scheduler_lifecycle_prefix_manifests (manifest_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_scheduler_manifest_member_identity CHECK (char_length(authority_identity) > 0),
  CONSTRAINT chk_scheduler_manifest_member_version CHECK (authority_canonical_version = 1),
  CONSTRAINT chk_scheduler_manifest_member_hash CHECK (octet_length(authority_canonical_hash) = 32)
);

CREATE TABLE public.scheduler_run_now_bindings (
  operation_id UUID NOT NULL,
  policy_id UUID NOT NULL,
  slot_index BIGINT NOT NULL,
  run_id UUID NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_scheduler_run_now_bindings PRIMARY KEY (operation_id, policy_id, slot_index),
  CONSTRAINT uq_scheduler_run_now_binding_run UNIQUE (run_id),
  CONSTRAINT fk_scheduler_binding_decision
    FOREIGN KEY (operation_id, policy_id, slot_index)
    REFERENCES public.scheduler_decisions (operation_id, policy_id, slot_index)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_scheduler_binding_run
    FOREIGN KEY (run_id) REFERENCES public.research_runs (run_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_scheduler_binding_slot_nonnegative CHECK (slot_index >= 0),
  CONSTRAINT chk_scheduler_binding_canonical_version CHECK (canonical_version = 1),
  CONSTRAINT chk_scheduler_binding_canonical_nonempty CHECK (char_length(canonical) > 0),
  CONSTRAINT chk_scheduler_binding_canonical_hash CHECK (octet_length(canonical_hash) = 32)
);

CREATE UNIQUE INDEX uq_scheduler_decision_genesis
  ON public.scheduler_decisions (policy_id)
  WHERE previous_operation_id IS NULL
    AND previous_policy_id IS NULL
    AND previous_slot_index IS NULL
    AND previous_decision_canonical_hash IS NULL;

CREATE UNIQUE INDEX uq_scheduler_decision_successor
  ON public.scheduler_decisions (
    policy_id,
    previous_operation_id,
    previous_policy_id,
    previous_slot_index
  )
  WHERE previous_operation_id IS NOT NULL
    AND previous_policy_id IS NOT NULL
    AND previous_slot_index IS NOT NULL
    AND previous_decision_canonical_hash IS NOT NULL;

CREATE INDEX idx_scheduler_policy_versions_owner
  ON public.scheduler_policy_versions (policy_id, effective_at, version);
CREATE INDEX idx_scheduler_manifest_members_order
  ON public.scheduler_lifecycle_prefix_members (manifest_id, authoritative_time, authority_kind, authority_identity);

CREATE OR REPLACE FUNCTION public.scheduler_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Scheduler authoritative history is append-only: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'scheduler_policy_streams',
    'scheduler_policy_versions',
    'scheduler_decisions',
    'scheduler_lifecycle_prefix_manifests',
    'scheduler_lifecycle_prefix_members',
    'scheduler_run_now_bindings'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.scheduler_guard_immutable()',
      'trg_scheduler_immutable_' || table_name, table_name
    );
  END LOOP;
END;
$$;

COMMIT;
