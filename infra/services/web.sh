#!/usr/bin/env bash
# Keep Vite outside the terminal/T3 process group. make supplies PUBLIC_ORIGIN.
set -euo pipefail
cd "$(dirname "$0")/../.."
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [ "${1:-}" = --run ]; then
  exec make web-foreground
fi
unit=local-paas-web.service
owner=$(systemctl --user show "$unit" --property=WorkingDirectory --value 2>/dev/null || true)
if [ -n "$owner" ] && [ "$owner" != "$PWD" ]; then
  echo 'The frontend service belongs to another checkout.' >&2
  exit 1
fi
if systemctl --user is-active --quiet "$unit"; then
  if [ "${1:-}" != --restart ]; then
    echo 'Frontend is already running.'
    exit 0
  fi
  systemctl --user stop "$unit"
fi
if [ "$(systemctl --user show "$unit" --property=LoadState --value 2>/dev/null)" = loaded ]; then
  systemctl --user start "$unit"
  exit 0
fi
systemctl --user reset-failed "$unit" 2>/dev/null || true
systemd-run --user --unit="$unit" --collect \
  --property="WorkingDirectory=$PWD" --property=Restart=on-failure --property=RestartSec=3 \
  --property=LimitCORE=0 --setenv="PATH=$PATH" --setenv="PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-}" \
  "$(command -v bash)" "$PWD/infra/services/web.sh" --run
