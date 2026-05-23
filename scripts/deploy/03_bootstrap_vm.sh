#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

OCI="oci --profile $OCI_PROFILE"

: "${VM_PUBLIC_IP:?Run 02_provision_vm.sh first}"

REPO_ROOT="$(cd ../.. && pwd)"
SSH_PRIVKEY="${SSH_PUBKEY_FILE%.pub}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i $SSH_PRIVKEY"
SSH="ssh $SSH_OPTS opc@$VM_PUBLIC_IP"

echo "==> 1. Test SSH connectivity"
$SSH "echo 'SSH OK'" || { echo "ERROR: Cannot SSH to $VM_PUBLIC_IP"; exit 1; }

echo ""
echo "==> 2. Install packages"
$SSH 'sudo dnf install -y --quiet oracle-epel-release-el9 2>/dev/null || true'
$SSH 'sudo dnf config-manager --enable ol9_developer_EPEL 2>/dev/null || true'
$SSH 'sudo dnf install -y --quiet nodejs npm nginx rsync'
$SSH 'sudo dnf install -y --quiet --enablerepo=ol9_developer_EPEL certbot python3-certbot-nginx 2>/dev/null || true'
echo "  Packages installed"

echo ""
echo "==> 3. Create app directory"
$SSH 'sudo mkdir -p /opt/sniper/uploads /opt/sniper/data && sudo chown -R opc:opc /opt/sniper'

echo ""
echo "==> 4. Sync app source"
rsync -az --delete \
    --exclude node_modules \
    --exclude uploads \
    --exclude data \
    --exclude .env \
    --exclude .git \
    --exclude 'scripts/deploy/state.env' \
    --exclude security \
    --exclude credentials.info \
    -e "ssh $SSH_OPTS" \
    "$REPO_ROOT/" "opc@$VM_PUBLIC_IP:/opt/sniper/"
echo "  Source synced"

echo ""
echo "==> 5. npm install"
$SSH 'cd /opt/sniper && npm install --omit=dev --no-audit --no-fund'

echo ""
echo "==> 6. Configure .env"
if ! $SSH 'test -f /opt/sniper/.env'; then
    SESSION_SECRET="$(openssl rand -hex 32)"
    ADMIN_PASSWORD="$(openssl rand -base64 16)"

    echo ""
    echo "  Admin credentials:"
    echo "    Email:    admin@sniper.local"
    echo "    Password: $ADMIN_PASSWORD"
    echo ""

    read -rp "  SMTP user (Gmail address, empty for mock): " SMTP_USER
    SMTP_PASS=""
    if [ -n "$SMTP_USER" ]; then
        read -rs -p "  SMTP app password: " SMTP_PASS
        echo ""
    fi

    $SSH "cat > /opt/sniper/.env" <<EOF
PORT=$APP_PORT
NODE_ENV=production
SESSION_SECRET=$SESSION_SECRET
DB_PATH=./data/sniper.db
UPLOAD_DIR=./uploads
ADMIN_PASSWORD=$ADMIN_PASSWORD
APP_URL=https://$APP_DOMAIN
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-}
SMTP_FROM=${SMTP_USER:-noreply@sniper.app}
PENDING_TIMEOUT_MINUTES=240
CONFIRMATION_MIN_MINUTES=30
EOF
    $SSH 'chmod 600 /opt/sniper/.env'
    save_state ADMIN_PASSWORD "$ADMIN_PASSWORD"
else
    echo "  .env already exists, skipping"
fi

echo ""
echo "==> 7. systemd service"
$SSH 'sudo tee /etc/systemd/system/sniper.service >/dev/null' <<'UNIT'
[Unit]
Description=Sniper Parking Enforcement
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opc
WorkingDirectory=/opt/sniper
EnvironmentFile=/opt/sniper/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

$SSH 'sudo systemctl daemon-reload && sudo systemctl enable sniper && sudo systemctl restart sniper'
sleep 3
echo "  Service status:"
$SSH 'sudo systemctl --no-pager --lines=5 status sniper || true'

echo ""
echo "==> 8. Firewall + SELinux"
$SSH 'sudo firewall-cmd --permanent --add-service=http --add-service=https 2>/dev/null && sudo firewall-cmd --reload' || true
$SSH 'sudo setsebool -P httpd_can_network_connect 1 2>/dev/null' || true
echo "  Firewall configured"

echo ""
echo "==> 9. nginx reverse proxy"
$SSH "sudo tee /etc/nginx/conf.d/sniper.conf >/dev/null" <<NGINX
server {
    listen 80 default_server;
    server_name $APP_DOMAIN _;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
$SSH 'sudo rm -f /etc/nginx/conf.d/default.conf 2>/dev/null; sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx'
echo "  nginx configured"

echo ""
echo "==> 10. End-to-end test"
sleep 2
echo "  Local test:"
$SSH "curl -sf http://127.0.0.1:$APP_PORT/api/health" || echo "  WARN: local health check failed"
echo ""
echo "  External test:"
curl -sS --max-time 10 "http://$VM_PUBLIC_IP/api/health" || echo "  WARN: external test failed (check NSG/firewall)"

echo ""
echo "==================================================="
echo "Bootstrap complete!"
echo ""
echo "  App: http://$VM_PUBLIC_IP"
echo "  Health: http://$VM_PUBLIC_IP/api/health"
echo ""
echo "  Next steps:"
echo "  1. DNS: $APP_DOMAIN -> $VM_PUBLIC_IP"
echo "  2. Certbot: $SSH 'sudo certbot --nginx -d $APP_DOMAIN --non-interactive --agree-tos -m egidio.casati@gmail.com'"
echo "  3. Restrict SSH in NSG to your IP"
echo "==================================================="
