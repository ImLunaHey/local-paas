#!/usr/bin/env bash
# Explicit backup operator for the already provisioned private Lake development stack.
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export OPENBAO_ADDR=https://127.0.0.1:18200
export OPENBAO_CA_FILE="$PWD/.local/platform-services/tls/ca.pem"
export OPENBAO_TOKEN_FILE="$PWD/.local/platform-services/controller.token"
cargo build -p control-plane --bin platform-backup
backup_action=${1:-run}
case "$backup_action" in
  install)
    # Persistent user units survive T3, shell and host restarts (user lingering is required).
    backup_units="$HOME/.config/systemd/user"
    mkdir -p "$backup_units"
    cat > "$backup_units/local-paas-backup.service" <<UNIT
[Unit]
Description=Local PaaS encrypted backup and restore drill
[Service]
Type=oneshot
WorkingDirectory=$PWD
Environment=XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR
Environment=OPENBAO_ADDR=$OPENBAO_ADDR
Environment=OPENBAO_CA_FILE=$OPENBAO_CA_FILE
Environment=OPENBAO_TOKEN_FILE=$OPENBAO_TOKEN_FILE
EnvironmentFile=-$PWD/.local/backups/destination.env
ExecStart=$PWD/target/debug/platform-backup run $PWD
ExecStartPost=$PWD/target/debug/platform-backup verify $PWD
ExecStopPost=$PWD/target/debug/platform-backup resume $PWD
TimeoutStartSec=30min
TimeoutStopSec=90
KillMode=control-group
UMask=0077
NoNewPrivileges=yes
LimitCORE=0
MemoryMax=1536M
MemorySwapMax=0
[Install]
WantedBy=default.target
UNIT
    cat > "$backup_units/local-paas-backup.timer" <<'UNIT'
[Unit]
Description=Daily Local PaaS encrypted backup
[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=15min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now local-paas-backup.timer
    ;;
  init|run|verify|resume) exec "$PWD/target/debug/platform-backup" "$backup_action" "$PWD" ;;
  *) echo 'usage: backup.sh init|run|verify|resume|install' >&2; exit 2 ;;
esac
