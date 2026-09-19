-- Claim Historical Authority v1 additive schema.
-- Apply after rcv009_create_claims_and_claim_versions.sql.

BEGIN;

CREATE TABLE public.claim_identity_authorities (
  claim_id UUID PRIMARY KEY,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  CONSTRAINT fk_claim_identity_authorities_claim
    FOREIGN KEY (claim_id)
    REFERENCES public.claims (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_claim_identity_authorities_canonical_version
    CHECK (canonical_version = 1),
  CONSTRAINT chk_claim_identity_authorities_canonical_hash
    CHECK (canonical_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.claim_version_authorities (
  claim_version_id UUID PRIMARY KEY,
  claim_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  normalized_statement TEXT NOT NULL,
  language TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  canonical_version INTEGER NOT NULL,
  canonical TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  CONSTRAINT fk_claim_version_authorities_claim_version
    FOREIGN KEY (claim_version_id)
    REFERENCES public.claim_versions (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_claim_version_authorities_claim
    FOREIGN KEY (claim_id)
    REFERENCES public.claims (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_claim_version_authorities_identity
    FOREIGN KEY (claim_id)
    REFERENCES public.claim_identity_authorities (claim_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT uq_claim_version_authorities_claim_version
    UNIQUE (claim_id, version_number),
  CONSTRAINT chk_claim_version_authorities_version_number
    CHECK (version_number > 0),
  CONSTRAINT chk_claim_version_authorities_canonical_version
    CHECK (canonical_version = 1),
  CONSTRAINT chk_claim_version_authorities_canonical_hash
    CHECK (canonical_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_claim_version_authorities_claim_id
  ON public.claim_version_authorities (claim_id);

CREATE OR REPLACE FUNCTION public.claim_historical_authority_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Claim Historical Authority rows are immutable: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_historical_source_guard_authenticated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'claims' THEN
    IF EXISTS (
      SELECT 1
      FROM public.claim_identity_authorities
      WHERE claim_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'Authenticated Claim identity is immutable: %', OLD.id
        USING ERRCODE = '55000';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_TABLE_NAME = 'claim_versions' THEN
    IF EXISTS (
      SELECT 1
      FROM public.claim_version_authorities
      WHERE claim_version_id = OLD.id
    ) THEN
      IF TG_OP = 'DELETE'
        OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.claim_id IS DISTINCT FROM OLD.claim_id
        OR NEW.version_number IS DISTINCT FROM OLD.version_number
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.normalized_statement IS DISTINCT FROM OLD.normalized_statement
        OR NEW.language IS DISTINCT FROM OLD.language
        OR NEW.claim_type IS DISTINCT FROM OLD.claim_type
      THEN
        RAISE EXCEPTION 'Authenticated ClaimVersion identity/content is immutable: %', OLD.id
          USING ERRCODE = '55000';
      END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION 'Unexpected Claim Historical Authority source table: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_claim_identity_authority_immutable
BEFORE UPDATE OR DELETE ON public.claim_identity_authorities
FOR EACH ROW EXECUTE FUNCTION public.claim_historical_authority_guard_immutable();

CREATE TRIGGER trg_claim_version_authority_immutable
BEFORE UPDATE OR DELETE ON public.claim_version_authorities
FOR EACH ROW EXECUTE FUNCTION public.claim_historical_authority_guard_immutable();

CREATE TRIGGER trg_claim_authenticated_source_protection
BEFORE UPDATE OR DELETE ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.claim_historical_source_guard_authenticated();

CREATE TRIGGER trg_claim_version_authenticated_source_protection
BEFORE UPDATE OR DELETE ON public.claim_versions
FOR EACH ROW EXECUTE FUNCTION public.claim_historical_source_guard_authenticated();

COMMIT;
