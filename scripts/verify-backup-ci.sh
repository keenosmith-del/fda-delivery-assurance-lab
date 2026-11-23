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
stop_fda_api
unset LAB_FDA_SOURCE_TOKEN LAB_FDA_PUBLISHER_ORIGIN
docker exec "$container" pg_dump -Fc -U fda -d fda_backup_source > "$RUNNER_TEMP/fda-fixture.dump"
docker exec -i "$container" pg_restore --exit-on-error -U fda -d fda_backup_restore < "$RUNNER_TEMP/fda-fixture.dump"
manifest_query="SELECT string_agg(name || ':' || checksum, ',' ORDER BY name) FROM schema_migrations"
fixture_query="SELECT (SELECT count(*) FROM lab_tasks), (SELECT count(*) FROM lab_executions),
  (SELECT count(*) FROM lab_outcome_measurements WHERE review_provenance = 'synthetic-fixture'),
  (SELECT count(*) FROM fda_canonical_records c JOIN fda_ingestion_receipts r ON r.canonical_id = c.id AND r.status = 'processed')"
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
[[ "$before" == "$after" && "$after" =~ ^6\|[1-9][0-9]+\|3\|[1-9][0-9]*$ ]]
printf 'PostgreSQL backup round trip verified. Matching migration checksums. Tasks | executions | attributed studies | imported records with receipts: %s\n' "$after"
