#!/usr/bin/env bash
# Create or rotate the local closed-registration bootstrap accounts without exposing passwords.
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/services/config.sh
read -rsp 'root password: ' root_password
printf '\n' >&2
read -rsp 'organization user password: ' member_password
printf '\n' >&2
printf '%s\n%s\n' "$root_password" "$member_password" \
  | cargo run -p control-plane --bin platform-auth-bootstrap
unset root_password member_password
