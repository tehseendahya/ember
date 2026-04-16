#!/usr/bin/env bash
# Run the SQL wipe against your database.
# Requires: psql and DATABASE_URL (or pass URL as first argument).
#
#   export DATABASE_URL="postgresql://..."
#   bash scripts/wipe-google-calendar-data.sh
#
# Or:
#   bash scripts/wipe-google-calendar-data.sh "postgresql://..."

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/wipe-google-calendar-data.sql"
URL="${1:-${DATABASE_URL:-}}"

if [[ -z "${URL}" ]]; then
  echo "Set DATABASE_URL or pass the connection string as the first argument." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Open scripts/wipe-google-calendar-data.sql in Supabase SQL Editor and run it there." >&2
  exit 1
fi

psql "${URL}" -v ON_ERROR_STOP=1 -f "${SQL_FILE}"
echo "Done."
