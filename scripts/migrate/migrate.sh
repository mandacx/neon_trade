#!/usr/bin/env bash
# One-time migration of neon_trade's own tables (market data + nt_*) from the
# shared Neon project into a new, dedicated one. neon_auth is NOT included
# here — it's a managed Neon Auth service, not a plain schema, and needs its
# own migration path (see the conversation this script came out of).
#
# Prerequisites: postgresql-client (pg_dump, pg_restore, psql) matching or
# newer than the Neon Postgres version. If you don't have it locally:
#   docker run --rm -it -v "$PWD:/work" -w /work postgres:17 bash
# and run this script inside that container instead.
#
# Usage:
#   export SOURCE_DATABASE_URL='postgres://...old shared project.../neondb?sslmode=require'
#   export TARGET_DATABASE_URL='postgres://...new project.../neondb?sslmode=require'
#   ./scripts/migrate/migrate.sh schema   # dump+restore DDL (indexes, constraints, sequences)
#   ./scripts/migrate/migrate.sh data     # dump+restore rows (safe to re-run: truncates target first)
#   ./scripts/migrate/migrate.sh verify   # row-count sanity check both sides
#
# Run schema once, then data as many times as you need for a fresh copy
# (e.g. one dry run days before cutover, one final delta-free copy during the
# actual maintenance window).

set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the current shared project's connection string}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the new project's connection string}"

# All tables neon_trade owns in the `public` schema of the shared project.
# nt_rate_limit_hits carries transient rate-limit windows only — safe to
# leave out of `data` if you'd rather just start it empty; left in here for
# completeness since re-running `data` truncates+reloads it cheaply anyway.
TABLES=(
  eod_usmkts_price
  securities
  intra_us_scanner_eod
  us_opt_chg_rpt
  nt_plans
  nt_app_user_profiles
  nt_user_feature_overrides
  nt_watchlists
  nt_watchlist_items
  nt_telegram_link_codes
  nt_telegram_alert_subscriptions
  nt_telegram_alert_cursors
  nt_rate_limit_hits
)

PARALLEL_JOBS="${PARALLEL_JOBS:-4}"
WORKDIR="$(dirname "$0")/.tmp"
mkdir -p "$WORKDIR"

table_args() {
  for t in "${TABLES[@]}"; do printf -- '-t public.%s ' "$t"; done
}

cmd_schema() {
  echo "==> Dumping schema for ${#TABLES[@]} tables from SOURCE..."
  # shellcheck disable=SC2046
  pg_dump "$SOURCE_DATABASE_URL" --schema-only --no-owner --no-privileges \
    $(table_args) -f "$WORKDIR/schema.sql"

  echo "==> Applying schema to TARGET..."
  psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$WORKDIR/schema.sql"

  echo "==> Schema migration done."
}

cmd_data() {
  echo "==> Dumping data for ${#TABLES[@]} tables from SOURCE (custom format)..."
  # shellcheck disable=SC2046
  pg_dump "$SOURCE_DATABASE_URL" --data-only --no-owner -Fc \
    $(table_args) -f "$WORKDIR/data.dump"

  echo "==> Truncating TARGET tables before reload (safe to re-run)..."
  # Reverse order so FK-referencing tables are truncated before what they
  # reference, then CASCADE covers anything left (e.g. watchlist_items).
  for ((i = ${#TABLES[@]} - 1; i >= 0; i--)); do
    psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 \
      -c "TRUNCATE TABLE public.${TABLES[$i]} CASCADE;"
  done

  echo "==> Restoring data into TARGET (disabling triggers to ignore FK order, ${PARALLEL_JOBS} parallel jobs)..."
  pg_restore --data-only --no-owner --disable-triggers -j "$PARALLEL_JOBS" \
    -d "$TARGET_DATABASE_URL" "$WORKDIR/data.dump"

  echo "==> Data migration done."
}

cmd_verify() {
  node "$(dirname "$0")/verify-counts.mjs" "${TABLES[@]}"
}

case "${1:-}" in
  schema) cmd_schema ;;
  data) cmd_data ;;
  verify) cmd_verify ;;
  all) cmd_schema; cmd_data; cmd_verify ;;
  *)
    echo "Usage: $0 {schema|data|verify|all}" >&2
    exit 1
    ;;
esac
