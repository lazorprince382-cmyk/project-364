#!/usr/bin/env bash
# Install static gate portal and nginx config on VPS.
# Usage: bash deploy/setup-gate-portal.sh
set -euo pipefail

IP="${VPS_IP:-185.214.134.41}"
GATE_DIR="${GATE_DIR:-/var/www/gate-portal}"
APP_DIR="${APP_DIR:-/var/www/ocean-school}"

mkdir -p "${GATE_DIR}"
cp "${APP_DIR}/deploy/gate-portal/index.html" "${GATE_DIR}/index.html"
sed -i "s/YOUR_DOMAIN_OR_IP/${IP}/g" "${GATE_DIR}/index.html"

sed "s/YOUR_DOMAIN_OR_IP/${IP}/g" "${APP_DIR}/deploy/nginx-vps-gate.conf" \
  > /etc/nginx/sites-available/vps-gate

ln -sf /etc/nginx/sites-available/vps-gate /etc/nginx/sites-enabled/vps-gate
rm -f /etc/nginx/sites-enabled/ocean-school

nginx -t
systemctl reload nginx

ufw allow 3001/tcp || true
ufw allow 3002/tcp || true
ufw allow 4000/tcp || true

echo "Gate portal: http://${IP}/"
echo "Ocean School: http://${IP}:3001/"
echo "Kitchen:      http://${IP}:3002/  (confirm port with: pm2 show kitchen)"
echo "App 4000:     http://${IP}:4000/"
