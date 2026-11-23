CREATE TABLE fda_tenants (
  tenant_id text PRIMARY KEY,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE fda_sources (
  tenant_id text NOT NULL REFERENCES fda_tenants (tenant_id),
  source_id text NOT NULL,
  credential_ref text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, source_id)
);

CREATE TABLE fda_source_events (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  source_record_id text NOT NULL,
  envelope jsonb NOT NULL,
  payload_fingerprint text NOT NULL CHECK (length(payload_fingerprint) = 64),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'processing_failed')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  PRIMARY KEY (tenant_id, source_id, source_record_id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES fda_sources (tenant_id, source_id)
);

CREATE TABLE fda_canonical_records (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  source_record_id text NOT NULL,
  record_type text NOT NULL,
  subject_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (tenant_id, source_id, source_record_id),
  UNIQUE (tenant_id, source_id, source_record_id, id),
  FOREIGN KEY (tenant_id, source_id, source_record_id)
    REFERENCES fda_source_events (tenant_id, source_id, source_record_id)
);

CREATE INDEX fda_canonical_subject_idx
  ON fda_canonical_records (tenant_id, source_id, record_type, subject_id, occurred_at DESC);

CREATE TABLE fda_ingestion_receipts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  source_record_id text,
  record_type text,
  schema_version text,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  actor_role text NOT NULL DEFAULT 'synthetic-source',
  validation text NOT NULL CHECK (validation IN ('valid', 'invalid')),
  status text NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'duplicate', 'rejected', 'conflict', 'processing_failed')),
  error_code text,
  payload_fingerprint text NOT NULL CHECK (length(payload_fingerprint) = 64),
  source_revision text,
  correlation_id text,
  application_revision text,
  processing_revision text,
  canonical_id uuid,
  FOREIGN KEY (tenant_id, source_id) REFERENCES fda_sources (tenant_id, source_id),
  FOREIGN KEY (tenant_id, source_id, source_record_id, canonical_id)
    REFERENCES fda_canonical_records (tenant_id, source_id, source_record_id, id)
);

CREATE INDEX fda_receipts_recent_idx ON fda_ingestion_receipts (tenant_id, source_id, received_at DESC, id);
CREATE UNIQUE INDEX fda_processed_receipt_idx ON fda_ingestion_receipts (canonical_id) WHERE status = 'processed';
