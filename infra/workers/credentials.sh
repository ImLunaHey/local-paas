#!/usr/bin/env bash
# Create node identities only when absent; never echo credentials or put them in Nix.
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
worker_tools=$(readlink -f .local/worker-tools)
worker_creds="$PWD/.local/worker-credentials"
mkdir -p "$worker_creds"
if ! test -f "$worker_creds/ca.key"; then
  "$worker_tools/bin/openssl" req -x509 -newkey rsa:3072 -nodes -days 30 -subj '/CN=local-paas-development-workers' -keyout "$worker_creds/ca.key" -out "$worker_creds/ca.crt" >/dev/null 2>&1
fi
if ! test -f "$worker_creds/server.crt"; then
  "$worker_tools/bin/openssl" req -new -newkey rsa:3072 -nodes -subj '/CN=local-paas-controller' -keyout "$worker_creds/server.key" -out "$worker_creds/server.csr" >/dev/null 2>&1
  printf '%s\n' 'subjectAltName=IP:10.0.2.2,IP:127.0.0.1,DNS:localhost,DNS:controller.local-paas' 'extendedKeyUsage=serverAuth' > "$worker_creds/extensions"
  "$worker_tools/bin/openssl" x509 -req -days 30 -CA "$worker_creds/ca.crt" -CAkey "$worker_creds/ca.key" -CAcreateserial -extfile "$worker_creds/extensions" -in "$worker_creds/server.csr" -out "$worker_creds/server.crt" >/dev/null 2>&1
fi
for worker_index in 1 2 3; do
  worker_dir="$worker_creds/$worker_index"
  mkdir -p "$worker_dir"
  if ! test -f "$worker_dir/config.json"; then
    node - "$worker_dir/config.json" "$worker_index" <<'NODE'
const fs=require('fs'),crypto=require('crypto');const index=Number(process.argv[3]);
fs.writeFileSync(process.argv[2],JSON.stringify({node_id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex'),name:`worker-${index}`,controller_url:'https://controller.local-paas:18443',cpu_millis:1000,memory_mib:1400,slots:4,endpoint_base:21000+(index-1)*100}),{mode:0o600});
NODE
  fi
  if ! test -f "$worker_dir/client.crt"; then
    worker_id=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).node_id)' "$worker_dir/config.json")
    "$worker_tools/bin/openssl" req -new -newkey rsa:3072 -nodes -subj "/CN=$worker_id" -keyout "$worker_dir/client.key" -out "$worker_dir/client.csr" >/dev/null 2>&1
    printf '%s\n' 'extendedKeyUsage=clientAuth' > "$worker_creds/extensions"
    "$worker_tools/bin/openssl" x509 -req -days 30 -CA "$worker_creds/ca.crt" -CAkey "$worker_creds/ca.key" -CAcreateserial -extfile "$worker_creds/extensions" -in "$worker_dir/client.csr" -out "$worker_dir/client.crt" >/dev/null 2>&1
  fi
  cp "$worker_creds/ca.crt" "$worker_dir/ca.crt"
  "$worker_tools/bin/genisoimage" -quiet -R -V NODE_CREDS -o "$worker_creds/node-$worker_index.iso" -graft-points "config.json=$worker_dir/config.json" "client.crt=$worker_dir/client.crt" "client.key=$worker_dir/client.key" "ca.crt=$worker_dir/ca.crt"
done
cat > "$worker_creds/Caddyfile" <<CADDY
{
  admin off
  auto_https off
}
https://:18443 {
  bind 127.0.0.1
  tls $worker_creds/server.crt $worker_creds/server.key {
    client_auth {
      mode require_and_verify
      trust_pool file $worker_creds/ca.crt
    }
  }
  handle /api/agent/sync {
    reverse_proxy 127.0.0.1:8080 {
      header_up Host 127.0.0.1:8080
    }
  }
  handle {
    respond 404
  }
}
CADDY
"$worker_tools/bin/caddy" validate --config "$worker_creds/Caddyfile" --adapter caddyfile
