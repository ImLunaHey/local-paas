# Architecture

## Scope and status

`local-paas` is an independent Rust application platform with a Vite, React,
Tailwind and TanStack dashboard. It has no dependency on Anvil.

The local platform registers specifications, builds immutable image revisions,
and deploys OCI instances through authenticated Rust agents in three NixOS VMs.
Readiness gates private preview traffic; live logs and cgroup metrics are visible
in the UI. Candidate failures retain the active deployment. Public edge routing and celld execution remain unimplemented. Opt-in stateless
relocation and node maintenance now persist handoffs and audit events transactionally. Workload secrets
are versioned in dedicated OpenBao storage and delivered through authenticated agents.
See [build operations](builds.md) and [runtime operations](runtime.md).

## Reversible implementation choices

- Rust workspace: domain types and validation, runtime contract, Axum control
  API. SQLx migrations and queries against PostgreSQL. Tokio async runtime.
- TypeScript frontend: Vite, React, Tailwind's Vite plugin, TanStack Router for
  navigation, TanStack Query for server state. The API owns validation.
- Dockerfile-first builds support a generated-Dockerfile fallback. Start with standalone Node/Bun package manifests and committed lockfiles.
  Custom build/start commands select generation; other languages/workspaces retain
  the explicit Dockerfile contract. Generated recipes are persisted with builds and
  still execute only inside BuildKit in the isolated VM.
- Start with JSON as the machine-readable manifest format; explicit numeric
  units avoid ambiguous CPU/memory parsing. Dockerfile/context/port/readiness
  are explicit. Do not infer a safe readiness check from EXPOSE.
- Stateless OCI services and node-pinned shared volumes are implemented. Local
  volumes prevent cross-node relocation. celld durable state is a separate
  fleet-specific object-storage concern.
- OCI configuration records a credential-free HTTPS Git URL and full commit
  hash, branch or tag. Mutable refs resolve once per build, before BuildKit receives
  the full commit SHA. BuildKit will produce an immutable digest before a runtime revision
  exists. A registered Git commit is not a built image.
- celld retains its Wrangler file. The platform wrapper records member count,
  resource limits, bucket configuration reference, domains, secret names, and
  placement. Every service gets a separate fleet; no experimental containers.
  First support tier: Workers, Durable Objects, static assets, observability.
- API remains a development service on loopback: no CORS, checked browser
  Origins and loopback Host, JSON-only writes. For private tailnet access, Tailscale Serve terminates HTTPS on port 5188 and forwards to loopback Vite,
  which proxies the API. An explicit PUBLIC_ORIGIN permits that hostname/origin
  alongside localhost. No public Funnel endpoint. Tailnet rules provide the
  current network access boundary; application-level administrator authentication
  remains a release gate. Serve's existing port 443 routes are preserved.

## Infrastructure decisions and remaining proposals

- Use a separate builder VM: two vCPUs, 3 GiB guest RAM and a 16 GiB virtual
  disk by default. It shares no host filesystem. UID-scoped nftables policy
  blocks private network access; BuildKit requires mTLS. The colocated registry
  is development-only. Measure host memory, CPU and storage headroom before setup.
- Three worker VMs default to 2 GiB RAM and one vCPU each. Management runs outside
  scheduler control; a dedicated management VM remains the production preference.
  These defaults need sizing for the host and workload. Workers on the same host
  share its power, storage and Internet connection; this is not hardware HA.
- PostgreSQL on management NVMe, outside scheduler control. Application-aware
  backups plus restore drills. Do not put production data on unhealthy storage.
  Off-site backup automation is not implemented.
- containerd inside worker KVM VMs first; Firecracker behind the same runtime
  contract later, preferably on physical KVM. Evaluate firecracker-containerd.
