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

This is a **private, single-operator alpha**, not a public multi-user PaaS. There
is no application-level administrator login yet. Keep management listeners on
loopback and restrict SSH/tailnet access to trusted operators. Three VMs on one
host are three scheduling nodes, not three physical failure domains.

## What works

- Projects, per-project environments, shadowed configuration and secrets.
- Dockerfile builds, supported Node/Bun generated recipes, build/start overrides.
- Health-gated deployments, retained revisions, failed-candidate rollback,
  independent ingress, cordon/drain and opt-in stateless relocation.
- Singleton workers, one-off jobs, interval schedules and pre-deployment commands.
- OpenBao-backed workload secrets; dedicated ClickHouse runtime log retention.
- Structured log columns/search, retained instance logs, metrics and audit events.
- Managed PostgreSQL, Redis and RustFS; shared node-pinned volumes and file browsing.
- Encrypted local backups and restore drills for the documented subset of state.

Public VPS/NetBird integration has configuration templates but is not an automated
installation feature. celld declarations are modeled separately, but fleet
execution is not implemented. Storage remains node-pinned. See
[architecture and release limits](docs/architecture.md), [runtime](docs/runtime.md),
[storage](docs/storage.md), [ingress](docs/ingress.md) and [backups](docs/backups.md).

## Develop without provisioning VMs

Use `nix develop` for the pinned Rust, Node and PostgreSQL toolchain, or supply
compatible tools yourself (Rust 2024 edition, Node 24, PostgreSQL 18, Make/systemd).

```sh
pnpm install --frozen-lockfile
make db
make api
make web
```

These targets supervise background development processes independently of the
terminal. The API binds `127.0.0.1:8080`; Vite binds `127.0.0.1:5188` and proxies the
API. Basic API/UI development works without OpenBao, ClickHouse or VMs; unavailable
infrastructure does not become fake successful builds or deployments.

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

Checks include Rust formatting, Clippy, workspace tests, frontend formatting and
production build. Database tests create isolated SQLx databases. Browser tests
require a separate development API/database and a stopped build worker:

```sh
cd web
pnpm exec playwright install chromium
pnpm test:e2e
```

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

This project is independent of Anvil and has no dependency on it.
