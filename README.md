# local-paas

A personal application platform, built from scratch. Rust control plane and
runtime contract; Vite, React, Tailwind, TanStack Router and Query frontend.
Independent of Anvil. Working project name; no remote repository created yet.

**Implemented:** register and edit OCI or celld specifications, build digest-addressed
images, deploy OCI revisions across three isolated worker VMs, gate traffic on
readiness, stop deployments, and view application logs and CPU/memory/PID metrics.
Rust node agents authenticate through a private mTLS gateway and reconcile durable
assignments. Healthy containers survive controller restarts. Failed candidates
leave the previous active deployment intact. Sources support branches, tags and
commits; supported Node/Bun apps can generate Dockerfiles with command overrides.

Showcase Studio is privately deployed with two replicas on different worker VMs:
**https://lake.tail3275e2.ts.net:5201**. The dashboard remains on port 5188.
All three workers share Lake as a physical failure domain. This is a development
runtime, not a Railway production migration.

**Not implemented:** automatic relocation after node loss, node cordon/drain UI,
OpenBao secret delivery, persistent workload volumes, public DigitalOcean ingress,
NetBird provisioning, production authentication/backup recovery, and celld fleet
execution. Secret-bearing workloads and celld cannot enter the OCI deploy path.
See [runtime operations and limitations](docs/runtime.md).

See [architecture decisions and release gates](docs/architecture.md). Backend
uses Rust; frontend uses TypeScript as explicitly requested by Luna.

## Run locally

Prerequisites: recent stable Rust (tested with 1.98.1), Node 24 and npm,
PostgreSQL 18 tools (`initdb`, `pg_ctl`, `psql`, `createdb`), and Make. Development
commands target a local Unix-like machine and should run as an ordinary user.

```sh
cd web
npm ci
cd ..
make db
make api
```

In another terminal:

```sh
make web
```

Open **http://localhost:5188**. The API listens at `127.0.0.1:8080`, proxied by
Vite. The UI uses real database state, not seeded deployments or fake metrics.

`make db` initializes only `.local/postgres` in this checkout and listens on
the private `.local/socket` Unix socket, with TCP disabled. `.local` has mode
0700. The local development database uses the current OS user's PostgreSQL
role. This setup is not a production database/backup configuration. `make
db-stop` stops it without deleting its data. The checkout path should not
contain spaces when using the supplied Makefile PostgreSQL startup options.

To use a different **development** database:

```sh
export DATABASE_URL='postgresql://user:password@localhost/local_paas'
cargo run -p control-plane --bin control-plane
```

Startup applies embedded SQL migrations. The API does not load `.env` files or
log the database URL. `PORT` changes its loopback port; update Vite's proxy to
match. `BROWSER_ORIGIN` defaults to `http://localhost:5188`; set it to the exact
frontend origin if you change that URL. `PUBLIC_ORIGIN` adds one exact trusted
proxy origin alongside localhost. There is deliberately no CORS allowance.

## Access over Tailscale

On Lake, open **https://lake.tail3275e2.ts.net:5188** from a device on the tailnet.
Local access at http://localhost:5188 continues to work. Tailscale Serve forwards
HTTPS to the Vite listener on `127.0.0.1:5188`; Vite proxies `/api` to the Rust
listener on `127.0.0.1:8080`. HTTPS is needed for the registration form's browser
UUID API. The existing Tailscale routes on port 443 are unchanged.

The checkout-local `.local/development.mk` contains:

```make
PUBLIC_ORIGIN := https://lake.tail3275e2.ts.net:5188
```

`make api` and `make web` both load this setting. On another machine, use its
actual Tailscale DNS name. Vite allows only that additional hostname, and the API
accepts only the exact public origin plus its configured local browser origin.
The proxy rewrites Host for the loopback API while preserving browser Origin.

To enable the private HTTPS endpoint after starting the app:

```sh
tailscale serve --bg --https=5188 http://127.0.0.1:5188
```

Use `sudo` for this command if the local Tailscale daemon requires it (as on Lake).
To remove only this endpoint: `tailscale serve --https=5188 off`.
See [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).
Serve configuration persists, but the API and frontend must still be running.
No Funnel/public endpoint is enabled. Tailnet access rules control who can reach
the app; application-level administrator authentication is not implemented yet.

## Use the API

- `GET /api/health`: database readiness and implemented capabilities.
- `POST /api/specs/validate`: validates a specification without persisting it.
- `POST /api/services`: `{ "operation_id": "UUID", "spec": { ... } }`.
  Returns 201 on creation or 200 for an identical retry. Reusing an operation ID
  with different configuration, or a service name in the same project/environment,
  returns 409. Keep the same operation ID if a response is lost.
