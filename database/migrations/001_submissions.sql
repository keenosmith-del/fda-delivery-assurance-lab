CREATE TABLE submissions (
  id uuid PRIMARY KEY,
  candidate_code text NOT NULL CHECK (candidate_code ~ '^CAND-[0-9]{4,10}$'),
  requisition text NOT NULL CHECK (requisition IN ('engineering', 'operations', 'client-success')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_code, requisition)
);

CREATE TABLE submission_operations (
  id uuid PRIMARY KEY,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  submission_id uuid NOT NULL REFERENCES submissions(id),
  duplicate boolean NOT NULL,
  state text NOT NULL DEFAULT 'pending_confirmation'
    CHECK (state IN ('pending_confirmation', 'confirmed', 'confirmation_failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE submission_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES submission_operations(id),
  kind text NOT NULL CHECK (kind IN (
    'accepted', 'duplicate_linked', 'replayed', 'payload_conflict', 'confirmed',
    'confirmation_retry', 'confirmation_failed', 'lease_expired'
  )),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX submission_events_operation_idx ON submission_events (operation_id, id);

CREATE TABLE confirmation_jobs (
  operation_id uuid PRIMARY KEY REFERENCES submission_operations(id),
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'leased', 'complete', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  CHECK (
    (state = 'leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (state <> 'leased' AND lease_token IS NULL AND lease_until IS NULL)
  )
);
CREATE INDEX confirmation_jobs_ready_idx ON confirmation_jobs (available_at) WHERE state = 'ready';
CREATE INDEX confirmation_jobs_lease_idx ON confirmation_jobs (lease_until) WHERE state = 'leased';
