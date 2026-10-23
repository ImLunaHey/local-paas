#!/usr/bin/env bash
# Generate short-lived development credentials outside Git and the Nix store.
set -euo pipefail
cd "$(dirname "$0")/../.."
builder_tools=$(readlink -f .local/builder-tools)
builder_certs="$PWD/.local/builder-tls"
if [[ -e "$builder_certs/client.key" ]]; then
  echo 'Builder credentials already exist; refusing to replace them.' >&2
  exit 1
fi
umask 077
mkdir -p "$builder_certs/guest"
"$builder_tools/bin/openssl" req -x509 -newkey rsa:3072 -nodes -days 30 \
  -subj /CN=local-paas-development-builder-ca \
  -keyout "$builder_certs/ca.key" -out "$builder_certs/ca.crt" 2>/dev/null
for role in server client; do
  "$builder_tools/bin/openssl" req -new -newkey rsa:3072 -nodes \
    -subj "/CN=local-paas-builder-$role" \
    -keyout "$builder_certs/$role.key" -out "$builder_certs/$role.csr" 2>/dev/null
  if [[ "$role" == server ]]; then
    printf '%s\n' 'subjectAltName=DNS:local-paas-builder' 'extendedKeyUsage=serverAuth' > "$builder_certs/extensions"
  else
    printf '%s\n' 'extendedKeyUsage=clientAuth' > "$builder_certs/extensions"
  fi
  "$builder_tools/bin/openssl" x509 -req -days 30 -CA "$builder_certs/ca.crt" \
    -CAkey "$builder_certs/ca.key" -CAcreateserial -extfile "$builder_certs/extensions" \
    -in "$builder_certs/$role.csr" -out "$builder_certs/$role.crt" 2>/dev/null
done
cp "$builder_certs/ca.crt" "$builder_certs/server.crt" "$builder_certs/server.key" "$builder_certs/guest/"
"$builder_tools/bin/genisoimage" -quiet -R -V BUILDER_TLS \
  -o "$builder_certs/credentials.iso" "$builder_certs/guest"
rm -r "$builder_certs/guest"
cat > .local/builder.env <<EOF
export BUILD_GIT_PATH='$builder_tools/bin/git'
export BUILDCTL_PATH='$builder_tools/bin/buildctl'
export BUILDKIT_ADDR='tcp://127.0.0.1:12340'
export BUILDKIT_TLS_CA='$builder_certs/ca.crt'
export BUILDKIT_TLS_CERT='$builder_certs/client.crt'
export BUILDKIT_TLS_KEY='$builder_certs/client.key'
export BUILDKIT_TLS_SERVER_NAME='local-paas-builder'
export BUILD_REGISTRY_PREFIX='127.0.0.1:15000/platform'
export BUILD_REGISTRY_INSECURE='true'
EOF
echo 'Created 30-day local builder credentials and .local/builder.env.'
