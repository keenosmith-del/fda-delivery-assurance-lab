# System overview

## Current implementation

The first slice takes a synthetic candidate code and requisition from the React scenario runner through a Fastify API to PostgreSQL. The browser generates a UUID before submitting. The API normalises and fingerprints the payload, then persists the business record, operation, audit event and confirmation job in a single transaction. A separate Node process confirms the operation. The browser can check its state by UUID after an ambiguous response.

| Directory | Purpose |
| --- | --- |
| `frontend/` | React UI, scenario orchestration and validated API client |
| `backend/` | Fastify API, configuration, database access, submissions and worker |
| `shared/` | Zod contracts shared by UI and API |
| `database/` | Checked-in SQL migrations |
| `tests/` | Browser specifications and database test support |
| `infrastructure/` | Local PostgreSQL service definition |
| `docs/` | Research, decisions, iteration history, runbook and verification |
| `.github/workflows/` | CI with native PostgreSQL 17 |

## Invariants

- Each candidate code and requisition pair has at most one business record.
- One operation UUID identifies one normalised payload. A different payload under the same UUID produces a conflict.
- A committed operation always refers to a business record and has exactly one confirmation job.
- A worker may change a job only while presenting its current lease token and before that lease expires.
- A terminal confirmation failure leaves the committed record accessible. Confirmation can fail after the record has been written.

## Request and worker timing

The API uses a PostgreSQL transaction-scoped advisory lock per operation UUID. A business unique constraint handles concurrent writes under different operation IDs. In the duplicate case a new operation links to the existing record. The queue claims one ready or expired job with `FOR UPDATE SKIP LOCKED`. The worker polls every 500 ms when idle. A claim expires after 10 seconds. Failed attempts are eligible after 1, 2 and 4 seconds. The fourth failed or abandoned attempt is terminal.

The current confirmation step records durable acknowledgement state in the application database. No external recruitment connector participates. The worker and API can be restarted independently. Database connection and browser request deadlines can still yield an ambiguous result, so verification uses the operation lookup.

## Trust boundaries

Demo inputs accept only synthetic candidate codes and three synthetic requisitions. The API binds to loopback by default and requires a write token for non-loopback binding. A configured token is required for every submission, including fault requests. Faults are disabled by default and cover two bounded request paths. The dev UI proxies same-origin API calls. The latest active attempt is stored in the browser tab session. Its token exists only in memory. The operation UUID allows read access to a synthetic record handle and audit events. HTTP request logs avoid payloads and tokens.

A public deployment, request budgets and retention policy are tracked for a later iteration.

## Workflow intelligence

Migration `002_workflow_evidence.sql` adds observation windows, enrolled devices, device history, workflow candidates, supporting observations and append-only operator reviews. `npm run db:seed` installs six synthetic workflow candidates across nine endpoints using deterministic IDs and times. It can be rerun without duplicating fixtures or clearing reviews. Models are calculated from the persisted source inputs when read.

Classification uses observable ordered similarity, frequency, sequence repetition and device corroboration. Suitability weighs operational assumptions, including permissions, exceptions, integrations and human judgment. The recommendation gates on evidence sufficiency and on high judgment or operational risk. Operator decisions persist independently of both calculated scores.

Agent Health determines reporting from heartbeat recency at the fixed window end and determines evidence freshness from last successful observation. Permission history is separate. Missing intervals aggregate adjacent one-hour slots without successful observation. Counts cover enrolled endpoints in a synthetic sample.

The workspace registers Adoption Diagnostics and Outcome Verification as separate routes. Both read the same PostgreSQL period measurements and use shared Zod contracts. The adoption service writes diagnoses and intervention changes with audit entries in a single transaction. The outcome service calculates estimates and reviewed results from persisted inputs. It exports the compared period data, sources and results as JSON.

## Hosted operation

The deployment image packages the compiled frontend and API on one protected HTTPS origin. The independently managed worker shares a private PostgreSQL connection and reports heartbeat through migration 004. Queue and request health are available in the protected operator API. See the [deployment runbook](../operations/DEPLOYMENT_RUNBOOK.md) and [access policy](../operations/SECURITY_AND_ACCESS.md).


## Review evidence

Workflow Evidence, ATS Reliability, Adoption Diagnostics and Outcome Verification provide authenticated JSON downloads in hosted mode. The receipts identify their source revision, persisted inputs and calculation version. ATS receipts include controlled failure decisions, with rollback decisions recorded separately from the operation transaction. See [evidence integrity](EVIDENCE_INTEGRITY.md) for the calculations, attribution limits and evidence boundaries.

## Simulated FDA gateway

An independent Node publisher sends strictly typed synthetic events through the HTTP adapter. The gateway authenticates the configured source, commits a receipt and source event, then projects canonical data under a per-event PostgreSQL lock. FDA Integration reads the receipts. The simulated source dataset in Agent Health and Workflow Evidence derives its records from the canonical store. Legacy fixtures and their reviews, comparisons and exports remain independently available. [Iteration 15](../iterations/ITERATION_15_FDA_INTEGRATION_GATEWAY.md) covers data boundaries and recovery.
