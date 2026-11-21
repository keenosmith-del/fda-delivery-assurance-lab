CREATE TABLE lab_observation_windows (
  id text PRIMARY KEY,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE TABLE lab_devices (
  id text PRIMARY KEY,
  label text NOT NULL,
  team text NOT NULL,
  window_id text NOT NULL REFERENCES lab_observation_windows(id),
  enrolled_at timestamptz NOT NULL
);

CREATE TABLE lab_device_events (
  id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES lab_devices(id),
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('heartbeat', 'observation', 'permission')),
  permission_ok boolean,
  CHECK ((kind = 'permission') = (permission_ok IS NOT NULL))
);
CREATE INDEX lab_device_events_history_idx ON lab_device_events (device_id, occurred_at);

CREATE TABLE lab_tasks (
  id text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL,
  expected_sequence text[] NOT NULL CHECK (cardinality(expected_sequence) > 0),
  suitability_inputs jsonb NOT NULL CHECK (jsonb_typeof(suitability_inputs) = 'object')
);

CREATE TABLE lab_workflow_events (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES lab_tasks(id),
  device_id text NOT NULL REFERENCES lab_devices(id),
  occurred_at timestamptz NOT NULL,
  sequence text[] NOT NULL CHECK (cardinality(sequence) > 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  exception boolean NOT NULL
);
CREATE INDEX lab_workflow_events_task_idx ON lab_workflow_events (task_id, occurred_at);

CREATE TABLE lab_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id text NOT NULL REFERENCES lab_tasks(id),
  classification text NOT NULL CHECK (classification IN ('approve', 'reject')),
  suitability text NOT NULL CHECK (suitability IN ('approve', 'reject')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_reviews_task_idx ON lab_reviews (task_id, id DESC);
