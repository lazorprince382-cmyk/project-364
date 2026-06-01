#!/usr/bin/env bash
# Import a pg_dump file into the VPS ocean_school database.
# Prefer plain .sql dumps (works across PostgreSQL versions).
# Usage: bash deploy/import-db-on-vps.sh /tmp/ocean-school.sql
set -euo pipefail

DUMP_FILE="${1:-/tmp/ocean-school.sql}"
APP_DIR="${APP_DIR:-/var/www/ocean-school}"
DB_NAME="${DB_NAME:-ocean_school}"
DB_USER="${DB_USER:-ocean_user}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "Dump file not found: $DUMP_FILE"
  exit 1
fi

echo "==> Stopping app..."
pm2 stop ocean-school || true

echo "==> Recreating database ${DB_NAME}..."
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" || true
sudo -u postgres dropdb --if-exists "${DB_NAME}"
sudo -u postgres createdb "${DB_NAME}" -O "${DB_USER}"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

echo "==> Restoring dump..."
if [[ "$DUMP_FILE" == *.sql ]]; then
  IMPORT_SQL="$DUMP_FILE"
  if grep -q 'transaction_timeout\|\\restrict\|\\unrestrict' "$DUMP_FILE"; then
    IMPORT_SQL="/tmp/ocean-school-import.sql"
    grep -v 'transaction_timeout' "$DUMP_FILE" | grep -v '^\\restrict' | grep -v '^\\unrestrict' > "$IMPORT_SQL"
  fi
  sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "$IMPORT_SQL"
else
  sudo -u postgres pg_restore -d "${DB_NAME}" --no-owner --no-acl --role="${DB_USER}" "$DUMP_FILE"
fi

echo "==> Granting schema privileges..."
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};"

echo "==> Starting app..."
cd "${APP_DIR}"
pm2 start ocean-school || pm2 restart ocean-school --update-env
pm2 save

echo "Database import complete."
