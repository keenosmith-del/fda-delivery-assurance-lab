ALTER TABLE fda_ingestion_receipts ADD CONSTRAINT fda_receipt_scope_key UNIQUE (tenant_id, source_id, id);

CREATE TABLE fda_agent_incidents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  endpoint_id text NOT NULL CHECK (endpoint_id ~ '^endpoint-[0-9]{3,8}$'),
  window_id text NOT NULL CHECK (window_id ~ '^window-[0-9]{3,8}$'),
  category text NOT NULL CHECK (category IN ('reporting-interruption', 'stale-observations', 'missing-coverage', 'capture-permissions', 'version-readiness', 'delivery-backlog')),
  condition_since timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'investigating', 'intervention_planned', 'awaiting_verification', 'resolved')),
  detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  implemented_at timestamptz,
  resolved_at timestamptz,
  verified_through timestamptz,
  initial jsonb NOT NULL,
  UNIQUE (tenant_id, source_id, id),
  UNIQUE (tenant_id, source_id, endpoint_id, window_id, category, condition_since),
  CHECK ((state = 'resolved') = (resolved_at IS NOT NULL AND verified_through IS NOT NULL)),
  CHECK ((state IN ('awaiting_verification', 'resolved')) = (implemented_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, source_id) REFERENCES fda_sources (tenant_id, source_id)
);

CREATE UNIQUE INDEX fda_agent_one_active_condition
  ON fda_agent_incidents (tenant_id, source_id, endpoint_id, window_id, category) WHERE state <> 'resolved';

CREATE TABLE fda_agent_incident_audit (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  incident_id uuid NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  action text NOT NULL CHECK (action IN ('detect', 'diagnose', 'plan', 'implement', 'verify')),
  before_state text,
  after_state text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('operator', 'local-token', 'local-open')),
  revision text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detail jsonb NOT NULL,
  UNIQUE (tenant_id, source_id, id),
  FOREIGN KEY (tenant_id, source_id, incident_id) REFERENCES fda_agent_incidents (tenant_id, source_id, id)
);

CREATE INDEX fda_incident_audit_history ON fda_agent_incident_audit (tenant_id, source_id, incident_id, sequence);

CREATE TABLE fda_agent_incident_evidence (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  audit_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  PRIMARY KEY (audit_id, receipt_id),
  FOREIGN KEY (tenant_id, source_id, audit_id) REFERENCES fda_agent_incident_audit (tenant_id, source_id, id),
  FOREIGN KEY (tenant_id, source_id, receipt_id) REFERENCES fda_ingestion_receipts (tenant_id, source_id, id)
);
