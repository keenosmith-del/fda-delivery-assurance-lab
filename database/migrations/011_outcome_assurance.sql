CREATE TABLE fda_outcome_assessments (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  delivery_case_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  assessment_revision integer NOT NULL,
  decision_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, source_id, delivery_case_id),
  FOREIGN KEY (tenant_id, source_id, delivery_case_id, assessment_id, assessment_revision, decision_id)
    REFERENCES fda_workflow_delivery_cases (tenant_id, source_id, id, assessment_id, revision, decision_id)
);

CREATE TABLE fda_outcome_measurements (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  event_id uuid NOT NULL,
  delivery_case_id uuid NOT NULL,
  body jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, source_id, event_id),
  FOREIGN KEY (tenant_id, source_id, delivery_case_id)
    REFERENCES fda_outcome_assessments (tenant_id, source_id, delivery_case_id)
);
CREATE INDEX fda_outcome_measurements_case ON fda_outcome_measurements (tenant_id, source_id, delivery_case_id, event_id);

CREATE TABLE fda_outcome_receipts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  event_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted','duplicate','conflict')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, source_id, event_id) REFERENCES fda_outcome_measurements (tenant_id, source_id, event_id)
);
CREATE INDEX fda_outcome_receipts_event ON fda_outcome_receipts (tenant_id, source_id, event_id);

CREATE TABLE fda_outcome_reviews (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  delivery_case_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  request_id uuid NOT NULL,
  evidence_fingerprint text NOT NULL,
  decision jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  actor_role text NOT NULL,
  application_revision text,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, source_id, delivery_case_id, revision),
  UNIQUE (tenant_id, source_id, delivery_case_id, request_id),
  FOREIGN KEY (tenant_id, source_id, delivery_case_id)
    REFERENCES fda_outcome_assessments (tenant_id, source_id, delivery_case_id)
);