- The initial outbound protocol uses versioned HTTPS JSON sync requests with
  per-node client certificates and hashed bearer credentials. Local VMs reach a
  private mTLS gateway through QEMU networking. Remote worker VMs use fixed,
  mutually authenticated TLS links over an operator-provided private network.
  Enrollment and revocation are audited operator commands; one-use self-enrollment
  and automated certificate rotation remain future work. See [remote workers](remote-workers.md).
  Assignments carry stable identities and generations; the agent
  durably fences stale generations and reconciles after restart. No SSH or raw
  runtime socket is exposed as the operating protocol.
- CNCF Distribution runs beside BuildKit as the private development registry.
  Authenticated production registry operation and coordinated garbage collection
  remain release gates; never delete layers by hand.
- Propose Caddy at the DigitalOcean edge, ACME certificate state backed up,
  health-checked upstreams over NetBird. Initial edge is a single point of
  failure. No DNS-based or second-edge failover claim until designed and tested.
- The development API runs one reconciler; transaction-scoped PostgreSQL advisory
  locks serialize placement and promotion. Long-lived scheduler leadership and
  controller epoch allocation remain necessary before running multiple active
  controllers. Work and results persist; request handlers never execute a build
  or start a container inline.
- Dedicated ClickHouse archives runtime logs; PostgreSQL stores host/service
  measurements and audit history. Broader OTEL collection and product analytics
  remain separate work. Configure retention and monitor disk consumption.
- celld object-store provider/region remains a required deployment-time choice;
  prefer one bucket per app initially. Use only an upstream-qualified provider
  and re-run its storage probe. No default to Spaces, B2 or unqualified MinIO.

## Runtime boundaries and target deployment design

The following acknowledged-edge flow describes the production target. Current
private routing uses transactional database state and independently refreshed,
leased ingress snapshots; there is no external edge acknowledgement protocol yet.

The runtime interface covers prepare/start/stop/kill/inspect/exec/logs/destroy.
Prepare takes an immutable image digest, limits, explicit mounts, network policy,
and secret references. Stable platform instance IDs survive agent restarts.
Runtime success is an observation, not permission to change public routing.
celld has a separate fleet lifecycle; generic Stop cannot replace ownership
handoff. Its internal and operator listeners must remain private.

Deployment phases: queued → building → preparing → stabilizing → promoting →
draining → succeeded. Build produces a revision by digest. A candidate must pass
readiness continuously for the stabilization window. Promotion is a versioned
route update acknowledged by the edge, not a database flag. Old instances are
retained until that acknowledgement and drained before completion. Before
promotion, failure leaves old routing untouched; after promotion, rollback must
restore and acknowledge the old healthy route before stopping candidates.
No rollback guarantee when neither revision is healthy. Concurrent deployment
requests are serialized per service. Controller restart resumes persisted phases.

Nodes have stable IDs, capacity versus allocatable resources, labels, lease
expiry, cordon/drain state, and a physical failure-domain label. Stateless
rescheduling tolerates overlap. Singleton background workers now use a durable
stop-before-start barrier: a replacement waits for authenticated shutdown
confirmation, even if the old node becomes unreachable. Application-side
idempotency/fencing remains necessary for external effects. Distinct-node
spreading does not guarantee distinct hardware.

## Threat boundaries and tests required before deployment

- Git: verify webhook signature/replay handling; allowlisted fetch destinations,
  bounded checkout, safe symlink/path handling at checkout. Manifest path
  validation alone does not prevent symlink escapes or SSRF.
- Build: untrusted Dockerfile execution in isolated builders with no NAS mount,
  runtime socket, OpenBao token, database access or broad NetBird reach. Use
  short-lived scoped registry credentials, bounded logs and disk, cache bypass.
- Worker: non-root where possible, read-only root, explicit tmpfs, all capabilities
  dropped by default, no-new-privileges, seccomp/LSM, cgroup CPU/memory/PID/I/O
  limits, bounded writable space and logs, per-workload network namespaces.
- Network: per-node workload ranges, nftables default deny to management/NAS,
  declared public ports only. Explicit outbound policy. Edge health and agent
  health remove dead backends independently of controller availability.
- Secrets: OpenBao workload-specific paths and short-lived identities, references
  only in database. Private tmpfs or process environment; erase/revoke on stop.
  Varlock schemas scoped to the app. Production celld deploy must ignore dotenv.
