ALTER TABLE lab_reviews
  ADD COLUMN actor_role text CHECK (actor_role IN ('operator', 'demo', 'local-token', 'local-open')),
  ADD COLUMN source_revision text CHECK (source_revision ~ '^[0-9a-f]{40}$');

ALTER TABLE lab_adoption_audit
  ADD COLUMN actor_role text CHECK (actor_role IN ('operator', 'demo', 'local-token', 'local-open')),
  ADD COLUMN source_revision text CHECK (source_revision ~ '^[0-9a-f]{40}$');

ALTER TABLE lab_outcome_measurements
  ADD COLUMN review_provenance text CHECK (review_provenance = 'synthetic-fixture');

-- The pre-commit decision survives rollback. It can precede any durable operation
-- with this UUID, so there is deliberately no foreign key to submission_operations.
CREATE TABLE lab_submission_fault_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  fault text NOT NULL CHECK (fault IN ('before-commit', 'lost-ack')),
  actor_role text NOT NULL CHECK (actor_role IN ('operator', 'demo', 'local-token', 'local-open')),
  source_revision text CHECK (source_revision ~ '^[0-9a-f]{40}$'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lab_submission_fault_receipts_operation_idx ON lab_submission_fault_receipts (operation_id, id);
