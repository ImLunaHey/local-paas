#!/usr/bin/env bash
# Recreate the development worker's transient unit, including after an explicit stop.
set -euo pipefail
export PATH="/run/current-system/sw/bin:${PATH:-}"
cd "$(dirname "$0")/../.."
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
if [ "${1:-}" = --run ]; then
  source .local/builder.env
  export DATABASE_URL="postgresql:///local_paas?host=$PWD/.local/socket&port=55432"
  exec "$PWD/target/debug/build-worker"
fi
if systemctl --user is-active --quiet local-paas-build-worker; then
  echo 'Build worker is already running.'
  exit 0
fi
cargo build -p control-plane --bin build-worker
systemctl --user reset-failed local-paas-build-worker 2>/dev/null || true
systemd-run --user --unit=local-paas-build-worker --collect \
  --property="WorkingDirectory=$PWD" --property=Restart=on-failure --property=RestartSec=3 \
  --property=LimitCORE=0 --property=MemorySwapMax=0 \
  /run/current-system/sw/bin/bash "$PWD/infra/builder/worker.sh" --run
