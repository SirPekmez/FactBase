-- RCV-009 schema-only migration (claims + claim_versions)
-- Do NOT apply automatically; review only.

CREATE TABLE claims (
  id UUID PRIMARY KEY
);

CREATE TABLE claim_versions (
  id UUID PRIMARY KEY,
  claim_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  normalized_statement TEXT NOT NULL,
  language TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL,
  publication_status TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT fk_claim_versions_claim
    FOREIGN KEY (claim_id)
    REFERENCES claims (id)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,

  CONSTRAINT uq_claim_versions_claimid_version UNIQUE (claim_id, version_number),
  CONSTRAINT chk_claim_versions_version_positive CHECK (version_number > 0)
);
