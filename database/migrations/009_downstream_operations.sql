ALTER TABLE fda_workflow_delivery_cases
  ADD CONSTRAINT fda_delivery_execution_identity UNIQUE (tenant_id, source_id, id, assessment_id, revision, decision_id);

CREATE TABLE fda_downstream_operations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  delivery_case_id uuid NOT NULL UNIQUE,
  assessment_id uuid NOT NULL,
  revision integer NOT NULL,
  decision_id uuid NOT NULL,
  workflow_id text NOT NULL,
  evidence_fingerprint text NOT NULL,
  request_key uuid NOT NULL,
  effect_key text NOT NULL UNIQUE,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  effect jsonb NOT NULL,
  authorisation jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','dispatching','awaiting-reconciliation','retry-scheduled','succeeded','failed-terminal','cancelled')),
  dispatches integer NOT NULL DEFAULT 0,
  reconciliations integer NOT NULL DEFAULT 0,
  redriven boolean NOT NULL DEFAULT false,
  accepted boolean NOT NULL DEFAULT false,
  last_error text,
  verified_effect_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'succeeded') = (verified_effect_id IS NOT NULL)),
  UNIQUE (tenant_id, source_id, request_key),
  FOREIGN KEY (tenant_id, source_id, delivery_case_id, assessment_id, revision, decision_id)
    REFERENCES fda_workflow_delivery_cases (tenant_id, source_id, id, assessment_id, revision, decision_id)
);

CREATE TABLE fda_downstream_jobs (
  operation_id uuid PRIMARY KEY REFERENCES fda_downstream_operations (id),
  phase text NOT NULL CHECK (phase IN ('dispatch','reconcile')),
  manual_action text CHECK (manual_action IN ('redrive','reconcile')),
  due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX fda_downstream_due ON fda_downstream_jobs (due_at, operation_id);

CREATE TABLE fda_downstream_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES fda_downstream_operations (id),
  phase text NOT NULL CHECK (phase IN ('dispatch','reconcile')),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  recovered_lease boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  metadata jsonb,
  UNIQUE (operation_id, phase, attempt_number),
  CHECK ((finished_at IS NULL) = (metadata IS NULL))
);

CREATE TABLE fda_downstream_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES fda_downstream_operations (id),
  action text NOT NULL,
  role text NOT NULL,
  reason text NOT NULL,
  application_revision text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX fda_downstream_audit_operation ON fda_downstream_audit (operation_id, id);
