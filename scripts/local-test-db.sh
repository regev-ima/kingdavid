#!/usr/bin/env bash
# =============================================================================
# local-test-db.sh — run a migration against a throwaway PostgreSQL first
# =============================================================================
# There is one Supabase project and no staging environment, and migrations are
# applied by a GitHub Action the moment a PR merges to main. That makes `main`
# the first place a migration ever executes. This script gives you a cheap
# rehearsal: a temporary local database seeded with an approximation of the
# production schema.
#
#   ./scripts/local-test-db.sh                                  # fixture only
#   ./scripts/local-test-db.sh supabase/migrations/2026…sql     # + a migration
#   ./scripts/local-test-db.sh <migration.sql> --twice          # + idempotency
#   ./scripts/local-test-db.sh --psql                           # open a shell
#
# WHAT IT PROVES: the SQL parses, applies, is idempotent, and the functions
# behave. WHAT IT DOES NOT PROVE: that the column set matches production — the
# fixture is a reconstruction (see scripts/fixtures/schema-approximation.sql).
# For that, run scripts/inspect-production-schema.sql against the real database.
#
# Requires: postgresql server binaries (initdb, pg_ctl) and psql.
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
[ -n "$PGBIN" ] && PATH="$PGBIN:$PATH"
command -v initdb >/dev/null || { echo "initdb not found. Install postgresql, or set PGBIN."; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d /var/tmp/kdtest.XXXXXX)"
PORT="${PGPORT:-55433}"
PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1)

cleanup() {
  pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# initdb refuses to run as root; fall back to the postgres system user.
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id -u postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$WORK"
  RUNAS="postgres"
fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "PATH=$PATH; $*"; else eval "$*"; fi; }

echo "▸ starting temporary PostgreSQL in $WORK"
run "initdb -D $WORK/data -A trust -U postgres" >"$WORK/initdb.log" 2>&1 \
  || { tail -20 "$WORK/initdb.log"; exit 1; }

# listen_addresses='' → Unix socket only. The socket lives in this run's own
# temp dir, so concurrent runs (and anything else already on the port) cannot
# collide. Without this, a leftover server on $PORT fails the whole script.
run "pg_ctl -D $WORK/data -o '-p $PORT -k $WORK -c listen_addresses=' -l $WORK/pg.log -w start" \
  >"$WORK/pgctl.log" 2>&1 \
  || { echo "postgres failed to start:"; tail -20 "$WORK/pg.log" "$WORK/pgctl.log"; exit 1; }

for _ in $(seq 1 30); do
  "${PSQL[@]}" -d postgres -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 0.5
done
"${PSQL[@]}" -d postgres -tAc 'select 1' >/dev/null 2>&1 \
  || { echo "postgres never became ready:"; tail -20 "$WORK/pg.log"; exit 1; }

"${PSQL[@]}" -d postgres -q -c "CREATE DATABASE kdtest;"
PSQL+=(-d kdtest)

echo "▸ loading fixture (approximation — not the real schema)"
"${PSQL[@]}" -q -f "$ROOT/scripts/fixtures/schema-approximation.sql"

MIGRATION="${1:-}"
if [ -n "$MIGRATION" ] && [ "$MIGRATION" != "--psql" ]; then
  echo "▸ applying $MIGRATION"
  "${PSQL[@]}" -f "$MIGRATION" 2>&1 | grep -E 'ERROR|NOTICE|WARNING' || true
  echo "  ✓ applied"

  if [ "${2:-}" = "--twice" ]; then
    echo "▸ applying a second time (idempotency)"
    if "${PSQL[@]}" -f "$MIGRATION" >"$WORK/second.log" 2>&1; then
      echo "  ✓ idempotent"
    else
      echo "  ✗ NOT idempotent:"; grep -E '^psql.*ERROR' "$WORK/second.log" | head; exit 1
    fi
  fi
fi

if [ "${1:-}" = "--psql" ] || [ "${2:-}" = "--psql" ] || [ "${3:-}" = "--psql" ]; then
  echo "▸ interactive shell (\\q to exit and destroy the database)"
  echo "  tip: SET test.jwt = '{\"email\":\"admin@kd.co.il\"}';  -- become the admin"
  psql -h "$WORK" -p "$PORT" -U postgres -d kdtest
else
  echo "▸ done — database destroyed"
fi
