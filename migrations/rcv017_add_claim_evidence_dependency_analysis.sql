-- RCV-017 immutable Claim Evidence Dependency Analysis, version 1.
-- Apply only after rcv016_add_evidence_provenance.sql.
-- Canonical TEXT is application-produced and is never reconstructed here.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'RCV-017 requires server_encoding UTF8; found %',
      current_setting('server_encoding');
  END IF;
END;
$$;

CREATE TABLE public.dependency_analysis_policies (
  policy_id UUID NOT NULL,
  policy_version BIGINT NOT NULL,
  schema_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  relationship_classification_catalog_id TEXT NOT NULL,
  relationship_classification_catalog_version TEXT NOT NULL,
  evidence_direction_partition_rule TEXT NOT NULL,
  reflexive_closure_rule TEXT NOT NULL,
  common_upstream_rule TEXT NOT NULL,
  negative_finding_rule TEXT NOT NULL,
  knowledge_limitation_rule TEXT NOT NULL,
  witness_selection_rule TEXT NOT NULL,
  finding_vocabulary_rule TEXT NOT NULL,
  cycle_handling_rule TEXT NOT NULL,
  deterministic_ordering_rule TEXT NOT NULL,
  max_evidence_relations BIGINT NOT NULL,
  max_bindings BIGINT NOT NULL,
  max_artifact_versions BIGINT NOT NULL,
  max_statements BIGINT NOT NULL,
  max_dependency_depth BIGINT NOT NULL,
  max_findings BIGINT NOT NULL,
  max_canonical_bytes BIGINT NOT NULL,
  canonicalization_id TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  definition_canonical TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_policies
    PRIMARY KEY (policy_id, policy_version),
  CONSTRAINT uq_dependency_analysis_policies_hash
    UNIQUE (policy_id, policy_version, definition_hash),
  CONSTRAINT chk_dependency_analysis_policies_identity
    CHECK (
      policy_version BETWEEN 1 AND 9007199254740991 AND
      schema_id = 'factbase-dependency-analysis-policy' AND
      schema_version = '1' AND
      relationship_classification_catalog_id =
        'factbase-dependency-relationship-classification' AND
      relationship_classification_catalog_version = '1' AND
      canonicalization_id = 'jcs-rfc8785' AND
      canonicalization_version = '1' AND
      hash_algorithm = 'sha-256'
    ),
  CONSTRAINT chk_dependency_analysis_policies_rules
    CHECK (
      evidence_direction_partition_rule =
        'supports_and_contradicts_separate_contextualizes_excluded' AND
      reflexive_closure_rule =
        'anchor_depth_zero_then_enabled_dependency_edges_minimum_distance' AND
      common_upstream_rule =
        'same_exact_artifact_version_in_two_or_more_reflexive_branch_closures' AND
      negative_finding_rule =
        'unordered_same_direction_pair_with_disjoint_reflexive_closures' AND
      knowledge_limitation_rule =
        'snapshot_unknown_partial_or_derived_unrecorded_in_reached_set' AND
      witness_selection_rule =
        'fewest_edges_then_ascii_statement_id_sequence' AND
      finding_vocabulary_rule =
        'rcv017_closed_four_finding_vocabulary_v1' AND
      cycle_handling_rule = 'expand_once_per_branch_at_minimum_distance' AND
      deterministic_ordering_rule = 'rcv017_explicit_total_order_v1'
    ),
  CONSTRAINT chk_dependency_analysis_policies_limits
    CHECK (
      max_evidence_relations BETWEEN 1 AND 9007199254740991 AND
      max_bindings BETWEEN 1 AND 9007199254740991 AND
      max_artifact_versions BETWEEN 1 AND 9007199254740991 AND
      max_statements BETWEEN 1 AND 9007199254740991 AND
      max_dependency_depth BETWEEN 1 AND 9007199254740991 AND
      max_findings BETWEEN 1 AND 9007199254740991 AND
      max_canonical_bytes BETWEEN 1 AND 9007199254740991
    ),
  CONSTRAINT chk_dependency_analysis_policies_hash
    CHECK (
      char_length(definition_canonical) > 0 AND
      definition_hash ~ '^[0-9a-f]{64}$' AND
      definition_hash = public.rcv016_sha256_text(definition_canonical)
    )
);

