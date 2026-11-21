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
