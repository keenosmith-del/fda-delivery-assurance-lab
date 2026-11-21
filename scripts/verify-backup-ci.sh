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
docker exec "$container" pg_dump -Fc -U fda -d fda_backup_source > "$RUNNER_TEMP/fda-fixture.dump"
docker exec -i "$container" pg_restore --exit-on-error -U fda -d fda_backup_restore < "$RUNNER_TEMP/fda-fixture.dump"
query="SELECT (SELECT count(*) FROM schema_migrations), (SELECT count(*) FROM lab_tasks), (SELECT count(*) FROM lab_executions)"
before="$(docker exec "$container" psql -At -U fda -d fda_backup_source -c "$query")"
after="$(docker exec "$container" psql -At -U fda -d fda_backup_restore -c "$query")"
[[ "$before" == "$after" && "$after" =~ ^4\|6\|[1-9][0-9]+$ ]]
printf 'PostgreSQL backup round trip verified. Schema versions | tasks | executions: %s\n' "$after"
