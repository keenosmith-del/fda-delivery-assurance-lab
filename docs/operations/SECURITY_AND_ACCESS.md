# Security and access

This environment contains synthetic records. The hosted interface requires HTTP Basic authentication at the application over the platform's TLS endpoint. The browser requests credentials through its built-in prompt. Static assets, API records and downloads use the same protected origin. Neither Vite nor the compiled application embeds credentials. Programmatic clients make the same authenticated requests.

| Surface | Access |
| --- | --- |
| `GET/HEAD /api/health`, `GET/HEAD /api/ready` | Public machine probes. Responses contain only health states. |
| Frontend, assets, module reads and exports | Viewer, operator or staging demo role. |
| Submissions, workflow reviews and adoption mutations | Operator or staging demo role. Mutations also require an exact matching `Origin`. |
| `GET /api/ops/status` | Operator or staging demo role. |
| Simulated pre-commit interruption, lost acknowledgment, ATS comparison | Local development and CI fixtures, or staging with explicit faults enabled and a separate demo role. Production rejects the flag at startup. |
| Worker failure | Controlled only by the test harness. The worker has no HTTP failure trigger. |

Use distinct high-entropy passwords and deliver them by an approved secret-sharing mechanism. Shared role credentials are intended for a small synthetic demonstration. Rotation invalidates the relevant role, and the browser may cache credentials until its private session closes. There is no user-level session revocation. Local development retains its optional `LAB_WRITE_TOKEN` and cannot bind outside loopback. A hosted API rejects this token configuration.

The API applies request-body size and time limits, validates existing API contracts, disables cross-origin access, and emits a restrictive content security policy, HSTS, framing and MIME protections. Hosted reads and exports use no-store. Default service quotas use fixed one-minute windows per instance: 30 invalid authentication requests across the process, and 240 reads and 40 writes per authenticated role. Quotas reset on restart. Use a provider edge limit or a shared limit before horizontal scaling or broad distribution.

Request logs contain generated correlation IDs, HTTP methods, route templates, status and latency. Application and worker logs may include synthetic operation IDs. Headers, credentials, payloads and raw database errors are excluded from application logs. Restrict access to provider logs and deployment credentials. See [data retention](DATA_RETENTION.md).

## Downstream access

Hosted readers inherit workspace authentication. Explicit authorisation and recovery actions require an operator in an enabled lab. FDA publisher and simulator bearer credentials are separate from the workspace role and receive no execution rights. The worker accepts a fixed loopback HTTP origin from local configuration and rejects redirects. Operation input cannot choose a destination. Simulator fault settings are confined to test mode.
