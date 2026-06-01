#!/usr/bin/env bash
# One-time: link /var/www/ocean-school to GitHub (keeps .env + uploads).
# Usage on VPS:
#   export GITHUB_REPO=https://github.com/lazorprince382-cmyk/project-364.git
#   bash deploy/setup-git-on-vps.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
REPO="${GITHUB_REPO:-https://github.com/lazorprince382-cmyk/project-364.git}"
BRANCH="${DEPLOY_BRANCH:-main}"

if [ -d "${APP_DIR}/.git" ]; then
  echo "Already a git repo: ${APP_DIR}"
  git -C "${APP_DIR}" remote -v
  exit 0
fi

if [ ! -f "${APP_DIR}/.env" ]; then
  echo "ERROR: ${APP_DIR}/.env not found. Create .env before linking git."
  exit 1
fi

STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP="/var/www/ocean-school-backup-${STAMP}"
echo "==> Backing up current app to ${BACKUP} ..."
cp -a "${APP_DIR}" "${BACKUP}"

ENV_TMP="$(mktemp)"
UPLOADS_TMP=""
cp -a "${APP_DIR}/.env" "${ENV_TMP}"
if [ -d "${APP_DIR}/uploads" ]; then
  UPLOADS_TMP="$(mktemp -d)"
  cp -a "${APP_DIR}/uploads/." "${UPLOADS_TMP}/"
fi

echo "==> Cloning ${REPO} ..."
rm -rf "${APP_DIR}"
git clone --branch "${BRANCH}" --depth 1 "${REPO}" "${APP_DIR}"

cp -a "${ENV_TMP}" "${APP_DIR}/.env"
rm -f "${ENV_TMP}"
if [ -n "${UPLOADS_TMP}" ] && [ -d "${UPLOADS_TMP}" ]; then
  mkdir -p "${APP_DIR}/uploads"
  cp -a "${UPLOADS_TMP}/." "${APP_DIR}/uploads/"
  rm -rf "${UPLOADS_TMP}"
fi

cd "${APP_DIR}"
npm install --omit=dev
bash deploy/fix-db-owner-on-vps.sh 2>/dev/null || true
npm run db:init

if pm2 describe ocean-school >/dev/null 2>&1; then
  pm2 restart ocean-school --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

echo ""
echo "GitHub linked. Backup kept at: ${BACKUP}"
echo "Future deploys: git pull or bash deploy/deploy-from-github.sh"