CREATE TABLE public.dependency_analysis_policy_relationships (
  policy_id UUID NOT NULL,
  policy_version BIGINT NOT NULL,
  relationship TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_policy_relationships
    PRIMARY KEY (policy_id, policy_version, relationship),
  CONSTRAINT fk_dependency_analysis_policy_relationships_policy
    FOREIGN KEY (policy_id, policy_version)
    REFERENCES public.dependency_analysis_policies (policy_id, policy_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_dependency_analysis_policy_relationships_value
    CHECK (relationship IN (
      'quotes', 'incorporates', 'reposts', 'syndicated_from',
      'derived_from', 'uses_information_from'
    ))
);

CREATE TABLE public.claim_evidence_dependency_analyses (
  analysis_id UUID NOT NULL,
  analysis_schema_id TEXT NOT NULL,
  analysis_schema_version TEXT NOT NULL,
  claim_version_id UUID NOT NULL,
  provenance_snapshot_id UUID NOT NULL,
  provenance_snapshot_hash TEXT NOT NULL,
  dependency_analysis_policy_id UUID NOT NULL,
  dependency_analysis_policy_version BIGINT NOT NULL,
  dependency_analysis_policy_hash TEXT NOT NULL,
  algorithm_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  algorithm_artifact_hash TEXT NOT NULL,
  canonicalization_id TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  analysis_canonical TEXT NOT NULL,
  analysis_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_claim_evidence_dependency_analyses
    PRIMARY KEY (analysis_id),
  CONSTRAINT uq_claim_evidence_dependency_analyses_snapshot
    UNIQUE (analysis_id, provenance_snapshot_id),
  CONSTRAINT fk_claim_evidence_dependency_analyses_claim_version
    FOREIGN KEY (claim_version_id) REFERENCES public.claim_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_claim_evidence_dependency_analyses_snapshot
    FOREIGN KEY (provenance_snapshot_id) REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_claim_evidence_dependency_analyses_policy
    FOREIGN KEY (
      dependency_analysis_policy_id,
      dependency_analysis_policy_version,
      dependency_analysis_policy_hash
    ) REFERENCES public.dependency_analysis_policies (
      policy_id, policy_version, definition_hash
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_claim_evidence_dependency_analyses_identity
    CHECK (
      analysis_schema_id = 'factbase-claim-evidence-dependency-analysis' AND
      analysis_schema_version = '1' AND
      dependency_analysis_policy_version BETWEEN 1 AND 9007199254740991 AND
      algorithm_id = 'factbase-claim-evidence-dependency-algorithm' AND
      algorithm_version = '1' AND
      algorithm_artifact_hash ~ '^[0-9a-f]{64}$' AND
      canonicalization_id = 'jcs-rfc8785' AND
      canonicalization_version = '1' AND
      hash_algorithm = 'sha-256' AND
      provenance_snapshot_hash ~ '^[0-9a-f]{64}$' AND
      dependency_analysis_policy_hash ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_claim_evidence_dependency_analyses_hash
    CHECK (
      char_length(analysis_canonical) > 0 AND
      analysis_hash ~ '^[0-9a-f]{64}$' AND
      analysis_hash = public.rcv016_sha256_text(analysis_canonical)
    )
);

CREATE TABLE public.dependency_analysis_evidence_relations (
  analysis_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  direction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_evidence_relations
    PRIMARY KEY (analysis_id, claim_version_evidence_relation_id),
  CONSTRAINT fk_dependency_analysis_evidence_relations_analysis
    FOREIGN KEY (analysis_id)
    REFERENCES public.claim_evidence_dependency_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_evidence_relations_relation
    FOREIGN KEY (claim_version_evidence_relation_id)
    REFERENCES public.claim_version_evidence (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_evidence_relations_evidence
    FOREIGN KEY (evidence_id) REFERENCES public.evidence (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_dependency_analysis_evidence_relations_direction
    CHECK (direction IN ('supports', 'contradicts', 'contextualizes'))
);

CREATE TABLE public.dependency_analysis_bindings (
  analysis_id UUID NOT NULL,
  provenance_snapshot_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_artifact_binding_statement_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  artifact_version_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_bindings
    PRIMARY KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ),
  CONSTRAINT uq_dependency_analysis_bindings_statement
    UNIQUE (analysis_id, evidence_artifact_binding_statement_id),
  CONSTRAINT fk_dependency_analysis_bindings_analysis_snapshot
    FOREIGN KEY (analysis_id, provenance_snapshot_id)
    REFERENCES public.claim_evidence_dependency_analyses (
      analysis_id, provenance_snapshot_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_bindings_relation
    FOREIGN KEY (analysis_id, claim_version_evidence_relation_id)
    REFERENCES public.dependency_analysis_evidence_relations (
      analysis_id, claim_version_evidence_relation_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_bindings_evidence
    FOREIGN KEY (evidence_id) REFERENCES public.evidence (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_bindings_artifact_version
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_bindings_statement
    FOREIGN KEY (evidence_artifact_binding_statement_id)
    REFERENCES public.evidence_artifact_bindings (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_bindings_snapshot_membership
    FOREIGN KEY (
      provenance_snapshot_id, evidence_artifact_binding_statement_id
    ) REFERENCES public.provenance_snapshot_evidence_artifact_bindings (
      snapshot_id, evidence_artifact_binding_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.dependency_analysis_shared_artifact_findings (
  analysis_id UUID NOT NULL,
  direction TEXT NOT NULL,
  artifact_version_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_shared_artifact_findings
    PRIMARY KEY (analysis_id, direction, artifact_version_id),
  CONSTRAINT fk_dependency_analysis_shared_artifact_findings_analysis
    FOREIGN KEY (analysis_id)
    REFERENCES public.claim_evidence_dependency_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_shared_artifact_findings_artifact
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_dependency_analysis_shared_artifact_findings_direction
    CHECK (direction IN ('supports', 'contradicts'))
);

CREATE TABLE public.dependency_analysis_shared_artifact_members (
  analysis_id UUID NOT NULL,
  direction TEXT NOT NULL,
  artifact_version_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_artifact_binding_statement_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_shared_artifact_members
    PRIMARY KEY (
      analysis_id, direction, artifact_version_id,
      claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ),
  CONSTRAINT fk_dependency_analysis_shared_artifact_members_finding
    FOREIGN KEY (analysis_id, direction, artifact_version_id)
    REFERENCES public.dependency_analysis_shared_artifact_findings (
      analysis_id, direction, artifact_version_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_shared_artifact_members_branch
    FOREIGN KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_bindings (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.dependency_analysis_common_upstream_findings (
  analysis_id UUID NOT NULL,
  direction TEXT NOT NULL,
  upstream_artifact_version_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_common_upstream_findings
    PRIMARY KEY (analysis_id, direction, upstream_artifact_version_id),
  CONSTRAINT fk_dependency_analysis_common_upstream_findings_analysis
    FOREIGN KEY (analysis_id)
    REFERENCES public.claim_evidence_dependency_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_common_upstream_findings_artifact
    FOREIGN KEY (upstream_artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_dependency_analysis_common_upstream_findings_direction
    CHECK (direction IN ('supports', 'contradicts'))
);

CREATE TABLE public.dependency_analysis_common_upstream_members (
  analysis_id UUID NOT NULL,
  direction TEXT NOT NULL,
  upstream_artifact_version_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_artifact_binding_statement_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_common_upstream_members
    PRIMARY KEY (
      analysis_id, direction, upstream_artifact_version_id,
      claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ),
  CONSTRAINT fk_dependency_analysis_common_upstream_members_finding
    FOREIGN KEY (analysis_id, direction, upstream_artifact_version_id)
    REFERENCES public.dependency_analysis_common_upstream_findings (
      analysis_id, direction, upstream_artifact_version_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_common_upstream_members_branch
    FOREIGN KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_bindings (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.dependency_analysis_common_upstream_witness_steps (
  analysis_id UUID NOT NULL,
  provenance_snapshot_id UUID NOT NULL,
  direction TEXT NOT NULL,
  upstream_artifact_version_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_artifact_binding_statement_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  artifact_version_id UUID NOT NULL,
  artifact_provenance_statement_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_common_upstream_witness_steps
    PRIMARY KEY (
      analysis_id, direction, upstream_artifact_version_id,
      claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id, ordinal
    ),
  CONSTRAINT fk_dependency_analysis_common_upstream_witness_member
    FOREIGN KEY (
      analysis_id, direction, upstream_artifact_version_id,
      claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_common_upstream_members (
      analysis_id, direction, upstream_artifact_version_id,
      claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_common_upstream_witness_analysis
    FOREIGN KEY (analysis_id, provenance_snapshot_id)
    REFERENCES public.claim_evidence_dependency_analyses (
      analysis_id, provenance_snapshot_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_common_upstream_witness_artifact
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_common_upstream_witness_statement
    FOREIGN KEY (artifact_provenance_statement_id)
    REFERENCES public.artifact_provenance_statements (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_common_upstream_witness_snapshot_member
    FOREIGN KEY (
      provenance_snapshot_id, artifact_provenance_statement_id
    ) REFERENCES public.provenance_snapshot_artifact_provenance_statements (
      snapshot_id, artifact_provenance_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_dependency_analysis_common_upstream_witness_ordinal
    CHECK (ordinal BETWEEN 0 AND 9007199254740991)
);

CREATE TABLE public.dependency_analysis_no_common_upstream_findings (
  analysis_id UUID NOT NULL,
  direction TEXT NOT NULL,
  lower_claim_version_evidence_relation_id UUID NOT NULL,
  lower_evidence_artifact_binding_statement_id UUID NOT NULL,
  upper_claim_version_evidence_relation_id UUID NOT NULL,
  upper_evidence_artifact_binding_statement_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_no_common_upstream_findings
    PRIMARY KEY (
      analysis_id, direction,
      lower_claim_version_evidence_relation_id,
      lower_evidence_artifact_binding_statement_id,
      upper_claim_version_evidence_relation_id,
      upper_evidence_artifact_binding_statement_id
    ),
  CONSTRAINT fk_dependency_analysis_no_common_upstream_analysis
    FOREIGN KEY (analysis_id)
    REFERENCES public.claim_evidence_dependency_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_no_common_upstream_lower_branch
    FOREIGN KEY (
      analysis_id, lower_claim_version_evidence_relation_id,
      lower_evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_bindings (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_no_common_upstream_upper_branch
    FOREIGN KEY (
      analysis_id, upper_claim_version_evidence_relation_id,
      upper_evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_bindings (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_dependency_analysis_no_common_upstream_direction
    CHECK (direction IN ('supports', 'contradicts')),
  CONSTRAINT chk_dependency_analysis_no_common_upstream_order
    CHECK (
      (lower_claim_version_evidence_relation_id::text COLLATE "C") <
        (upper_claim_version_evidence_relation_id::text COLLATE "C") OR
      (
        lower_claim_version_evidence_relation_id =
          upper_claim_version_evidence_relation_id AND
        (lower_evidence_artifact_binding_statement_id::text COLLATE "C") <
          (upper_evidence_artifact_binding_statement_id::text COLLATE "C")
      )
    )
);

CREATE TABLE public.dependency_analysis_knowledge_incomplete_findings (
  analysis_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_artifact_binding_statement_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_knowledge_incomplete_findings
    PRIMARY KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ),
  CONSTRAINT fk_dependency_analysis_knowledge_incomplete_analysis
    FOREIGN KEY (analysis_id)
    REFERENCES public.claim_evidence_dependency_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_knowledge_incomplete_branch
    FOREIGN KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_bindings (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.dependency_analysis_knowledge_affected_artifacts (
  analysis_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_artifact_binding_statement_id UUID NOT NULL,
  artifact_version_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_knowledge_affected_artifacts
    PRIMARY KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id, artifact_version_id
    ),
  CONSTRAINT fk_dependency_analysis_knowledge_affected_finding
    FOREIGN KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_knowledge_incomplete_findings (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_knowledge_affected_artifact
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.dependency_analysis_knowledge_state_evidence (
  analysis_id UUID NOT NULL,
  provenance_snapshot_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_artifact_binding_statement_id UUID NOT NULL,
  knowledge_state_statement_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_knowledge_state_evidence
    PRIMARY KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id, knowledge_state_statement_id
    ),
  CONSTRAINT fk_dependency_analysis_knowledge_state_finding
    FOREIGN KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_knowledge_incomplete_findings (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_knowledge_state_analysis
    FOREIGN KEY (analysis_id, provenance_snapshot_id)
    REFERENCES public.claim_evidence_dependency_analyses (
      analysis_id, provenance_snapshot_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_knowledge_state_statement
    FOREIGN KEY (knowledge_state_statement_id)
    REFERENCES public.knowledge_state_statements (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_knowledge_state_snapshot_member
    FOREIGN KEY (provenance_snapshot_id, knowledge_state_statement_id)
    REFERENCES public.provenance_snapshot_knowledge_state_statements (
      snapshot_id, knowledge_state_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.dependency_analysis_derived_unrecorded_evidence (
  analysis_id UUID NOT NULL,
  claim_version_evidence_relation_id UUID NOT NULL,
  evidence_artifact_binding_statement_id UUID NOT NULL,
  artifact_version_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_dependency_analysis_derived_unrecorded_evidence
    PRIMARY KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id, artifact_version_id
    ),
  CONSTRAINT fk_dependency_analysis_derived_unrecorded_finding
    FOREIGN KEY (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) REFERENCES public.dependency_analysis_knowledge_incomplete_findings (
      analysis_id, claim_version_evidence_relation_id,
      evidence_artifact_binding_statement_id
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_dependency_analysis_derived_unrecorded_artifact
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE OR REPLACE FUNCTION public.rcv017_guard_historical_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := transaction_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'RCV-017 historical table % is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv017_validate_dependency_analysis_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  enabled_count BIGINT;
BEGIN
  SELECT count(*) INTO enabled_count
  FROM public.dependency_analysis_policy_relationships
  WHERE policy_id = NEW.policy_id AND policy_version = NEW.policy_version;

  IF enabled_count = 0 THEN
    RAISE EXCEPTION 'RCV-017 policy requires at least one enabled relationship'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_analysis_id UUID := NEW.analysis_id;
  analysis_row public.claim_evidence_dependency_analyses%ROWTYPE;
BEGIN
  SELECT * INTO STRICT analysis_row
  FROM public.claim_evidence_dependency_analyses
  WHERE analysis_id = target_analysis_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.provenance_snapshots s
    WHERE s.id = analysis_row.provenance_snapshot_id
      AND s.snapshot_hash = analysis_row.provenance_snapshot_hash
  ) THEN
    RAISE EXCEPTION 'RCV-017 exact Snapshot ID/hash binding failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_evidence_relations r
    JOIN public.claim_version_evidence cve
      ON cve.id = r.claim_version_evidence_relation_id
    WHERE r.analysis_id = target_analysis_id
      AND (
        cve.claim_version_id <> analysis_row.claim_version_id OR
        cve.evidence_id <> r.evidence_id OR
        cve.relation <> r.direction
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 evidence relation parity failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_evidence_relations r
    WHERE r.analysis_id = target_analysis_id
      AND NOT EXISTS (
        SELECT 1 FROM public.dependency_analysis_bindings b
        WHERE b.analysis_id = r.analysis_id
          AND b.claim_version_evidence_relation_id =
            r.claim_version_evidence_relation_id
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 every selected relation requires a binding'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_bindings b
    JOIN public.dependency_analysis_evidence_relations r
      ON r.analysis_id = b.analysis_id
     AND r.claim_version_evidence_relation_id =
       b.claim_version_evidence_relation_id
    JOIN public.evidence_artifact_bindings eab
      ON eab.id = b.evidence_artifact_binding_statement_id
    WHERE b.analysis_id = target_analysis_id
      AND (
        b.provenance_snapshot_id <> analysis_row.provenance_snapshot_id OR
        b.evidence_id <> r.evidence_id OR
        b.evidence_id <> eab.evidence_id OR
        b.artifact_version_id <> eab.artifact_version_id
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 binding parity failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_shared_artifact_findings f
    WHERE f.analysis_id = target_analysis_id
      AND (
        (SELECT count(*)
         FROM public.dependency_analysis_shared_artifact_members m
         WHERE m.analysis_id = f.analysis_id
           AND m.direction = f.direction
           AND m.artifact_version_id = f.artifact_version_id) < 2 OR
        EXISTS (
          SELECT 1
          FROM public.dependency_analysis_shared_artifact_members m
          JOIN public.dependency_analysis_bindings b
            ON b.analysis_id = m.analysis_id
           AND b.claim_version_evidence_relation_id =
             m.claim_version_evidence_relation_id
           AND b.evidence_artifact_binding_statement_id =
             m.evidence_artifact_binding_statement_id
          JOIN public.dependency_analysis_evidence_relations r
            ON r.analysis_id = b.analysis_id
           AND r.claim_version_evidence_relation_id =
             b.claim_version_evidence_relation_id
          WHERE m.analysis_id = f.analysis_id
            AND m.direction = f.direction
            AND m.artifact_version_id = f.artifact_version_id
            AND (b.artifact_version_id <> f.artifact_version_id OR
                 r.direction <> f.direction)
        )
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 shared-artifact structural parity failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_common_upstream_findings f
    WHERE f.analysis_id = target_analysis_id
      AND (
        (SELECT count(*)
         FROM public.dependency_analysis_common_upstream_members m
         WHERE m.analysis_id = f.analysis_id
           AND m.direction = f.direction
           AND m.upstream_artifact_version_id =
             f.upstream_artifact_version_id) < 2 OR
        NOT EXISTS (
          SELECT 1
          FROM public.dependency_analysis_common_upstream_members m
          JOIN public.dependency_analysis_common_upstream_witness_steps w
            ON w.analysis_id = m.analysis_id
           AND w.direction = m.direction
           AND w.upstream_artifact_version_id =
             m.upstream_artifact_version_id
           AND w.claim_version_evidence_relation_id =
             m.claim_version_evidence_relation_id
           AND w.evidence_artifact_binding_statement_id =
             m.evidence_artifact_binding_statement_id
          WHERE m.analysis_id = f.analysis_id
            AND m.direction = f.direction
            AND m.upstream_artifact_version_id =
              f.upstream_artifact_version_id
            AND w.ordinal > 0
        ) OR
        EXISTS (
          SELECT 1
          FROM public.dependency_analysis_common_upstream_members m
          JOIN public.dependency_analysis_evidence_relations r
            ON r.analysis_id = m.analysis_id
           AND r.claim_version_evidence_relation_id =
             m.claim_version_evidence_relation_id
          WHERE m.analysis_id = f.analysis_id
            AND m.direction = f.direction
            AND m.upstream_artifact_version_id =
              f.upstream_artifact_version_id
            AND r.direction <> f.direction
        )
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 common-upstream aggregate parity failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_common_upstream_members m
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS step_count,
        min(w.ordinal) AS min_ordinal,
        max(w.ordinal) AS max_ordinal,
        count(*) FILTER (
          WHERE w.artifact_provenance_statement_id IS NULL
        ) AS null_count,
        max(w.ordinal) FILTER (
          WHERE w.artifact_provenance_statement_id IS NULL
        ) AS null_ordinal,
        count(DISTINCT w.artifact_version_id) AS distinct_artifacts
      FROM public.dependency_analysis_common_upstream_witness_steps w
      WHERE w.analysis_id = m.analysis_id
        AND w.direction = m.direction
        AND w.upstream_artifact_version_id = m.upstream_artifact_version_id
        AND w.claim_version_evidence_relation_id =
          m.claim_version_evidence_relation_id
        AND w.evidence_artifact_binding_statement_id =
          m.evidence_artifact_binding_statement_id
    ) shape ON TRUE
    WHERE m.analysis_id = target_analysis_id
      AND (
        shape.step_count = 0 OR shape.min_ordinal <> 0 OR
        shape.max_ordinal <> shape.step_count - 1 OR
        shape.null_count <> 1 OR shape.null_ordinal <> shape.max_ordinal OR
        shape.distinct_artifacts <> shape.step_count
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 witness ordinal/path shape failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_common_upstream_members m
    JOIN public.dependency_analysis_bindings b
      ON b.analysis_id = m.analysis_id
     AND b.claim_version_evidence_relation_id =
       m.claim_version_evidence_relation_id
     AND b.evidence_artifact_binding_statement_id =
       m.evidence_artifact_binding_statement_id
    WHERE m.analysis_id = target_analysis_id
      AND (
        (SELECT w.artifact_version_id
         FROM public.dependency_analysis_common_upstream_witness_steps w
         WHERE w.analysis_id = m.analysis_id
           AND w.direction = m.direction
           AND w.upstream_artifact_version_id =
             m.upstream_artifact_version_id
           AND w.claim_version_evidence_relation_id =
             m.claim_version_evidence_relation_id
           AND w.evidence_artifact_binding_statement_id =
             m.evidence_artifact_binding_statement_id
         ORDER BY w.ordinal LIMIT 1) <> b.artifact_version_id OR
        (SELECT w.artifact_version_id
         FROM public.dependency_analysis_common_upstream_witness_steps w
         WHERE w.analysis_id = m.analysis_id
           AND w.direction = m.direction
           AND w.upstream_artifact_version_id =
             m.upstream_artifact_version_id
           AND w.claim_version_evidence_relation_id =
             m.claim_version_evidence_relation_id
           AND w.evidence_artifact_binding_statement_id =
             m.evidence_artifact_binding_statement_id
         ORDER BY w.ordinal DESC LIMIT 1) <>
           m.upstream_artifact_version_id
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 witness start/end parity failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH ordered_steps AS (
      SELECT
        w.*,
        lead(w.artifact_version_id) OVER (
          PARTITION BY
            w.analysis_id, w.direction, w.upstream_artifact_version_id,
            w.claim_version_evidence_relation_id,
            w.evidence_artifact_binding_statement_id
          ORDER BY w.ordinal
        ) AS next_artifact_version_id
      FROM public.dependency_analysis_common_upstream_witness_steps w
      WHERE w.analysis_id = target_analysis_id
    )
    SELECT 1
    FROM ordered_steps w
    LEFT JOIN public.artifact_provenance_statements aps
      ON aps.id = w.artifact_provenance_statement_id
    WHERE w.artifact_provenance_statement_id IS NOT NULL
      AND (
        aps.id IS NULL OR
        aps.downstream_artifact_version_id <> w.artifact_version_id OR
        aps.upstream_artifact_version_id <> w.next_artifact_version_id OR
        NOT EXISTS (
          SELECT 1
          FROM public.dependency_analysis_policy_relationships pr
          WHERE pr.policy_id = analysis_row.dependency_analysis_policy_id
            AND pr.policy_version =
              analysis_row.dependency_analysis_policy_version
            AND pr.relationship = aps.relationship_type
        )
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 witness adjacency/policy parity failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_no_common_upstream_findings f
    JOIN public.dependency_analysis_evidence_relations lower_relation
      ON lower_relation.analysis_id = f.analysis_id
     AND lower_relation.claim_version_evidence_relation_id =
       f.lower_claim_version_evidence_relation_id
    JOIN public.dependency_analysis_evidence_relations upper_relation
      ON upper_relation.analysis_id = f.analysis_id
     AND upper_relation.claim_version_evidence_relation_id =
       f.upper_claim_version_evidence_relation_id
    JOIN public.dependency_analysis_bindings lower_binding
      ON lower_binding.analysis_id = f.analysis_id
     AND lower_binding.claim_version_evidence_relation_id =
       f.lower_claim_version_evidence_relation_id
     AND lower_binding.evidence_artifact_binding_statement_id =
       f.lower_evidence_artifact_binding_statement_id
    JOIN public.dependency_analysis_bindings upper_binding
      ON upper_binding.analysis_id = f.analysis_id
     AND upper_binding.claim_version_evidence_relation_id =
       f.upper_claim_version_evidence_relation_id
     AND upper_binding.evidence_artifact_binding_statement_id =
       f.upper_evidence_artifact_binding_statement_id
    WHERE f.analysis_id = target_analysis_id
      AND (lower_relation.direction <> f.direction OR
           upper_relation.direction <> f.direction OR
           lower_binding.artifact_version_id =
             upper_binding.artifact_version_id)
  ) THEN
    RAISE EXCEPTION 'RCV-017 negative-finding structural parity failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_knowledge_incomplete_findings f
    WHERE f.analysis_id = target_analysis_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.dependency_analysis_knowledge_state_evidence k
        WHERE k.analysis_id = f.analysis_id
          AND k.claim_version_evidence_relation_id =
            f.claim_version_evidence_relation_id
          AND k.evidence_artifact_binding_statement_id =
            f.evidence_artifact_binding_statement_id
        UNION ALL
        SELECT 1
        FROM public.dependency_analysis_derived_unrecorded_evidence d
        WHERE d.analysis_id = f.analysis_id
          AND d.claim_version_evidence_relation_id =
            f.claim_version_evidence_relation_id
          AND d.evidence_artifact_binding_statement_id =
            f.evidence_artifact_binding_statement_id
      )
  ) THEN
    RAISE EXCEPTION 'RCV-017 knowledge-incomplete finding requires evidence'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dependency_analysis_knowledge_state_evidence e
    JOIN public.knowledge_state_statements k
      ON k.id = e.knowledge_state_statement_id
    WHERE e.analysis_id = target_analysis_id
      AND (e.provenance_snapshot_id <>
             analysis_row.provenance_snapshot_id OR
           k.scope <> 'upstream_provenance' OR
           k.state NOT IN ('unknown', 'partial'))
  ) THEN
    RAISE EXCEPTION 'RCV-017 KnowledgeState evidence parity failed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_rcv017_guard_dependency_analysis_policies
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_policies
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_policy_relationships
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_policy_relationships
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_claim_evidence_dependency_analyses
BEFORE INSERT OR UPDATE OR DELETE ON public.claim_evidence_dependency_analyses
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_evidence_relations
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_evidence_relations
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_bindings
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_bindings
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_shared_artifact_findings
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_shared_artifact_findings
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_shared_artifact_members
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_shared_artifact_members
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_common_upstream_findings
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_common_upstream_findings
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_common_upstream_members
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_common_upstream_members
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_common_upstream_witness_steps
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_common_upstream_witness_steps
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_no_common_upstream_findings
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_no_common_upstream_findings
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_knowledge_incomplete_findings
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_knowledge_incomplete_findings
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_knowledge_affected_artifacts
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_knowledge_affected_artifacts
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_knowledge_state_evidence
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_knowledge_state_evidence
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();
CREATE TRIGGER trg_rcv017_guard_dependency_analysis_derived_unrecorded_evidence
BEFORE INSERT OR UPDATE OR DELETE ON public.dependency_analysis_derived_unrecorded_evidence
FOR EACH ROW EXECUTE FUNCTION public.rcv017_guard_historical_row();

CREATE CONSTRAINT TRIGGER trg_rcv017_validate_policy_header
AFTER INSERT ON public.dependency_analysis_policies
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_dependency_analysis_policy();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_policy_relationship
AFTER INSERT ON public.dependency_analysis_policy_relationships
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_dependency_analysis_policy();

CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_header
AFTER INSERT ON public.claim_evidence_dependency_analyses
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_evidence_relation
AFTER INSERT ON public.dependency_analysis_evidence_relations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_binding
AFTER INSERT ON public.dependency_analysis_bindings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_shared_finding
AFTER INSERT ON public.dependency_analysis_shared_artifact_findings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_shared_member
AFTER INSERT ON public.dependency_analysis_shared_artifact_members
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_common_finding
AFTER INSERT ON public.dependency_analysis_common_upstream_findings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_common_member
AFTER INSERT ON public.dependency_analysis_common_upstream_members
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_witness_step
AFTER INSERT ON public.dependency_analysis_common_upstream_witness_steps
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_negative_finding
AFTER INSERT ON public.dependency_analysis_no_common_upstream_findings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_knowledge_finding
AFTER INSERT ON public.dependency_analysis_knowledge_incomplete_findings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_knowledge_affected
AFTER INSERT ON public.dependency_analysis_knowledge_affected_artifacts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_knowledge_state
AFTER INSERT ON public.dependency_analysis_knowledge_state_evidence
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();
CREATE CONSTRAINT TRIGGER trg_rcv017_validate_analysis_derived_unrecorded
AFTER INSERT ON public.dependency_analysis_derived_unrecorded_evidence
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.rcv017_validate_claim_evidence_dependency_analysis();

COMMIT;
