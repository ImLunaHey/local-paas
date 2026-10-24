# Shared operator configuration. Source from the repository root.
# This is trusted administrator configuration, never application dotenv input.
if [ -f .local/platform.env ]; then
  set -a
  source .local/platform.env
  set +a
fi
if [ -d .local/host-tools/bin ]; then export PATH="$PWD/.local/host-tools/bin:$PATH"; fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DATABASE_URL="${DATABASE_URL:-postgresql:///local_paas?host=$PWD/.local/socket&port=55432}"
export BETTER_AUTH_SECRET_FILE="${BETTER_AUTH_SECRET_FILE:-$PWD/.local/auth.secret}"
export PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-}"
export PREVIEW_HOST="${PREVIEW_HOST:-}"
export PREVIEW_PORTS="${PREVIEW_PORTS:-}"
# Basic API/UI development works without optional infrastructure.
if [ -f .local/platform-services/controller.token ]; then
  export OPENBAO_ADDR="${OPENBAO_ADDR:-https://127.0.0.1:18200}"
  export OPENBAO_CA_FILE="${OPENBAO_CA_FILE:-$PWD/.local/platform-services/tls/ca.pem}"
  export OPENBAO_TOKEN_FILE="${OPENBAO_TOKEN_FILE:-$PWD/.local/platform-services/controller.token}"
fi
if [ -f .local/platform-services/clickhouse.password ]; then
  export CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://127.0.0.1:18123}"
  export CLICKHOUSE_PASSWORD_FILE="${CLICKHOUSE_PASSWORD_FILE:-$PWD/.local/platform-services/clickhouse.password}"
fi
