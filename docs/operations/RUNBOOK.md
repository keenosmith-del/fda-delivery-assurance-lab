# ATS lab runbook

## Local start

Install Node.js 24, npm and Docker Compose. From the repository root:

```sh
npm ci
cp -n .env.example .env
docker compose -f infrastructure/docker/compose.yaml up -d --wait
npm run db:migrate
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
| `LAB_ENABLE_FAULTS` | `true` enables the two submission scenarios, default `false` |
| `MIGRATIONS_DIR` | Optional migration location, relative to migration command working directory |
| `TEST_DATABASE_URL` | Optional dedicated PostgreSQL database. Test fixtures create and drop isolated schemas. |

## Demonstration

Choose **Lost acknowledgment** and run the scenario. The trace shows a synthetic 504, the committed operation found by lookup, and the same UUID replayed. Inspect the record ID and the replay and confirmation audit events. Choose **Timeout before commit**, generate a fresh candidate code, and repeat. The lookup is empty until the retry writes the record.

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
