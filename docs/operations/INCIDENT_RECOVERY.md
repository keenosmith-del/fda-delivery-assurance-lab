# Incident recovery

## API and queue checks

- `/api/health` checks the process. `/api/ready` checks database connectivity and migration integrity. Correlate request failures with `X-Request-ID`.
- `/api/ops/status` returns the worker heartbeat state, ready and leased counts, pending retries, terminal failures, oldest ready-job age and current API request totals. Totals reset when the API restarts.
- Investigate consecutive readiness or connection errors for one minute, a worker heartbeat older than 20 seconds, oldest ready work older than 60 seconds, any new dead job or a sustained 5xx rate above 1%. These thresholds are starting points for a small demo.
- Restart the worker after checking its database connectivity and logs. An interrupted claim expires and can be recovered by another worker. Stale completion is fenced by the current lease token. Backoff is 1, 2 and 4 seconds before a fourth failed attempt is terminal.
- Preserve operation IDs and inspect the existing record before reprocessing. A replay of an accepted request keeps its record ID. After correcting a persistent failure, a new operation for the same candidate and requisition links to the existing business record and creates a new confirmation job. Verify that it links rather than duplicating the record.

Read-only investigation query for an authorised database session:

```sql
SELECT o.id, o.state, o.submission_id, j.state AS job_state, j.attempts, j.lease_until
FROM submission_operations o
JOIN confirmation_jobs j ON j.operation_id = o.id
WHERE o.id = '<recorded-operation-uuid>';
```

## Backup and restore

Enable scheduled PostgreSQL backups in the approved staging workspace. Take an encrypted or provider-managed snapshot before database changes. For a logical backup, use the same PostgreSQL major version's `pg_dump -Fc` over an authorised private connection. Restore into a fresh isolated instance with `pg_restore --exit-on-error`. Rotate any restored credentials and validate row totals, checksums and representative operation, review, adoption and outcome records.

```sh
pg_dump --format=custom --file=synthetic-staging.dump "$SOURCE_DATABASE_URL"
pg_restore --exit-on-error --dbname="$ISOLATED_RESTORE_DATABASE_URL" synthetic-staging.dump
```

Keep the previous database intact until the restored environment is checked. Pause writes before any approved cutover. Repoint API and worker together, then run migration readiness and the staging smoke script. The CI restore exercise validates a logical backup of disposable synthetic fixtures. It does not exercise provider snapshot restore.

## Downstream recovery

Inspect the last dispatch and lookup first. An expired lease triggers a lookup before any further dispatch. A verification mismatch or payload conflict requires investigation and cannot be redriven. After bounded exhaustion, an operator can request an authoritative lookup or one eligible redrive with a reason. Redrive requires a current case, an authoritative miss and no prior accepted acknowledgment. Queued operations can be cancelled before the first claim. Earlier dispatches must be reconciled.
