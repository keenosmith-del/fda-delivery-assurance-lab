# API contracts

| Request | Behaviour |
| --- | --- |
| `GET /api/health` | Returns 200 when the API process responds |
| `GET /api/ready` | Returns 200 when the confirmation table is queryable or 503 otherwise |
| `POST /api/submissions` | Uses a UUID v4 `Idempotency-Key` and JSON with `candidateCode` and `requisition`. Returns 202 while pending or 200 for a terminal operation. |
| `GET /api/operations/:id` | Returns the authoritative state, record ID, duplicate resolution, attempt count and latest 50 audit events. Returns 404 when the UUID has no committed operation. |

`POST` accepts candidate codes matching `CAND-[0-9]{4,10}` after trimming and uppercasing. Requisitions are `engineering`, `operations` and `client-success`. Use `Authorization: Bearer <token>` when write protection is configured. The response `Location` identifies the operation lookup.

| Status | Meaning |
| --- | --- |
| 400 | Invalid UUID, payload or fault |
| 401 | Missing or invalid write token |
| 409 | Existing operation used with a different payload |
| 504 | Controlled interruption. Use the lookup and the original operation key. |
| 500 | Unexpected request failure. Look up the operation before deciding whether to retry. |

With `LAB_ENABLE_FAULTS=true`, set `X-Lab-Fault` to `before-commit` or `lost-ack`. Both produce a synthetic HTTP 504, with distinguishable error codes for diagnostics. The first rolls the transaction back. The second returns after the transaction commits.

## Workflow evidence and agent health

| Request | Behaviour |
| --- | --- |
| `GET /api/workflow/tasks` | Lists seeded candidates with evidence counts, heuristic classification and suitability scores. |
| `GET /api/workflow/tasks/:id` | Returns expected sequence, observed events, factor weights, evidence gaps and the latest 100 review decisions, scoring version and original suitability inputs. |
| `POST /api/workflow/tasks/:id/reviews` | Stores independent `classification` and `suitability` values (`approve` or `reject`) and a 5–500 character `reason`. Returns 201. Requires a write token when configured. |
| `GET /api/agent-health` | Returns the latest seeded observation window, endpoint states and the reporting numerator. |
| `GET /api/agent-health/:id` | Returns the endpoint and its heartbeat, permission and observation history through the end of the window. |
| `POST /api/lab/submission-comparison` | Runs the isolated duplicate reference and the SQL-backed safe path. Requires authorised fault mode and a write token when configured. |

Invalid identifiers or request bodies return 400. Missing resources return 404. A comparison requested outside fault mode also returns 404. Hosted reads require authentication under the trust boundary below.

## Adoption and outcome measurement

| Request | Behaviour |
| --- | --- |
| `GET /api/automations` | Lists automation definitions with their workflow candidate IDs. |
| `GET /api/automations/:id/periods` | Lists ordered windows and their persisted-input aggregates. |
| `GET /api/adoption/:id` | Returns population, aggregate rates, observations, hypotheses, decisions, interventions and audit. |
| `POST /api/adoption/:id/diagnoses` | Links an existing evidence signal (`periodId` and `category`) to a recorded `hypothesis`. |
| `POST /api/adoption/:id/interventions` | Persists `findingId`, `action`, `owner` and `followUpOn`. |
| `POST /api/adoption/:id/interventions/:interventionId/implement` | Records `implementedOn` and creates one audit event. Repeating that date is safe. |
| `POST /api/adoption/:id/interventions/:interventionId/follow-ups` | Records a later observed `periodId` and `notes` for an implemented intervention. Duplicate period reviews return 409. |
| `GET /api/outcomes/model` | Returns modeled baseline volume, eligibility basis points and weekly occurrences for each automation and the total. |
| `GET /api/outcomes/:id` | Returns the calculation and evidence for a comparable pair, optionally selected with `?baseline=…&comparison=…`. |
| `GET /api/outcomes/:id/export` | Downloads the selected comparison with units, source provenance, modeled-versus-reviewed reconciliation, and versioning. |

