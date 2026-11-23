CREATE TABLE fda_workflow_assessments (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  workflow_id text NOT NULL CHECK (workflow_id ~ '^workflow-[0-9]{3,8}$'),
  responsible_role text NOT NULL,
  UNIQUE (tenant_id, source_id, id),
  UNIQUE (tenant_id, source_id, workflow_id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES fda_sources (tenant_id, source_id)
);

CREATE TABLE fda_workflow_revisions (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  assessment_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  body jsonb NOT NULL,
  PRIMARY KEY (tenant_id, source_id, assessment_id, revision),
  FOREIGN KEY (tenant_id, source_id, assessment_id) REFERENCES fda_workflow_assessments (tenant_id, source_id, id)
);

CREATE TABLE fda_workflow_revision_receipts (
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  assessment_id uuid NOT NULL,
  revision integer NOT NULL,
  receipt_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, source_id, assessment_id, revision, receipt_id),
  FOREIGN KEY (tenant_id, source_id, assessment_id, revision) REFERENCES fda_workflow_revisions,
  FOREIGN KEY (tenant_id, source_id, receipt_id) REFERENCES fda_ingestion_receipts (tenant_id, source_id, id)
);

CREATE TABLE fda_workflow_decisions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  assessment_id uuid NOT NULL,
  revision integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('approve-implementation-planning', 'approve-supervised-pilot', 'reject', 'defer')),
  body jsonb NOT NULL,
  actor_role text NOT NULL,
  application_revision text,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, source_id, assessment_id, revision),
  UNIQUE (tenant_id, source_id, assessment_id, revision, id),
  FOREIGN KEY (tenant_id, source_id, assessment_id, revision) REFERENCES fda_workflow_revisions
);

CREATE TABLE fda_workflow_delivery_cases (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  assessment_id uuid NOT NULL,
  revision integer NOT NULL,
  decision_id uuid NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, source_id, assessment_id, revision),
  FOREIGN KEY (tenant_id, source_id, assessment_id, revision, decision_id)
    REFERENCES fda_workflow_decisions (tenant_id, source_id, assessment_id, revision, id)
);

CREATE TABLE fda_workflow_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  assessment_id uuid NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  actor_role text NOT NULL,
  application_revision text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, source_id, assessment_id, revision) REFERENCES fda_workflow_revisions
);

CREATE INDEX fda_workflow_audit_history
  ON fda_workflow_audit (tenant_id, source_id, assessment_id, sequence);
