#!/usr/bin/env bash
# ==============================================================================
# Sniper - OCI deployment environment
# ==============================================================================

export OCI_PROFILE="sniper"
export REGION="eu-milan-1"

# Compartment: root compartment of the sniper tenancy
# Get from OCI Console -> Tenancy Details -> OCID
export COMPARTMENT_ID="${COMPARTMENT_ID:-FILL_AFTER_ACCOUNT_CREATION}"

# Network
export VCN_NAME="sniper-vcn"
export VCN_CIDR="10.0.0.0/16"
export SUBNET_NAME="sniper-subnet-public"
export SUBNET_CIDR="10.0.1.0/24"
export IG_NAME="sniper-ig"
export RT_NAME="sniper-rt-public"
export NSG_NAME="sniper-nsg"

# Compute
export VM_NAME="sniper-vm"
export SHAPE="VM.Standard.A1.Flex"
export OCPUS="1"
export MEMORY_GB="6"
# IMAGE_ID: discover at deploy time with:
#   oci --profile sniper compute image list --compartment-id $COMPARTMENT_ID \
#     --operating-system "Oracle Linux" --operating-system-version "9" \
#     --shape "VM.Standard.A1.Flex" --sort-by TIMECREATED --sort-order DESC --limit 1 \
#     --query 'data[0].id' --raw-output
export IMAGE_ID="${IMAGE_ID:-DISCOVER_AT_DEPLOY}"

# SSH
export SSH_PUBKEY_FILE="${SSH_PUBKEY_FILE:-$HOME/.ssh/id_ed25519.pub}"

# App
export APP_PORT="3001"
export APP_DOMAIN="sniper.vialeteodorico7.it"

# State management
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state.env"

if [ -f "$STATE_FILE" ]; then
    source "$STATE_FILE"
fi

save_state() {
    local key="$1"
    local value="$2"
    if [ -f "$STATE_FILE" ]; then
        grep -v "^export ${key}=" "$STATE_FILE" > "${STATE_FILE}.tmp" 2>/dev/null || true
        mv "${STATE_FILE}.tmp" "$STATE_FILE"
    fi
    echo "export ${key}=\"${value}\"" >> "$STATE_FILE"
    export "${key}=${value}"
    echo "  [state] ${key}=${value}"
}
