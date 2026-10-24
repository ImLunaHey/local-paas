#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/services/config.sh
if [ -f "$HOME/.config/systemd/user/local-paas-ingress.service" ]; then
  if [ "${1:-}" = --restart ]; then systemctl --user restart local-paas-ingress; else systemctl --user start local-paas-ingress; fi
  exit 0
fi
if systemctl --user is-active --quiet local-paas-ingress; then
  if [ "${1:-}" != --restart ]; then exit 0; fi
  systemctl --user stop local-paas-ingress
fi
systemd-run --user --unit=local-paas-ingress --collect \
 --property="WorkingDirectory=$PWD" --property=Restart=on-failure \
 --property=RestartSec=2 --property=LimitCORE=0 --property=MemoryMax=256M \
 --property=MemorySwapMax=0 --property=NoNewPrivileges=true \
 --setenv="DATABASE_URL=$DATABASE_URL" \
 "$PWD/target/debug/platform-ingress"
