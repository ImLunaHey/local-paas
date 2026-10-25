# local-paas

An experimental, self-hosted application platform. Rust controller and node agents;
React, Vite, Tailwind and TanStack frontend. Licensed under [MIT](LICENSE).

Deploy Dockerfiles or supported Node/Bun projects from Git branches, tags, commits,
or local uploads. Builds run in an isolated BuildKit VM and produce immutable OCI
images. Three isolated worker VMs run applications through containerd. Management
services run outside the cluster they control.

## Install on Linux

The installation tooling targets **x86-64 and ARM64 Linux**, including Ubuntu,
Debian, Fedora and NixOS. It requires systemd, cgroup v2, KVM and the Nix package
manager. Nix provides pinned tools and VM images; the host does **not** need to run
NixOS. Installations currently use one architecture throughout the builder and
workers; mixed-architecture clusters and cross-building are not supported.

### Minimum host requirements

These requirements cover the default installation: one builder VM, three worker
VMs, and management services on the host.

| Resource | Requirement |
| --- | --- |
| CPU | x86-64 or ARM64 with hardware virtualization accessible through `/dev/kvm`; VM hosts need nested virtualization |
| Memory | At least **16 GiB available RAM** before installation, after existing host services |
| Storage | At least **100 GiB free** on healthy local SSD/NVMe; check both the checkout and `/var/lib` filesystems |
| OS | Linux with systemd and cgroup v2, plus the Nix package manager |
| Access | An operator account with sudo and a working systemd user session; Internet access to download dependencies and images |

The builder uses 3 GiB RAM and 2 vCPUs; each worker uses 2 GiB RAM and 1 vCPU.
Each VM has a 16 GiB virtual disk. Allow additional memory and disk headroom for
compilation, application builds, databases, image caches, logs and retained
backups. These are installation requirements, not a workload capacity guarantee.
All four VMs initially share one physical host and failure domain.

Read **[the installation guide](docs/install.md)** first. It covers prerequisites,
private access, provisioning, reboot recovery, upgrades and removal.

From a fresh clone on a dedicated host/operator account:

```sh
nix develop
install -d -m 700 .local
cp platform.example.json .local/platform.json
# Edit .local/platform.json if using a private HTTPS dashboard/preview hostname.
make setup-check
make setup-install
```

`setup-check` is read-only. `setup-install` explicitly provisions the builder and
three workers, a dedicated PostgreSQL database, OpenBao, ClickHouse, registry,
node gateway and persistent systemd units. It uses sudo for VM isolation and host
units. It does not alter an existing Railway deployment, configure public DNS,
or enable off-site backups. Never run it to adopt an existing manually installed
stack; it refuses detected conflicts.

Open **http://localhost:5188**. For another machine, forward it over SSH or use
private HTTPS access as documented. The installed frontend serves built assets
through Caddy; it does not run the Vite development server.

This is a **private, multi-operator alpha**, not a public multi-tenant PaaS.
Operator sessions, organizations, and RBAC do not replace private network access. Keep management listeners on
loopback and restrict SSH/tailnet access to trusted operators. Three VMs on one
host are three scheduling nodes, not three physical failure domains.

## What works

- Projects, per-project environments, shadowed configuration and secrets.
- Dockerfile builds, supported Node/Bun generated recipes, build/start overrides.
- Health-gated deployments, retained revisions, failed-candidate rollback,
  independent ingress, cordon/drain and opt-in stateless relocation.
- DNS-verified public OCI domains, Caddy API route updates, observed TLS and
  acknowledged promotion/rollback; explicit edge installation is required.
- Singleton workers, one-off jobs, interval schedules and pre-deployment commands.
- OpenBao-backed workload secrets; dedicated ClickHouse runtime log retention.
- Structured log columns/search, retained instance logs, metrics and audit events.
- Managed PostgreSQL, Redis and RustFS; shared node-pinned volumes and file browsing.
- Encrypted local backups and restore drills for the documented subset of state.
- Remote Linux worker VMs over authenticated private links; see
  [remote setup and validation limits](docs/remote-workers.md).

Public VPS/NetBird installation remains explicit. The edge worker manages routes
on an operator-installed Caddy through its API. celld declarations are modeled separately, but fleet
execution is not implemented. Storage remains node-pinned. See
[architecture and release limits](docs/architecture.md), [runtime](docs/runtime.md),
[storage](docs/storage.md), [ingress](docs/ingress.md) and [backups](docs/backups.md).

