#!/bin/bash
# Cloud-init: ONLY swap + Node.js binary (zero dnf)

# Swap
dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo "/swapfile swap swap defaults 0 0" >> /etc/fstab

# Node.js 20 LTS binary
curl -fsSL https://nodejs.org/dist/v20.19.2/node-v20.19.2-linux-x64.tar.xz -o /tmp/node.tar.xz
tar -xf /tmp/node.tar.xz -C /usr/local --strip-components=1
rm -f /tmp/node.tar.xz

# App directory
mkdir -p /opt/sniper/uploads /opt/sniper/data
chown -R opc:opc /opt/sniper

touch /tmp/cloud-init-done
