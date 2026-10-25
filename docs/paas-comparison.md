# Major PaaS feature comparison

This document compares `local-paas` with representative managed and self-hosted
application platforms. It is a product-planning aid, not a claim that every
platform has identical goals. The comparison was last reviewed on 24 October
2026 against the linked vendor documentation.

## Status and scope

The symbols describe capabilities available to an operator today:

- **Yes**: implemented as a supported product capability.
- **Limited**: implemented with important scope or operational constraints.
- **Planned**: represented in the architecture or prepared configuration, but
  not operationally complete.
- **No**: not implemented.
- **External**: normally supplied by another product or by operator-managed
  infrastructure.

For hosted products, "managed" means the vendor operates the underlying
infrastructure. For self-hosted products, availability still depends on the
operator's servers, network, backups and upgrade practices.

## Platform matrix

| Platform | Operating model | Source-to-image builds | Public domains and TLS | Safe deploy and rollback | Environments or PR previews | Workers, jobs and schedules | Persistent or managed data | Horizontal scaling | Automatic scaling / scale to zero | Multiple regions or servers | Secrets and observability | Team access / RBAC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **local-paas** | Self-hosted; management host plus isolated builder and worker VMs | **Limited** — Dockerfile and generated Node/Bun recipes | **Limited** — DNS verification, Caddy API updates and acknowledged TLS routes; explicit installation and public ACME qualification required | **Yes** — immutable revisions, readiness stabilization and failed-candidate preservation | **Limited** — project environments and private previews; no Git-driven PR lifecycle | **Yes** — singleton workers, one-off jobs, interval schedules and pre-deploy commands | **Limited** — PostgreSQL, Redis, RustFS and node-pinned volumes; local backup subset | **Limited** — fixed replicas and opt-in stateless relocation | **No** | **Limited** — authenticated remote workers; no automated provisioning or hardware-HA claim | **Yes** — OpenBao references, ClickHouse logs, metrics and audit events | **No** — private single-operator trust boundary |
| [Railway](https://docs.railway.com/) | Managed PaaS | **Yes** — Git, Dockerfiles and generated builds | **Yes** | **Yes** — deployment health gates and retained-image rollback | **Yes** — persistent and PR environments | **Yes** — services, workers and cron executions | **Yes** — databases and attached volumes | **Yes** — replicas and regions | **Limited** — serverless sleeping; not a general metric autoscaler | **Yes** — selected regions | **Yes** | **Yes**; environment RBAC is plan-dependent |
| [Render](https://render.com/docs) | Managed PaaS | **Yes** — Git, Docker and native builds | **Yes** | **Yes** — zero-downtime replacement when storage permits | **Yes** | **Yes** — workers, cron jobs and workflows | **Yes** — managed datastores and single-service disks | **Yes** for stateless services | **Yes** on supported service plans | **Limited** — regional services, not an operator-owned cluster | **Yes** | **Yes** |
| [Fly.io](https://fly.io/docs/) | Managed global micro-VM platform | **Yes** — Docker and framework launchers | **Yes** — global Anycast edge | **Yes** — Machines and release commands | **Limited** — generally assembled with apps and CI | **Yes** — Machines can run services and jobs | **Yes** — regional volumes and managed PostgreSQL | **Yes** | **Yes** — autostart/autostop and machine scaling | **Yes** — global regions and private network | **Yes** | **Yes** |
| [Heroku](https://devcenter.heroku.com/) | Managed PaaS | **Yes** — buildpacks and container builds | **Yes** | **Yes** — releases, Preboot and rolling deploys | **Yes** — pipelines and review apps | **Yes** — process types, one-off dynos and scheduler add-ons | **Yes** — add-on ecosystem; dyno filesystems are ephemeral | **Yes** | **Limited** — autoscaling is tier and workload dependent | **Limited** — regions and Private Spaces | **Yes** | **Yes** |
| [Northflank](https://northflank.com/docs/) | Managed container platform | **Yes** — Dockerfiles and buildpacks | **Yes** | **Yes** — release flows and immutable deployments | **Yes** — full-stack preview blueprints | **Yes** — jobs and scheduled workflows | **Yes** — add-ons, databases and volumes | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |
| [Koyeb](https://www.koyeb.com/docs/) | Managed serverless PaaS | **Yes** — Git and container images | **Yes** — global edge | **Yes** — immutable service deployments | **Limited** | **Yes** — web services and workers | **Limited** — volumes and managed PostgreSQL | **Yes** | **Yes** — metric autoscaling and scale to zero | **Yes** — multiple regions | **Yes** | **Yes** |
| [Unkey](https://www.unkey.com/) | Managed API platform and container PaaS | **Yes** — GitHub, images, CLI and automatic multi-language builds | **Yes** — global gateway, custom domains and TLS | **Yes** — immutable deployments, promotion and time-limited rollback | **Yes** — branch and pull-request previews | **Limited** — long-running API containers; no documented general job or cron primitive | **External** — ephemeral runtime storage and external data services | **Yes** — configurable instance ranges | **Limited** — idle previews scale to zero | **Yes** — multiple regions | **Yes** — API keys, rate limits, policies, request logs and runtime metrics | **Yes** — teams, roles and scoped root keys |
| [Google Cloud Run](https://cloud.google.com/run/docs/overview/what-is-cloud-run) | Managed serverless containers | **External/Yes** — images or source builds through Google Cloud | **Yes** | **Yes** — immutable revisions, traffic splitting and rollback | **External** — normally CI/CD projects and revisions | **Yes** — services, jobs, worker pools and scheduled integrations | **External** — cloud databases and storage | **Yes** | **Yes** | **Yes** — regional services composed behind global infrastructure | **Yes** — Google Cloud services | **Yes** — Google Cloud IAM |
| [Azure Container Apps](https://learn.microsoft.com/azure/container-apps/overview) | Managed serverless containers | **External/Yes** — registries and Azure build tooling | **Yes** | **Yes** — revisions, probes and traffic splitting | **External** — normally CI/CD environments and revision labels | **Yes** — services and scheduled or event-driven jobs | **External** — Azure data services and volumes | **Yes** | **Yes** — KEDA-based scaling and scale to zero | **Yes** — regional environments composed through Azure | **Yes** — Azure services | **Yes** — Azure RBAC |
| [DigitalOcean App Platform](https://docs.digitalocean.com/products/app-platform/) | Managed PaaS | **Yes** — Git, buildpacks and images | **Yes** | **Yes** | **Limited** | **Yes** — services, workers and deployment/cron jobs | **Yes** — managed database integration | **Yes** | **Yes** on supported components | **Limited** — per-app regional placement | **Yes** | **Yes** |
| [Coolify](https://coolify.io/docs/) | Self-hosted Docker PaaS | **Yes** — Git, Nixpacks, Railpack, Dockerfile, Compose and images | **Yes** — operator DNS and servers required | **Yes** — health checks, rolling updates and image rollback | **Yes** — PR/MR previews | **Yes** — scheduled tasks and service containers | **Yes** — volumes and several database engines; operator owns recovery | **Limited** — multi-server applications require an external load balancer and stateless storage | **No** | **Yes**, with documented application constraints | **Yes** | **Yes** |
| [Dokploy](https://docs.dokploy.com/docs/core) | Self-hosted Docker/Swarm PaaS | **Yes** — applications, Compose and images | **Yes** — operator DNS and servers required | **Yes** | **Yes** | **Yes** | **Yes** — self-hosted databases and volumes | **Yes** — Docker Swarm | **No** | **Yes** — Swarm and remote servers | **Yes** | **Yes** |
| [CapRover](https://caprover.com/docs/app-scaling-and-cluster.html) | Self-hosted Docker Swarm PaaS | **Yes** — Dockerfile, image and Captain definitions | **Yes** — operator DNS and servers required | **Limited** | **No** built-in full PR environment lifecycle | **Limited** — separate applications and external scheduling patterns | **Yes** — one-click databases and volumes; operator owns recovery | **Yes** for stateless services | **No** | **Yes** — Docker Swarm | **Limited** | **Limited** |
| [Dokku](https://dokku.com/docs/) | Self-hosted, CLI-first Docker PaaS | **Yes** — buildpacks, Dockerfiles and images | **Yes** — operator DNS and servers required | **Yes** — deployment checks and process management | **External** | **Yes** — process types, one-off commands and plugins | **Yes** through storage and datastore plugins | **Limited** — primarily single-host process scaling | **No** | **No** built-in multi-host scheduler | **Limited** | **Limited** |

Vercel and Netlify are intentionally omitted from the matrix because their
primary abstraction is frontend and function delivery rather than a general OCI
application runtime. Kubernetes and OpenShift are also omitted: they are
extensible cluster platforms rather than comparable opinionated PaaS products.

## What differentiates local-paas

The current implementation is narrower than the established products, but it has
several deliberate properties that common self-hosted Docker panels do not:

- builds execute in a dedicated KVM VM and workloads run in separate worker VMs;
- the controller communicates with authenticated agents instead of exposing SSH
  or a runtime socket as its operating protocol;
- desired state, placement, deployment phases, handoffs and audit records are
  durable rather than inferred solely from running containers;
- revisions use immutable OCI digests and a candidate must stabilize before
  ingress promotion;
- secrets are stored in OpenBao and application records contain references;
- singleton replacement has a durable stop-before-start barrier; and
- failure-domain labels are explicit, so three co-located VMs are not presented
  as three physically independent replicas.

Those properties should remain intact while closing product gaps. In particular,
new features must not fake successful infrastructure state, persist secret values,
leak containerd identifiers into domain types or merge OCI services with the
separate celld fleet lifecycle.

## Tracked gaps

The following issues turn the comparison into an implementation roadmap. An item
stays **Planned** or **No** in this document until its acceptance criteria have
been implemented and validated; opening or partially implementing an issue does
not change the matrix status.

Progress across all capabilities is collected in
[the feature-parity roadmap](https://github.com/ImLunaHey/local-paas/issues/17).

| Gap | Current boundary | Tracking issue |
| --- | --- | --- |
| Public edge, DNS and TLS lifecycle | Versioned routing, Caddy API updates, DNS/TLS observations and rollback barriers implemented; public infrastructure cutover remains operator-qualified | [#6](https://github.com/ImLunaHey/local-paas/issues/6) |
| Operator authentication and RBAC | Management access relies on loopback or a trusted tailnet | [#5](https://github.com/ImLunaHey/local-paas/issues/5) |
| Git provider automation and private repositories | Signed, replay-safe GitHub events pin commits; repository-scoped GitHub App tokens support bounded private fetches with rotation and revocation state | [#4](https://github.com/ImLunaHey/local-paas/issues/4) |
| Safe automated platform upgrades | Development contract resets and manual replacement are documented; rolling upgrades are absent | [#7](https://github.com/ImLunaHey/local-paas/issues/7) |
| Production registry lifecycle | The co-located registry is development-only; production authentication and garbage collection are release gates | [#8](https://github.com/ImLunaHey/local-paas/issues/8) |
| Continuous runtime health and self-healing | Deployment readiness and independent ingress probing exist; ongoing recovery policy is incomplete | [#10](https://github.com/ImLunaHey/local-paas/issues/10) |
| Autoscaling and scale to zero | Fixed desired replicas exist; demand-based capacity control does not | [#9](https://github.com/ImLunaHey/local-paas/issues/9) |
| Remote-worker enrollment and certificate rotation | Authenticated remote workers work over an operator-provided private network | [#11](https://github.com/ImLunaHey/local-paas/issues/11) |
| Controller and physical failure-domain HA | Persistent work and advisory locks exist; active-controller leadership and hardware HA do not | [#15](https://github.com/ImLunaHey/local-paas/issues/15) |
| Off-site backup and full disaster recovery | Encrypted local backups and restore drills cover a documented subset | [#13](https://github.com/ImLunaHey/local-paas/issues/13) |
| Git-driven PR preview lifecycle | Environments and private preview URLs exist without automatic PR creation and cleanup | [#12](https://github.com/ImLunaHey/local-paas/issues/12) |
| Broader source-build support | Generated recipes support Node/Bun; other languages require Dockerfiles | [#14](https://github.com/ImLunaHey/local-paas/issues/14) |
| Multi-container application definitions | Services are explicit platform resources; Docker Compose import is unsupported | [#16](https://github.com/ImLunaHey/local-paas/issues/16) |
| API gateway keys, rate limits and request policies | Ingress routes ready workloads but has no application-facing API management layer | [#19](https://github.com/ImLunaHey/local-paas/issues/19) |

## Source notes

The matrix intentionally records material limitations rather than comparing only
headline feature names:

- Railway health checks gate a deployment but do not continuously monitor the
  endpoint; attached volumes also prevent overlapping deployments. See
  [Railway health checks](https://docs.railway.com/deployments/healthchecks).
- Render persistent disks are single-service, prevent horizontal replicas and
  disable zero-downtime replacement. See
  [Render persistent disks](https://render.com/docs/disks).
- Coolify multi-server deployment requires an operator-managed load balancer and
  does not support Compose applications or applications with persistent storage.
  See [Coolify multi-server deployments](https://coolify.io/docs/core/infrastructure/scaling/multi-server-deployments).
- CapRover spreads stateless services with Docker Swarm, while persistent apps
  remain tied to one node. See
  [CapRover scaling and clusters](https://caprover.com/docs/app-scaling-and-cluster.html).
- Cloud Run supports services, jobs, worker pools, immutable revisions and
  traffic management. See
  [What is Cloud Run?](https://cloud.google.com/run/docs/overview/what-is-cloud-run).
- Azure Container Apps provides revision traffic control and KEDA-based scaling.
  See [revisions](https://learn.microsoft.com/azure/container-apps/revisions) and
  [scaling](https://learn.microsoft.com/azure/container-apps/scale-app).
- Northflank preview blueprints can provision complete per-change environments.
  See [Northflank environments](https://northflank.com/docs/v1/application/getting-started/set-up-environments).
- Koyeb supports fixed scaling, metric-based autoscaling and scale to zero. See
  [Koyeb scaling](https://www.koyeb.com/docs/reference/scaling).
- Unkey combines Git and container deployment with previews, multiple regions,
  API keys, rate limits, request policies, logs and metrics. Its compute product
  is in public beta, previews can sleep when idle, and production rollback is
  time-limited. See the [Unkey product overview](https://www.unkey.com/),
  [June 2026 release notes](https://www.unkey.com/changelog/2026-06-12) and
  [October 2026 runtime settings](https://www.unkey.com/changelog/2026-10-23).

The local implementation claims are derived from the repository's
[architecture](architecture.md), [runtime](runtime.md), [ingress](ingress.md),
[storage](storage.md), [backups](backups.md), [installation](install.md) and
[remote-worker](remote-workers.md) documentation.
