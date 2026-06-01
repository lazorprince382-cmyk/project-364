#!/usr/bin/env bash
# Emergency recovery: clone public GitHub repo, restore .env + uploads, restart PM2.
# Run on VPS:  cd ~ && bash /path/to/recover-vps-from-github.sh
set -euo pipefail

cd ~

APP_DIR="/var/www/ocean-school"
REPO="https://github.com/lazorprince382-cmyk/project-364.git"
BACKUP="$(ls -dt /var/www/ocean-school-backup-* 2>/dev/null | head -1 || true)"

echo "==> Removing broken install (if any)..."
rm -rf "${APP_DIR}"

echo "==> Cloning from GitHub..."
git clone --branch main --depth 1 "${REPO}" "${APP_DIR}"

if [ -f /tmp/ocean-env-backup ]; then
  echo "==> Restoring .env from /tmp/ocean-env-backup"
  cp -a /tmp/ocean-env-backup "${APP_DIR}/.env"
elif [ -n "${BACKUP}" ] && [ -f "${BACKUP}/.env" ]; then
  echo "==> Restoring .env from ${BACKUP}"
  cp -a "${BACKUP}/.env" "${APP_DIR}/.env"
else
  echo "WARNING: No .env found. Copy your .env into ${APP_DIR}/.env before starting."
fi

if [ -d /tmp/ocean-uploads-backup ]; then
  echo "==> Restoring uploads from /tmp"
  mkdir -p "${APP_DIR}/uploads"
  cp -a /tmp/ocean-uploads-backup/. "${APP_DIR}/uploads/"
elif [ -n "${BACKUP}" ] && [ -d "${BACKUP}/uploads" ]; then
  echo "==> Restoring uploads from backup"
  cp -a "${BACKUP}/uploads" "${APP_DIR}/"
fi

cd "${APP_DIR}"
echo "==> npm install ..."
npm install --omit=dev

if [ -f deploy/fix-db-owner-on-vps.sh ]; then
  bash deploy/fix-db-owner-on-vps.sh 2>/dev/null || true
fi

echo "==> Database migrations ..."
npm run db:init

echo "==> PM2 restart ..."
pm2 delete ocean-school 2>/dev/null || true
pm2 start deploy/ecosystem.config.cjs --update-env
pm2 save

echo ""
echo "Recovery done."
pm2 status
echo "Open http://YOUR_VPS_IP/ and hard-refresh (Ctrl+F5)."
