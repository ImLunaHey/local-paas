# Runtime implementation

The control plane persists deployments and node assignments in PostgreSQL. A
transaction-scoped advisory lock serializes placement and promotion. Deployments
snapshot the current runtime configuration and reference an immutable image
revision. Retry operation IDs return the original deployment. celld is rejected
until its dedicated execution path exists. Secret-bearing deployments snapshot
resolved OpenBao values and deliver them into workload-private tmpfs.

Enrolled nodes have stable UUIDs, individual hashed bearer credentials, fixed
allocatable resources and four or fewer slots. The versioned outbound agent
protocol carries desired assignments, generations, health, logs and measurements.
The intended transport is mutual TLS over the private network. Node reports are
accepted only for allocations owned by that node at the current generation.
Agents retain healthy containers if the controller becomes unavailable.

Candidates must all report stabilized readiness before promotion. The ingress
selects only fresh ready instances in the active deployment. Promotion changes
that set transactionally, then asks agents to stop the old instances gracefully.
A failed candidate is stopped while the previous active deployment remains.
Explicit stop removes routing immediately and increments assignment generations.
Active deployments on agents advertising `recovery-v1` recover locally from an
exited process, including a clean exit from a continuously running service. The
agent waits 5, 10, 20, 40, then 60 seconds before its five restart attempts. Polling
adds up to one reconciliation interval. Reservations are fsynced before starting;
agent/VM restarts do not refund attempts. Ten minutes of continuously successful
readiness observations resets the budget. Exhaustion reports `crash_loop` and
requires a new deployment to retry. Unreadable restart state fails closed.

Recovery is authorized only after promotion, and only for capable agents. A
candidate that exits still fails its deployment, preserving the previous revision.
Stop takes precedence over pending recovery. Restarted processes must stabilize
readiness again before receiving traffic. An active process losing readiness is
removed from routing and may recover without being killed; readiness is not a
liveness probe. The candidate startup deadline remains 120 seconds. Configurable
restart policies and separate startup/liveness probe definitions are still pending.
Process starts are retained in audit history and as restart markers in runtime logs.

Slots remain reserved until cleanup is acknowledged. This initial scheduler does
not automatically move allocations from lost nodes; they recover on that node.

Runtime logs are deduplicated by instance and entry identity, limited to 512 KiB
per instance. Metrics are retained for one hour; the UI query exposes the most
recent 15 minutes. CPU and memory measurements describe application cgroups,
not configured limits. Stale nodes and observations are excluded from ingress.

The private preview proxy listens on loopback port 8090, accepts only authorities
registered in `preview_routes`, and supports HTTP requests up to 8 MiB with a
60-second upstream timeout. It does not yet support WebSocket upgrades. Public
edge routing, production authentication, backup/restore and fleet management
remain separate release gates.

The development preview runs inside the API process and depends on fresh database
observations. Controller downtime therefore interrupts this preview even though
healthy containers continue running. An independent edge with local health checks
is still needed for ingress that survives controller downtime.

## Development workers on Lake

Three reproducible NixOS worker VMs use 2 GiB RAM, one vCPU and a 16 GiB NVMe
virtual disk each. Host cgroups cap each QEMU at one CPU and 2600 MiB. Each node
reports 1000 millicores and 1400 MiB as allocatable, leaving guest overhead.
They are three scheduling nodes in one physical failure domain. They do not
share the NAS filesystem or host Nix store. ZFS is not used.

`infra/workers/build.sh` builds the Rust agent, packages it with explicit Nix
runtime libraries, and builds the three VM closures in an ignored staging flake.
`credentials.sh` creates distinct node UUIDs, random bearer credentials, a private
CA and mutually authenticated TLS certificates (30-day development validity).
Keys remain outside Git and the Nix store. A private credentials ISO is copied
into each VM's tmpfs at boot. `enroll-node` stores only a token hash in PostgreSQL.
The host's loopback Caddy gateway exposes agent sync and secret delivery over mTLS.

For this local VM stage, agents reach the gateway through QEMU's private host
address; the controller URL is configuration, so the same protocol can move to
NetBird and physical nodes. NetBird enrollment is not implemented by these
scripts. The development registry is reachable only through a node-local mirror
configuration; workloads cannot reach it or the controller. Host UID-scoped
firewall rules permit only those two loopback ports and reject other private
networks. Workload rules deny private destinations and allow public HTTP/HTTPS
and explicit public DNS resolvers.

