# Independent ingress and acknowledged public edge

## Private ingress

`platform-ingress` is supervised independently from the API, builder and scheduler.
It binds only `127.0.0.1:8090`. Existing Tailscale Serve preview URLs use the
unchanged private route registry. Restart ingress after upgrading its binary.

Every two seconds ingress reads desired routes and probes each backend's readiness
path. Snapshots have ten-second leases, and slot reuse retains a further five-second
grace. Slow uploads recheck their lease before connecting. Healthy private routes
can survive controller/agent observation outages while PostgreSQL remains available.
Database outages expire snapshots and return 503.

HTTP, SSE and WebSockets share the bounded streaming proxy. Unknown hosts, expired
routes and unhealthy backends receive no application traffic. Request headers cannot
select an arbitrary upstream or reach the management API. The reserved
`/.well-known/local-paas/route` path returns a generation only for a leased public
target with at least one healthy backend; applications cannot forge that observation.

## Public edge lifecycle

`platform-edge` runs on the management host, separately from the controller.
It uses the internal `Edge` interface; Caddy-specific JSON stays inside its adapter.
No infrastructure is provisioned by starting this worker.

1. Register a domain and assign an OCI web service. The UI supplies a public TXT
   challenge at `_local-paas.<hostname>`. This token proves DNS control; it is not
   an authentication secret. Keep the TXT record for subsequent verification.
2. Point DNS at the configured edge. The first adapter supports one explicit
   public IP address; all resolved A/AAAA answers must match it. DNS reads use the
   management host's configured resolver and respect TTLs. DNS writes remain with
   the operator/provider; there are no stored DNS-provider credentials.
3. Once the candidate passes readiness, the controller persists an edge generation
   and target deployment. It continues to report the deployment as preparing.
4. The worker verifies TXT and address records, grants a short-lived private
   upstream authority, checks its readiness, then updates Caddy's platform routes
   using its JSON API. Stable route IDs and ETag/If-Match protect concurrent edits.
   The adapter preserves unrelated routes and never calls `/load`, `/stop`, or a
   process reload. Unchanged routes cause no configuration write.
5. Caddy manages certificates for the verified hostname. The worker validates an
   HTTPS response through the configured edge address, including hostname trust,
   certificate expiry and the exact upstream generation. Public probes are pinned
   to the operator-configured address, not an untrusted DNS destination.
6. Only then does a transactional acknowledgement allow promotion. The old
   deployment remains running for a two-minute drain/rollback window. A new
   deployment or domain reassignment waits until that window completes.

This acknowledgement is an authenticated management readback plus a TLS-validated
data-path observation, not an operator checkbox or a successful PATCH alone.
Configuration, private key and certificate material remains in files on the relevant
hosts; PostgreSQL stores generations, deployment IDs, timestamps and fixed error codes.

The worker refreshes observations every twenty seconds. Public target grants and
acknowledgements last ninety seconds. A worker/database outage eventually closes
public forwarding even if Caddy retains its configuration. A successful read of
desired state alone cannot extend an acknowledgement. Certificate expiry is reported
in the Domains UI; certificates within seven days of expiry carry a renewal warning.
The worker observes certificates renewed by Caddy without rewriting unchanged routes.

## Rollback, removal and failures

Before promotion, a failed apply or probe restores and probes the previously
acknowledged generation when it remains healthy. An uncertain apply retains all
potentially referenced instances. On readiness failure or deployment timeout, the
controller requests rollback as a new generation; it does not stop the candidate
until the previous route (or removal for a first deployment) is acknowledged.

Use **Roll back public route** during promotion or the two-minute rollback window,
or `POST /api/deployments/{id}/rollback`. It requires deployment execution permission
in the owning organization. The previous deployment must still be healthy. A
controller restart resumes the persisted phase. Edge outages leave rollback pending;
no timeout invents a successful rollback. After acknowledgement, candidates drain
for two minutes before stopping. Long-lived connections are bounded by this window;
they are not migrated between revisions. After the window, deploy a retained image
revision through the normal deployment flow.

Unassigning a domain requests removal through Caddy's API. The UI reports
`removing` until authenticated readback confirms removal. Existing target leases
still fence shutdown/slot reuse. Direct stop requests that would bypass a rollout
or live route lease are rejected. Registration remains available for reassignment.
celld declarations remain separate and do not enter this OCI edge promotion flow.

If DNS ownership is lost, TLS cannot be validated, the gateway is unhealthy, or
the admin connection fails, the UI reports the specific pending/degraded condition.
No public reachability or rollback guarantee exists when neither revision is healthy.
Diagnose the worker, private management connection, Caddy issuance logs, gateway
client certificate and upstream readiness; do not bypass the acknowledgement barrier.

## Explicit installation

