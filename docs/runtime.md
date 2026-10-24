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

## Background workers

OCI services can set `workload.execution` to `worker` (omitting it retains HTTP
behavior). A worker declares one replica and omits `port`, `readiness` and domains.
The Dockerfile or generated Node/Bun recipe still defines the start command.
The agent publishes no port and observes the process running for ten seconds
before promotion. This confirms process stability, not application progress.
Logs, metrics, scoped secrets, database connections and volume attachments work
through the same interfaces as web services. Execution type is fixed at creation.

Worker deployment requests persist a `waiting` deployment and request shutdown
of previous instances. The reconciler allocates the replacement only after the
owning agent reports `stopped` at the current generation, including destruction
and network cleanup. Failed, unknown and stale instances do not count as stopped.
A lost node therefore blocks replacement; a timeout never grants permission to
start another copy. Waiting deployments can be cancelled. Once shutdown is
confirmed, the deployment waits for a capable node and capacity, then starts.
Shared-volume workers stay pinned to the volume owner.

This creates a deliberate interruption during replacement. A failed candidate
does not restart the previous worker automatically; deploy a retained revision
explicitly. Active workers use the same bounded local crash recovery as HTTP
services. Agents must advertise `workers-v1`; existing HTTP declarations remain
compatible with older agents. Do not downgrade an agent while it owns a worker.

Singleton ownership is per service identity, not across environments or separate
services. It prevents platform-managed overlapping replacements, but does not
provide exactly-once external effects or replace application idempotency/fencing.
One-off jobs, interval schedules and pre-deploy migration gates are supported below.

The private `examples/worker-canary` fixture emits structured heartbeat logs and
delays SIGTERM shutdown by eight seconds without opening a socket. After building
it as a worker named `worker-canary-<suffix>` in `platform-storage-canary`, run:

```sh
DATABASE_URL="postgresql:///local_paas?host=$PWD/.local/socket&port=55432" \
PLATFORM_WORKER_CANARY=<service UUID> \
cargo test -p control-plane --test worker_canary -- --ignored --nocapture
```

The drill deploys twice, checks the waiting barrier and recorded process-start
ordering, verifies no HTTP listener and retained logs, then stops both deployments.
This passed on Lake on 2026-10-24. Disposable database tests also cover legacy
agents, concurrent reconciliation, stale/wrong-node shutdown reports, unreachable
nodes, cancellation, and rejection of domain/HTTP mappings. Desktop and mobile
browser checks covered creation and the shared configuration form.

Runtime logs are deduplicated by instance and entry identity, limited to 512 KiB
per instance. Metrics are retained for one hour; the UI query exposes the most
recent 15 minutes. CPU and memory measurements describe application cgroups,
not configured limits. Stale nodes and observations are excluded from ingress.

The private preview proxy listens on loopback port 8090, accepts only authorities
registered in `preview_routes`, and supports HTTP requests up to 8 MiB. Request
bodies and upstream response headers have 30-second deadlines; connection setup
has a two-second deadline. HTTP responses stream without a total request timeout,
with a five-minute upstream read timeout. WebSocket handshakes preserve Origin,
cookies and subprotocol negotiation and forward upgraded bytes in both directions
for up to 24 hours. Up to 256 requests/streams share a bounded connection budget;
exhaustion returns 503. Disconnects release capacity. All Connection-nominated
headers are stripped case-insensitively, and trusted forwarding headers replace
client-supplied values. Loopback protocol tests cover upgrades, streaming, disconnect
cleanup and a real 65-second SSE stream. Public
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

