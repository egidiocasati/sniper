#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

OCI="oci --profile $OCI_PROFILE"

: "${COMPARTMENT_ID:?Set COMPARTMENT_ID in env.sh}"
[ "$COMPARTMENT_ID" = "FILL_AFTER_ACCOUNT_CREATION" ] && { echo "ERROR: Set COMPARTMENT_ID in env.sh"; exit 1; }

echo "==> 1. VCN"
VCN_ID="$($OCI network vcn list \
    --compartment-id "$COMPARTMENT_ID" \
    --query "data[?\"display-name\"==\`$VCN_NAME\`] | [0].id" --raw-output 2>/dev/null || true)"

if [ -z "$VCN_ID" ] || [ "$VCN_ID" = "null" ]; then
    echo "  Creating VCN $VCN_NAME..."
    VCN_ID="$($OCI network vcn create \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$VCN_NAME" \
        --cidr-blocks "[\"$VCN_CIDR\"]" \
        --dns-label "sniper" \
        --wait-for-state AVAILABLE \
        --query 'data.id' --raw-output)"
    echo "  Created: $VCN_ID"
else
    echo "  Already exists: $VCN_ID"
fi
save_state VCN_ID "$VCN_ID"

# Get default security list
SL_DEFAULT_ID="$($OCI network security-list list \
    --compartment-id "$COMPARTMENT_ID" --vcn-id "$VCN_ID" \
    --query 'data[0].id' --raw-output)"
save_state SL_DEFAULT_ID "$SL_DEFAULT_ID"

echo ""
echo "==> 2. Internet Gateway"
IG_ID="$($OCI network internet-gateway list \
    --compartment-id "$COMPARTMENT_ID" --vcn-id "$VCN_ID" \
    --query "data[?\"display-name\"==\`$IG_NAME\`] | [0].id" --raw-output 2>/dev/null || true)"

if [ -z "$IG_ID" ] || [ "$IG_ID" = "null" ]; then
    echo "  Creating Internet Gateway..."
    IG_ID="$($OCI network internet-gateway create \
        --compartment-id "$COMPARTMENT_ID" \
        --vcn-id "$VCN_ID" \
        --display-name "$IG_NAME" \
        --is-enabled true \
        --wait-for-state AVAILABLE \
        --query 'data.id' --raw-output)"
    echo "  Created: $IG_ID"
else
    echo "  Already exists: $IG_ID"
fi
save_state IG_ID "$IG_ID"

echo ""
echo "==> 3. Route Table"
RT_ID="$($OCI network route-table list \
    --compartment-id "$COMPARTMENT_ID" --vcn-id "$VCN_ID" \
    --query "data[?\"display-name\"==\`$RT_NAME\`] | [0].id" --raw-output 2>/dev/null || true)"

ROUTE_RULES="[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"$IG_ID\"}]"

if [ -z "$RT_ID" ] || [ "$RT_ID" = "null" ]; then
    echo "  Creating Route Table..."
    RT_ID="$($OCI network route-table create \
        --compartment-id "$COMPARTMENT_ID" \
        --vcn-id "$VCN_ID" \
        --display-name "$RT_NAME" \
        --route-rules "$ROUTE_RULES" \
        --wait-for-state AVAILABLE \
        --query 'data.id' --raw-output)"
    echo "  Created: $RT_ID"
else
    echo "  Already exists: $RT_ID"
    echo "  Updating routes..."
    $OCI network route-table update \
        --rt-id "$RT_ID" \
        --route-rules "$ROUTE_RULES" \
        --force --wait-for-state AVAILABLE > /dev/null
fi
save_state RT_ID "$RT_ID"

echo ""
echo "==> 4. Network Security Group"
NSG_ID="$($OCI network nsg list \
    --compartment-id "$COMPARTMENT_ID" --vcn-id "$VCN_ID" \
    --query "data[?\"display-name\"==\`$NSG_NAME\`] | [0].id" --raw-output 2>/dev/null || true)"

