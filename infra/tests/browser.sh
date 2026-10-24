#!/usr/bin/env bash
# Disposable browser-test dependencies. Never reads operator .local settings.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to a disposable PostgreSQL database}"
if [[ "$DATABASE_URL" != */platform_test && "$DATABASE_URL" != */platform_e2e ]]; then
  echo 'Browser tests require a database named platform_test or platform_e2e.' >&2
  exit 1
fi
root=$(mktemp -d)
chmod 700 "$root"
cleanup() {
  for pid in ${api_pid:-} ${bao_pid:-}; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$root"
}
trap cleanup EXIT
export OPENBAO_ADDR=https://127.0.0.1:18300
export OPENBAO_CA_FILE="$root/vault-ca.pem" OPENBAO_TOKEN_FILE="$root/token"
export BAO_DEV_ROOT_TOKEN_ID=$(openssl rand -hex 24)
printf '%s' "$BAO_DEV_ROOT_TOKEN_ID" > "$OPENBAO_TOKEN_FILE"
bao server -dev -dev-tls -dev-no-store-token -dev-listen-address=127.0.0.1:18300 -dev-tls-cert-dir="$root" > "$root/bao.log" 2>&1 &
bao_pid=$!
for i in $(seq 1 100); do
  if [ -f "$OPENBAO_CA_FILE" ] && curl -sf --cacert "$OPENBAO_CA_FILE" "$OPENBAO_ADDR/v1/sys/health" > /dev/null; then break; fi
  sleep 0.1
done
curl -sf --cacert "$OPENBAO_CA_FILE" "$OPENBAO_ADDR/v1/sys/health" > /dev/null
BAO_ADDR="$OPENBAO_ADDR" BAO_CACERT="$OPENBAO_CA_FILE" BAO_TOKEN="$BAO_DEV_ROOT_TOKEN_ID" bao secrets enable -path=platform kv-v2 > /dev/null
export PORT=${PORT:-18080} WEB_PORT=${WEB_PORT:-15188}
export API_TARGET="http://127.0.0.1:$PORT" E2E_BASE_URL="http://127.0.0.1:$WEB_PORT"
export BROWSER_ORIGIN="$E2E_BASE_URL" PUBLIC_ORIGIN="$E2E_BASE_URL"
export E2E_AUTH_PASSWORD_FILE="$root/browser.password"
export E2E_AUTH_STATE="$root/browser-auth.json"
openssl rand -base64 48 > "$E2E_AUTH_PASSWORD_FILE"
chmod 600 "$E2E_AUTH_PASSWORD_FILE"
./target/debug/platform-migrate
{
  sed -n '1p' "$E2E_AUTH_PASSWORD_FILE"
  sed -n '1p' "$E2E_AUTH_PASSWORD_FILE"
} | ./target/debug/platform-auth-bootstrap
./target/debug/control-plane > "$root/api.log" 2>&1 &
api_pid=$!
for i in $(seq 1 100); do
  if curl -sf "$API_TARGET/api/health" > /dev/null; then break; fi
  sleep 0.1
done
curl -sf "$API_TARGET/api/health" > /dev/null
pnpm --dir web test:e2e
