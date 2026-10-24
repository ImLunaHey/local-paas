#!/usr/bin/env bash
# Recreate the development worker's transient unit, including after an explicit stop.
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/services/config.sh
if [ "${1:-}" = --run ]; then
  source .local/builder.env
  export DATABASE_URL
  exec "$PWD/target/debug/build-worker"
fi
if systemctl --user is-active --quiet local-paas-build-worker; then
  echo 'Build worker is already running.'
  exit 0
fi
cargo build -p control-plane --bin build-worker
if [ -f "$HOME/.config/systemd/user/local-paas-build-worker.service" ]; then
  systemctl --user start local-paas-build-worker
  exit 0
fi
systemctl --user reset-failed local-paas-build-worker 2>/dev/null || true
systemd-run --user --unit=local-paas-build-worker --collect \
  --property="WorkingDirectory=$PWD" --property=Restart=on-failure --property=RestartSec=3 \
  --property=LimitCORE=0 --property=MemorySwapMax=0 \
  "$(command -v bash)" "$PWD/infra/builder/worker.sh" --run
