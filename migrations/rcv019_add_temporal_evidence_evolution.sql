-- RCV-019 Temporal Evidence Evolution V1 physical schema.
-- Apply only after rcv018_add_evidence_contradiction_analysis.sql.

BEGIN;

CREATE TABLE public.rcv019_temporal_evidence_analyses (
  analysis_id UUID PRIMARY KEY,
  claim_id UUID NOT NULL,
  contract_version BIGINT NOT NULL,
  canonical TEXT NOT NULL,
  timeline_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_rcv019_analysis_claim
    FOREIGN KEY (claim_id) REFERENCES public.claims (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_rcv019_analysis_contract_version
    CHECK (contract_version = 1),
  CONSTRAINT chk_rcv019_analysis_hash
    CHECK (timeline_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv019_temporal_evidence_points (
  point_id UUID PRIMARY KEY,
  analysis_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  claim_id UUID NOT NULL,
  claim_version_id UUID NOT NULL,
  knowledge_at TIMESTAMPTZ NOT NULL,
  state_version BIGINT NOT NULL,
  state_canonical TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  CONSTRAINT fk_rcv019_point_analysis
    FOREIGN KEY (analysis_id) REFERENCES public.rcv019_temporal_evidence_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv019_point_claim
    FOREIGN KEY (claim_id) REFERENCES public.claims (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_rcv019_point_claim_version
    FOREIGN KEY (claim_version_id) REFERENCES public.claim_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT uq_rcv019_point_analysis_ordinal UNIQUE (analysis_id, ordinal),
  CONSTRAINT chk_rcv019_point_ordinal CHECK (ordinal >= 0),
  CONSTRAINT chk_rcv019_point_state_version CHECK (state_version = 1),
  CONSTRAINT chk_rcv019_point_hash CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_rcv019_point_knowledge_precision
    CHECK (knowledge_at = date_trunc('microseconds', knowledge_at))
);

CREATE TABLE public.rcv019_temporal_evidence_point_facets (
  point_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  facet_kind TEXT NOT NULL,
  facet_id UUID NOT NULL,
  facet_version BIGINT NOT NULL,
  facet_hash TEXT NOT NULL,
  PRIMARY KEY (point_id, ordinal),
  FOREIGN KEY (point_id) REFERENCES public.rcv019_temporal_evidence_points (point_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  UNIQUE (point_id, facet_kind, facet_id, facet_version),
  CHECK (ordinal >= 0),
  CHECK (facet_kind IN (
    'RCV011_ASSESSMENT', 'RCV013_READ_PROJECTION', 'RCV014_RUBRIC_COMPARISON',
    'RCV015_DERIVATION', 'RCV017_ANALYSIS', 'RCV018_ANALYSIS'
  )),
  CHECK (facet_version >= 1 AND facet_version <= 9007199254740991),
  CHECK (facet_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv019_temporal_evidence_transitions (
  analysis_id UUID NOT NULL,
  ordinal BIGINT NOT NULL,
  from_point_id UUID NOT NULL,
  to_point_id UUID NOT NULL,
  transition_version BIGINT NOT NULL,
  change_types JSONB NOT NULL,
  PRIMARY KEY (analysis_id, ordinal),
  FOREIGN KEY (analysis_id) REFERENCES public.rcv019_temporal_evidence_analyses (analysis_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (from_point_id) REFERENCES public.rcv019_temporal_evidence_points (point_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (to_point_id) REFERENCES public.rcv019_temporal_evidence_points (point_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  UNIQUE (analysis_id, from_point_id, to_point_id),
  CHECK (ordinal >= 0),
  CHECK (transition_version = 1),
  CHECK (jsonb_typeof(change_types) = 'array'),
  CHECK (jsonb_array_length(change_types) >= 1),
  CHECK (NOT (from_point_id = to_point_id))
);

CREATE INDEX idx_rcv019_analysis_claim
  ON public.rcv019_temporal_evidence_analyses (claim_id);
CREATE INDEX idx_rcv019_points_analysis_knowledge
  ON public.rcv019_temporal_evidence_points (analysis_id, knowledge_at);
CREATE INDEX idx_rcv019_facets_lookup
  ON public.rcv019_temporal_evidence_point_facets (point_id, facet_kind, facet_id);

CREATE OR REPLACE FUNCTION public.rcv019_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'RCV-019 historical rows are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rcv019_immutable_analyses
BEFORE UPDATE OR DELETE ON public.rcv019_temporal_evidence_analyses
FOR EACH ROW EXECUTE FUNCTION public.rcv019_guard_immutable();
CREATE TRIGGER trg_rcv019_immutable_points
BEFORE UPDATE OR DELETE ON public.rcv019_temporal_evidence_points
FOR EACH ROW EXECUTE FUNCTION public.rcv019_guard_immutable();
CREATE TRIGGER trg_rcv019_immutable_facets
BEFORE UPDATE OR DELETE ON public.rcv019_temporal_evidence_point_facets
FOR EACH ROW EXECUTE FUNCTION public.rcv019_guard_immutable();
CREATE TRIGGER trg_rcv019_immutable_transitions
BEFORE UPDATE OR DELETE ON public.rcv019_temporal_evidence_transitions
FOR EACH ROW EXECUTE FUNCTION public.rcv019_guard_immutable();

COMMIT;