The agent uses a pinned nerdctl client inside the VM to control containerd.
It sets user-namespace remapping, UID/GID 1000, read-only roots, bounded tmpfs,
CPU/memory/PID/I/O limits, no-new-privileges, dropped capabilities, default seccomp,
and an AppArmor policy. No arbitrary mounts, devices or runtime sockets are
accepted. Environment secrets are loaded by a static Rust launcher from tmpfs,
never placed into the persisted container configuration. Images are pulled by digest. Operation generations
are persisted before execution; a corrupt record fails closed. Container names
are stable instance UUIDs, so retries inspect existing containers.

The first adapter deliberately rejects administrative Exec and following the
low-level log stream. Live UI logs use the agent's bounded polling transport.
The agent tails rotating JSON logs (2 MiB per instance), reports recent entries
and real cgroup measurements, and the controller deduplicates observations.
This is recent operational output, not lossless archival log delivery. Container
images and old stopped-instance log files currently require manual GC in the
isolated node; the VM disk remains bounded. There is no distributed volume support.

Prepare and enroll after measuring host headroom:

```sh
bash infra/workers/build.sh
bash infra/workers/credentials.sh
# Set DATABASE_URL to this checkout's development Unix-socket database.
for n in 1 2 3; do
  cargo run -p control-plane --bin enroll-node -- ".local/worker-credentials/$n/config.json"
done
# Start the private mTLS gateway using .local/worker-tools/bin/caddy run
# --config "$PWD/.local/worker-credentials/Caddyfile" --adapter caddyfile.
for n in 1 2 3; do bash infra/workers/start.sh "$n"; done
```

Run the API separately. Stopping/restarting a worker unit affects that VM only;
`start.sh` refuses to replace a running VM. Its disk and node identity persist.
No platform component is installed into or scheduled by its own runtime.

Host UIDs 61000–61003 are reserved by the scripts for the builder and three
workers. They refuse an unexpected identity. This avoids default system-UID
reuse if a host NixOS activation removes manually created users. These transient
units and users are development provisioning; integrate their declarations into
Lake's reviewed NixOS configuration before relying on host reboot recovery.
Do not let an unrelated host service use these reserved UIDs.

Start the scoped gateway with `bash infra/workers/gateway.sh`. Its Caddy state
stays under `.local/caddy`. An initial Showcase Studio preview is registered at
`https://lake.tail3275e2.ts.net:5201`, forwarding through the private proxy;
port 5188 remains the dashboard and existing port 443 routes are unchanged.
The preview is reachable only inside the tailnet and only routes ready instances.

## Verification on 2026-10-23

- Rust formatting, Clippy, workspace tests, disposable PostgreSQL integration
  tests, frontend formatting and the production frontend build passed.
- Browser tests used the real API over Tailscale HTTPS: registration and editable
  configuration, build queue/cancel, completed image output, live application
  logs with pause/resume, measured CPU/memory/PIDs, charts and mobile layout.
- Three individually authenticated workers registered. Showcase Studio reached
  stabilized readiness with two replicas on different VMs; its private HTTPS
  preview returned 200. Its readiness path is `/`, since this image has no
  `/health` route.
- A candidate deployment with a deliberately nonexistent readiness path failed
  and both candidates were removed. The original active deployment and its two
  allocations were preserved; the preview returned 200 throughout sampled checks.
  The service's valid readiness configuration was restored immediately after
  creating the candidate snapshot.
- During a 20-second controller pause, both worker endpoints returned 200.
  Restarting the controller retained the deployment and instance identities;
  the private preview returned 200 after restart.
- With worker 1 stopped, its observation became unknown, worker 2 stayed ready,
  and the private preview returned 200 using the remaining replica.
  Restarting worker 1 recovered the same instance identity and restored two ready
  replicas after stabilization; all three nodes reported healthy.

These are development checks on one physical Lake host. They do not establish
hardware redundancy, lossless telemetry, automatic cross-node relocation,
production ingress availability or backup recovery.
