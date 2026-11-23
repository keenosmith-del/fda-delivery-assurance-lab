# Delivery Assurance Lab runbook

## Local start

Install Node.js 24, npm and Docker Compose. From the repository root:

```sh
npm ci
cp -n .env.example .env
docker compose -f infrastructure/docker/compose.yaml up -d --wait
npm run db:migrate
npm run db:seed
```

Start each process from a separate terminal at the repository root:

```sh
npm run dev
npm run dev:worker
npm run dev:frontend
```

Open the Vite URL printed in the frontend terminal. The default is `http://localhost:5173`. The API defaults to port 3000. The compose database binds to `127.0.0.1:5435` using sample development credentials. Keep local fault mode off when reproducing normal operation.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL URL in server, worker and migration processes |
| `HOST` | API bind address, default `127.0.0.1` |
| `PORT` | API port, also used by the Vite dev proxy, default 3000 |
| `LAB_WRITE_TOKEN` | Optional loopback write secret. Required for non-loopback API binding. Enter it under Operator access. |
| `LAB_ENABLE_FAULTS` | `true` enables controlled request faults and the comparison, default `false` |
| `MIGRATIONS_DIR` | Optional migration location, relative to migration command working directory |
| `TEST_DATABASE_URL` | Optional dedicated PostgreSQL database. Test fixtures create and drop isolated schemas. |

## Demonstration

Choose **Lost acknowledgment** and run the scenario. The trace shows a synthetic 504, the committed operation found by lookup, and the same UUID replayed. Inspect the record ID and the replay and confirmation audit events. Choose **Timeout before commit**, generate a fresh candidate code, and repeat. The lookup is empty until the retry writes the record.

### Compare the paths

With `LAB_ENABLE_FAULTS=true`, select **ATS Reliability** and press **Run comparison**. If required, enter the write token under **Operator access** first. The isolated reference runs a second insert after discarding the acknowledgment and produces two fixture records. The transactional path looks up the committed operation, reuses its UUID and then submits a fresh UUID for the same business key. It returns the SQL record count and audit events `accepted`, `replayed` and `duplicate_linked`. Each run creates one synthetic business record and two traced operations.

### Inspect and review evidence

Open **Discover** and select **Candidate offer review**. Expand both scoring breakdowns and the supporting observations. Inspect the recommendation to retain human review. Record a synthetic reason with separate classification and suitability decisions, then reload the task to verify the saved review.

Open **Agent Health** and select **Workstation 07**. Its heartbeat qualifies as reporting while its permission history records limited access and its evidence is stale. Select **Workstation 09** to inspect an enrolled endpoint with no observations. Gap intervals mark slots without successful observations during the labelled demo window.

## Troubleshooting and recovery

1. Check `GET /api/health` for the process and `GET /api/ready` for the database and migration. A readiness failure can mean the DB service is unavailable or the migration is missing.
2. For an uncertain submit result, copy the operation ID and look it up. If absent, replay the original normalised payload and UUID. A 409 means that UUID is already bound to another payload.
3. If confirmation remains pending, check the worker log and restart the worker process. In-flight leases are available for reclaim after expiry.
4. If an operation reaches `confirmation_failed`, inspect its audit events and preserve its record ID. The job is terminal after four attempts. A job-redrive interface is pending.
5. Search logs by API request ID or operation UUID. Payloads and tokens are excluded from structured request logs.

Inspect current state directly in the synthetic database:

```sql
SELECT o.id, o.state, o.submission_id, j.state AS job_state, j.attempts, j.lease_until
FROM submission_operations o
JOIN confirmation_jobs j ON j.operation_id = o.id
WHERE o.id = '<operation-uuid>';

SELECT candidate_code, requisition, count(*)
FROM submissions
GROUP BY candidate_code, requisition
HAVING count(*) > 1;
```

Applied migrations are checksum-verified. Preserve their contents and create a new migration for schema changes. Stop API and worker before a local data reset. Use a separate, disposable database for tests. Hosted restart, release rollback and backup recovery procedures will be added alongside a verified deployment.

### Adoption and outcome review

