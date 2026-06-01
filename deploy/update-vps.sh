#!/usr/bin/env bash
# Update an existing Ocean School install on the VPS (keeps .env and uploads/).
# Usage: bash deploy/update-vps.sh [/tmp/ocean-school-update.tgz]
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
ARCHIVE="${1:-}"

cd "${APP_DIR}"

if [ ! -f .env ]; then
  echo "ERROR: ${APP_DIR}/.env missing. Run deploy/ubuntu-vps-setup.sh first or restore .env."
  exit 1
fi

if [ -n "${ARCHIVE}" ] && [ -f "${ARCHIVE}" ]; then
  echo "==> Applying code update from ${ARCHIVE}..."
  ENV_BACKUP="$(mktemp)"
  cp -a .env "${ENV_BACKUP}"
  tar -xzf "${ARCHIVE}" -C "${APP_DIR}" --exclude='.env' --exclude='./uploads' --exclude='uploads'
  cp -a "${ENV_BACKUP}" .env
  rm -f "${ENV_BACKUP}"
fi

echo "==> Installing dependencies..."
npm install --omit=dev

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Fixing database ownership (required if tables were imported as postgres)..."
bash "${SCRIPT_DIR}/fix-db-owner-on-vps.sh"

echo "==> Running database migrations (safe on existing data)..."
if ! npm run db:init; then
  echo ""
  echo "ERROR: db:init failed. On VPS run:"
  echo "  cd ${APP_DIR} && bash deploy/fix-db-owner-on-vps.sh && npm run db:init"
  exit 1
fi

echo "==> Restarting app..."
if pm2 describe ocean-school >/dev/null 2>&1; then
  pm2 restart ocean-school --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

echo ""
echo "Update finished."
echo "  pm2 logs ocean-school --lines 30   # if something looks wrong"
echo "  Hard-refresh browsers: Ctrl+F5"
