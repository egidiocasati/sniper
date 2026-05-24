#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

: "${VM_PUBLIC_IP:?Run 02_provision_vm.sh first}"

REPO_ROOT="$(cd ../.. && pwd)"
SSH_PRIVKEY="${SSH_PUBKEY_FILE%.pub}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -o ConnectTimeout=30 -i $SSH_PRIVKEY"
SSH="ssh $SSH_OPTS opc@$VM_PUBLIC_IP"

echo "==> 1. Waiting for cloud-init to finish..."
for i in $(seq 1 60); do
    if $SSH 'test -f /tmp/cloud-init-done' 2>/dev/null; then
        echo "  Cloud-init completed!"
        break
    fi
    [ "$i" -eq 60 ] && { echo "TIMEOUT"; exit 1; }
    echo "  Waiting... ($i/60)"
    sleep 30
done

echo ""
echo "==> 2. Verify Node.js"
$SSH 'node --version'

echo ""
echo "==> 3. Sync app source"
rsync -az --delete \
    --exclude node_modules \
    --exclude uploads \
    --exclude data \
    --exclude .env \
    --exclude .git \
    --exclude 'scripts/deploy/state.env' \
    --exclude security \
    --exclude credentials.info \
    --exclude ssl \
    -e "ssh $SSH_OPTS" \
    "$REPO_ROOT/" "opc@$VM_PUBLIC_IP:/opt/sniper/"
echo "  Source synced"

echo ""
echo "==> 4. npm install"
$SSH 'cd /opt/sniper && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5'

echo ""
echo "==> 5. Configure .env"
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
echo "==> 6. systemd service"
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
ExecStart=/usr/local/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

$SSH 'sudo systemctl daemon-reload && sudo systemctl enable sniper && sudo systemctl restart sniper'
sleep 3
echo "  Service status:"
$SSH 'sudo systemctl --no-pager --lines=5 status sniper || true'

echo ""
echo "==> 7. Firewall (port 80/443)"
$SSH 'sudo firewall-cmd --permanent --add-service=http --add-service=https 2>/dev/null && sudo firewall-cmd --reload' || true

echo ""
echo "==> 8. Port redirect 80 -> $APP_PORT (no nginx needed)"
$SSH "sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port $APP_PORT
sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port $APP_PORT
sudo sh -c 'iptables-save > /etc/sysconfig/iptables'
echo 'iptables rules saved'"

echo ""
echo "==> 9. End-to-end test"
sleep 2
echo "  Local test:"
$SSH "curl -sf http://127.0.0.1:$APP_PORT/api/health" || echo "  WARN: local health check failed"
echo ""
echo "  External test:"
curl -sS --max-time 10 "http://$VM_PUBLIC_IP/api/health" || echo "  WARN: external test failed (check firewall)"

echo ""
echo "==================================================="
echo "Bootstrap complete!"
echo ""
echo "  App: http://$VM_PUBLIC_IP"
echo "  Health: http://$VM_PUBLIC_IP/api/health"
echo ""
echo "  Next steps:"
echo "  1. DNS: $APP_DOMAIN -> $VM_PUBLIC_IP"
echo "  2. HTTPS: install certbot and configure SSL"
echo "==================================================="
