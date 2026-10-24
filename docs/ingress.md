# Independent ingress and external edge integration

## Private ingress

`local-paas-ingress` runs `platform-ingress`, a Rust process separate from the API,
build worker and scheduler. `make api` builds both binaries and starts ingress if
absent; subsequent controller restarts leave ingress running. Explicitly restart
ingress with `bash infra/services/ingress.sh --restart` after rebuilding it.
It binds only `127.0.0.1:8090`. Existing Tailscale Serve preview URLs stay unchanged.

Ingress refreshes desired routes from PostgreSQL every two seconds and probes each
backend's configured readiness path with a two-second timeout. Only agent-ready,
active, routing-enabled HTTP instances enter its snapshot. Local health checks
continue when the API and agent observations are offline. The worker containers
continue running; ingress does not require a running controller to route them.

Route snapshots have ten-second leases. If PostgreSQL or snapshot refresh becomes
unavailable, expired routes return 503. Slot allocation retains an additional
five-second grace after every ingress/private route lease, even after cleanup.
Slow uploads recheck the selected lease before connecting; connection setup is
bounded below that grace period. This prevents stale route snapshots reaching a
different application after slot reuse. Existing HTTP/WebSocket connections are
not transparently migrated and can end when the old process stops.

HTTP, SSE and WebSockets use the existing bounded streaming proxy. Unknown hosts,
unready replacements, expired routes and unhealthy backends receive no traffic.
Routes include registered private previews and assigned global domains. A global
domain's UI status remains `pending-edge`: local resolution does not prove public
DNS, TLS issuance or an external route is operational. Domain reassignment is read
from durable state on the next refresh.

This is controller-outage tolerance, not database/host high availability. Ingress,
PostgreSQL and all three workers still depend on one host. The current ingress database
connection uses the development administrator role on the private Unix socket;
a restricted ingress role is required before moving database access outside this
host. The external gateway design below never exposes PostgreSQL.

## Prepared external configuration — not deployed

`infra/edge/Caddyfile.public` and `Caddyfile.gateway` are parsed deployment inputs.
No VPS was selected or modified, no public DNS was changed, and no NetBird client
was enrolled by this increment. Caddy adaptation was checked with explicit dummy
addresses and file paths; it is not a live certificate/connectivity test.

NetBird management is an external prerequisite. Do not make its own public
management endpoint depend on an already-working NetBird tunnel. This repository
does not depend on any separate personal infrastructure checkout.

Deployment needs the actual VPS/SSH target, its current proxy/service layout,
NetBird management readiness and enrollment, the two peer addresses, and the
public CNAME target/domain ownership. Preserve existing routes and Tailscale
access. The public path will be:

```text
verified application domain -> DigitalOcean Caddy (public TLS)
  -> NetBird -> private mTLS gateway :18444
  -> independent Rust ingress :8090 -> healthy worker endpoints
```

Use a dedicated edge CA, separate from node-agent and OpenBao identities. The
server certificate must cover `ingress.local-paas`; the VPS holds a client
certificate scoped to this gateway. All configuration takes private **file paths**,
not key values. Restrict NetBird policy to the edge peer/group reaching the private
gateway on TCP 18444, with a corresponding host firewall rule. Never trust the
entire NetBird interface or grant workloads the management LAN. Review any existing
NetBird default all-to-all policy before connecting the platform. Workers keep
their current outbound mTLS protocol; physical workers still require enrollment,
private endpoint addressing and explicitly scoped network policy.

The public configuration requires `PLATFORM_DOMAINS` (space-separated, verified
hostnames), `PLATFORM_ACME_EMAIL`, `PLATFORM_GATEWAY_NETBIRD_ADDRESS`, and
`PLATFORM_EDGE_CA_FILE`, `PLATFORM_EDGE_CERT_FILE`, `PLATFORM_EDGE_KEY_FILE`.
The gateway configuration requires the same peer address and CA file, plus
`PLATFORM_GATEWAY_CERT_FILE` and `PLATFORM_GATEWAY_KEY_FILE`.

Caddy maintains ACME state under `/var/lib/local-paas-edge/caddy`, owned by its
service user. Keep that directory across restarts; monitor issuance/renewal and
expiry. Public TCP 80/443 must reach the designated edge for the configured ACME
flow. Do not enable arbitrary on-demand certificate issuance. The gateway has no
public listener or administrator API. Both configuration files disable Caddy's
admin endpoint; install them as dedicated supervised services or merge reviewed
site blocks into the VPS's existing Caddy configuration without replacing other
applications. No second-edge failover is implemented.

Before any application cutover, verify DNS/CNAME ownership, TLS renewal, allowed
and denied peer access, WebSocket/SSE traffic, controller outage, gateway outage,
and DNS rollback using a disposable domain. Existing Railway deployments remain
untouched. Off-site backup automation is not implemented; local backups do not protect
against losing the platform host.

The transport configuration follows Caddy's [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
and [mutual TLS](https://caddyserver.com/docs/caddyfile/directives/tls) documentation.
NetBird's [access policy documentation](https://docs.netbird.io/manage/access-control/manage-network-access)
describes peer groups, port-scoped access, and its initial full-mesh default policy.
