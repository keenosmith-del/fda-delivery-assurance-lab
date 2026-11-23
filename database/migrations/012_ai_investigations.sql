CREATE TABLE fda_investigations (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  assessment_revision integer NOT NULL,
  decision_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  question text NOT NULL,
  selection jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('evidence-only','disabled','insufficient-evidence','running','ready','validation-failed','failed','reviewed','rejected','needs-evidence','closed','superseded')),
  evidence_fingerprint text NOT NULL,
  retrieval_version text NOT NULL,
  application_revision text,
  actor_role text NOT NULL,
  review_revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deadline_at timestamptz,
  PRIMARY KEY (tenant_id, source_id, id),
  UNIQUE (tenant_id, source_id, request_id),
  FOREIGN KEY (tenant_id, source_id, case_id, assessment_id, assessment_revision, decision_id)
    REFERENCES fda_workflow_delivery_cases (tenant_id, source_id, id, assessment_id, revision, decision_id)
);
CREATE INDEX fda_investigations_case ON fda_investigations (tenant_id, source_id, case_id, created_at DESC);
CREATE INDEX fda_investigations_limits ON fda_investigations (tenant_id, source_id, actor_role, created_at DESC);
CREATE INDEX fda_investigations_running ON fda_investigations (tenant_id, source_id, deadline_at) WHERE status='running';

CREATE TABLE fda_investigation_snapshots (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  investigation_id uuid NOT NULL,
  packet jsonb NOT NULL,
  PRIMARY KEY (tenant_id, source_id, investigation_id),
  FOREIGN KEY (tenant_id, source_id, investigation_id) REFERENCES fda_investigations (tenant_id, source_id, id)
);

CREATE TABLE fda_investigation_attempts (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  investigation_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  output_version text NOT NULL,
  configuration jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','validation-failed','failed')),
  usage jsonb,
  result jsonb,
  validation jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  PRIMARY KEY (tenant_id, source_id, investigation_id),
  FOREIGN KEY (tenant_id, source_id, investigation_id) REFERENCES fda_investigations (tenant_id, source_id, id)
);

CREATE TABLE fda_investigation_reviews (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  investigation_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  request_id uuid NOT NULL,
  decision jsonb NOT NULL,
  evidence_fingerprint text NOT NULL,
  output_version text,
  actor_role text NOT NULL,
  application_revision text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, source_id, investigation_id, revision),
  UNIQUE (tenant_id, source_id, investigation_id, request_id),
  FOREIGN KEY (tenant_id, source_id, investigation_id) REFERENCES fda_investigations (tenant_id, source_id, id)
);
