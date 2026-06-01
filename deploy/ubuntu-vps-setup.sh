#!/usr/bin/env bash
# One-time setup on Ubuntu 22.04/24.04 VPS for Ocean School app.
# Run as root or with sudo: bash deploy/ubuntu-vps-setup.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ocean-school}"
DB_NAME="${DB_NAME:-ocean_school}"
DB_USER="${DB_USER:-ocean_user}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
NODE_MAJOR="${NODE_MAJOR:-20}"

echo "==> Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ufw postgresql postgresql-contrib

echo "==> Installing Node.js ${NODE_MAJOR}..."
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
apt-get install -y nodejs
npm install -g pm2

echo "==> Creating PostgreSQL role and database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

echo "==> Preparing app directory: ${APP_DIR}"
mkdir -p "${APP_DIR}"

if [ ! -f "${APP_DIR}/.env" ]; then
  STAFF_SECRET="$(openssl rand -hex 32)"
  cat > "${APP_DIR}/.env" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
PORT=3001
STAFF_AUTH_SECRET=${STAFF_SECRET}
EOF
  chmod 600 "${APP_DIR}/.env"
  echo "Created ${APP_DIR}/.env"
else
  echo "Keeping existing ${APP_DIR}/.env"
fi

echo "==> Firewall (SSH + HTTP + HTTPS)..."
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

echo ""
echo "Setup complete."
echo "Next steps:"
echo "  1) Upload project files into ${APP_DIR}"
echo "  2) cd ${APP_DIR} && npm install && npm run db:init"
echo "  3) pm2 start deploy/ecosystem.config.cjs"
echo "  4) pm2 save && pm2 startup"
echo "  5) Copy deploy/nginx-ocean.conf to /etc/nginx/sites-available/ocean-school"
echo "     then: ln -sf /etc/nginx/sites-available/ocean-school /etc/nginx/sites-enabled/"
echo "     nginx -t && systemctl reload nginx"
echo ""
echo "Database credentials (save these):"
echo "  DB_USER=${DB_USER}"
echo "  DB_PASS=${DB_PASS}"
echo "  DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
