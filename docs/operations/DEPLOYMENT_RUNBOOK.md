# Private deployment runbook

The release image builds both workspaces from the npm lockfile and runs as an unprivileged user. Deploy the same reviewed Git commit to two services. The web service serves the built frontend and the Fastify API on one HTTPS origin. The confirmation worker uses the same build with a different command and has no public network listener. The PostgreSQL 17 service needs a persistent volume and a private connection from both application services.

The service settings below are recorded in [services.json](../../infrastructure/deployment/services.json). Railway project provisioning requires available workspace capacity. A separate Vercel project is unnecessary for this release because both workspaces share an origin and access policy.

## Service settings

| Setting | API and frontend | Confirmation worker |
| --- | --- | --- |
| Source | Repository root and root Dockerfile | Same image source and Git commit |
| Start command | `node backend/dist/backend/src/server.js` | `node backend/dist/backend/src/workers/run.js` |
| Pre-deploy command | `node backend/dist/backend/src/db/migrate.js` | None. Deploy the worker after the API migration. |
| Startup verification | `/api/ready` (allow 90 seconds) | Protected API operational status shows a current heartbeat |
| Networking | Railway HTTPS domain, target the injected `PORT` | Private only |
| Scaling | One replica to match the in-process rate limits | One replica, queue leases tolerate overlapping deployment |
| Restart | Restart on failure with bounded provider retries | Restart on failure with bounded provider retries |

Set the image source to a verified release. Configure the start and pre-deploy commands in each service's settings. Attach a Railway domain to the API only. Use the PostgreSQL service's private `DATABASE_URL` reference for both application services. Disable public PostgreSQL proxy access. Keep hosting values in service environment settings, away from Vite build variables.

| Variable | Effect |
| --- | --- |
| `LAB_MODE=staging` | Enables hosted access requirements. Use `production` for a future approved environment. |
| `DATABASE_URL` | Service reference to the dedicated PostgreSQL instance. |
| `LAB_DATABASE_TLS=railway-private` | Accepts only a `.railway.internal` database host. Traffic relies on Railway's encrypted private network. |
| `LAB_DATABASE_TLS=verify` | Alternative for a PostgreSQL endpoint with a verifiable certificate. Do not append SSL query options to hosted URLs. |
| `LAB_PUBLIC_ORIGIN` | Exact HTTPS origin, with no trailing slash. Set only on the API. |
| `LAB_VIEWER_PASSWORD` and `LAB_OPERATOR_PASSWORD` | Distinct random passwords of at least 32 characters. Set only on the API. |
| `LAB_ENABLE_FAULTS=false` | Required for the normal staging smoke test. This is the default. |
| `LAB_DEMO_PASSWORD` | Separate random credential for explicitly authorised staging fault exercise. Omit by default. |
| `HOST` and `PORT` | Default to `0.0.0.0` and 3000 in hosted mode. Railway supplies `PORT`. |
| `LAB_DB_POOL_MAX` | Defaults to eight connections on the API and two on the worker or release utility. |
| `LAB_UI_DIR`, `MIGRATIONS_DIR` | Set by the image layout defaults. |

## Release and recovery

1. Create a dedicated staging project, a persistent PostgreSQL 17 service, and the two application services. Configure private database references, health checks and protected browser access before deployment. Verify branch CI.
2. Deploy the API image. Its pre-deploy command loads all checked-in migrations in version order, obtains a PostgreSQL advisory lock and writes checksums in the same transaction. Failure aborts the release. The readiness check verifies every expected checksum.
3. Seed only staging once via a command in the connected API container. Run `node backend/dist/backend/src/db/seed.js`. This inserts deterministic seed rows, can be repeated, and preserves existing records. Production mode rejects the seed command.
4. Deploy the worker from the same image revision. Check its current heartbeat through the protected API. Run the smoke script and protected browser suite described in [staging verification](../testing/STAGING_VERIFICATION.md).
5. Restart each application service independently and run the smoke script's `after-restart` check to confirm the original database record is still confirmed. Note the app and worker release identifiers with measured results.
6. For rollback, redeploy the previous verified image to the affected service. Additive migrations remain in place and old readers validate their own expected checksums. For incompatible database changes, stop writes and use the recovery procedure in [incident recovery](INCIDENT_RECOVERY.md).

Railway references cover [private networking](https://docs.railway.com/networking/private-networking) and [pre-deployment commands](https://docs.railway.com/deployments/pre-deploy-command).
