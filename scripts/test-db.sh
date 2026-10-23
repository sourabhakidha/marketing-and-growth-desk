#!/usr/bin/env bash
# Runs the migrations + access tests on a THROWAWAY Postgres database.
#   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres scripts/test-db.sh
# It creates and drops its own database. It refuses to run against Supabase hosts.
set -euo pipefail

: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a local/CI Postgres admin connection}"
case "$TEST_DATABASE_URL" in
  *supabase.co*|*supabase.com*|*pooler.supabase*)
    echo "Refusing to run tests against a Supabase host." >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="mos_test_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" "$TEST_DATABASE_URL" -c "create database $DB"
trap '"${PSQL[@]}" "$TEST_DATABASE_URL" -c "drop database if exists $DB" >/dev/null' EXIT

TEST_URL="$(node -e 'const u=new URL(process.argv[1]); u.pathname="/"+process.argv[2]; console.log(u.toString())' "$TEST_DATABASE_URL" "$DB")"

"${PSQL[@]}" "$TEST_URL" -f "$ROOT/supabase/tests/00_supabase_stub.sql"

# Snapshot everything OUTSIDE our schemas before and after migrating
SNAPSHOT_SQL="
select n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce(array_to_string(c.relacl, ','), '')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('marketing_os','marketing_os_private','pg_catalog','information_schema','pg_toast')
union all
select 'schema:' || nspname || ':' || coalesce(array_to_string(nspacl, ','), '')
from pg_namespace where nspname not in ('marketing_os','marketing_os_private')
union all
select 'role:' || rolname from pg_roles
union all
select 'defacl:' || coalesce(defaclnamespace::regnamespace::text, 'ALL') || ':' || defaclobjtype::text || ':' || array_to_string(defaclacl, ',')
from pg_default_acl where defaclnamespace not in (
  select oid from pg_namespace where nspname in ('marketing_os','marketing_os_private'))
order by 1;"

before="$("${PSQL[@]}" -tA "$TEST_URL" -c "$SNAPSHOT_SQL")"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  "${PSQL[@]}" "$TEST_URL" -f "$f"
done
after="$("${PSQL[@]}" -tA "$TEST_URL" -c "$SNAPSHOT_SQL")"

if [ "$before" != "$after" ]; then
  echo "FAIL: migrations changed objects outside marketing_os:" >&2
  diff <(echo "$before") <(echo "$after") >&2 || true
  exit 1
fi
echo "ok - migrations changed nothing outside marketing_os / marketing_os_private"

for f in "$ROOT"/supabase/tests/[1-9]*.test.sql; do
  echo "running $(basename "$f")"
  "${PSQL[@]}" "$TEST_URL" -f "$f" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
done
