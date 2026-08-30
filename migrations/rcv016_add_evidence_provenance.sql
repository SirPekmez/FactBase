-- RCV-016 evidence provenance and source independence contract, version 1.
-- Apply only after rcv015_add_reproducible_derivations.sql.
-- This migration is additive. It performs no backfill and does not alter RCV-015.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION
      'RCV-016 requires server_encoding UTF8; found %',
      current_setting('server_encoding');
  END IF;
END;
$$;

-- Canonical TEXT is supplied by the normative Builder/Write Service and is
-- preserved byte-for-byte. Full RFC-8785/JCS validation belongs to that
-- Builder and to the Read Verifier, not to PostgreSQL serialization.

CREATE OR REPLACE FUNCTION public.rcv016_sha256_text(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT encode(sha256(convert_to(value, 'UTF8')), 'hex')
$$;

CREATE TABLE public.provenance_payload_limits (
  limits_id TEXT NOT NULL,
  limits_version TEXT NOT NULL,
  schema_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  source_metadata_canonical_bytes BIGINT NOT NULL,
  source_locator_count BIGINT NOT NULL,
  display_name_codepoints BIGINT NOT NULL,
  display_name_utf8_bytes BIGINT NOT NULL,
  locator_string_codepoints BIGINT NOT NULL,
  locator_string_utf8_bytes BIGINT NOT NULL,
  artifact_capture_canonical_bytes BIGINT NOT NULL,
  artifact_locator_codepoints BIGINT NOT NULL,
  artifact_locator_utf8_bytes BIGINT NOT NULL,
  media_type_codepoints BIGINT NOT NULL,
  media_type_utf8_bytes BIGINT NOT NULL,
  title_codepoints BIGINT NOT NULL,
  title_utf8_bytes BIGINT NOT NULL,
  rationale_codepoints BIGINT NOT NULL,
  rationale_utf8_bytes BIGINT NOT NULL,
  foundation_canonical_bytes BIGINT NOT NULL,
  foundation_item_count BIGINT NOT NULL,
  foundation_input_reference_count BIGINT NOT NULL,
  foundation_reference_codepoints BIGINT NOT NULL,
  foundation_reference_utf8_bytes BIGINT NOT NULL,
  definition_canonical TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_provenance_payload_limits
    PRIMARY KEY (limits_id, limits_version),
  CONSTRAINT uq_provenance_payload_limits_definition
    UNIQUE (limits_id, limits_version, definition_hash),
  CONSTRAINT chk_provenance_payload_limits_identity
    CHECK (
      char_length(limits_id) > 0 AND char_length(limits_version) > 0 AND
      schema_id = 'factbase-provenance-payload-limits' AND schema_version = '1'
    ),
  CONSTRAINT chk_provenance_payload_limits_positive_safe
    CHECK (
      source_metadata_canonical_bytes BETWEEN 1 AND 9007199254740991 AND
      source_locator_count BETWEEN 1 AND 9007199254740991 AND
      display_name_codepoints BETWEEN 1 AND 9007199254740991 AND
      display_name_utf8_bytes BETWEEN 1 AND 9007199254740991 AND
      locator_string_codepoints BETWEEN 1 AND 9007199254740991 AND
      locator_string_utf8_bytes BETWEEN 1 AND 9007199254740991 AND
      artifact_capture_canonical_bytes BETWEEN 1 AND 9007199254740991 AND
      artifact_locator_codepoints BETWEEN 1 AND 9007199254740991 AND
      artifact_locator_utf8_bytes BETWEEN 1 AND 9007199254740991 AND
      media_type_codepoints BETWEEN 1 AND 9007199254740991 AND
      media_type_utf8_bytes BETWEEN 1 AND 9007199254740991 AND
      title_codepoints BETWEEN 1 AND 9007199254740991 AND
      title_utf8_bytes BETWEEN 1 AND 9007199254740991 AND
      rationale_codepoints BETWEEN 1 AND 9007199254740991 AND
      rationale_utf8_bytes BETWEEN 1 AND 9007199254740991 AND
      foundation_canonical_bytes BETWEEN 1 AND 9007199254740991 AND
      foundation_item_count BETWEEN 1 AND 9007199254740991 AND
      foundation_input_reference_count BETWEEN 1 AND 9007199254740991 AND
      foundation_reference_codepoints BETWEEN 1 AND 9007199254740991 AND
      foundation_reference_utf8_bytes BETWEEN 1 AND 9007199254740991
    ),
  CONSTRAINT chk_provenance_payload_limits_hash
    CHECK (
      char_length(definition_canonical) > 0 AND
      definition_hash ~ '^[0-9a-f]{64}$' AND
      definition_hash = public.rcv016_sha256_text(definition_canonical)
    )
);

CREATE TABLE public.provenance_traversal_policies (
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  schema_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  definition_canonical TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  max_roots BIGINT NOT NULL,
  max_nodes BIGINT NOT NULL,
  max_edges BIGINT NOT NULL,
  max_depth BIGINT NOT NULL,
  max_canonical_snapshot_bytes BIGINT NOT NULL,
  allowed_relationships TEXT[] NOT NULL,
  deterministic_ordering TEXT NOT NULL,
  visited_semantics TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT pk_provenance_traversal_policies
    PRIMARY KEY (policy_id, policy_version),
  CONSTRAINT uq_provenance_traversal_policies_contract
    UNIQUE (
      policy_id, policy_version, definition_hash,
      max_roots, max_nodes, max_edges, max_depth,
      max_canonical_snapshot_bytes, allowed_relationships,
      deterministic_ordering, visited_semantics
    ),
  CONSTRAINT chk_provenance_traversal_policies_identity
    CHECK (
      char_length(policy_id) > 0 AND char_length(policy_version) > 0 AND
      schema_id = 'factbase-provenance-traversal-policy' AND schema_version = '1'
    ),
  CONSTRAINT chk_provenance_traversal_policies_limits
    CHECK (
      max_roots BETWEEN 1 AND 9007199254740991 AND
      max_nodes BETWEEN 1 AND 9007199254740991 AND
      max_edges BETWEEN 1 AND 9007199254740991 AND
      max_depth BETWEEN 1 AND 9007199254740991 AND
      max_canonical_snapshot_bytes BETWEEN 1 AND 9007199254740991
    ),
  CONSTRAINT chk_provenance_traversal_policies_relationships
    CHECK (
      allowed_relationships = ARRAY[
        'cites', 'derived_from', 'incorporates', 'quotes', 'reposts',
        'syndicated_from', 'uses_information_from'
      ]::TEXT[]
    ),
  CONSTRAINT chk_provenance_traversal_policies_semantics
    CHECK (
      deterministic_ordering =
        'schema_category_then_canonical_key_lexicographic_v1' AND
      visited_semantics =
        'expand_node_once_include_statement_once_diagnose_cycles_v1'
    ),
  CONSTRAINT chk_provenance_traversal_policies_hash
    CHECK (
      char_length(definition_canonical) > 0 AND
      definition_hash ~ '^[0-9a-f]{64}$' AND
      definition_hash = public.rcv016_sha256_text(definition_canonical)
    )
);

CREATE TABLE public.provenance_sources (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE public.provenance_artifacts (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE public.provenance_source_versions (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL,
  version_number BIGINT NOT NULL,
  metadata_schema_id TEXT NOT NULL,
  metadata_schema_version TEXT NOT NULL,
  metadata_canonical TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  payload_limits_id TEXT NOT NULL,
  payload_limits_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT fk_provenance_source_versions_source
    FOREIGN KEY (source_id) REFERENCES public.provenance_sources (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_provenance_source_versions_payload_limits
    FOREIGN KEY (payload_limits_id, payload_limits_version)
    REFERENCES public.provenance_payload_limits (limits_id, limits_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT uq_provenance_source_versions_number
    UNIQUE (source_id, version_number),
  CONSTRAINT chk_provenance_source_versions_number
    CHECK (version_number BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_provenance_source_versions_schema
    CHECK (
      metadata_schema_id = 'factbase-source-version-metadata' AND
      metadata_schema_version = '1'
    ),
  CONSTRAINT chk_provenance_source_versions_canonical
    CHECK (
      char_length(metadata_canonical) > 0 AND
      metadata_hash ~ '^[0-9a-f]{64}$' AND
      metadata_hash = public.rcv016_sha256_text(metadata_canonical)
    )
);

CREATE TABLE public.provenance_artifact_versions (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL,
  version_number BIGINT NOT NULL,
  capture_schema_id TEXT NOT NULL,
  capture_schema_version TEXT NOT NULL,
  capture_canonical TEXT NOT NULL,
  capture_hash TEXT NOT NULL,
  payload_limits_id TEXT NOT NULL,
  payload_limits_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT fk_provenance_artifact_versions_artifact
    FOREIGN KEY (artifact_id) REFERENCES public.provenance_artifacts (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_provenance_artifact_versions_payload_limits
    FOREIGN KEY (payload_limits_id, payload_limits_version)
    REFERENCES public.provenance_payload_limits (limits_id, limits_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT uq_provenance_artifact_versions_number
    UNIQUE (artifact_id, version_number),
  CONSTRAINT chk_provenance_artifact_versions_number
    CHECK (version_number BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_provenance_artifact_versions_schema
    CHECK (
      capture_schema_id = 'factbase-artifact-version-capture' AND
      capture_schema_version = '1'
    ),
  CONSTRAINT chk_provenance_artifact_versions_canonical
    CHECK (
      char_length(capture_canonical) > 0 AND
      capture_hash ~ '^[0-9a-f]{64}$' AND
      capture_hash = public.rcv016_sha256_text(capture_canonical)
  )
);

CREATE TABLE public.artifact_provenance_statements (
  id UUID PRIMARY KEY,
  downstream_artifact_version_id UUID NOT NULL,
  relationship_type TEXT NOT NULL,
  upstream_artifact_version_id UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  initiator_type TEXT NULL,
  initiator_id TEXT NULL,
  rationale TEXT NULL,
  foundation_schema_id TEXT NULL,
  foundation_schema_version TEXT NULL,
  foundation_canonical TEXT NULL,
  foundation_hash TEXT NULL,
  supersedes_statement_id UUID NULL,
  payload_limits_id TEXT NOT NULL,
  payload_limits_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT fk_artifact_provenance_downstream
    FOREIGN KEY (downstream_artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_artifact_provenance_upstream
    FOREIGN KEY (upstream_artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_artifact_provenance_supersedes
    FOREIGN KEY (supersedes_statement_id)
    REFERENCES public.artifact_provenance_statements (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_artifact_provenance_payload_limits
    FOREIGN KEY (payload_limits_id, payload_limits_version)
    REFERENCES public.provenance_payload_limits (limits_id, limits_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_artifact_provenance_relationship
    CHECK (
      relationship_type IN (
        'cites', 'quotes', 'incorporates', 'reposts', 'syndicated_from',
        'derived_from', 'uses_information_from'
      )
    ),
  CONSTRAINT chk_artifact_provenance_temporal
    CHECK (valid_from IS NULL AND valid_to IS NULL),
  CONSTRAINT chk_artifact_provenance_initiator
    CHECK (
      (initiator_type IS NULL AND initiator_id IS NULL) OR
      (initiator_type IS NOT NULL AND
       initiator_type IN ('human', 'system', 'importer', 'agent'))
    ),
  CONSTRAINT chk_artifact_provenance_rationale
    CHECK (rationale IS NULL OR char_length(rationale) > 0),
  CONSTRAINT chk_artifact_provenance_foundation
    CHECK (
      (
        foundation_schema_id IS NULL AND foundation_schema_version IS NULL AND
        foundation_canonical IS NULL AND foundation_hash IS NULL
      ) OR (
        foundation_schema_id IS NOT NULL AND
        foundation_schema_id = 'factbase-provenance-foundation' AND
        foundation_schema_version IS NOT NULL AND foundation_schema_version = '1' AND
        foundation_canonical IS NOT NULL AND char_length(foundation_canonical) > 0 AND
        foundation_hash IS NOT NULL AND
        foundation_hash ~ '^[0-9a-f]{64}$' AND
        foundation_hash = public.rcv016_sha256_text(foundation_canonical)
      )
    ),
  CONSTRAINT chk_artifact_provenance_not_self_supersession
    CHECK (supersedes_statement_id IS NULL OR supersedes_statement_id <> id)
);

CREATE TABLE public.source_relationship_statements (
  id UUID PRIMARY KEY,
  subject_source_id UUID NOT NULL,
  relationship_type TEXT NOT NULL,
  object_source_id UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  initiator_type TEXT NULL,
  initiator_id TEXT NULL,
  rationale TEXT NULL,
  foundation_schema_id TEXT NULL,
  foundation_schema_version TEXT NULL,
  foundation_canonical TEXT NULL,
  foundation_hash TEXT NULL,
  supersedes_statement_id UUID NULL,
  payload_limits_id TEXT NOT NULL,
  payload_limits_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT fk_source_relationship_subject
    FOREIGN KEY (subject_source_id) REFERENCES public.provenance_sources (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_source_relationship_object
    FOREIGN KEY (object_source_id) REFERENCES public.provenance_sources (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_source_relationship_supersedes
    FOREIGN KEY (supersedes_statement_id)
    REFERENCES public.source_relationship_statements (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_source_relationship_payload_limits
    FOREIGN KEY (payload_limits_id, payload_limits_version)
    REFERENCES public.provenance_payload_limits (limits_id, limits_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_source_relationship_type
    CHECK (
      relationship_type IN (
        'alias_of', 'successor_of', 'part_of', 'controlled_by', 'operated_by'
      )
    ),
  CONSTRAINT chk_source_relationship_temporal
    CHECK (
      (
        relationship_type IN ('alias_of', 'successor_of') AND
        valid_from IS NULL AND valid_to IS NULL
      ) OR (
        relationship_type IN ('part_of', 'controlled_by', 'operated_by') AND
        (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
      )
    ),
  CONSTRAINT chk_source_relationship_alias_canonical
    CHECK (
      relationship_type <> 'alias_of' OR
      (subject_source_id::TEXT COLLATE "C") < (object_source_id::TEXT COLLATE "C")
    ),
  CONSTRAINT chk_source_relationship_initiator
    CHECK (
      (initiator_type IS NULL AND initiator_id IS NULL) OR
      (initiator_type IS NOT NULL AND
       initiator_type IN ('human', 'system', 'importer', 'agent'))
    ),
  CONSTRAINT chk_source_relationship_rationale
    CHECK (rationale IS NULL OR char_length(rationale) > 0),
  CONSTRAINT chk_source_relationship_foundation
    CHECK (
      (
        foundation_schema_id IS NULL AND foundation_schema_version IS NULL AND
        foundation_canonical IS NULL AND foundation_hash IS NULL
      ) OR (
        foundation_schema_id IS NOT NULL AND
        foundation_schema_id = 'factbase-provenance-foundation' AND
        foundation_schema_version IS NOT NULL AND foundation_schema_version = '1' AND
        foundation_canonical IS NOT NULL AND char_length(foundation_canonical) > 0 AND
        foundation_hash IS NOT NULL AND
        foundation_hash ~ '^[0-9a-f]{64}$' AND
        foundation_hash = public.rcv016_sha256_text(foundation_canonical)
      )
    ),
  CONSTRAINT chk_source_relationship_not_self_supersession
    CHECK (supersedes_statement_id IS NULL OR supersedes_statement_id <> id)
);

CREATE TABLE public.artifact_source_attributions (
  id UUID PRIMARY KEY,
  artifact_version_id UUID NOT NULL,
  relationship_type TEXT NOT NULL,
  source_version_id UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  initiator_type TEXT NULL,
  initiator_id TEXT NULL,
  rationale TEXT NULL,
  foundation_schema_id TEXT NULL,
  foundation_schema_version TEXT NULL,
  foundation_canonical TEXT NULL,
  foundation_hash TEXT NULL,
  supersedes_statement_id UUID NULL,
  payload_limits_id TEXT NOT NULL,
  payload_limits_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT fk_artifact_source_attribution_artifact_version
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_artifact_source_attribution_source_version
    FOREIGN KEY (source_version_id)
    REFERENCES public.provenance_source_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_artifact_source_attribution_supersedes
    FOREIGN KEY (supersedes_statement_id)
    REFERENCES public.artifact_source_attributions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_artifact_source_attribution_payload_limits
    FOREIGN KEY (payload_limits_id, payload_limits_version)
    REFERENCES public.provenance_payload_limits (limits_id, limits_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_artifact_source_attribution_relationship
    CHECK (relationship_type IN ('authored_by', 'published_by', 'hosted_by', 'issued_by')),
  CONSTRAINT chk_artifact_source_attribution_temporal
    CHECK (valid_from IS NULL AND valid_to IS NULL),
  CONSTRAINT chk_artifact_source_attribution_initiator
    CHECK (
      (initiator_type IS NULL AND initiator_id IS NULL) OR
      (initiator_type IS NOT NULL AND
       initiator_type IN ('human', 'system', 'importer', 'agent'))
    ),
  CONSTRAINT chk_artifact_source_attribution_rationale
    CHECK (rationale IS NULL OR char_length(rationale) > 0),
  CONSTRAINT chk_artifact_source_attribution_foundation
    CHECK (
      (
        foundation_schema_id IS NULL AND foundation_schema_version IS NULL AND
        foundation_canonical IS NULL AND foundation_hash IS NULL
      ) OR (
        foundation_schema_id IS NOT NULL AND
        foundation_schema_id = 'factbase-provenance-foundation' AND
        foundation_schema_version IS NOT NULL AND foundation_schema_version = '1' AND
        foundation_canonical IS NOT NULL AND char_length(foundation_canonical) > 0 AND
        foundation_hash IS NOT NULL AND
        foundation_hash ~ '^[0-9a-f]{64}$' AND
        foundation_hash = public.rcv016_sha256_text(foundation_canonical)
      )
    ),
  CONSTRAINT chk_artifact_source_attribution_not_self_supersession
    CHECK (supersedes_statement_id IS NULL OR supersedes_statement_id <> id)
);

CREATE TABLE public.evidence_artifact_bindings (
  id UUID PRIMARY KEY,
  evidence_id UUID NOT NULL,
  artifact_version_id UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  initiator_type TEXT NULL,
  initiator_id TEXT NULL,
  rationale TEXT NULL,
  foundation_schema_id TEXT NULL,
  foundation_schema_version TEXT NULL,
  foundation_canonical TEXT NULL,
  foundation_hash TEXT NULL,
  supersedes_statement_id UUID NULL,
  payload_limits_id TEXT NOT NULL,
  payload_limits_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT fk_evidence_artifact_binding_evidence
    FOREIGN KEY (evidence_id) REFERENCES public.evidence (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_evidence_artifact_binding_artifact_version
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_evidence_artifact_binding_supersedes
    FOREIGN KEY (supersedes_statement_id)
    REFERENCES public.evidence_artifact_bindings (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_evidence_artifact_binding_payload_limits
    FOREIGN KEY (payload_limits_id, payload_limits_version)
    REFERENCES public.provenance_payload_limits (limits_id, limits_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_evidence_artifact_binding_temporal
    CHECK (valid_from IS NULL AND valid_to IS NULL),
  CONSTRAINT chk_evidence_artifact_binding_initiator
    CHECK (
      (initiator_type IS NULL AND initiator_id IS NULL) OR
      (initiator_type IS NOT NULL AND
       initiator_type IN ('human', 'system', 'importer', 'agent'))
    ),
  CONSTRAINT chk_evidence_artifact_binding_rationale
    CHECK (rationale IS NULL OR char_length(rationale) > 0),
  CONSTRAINT chk_evidence_artifact_binding_foundation
    CHECK (
      (
        foundation_schema_id IS NULL AND foundation_schema_version IS NULL AND
        foundation_canonical IS NULL AND foundation_hash IS NULL
      ) OR (
        foundation_schema_id IS NOT NULL AND
        foundation_schema_id = 'factbase-provenance-foundation' AND
        foundation_schema_version IS NOT NULL AND foundation_schema_version = '1' AND
        foundation_canonical IS NOT NULL AND char_length(foundation_canonical) > 0 AND
        foundation_hash IS NOT NULL AND
        foundation_hash ~ '^[0-9a-f]{64}$' AND
        foundation_hash = public.rcv016_sha256_text(foundation_canonical)
      )
    ),
  CONSTRAINT chk_evidence_artifact_binding_not_self_supersession
    CHECK (supersedes_statement_id IS NULL OR supersedes_statement_id <> id)
);

CREATE TABLE public.knowledge_state_statements (
  id UUID PRIMARY KEY,
  artifact_version_id UUID NOT NULL,
  scope TEXT NOT NULL,
  state TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  initiator_type TEXT NULL,
  initiator_id TEXT NULL,
  rationale TEXT NULL,
  foundation_schema_id TEXT NULL,
  foundation_schema_version TEXT NULL,
  foundation_canonical TEXT NULL,
  foundation_hash TEXT NULL,
  supersedes_statement_id UUID NULL,
  payload_limits_id TEXT NOT NULL,
  payload_limits_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT fk_knowledge_state_artifact_version
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_knowledge_state_supersedes
    FOREIGN KEY (supersedes_statement_id)
    REFERENCES public.knowledge_state_statements (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_knowledge_state_payload_limits
    FOREIGN KEY (payload_limits_id, payload_limits_version)
    REFERENCES public.provenance_payload_limits (limits_id, limits_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_knowledge_state_scope
    CHECK (scope = 'upstream_provenance'),
  CONSTRAINT chk_knowledge_state_value
    CHECK (state IN ('unknown', 'partial', 'known')),
  CONSTRAINT chk_knowledge_state_temporal
    CHECK (valid_from IS NULL AND valid_to IS NULL),
  CONSTRAINT chk_knowledge_state_initiator
    CHECK (
      (initiator_type IS NULL AND initiator_id IS NULL) OR
      (initiator_type IS NOT NULL AND
       initiator_type IN ('human', 'system', 'importer', 'agent'))
    ),
  CONSTRAINT chk_knowledge_state_rationale
    CHECK (rationale IS NULL OR char_length(rationale) > 0),
  CONSTRAINT chk_knowledge_state_foundation
    CHECK (
      (
        foundation_schema_id IS NULL AND foundation_schema_version IS NULL AND
        foundation_canonical IS NULL AND foundation_hash IS NULL
      ) OR (
        foundation_schema_id IS NOT NULL AND
        foundation_schema_id = 'factbase-provenance-foundation' AND
        foundation_schema_version IS NOT NULL AND foundation_schema_version = '1' AND
        foundation_canonical IS NOT NULL AND char_length(foundation_canonical) > 0 AND
        foundation_hash IS NOT NULL AND
        foundation_hash ~ '^[0-9a-f]{64}$' AND
        foundation_hash = public.rcv016_sha256_text(foundation_canonical)
      )
    ),
  CONSTRAINT chk_knowledge_state_not_self_supersession
    CHECK (supersedes_statement_id IS NULL OR supersedes_statement_id <> id)
);

CREATE TABLE public.provenance_snapshots (
  id UUID PRIMARY KEY,
  snapshot_schema_id TEXT NOT NULL,
  snapshot_schema_version TEXT NOT NULL,
  builder_id TEXT NOT NULL,
  builder_version TEXT NOT NULL,
  builder_artifact_hash TEXT NOT NULL,
  canonicalization_id TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  max_roots BIGINT NOT NULL,
  max_nodes BIGINT NOT NULL,
  max_edges BIGINT NOT NULL,
  max_depth BIGINT NOT NULL,
  max_canonical_snapshot_bytes BIGINT NOT NULL,
  allowed_relationships TEXT[] NOT NULL,
  deterministic_ordering TEXT NOT NULL,
  visited_semantics TEXT NOT NULL,
  snapshot_canonical TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT fk_provenance_snapshots_policy
    FOREIGN KEY (
      policy_id, policy_version, definition_hash,
      max_roots, max_nodes, max_edges, max_depth,
      max_canonical_snapshot_bytes, allowed_relationships,
      deterministic_ordering, visited_semantics
    ) REFERENCES public.provenance_traversal_policies (
      policy_id, policy_version, definition_hash,
      max_roots, max_nodes, max_edges, max_depth,
      max_canonical_snapshot_bytes, allowed_relationships,
      deterministic_ordering, visited_semantics
    ) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_provenance_snapshots_identity
    CHECK (
      snapshot_schema_id = 'factbase-provenance-snapshot' AND
      snapshot_schema_version = '1' AND
      builder_id = 'factbase-provenance-snapshot-builder' AND
      builder_version = '1' AND
      builder_artifact_hash ~ '^[0-9a-f]{64}$' AND
      canonicalization_id = 'jcs-rfc8785' AND
      canonicalization_version = '1' AND hash_algorithm = 'sha-256'
    ),
  CONSTRAINT chk_provenance_snapshots_hash
    CHECK (
      char_length(snapshot_canonical) > 0 AND
      snapshot_hash ~ '^[0-9a-f]{64}$' AND
      snapshot_hash = public.rcv016_sha256_text(snapshot_canonical)
    ),
  CONSTRAINT chk_provenance_snapshots_size
    CHECK (
      octet_length(convert_to(snapshot_canonical, 'UTF8')) <=
        max_canonical_snapshot_bytes
    )
);

CREATE TABLE public.provenance_snapshot_artifact_versions (
  snapshot_id UUID NOT NULL,
  artifact_version_id UUID NOT NULL,
  membership_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_snapshot_artifact_versions
    PRIMARY KEY (snapshot_id, artifact_version_id, membership_role),
  CONSTRAINT fk_snapshot_artifact_versions_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_snapshot_artifact_versions_target
    FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_snapshot_artifact_versions_role
    CHECK (membership_role IN ('root', 'included'))
);

CREATE TABLE public.provenance_snapshot_source_versions (
  snapshot_id UUID NOT NULL,
  source_version_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_snapshot_source_versions PRIMARY KEY (snapshot_id, source_version_id),
  CONSTRAINT fk_snapshot_source_versions_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_snapshot_source_versions_target
    FOREIGN KEY (source_version_id) REFERENCES public.provenance_source_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.provenance_snapshot_artifact_provenance_statements (
  snapshot_id UUID NOT NULL,
  artifact_provenance_statement_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_snapshot_artifact_provenance_statements
    PRIMARY KEY (snapshot_id, artifact_provenance_statement_id),
  CONSTRAINT fk_snapshot_artifact_provenance_statements_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_snapshot_artifact_provenance_statements_target
    FOREIGN KEY (artifact_provenance_statement_id)
    REFERENCES public.artifact_provenance_statements (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.provenance_snapshot_source_relationship_statements (
  snapshot_id UUID NOT NULL,
  source_relationship_statement_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_snapshot_source_relationship_statements
    PRIMARY KEY (snapshot_id, source_relationship_statement_id),
  CONSTRAINT fk_snapshot_source_relationship_statements_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_snapshot_source_relationship_statements_target
    FOREIGN KEY (source_relationship_statement_id)
    REFERENCES public.source_relationship_statements (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.provenance_snapshot_artifact_source_attributions (
  snapshot_id UUID NOT NULL,
  artifact_source_attribution_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_snapshot_artifact_source_attributions
    PRIMARY KEY (snapshot_id, artifact_source_attribution_id),
  CONSTRAINT fk_snapshot_artifact_source_attributions_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_snapshot_artifact_source_attributions_target
    FOREIGN KEY (artifact_source_attribution_id)
    REFERENCES public.artifact_source_attributions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.provenance_snapshot_evidence_artifact_bindings (
  snapshot_id UUID NOT NULL,
  evidence_artifact_binding_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_snapshot_evidence_artifact_bindings
    PRIMARY KEY (snapshot_id, evidence_artifact_binding_id),
  CONSTRAINT fk_snapshot_evidence_artifact_bindings_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_snapshot_evidence_artifact_bindings_target
    FOREIGN KEY (evidence_artifact_binding_id)
    REFERENCES public.evidence_artifact_bindings (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE public.provenance_snapshot_knowledge_state_statements (
  snapshot_id UUID NOT NULL,
  knowledge_state_statement_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT pk_snapshot_knowledge_state_statements
    PRIMARY KEY (snapshot_id, knowledge_state_statement_id),
  CONSTRAINT fk_snapshot_knowledge_state_statements_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_snapshot_knowledge_state_statements_target
    FOREIGN KEY (knowledge_state_statement_id)
    REFERENCES public.knowledge_state_statements (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE OR REPLACE FUNCTION public.rcv016_check_version_payload()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  limits_row public.provenance_payload_limits%ROWTYPE;
BEGIN
  SELECT * INTO STRICT limits_row
  FROM public.provenance_payload_limits
  WHERE limits_id = NEW.payload_limits_id
    AND limits_version = NEW.payload_limits_version;

  IF TG_TABLE_NAME = 'provenance_source_versions' THEN
    IF octet_length(convert_to(NEW.metadata_canonical, 'UTF8')) >
         limits_row.source_metadata_canonical_bytes THEN
      RAISE EXCEPTION 'RCV-016 source metadata exceeds canonical byte limit';
    END IF;
  ELSIF TG_TABLE_NAME = 'provenance_artifact_versions' THEN
    IF octet_length(convert_to(NEW.capture_canonical, 'UTF8')) >
         limits_row.artifact_capture_canonical_bytes THEN
      RAISE EXCEPTION 'RCV-016 artifact capture exceeds canonical byte limit';
    END IF;
  ELSE
    RAISE EXCEPTION 'unexpected RCV-016 version payload trigger table %', TG_TABLE_NAME;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv016_check_statement_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  limits_row public.provenance_payload_limits%ROWTYPE;
BEGIN
  SELECT * INTO STRICT limits_row
  FROM public.provenance_payload_limits
  WHERE limits_id = NEW.payload_limits_id
    AND limits_version = NEW.payload_limits_version;

  IF NEW.rationale IS NOT NULL AND (
    char_length(NEW.rationale) > limits_row.rationale_codepoints OR
    octet_length(convert_to(NEW.rationale, 'UTF8')) >
      limits_row.rationale_utf8_bytes
  ) THEN
    RAISE EXCEPTION 'RCV-016 rationale exceeds payload limits'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.foundation_canonical IS NULL THEN
    RETURN NULL;
  END IF;
  IF octet_length(convert_to(NEW.foundation_canonical, 'UTF8')) >
       limits_row.foundation_canonical_bytes THEN
    RAISE EXCEPTION 'RCV-016 Foundation exceeds canonical byte limit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv016_guard_historical_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  supersedes_id UUID;
  target_exists BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME IN (
      'artifact_provenance_statements',
      'source_relationship_statements',
      'artifact_source_attributions',
      'evidence_artifact_bindings',
      'knowledge_state_statements'
    ) THEN
      supersedes_id := NEW.supersedes_statement_id;
      IF supersedes_id IS NOT NULL THEN
        EXECUTE format(
          'SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)',
          TG_TABLE_NAME
        ) INTO target_exists USING supersedes_id;
        IF NOT target_exists THEN
          RAISE EXCEPTION 'RCV-016 Supersession target must pre-exist in family %',
            TG_TABLE_NAME
            USING ERRCODE = '23503';
        END IF;
      END IF;
    END IF;
    NEW.created_at := transaction_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'RCV-016 historical table % is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE INDEX idx_provenance_source_versions_source
  ON public.provenance_source_versions (source_id, version_number);
CREATE INDEX idx_provenance_artifact_versions_artifact
  ON public.provenance_artifact_versions (artifact_id, version_number);
CREATE INDEX idx_artifact_provenance_downstream
  ON public.artifact_provenance_statements (downstream_artifact_version_id);
CREATE INDEX idx_artifact_provenance_upstream
  ON public.artifact_provenance_statements (upstream_artifact_version_id);
CREATE INDEX idx_artifact_provenance_supersedes
  ON public.artifact_provenance_statements (supersedes_statement_id);
CREATE INDEX idx_source_relationship_subject
  ON public.source_relationship_statements (subject_source_id);
CREATE INDEX idx_source_relationship_object
  ON public.source_relationship_statements (object_source_id);
CREATE INDEX idx_source_relationship_supersedes
  ON public.source_relationship_statements (supersedes_statement_id);
CREATE INDEX idx_artifact_source_attribution_artifact
  ON public.artifact_source_attributions (artifact_version_id);
CREATE INDEX idx_artifact_source_attribution_source
  ON public.artifact_source_attributions (source_version_id);
CREATE INDEX idx_artifact_source_attribution_supersedes
  ON public.artifact_source_attributions (supersedes_statement_id);
CREATE INDEX idx_evidence_artifact_binding_evidence
  ON public.evidence_artifact_bindings (evidence_id);
CREATE INDEX idx_evidence_artifact_binding_artifact
  ON public.evidence_artifact_bindings (artifact_version_id);
CREATE INDEX idx_evidence_artifact_binding_supersedes
  ON public.evidence_artifact_bindings (supersedes_statement_id);
CREATE INDEX idx_knowledge_state_artifact
  ON public.knowledge_state_statements (artifact_version_id, scope);
CREATE INDEX idx_knowledge_state_supersedes
  ON public.knowledge_state_statements (supersedes_statement_id);
CREATE INDEX idx_snapshot_artifact_versions_target
  ON public.provenance_snapshot_artifact_versions (artifact_version_id);
CREATE INDEX idx_snapshot_source_versions_target
  ON public.provenance_snapshot_source_versions (source_version_id);
CREATE INDEX idx_snapshot_artifact_provenance_target
  ON public.provenance_snapshot_artifact_provenance_statements
    (artifact_provenance_statement_id);
CREATE INDEX idx_snapshot_source_relationship_target
  ON public.provenance_snapshot_source_relationship_statements
    (source_relationship_statement_id);
CREATE INDEX idx_snapshot_artifact_source_attribution_target
  ON public.provenance_snapshot_artifact_source_attributions
    (artifact_source_attribution_id);
CREATE INDEX idx_snapshot_evidence_binding_target
  ON public.provenance_snapshot_evidence_artifact_bindings
    (evidence_artifact_binding_id);
CREATE INDEX idx_snapshot_knowledge_state_target
  ON public.provenance_snapshot_knowledge_state_statements
    (knowledge_state_statement_id);

CREATE CONSTRAINT TRIGGER trg_rcv016_source_version_payload
AFTER INSERT ON public.provenance_source_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.rcv016_check_version_payload();

CREATE CONSTRAINT TRIGGER trg_rcv016_artifact_version_payload
AFTER INSERT ON public.provenance_artifact_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.rcv016_check_version_payload();

CREATE CONSTRAINT TRIGGER trg_rcv016_artifact_provenance_contract
AFTER INSERT ON public.artifact_provenance_statements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.rcv016_check_statement_contract();
CREATE CONSTRAINT TRIGGER trg_rcv016_source_relationship_contract
AFTER INSERT ON public.source_relationship_statements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.rcv016_check_statement_contract();
CREATE CONSTRAINT TRIGGER trg_rcv016_artifact_source_attribution_contract
AFTER INSERT ON public.artifact_source_attributions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.rcv016_check_statement_contract();
CREATE CONSTRAINT TRIGGER trg_rcv016_evidence_artifact_binding_contract
AFTER INSERT ON public.evidence_artifact_bindings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.rcv016_check_statement_contract();
CREATE CONSTRAINT TRIGGER trg_rcv016_knowledge_state_contract
AFTER INSERT ON public.knowledge_state_statements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.rcv016_check_statement_contract();

CREATE TRIGGER trg_rcv016_guard_provenance_sources
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_sources
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_provenance_source_versions
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_source_versions
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_provenance_artifacts
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_artifacts
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_provenance_artifact_versions
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_artifact_versions
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_artifact_provenance_statements
BEFORE INSERT OR UPDATE OR DELETE ON public.artifact_provenance_statements
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_source_relationship_statements
BEFORE INSERT OR UPDATE OR DELETE ON public.source_relationship_statements
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_artifact_source_attributions
BEFORE INSERT OR UPDATE OR DELETE ON public.artifact_source_attributions
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_evidence_artifact_bindings
BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_artifact_bindings
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_knowledge_state_statements
BEFORE INSERT OR UPDATE OR DELETE ON public.knowledge_state_statements
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_provenance_snapshots
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_snapshots
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_snapshot_artifact_versions
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_snapshot_artifact_versions
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_snapshot_source_versions
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_snapshot_source_versions
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_snapshot_artifact_provenance_statements
BEFORE INSERT OR UPDATE OR DELETE
ON public.provenance_snapshot_artifact_provenance_statements
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_snapshot_source_relationship_statements
BEFORE INSERT OR UPDATE OR DELETE
ON public.provenance_snapshot_source_relationship_statements
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_snapshot_artifact_source_attributions
BEFORE INSERT OR UPDATE OR DELETE
ON public.provenance_snapshot_artifact_source_attributions
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_snapshot_evidence_artifact_bindings
BEFORE INSERT OR UPDATE OR DELETE
ON public.provenance_snapshot_evidence_artifact_bindings
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_snapshot_knowledge_state_statements
BEFORE INSERT OR UPDATE OR DELETE
ON public.provenance_snapshot_knowledge_state_statements
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_provenance_traversal_policies
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_traversal_policies
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();
CREATE TRIGGER trg_rcv016_guard_provenance_payload_limits
BEFORE INSERT OR UPDATE OR DELETE ON public.provenance_payload_limits
FOR EACH ROW EXECUTE FUNCTION public.rcv016_guard_historical_row();

COMMIT;