- `GET /api/services?offset=0`: `{ "items": [...], "total": N }`, 50 per page.
- `GET /api/services/{id}`: persisted configuration, version and registration time.
- `PUT /api/services/{id}`: `{ "operation_id": "UUID", "expected_version": 1, "spec": { ... } }`.
  Saves validated configuration and an audit event atomically, incrementing the
  version. A stale version returns 409; reload before retrying your edits. Identical
  retries with the same operation ID return their original result. Workload kind
  cannot change after registration. Existing builds and revisions are immutable.
- `GET /api/services/{id}/events`: latest 100 audit events.

Requests use JSON with a 64 KiB body limit. Semantic validation returns 422 with
field-specific issues. Unknown fields are rejected. The Configuration tab edits source, build and runtime
settings, build/start command overrides, domains and secret names. Saving affects future builds and does not
trigger a build or deployment. Secret values never belong in a specification.
No delete API is exposed.

See [build execution, API endpoints and builder operations](docs/builds.md) to
start the isolated builder and Rust worker. On a service page, **Queue build**
resolves the selected branch/tag/commit and builds it; successful pushes appear under **Image revisions**.

Examples: [OCI](examples/oci-service.json) and [celld](examples/celld-service.json).
These contain placeholder repositories/hashes; validation checks their shape,
not existence. They cannot establish a reproducible build. The separate
[build-only canary](examples/build-canary.json) uses a real pinned public source.
It is not a web deployment candidate. Wrangler validation, bucket qualification
and secret resolution belong to subsequent execution stages.

## Checks

```sh
make check
make db
make test-db
```

`make check` runs Rust/TypeScript formatting checks, Clippy, unit tests and the
production frontend build.
Database tests are explicitly ignored in the default unit-test run. `make test-db`
runs them against actual PostgreSQL; SQLx creates and drops an isolated database
per test. The configured role therefore needs CREATEDB. **Use a disposable
development server**, never a production connection, for integration tests.

Integration coverage: persistent registration and event visibility; concurrent
retry deduplication; operation-ID conflicts and name conflicts; invalid specs
performing no writes; separate celld configuration; rejected cross-site writes;
missing services; host-header rebinding; and complete rollback when audit
persistence fails. CI runs both ordinary and database tests.

The browser tests use the real API and add uniquely named test services to the
development database. With `make api` running and the build worker stopped:

```sh
cd web
npx playwright install chromium
npm run test:e2e
```

Set `E2E_BASE_URL=https://lake.tail3275e2.ts.net:5188` to run the same browser
registration checks through the actual Tailscale HTTPS endpoint.
Lake itself does not accept Tailscale DNS; on that host also set
`E2E_RESOLVE_IP=100.94.132.48`. This overrides only the test browser's DNS lookup;
certificate verification stays enabled. Other tailnet devices using MagicDNS
resolve the hostname normally.

On NixOS, use a Nix-provided Chromium instead of the downloaded Linux binary by
setting `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. Browser coverage
includes OCI registration, build queue/cancel/reload, celld validation/registration,
and mobile layout. Set `E2E_COMPLETED_BUILD_SERVICE_ID` to a service with a real
successful build to check its digest and build output. Set `E2E_RUNNING_SERVICE_ID`
to a running service with a private preview to check live logs, measured usage,
charts and application access. These tests observe existing deployments; they do
not deploy any workload. Restart the build worker after queue/cancel checks.

## Layout

```text
crates/domain         service specifications, validation, immutable image digest
crates/runtime        agent-owned OCI runtime trait; no runtime implementation
crates/control-plane  Axum API, desired deployments, private preview, persistence
crates/node-agent     outbound node protocol, containerd adapter, health and telemetry
crates/protocol       versioned runtime-independent assignments and observations
crates/build-runner    bounded mTLS buildctl client, no local Dockerfile execution
infra/builder         pinned NixOS builder VM and explicit development setup
infra/workers         three pinned NixOS workers, private identities and mTLS gateway
web                   Vite / React / Tailwind / TanStack UI
examples              small OCI and celld manifests
docs                  decisions, threat boundaries, next milestones
```

Lake has a development builder VM, three worker VMs, and private Tailscale Serve
endpoints. DigitalOcean, NetBird, OpenBao, Railway and production databases remain
untouched. Deployments and telemetry are real; production release gates remain
listed in the architecture document.