if [ -z "$NSG_ID" ] || [ "$NSG_ID" = "null" ]; then
    echo "  Creating NSG..."
    NSG_ID="$($OCI network nsg create \
        --compartment-id "$COMPARTMENT_ID" \
        --vcn-id "$VCN_ID" \
        --display-name "$NSG_NAME" \
        --wait-for-state AVAILABLE \
        --query 'data.id' --raw-output)"
    echo "  Created: $NSG_ID"
else
    echo "  Already exists: $NSG_ID"
fi
save_state NSG_ID "$NSG_ID"

# Remove existing rules for idempotence
echo "  Cleaning existing rules..."
EXISTING_RULES="$($OCI network nsg rules list --nsg-id "$NSG_ID" --query 'data[].id' --raw-output 2>/dev/null || true)"
if [ -n "$EXISTING_RULES" ] && [ "$EXISTING_RULES" != "null" ] && [ "$EXISTING_RULES" != "[]" ]; then
    for rule_id in $(echo "$EXISTING_RULES" | tr -d '[]," '); do
        [ -z "$rule_id" ] && continue
        $OCI network nsg rules remove --nsg-id "$NSG_ID" --security-rule-ids "[\"$rule_id\"]" --force 2>/dev/null || true
    done
fi

echo "  Adding ingress rules (HTTP, HTTPS, SSH)..."
$OCI network nsg rules add --nsg-id "$NSG_ID" --security-rules "[
    {\"direction\":\"INGRESS\",\"protocol\":\"6\",\"source\":\"0.0.0.0/0\",\"sourceType\":\"CIDR_BLOCK\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":80,\"max\":80}},\"description\":\"HTTP\"},
    {\"direction\":\"INGRESS\",\"protocol\":\"6\",\"source\":\"0.0.0.0/0\",\"sourceType\":\"CIDR_BLOCK\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":443,\"max\":443}},\"description\":\"HTTPS\"},
    {\"direction\":\"INGRESS\",\"protocol\":\"6\",\"source\":\"0.0.0.0/0\",\"sourceType\":\"CIDR_BLOCK\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":22,\"max\":22}},\"description\":\"SSH\"},
    {\"direction\":\"EGRESS\",\"protocol\":\"all\",\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"description\":\"All outbound\"}
]" > /dev/null

echo ""
echo "==> 5. Subnet"
SUBNET_ID="$($OCI network subnet list \
    --compartment-id "$COMPARTMENT_ID" --vcn-id "$VCN_ID" \
    --query "data[?\"display-name\"==\`$SUBNET_NAME\`] | [0].id" --raw-output 2>/dev/null || true)"

if [ -z "$SUBNET_ID" ] || [ "$SUBNET_ID" = "null" ]; then
    echo "  Creating Subnet..."
    SUBNET_ID="$($OCI network subnet create \
        --compartment-id "$COMPARTMENT_ID" \
        --vcn-id "$VCN_ID" \
        --display-name "$SUBNET_NAME" \
        --cidr-block "$SUBNET_CIDR" \
        --route-table-id "$RT_ID" \
        --security-list-ids "[\"$SL_DEFAULT_ID\"]" \
        --dns-label "snipersub" \
        --wait-for-state AVAILABLE \
        --query 'data.id' --raw-output)"
    echo "  Created: $SUBNET_ID"
else
    echo "  Already exists: $SUBNET_ID"
fi
save_state SUBNET_ID "$SUBNET_ID"

echo ""
echo "==================================================="
echo "Network provisioning complete."
echo "  VCN_ID    = $VCN_ID"
echo "  IG_ID     = $IG_ID"
echo "  RT_ID     = $RT_ID"
echo "  NSG_ID    = $NSG_ID"
echo "  SUBNET_ID = $SUBNET_ID"
echo "==================================================="
