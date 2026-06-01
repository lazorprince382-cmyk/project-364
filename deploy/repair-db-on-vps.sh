#!/usr/bin/env bash
# Fix Ocean School database + app on VPS after a failed import.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
DB_NAME="${DB_NAME:-ocean_school}"
DB_USER="${DB_USER:-ocean_user}"
SQL_FILE="${1:-/tmp/ocean-school.sql}"

cd "${APP_DIR}"

echo "==> PostgreSQL status..."
systemctl is-active postgresql || systemctl start postgresql

if [ ! -f .env ]; then
  echo "ERROR: ${APP_DIR}/.env is missing. Re-run deploy/ubuntu-vps-setup.sh or create .env manually."
  exit 1
fi

echo "==> .env DATABASE_URL:"
grep '^DATABASE_URL=' .env | sed 's/:[^:@]*@/:***@/'

echo "==> Ensure database exists..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres createdb "${DB_NAME}" -O "${DB_USER}"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" || true

if [ -f "${SQL_FILE}" ]; then
  IMPORT_SQL="${SQL_FILE}"
  if grep -q 'transaction_timeout\|\\restrict\|\\unrestrict' "${SQL_FILE}"; then
    IMPORT_SQL="/tmp/ocean-school-import.sql"
    echo "==> Stripping PostgreSQL 18-only dump directives..."
    grep -v 'transaction_timeout' "${SQL_FILE}" | grep -v '^\\restrict' | grep -v '^\\unrestrict' > "${IMPORT_SQL}"
  fi
  echo "==> Importing ${IMPORT_SQL} with psql..."
  sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${IMPORT_SQL}"
else
  echo "==> No SQL dump at ${SQL_FILE}; applying schema via npm run db:init..."
  npm run db:init
fi

echo "==> Grants for app user..."
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};"

echo "==> Row check..."
sudo -u postgres psql -d "${DB_NAME}" -c "SELECT COUNT(*) AS students FROM students;" || true

echo "==> Restart app with .env loaded..."
pm2 delete ocean-school 2>/dev/null || true
pm2 start deploy/ecosystem.config.cjs --update-env
pm2 save

echo "==> Health check..."
sleep 2
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3001/ || true
curl -s http://127.0.0.1:3001/api/students?limit=1 | head -c 200 || true
echo ""
echo "Repair complete."
