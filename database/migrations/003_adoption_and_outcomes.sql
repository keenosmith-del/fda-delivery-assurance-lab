CREATE TABLE lab_automations (
  id text PRIMARY KEY,
  name text NOT NULL,
  workflow text NOT NULL,
  task_id text NOT NULL REFERENCES lab_tasks(id)
);

CREATE TABLE lab_measurement_periods (
  id text PRIMARY KEY,
  automation_id text NOT NULL REFERENCES lab_automations(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on > starts_on),
  label text NOT NULL,
  expected_opportunities integer NOT NULL CHECK (expected_opportunities > 0),
  modeled_eligibility_bps integer NOT NULL CHECK (modeled_eligibility_bps BETWEEN 0 AND 10000),
  baseline_seconds_per_item integer NOT NULL CHECK (baseline_seconds_per_item > 0),
  source text NOT NULL,
  UNIQUE (automation_id, starts_on),
  UNIQUE (automation_id, id)
);

CREATE TABLE lab_period_population (
  period_id text REFERENCES lab_measurement_periods(id),
  operator_id text,
  eligible boolean NOT NULL,
  PRIMARY KEY (period_id, operator_id)
);

CREATE TABLE lab_opportunities (
  period_id text,
  opportunity_number integer CHECK (opportunity_number > 0),
  operator_id text NOT NULL,
  eligible boolean NOT NULL,
  PRIMARY KEY (period_id, opportunity_number),
  UNIQUE (period_id, opportunity_number, operator_id),
  FOREIGN KEY (period_id, operator_id) REFERENCES lab_period_population(period_id, operator_id)
);

CREATE TABLE lab_executions (
  period_id text,
  opportunity_number integer,
  succeeded boolean NOT NULL,
  exception text CHECK (length(exception) > 0),
  rework_seconds integer NOT NULL CHECK (rework_seconds >= 0),
  human_review_seconds integer NOT NULL CHECK (human_review_seconds >= 0),
  CHECK (succeeded OR exception IS NOT NULL),
  PRIMARY KEY (period_id, opportunity_number),
  FOREIGN KEY (period_id, opportunity_number) REFERENCES lab_opportunities(period_id, opportunity_number)
);

CREATE TABLE lab_adoption_events (
  period_id text,
  operator_id text,
  opportunity_number integer NOT NULL,
  PRIMARY KEY (period_id, operator_id),
  FOREIGN KEY (period_id, opportunity_number, operator_id) REFERENCES lab_opportunities(period_id, opportunity_number, operator_id),
  FOREIGN KEY (period_id, opportunity_number) REFERENCES lab_executions(period_id, opportunity_number)
);

CREATE TABLE lab_adoption_observations (
  period_id text REFERENCES lab_measurement_periods(id),
  category text CHECK (category IN ('integration', 'permission', 'workflow', 'training')),
  observed_count integer NOT NULL CHECK (observed_count > 0),
  evidence text NOT NULL,
  PRIMARY KEY (period_id, category)
);

CREATE TABLE lab_adoption_findings (
  id uuid PRIMARY KEY,
  automation_id text NOT NULL,
  period_id text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'low-adoption', 'inconsistent-usage', 'integration', 'permission', 'workflow', 'training', 'exceptions', 'reliability'
  )),
  evidence text NOT NULL,
  hypothesis text NOT NULL CHECK (length(trim(hypothesis)) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (automation_id, period_id) REFERENCES lab_measurement_periods(automation_id, id)
);

CREATE TABLE lab_adoption_interventions (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES lab_adoption_findings(id),
  action text NOT NULL CHECK (length(trim(action)) BETWEEN 10 AND 500),
  owner text NOT NULL CHECK (length(trim(owner)) BETWEEN 2 AND 80),
  follow_up_on date NOT NULL,
  implemented_on date,
  implemented_at timestamptz,
  CHECK ((implemented_on IS NULL) = (implemented_at IS NULL))
);

CREATE TABLE lab_adoption_follow_ups (
  id uuid PRIMARY KEY,
  intervention_id uuid NOT NULL REFERENCES lab_adoption_interventions(id),
  period_id text NOT NULL REFERENCES lab_measurement_periods(id),
  notes text NOT NULL CHECK (length(trim(notes)) BETWEEN 10 AND 500),
  UNIQUE (intervention_id, period_id)
);

CREATE TABLE lab_adoption_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  automation_id text NOT NULL REFERENCES lab_automations(id),
  subject_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('diagnosis-recorded', 'intervention-planned', 'intervention-implemented', 'follow-up-recorded')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lab_adoption_audit_automation_idx ON lab_adoption_audit(automation_id, id DESC);

CREATE TABLE lab_outcome_measurements (
  period_id text PRIMARY KEY REFERENCES lab_measurement_periods(id),
  measured_items integer NOT NULL CHECK (measured_items > 0),
  human_handling_seconds integer NOT NULL CHECK (human_handling_seconds >= 0),
  method text NOT NULL,
  source text NOT NULL,
  reviewed boolean NOT NULL DEFAULT false
);
