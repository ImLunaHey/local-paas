#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
systemd-run --user --unit=local-paas-agent-gateway --collect \
  --property="WorkingDirectory=$PWD" --property=Restart=on-failure \
  --setenv="XDG_CONFIG_HOME=$PWD/.local/caddy/config" \
  --setenv="XDG_DATA_HOME=$PWD/.local/caddy/data" \
  "$PWD/.local/worker-tools/bin/caddy" run \
  --config "$PWD/.local/worker-credentials/Caddyfile" --adapter caddyfile
