#!/usr/bin/env bash
# Pull latest code from GitHub and restart (keeps .env and uploads/).
# Run on VPS:  cd /var/www/ocean-school && bash deploy/deploy-from-github.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
BRANCH="${DEPLOY_BRANCH:-main}"
REMOTE="${DEPLOY_REMOTE:-origin}"

cd "${APP_DIR}"

if [ ! -f .env ]; then
  echo "ERROR: ${APP_DIR}/.env missing."
  exit 1
fi

if [ ! -d .git ]; then
  echo "ERROR: ${APP_DIR} is not a git clone yet."
  echo "  Run once: bash deploy/setup-git-on-vps.sh"
  exit 1
fi

echo "==> Pulling ${REMOTE}/${BRANCH} ..."
git fetch "${REMOTE}"
git checkout "${BRANCH}" 2>/dev/null || git checkout -b "${BRANCH}" "${REMOTE}/${BRANCH}"
git pull --ff-only "${REMOTE}" "${BRANCH}"

echo "==> npm install ..."
npm install --omit=dev

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/fix-db-owner-on-vps.sh" 2>/dev/null || true

echo "==> Database migrations ..."
npm run db:init

echo "==> Restart PM2 ..."
if pm2 describe ocean-school >/dev/null 2>&1; then
  pm2 restart ocean-school --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

echo ""
echo "Deploy from GitHub finished. Hard-refresh browsers (Ctrl+F5)."