1. Run the versioned migrations and seed the synthetic data. The seed can be rerun without discarding workflow or adoption decisions.
2. Under **Adoption Diagnostics**, select **Pipeline digest assistant** and the baseline week. Inspect the population, 50% adoption and the observed signals. Record a hypothesis linked to **Low adoption**.
3. Plan an owned action with a follow-up date of 16 November 2026. Record implementation on 9 November 2026 to compare the following synthetic window. Record the follow-up and inspect the 50% to 75% adoption comparison and the decision audit.
4. Under **Outcome Verification**, inspect the baseline terms that yield 339.64 modeled weekly occurrences. Compare the complete candidate intake time study with the incomplete pipeline digest fixture, then download the selected comparison as JSON.

The normal app runs against native PostgreSQL. The internal browser verification server uses a disposable fixture and is suitable for loopback-only synthetic review. Never put credentials or real operator data into these fixtures. Before public deployment, configure authenticated operational writes, review read access and retention, install request limits, and disable lab fault injection outside the approved demonstration environment.

## Simulated FDA import

Use the disposable local environment described in the README. Generate a separate credential with `openssl rand -hex 32` and set `LAB_FDA_SOURCE_TOKEN` in the local `.env`. Default scope is `tenant-001` and `source-001`. Run migrations and start the API before publishing. The independent publisher uses HTTP on the local machine. Set `LAB_FDA_PUBLISHER_ORIGIN` if the API uses a different loopback port.

```sh
npm run fda:publish
npm run fda:publish -- duplicate-replay record-001
npm run fda:publish -- conflicting-replay
npm run fda:publish -- permission-degradation
npm run fda:publish -- reporting-interruption
npm run fda:publish -- delayed-delivery
npm run fda:publish -- recovery
npm run fda:publish -- invalid-contract
npm run fda:publish -- tenant-violation
```

Open FDA Integration and select **Refresh ingestion** after publishing. Select a receipt to inspect validation, timestamps, revisions and the canonical reference. Follow the receipt to the imported source dataset in Agent Health or Workflow Evidence. For local machine-readable inspection, read `/api/integrations/fda/v1/receipts/<id>` on the API loopback origin.

For a clean rerun, use a new disposable database and local `DATABASE_URL`, then run `npm run db:migrate`. Use the existing seed command if you also need legacy fixtures. Confirm the database identity before removing any explicitly disposable environment. The publisher never resets the database. An identical replay of an interrupted delivery can resume processing. The gateway stops after three failed projection attempts and retains the event and prior receipts.

## Agent operational assurance

Start the existing local stack and apply the migrations, including 007. Configure a synthetic source credential and complete the existing FDA publisher setup.

1. Run `npm run fda:publish -- normal`. In Agent Health, open the simulated FDA dataset. Find **Agent operational assurance** and inspect `window-001`.
2. Run `npm run fda:publish -- reporting-interruption`. Refresh assurance, open `endpoint-006`, then open a reporting interruption incident.
3. Record a hypothesis and its supporting receipts, select an intervention and record its implementation. **Evaluate recovery** before sending later events to see insufficient evidence.
4. Run `npm run fda:publish -- recovery`. Evaluate recovery again. The later valid heartbeat can resolve the reporting case. Inspect the audit and **Download operational assurance JSON**.
5. Run `npm run fda:publish -- assurance-regression`. Refresh and open the later reporting interruption for `endpoint-006`. The original resolution remains in history.
6. Run `npm run fda:publish -- permission-degradation` on a fresh fixture to see a new limited permission report on `endpoint-006`. For the partial recovery demonstration, use the baseline capture-permissions condition on `endpoint-007`. Open a case and record diagnosis, plan and implementation before sending `assurance-partial-recovery`. Verify to see partial recovery. Send `assurance-permission-recovery` and verify after the additional observation arrives.
7. Use the workflow links to inspect the affected cohort, earlier missing intervals and linked cases. Run `npm run fda:publish -- assurance-complete-window` after the reporting recovery to inspect the separate, complete `window-003` assessment.

Additional scenarios include `delayed-delivery`, `assurance-version-transition`, `assurance-version-recovery`, `assurance-out-of-order` and `duplicate-replay`. Use a fresh disposable database when repeating verification exercises. Evidence already received before implementation remains historical and cannot pass the post-intervention timing rule.

## Workflow assessment and engineering decisions

