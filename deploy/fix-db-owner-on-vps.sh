#!/usr/bin/env bash
# Give ocean_user ownership of app tables (needed for npm run db:init after SQL import as postgres).
# Does NOT use REASSIGN OWNED BY postgres (that fails on system objects).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
DB_NAME="${DB_NAME:-ocean_school}"
DB_USER="${DB_USER:-ocean_user}"

if [ -f "${APP_DIR}/.env" ]; then
  DB_URL="$(grep '^DATABASE_URL=' "${APP_DIR}/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")"
  if [ -n "${DB_URL}" ]; then
    DB_NAME="$(echo "${DB_URL}" | sed -n 's|.*/\([^/?]*\).*|\1|p')"
    DB_USER="$(echo "${DB_URL}" | sed -n 's|.*://\([^:]*\):.*|\1|p')"
  fi
fi

echo "==> Fixing PostgreSQL ownership: database=${DB_NAME} app_user=${DB_USER}"

sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<EOSQL
ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};
GRANT ALL ON SCHEMA public TO ${DB_USER};
GRANT CREATE ON SCHEMA public TO ${DB_USER};
EOSQL

echo "==> Transferring public tables to ${DB_USER}..."
sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<EOSQL
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO ${DB_USER}', r.tablename);
  END LOOP;
END \$\$;
EOSQL

echo "==> Transferring sequences to ${DB_USER}..."
sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<EOSQL
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO ${DB_USER}', r.sequence_name);
  END LOOP;
END \$\$;
EOSQL

sudo -u postgres psql -d "${DB_NAME}" <<EOSQL
GRANT ALL ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};
EOSQL

echo "==> Ownership fix complete."