Use a dedicated Caddy instance or a reviewed `platform` HTTP server in an existing
instance. `infra/edge/caddy.json` is the initial API-managed configuration. Its
admin endpoint is a Unix socket in a service-owned directory; restrict that directory
and socket to the Caddy and management-gateway users. Persist Caddy's storage and
configuration directories and supervise it with `caddy run --resume` after the
initial bootstrap. This replaces the old static `Caddyfile.public` template;
loading an old Caddyfile over this instance would replace its managed routes.

For remote administration, `infra/edge/Caddyfile.admin` binds only the edge's
private network address on 18445. A dedicated management CA authenticates the worker.
It forwards only GET/PATCH of the platform route array to the Unix socket and denies
all other API paths. Do not expose the socket, admin gateway or its port publicly.
Use firewall and private-network policies scoped to the management peer. The server
certificate must cover the hostname in `adminUrl`; the worker identity PEM file
contains its client certificate and key.

The application path remains:

```text
verified application domain → public Caddy :443
  → private mTLS application gateway :18444 → Rust ingress :8090
  → healthy revision-specific worker endpoints
```

`Caddyfile.gateway` is the separate application gateway, with no admin endpoint.
Its server certificate covers `ingress.local-paas`; only the edge's dedicated
client identity is trusted. Restrict its bind address, private-network policy and
host firewall to the edge peer. Neither gateway exposes PostgreSQL, the node-agent
gateway or the operator API. NetBird management remains an independent prerequisite.
A single edge and three co-located worker VMs do not provide physical HA.

Copy `infra/edge/worker.example.json` to an operator-owned private configuration
file and replace its example addresses and file references. Admin CA/identity files
are on the management host; gateway certificate paths are on the **Caddy host**.
Alternatively set `adminSocket` to an absolute local socket path and omit
`adminUrl` for a co-located edge. Remote plaintext admin URLs are rejected.
`probeCaFile` is only needed for an explicitly trusted private development CA;
hostname verification is always enabled. The default local `ingressPort` is 8090.

Supervise `platform-edge` with `DATABASE_URL` and `EDGE_CONFIG_FILE`. It requires
the current migrated database, an independently running ingress process and read
access to its own credential files. Set `EDGE_CNAME_TARGET` on the operator API to
display the public DNS target. Installation is explicit; local development does
not authorize a VPS, DNS mutation, production cutover or Railway changes.

## Renewal, backup and recovery

Keep public 80/443 reachable for Caddy's chosen ACME challenge, maintain accurate
time and preserve its account/certificate storage. Do not enable arbitrary on-demand
issuance. Alert on the UI's certificate-expiring state and worker/edge errors.
Rotate management and gateway certificates through private files, restart the
worker to load changed client identities, and verify a fresh acknowledgement.
Caddy owns public leaf renewal; the controller only records observed expiry.

Back up Caddy's persistent storage and autosaved configuration encrypted, together
with protected gateway/management credential files and the PostgreSQL state. Never
copy private key values into application records, logs, issue comments or PRs.
Off-site backup automation remains separate work. Restore into an isolated fixture
first, start private ingress and the edge worker, and wait for fresh observations
before sending public traffic. Stale database acknowledgements are not authority
to reuse stopped worker endpoints.

Before DNS cutover, record the old DNS values and TTL, preserve the existing edge,
and verify a disposable hostname including HTTP, WebSocket/SSE, renewal, denied
hosts, controller/worker restart and gateway outage. For DNS rollback, restore the
recorded target and allow TTL convergence; keep the old deployment available until
its own health/route is verified. Do not stop either side based solely on a DNS write.

## Validation

Deterministic PostgreSQL tests cover promotion, restart/idempotency, uncertain
apply recovery, expired acknowledgements, outage during rollback, removal and
transactional audit records. The Caddy adapter fixture uses a real local Caddy,
disposable DNS and private TLS/mTLS certificates. It exercises issuance, renewal, scoped
API updates, ETags, unhealthy targets, denied hosts and removal. Existing ingress
tests cover bounded HTTP, WebSocket/SSE and stale snapshot fencing.

```sh
# DATABASE_URL must identify a disposable PostgreSQL database with CREATEDB.
cargo test -p control-plane --test edge --test ingress --test projects -- --ignored
nix develop -c cargo test -p control-plane --lib caddy_api_issues -- --ignored
```

Local fixtures do not qualify a public CA, real DNS-provider propagation, a chosen
VPS/NetBird topology or production certificate renewal. Those cutover drills still
require explicitly supplied disposable infrastructure.

The adapter follows Caddy's [API and concurrency contract](https://caddyserver.com/docs/api)
and [automatic HTTPS lifecycle](https://caddyserver.com/docs/automatic-https).
