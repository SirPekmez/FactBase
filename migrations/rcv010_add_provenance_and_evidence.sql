-- RCV-010 provenance, version-bound evidence and explainable assessments.
-- Apply only after rcv009_create_claims_and_claim_versions.sql.

BEGIN;

ALTER TABLE public.claim_versions
  ADD COLUMN based_on_version_id UUID NULL,
  ADD COLUMN actor_type TEXT NULL,
  ADD COLUMN actor_id TEXT NULL,
  ADD COLUMN source_type TEXT NULL,
  ADD COLUMN source_reference TEXT NULL,
  ADD COLUMN request_id UUID NULL,
  ADD CONSTRAINT fk_claim_versions_based_on_version
    FOREIGN KEY (based_on_version_id)
    REFERENCES public.claim_versions (id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION;

CREATE INDEX idx_claim_versions_based_on_version_id
  ON public.claim_versions (based_on_version_id);

CREATE INDEX idx_claim_versions_request_id
  ON public.claim_versions (request_id);

CREATE TABLE public.evidence (
  id UUID PRIMARY KEY,
  source_url TEXT NULL,
  source_title TEXT NULL,
  source_type TEXT NULL,
  locator TEXT NULL,
  quoted_text TEXT NULL,
  snapshot_hash TEXT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE public.claim_version_evidence (
  id UUID PRIMARY KEY,
  claim_version_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  relation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT fk_claim_version_evidence_claim_version
    FOREIGN KEY (claim_version_id)
    REFERENCES public.claim_versions (id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT fk_claim_version_evidence_evidence
    FOREIGN KEY (evidence_id)
    REFERENCES public.evidence (id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT uq_claim_version_evidence_version_evidence
    UNIQUE (claim_version_id, evidence_id),

  CONSTRAINT chk_claim_version_evidence_relation
    CHECK (relation IN ('supports', 'contradicts', 'contextualizes'))
);

CREATE INDEX idx_claim_version_evidence_evidence_id
  ON public.claim_version_evidence (evidence_id);

CREATE TABLE public.evidence_assessments (
  id UUID PRIMARY KEY,
  claim_version_evidence_id UUID NOT NULL,
  source_quality NUMERIC NULL,
  relevance NUMERIC NULL,
  directness NUMERIC NULL,
  recency NUMERIC NULL,
  independence NUMERIC NULL,
  assessment_method TEXT NULL,
  rationale TEXT NULL,
  assessed_by TEXT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT fk_evidence_assessments_claim_version_evidence
    FOREIGN KEY (claim_version_evidence_id)
    REFERENCES public.claim_version_evidence (id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT chk_evidence_assessments_source_quality
    CHECK (
      source_quality IS NULL OR
      (source_quality >= 0 AND source_quality <= 1 AND source_quality <> 'NaN'::NUMERIC)
    ),
  CONSTRAINT chk_evidence_assessments_relevance
    CHECK (
      relevance IS NULL OR
      (relevance >= 0 AND relevance <= 1 AND relevance <> 'NaN'::NUMERIC)
    ),
  CONSTRAINT chk_evidence_assessments_directness
    CHECK (
      directness IS NULL OR
      (directness >= 0 AND directness <= 1 AND directness <> 'NaN'::NUMERIC)
    ),
  CONSTRAINT chk_evidence_assessments_recency
    CHECK (
      recency IS NULL OR
      (recency >= 0 AND recency <= 1 AND recency <> 'NaN'::NUMERIC)
    ),
  CONSTRAINT chk_evidence_assessments_independence
    CHECK (
      independence IS NULL OR
      (independence >= 0 AND independence <= 1 AND independence <> 'NaN'::NUMERIC)
    )
);

CREATE INDEX idx_evidence_assessments_relation_id
  ON public.evidence_assessments (claim_version_evidence_id);

COMMIT;
