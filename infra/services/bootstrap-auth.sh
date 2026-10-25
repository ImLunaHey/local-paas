#!/usr/bin/env bash
# Create or rotate the local closed-registration bootstrap accounts without exposing passwords.
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/services/config.sh
if [ -f .local/dev-auth.env ]; then
  auth_permissions=$(stat -c '%a' .local/dev-auth.env)
  if (( (8#$auth_permissions & 077) != 0 )); then
    echo '.local/dev-auth.env must not be accessible by group or other users.' >&2
    exit 1
  fi
  # This ignored file is trusted local shell configuration and must contain no commands.
  # shellcheck source=/dev/null
  source .local/dev-auth.env
fi
resolve_value() {
  local value=$1
  if [[ "$value" == op://* ]]; then
    if ! command -v op >/dev/null 2>&1; then
      echo '1Password CLI (op) is required to resolve dev-auth secret references.' >&2
      return 1
    fi
    op read "$value"
  else
    printf '%s' "$value"
  fi
}
root_username=$(resolve_value "${LOCAL_PAAS_ROOT_USERNAME:-root}")
root_password=$(resolve_value "${LOCAL_PAAS_ROOT_PASSWORD:-}")
admin_username=$(resolve_value "${LOCAL_PAAS_ADMIN_USERNAME:-admin}")
admin_password=$(resolve_value "${LOCAL_PAAS_ADMIN_PASSWORD:-}")
unset LOCAL_PAAS_ROOT_USERNAME LOCAL_PAAS_ROOT_PASSWORD
unset LOCAL_PAAS_ADMIN_USERNAME LOCAL_PAAS_ADMIN_PASSWORD
if [ -z "$root_password" ]; then
  read -rsp 'root password: ' root_password
  printf '\n' >&2
fi
if [ -z "$admin_password" ]; then
  read -rsp 'admin password: ' admin_password
  printf '\n' >&2
fi
printf '%s\n%s\n' "$root_password" "$admin_password" \
  | LOCAL_PAAS_ROOT_USERNAME="$root_username" \
    LOCAL_PAAS_ADMIN_USERNAME="$admin_username" \
    cargo run -p control-plane --bin platform-auth-bootstrap
unset root_username root_password admin_username admin_password
