#!/usr/bin/env bash
# Explicit development provisioning; no host-wide rebuild or unrelated service changes.
set -euo pipefail
cd "$(dirname "$0")/../.."
worker_index=${1:?usage: start.sh 1|2|3}
case "$worker_index" in 1|2|3) ;; *) exit 2;; esac
worker_name="local-paas-worker-$worker_index"
worker_tools=$(readlink -f .local/worker-tools)
worker_vm=$(readlink -f ".local/worker-$worker_index-vm")
test -x "$worker_vm/bin/run-$worker_name-vm"
if sudo -n systemctl is-active --quiet "$worker_name"; then echo 'Worker already running; stop it before changing its configuration.' >&2; exit 1; fi
if ! getent group "$worker_name" >/dev/null; then sudo -n groupadd --system "$worker_name"; fi
if ! id "$worker_name" >/dev/null 2>&1; then sudo -n useradd --system --uid "$((61000 + worker_index))" --gid "$worker_name" --no-create-home --home-dir "/var/lib/$worker_name" --shell "$(command -v nologin)" "$worker_name"; fi
worker_uid=$(id -u "$worker_name")
test "$worker_uid" = "$((61000 + worker_index))" || { echo 'Unexpected worker UID; refusing to reuse an isolation identity.' >&2; exit 1; }
sudo -n install -d -m 0700 -o "$worker_name" -g "$worker_name" "/var/lib/$worker_name" "/var/lib/$worker_name/tmp"
sudo -n install -m 0440 -o root -g "$worker_name" ".local/worker-credentials/node-$worker_index.iso" "/var/lib/$worker_name/credentials.iso"
worker_rules=$(mktemp)
trap 'rm -f "$worker_rules"' EXIT
if sudo -n "$worker_tools/bin/nft" list table inet "local_paas_worker_$worker_index" >/dev/null 2>&1; then echo "delete table inet local_paas_worker_$worker_index" > "$worker_rules"; fi
cat >> "$worker_rules" <<RULES
table inet local_paas_worker_$worker_index {
 chain output {
  type filter hook output priority -10; policy accept;
  meta skuid $worker_uid jump worker_egress
 }
 chain worker_egress {
  ct state established,related accept
  ip daddr 127.0.0.1 tcp dport { 18443, 15000, 21000-21003, 21100-21103, 21200-21203 } accept
  meta nfproto ipv6 reject
  fib daddr type local reject
  ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4 } reject
 }
}
RULES
sudo -n "$worker_tools/bin/nft" -c -f "$worker_rules"
sudo -n "$worker_tools/bin/nft" -f "$worker_rules"
# Root-owned rules live outside the VM user's writable state directory.
sudo -n install -d -m 0755 -o root -g root /var/lib/local-paas /var/lib/local-paas/firewall
sudo -n install -m 0600 -o root -g root "$worker_rules" "/var/lib/local-paas/firewall/${worker_name:-local-paas-builder}.nft"
if [ "${2:-}" = --prepare ]; then exit 0; fi
sudo -n systemd-run --unit="$worker_name" --collect \
  --property="User=$worker_name" --property="Group=$worker_name" \
  --property="WorkingDirectory=/var/lib/$worker_name" \
  --property=ProtectSystem=strict --property=ProtectHome=true \
  --property="ReadWritePaths=/var/lib/$worker_name" --property=PrivateTmp=true \
  --property=NoNewPrivileges=true --property=CapabilityBoundingSet= \
  --property=ProtectKernelTunables=true --property=ProtectKernelModules=true \
  --property=ProtectControlGroups=true --property=RestrictSUIDSGID=true \
  --property=DevicePolicy=closed --property='DeviceAllow=/dev/kvm rw' \
  --property=MemoryMax=2600M --property=MemorySwapMax=0 --property=CPUQuota=100% \
  --property=TasksMax=128 --property=LimitCORE=0 --property=TimeoutStopSec=30 \
  --property=KillMode=control-group \
  --setenv="TMPDIR=/var/lib/$worker_name/tmp" --setenv=USE_TMPDIR=1 \
  "$worker_vm/bin/run-$worker_name-vm"
