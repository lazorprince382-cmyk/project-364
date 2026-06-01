#!/usr/bin/env bash
# Remove app from VPS after presentation (keeps PostgreSQL installed unless you uncomment drop lines).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
DB_NAME="${DB_NAME:-ocean_school}"
DB_USER="${DB_USER:-ocean_user}"

pm2 delete ocean-school || true
pm2 save || true

rm -rf "${APP_DIR}"
rm -f /etc/nginx/sites-enabled/ocean-school
rm -f /etc/nginx/sites-available/ocean-school
nginx -t && systemctl reload nginx

# Uncomment to fully remove database too:
# sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};"
# sudo -u postgres psql -c "DROP USER IF EXISTS ${DB_USER};"

echo "Ocean School app removed from this VPS."
