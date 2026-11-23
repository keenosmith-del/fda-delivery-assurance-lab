#!/usr/bin/env bash
set -euo pipefail

if [[ ${GITHUB_ACTIONS:-} != true || ! ${1:-} =~ ^[a-f0-9]{12,64}$ ]]; then
  echo 'This restore exercise requires a disposable GitHub Actions PostgreSQL container.' >&2
  exit 1
fi

container="$1"
database_url='postgresql://fda:fda_test@127.0.0.1:5432/fda_backup_source'
docker exec "$container" createdb -U fda fda_backup_source
docker exec "$container" createdb -U fda fda_backup_restore
DATABASE_URL="$database_url" npm run db:migrate
DATABASE_URL="$database_url" npm run db:seed
source_token="$(node --input-type=module -e 'import {randomBytes} from "node:crypto"; console.log(randomBytes(32).toString("hex"))')"
source_origin='http://127.0.0.1:3381'
api_pid=''
stop_fda_api() {
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
    api_pid=''
  fi
}
start_fda_api() {
  DATABASE_URL="$database_url" LAB_MODE=test PORT=3381 LAB_FDA_SOURCE_TOKEN="$source_token" node backend/src/server.ts &
  api_pid=$!
  curl --fail --silent --retry 15 --retry-connrefused --retry-delay 1 "$source_origin/api/ready" >/dev/null
}
trap stop_fda_api EXIT
export LAB_FDA_SOURCE_TOKEN="$source_token" LAB_FDA_PUBLISHER_ORIGIN="$source_origin"
start_fda_api
npm run --silent fda:publish > "$RUNNER_TEMP/fda-import-receipts.jsonl"
stop_fda_api
start_fda_api
npm run --silent fda:publish -- duplicate-replay record-001 >> "$RUNNER_TEMP/fda-import-receipts.jsonl"
npm run --silent fda:publish -- conflicting-replay >> "$RUNNER_TEMP/fda-import-receipts.jsonl"
curl --fail --silent -H 'Content-Type: application/json' \
  -d '{"endpointId":"endpoint-007","category":"capture-permissions","windowId":"window-001"}' \
  "$source_origin/api/integrations/fda/v1/assurance/incidents" > "$RUNNER_TEMP/fda-agent-incident.json"
npm run --silent fda:publish -- assurance-complete-window >> "$RUNNER_TEMP/fda-import-receipts.jsonl"
node --input-type=module -e '
  import { createFixtureDelivery } from "./tests/support/workflow-review.ts";
  const base = process.env.LAB_FDA_PUBLISHER_ORIGIN + "/api/integrations/fda/v1/workflow-assessments/workflow-003";
  await createFixtureDelivery(async (path, body) => {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Synthetic workflow backup fixture POST failed at " + path + " with HTTP " + response.status);
    return response.json();
  }, base);
