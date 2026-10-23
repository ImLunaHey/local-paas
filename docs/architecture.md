# Architecture decisions — 2026-10-23

## Scope and status

Working name and repository directory: `local-paas`. This is independent of
Anvil. Luna authorized starting implementation and chose Rust for the backend
and Vite / React / Tailwind / TanStack for the frontend.

The local platform registers specifications, builds immutable image revisions,
and deploys OCI instances through authenticated Rust agents in three NixOS VMs.
Readiness gates private preview traffic; live logs and cgroup metrics are visible
in the UI. Candidate failures retain the active deployment. Public edge routing,
workload secrets, automatic relocation and celld execution remain unimplemented.
See [build operations](builds.md) and [runtime operations](runtime.md).

## Reversible implementation choices

- Rust workspace: domain types and validation, runtime contract, Axum control
  API. SQLx migrations and queries against PostgreSQL. Tokio async runtime.
- TypeScript frontend: Vite, React, Tailwind's Vite plugin, TanStack Router for
  navigation, TanStack Query for server state. The API owns validation.
- Dockerfile-first builds now support a generated-Dockerfile fallback, as requested
  by Luna. Start with standalone Node/Bun package manifests and committed lockfiles.
  Custom build/start commands select generation; other languages/workspaces retain
  the explicit Dockerfile contract. Generated recipes are persisted with builds and
  still execute only inside BuildKit in the isolated VM.
- Start with JSON as the machine-readable manifest format; explicit numeric
  units avoid ambiguous CPU/memory parsing. Dockerfile/context/port/readiness
  are explicit. Do not infer a safe readiness check from EXPOSE.
- Start with stateless OCI services. Node-pinned volumes are a later explicit
  feature, not silently movable storage. celld durable state is a separate
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
  Origins and loopback Host, JSON-only writes. Luna authorized tailnet access:
  Tailscale Serve terminates HTTPS on port 5188 and forwards to loopback Vite,
  which proxies the API. An explicit PUBLIC_ORIGIN permits that hostname/origin
  alongside localhost. No public Funnel endpoint. Tailnet rules provide the
  current network access boundary; application-level administrator authentication
  remains a release gate. Serve's existing port 443 routes are preserved.

## Infrastructure decisions and remaining proposals

- Luna authorized a separate disposable builder VM on Lake. It has two vCPUs,
  3 GiB guest RAM and a 16 GiB NVMe virtual disk, with no host filesystem shares.
  Host UID-scoped nftables policy denies private network access. BuildKit uses
  mTLS; a colocated, loopback-forwarded registry is development-only. Nix packages
  are pinned. The builder unit is transient, not a Lake-wide NixOS deployment.
  At provisioning, available RAM was approximately 15 GiB; ZFS remained degraded.
  This sizing must be observed, not carried into production as a reservation.

- Three NixOS worker VMs plus a fourth management VM on Lake, subject to a new
  capacity and host-load inspection. Initial sizing is an experiment, not a
  reservation: workers 6–8 GiB each, management 4–6 GiB. Builders need a separate
  disposable VM/sandbox and cannot share management privileges or network reach.
- PostgreSQL on management NVMe, outside scheduler control. Application-aware
  backups plus restore drills; healthy ZFS and off-site copies. Do not place
  production state on the array before replacement/resilver and scrub pass.
- containerd inside worker KVM VMs first; Firecracker behind the same runtime
  contract later, preferably on physical KVM. Evaluate firecracker-containerd.
- Propose outbound gRPC streams over NetBird with mutually authenticated TLS,
  per-node certificates, one-use enrollment, short certificate lifetimes and
  explicit revocation. NetBird membership alone is not node identity. Protocol
  version, operation ID, generation, and controller fencing epoch accompany
  commands. The agent durably deduplicates operations and reconciles after
  restart. No SSH or raw runtime socket as the operating protocol.
- Propose CNCF Distribution for the OCI registry; retain all digests referenced
  by active deployments and the rollback window. GC must be coordinated with
  writers and use the registry's supported mode; never delete layers by hand.
- Propose Caddy at the DigitalOcean edge, ACME certificate state backed up,
  health-checked upstreams over NetBird. Initial edge is a single point of
  failure. No DNS-based or second-edge failover claim until designed and tested.
- One active reconciler/scheduler holds a PostgreSQL advisory lock on a dedicated
  connection. Losing it fences further mutations. Persist work and results;
  request handlers never execute a build or deployment inline.
- Propose OTEL collection; defer telemetry storage selection until ingest,
  retention and maintenance budgets are measured. Product analytics stays
  separate. No unbounded log buffers or local disk growth.
- celld object-store provider/region remains a required deployment-time choice;
  prefer one bucket per app initially. Use only an upstream-qualified provider
  and re-run its storage probe. No default to Spaces, B2 or unqualified MinIO.
- First canary remains unselected: reconfirm whether the superseded blog should
  remain live; otherwise review vote or showcase-studio. No Railway changes.

## Runtime and deployment boundaries

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
rescheduling tolerates overlap; singleton side effects need fencing and are out
of scope initially. Distinct-node spreading does not guarantee distinct hardware.

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

## Next milestones and release gates

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
All three initial workers share Lake, power, disks and Internet; no hardware HA.

Lake capacity and the Railway inventory in the conversation are 2026-10-23
snapshots, not live evidence. Recheck before provisioning workers or migrating
production state. The builder's later inspection does not establish worker capacity.

## Upstream references checked for this increment

- Axum: https://docs.rs/axum/latest/axum/
- Tailwind/Vite: https://tailwindcss.com/docs/installation/using-vite
- TanStack Router: https://tanstack.com/router/latest/docs/quick-start
- TanStack Query: https://tanstack.com/query/latest/docs/framework/react/quick-start
- celld constraints: https://celld.dev/docs/limitations/ and https://celld.dev/docs/security/
