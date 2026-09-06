-- RCV-018 Evidence Contradiction Analysis V1 physical schema.
-- Pure materialization of the frozen RCV-018 Contract and Guardrails.

BEGIN;

CREATE TABLE public.rcv018_value_domains (
  value_domain_id UUID NOT NULL,
  value_domain_version BIGINT NOT NULL,
  kind TEXT NOT NULL,
  canonical TEXT NOT NULL,
  value_domain_hash TEXT NOT NULL,
  PRIMARY KEY (value_domain_id, value_domain_version),
  CHECK (value_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (kind = 'CLOSED_SYMBOLIC_STATE'),
  CHECK (value_domain_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv018_value_domain_values (
  value_domain_id UUID NOT NULL,
  value_domain_version BIGINT NOT NULL,
  ordinal BIGINT NOT NULL,
  value VARCHAR(128) NOT NULL,
  PRIMARY KEY (value_domain_id, value_domain_version, ordinal),
  UNIQUE (value_domain_id, value_domain_version, value),
  FOREIGN KEY (value_domain_id, value_domain_version)
    REFERENCES public.rcv018_value_domains (value_domain_id, value_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (value_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (ordinal >= 0),
  CHECK (value ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(value) BETWEEN 1 AND 128)
);

CREATE TABLE public.rcv018_comparison_domains (
  comparison_domain_id UUID NOT NULL,
  comparison_domain_version BIGINT NOT NULL,
  property_id UUID NOT NULL,
  value_domain_id UUID NOT NULL,
  value_domain_version BIGINT NOT NULL,
  value_domain_hash TEXT NOT NULL,
  rule_family TEXT NOT NULL,
  canonical TEXT NOT NULL,
  comparison_domain_hash TEXT NOT NULL,
  PRIMARY KEY (comparison_domain_id, comparison_domain_version),
  FOREIGN KEY (value_domain_id, value_domain_version)
    REFERENCES public.rcv018_value_domains (value_domain_id, value_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (comparison_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (value_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (value_domain_hash ~ '^[0-9a-f]{64}$'),
  CHECK (comparison_domain_hash ~ '^[0-9a-f]{64}$'),
  CHECK (rule_family = 'EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR')
);

CREATE TABLE public.rcv018_comparison_domain_keys (
  comparison_domain_id UUID NOT NULL,
  comparison_domain_version BIGINT NOT NULL,
  ordinal BIGINT NOT NULL,
  key VARCHAR(128) NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (comparison_domain_id, comparison_domain_version, ordinal),
  UNIQUE (comparison_domain_id, comparison_domain_version, key),
  FOREIGN KEY (comparison_domain_id, comparison_domain_version)
    REFERENCES public.rcv018_comparison_domains (comparison_domain_id, comparison_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (comparison_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (ordinal >= 0),
  CHECK (key ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(key) BETWEEN 1 AND 128),
  CHECK (type IN ('UUID', 'TOKEN'))
);

CREATE TABLE public.rcv018_incompatibility_pairs (
  comparison_domain_id UUID NOT NULL,
  comparison_domain_version BIGINT NOT NULL,
  ordinal BIGINT NOT NULL,
  left_value VARCHAR(128) NOT NULL,
  right_value VARCHAR(128) NOT NULL,
  PRIMARY KEY (comparison_domain_id, comparison_domain_version, ordinal),
  UNIQUE (comparison_domain_id, comparison_domain_version, left_value, right_value),
  FOREIGN KEY (comparison_domain_id, comparison_domain_version)
    REFERENCES public.rcv018_comparison_domains (comparison_domain_id, comparison_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (comparison_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (ordinal >= 0),
  CHECK (left_value ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (right_value ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(left_value) BETWEEN 1 AND 128),
  CHECK (char_length(right_value) BETWEEN 1 AND 128),
  CHECK (left_value <> right_value)
);

CREATE TABLE public.rcv018_evidence_assertions (
  assertion_id UUID NOT NULL PRIMARY KEY,
  subject_id UUID NOT NULL,
  property_id UUID NOT NULL,
  comparison_domain_id UUID NOT NULL,
  comparison_domain_version BIGINT NOT NULL,
  comparison_domain_hash TEXT NOT NULL,
  value_domain_id UUID NOT NULL,
  value_domain_version BIGINT NOT NULL,
  value_domain_hash TEXT NOT NULL,
  value VARCHAR(128) NOT NULL,
  canonical TEXT NOT NULL,
  assertion_hash TEXT NOT NULL,
  FOREIGN KEY (comparison_domain_id, comparison_domain_version)
    REFERENCES public.rcv018_comparison_domains (comparison_domain_id, comparison_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (value_domain_id, value_domain_version)
    REFERENCES public.rcv018_value_domains (value_domain_id, value_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (comparison_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (value_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (comparison_domain_hash ~ '^[0-9a-f]{64}$'),
  CHECK (value_domain_hash ~ '^[0-9a-f]{64}$'),
  CHECK (assertion_hash ~ '^[0-9a-f]{64}$'),
  CHECK (value ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(value) BETWEEN 1 AND 128)
);

CREATE TABLE public.rcv018_assertion_context (
  assertion_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  key VARCHAR(128) NOT NULL,
  type TEXT NOT NULL,
  uuid_value UUID NULL,
  token_value VARCHAR(128) NULL,
  PRIMARY KEY (assertion_id, ordinal),
  UNIQUE (assertion_id, key),
  FOREIGN KEY (assertion_id)
    REFERENCES public.rcv018_evidence_assertions (assertion_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (ordinal >= 0),
  CHECK (key ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(key) BETWEEN 1 AND 128),
  CHECK (type IN ('UUID', 'TOKEN')),
  CHECK (
    (type = 'UUID' AND uuid_value IS NOT NULL AND token_value IS NULL)
    OR
    (type = 'TOKEN' AND token_value IS NOT NULL AND uuid_value IS NULL
      AND token_value ~ '^[A-Za-z0-9._:-]+$'
      AND char_length(token_value) BETWEEN 1 AND 128)
  )
);

CREATE TABLE public.rcv018_assertion_evidence_basis (
  assertion_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  evidence_relation_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  artifact_version_id UUID NOT NULL,
  statement_kind TEXT NOT NULL,
  statement_id UUID NOT NULL,
  PRIMARY KEY (assertion_id, ordinal),
  UNIQUE (
    assertion_id, evidence_relation_id, evidence_id, artifact_version_id,
    statement_kind, statement_id
  ),
  FOREIGN KEY (assertion_id)
    REFERENCES public.rcv018_evidence_assertions (assertion_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (evidence_relation_id)
    REFERENCES public.claim_version_evidence (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (evidence_id)
    REFERENCES public.evidence (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (ordinal >= 0),
  CHECK (statement_kind IN (
    'ArtifactProvenanceStatement',
    'SourceRelationshipStatement',
    'ArtifactSourceAttribution',
    'EvidenceArtifactBinding',
    'KnowledgeStateStatement'
  ))
);

CREATE TABLE public.rcv018_assertion_historical_bindings (
  assertion_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  kind TEXT NOT NULL,
  claim_version_id UUID NULL,
  statement_kind TEXT NULL,
  statement_id UUID NULL,
  artifact_version_id UUID NULL,
  rcv016_snapshot_id UUID NULL,
  rcv016_snapshot_hash TEXT NULL,
  rcv017_analysis_id UUID NULL,
  rcv017_analysis_hash TEXT NULL,
  PRIMARY KEY (assertion_id, ordinal),
  FOREIGN KEY (assertion_id)
    REFERENCES public.rcv018_evidence_assertions (assertion_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (claim_version_id)
    REFERENCES public.claim_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (artifact_version_id)
    REFERENCES public.provenance_artifact_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (rcv016_snapshot_id)
    REFERENCES public.provenance_snapshots (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (rcv017_analysis_id)
    REFERENCES public.claim_evidence_dependency_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (ordinal >= 0),
  CHECK (kind IN (
    'CLAIM_VERSION', 'STATEMENT', 'ARTIFACT_VERSION',
    'RCV016_SNAPSHOT', 'RCV017_ANALYSIS'
  )),
  CHECK (statement_kind IS NULL OR statement_kind IN (
    'ArtifactProvenanceStatement',
    'SourceRelationshipStatement',
    'ArtifactSourceAttribution',
    'EvidenceArtifactBinding',
    'KnowledgeStateStatement'
  )),
  CHECK (rcv016_snapshot_hash IS NULL OR rcv016_snapshot_hash ~ '^[0-9a-f]{64}$'),
  CHECK (rcv017_analysis_hash IS NULL OR rcv017_analysis_hash ~ '^[0-9a-f]{64}$'),
  CHECK (
    (kind = 'CLAIM_VERSION'
      AND claim_version_id IS NOT NULL
      AND statement_kind IS NULL AND statement_id IS NULL
      AND artifact_version_id IS NULL
      AND rcv016_snapshot_id IS NULL AND rcv016_snapshot_hash IS NULL
      AND rcv017_analysis_id IS NULL AND rcv017_analysis_hash IS NULL)
    OR
    (kind = 'STATEMENT'
      AND claim_version_id IS NULL
      AND statement_kind IS NOT NULL AND statement_id IS NOT NULL
      AND artifact_version_id IS NULL
      AND rcv016_snapshot_id IS NULL AND rcv016_snapshot_hash IS NULL
      AND rcv017_analysis_id IS NULL AND rcv017_analysis_hash IS NULL)
    OR
    (kind = 'ARTIFACT_VERSION'
      AND claim_version_id IS NULL
      AND statement_kind IS NULL AND statement_id IS NULL
      AND artifact_version_id IS NOT NULL
      AND rcv016_snapshot_id IS NULL AND rcv016_snapshot_hash IS NULL
      AND rcv017_analysis_id IS NULL AND rcv017_analysis_hash IS NULL)
    OR
    (kind = 'RCV016_SNAPSHOT'
      AND claim_version_id IS NULL
      AND statement_kind IS NULL AND statement_id IS NULL
      AND artifact_version_id IS NULL
      AND rcv016_snapshot_id IS NOT NULL AND rcv016_snapshot_hash IS NOT NULL
      AND rcv017_analysis_id IS NULL AND rcv017_analysis_hash IS NULL)
    OR
    (kind = 'RCV017_ANALYSIS'
      AND claim_version_id IS NULL
      AND statement_kind IS NULL AND statement_id IS NULL
      AND artifact_version_id IS NULL
      AND rcv016_snapshot_id IS NULL AND rcv016_snapshot_hash IS NULL
      AND rcv017_analysis_id IS NOT NULL AND rcv017_analysis_hash IS NOT NULL)
  )
);

CREATE TABLE public.rcv018_contradiction_findings (
  finding_hash TEXT NOT NULL PRIMARY KEY,
  assertion_a_id UUID NOT NULL,
  assertion_a_hash TEXT NOT NULL,
  assertion_b_id UUID NOT NULL,
  assertion_b_hash TEXT NOT NULL,
  comparison_domain_id UUID NOT NULL,
  comparison_domain_version BIGINT NOT NULL,
  comparison_domain_hash TEXT NOT NULL,
  incompatibility_left VARCHAR(128) NOT NULL,
  incompatibility_right VARCHAR(128) NOT NULL,
  canonical TEXT NOT NULL,
  FOREIGN KEY (assertion_a_id)
    REFERENCES public.rcv018_evidence_assertions (assertion_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (assertion_b_id)
    REFERENCES public.rcv018_evidence_assertions (assertion_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (comparison_domain_id, comparison_domain_version)
    REFERENCES public.rcv018_comparison_domains (comparison_domain_id, comparison_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (finding_hash ~ '^[0-9a-f]{64}$'),
  CHECK (assertion_a_hash ~ '^[0-9a-f]{64}$'),
  CHECK (assertion_b_hash ~ '^[0-9a-f]{64}$'),
  CHECK (comparison_domain_hash ~ '^[0-9a-f]{64}$'),
  CHECK (comparison_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (incompatibility_left ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (incompatibility_right ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(incompatibility_left) BETWEEN 1 AND 128),
  CHECK (char_length(incompatibility_right) BETWEEN 1 AND 128),
  CHECK (assertion_a_id <> assertion_b_id),
  CHECK (incompatibility_left <> incompatibility_right)
);

CREATE TABLE public.rcv018_analyses (
  analysis_id UUID NOT NULL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  contract_version BIGINT NOT NULL,
  contract_hash TEXT NOT NULL,
  algorithm_id TEXT NOT NULL,
  algorithm_version BIGINT NOT NULL,
  algorithm_hash TEXT NOT NULL,
  canonical TEXT NOT NULL,
  analysis_hash TEXT NOT NULL,
  CHECK (contract_version BETWEEN 1 AND 9007199254740991),
  CHECK (algorithm_version BETWEEN 1 AND 9007199254740991),
  CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  CHECK (algorithm_hash ~ '^[0-9a-f]{64}$'),
  CHECK (analysis_hash ~ '^[0-9a-f]{64}$'),
  CHECK (char_length(contract_id) > 0),
  CHECK (char_length(algorithm_id) > 0)
);

CREATE TABLE public.rcv018_analysis_assertions (
  analysis_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  assertion_id UUID NOT NULL,
  assertion_hash TEXT NOT NULL,
  PRIMARY KEY (analysis_id, ordinal),
  UNIQUE (analysis_id, assertion_id),
  FOREIGN KEY (analysis_id)
    REFERENCES public.rcv018_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (assertion_id)
    REFERENCES public.rcv018_evidence_assertions (assertion_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (ordinal >= 0),
  CHECK (assertion_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv018_analysis_value_domains (
  analysis_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  value_domain_id UUID NOT NULL,
  value_domain_version BIGINT NOT NULL,
  value_domain_hash TEXT NOT NULL,
  PRIMARY KEY (analysis_id, ordinal),
  UNIQUE (analysis_id, value_domain_id, value_domain_version),
  FOREIGN KEY (analysis_id)
    REFERENCES public.rcv018_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (value_domain_id, value_domain_version)
    REFERENCES public.rcv018_value_domains (value_domain_id, value_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (ordinal >= 0),
  CHECK (value_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (value_domain_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv018_analysis_comparison_domains (
  analysis_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  comparison_domain_id UUID NOT NULL,
  comparison_domain_version BIGINT NOT NULL,
  comparison_domain_hash TEXT NOT NULL,
  PRIMARY KEY (analysis_id, ordinal),
  UNIQUE (analysis_id, comparison_domain_id, comparison_domain_version),
  FOREIGN KEY (analysis_id)
    REFERENCES public.rcv018_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (comparison_domain_id, comparison_domain_version)
    REFERENCES public.rcv018_comparison_domains (comparison_domain_id, comparison_domain_version)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (ordinal >= 0),
  CHECK (comparison_domain_version BETWEEN 1 AND 9007199254740991),
  CHECK (comparison_domain_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv018_analysis_findings (
  analysis_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  finding_hash TEXT NOT NULL,
  PRIMARY KEY (analysis_id, ordinal),
  UNIQUE (analysis_id, finding_hash),
  FOREIGN KEY (analysis_id)
    REFERENCES public.rcv018_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (finding_hash)
    REFERENCES public.rcv018_contradiction_findings (finding_hash)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (ordinal >= 0),
  CHECK (finding_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX uq_rcv018_binding_claim_version
  ON public.rcv018_assertion_historical_bindings (assertion_id, claim_version_id)
  WHERE kind = 'CLAIM_VERSION';

CREATE UNIQUE INDEX uq_rcv018_binding_statement
  ON public.rcv018_assertion_historical_bindings (assertion_id, statement_kind, statement_id)
  WHERE kind = 'STATEMENT';

CREATE UNIQUE INDEX uq_rcv018_binding_artifact_version
  ON public.rcv018_assertion_historical_bindings (assertion_id, artifact_version_id)
  WHERE kind = 'ARTIFACT_VERSION';

CREATE UNIQUE INDEX uq_rcv018_binding_rcv016_snapshot
  ON public.rcv018_assertion_historical_bindings (
    assertion_id, rcv016_snapshot_id, rcv016_snapshot_hash
  )
  WHERE kind = 'RCV016_SNAPSHOT';

CREATE UNIQUE INDEX uq_rcv018_binding_rcv017_analysis
  ON public.rcv018_assertion_historical_bindings (
    assertion_id, rcv017_analysis_id, rcv017_analysis_hash
  )
  WHERE kind = 'RCV017_ANALYSIS';

COMMIT;
