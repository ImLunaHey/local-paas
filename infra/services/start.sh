#!/usr/bin/env bash
# Dedicated development services; never connects to Lake's existing ClickHouse.
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
nix build path:./infra/services -o .local/service-tools
service_root="$PWD/.local/platform-services"
mkdir -p "$service_root"/{clickhouse,openbao,recovery,tls}
if [ ! -f "$service_root/clickhouse.password" ]; then
  .local/worker-tools/bin/openssl rand -hex 32 > "$service_root/clickhouse.password"
fi
password_hash=$(tr -d '\n' < "$service_root/clickhouse.password" | .local/worker-tools/bin/openssl dgst -sha256 -r | cut -d ' ' -f 1)
cat > "$service_root/clickhouse.xml" <<XML
<clickhouse>
 <logger><level>warning</level><log>$service_root/clickhouse/server.log</log><errorlog>$service_root/clickhouse/error.log</errorlog><size>10M</size><count>3</count></logger>
 <listen_host>127.0.0.1</listen_host><http_port>18123</http_port>
 <path>$service_root/clickhouse/</path><tmp_path>$service_root/clickhouse/tmp/</tmp_path>
 <max_server_memory_usage>1610612736</max_server_memory_usage>
 <background_pool_size>4</background_pool_size><background_schedule_pool_size>4</background_schedule_pool_size>
 <mark_cache_size>134217728</mark_cache_size><uncompressed_cache_size>67108864</uncompressed_cache_size>
 <profiles><default><max_memory_usage>536870912</max_memory_usage><max_threads>2</max_threads><log_queries>0</log_queries></default></profiles>
 <users><platform><password_sha256_hex>$password_hash</password_sha256_hex><networks><ip>127.0.0.1</ip></networks><profile>default</profile><quota>default</quota></platform></users>
 <quotas><default><interval><duration>3600</duration><queries>0</queries><errors>0</errors><result_rows>0</result_rows><read_rows>0</read_rows><execution_time>0</execution_time></interval></default></quotas>
 <merge_tree><number_of_free_entries_in_pool_to_execute_mutation>2</number_of_free_entries_in_pool_to_execute_mutation><number_of_free_entries_in_pool_to_lower_max_size_of_merge>2</number_of_free_entries_in_pool_to_lower_max_size_of_merge><number_of_free_entries_in_pool_to_execute_optimize_entire_partition>2</number_of_free_entries_in_pool_to_execute_optimize_entire_partition></merge_tree>
</clickhouse>
XML
if [ ! -f "$service_root/tls/ca.pem" ]; then
  .local/worker-tools/bin/openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj /CN=local-paas-secrets-ca -addext "basicConstraints=critical,CA:TRUE" -keyout "$service_root/tls/ca.key" -out "$service_root/tls/ca.pem" 2>/dev/null
  .local/worker-tools/bin/openssl req -new -newkey rsa:3072 -nodes -subj /CN=local-paas-openbao -keyout "$service_root/tls/server.key" -out "$service_root/tls/server.csr" 2>/dev/null
  printf "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n" > "$service_root/tls/server.ext"
  .local/worker-tools/bin/openssl x509 -req -in "$service_root/tls/server.csr" -CA "$service_root/tls/ca.pem" -CAkey "$service_root/tls/ca.key" -CAcreateserial -days 365 -extfile "$service_root/tls/server.ext" -out "$service_root/tls/server.pem" 2>/dev/null
fi
cat > "$service_root/openbao.hcl" <<HCL
ui = false
disable_mlock = true
storage "file" { path = "$service_root/openbao" }
listener "tcp" {
 address = "127.0.0.1:18200"
 tls_cert_file = "$service_root/tls/server.pem"
 tls_key_file = "$service_root/tls/server.key"
}
api_addr = "https://127.0.0.1:18200"
HCL
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
for service_kind in clickhouse openbao; do
  if systemctl --user is-active --quiet "local-paas-$service_kind"; then continue; fi
  if [ -f "$HOME/.config/systemd/user/local-paas-$service_kind.service" ]; then
    systemctl --user start "local-paas-$service_kind"
    continue
  fi
  if [ "$service_kind" = clickhouse ]; then
    set -- "$PWD/.local/service-tools/bin/clickhouse" server "--config-file=$service_root/clickhouse.xml"
    service_memory=2G
  else
    set -- "$PWD/.local/service-tools/bin/bao" server "-config=$service_root/openbao.hcl"
    service_memory=512M
  fi
  systemd-run --user --unit="local-paas-$service_kind" --collect \
    --property=Restart=on-failure --property=RestartSec=5 --property="WorkingDirectory=$service_root" \
    --property=LimitCORE=0 --property="MemoryMax=$service_memory" --property=MemorySwapMax=0 \
    --property=UMask=0077 --property=NoNewPrivileges=true \
    --property=CPUQuota=100% --property=TasksMax=256 "$@"
done
printf 'Dedicated services: ClickHouse 127.0.0.1:18123, OpenBao https://127.0.0.1:18200\n'