See the [major PaaS feature comparison](docs/paas-comparison.md) for a sourced
comparison with managed and self-hosted platforms and links to tracked product
gaps.

## Develop without provisioning VMs

Use `nix develop` for the pinned Rust, Node, pnpm and PostgreSQL toolchain.
`mise install` pins language and package-manager versions when using native tools;
PostgreSQL 18 and Make/systemd are also needed.

```sh
pnpm install --frozen-lockfile
make db
make bootstrap-auth
make api
make web
```

These targets supervise background development processes independently of the
terminal. The API binds `127.0.0.1:8080`; Vite binds `127.0.0.1:5188` and proxies the
API. Basic API/UI development works without OpenBao, ClickHouse or VMs; unavailable
infrastructure does not become fake successful builds or deployments.

The interactive bootstrap creates the first platform administrator and organization
administrator without echoing or storing plaintext passwords. Authentication, organization,
team, custom-role, recovery, and threat-model details are in
[operator authentication](docs/authentication.md).

For foreground processes use `make api-foreground` / `make web-foreground`.
Checkout-specific operator configuration belongs in ignored `.local/platform.env`
(see [configuration](docs/install.md#configuration)). Application dotenv files are
never loaded by the controller. [Background services](docs/background-services.md)
explains installed and development service lifecycles.

## Validate

```sh
make check
# DATABASE_URL must point to a disposable PostgreSQL test database, with CREATEDB.
make test-db
```

`make check` runs Rust formatting, Clippy with warnings denied, workspace tests,
Oxfmt, Oxlint (including accessibility, React Doctor recommended and TanStack Query
rules), TypeScript, Vitest and the frontend
production build. Shared visual variants use CVA and `cn`; components are imported
directly, with no handwritten barrels. Oxlint also enforces one variable per statement.
Rule exceptions are documented beside the affected declaration or in
`web/oxlint.config.ts`; existing large views still need decomposition.
CI also runs nextest, doc tests, coverage, dependency/license
checks, secret scanning and generated OpenAPI/client drift checks.

For isolated browser tests, use a disposable PostgreSQL database named
`platform_test` or `platform_e2e`, with CREATEDB. The harness starts its own API,
OpenBao and web server; it does not use operator credentials or running workers.

```sh
cargo build -p control-plane --bins
nix build .#browser-test-tools --out-link /tmp/platform-browser-tools
pnpm --dir web exec playwright install --with-deps chromium firefox webkit
PATH="/tmp/platform-browser-tools/bin:$PATH" bash infra/tests/browser.sh
```

Infrastructure fault drills require explicit opt-in fixtures; they are not part
of ordinary local or CI tests. `pnpm --dir web test:coverage` reports unit coverage
without imposing an artificial universal threshold.

Compile-checked SQL uses reviewed metadata in `.sqlx`; normal builds run offline.
After changing a checked query or its schema, migrate a disposable test database,
then run `SQLX_OFFLINE=false cargo sqlx prepare --workspace -- --all-targets` with
`DATABASE_URL` pointing to it. CI checks the metadata against real PostgreSQL.

The API schema is exported to `docs/api/openapi.json`. Regenerate it and the Orval
TanStack Query client with `make api-schema` after changing documented endpoints.
This development release changes API fields to camelCase and agent protocol to v2;
existing installations require a [clean contract reset](docs/upgrades.md).

CI is configured for Ubuntu 22.04 and 24.04 on x86-64, and Ubuntu 24.04 on ARM64.
A fresh Ubuntu 24.04 x86-64 installation, real two-replica deployment and host
reboot recovery were verified. A native ARM64 installation/reboot drill is still
pending; CI configuration and Nix evaluation do not substitute for it. See
[validation status](docs/install.md#validation-status).

## Layout

| Directory | Purpose |
| --- | --- |
| `crates/domain`, `crates/protocol`, `crates/runtime` | Workload model and runtime-independent contracts |
| `crates/control-plane` | API, reconciliation, scheduling, ingress, operator commands |
| `crates/node-agent` | Privileged worker runtime, networking, health and telemetry |
| `crates/build-runner` | Isolated BuildKit execution and source detection |
| `infra` | Pinned tools, worker/builder images, service launchers and edge templates |
| `web` | React dashboard and shared controls |
| `docs`, `examples` | Operations, design constraints and canary fixtures |
