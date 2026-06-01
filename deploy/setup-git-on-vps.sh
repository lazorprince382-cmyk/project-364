#!/usr/bin/env bash
# One-time: link /var/www/ocean-school to GitHub (keeps .env + uploads).
#
# Private repo — set a token before running:
#   export GITHUB_TOKEN=ghp_your_token_here
#   bash deploy/setup-git-on-vps.sh
#
# Or make the repo public on GitHub (Settings → Danger zone → Change visibility).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
REPO="${GITHUB_REPO:-https://github.com/lazorprince382-cmyk/project-364.git}"
BRANCH="${DEPLOY_BRANCH:-main}"

if [ -n "${GITHUB_TOKEN:-}" ]; then
  REPO="https://${GITHUB_TOKEN}@github.com/lazorprince382-cmyk/project-364.git"
fi

if [ -d "${APP_DIR}/.git" ]; then
  echo "Already a git repo: ${APP_DIR}"
  git -C "${APP_DIR}" remote -v
  exit 0
fi

if [ ! -f "${APP_DIR}/.env" ]; then
  echo "ERROR: ${APP_DIR}/.env not found."
  echo "If clone failed earlier, restore backup:"
  echo "  ls -d /var/www/ocean-school-backup-*"
  echo "  cp -a /var/www/ocean-school-backup-XXXX/.env /var/www/ocean-school/  # adjust path"
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

CLONE_TMP="$(mktemp -d)"
echo "==> Cloning ${BRANCH} (private repos need GITHUB_TOKEN or public repo) ..."
if ! git clone --branch "${BRANCH}" --depth 1 "${REPO}" "${CLONE_TMP}"; then
  echo ""
  echo "ERROR: git clone failed."
  echo "  1) Make repo public: github.com/lazorprince382-cmyk/project-364 → Settings → Change visibility"
  echo "  2) Or: export GITHUB_TOKEN=ghp_xxx   (GitHub → Settings → Developer settings → PAT)"
  echo "Backup kept at: ${BACKUP}"
  rm -rf "${CLONE_TMP}"
  exit 1
fi

echo "==> Installing clone into ${APP_DIR} ..."
rm -rf "${APP_DIR}"
mv "${CLONE_TMP}" "${APP_DIR}"

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
echo "GitHub linked. Backup: ${BACKUP}"
echo "Future deploys: bash deploy/deploy-from-github.sh"
