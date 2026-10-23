#!/usr/bin/env bash
# Run this checkout's development API with dedicated service connections.
set -euo pipefail
cd "$(dirname "$0")/../.."
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
cargo build -p control-plane --bin control-plane
systemctl --user stop local-paas-api || true
systemd-run --user --unit=local-paas-api --collect --property="WorkingDirectory=$PWD" \
 --property=Restart=on-failure --property=LimitCORE=0 --property=MemorySwapMax=0 \
 --setenv="DATABASE_URL=postgresql:///local_paas?host=$PWD/.local/socket&port=55432" \
 --setenv=PUBLIC_ORIGIN=https://lake.tail3275e2.ts.net:5188 \
 --setenv=PREVIEW_HOST=lake.tail3275e2.ts.net --setenv=PREVIEW_PORTS=5201,5202,5203,5204,5205 \
 --setenv=CLICKHOUSE_URL=http://127.0.0.1:18123 \
 --setenv="CLICKHOUSE_PASSWORD_FILE=$PWD/.local/platform-services/clickhouse.password" \
 --setenv=OPENBAO_ADDR=https://127.0.0.1:18200 \
 --setenv="OPENBAO_CA_FILE=$PWD/.local/platform-services/tls/ca.pem" \
 --setenv="OPENBAO_TOKEN_FILE=$PWD/.local/platform-services/controller.token" \
 "$PWD/target/debug/control-plane"