'
DATABASE_URL="$database_url" node --input-type=module -e '
  import { database } from "./backend/src/db/pool.ts";
  import { randomUUID } from "node:crypto";
  import { outcomeFixture } from "./scripts/outcome-fixture.ts";
  import { readInvestigation, requestInvestigation, reviewInvestigation } from "./backend/src/modules/investigations/service.ts";
  import { readOutcomeAssurance, receiveOutcome, recordOutcomeReview } from "./backend/src/modules/outcomes/assurance.ts";
  import { receiveObservation } from "./backend/src/modules/adoption/assurance.ts";
  import { fixtureWindows } from "./scripts/adoption-fixture.ts";
  import { fixtureScope } from "./scripts/fda-fixture.ts";
  import { exerciseDownstreamEvidence } from "./scripts/downstream-evidence-fixture.ts";
  const pool = database(process.env.DATABASE_URL);
  try {
    const { rows: [delivery] } = await pool.query("SELECT id FROM fda_workflow_delivery_cases");
    const { operation } = await exerciseDownstreamEvidence(pool, delivery.id, "lost-acknowledgment");
    const fixture = fixtureWindows({ caseId: delivery.id, workflowId: "workflow-003",
      operationId: operation.id, verifiedAt: operation.updated_at.toISOString() });
    for (const event of fixture.events("baseline")) await receiveObservation(pool, fixtureScope, event);
    for (const event of fixture.events("improvement")) await receiveObservation(pool, fixtureScope, event);
    const outcome = outcomeFixture({ caseId: delivery.id, workflowId: "workflow-003", verifiedAt: operation.updated_at.toISOString() });
    for (const variant of ["model","baseline","comparison"]) {
      for (const event of outcome.events(variant)) await receiveOutcome(pool, fixtureScope, event);
    }
    const selection = { baseline: "period-001", comparison: "period-002", method: "matched-items" };
    const evidence = await readOutcomeAssurance(pool, fixtureScope, delivery.id, selection);
    if (evidence.comparison?.difference !== 140) throw new Error("Unexpected handling difference");
    await recordOutcomeReview(pool, fixtureScope, delivery.id, { ...selection, requestId: randomUUID(), expectedRevision: 0,
      fingerprint: evidence.fingerprint, outcome: "reviewed-synthetic-comparison",
      justification: "Matched four synthetic opportunities for the restore exercise.", limitations: "Synthetic laboratory data." },
      { role: "operator", sourceRevision: null });
    const actor = { role: "operator", sourceRevision: null };
    const investigation = await requestInvestigation(pool,fixtureScope,delivery.id,{
      category:"outcome-verification",question:"Which evidence supports the reviewed synthetic outcome?",
      requestId:randomUUID(),runInference:false,...selection,
    },actor);
    const saved = await readInvestigation(pool,fixtureScope,investigation.id);
    await reviewInvestigation(pool,fixtureScope,investigation.id,{ requestId:randomUUID(),expectedRevision:0,
      fingerprint:saved.fingerprint,decision:"request-evidence",reason:"Keep the historical scope and request further engineering evidence." },actor);
  } finally { await pool.end(); }
'
stop_fda_api
unset LAB_FDA_SOURCE_TOKEN LAB_FDA_PUBLISHER_ORIGIN
docker exec "$container" pg_dump -Fc -U fda -d fda_backup_source > "$RUNNER_TEMP/fda-fixture.dump"
docker exec -i "$container" pg_restore --exit-on-error -U fda -d fda_backup_restore < "$RUNNER_TEMP/fda-fixture.dump"
manifest_query="SELECT string_agg(name || ':' || checksum, ',' ORDER BY name) FROM schema_migrations"
fixture_query="SELECT (SELECT count(*) FROM lab_tasks), (SELECT count(*) FROM lab_executions),
  (SELECT count(*) FROM lab_outcome_measurements WHERE review_provenance = 'synthetic-fixture'),
  (SELECT count(*) FROM fda_canonical_records c JOIN fda_ingestion_receipts r ON r.canonical_id = c.id AND r.status = 'processed'),
  (SELECT count(*) FROM fda_agent_incidents), (SELECT count(*) FROM fda_agent_incident_audit),
  (SELECT count(*) FROM fda_agent_incident_evidence),
  (SELECT count(*) FROM fda_workflow_assessments), (SELECT count(*) FROM fda_workflow_revisions),
  (SELECT count(*) FROM fda_workflow_revision_receipts), (SELECT count(*) FROM fda_workflow_decisions),
  (SELECT count(*) FROM fda_workflow_delivery_cases), (SELECT count(*) FROM fda_workflow_audit)"
expected_manifest="$(node --input-type=module -e '
  import { loadMigrations } from "./backend/src/db/migrations.ts";
  const migrations = await loadMigrations("database/migrations");
  console.log(migrations.map(({ name, checksum }) => name + ":" + checksum).join(","));
')"
for database in fda_backup_source fda_backup_restore; do
  manifest="$(docker exec "$container" psql -At -U fda -d "$database" -c "$manifest_query")"
  [[ "$manifest" == "$expected_manifest" ]]