Adoption writes use the existing write token when configured. Diagnosis evidence must exist for the selected automation and period. Follow-up windows must start on or after the actual implementation date and contain observations. Outcome windows must be ordered and non-overlapping. Source metadata and inputs are exposed alongside estimates and verified synthetic differences.

## Review evidence downloads

| Request | Contents |
| --- | --- |
| `GET /api/operations/:id/export` | Durable operation and record IDs, confirmation job status, ordered audit event IDs and persisted synthetic fault decisions. A receipt can exist after rollback while `operation` is still `null`. The normal operation lookup continues to return 404 in that state. |
| `GET /api/workflow/tasks/:id/export` | Ordered synthetic observations, expected sequence, suitability inputs, factor values and weights, evidence gaps and up to 100 review decisions. |
| `GET /api/adoption/:id/export` | Measurement periods, supporting observation counts, diagnosis-to-intervention-to-follow-up relationships, ordered audit IDs and before/after rates and deltas. |
| `GET /api/outcomes/:id/export` | Complete or incomplete study inputs, assumptions, values, units, reconciliation and verification limitations. Uses the existing paired period selector. |

Each JSON attachment includes `schemaVersion: fda-evidence/v1`, `evidenceType`, `environment`, a `sourceRevision` or `null`, and a `calculationVersion` or `null` for ATS. Fault receipts record the API's planned synthetic HTTP status and request ID. Client receipt and status-polling traces are outside that record. The exports omit credentials and operator-authored free text. See [evidence integrity](EVIDENCE_INTEGRITY.md) for formulas, limits and attribution rules.

## Hosted trust boundary

Hosted mode authenticates all application reads, including assets and exports, and requires an operator or authorised demo role with the matching Origin on writes. Only health and readiness probes are public. `GET /api/ops/status` returns aggregate queue, worker heartbeat and in-process HTTP status counts to operators. It does not return operation records. A 429 response includes Retry-After.

## Simulated FDA integration

The lab owns `fda-lab.ingestion/v1`. The shared schemas live in `shared/contracts/fda-ingestion.ts`. The strictly validated envelope contains schema version, tenant, source, stable source record ID, source occurrence time, record type and typed payload. Source revision and batch correlation ID are optional. Each request is one event, with a maximum body size of 8 KiB. The publisher sends a batch as individual requests, keeping an independent result for each event.

| Route | Access and result |
| --- | --- |
| `POST /api/integrations/fda/v1/events` | Source Bearer credential with one configured tenant and source. Returns a receipt with `201` for a processed event, `200` for identical replay, `400` for invalid content, `403` for a scope mismatch, `409` for a content conflict and `503` for projection failure. Missing or invalid credentials return `401`, oversized bodies `413`, and request budget exhaustion `429`. Source writes from browser origins return `403`. |
| `GET /api/integrations/fda/v1/status` | Workspace access. Returns persisted receipt counts, canonical acceptance count, configured source identity, last successful ingest and 40 recent receipts. |
| `GET /api/integrations/fda/v1/receipts/:id` | Workspace access. Returns a scoped receipt, or `404` for an unknown or out-of-scope ID. |
| `GET /api/integrations/fda/v1/records` | Workspace access. Returns the latest 500 canonical records for the configured scope, including each processed receipt ID. Payloads use the strict, minimized versioned schema. |
| `GET /api/integrations/fda/v1/agent-health` | Workspace access. Returns the latest source assessment window, endpoint reporting and evidence freshness, permission states, observation intervals and receipt links. |
| `GET /api/integrations/fda/v1/workflow-evidence` | Workspace access. Returns candidates, linked windows, validated observations, evidence gaps and supporting receipts. |

Workspace reads use the existing hosted Basic credentials or loopback-only local access. Source Bearer credentials grant writes only. The source route permits up to 240 authenticated and 30 unauthenticated requests per minute per API process. Endpoints are registered independently of legacy fixture routes. Time semantics and restart handling are in [Iteration 15](../iterations/ITERATION_15_FDA_INTEGRATION_GATEWAY.md).
