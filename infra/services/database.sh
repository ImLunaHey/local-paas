#!/usr/bin/env bash
# Supervise only this checkout's development PostgreSQL, outside the invoking thread.
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/services/config.sh
umask 077
unit=local-paas-postgres.service
owner=$(systemctl --user show "$unit" --property=WorkingDirectory --value 2>/dev/null || true)
if [ -n "$owner" ] && [ "$owner" != "$PWD" ]; then
  echo 'The PostgreSQL service belongs to another checkout.' >&2
  exit 1
fi
if [ "${1:-}" = --stop ]; then
  if [ "$owner" = "$PWD" ]; then
    systemctl --user stop "$unit"
  elif pg_ctl -D .local/postgres status >/dev/null 2>&1; then
    pg_ctl -D .local/postgres -m fast -w stop
  fi
  exit 0
fi
mkdir -p .local/socket
chmod 700 .local .local/socket
if [ ! -f .local/postgres/PG_VERSION ]; then
  initdb -D .local/postgres --auth-local=trust --auth-host=reject --no-instructions
fi
if ! systemctl --user is-active --quiet "$unit"; then
  if [ "$owner" = "$PWD" ]; then
    systemctl --user start "$unit"
  else
    # Migrate an earlier pg_ctl-started instance without deleting its data.
    if pg_ctl -D .local/postgres status >/dev/null 2>&1; then
      pg_ctl -D .local/postgres -m fast -w stop
    fi
    systemctl --user reset-failed "$unit" 2>/dev/null || true
    systemd-run --user --unit="$unit" --collect \
      --property="WorkingDirectory=$PWD" --property=Restart=on-failure --property=RestartSec=3 \
      --property=KillSignal=SIGINT --property=KillMode=mixed --property=TimeoutStopSec=90 \
      --property=LimitCORE=0 --property=MemorySwapMax=0 --property=UMask=0077 \
      "$(command -v postgres)" -D "$PWD/.local/postgres" -k "$PWD/.local/socket" -h '' -p 55432
  fi
fi
ready=false
for attempt in {1..30}; do
  if pg_isready -q -h "$PWD/.local/socket" -p 55432; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo 'PostgreSQL did not become ready; inspect journalctl --user -u local-paas-postgres.' >&2
  exit 1
fi
exists=$(psql -h "$PWD/.local/socket" -p 55432 -d postgres -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname='local_paas'")
if [ "$exists" != 1 ]; then
  createdb -h "$PWD/.local/socket" -p 55432 local_paas
fi
printf 'PostgreSQL is running as %s.\n' "$unit"
