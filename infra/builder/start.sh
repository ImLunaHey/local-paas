#!/usr/bin/env bash
# Explicit provisioning entry point. Does not rebuild Lake or touch its services.
set -euo pipefail
cd "$(dirname "$0")/../.."
builder_tools=$(readlink -f .local/builder-tools)
builder_vm=$(readlink -f .local/builder-vm)
test -x "$builder_vm/bin/run-local-paas-builder-vm"
test -f .local/builder-tls/credentials.iso
if sudo -n systemctl is-active --quiet local-paas-builder; then
  echo 'Builder is already running; stop it before changing its configuration.' >&2
  exit 1
fi
if ! id local-paas-builder >/dev/null 2>&1; then
  sudo -n useradd --system --user-group --no-create-home \
    --home-dir /var/lib/local-paas-builder --shell /run/current-system/sw/bin/nologin local-paas-builder
fi
builder_uid=$(id -u local-paas-builder)
sudo -n install -d -m 0700 -o local-paas-builder -g local-paas-builder /var/lib/local-paas-builder
sudo -n install -d -m 0700 -o local-paas-builder -g local-paas-builder /var/lib/local-paas-builder/tmp
sudo -n install -m 0440 -o root -g local-paas-builder \
  .local/builder-tls/credentials.iso /var/lib/local-paas-builder/credentials.iso
# Scope rules to the dedicated QEMU UID. Apply BEFORE starting any guest code.
# Existing host firewall tables/chains are left intact. Guest root cannot change
# these rules. Replies to loopback host-forwarded connections remain possible.
builder_rules=$(mktemp)
trap 'rm -f "$builder_rules"' EXIT
if sudo -n "$builder_tools/bin/nft" list table inet local_paas_builder >/dev/null 2>&1; then
  echo 'delete table inet local_paas_builder' > "$builder_rules"
fi
cat >> "$builder_rules" <<EOF
table inet local_paas_builder {
  chain output {
    type filter hook output priority -10; policy accept;
    meta skuid $builder_uid jump builder_egress
  }
  chain builder_egress {
    ct state established,related accept
    meta nfproto ipv6 counter reject
    fib daddr type local counter reject
    ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4 } counter reject
  }
}
EOF
sudo -n "$builder_tools/bin/nft" -c -f "$builder_rules"
sudo -n "$builder_tools/bin/nft" -f "$builder_rules"
sudo -n systemd-run --unit=local-paas-builder --collect \
  --property=User=local-paas-builder --property=Group=local-paas-builder \
  --property=WorkingDirectory=/var/lib/local-paas-builder \
  --property=ProtectSystem=strict --property=ProtectHome=true \
  --property=ReadWritePaths=/var/lib/local-paas-builder --property=PrivateTmp=true \
  --property=NoNewPrivileges=true --property=CapabilityBoundingSet= \
  --property=ProtectKernelTunables=true --property=ProtectKernelModules=true \
  --property=ProtectControlGroups=true --property=RestrictSUIDSGID=true \
  --property=DevicePolicy=closed --property='DeviceAllow=/dev/kvm rw' \
  --property=MemoryMax=4G --property=MemorySwapMax=0 --property=CPUQuota=200% \
  --property=TasksMax=128 --property=LimitCORE=0 --property=TimeoutStopSec=30 \
  --property=KillMode=control-group \
  --setenv=TMPDIR=/var/lib/local-paas-builder/tmp --setenv=USE_TMPDIR=1 \
  "$builder_vm/bin/run-local-paas-builder-vm"
echo 'Builder started. Inspect: sudo journalctl -u local-paas-builder -n 50'
