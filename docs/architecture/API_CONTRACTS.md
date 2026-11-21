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
| `GET /api/workflow/tasks` | Lists seeded candidates with evidence counts, classification confidence and suitability. |
| `GET /api/workflow/tasks/:id` | Returns expected sequence, observed events, factor weights, evidence gaps and the latest 100 review decisions. |
| `POST /api/workflow/tasks/:id/reviews` | Stores independent `classification` and `suitability` values (`approve` or `reject`) and a 5–500 character `reason`. Returns 201. Requires a write token when configured. |
| `GET /api/agent-health` | Returns the latest seeded observation window, endpoint states and the reporting numerator. |
| `GET /api/agent-health/:id` | Returns the endpoint and its heartbeat, permission and observation history through the end of the window. |
| `POST /api/lab/submission-comparison` | Runs the isolated duplicate reference and the SQL-backed safe path. Requires authorised fault mode and a write token when configured. |

Invalid identifiers or request bodies return 400. Missing resources return 404. A comparison requested outside fault mode also returns 404. All reads are currently available to clients of the API. The deployment design must define stronger access protection and request budgets before accepting non-demo workloads.

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
| `GET /api/outcomes/:id/export` | Downloads the same comparison as labelled synthetic evidence JSON, with the period selector supported. |

Adoption writes use the existing write token when configured. Diagnosis evidence must exist for the selected automation and period. Follow-up windows must start on or after the actual implementation date and contain observations. Outcome windows must be ordered and non-overlapping. Source metadata and inputs are exposed alongside estimates and verified synthetic differences.

## Hosted trust boundary

Hosted mode authenticates all application reads, including assets and exports, and requires an operator or authorised demo role with the matching Origin on writes. Only health and readiness probes are public. `GET /api/ops/status` returns aggregate queue, worker heartbeat and in-process HTTP status counts to operators. It does not return operation records. A 429 response includes Retry-After.
