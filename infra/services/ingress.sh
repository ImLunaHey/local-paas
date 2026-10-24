#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
if systemctl --user is-active --quiet local-paas-ingress; then
  if [ "${1:-}" != --restart ]; then exit 0; fi
  systemctl --user stop local-paas-ingress
fi
systemd-run --user --unit=local-paas-ingress --collect \
 --property="WorkingDirectory=$PWD" --property=Restart=on-failure \
 --property=RestartSec=2 --property=LimitCORE=0 --property=MemoryMax=256M \
 --property=MemorySwapMax=0 --property=NoNewPrivileges=true \
 --setenv="DATABASE_URL=postgresql:///local_paas?host=$PWD/.local/socket&port=55432" \
 "$PWD/target/debug/platform-ingress"
