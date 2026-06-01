#!/usr/bin/env bash
# Run ON the VPS after copying files, OR invoked by deploy-recent-changes.ps1 via SSH.
# Usage:
#   cd /var/www/ocean-school && bash deploy/deploy-recent-changes.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
cd "${APP_DIR}"

if [ ! -f .env ]; then
  echo "ERROR: ${APP_DIR}/.env missing."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/fix-db-owner-on-vps.sh" 2>/dev/null || true

echo "==> Database migrations..."
npm run db:init

echo "==> Restarting app..."
if pm2 describe ocean-school >/dev/null 2>&1; then
  pm2 restart ocean-school --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

echo ""
echo "Done. Hard-refresh browsers (Ctrl+F5)."
