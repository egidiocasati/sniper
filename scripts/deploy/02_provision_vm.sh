#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

OCI="oci --profile $OCI_PROFILE"

# Prerequisites
: "${SUBNET_ID:?Run 01_provision_network.sh first}"
: "${NSG_ID:?Run 01_provision_network.sh first}"

if [ ! -f "$SSH_PUBKEY_FILE" ]; then
    echo "ERROR: SSH public key not found at $SSH_PUBKEY_FILE"
    exit 1
fi

# Discover availability domain
echo "==> 1. Discovering Availability Domain..."
AD="$($OCI iam availability-domain list --query 'data[0].name' --raw-output)"
echo "  AD: $AD"

# Discover latest Oracle Linux 9 image for the chosen shape
echo ""
echo "==> 2. Discovering latest OL9 image for $SHAPE..."
IMAGE_ID="$($OCI compute image list \
    --compartment-id "$COMPARTMENT_ID" \
    --operating-system "Oracle Linux" \
    --operating-system-version "9" \
    --shape "$SHAPE" \
    --sort-by TIMECREATED --sort-order DESC --limit 1 \
    --query 'data[0].id' --raw-output)"
echo "  Image: $IMAGE_ID"
save_state IMAGE_ID "$IMAGE_ID"

echo ""
echo "==> 3. Checking for existing VM..."
VM_INSTANCE_ID="$($OCI compute instance list \
    --compartment-id "$COMPARTMENT_ID" \
    --display-name "$VM_NAME" \
    --lifecycle-state RUNNING \
    --query 'data[0].id' --raw-output 2>/dev/null || true)"

if [ -n "$VM_INSTANCE_ID" ] && [ "$VM_INSTANCE_ID" != "null" ]; then
    echo "  VM already exists: $VM_INSTANCE_ID"
else
    echo "  Creating VM $VM_NAME..."
    SSH_KEY="$(cat "$SSH_PUBKEY_FILE")"

    # Cloud-init script for initial setup (swap + packages)
    CLOUD_INIT="$(dirname "$0")/cloud-init.sh"
    USERDATA_ARGS=()
    if [ -f "$CLOUD_INIT" ]; then
        echo "  Using cloud-init script for initial setup"
        USERDATA_ARGS=(--user-data-file "$CLOUD_INIT")
    fi

    LAUNCH_ARGS=(
        --compartment-id "$COMPARTMENT_ID"
        --availability-domain "$AD"
        --display-name "$VM_NAME"
        --shape "$SHAPE"
        --image-id "$IMAGE_ID"
        --subnet-id "$SUBNET_ID"
        --nsg-ids "[\"$NSG_ID\"]"
        --assign-public-ip true
        --hostname-label "sniper"
        --metadata "{\"ssh_authorized_keys\":\"$SSH_KEY\"}"
        "${USERDATA_ARGS[@]}"
        --wait-for-state RUNNING
        --query 'data.id' --raw-output
    )

    # Flex shapes need shape-config, fixed shapes don't
    if [[ "$SHAPE" == *".Flex" ]]; then
        LAUNCH_ARGS+=(--shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}")
    fi

    VM_INSTANCE_ID="$($OCI compute instance launch "${LAUNCH_ARGS[@]}")"
    echo "  Created: $VM_INSTANCE_ID"
fi
save_state VM_INSTANCE_ID "$VM_INSTANCE_ID"

echo ""
echo "==> 4. Getting IP addresses..."

# Get VNIC
VNIC_ID="$($OCI compute instance list-vnics \
    --instance-id "$VM_INSTANCE_ID" \
    --query 'data[0].id' --raw-output)"

VNIC_DATA="$($OCI network vnic get --vnic-id "$VNIC_ID" --query 'data' --raw-output)"
VM_PUBLIC_IP="$(echo "$VNIC_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['public-ip'])")"
VM_PRIVATE_IP="$(echo "$VNIC_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['private-ip'])")"

save_state VM_PUBLIC_IP "$VM_PUBLIC_IP"
save_state VM_PRIVATE_IP "$VM_PRIVATE_IP"

echo ""
echo "==================================================="
echo "VM provisioning complete."
echo "  Instance: $VM_INSTANCE_ID"
echo "  Public:   $VM_PUBLIC_IP"
echo "  Private:  $VM_PRIVATE_IP"
echo ""
echo "Next: bash 03_bootstrap_vm.sh"
echo ""
echo "DNS: Point $APP_DOMAIN -> $VM_PUBLIC_IP"
echo "==================================================="