- celld: pin release and verify attestation; one application/bucket/fleet identity,
  encrypted trusted peer network, supported storage probe, traffic removal and
  graceful ownership handoff before stopping. Hard-loss tests are separate.

## Original milestone sequence and release gates

Milestones 1–3 and parts of 4 are implemented; see README for current capability.
The remaining items below are qualification gates, not claims of completion.

1. Isolated BuildKit build → registry digest → immutable revision; bounded build
   logs and retry-safe build job execution.
2. Authenticated agent enrollment and containerd implementation of the runtime
   contract; one limited workload with readiness, logs and cleanup.
3. Three reproducible NixOS workers; leases, capacity, placement, cordon/drain,
   rolling deployment, acknowledged routing, rollback and restart reconciliation.
4. OpenBao, NetBird, edge TLS, telemetry, backup/restore and canary migration.
5. Dedicated three-member celld canary, pinned deployment runner, fleet status,
   Durable Object recovery after hard loss and graceful drain.

A credible release additionally proves two replicas on different VM nodes,
controller restart without stopping healthy apps, stopped-VM recovery, network
loss/paused-agent/full-disk faults, bounded resources and logs, secret non-persistence,
no public celld internal/operator listener, and a written Railway rollback drill.
Three workers on the same host share a physical failure domain; no hardware HA.

Development backup automation now uses encrypted Restic snapshots for control-plane
state, active managed PostgreSQL/Redis and offline OpenBao file storage. A separate
restore drill validates imported databases and pinned secret versions. The current
backup repository is local to the platform host; off-site custody, other persistent resources and full
disaster recovery remain release gates. See [backup operations](backups.md).

Measure capacity and verify storage health before provisioning or migration.

## Upstream references checked for this increment

- Axum: https://docs.rs/axum/latest/axum/
- Tailwind/Vite: https://tailwindcss.com/docs/installation/using-vite
- TanStack Router: https://tanstack.com/router/latest/docs/quick-start
- TanStack Query: https://tanstack.com/query/latest/docs/framework/react/quick-start
- celld constraints: https://celld.dev/docs/limitations/ and https://celld.dev/docs/security/

### One-off execution

OCI applications can launch jobs from pinned image revisions without replacing the
app. Jobs use separate deployment records and immutable command/timeout/configuration
snapshots. Nodes reserve each start durably, report exit outcomes, and require
confirmed cleanup before another job for that service. Unknown outcomes never retry
automatically. Interval schedules persist due times and unique occurrences in
PostgreSQL, forbid overlap, and skip missed ticks. See [runtime.md](runtime.md#one-off-jobs-and-interval-schedules).

### Release gates and private connections

Pre-deploy commands run as durable child jobs against the candidate revision and
the parent's configuration/secret snapshot. Exit success and confirmed cleanup
precede app placement; failures preserve the old active deployment. No automatic
migration retry or schema rollback is promised. Named Dockerfile targets and
non-secret build arguments are part of immutable build specifications.

Private connections are explicit references to HTTP services in the same project
and environment. The first implementation uses workload-local host aliases and
agent TCP proxies across the existing VM forwards. Only active, fresh, ready
backends are advertised. Short route leases fence slot reuse; connection grants
are enforced per source workload. Shadow environments remap target references.
Remote TLS links preserve those forwarded endpoints on other physical hosts.
Private traffic traverses the controller; VPN provisioning and public edge routing
remain separate work. See the execution and networking limits in runtime.md.

## Portable installation

The repository now includes an MIT license, a pinned development shell and an
explicit Rust bootstrap command. It targets native x86-64 and ARM64 systemd Linux
hosts with KVM, including Ubuntu; NixOS is only the guest OS. Installed management
services use persistent user units, with persistent system units for isolated VMs.
The installed dashboard serves built assets with Caddy. OpenBao requires explicit
unsealing after reboot. See [installation](install.md) for prerequisites, remaining
qualification work and the private single-operator trust boundary.
