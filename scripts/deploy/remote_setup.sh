#!/usr/bin/env bash
# Remote setup script - runs entirely on the VM
# Executed via: scp + nohup to survive SSH disconnects
set -euo pipefail
LOG="/tmp/sniper-setup.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== Sniper setup started at $(date) ==="

# Step 1: Swap
if [ ! -f /swapfile ]; then
    echo "[1/4] Creating swap..."
    sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo "/swapfile swap swap defaults 0 0" | sudo tee -a /etc/fstab
else
    sudo swapon /swapfile 2>/dev/null || true
fi
echo "[1/4] Swap OK: $(free -m | grep Swap)"

# Step 2: Packages
echo "[2/4] Installing packages (this takes a while)..."
sudo dnf install -y nodejs npm nginx rsync 2>&1 | tail -5
echo "[2/4] Core packages done"
sudo dnf install -y oracle-epel-release-el9 2>&1 | tail -2 || true
sudo dnf config-manager --enable ol9_developer_EPEL 2>/dev/null || true
sudo dnf install -y certbot python3-certbot-nginx 2>&1 | tail -2 || true
echo "[2/4] All packages installed"

# Step 3: App directory
echo "[3/4] Setting up app directory..."
sudo mkdir -p /opt/sniper/uploads /opt/sniper/data
sudo chown -R opc:opc /opt/sniper

# Step 4: npm install (source will be synced before this runs)
if [ -f /opt/sniper/package.json ]; then
    echo "[4/4] npm install..."
    cd /opt/sniper && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3
    echo "[4/4] npm done"
else
    echo "[4/4] SKIP: package.json not found (source not synced yet)"
fi

echo "=== Sniper setup completed at $(date) ==="
touch /tmp/sniper-setup-done