done
before="$(docker exec "$container" psql -At -U fda -d fda_backup_source -c "$fixture_query")"
after="$(docker exec "$container" psql -At -U fda -d fda_backup_restore -c "$fixture_query")"
[[ "$before" == "$after" && "$after" =~ ^6\|[1-9][0-9]+\|3\|[1-9][0-9]*\|1\|1\|2\|1\|4\|[1-9][0-9]*\|1\|1\|6$ ]]
printf 'PostgreSQL backup round trip verified. Matching migration checksums. Tasks | executions | attributed studies | imported records with receipts | incidents | incident actions | incident receipt links | workflow assessments | revisions | revision receipts | decisions | delivery cases | workflow actions: %s\n' "$after"
downstream_query="SELECT
  (SELECT count(*) FROM fda_downstream_operations d JOIN fda_workflow_delivery_cases c
    ON (d.delivery_case_id,d.tenant_id,d.source_id,d.assessment_id,d.revision,d.decision_id)
      =(c.id,c.tenant_id,c.source_id,c.assessment_id,c.revision,c.decision_id)
    WHERE d.state='succeeded' AND d.verified_effect_id IS NOT NULL),
  (SELECT count(*) FROM fda_downstream_attempts WHERE phase='dispatch'),
  (SELECT count(*) FROM fda_downstream_attempts a JOIN fda_downstream_operations d ON a.operation_id=d.id
    WHERE a.phase='reconcile' AND a.metadata->>'effectId'=d.verified_effect_id::text),
  (SELECT count(*) FROM fda_downstream_audit)"
for database in fda_backup_source fda_backup_restore; do
  downstream="$(docker exec "$container" psql -At -U fda -d "$database" -c "$downstream_query")"
  [[ "$downstream" == '1|1|1|3' ]]
done

adoption_query="SELECT (SELECT count(*) FROM fda_adoption_assessments),
  (SELECT count(*) FROM fda_adoption_observations WHERE body->>'kind'='attempt'),
  (SELECT count(*) FROM fda_adoption_receipts WHERE status='accepted'),
  (SELECT count(*) FROM fda_adoption_observations o JOIN fda_downstream_operations d
    ON o.body->>'operationId'=d.id::text AND o.delivery_case_id=d.delivery_case_id AND d.state='succeeded')"
for database in fda_backup_source fda_backup_restore; do
  adoption="$(docker exec "$container" psql -At -U fda -d "$database" -c "$adoption_query")"
  [[ "$adoption" == '1|4|34|1' ]]
done

outcome_query="SELECT
  (SELECT count(*) FROM fda_outcome_assessments a JOIN fda_workflow_delivery_cases c
    ON (a.tenant_id,a.source_id,a.delivery_case_id,a.assessment_id,a.assessment_revision,a.decision_id)
      =(c.tenant_id,c.source_id,c.id,c.assessment_id,c.revision,c.decision_id)),
  (SELECT count(*) FROM fda_outcome_measurements),
  (SELECT count(*) FROM fda_outcome_receipts r JOIN fda_outcome_measurements m USING (tenant_id,source_id,event_id)),
  (SELECT count(*) FROM fda_outcome_reviews WHERE revision=1 AND snapshot#>>'{comparison,difference}'='140')"
for database in fda_backup_source fda_backup_restore; do
  outcome="$(docker exec "$container" psql -At -U fda -d "$database" -c "$outcome_query")"
  [[ "$outcome" == '1|36|36|1' ]]
done
DATABASE_URL="$database_url" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { database } from "./backend/src/db/pool.ts";
  import { readOutcomeAssurance } from "./backend/src/modules/outcomes/assurance.ts";
  import { readInvestigation } from "./backend/src/modules/investigations/service.ts";
  import { fixtureScope } from "./scripts/fda-fixture.ts";
  async function read(url) {
    const pool = database(url);
    try {
      const { rows: [delivery] } = await pool.query("SELECT id FROM fda_workflow_delivery_cases");
      const outcome = await readOutcomeAssurance(pool, fixtureScope, delivery.id);
      assert.equal(outcome.reviewedDifference, 140);
      assert.equal(outcome.reviewHistory[0].stale, false);
      const { rows: [investigation] } = await pool.query("SELECT id FROM fda_investigations");
      const history = await readInvestigation(pool,fixtureScope,investigation.id);
      assert.equal(history.stale,false);
      assert.equal(history.status,"needs-evidence");
      assert.equal(history.reviews.length,1);
      assert.equal(history.packet.citations.find(row => row.record === "outcome-assessment").facts.reviewedDifference,140);
      return { outcome, history };
    } finally { await pool.end(); }
  }
  const url = process.env.DATABASE_URL;
  assert.deepEqual(await read(url), await read(url.replace("fda_backup_source", "fda_backup_restore")));
'
