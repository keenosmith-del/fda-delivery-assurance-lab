CREATE TABLE fda_adoption_assessments (
  delivery_case_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  assessment_id uuid NOT NULL,
  revision integer NOT NULL,
  decision_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, source_id, delivery_case_id),
  FOREIGN KEY (tenant_id, source_id, delivery_case_id, assessment_id, revision, decision_id)
    REFERENCES fda_workflow_delivery_cases (tenant_id, source_id, id, assessment_id, revision, decision_id)
);

CREATE TABLE fda_adoption_observations (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  source_event_id uuid NOT NULL,
  delivery_case_id uuid NOT NULL,
  period_id text NOT NULL,
  body jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, source_id, source_event_id),
  FOREIGN KEY (tenant_id, source_id, delivery_case_id)
    REFERENCES fda_adoption_assessments (tenant_id, source_id, delivery_case_id)
);
CREATE INDEX fda_adoption_period_events ON fda_adoption_observations (delivery_case_id, period_id, source_event_id);

CREATE TABLE fda_adoption_receipts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  source_event_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'duplicate', 'conflict')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, source_id, source_event_id)
    REFERENCES fda_adoption_observations (tenant_id, source_id, source_event_id)
);

CREATE TABLE fda_adoption_actions (
  delivery_case_id uuid NOT NULL REFERENCES fda_adoption_assessments,
  request_id uuid NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  body jsonb NOT NULL,
  evidence jsonb,
  actor_role text NOT NULL,
  application_revision text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (delivery_case_id, request_id),
  UNIQUE (delivery_case_id, sequence)
);
