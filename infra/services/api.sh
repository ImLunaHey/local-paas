#!/usr/bin/env bash
# Run this checkout's development API with dedicated service connections.
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/services/config.sh
cargo build -p control-plane --bin control-plane --bin platform-ingress
optional_env=()
for setting in CLICKHOUSE_URL CLICKHOUSE_PASSWORD_FILE OPENBAO_ADDR OPENBAO_CA_FILE OPENBAO_TOKEN_FILE; do
  if [ -n "${!setting:-}" ]; then optional_env+=("--setenv=$setting=${!setting}"); fi
done
owner=$(systemctl --user show local-paas-api --property=WorkingDirectory --value 2>/dev/null || true)
if [ -n "$owner" ] && [ "$owner" != "$PWD" ]; then echo 'API belongs to another checkout.' >&2; exit 1; fi
if [ -f "$HOME/.config/systemd/user/local-paas-api.service" ]; then
  systemctl --user restart local-paas-api
else
systemctl --user stop local-paas-api || true
systemd-run --user --unit=local-paas-api --collect --property="WorkingDirectory=$PWD" \
 --property=Restart=on-failure --property=LimitCORE=0 --property=MemorySwapMax=0 \
 --setenv="PATH=$PATH" --setenv="DATABASE_URL=$DATABASE_URL" --setenv="PUBLIC_ORIGIN=$PUBLIC_ORIGIN" \
 --setenv="PREVIEW_HOST=$PREVIEW_HOST" --setenv="PREVIEW_PORTS=$PREVIEW_PORTS" \
 "${optional_env[@]}" \
 "$PWD/target/debug/control-plane"

fi

# Wait for migrations/listener before starting the independent ingress on first boot.
for api_attempt in {1..30}; do
  if curl --silent --fail http://127.0.0.1:8080/api/health >/dev/null; then
    bash infra/services/ingress.sh
    exit 0
  fi
  sleep 1
done
echo 'API did not become ready; ingress was not changed.' >&2
exit 1