1. Start a disposable local workspace, apply migration 008, and use the same synthetic source configuration as the FDA import walkthrough. Run `npm run fda:publish -- normal`, then `npm run fda:publish -- assurance-complete-window`.
2. Open **Workflow Evidence → Simulated FDA**, select `workflow-003`, and inspect its complete window and candidate receipts. Select **Open engineering assessment**.
3. Expand **Technical feasibility and assumptions**. Review the sequence, expected inputs and outputs, synthetic integration, access and recovery controls, and at least one alternative or a reason none is viable. Use `verified in lab` only for a lab-verified integration. Record the phases and save the revision.
4. Open **Risk register**, record the risks and their basis or document the basis for a clear review, then select **Submit for decision** and give a reason. An ordinary approval requires ready evidence and resolved mandatory dependencies. For a pilot, select a human-supervised execution model and record explicit scope, human review and stop criteria. An unreviewed elevated risk or high residual risk blocks approval. Use **Reject** when the evidence does not support the proposed plan.
5. Record **Approve implementation planning** or **Approve supervised pilot planning** with a justification. Choose **Create delivery case** and review the case prerequisites. If external client approval or credentials are unverified, the plan remains blocked. **Download workflow assessment JSON** includes source, revision, decision and case history.
6. Open `workflow-002` to see blockers directly from operational records before opening any incident. Inspect its missing intervals, open an assessment, submit it and record **Defer**. `workflow-001` illustrates a window with incomplete endpoint readiness evidence.
7. Run `npm run fda:publish -- workflow-evidence-change` to replace a supporting observation for `workflow-003`. Select **Refresh assessment** to see the stale warning. Create a reassessment revision and review it before recording a new decision. The previous decision, receipt set and delivery case remain inspectable.

Run the historical export generator with a fresh output directory to produce a test planning package with the six earlier evidence files. See `scripts/export-review-evidence.ts`.

## Run synthetic downstream execution locally

Start the lab and independent simulator databases with `docker compose -f infrastructure/docker/compose.yaml --profile downstream up -d`. Copy the downstream values from `.env.example` and generate a distinct lab-only token. Point `LAB_DOWNSTREAM_DATABASE_URL` at the disposable simulator database. Apply `npm run db:migrate` to the workspace database. Run the API and frontend as usual, plus `npm run dev:downstream-simulator` and `npm run dev:downstream-worker` in separate processes.

Publish the normal FDA fixture and `npm run fda:publish -- assurance-complete-window`. In **Workflow Evidence**, open workflow-003, submit a feasible reviewed assessment and approve implementation planning. Create the delivery case and choose **Start synthetic execution** with the lab-only attestation. Inspect the attempt history and download the evidence. ATS confirmations continue through the original worker.

For the acceptance fault, start the simulator with `LAB_MODE=test LAB_DOWNSTREAM_TEST_FAULT=lost-acknowledgment npm run dev:downstream-simulator` before authorising a fresh case. Dispatch records an unavailable acknowledgment, then authoritative lookup verifies the committed effect. Fault settings apply to newly presented operation identities. Use a new approved case for each scenario.

## Publish synthetic adoption observations

Use the local adoption publisher with the same scoped lab credential as FDA-shaped ingestion. Obtain case ID, workflow ID, operation ID and verification time from a verified delivery, then run `npm run adoption:publish -- CASE_ID WORKFLOW_ID OPERATION_ID VERIFIED_AT baseline`. See Iteration 19 for follow-up periods and expected comparisons.

## Synthetic outcome time study

Reuse the configured scoped FDA publisher token and a loopback API. Retrieve the approved case ID, workflow ID and ISO operation verification timestamp from its delivery-linked evidence. Run `npm run outcome:publish -- CASE_ID WORKFLOW_ID VERIFIED_AT model`, then repeat with `baseline` and `comparison`. Use the corresponding adoption periods from the [connected demonstration](../iterations/ITERATION_20_END_TO_END_OUTCOME_ASSURANCE.md#reproduce-the-connected-demonstration).

Open **FDA-linked Outcome Assurance**, check the selected periods and evidence gaps, record a justified review with the workspace operator access, and download the evidence package. The application export references the independent simulator effect. The simulator's own effect store has a separate persistence lifecycle.
