#!/usr/bin/env bash
# Best-effort migration of the `neon_auth` schema (Managed Better Auth: users,
# sessions, credentials, OAuth links) from the old shared project into the new
# dedicated project's ALREADY-Auth-enabled `neon_auth` schema.
#
# UNLIKE migrate.sh, this is NOT a documented/supported Neon operation — there
# is no official Neon path for cross-project Auth migration. This works off
# the inference that both ends run the identical Managed Better Auth system
# (same password hashing), so a raw schema copy has a real chance of
# preserving working logins. Treat every step as best-effort:
#   1. Enable Managed Better Auth on the NEW project FIRST (Neon console ->
#      Project -> Auth), so it provisions its own fresh neon_auth schema.
#   2. Run `diff-schema` below and READ the output — if table/column shapes
#      differ between source and target, STOP and investigate before
#      restoring; Neon may have provisioned a different Better Auth schema
#      version on the new project than what created the old one.
#   3. Run `data` during a maintenance window (it truncates target auth
#      tables first).
#   4. Manually test: log in with an existing email+password against the new
#      NEON_AUTH_BASE_URL, and confirm role-gated pages (e.g. /admin) still
#      work for an existing admin user, BEFORE cutting the live app over.
#   5. Google OAuth needs separate manual setup regardless of this script:
#      re-register the client ID/secret in the new project's Auth console,
#      and add its callback URL as an authorized redirect URI in Google Cloud
#      Console. No amount of table-copying fixes that part.
#   6. Keep the OLD project's Auth instance untouched/reachable until the new
#      one is confirmed working in production — this is your rollback path.
#
# Usage:
#   export SOURCE_DATABASE_URL='...old shared project...'
#   export TARGET_DATABASE_URL='...new project, Auth already enabled...'
#   ./scripts/migrate/migrate-auth.sh diff-schema   # compare table/column shapes first
#   ./scripts/migrate/migrate-auth.sh data          # dump+restore (re-runnable, truncates target)

set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the current shared project's connection string}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the new project's connection string (Auth already enabled on it)}"

WORKDIR="$(dirname "$0")/.tmp"
mkdir -p "$WORKDIR"

# Table list is discovered at runtime rather than hardcoded — we don't know
# exactly which tables this Better Auth version provisions (user/session/
# account/verification, possibly jwks/organization/member if those features
# are enabled), so we copy whatever actually exists in `neon_auth` on the
# source rather than guessing and silently missing one.
list_tables() {
  psql "$1" -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema = 'neon_auth' ORDER BY table_name;"
}

cmd_diff_schema() {
  echo "==> neon_auth tables — SOURCE vs TARGET:"
  diff <(list_tables "$SOURCE_DATABASE_URL") <(list_tables "$TARGET_DATABASE_URL") \
    && echo "Table names match." || echo "^ TABLE LIST DIFFERS — investigate before restoring."

  echo
  echo "==> Per-table column shape diff (SOURCE vs TARGET):"
  for t in $(list_tables "$SOURCE_DATABASE_URL"); do
    src_cols=$(psql "$SOURCE_DATABASE_URL" -Atc "SELECT column_name || ' ' || data_type FROM information_schema.columns WHERE table_schema='neon_auth' AND table_name='$t' ORDER BY ordinal_position;")
    tgt_cols=$(psql "$TARGET_DATABASE_URL" -Atc "SELECT column_name || ' ' || data_type FROM information_schema.columns WHERE table_schema='neon_auth' AND table_name='$t' ORDER BY ordinal_position;")
    if [ "$src_cols" != "$tgt_cols" ]; then
      echo "  DIFFERS: neon_auth.$t"
      diff <(echo "$src_cols") <(echo "$tgt_cols") | sed 's/^/    /'
    else
      echo "  OK: neon_auth.$t"
    fi
  done
}

cmd_data() {
  mapfile -t TABLES < <(list_tables "$SOURCE_DATABASE_URL")
  echo "==> Tables to migrate: ${TABLES[*]}"

  local table_args=()
  for t in "${TABLES[@]}"; do table_args+=(-t "neon_auth.$t"); done

  echo "==> Dumping neon_auth data from SOURCE..."
  pg_dump "$SOURCE_DATABASE_URL" --data-only --no-owner -Fc \
    "${table_args[@]}" -f "$WORKDIR/auth-data.dump"

  echo "==> Truncating TARGET neon_auth tables before reload..."
  for t in "${TABLES[@]}"; do
    psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE neon_auth.\"$t\" CASCADE;"
  done

  echo "==> Restoring into TARGET (triggers disabled to ignore FK order)..."
  pg_restore --data-only --no-owner --disable-triggers \
    -d "$TARGET_DATABASE_URL" "$WORKDIR/auth-data.dump"

  echo "==> Done. NOW GO TEST A REAL LOGIN against the new project before cutting the app over."
}

case "${1:-}" in
  diff-schema) cmd_diff_schema ;;
  data) cmd_data ;;
  *)
    echo "Usage: $0 {diff-schema|data}" >&2
    exit 1
    ;;
esac