CNI address reservations live in `/run/local-paas-cni` inside each worker.
They survive an agent/containerd restart, but reset with the VM's kernel network
namespaces on reboot. This prevents dead allocations from an interrupted shutdown
blocking the next container that uses the same scheduling slot. This uses the
[host-local plugin's documented `dataDir` option](https://www.cni.dev/plugins/current/ipam/host-local/).

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

## Disposable recovery drill

Build `examples/recovery-canary` as a private, single-replica uploaded service
named `recovery-canary-<unique suffix>` in `platform-storage-canary`. Use port
3000 and `/health`, with five-second checks and stabilization. Leave domains,
secrets and volumes empty. Its `/crash`, `/unhealthy` and `/healthy` endpoints
deliberately inject faults; do not expose this fixture publicly.

After the build succeeds, run the explicit live test against the development
controller (the test creates and stops its own deployments):

```sh
DATABASE_URL="postgresql:///local_paas?host=$PWD/.local/socket&port=55432" \
PLATFORM_RECOVERY_CANARY=<service UUID> \
cargo test -p control-plane --test recovery_canary -- --ignored --nocapture
```

This exercises readiness recovery after more than 120 seconds without restarting,
five real process exits and recoveries with retained start markers, retry-budget
exhaustion, replacement with a fresh instance, and stopping during backoff. It
stops its deployments on assertion failures as well as success. Ordinary test runs
never inject these faults; the explicit service ID and disposable project/name
checks are required. Budget persistence and interrupted-start reservations also
have filesystem-backed node-agent tests.

Verified on 2026-10-24 with a real BuildKit-built canary on worker 2: the complete
live drill passed, including all five backoffs, exhaustion and stopping during
backoff. Both drill deployments were stopped afterward. All three workers were
upgraded separately; the seven existing application/database/storage instances
returned to ready. `make check` and the disposable-database integration suite
passed. The initial drill exposed stale CNI reservations after VM reboot; moving
the reservations to the worker's `/run` filesystem resolved that startup failure.

## One-off jobs and interval schedules

An OCI app's **Jobs** page runs a built revision as a separate, one-shot instance.
Jobs do not replace the app or acquire a public port. An optional executable plus
argument array replaces the image entrypoint and CMD without shell interpolation;
an empty array uses the image command. Pass credentials through OpenBao, never
literal command arguments. Each run snapshots current service resources, volume,
connections and secret version references alongside the pinned image revision.

`POST /api/services/{id}/jobs` accepts `operation_id`, `revision_id` and
`options: {command: string[], timeout_seconds: number}`. Retries return the same
run; changing its inputs with the same operation ID is a conflict. One unfinished
job is allowed per service, including queued, unknown and cleanup-pending runs.
An unreachable node does not release ownership. Normal app deployments and jobs
remain independent; shared volumes still require the owning node.

The agent advertises `jobs-v1`. Before preparation/start it fsyncs a local job
reservation. It never retries that reservation after a process exit or agent
restart. Running processes are re-observed; exit codes and outcomes are persisted
before reporting. A reservation with no provable process outcome is **uncertain**,
not successful and not restarted. Review effects before explicitly retrying.
This prevents automatic duplicate starts but does not promise exactly-once
application effects. Applications still need idempotent external operations.

The 10–86400 second time limit begins at allocation and includes image preparation.
The agent checks deadlines every five seconds and kills overdue running processes.
Deadline enforcement requires a functioning node agent; it resumes after restart.
Cancellation requests graceful stop and waits for confirmed cleanup. The terminal
result survives cleanup; logs use the existing retained logging pipeline. The API
stores only result metadata and secret references, not secret values.

`PUT /api/services/{id}/job-schedule` configures one interval schedule per app using
an operation ID, expected `version` (0 initially), `revision_id`, `options`,
`interval_minutes` (1–10080) and `enabled`. Saving restarts the interval from now.
The interval is elapsed UTC time, not a timezone-dependent calendar or cron rule.
Pausing affects future ticks, not an already queued/running job. Schedules pin an
image/command, while each occurrence snapshots current app settings and secrets.
Schedules are separate resources and are not inherited by shadow environments.

PostgreSQL transactions and the scheduler advisory lock serialize due ticks across
controller processes. Each occurrence is unique. Ticks over 30 seconds late are
recorded as missed and advanced to the next future interval, with a skipped count;
there is no catch-up burst. An occupied service skips the occurrence. Failed secret
snapshot/configuration is recorded as failed-to-queue instead of repeatedly firing
that tick. Schedule edits, runs and skipped occurrences have transactional audit
records. The Jobs page shows the latest 50 runs and 20 schedule occurrences; records
remain in PostgreSQL and instance logs remain in dedicated ClickHouse storage.

The disposable fixture in `examples/job-canary` exits successfully, fails with
code 7, or sleeps long enough to exercise cancellation and deadlines. After
building it as a secret-free, volume-free `job-canary-*` service in the
`platform-storage-canary` project, the opt-in live drill is:

```sh
DATABASE_URL="postgresql:///local_paas?host=$PWD/.local/socket&port=55432" \
PLATFORM_JOB_CANARY=<service-uuid> PLATFORM_JOB_VM_RESTART=1 \
  cargo test -p control-plane --test job_canary -- --ignored --nocapture
```

The drill restarts the development API and, with the optional VM flag, the assigned
worker VM. It checks one recorded process start, exit status, retained structured
logs, cleanup, survival of a controller restart, no repeat execution after VM loss,
and a real interval-triggered run. It pauses its canary schedule afterward. A VM
restart can affect other workloads on that worker; it is an explicit fault drill.

The reboot drill also requires every existing active application instance to
recover. `PLATFORM_JOB_VM_ONLY=1` runs just that fault/recovery check. Unset runtime
start timestamps are omitted from reports and cannot establish job success.
Workload network grants, like CNI address reservations, live under `/run`: they
survive an agent restart but are rebuilt from assignments after a VM reboot.

Live development verification on 2026-10-24 covered the image default command,
entrypoint override, exit codes 0 and 7, timeout, cancellation, controller restart,
VM-loss uncertainty without another start, and an actual scheduled occurrence.
The strengthened reboot check confirmed all seven existing application instances
recovered. Playwright exercised running a job, opening retained logs, saving and
pausing a schedule, and the desktop/mobile forms. The disposable schedule was
left paused and its instances stopped.

## Pre-deploy commands

OCI applications can set `workload.pre_deploy` with an explicit `command` argv
and `timeout_seconds` (10–86400). Configure the executable and one argument per
line in Configuration. The command runs once from the candidate image before app
placement. It inherits the deployment's exact resource, connection, volume and
versioned secret snapshot. A deployment owns one durable child job; API retries
and controller restarts do not enqueue another attempt. Existing manual/scheduled
jobs block a migration until cleanup, and schedules skip while the gate is active.

Only exit success plus confirmed cleanup opens the gate. Nonzero exits, timeouts,
unknown outcomes and cancellations fail the rollout without stopping the old app.
Cancelling the rollout cancels its child. Retained task logs and exit codes are
linked in Deployments and Activity; the run also appears in Jobs. After success,
normal readiness gating applies; singleton workers first pass their shutdown
barrier. Capacity waits never repeat the migration. Local-volume HTTP services
retain their existing explicit stop-first restriction.

This cannot undo database changes. Use migrations compatible with the old app,
application-level database migration locks, and inspect database state before
retrying an uncertain result. There is no automatic retry or exactly-once external
side-effect guarantee. Job time limits begin at allocation and require a working
agent to enforce; an unreachable worker blocks until its outcome is established.

## Private service connections

Networking → Private service connections selects an HTTP app in the same project
and environment and an environment variable such as `API_URL`. Saving changes the
next deployment's configuration; existing instances retain their snapshot. The URL
is `http://svc-<target UUID without hyphens>.internal:24000` (ports increase by
connection index). The alias is materialized in each workload's `/etc/hosts`, so no
public DNS record is involved. Names survive renaming a project or service. The
first version supports the destination's declared HTTP port, including raw TCP
forwarding for streaming HTTP and WebSockets. It does not expose arbitrary ports,
UDP, databases, or management services. Use existing DB/S3 bindings for those.

An agent-local bounded TCP proxy authorizes the source workload IP and declared
connection before choosing a freshly observed, ready instance of the destination's
active deployment. Candidates, failed members, stopped apps and other environments
are excluded. Connection mappings refresh on every authenticated node sync. Already
established streams survive controller interruption; new connections fail closed
once their short route leases expire. New TCP connections balance across eligible
members. Requests are never retried after any application bytes have been sent.

This development transport crosses the three Lake VMs through their existing
loopback QEMU forwards. Host aliases point at each VM's private bridge gateway;
firewalls expose proxy listeners only to that bridge. NAS/management access remains
denied. Agent-held routes last at most ten seconds (also capped by readiness and
heartbeat freshness); PostgreSQL persists leases and quarantines stopped published
slots through expiry plus five seconds, preventing a stale route from reaching an
unrelated replacement. Controllers and workers require synchronized clocks.
There are at most 16 connections per service, 128 concurrent streams per node and
a 24-hour stream lifetime. NetBird-backed physical worker transport remains future
work; this does not provision the public edge or claim physical redundancy.

Pre-deploy tasks and one-off jobs inherit the same private connections. Environment
shadowing remaps references to the new environment's copied services, never the
original live instances. Connection configuration rejects secret-variable name
collisions; only non-secret URLs are injected by this feature.

### Release and discovery verification (2026-10-24)

The disposable `examples/release-network-canary` image has a named `app` stage,
a deliberately unsuitable final stage, and a build-time label returned over HTTP.
The opt-in Rust test `release_network_canary` builds it through the real isolated
builder, then checks nonzero/timeout migration failure without disrupting the old
app, controller restart without a duplicate migration, cross-worker private calls
from both a migration and an app, backend replacement without a client restart,
and rejection of a workload without a declared connection. It stops its workloads
and retains deployment/job diagnostics. The full drill passed in 286.95 seconds;
all seven pre-existing instances remained healthy after cleanup.

Prepare `.local/release-network-source.zip` with the fixture's Dockerfile and
main.rs at the archive root. With the private development services and all three
updated agents running, execute:

```sh
RUN_RELEASE_NETWORK_CANARY=1 \
DATABASE_URL="postgresql:///local_paas?host=$PWD/.local/socket&port=55432" \
cargo test -p control-plane --test release_network_canary -- --ignored --nocapture
```

The test creates only `platform-release-canary` services, but deliberately restarts
the development controller. Database integration coverage separately exercises
concurrent requests/reconcilers, failed and cancelled release gates, slot leases,
legacy-agent exclusion, environment scope and shadow remapping. Shared forms were
checked in the collaborative browser at desktop and 390px mobile widths, including
retained migration logs.

Address cleanup now verifies host-local reservations before acknowledging a freed
slot or creating its replacement. An orphan is reclaimed through the pinned CNI
plugin's owner-checked DEL operation only when both container metadata and the
independent containerd task inventory confirm that its owner is absent. Unknown
owners, live/stopped containers, inventory failures, and malformed leases block
reuse. Acknowledged cleanup does not repeat after the slot has been reassigned.
Failed creates without a running task proceed directly to removal, rather than
getting stuck trying to stop a nonexistent task. Cleanup failures retain diagnostics.

The pinned host-local plugin regression reproduces an occupied address and verifies
ten reuse cycles, including delayed old-owner deletion after a replacement acquires
the address. The live recovery canary passed five crash/restart cycles, bounded
exhaustion, redeployment and stop-during-backoff (579.89 seconds). This closes the
orphan cleanup/reuse gap; it does not establish that every possible CNI failure has
been eliminated. Further network fault testing remains a production requirement.
