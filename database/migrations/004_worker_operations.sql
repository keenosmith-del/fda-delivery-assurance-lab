CREATE TABLE lab_worker_health (
  worker_name text PRIMARY KEY,
  instance_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'stopped')),
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
