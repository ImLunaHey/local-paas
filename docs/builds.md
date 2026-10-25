# Image builds and the isolated development builder

For a complete fresh-host installation use [install.md](install.md). The manual
commands below are component operations and opt-in qualification checks.

Registration saves configuration. **Queue build** snapshots that configuration,
optionally overrides its branch, tag or commit for this build, and writes a durable PostgreSQL
job. It does not start an application or change traffic. The build runner accepts
OCI services only; celld still needs its separate deployment runner.

## Execution contract

The Rust `build-worker` holds a session advisory lock and processes one job at a
time. A claim has a unique token and a 30-second renewable lease. Logs, completion
and revisions require the current unexpired token. Cancellation wins over a
concurrent successful completion. Revision creation, final status and audit event
commit together. A disconnected/crashed worker leaves an interrupted job after
lease expiry; it never silently retries potentially expensive work. Queue another
build explicitly. API restart does not stop an independent build worker.

Each request has an operation UUID; identical retries return the existing job.
Different input with the same UUID conflicts. Only one queued/running job per
service is allowed. The build snapshot is immutable even after service configuration changes. Retries compare the original request,
not current service settings. Failed/cancelled/interrupted jobs never
create revisions. An interrupted push may leave an unreferenced registry image.

Sources specify exactly one of `commit`, `branch` or `tag`. Branch/tag names are
short names (for example `main`, `feature/forms`, `v1.2.3`), not `refs/…`. The
worker resolves the exact `refs/heads/…` or `refs/tags/…` advertisement when it
claims a build, peels annotated tags, and stores `resolvedCommit` under the job's
lease before execution. A later branch/tag move cannot change that job or revision;
a new build resolves the current ref again. Missing refs fail without a revision.
Revision specs contain only the resolved commit; build specs retain the requested
ref for diagnostics. A SHA is checked for existence by BuildKit's actual fetch.

Ref discovery uses pinned Git (`BUILD_GIT_PATH`) on the worker host for bounded
`ls-remote` metadata only: 30-second timeout, 64 KiB output limits, empty inherited
environment, private tmpfs HOME, no global/system config or credential helpers,
HTTPS only and redirects disabled. It uses the same repository host allowlist.
No source files, hooks or build steps execute there. A private build uses a
tmpfs-only askpass helper backed by a newly minted installation token; neither
the token nor an authenticated URL enters argv, logs, PostgreSQL, or a durable
file. To upgrade an existing development setup, rebuild the tools output and add
`BUILD_GIT_PATH=/absolute/path/to/.local/builder-tools/bin/git` to
`.local/builder.env`; existing certificates do not need regeneration.

BuildKit fetches a credential-free HTTPS Git repository at the full commit SHA.
The initial host allowlist is `github.com`. Dockerfile paths are repository-relative;
the context can independently select a subdirectory. No host checkout, local
source directory, SSH agent, Docker socket, or developer dotenv file is
forwarded. Private builds add only BuildKit's reserved `GIT_AUTH_TOKEN` session
secret from a mode-0600 tmpfs file. The short-lived repository-restricted token
is unavailable to Dockerfile instructions and disappears with the client
session. Custom Dockerfile frontends and insecure entitlements are disabled.
Signed GitHub push, tag and same-repository pull-request events can enqueue this
same flow with an already pinned commit. Webhook credentials remain in OpenBao
and delivery payloads are not retained. See
[Git provider automation](git-automation.md).

Before a connected GitHub source reaches BuildKit, the worker downloads the
provider's ZIP for the same immutable commit. Redirects are handled manually and
may target only verified HTTPS on `codeload.github.com`; proxy environment is
ignored. The compressed body is capped at 32 MiB, and the shared source validator
caps expansion at 128 MiB, individual files at 16 MiB, and entries at 10,000.
Absolute/traversal paths, multiple archive roots, symlinks, special files,
overlaps, dotenv files, credential files, `.git`, and submodule metadata are
rejected. The validated tmpfs extraction is used only for non-executing build
plan inspection. BuildKit independently fetches the exact commit inside the
isolated VM; no host-side checkout or hook execution occurs.
Cache mount namespaces are per service; **Bypass build cache** sends `--no-cache`.
This bypasses instruction caching, not necessarily cache-mount contents or
upstream package caches. Pin base images/dependencies in the application for
reproducibility; a full Git SHA alone is insufficient.

The host-side `buildctl` process has an empty inherited environment and a private
tmpfs HOME/config/metadata directory. Explicit registry authentication, when used,
is narrowed to one registry entry; credential helpers are never run. mTLS client
credentials authenticate to the builder. The image digest comes from BuildKit's
successful push metadata, never from an assumed tag. Logs are capped at 512 KiB
per build and streamed in bounded chunks. Timeout defaults to 30 minutes. Killing
the client closes its session; the daemon owns remote execution cleanup, and the
VM remains the resource/isolation boundary.

## Automatic Dockerfile generation and commands

OCI services now accept `workload.build_mode`: `auto` (the default),
`dockerfile`, or `generated`. Automatic mode prefers the configured repository
Dockerfile, including BuildKit's lowercase spelling, and generates a recipe if
that file is absent. Detection considers only root manifests in the selected
build context, so a standalone app in a subdirectory works by setting `context`
accordingly. Multiple ecosystem manifests are ambiguous and fail closed. An
existing Dockerfile that fails to build is never replaced as a retry strategy.

The Configuration tab also accepts `buildCommand` and `startCommand`.
Blank fields use the selected recipe's defaults. JavaScript uses `scripts.build`
and `scripts.start`; Go builds the root package to `/app/app`. Python, Rust, Ruby
and PHP require an explicit start command because inferring a framework,
entrypoint or binary name is unsafe. Custom commands select generation even in
automatic mode; select `generated` to explicitly ignore a repository Dockerfile.
Dockerfile-only mode rejects command overrides instead of silently ignoring them.
Set a build command of `true` to explicitly skip an application's default build
script. Commands execute through `/bin/sh -c` inside the builder/runtime and are
JSON-encoded in the Dockerfile, never executed on the controller. Use `exec` in a
custom start command when appropriate for signal forwarding. Commands are visible
configuration: never put secret values in them. Runtime secret delivery uses
OpenBao; build-time secrets are not supported.

The versioned recipe interface supports these standalone application shapes:

| Ecosystem | Required root files | Default build | Start |
| --- | --- | --- | --- |
| Node/Bun | `package.json` and exactly one npm, pnpm, Yarn or Bun lockfile | `scripts.build`, if present | `scripts.start` |
| Python | `pyproject.toml`, `uv.lock` | `uv sync --frozen` | explicit command |
| Go | `go.mod`, `go.sum` | locked root-package binary at `/app/app` | `/app/app` |
| Rust | `Cargo.toml`, `Cargo.lock` | `cargo build --locked --release` | explicit command |
| Ruby | `Gemfile`, `Gemfile.lock` with an exact Bundler version | deployment-mode `bundle install` | explicit command |
| PHP | `composer.json`, `composer.lock` | production Composer install | explicit command |

Monorepos/workspaces, mixed-language roots, conflicting lockfiles, missing
lockfiles and known native-system dependency cases receive actionable errors.
Provide a repository Dockerfile for these cases.

Runtime presets are digest-pinned Node 24.22.1/22.23.4, Bun 1.4.4, Python 3.13.9,
Go 1.25.3, Rust 1.90.0, Ruby 3.4.7 and PHP 8.4.14 images. Node selection respects
`engines.node`, `.node-version` and `.nvmrc`;
unsupported or conflicting requirements fail rather than silently choosing a
version. Exact `packageManager` versions are honored; pnpm defaults to 12.15.0,
Yarn to 1.22.22, npm to the pinned image's bundled version. Bun's preset currently
requires 1.4.4 when explicitly pinned and checks `engines.bun`. Presets need
reviewed updates; this does not guarantee every application supports them.
The generated build stage includes native compilation tools; the runtime omits
those tools, uses UID/GID 1000, and retains the installed app tree including dev
dependencies for compatibility. It sets production mode, PORT and wildcard host
variables, but the application must actually honor those settings. Database,
secret, readiness and runtime deployment configuration are still separate.

Inspection is currently public GitHub only: bounded, timed HTTPS metadata reads
at the resolved commit from a fixed raw-content host, no redirects, credentials,
proxy environment or host checkout. Other allowlisted Git hosts can use
Dockerfile-only mode. Only a definitive missing-file response permits fallback;
network errors do not. Package scripts never run during inspection.

The worker persists the exact `buildPlan` before invoking BuildKit, with lease
fencing and an audit event. The plan contains the detector version, confidence,
reasons, required files, effective commands, port, unsupported conditions and the
complete generated Dockerfile. Build details retain this evidence after failure.
Source checkout stays in the isolated VM. For a
generated build, buildctl shares only a fresh tmpfs directory containing the
platform-authored Dockerfile and Dockerfile-specific ignore file; it never shares
local source, HOME or credentials. The pinned frontend's `dockerfilekey` option
overrides the remote Dockerfile while retaining the remote Git context. Repository
ignore rules are followed by mandatory exclusions for dotenv files, `.npmrc`,
`.git`, dependency directories and build outputs, so repository negations cannot
reinclude these files.
These rules are also emitted as `COPY --exclude` flags: this BuildKit frontend
does not apply the local ignore file to an already-resolved remote Git context.
A check before dependency installation rejects any copied dotenv or .npmrc file.
Ignore patterns containing spaces, escapes, non-ASCII characters or Dockerfile
interpolation syntax require a repository Dockerfile; the generator fails rather
than silently dropping those exclusions.
This guards those files; it is not a scanner for secrets embedded in other code.

Validation includes unit tests for package managers, version constraints,
ambiguous apps and command escaping, PostgreSQL tests for immutable/fenced build
plans, browser save/reload checks for commands, and a real generated image build
that runs as UID 1000 and proves synthetic dotenv/.npmrc files were excluded.
A separate remote-Git regression uses a pinned public repository with a tracked
dotenv file and checks its absence without reading its contents or running the
application's scripts:

```sh
source .local/builder.env
cargo test -p platform-build-runner --lib generated_recipe -- --ignored
```

`examples/generated-go-canary/service.json` is the real non-JavaScript canary.
Pin its source to the revision under test before registration; the checked-in
branch is only a convenient template and is not an immutable qualification input.
Recipe contributor and versioning rules are in [build-recipes.md](build-recipes.md).

The worker runs build preparation in an independently scheduled task. Heartbeat
queries must not block the only task that can finish a transaction on the same
build row. Cancellation/shutdown aborts and joins that task, dropping buildctl
before cancellation is persisted.

## Start the disposable VM

These explicit component provisioning commands create a
dedicated host system user, task-specific nftables table and transient systemd
service. They do not reconfigure the host or provision the three workload workers.

Recheck memory, load and NVMe headroom before starting. This experiment uses two
vCPUs, 3 GiB guest RAM, a 4 GiB host cgroup limit, 200% CPU quota and a 16 GiB
virtual disk. State resides at `/var/lib/local-paas-builder` on the host. Use healthy, suitable local storage.

```sh
nix build path:./infra/builder#tools -o .local/builder-tools
nix build path:./infra/builder -o .local/builder-vm
bash infra/builder/credentials.sh
bash infra/builder/start.sh
```

Nixpkgs is pinned by `infra/builder/flake.lock`. The VM contains BuildKit and a
CNCF Distribution registry. No host/NAS directories or host Nix store are shared:
the guest gets a disk image containing its own Nix closure. The only credential
media contains the guest server key/certificate and public CA. CA signing key and
client key stay outside the guest and Nix store, under ignored `.local` mode 0700.
Certificates expire after 30 days. Stop the worker and VM before explicit rotation;
archive/remove the old local credential directory and regenerate/restart. Existing
credentials are never silently replaced by the setup command.

QEMU runs as `local-paas-builder`, without capabilities, with a read-only host
filesystem except its state directory. Host-side nftables rules restrict that
UID's outbound connections before VM startup: no host-local addresses, LAN,
RFC1918, link-local/metadata, CGNAT/tailnet, multicast or IPv6. Replies to established
host-forwarded connections are allowed. Public IPv4 egress, including public DNS,
is available for Git and dependency downloads. Build steps get CNI namespaces
inside the VM. This is not a domain-level Internet allowlist or per-app production
network policy. Do not remove the dedicated firewall table while QEMU is running.

The builder's only forwarded host listeners are loopback TCP 12340 (mTLS BuildKit)
and 15000 (development HTTP registry). No SSH, public listener or tailnet route is
added for them. Other local host users can reach the unauthenticated development
registry; images contain no platform secrets. This registry shares the disposable
builder failure/trust boundary and is **not** the production registry. Production
requires a separate authenticated registry, scoped push/pull identities, retention
and coordinated GC. Its `127.0.0.1:15000` image references are only valid locally;
they must not be handed to future worker nodes.

Start the Rust worker after the VM is ready:

```sh
bash infra/builder/worker.sh
```

The development launcher runs the worker as the transient user unit
`local-paas-build-worker`. Inspect it with `systemctl --user status
local-paas-build-worker`; stop it before browser queue tests with `systemctl
--user stop local-paas-build-worker`. Recreate it afterward with `bash
infra/builder/worker.sh` (a collected transient unit cannot be restarted with
`systemctl start`). Do not stop the shared worker while someone has queued builds;
use a separate test database and worker for queue tests. The VM itself is a separate system
unit, operated with `sudo systemctl` as shown below.

The UI reports the worker heartbeat, not a guarantee of daemon/registry health.
Connection failures appear in build diagnostics. The API and frontend continue
using `make api` and `make web`; `.local/development.mk` preserves Tailscale access.

Inspect and stop:

```sh
sudo journalctl -u local-paas-builder --all -n 80
sudo systemctl show local-paas-builder -p MemoryCurrent -p CPUUsageNSec
sudo systemctl stop local-paas-builder
```

The standalone launcher creates a transient unit: after a reboot run `start.sh`
again. `make setup-install` instead creates persistent units with boot-time firewall
ordering; use systemctl for that installation.
It reinstalls the dedicated egress policy before boot. Stop the Rust worker before
stopping the VM for maintenance. VM restart preserves cache and dev registry;
discarding `builder.qcow2` while stopped removes both. Never delete it while QEMU
is running. Complete teardown also removes the stopped unit's state directory,
the `inet local_paas_builder` nft table and dedicated user; leave unrelated host
firewall rules and existing Tailscale routes intact.

BuildKit GC targets 8 GB usage with 3 GB free; the virtual disk imposes a hard
capacity shared with registry/state. Guest journals are bounded. Registry deletion
and automatic registry GC are disabled to retain all recorded development images.
Disk exhaustion fails builds; rebuild the disposable fixture when necessary.
Per-build logs are bounded, but aggregate job/database retention is still a
production gate. There is no production backup guarantee for this builder.

## API and verification

- `POST /api/services/{id}/builds`: `operationId`, optional source override (one of `commit`, `branch`, `tag`), `noCache`.
- `GET /api/services/{id}/builds`: latest 50 jobs.
- `GET /api/builds/{id}`: state, immutable source snapshot and `resolvedCommit`.
- `POST /api/builds/{id}/cancel`: idempotent cancellation request.
- `GET /api/builds/{id}/logs?after=0`: up to 128 chunks, next cursor, truncation flag.
- `GET /api/services/{id}/revisions`: successful image digests and build IDs.
- `GET /api/build-system`: worker heartbeat and per-build log limit.

`make test-db` covers concurrent claiming, retry conflicts, cancellation races,
lease expiry/stale result fencing, atomic revisions/events, log bounds/cursors,
commit snapshots and rejection of celld. Browser tests exercise real queue/cancel
and reload state; **stop the build worker** while running that suite.

With the development VM running, the Rust isolation test starts a temporary
loopback HTTP probe, proves host access, then executes a pinned BusyBox Dockerfile
inside BuildKit. It requires public egress to work and private destinations to
fail, and confirms the build never contacted the host probe. It also checks that
an untrusted `#syntax` directive is ignored. Only this test forwards a small
synthetic local context; the product runner only forwards its generated recipe files.

```sh
source .local/builder.env
cargo test -p platform-build-runner --test vm -- --ignored
```

The fixture probes a CGNAT address as a denied-network canary; no personal
tailnet address is required. Set `E2E_COMPLETED_BUILD_SERVICE_ID` to the build
canary service UUID to additionally verify its actual logs/digest in the browser.

The opt-in VM suite checks remote Git checkout, immutable registry digests, mTLS,
network isolation, cancellation and worker lease expiry. Run it against a dedicated
test builder; a passing unit suite does not prove these infrastructure properties.

`examples/build-canary.json` pins Docker's tiny scratch-based hello-world image.
It exercises remote Git checkout, separate context/Dockerfile paths, push and
digest recording without expensive dependency downloads. It is a **build-only
fixture**: its executable exits and has no HTTP server. Its manifest port and
readiness fields do not make it a runnable web migration candidate. Do not deploy
it as the Railway web canary.

## References

- [BuildKit client](https://github.com/moby/buildkit/blob/master/docs/reference/buildctl.md)
- [BuildKit daemon configuration](https://github.com/moby/buildkit/blob/master/docs/buildkitd.toml.md)
- [NixOS VM module](https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/modules/virtualisation/qemu-vm.nix)
- [Distribution garbage collection](https://distribution.github.io/distribution/about/garbage-collection/)

Git ref contracts: [ls-remote](https://git-scm.com/docs/git-ls-remote),
[check-ref-format](https://git-scm.com/docs/git-check-ref-format).

Generated build references: [pnpm install --frozen-lockfile](https://docs.npmjs.com/cli/v11/commands/npm-ci/),
[npm start](https://docs.npmjs.com/cli/v11/commands/npm-start/),
[pnpm install](https://pnpm.io/cli/install), [Yarn install](https://yarnpkg.com/cli/install),
[BuildKit Dockerfile selection](https://github.com/moby/buildkit/blob/v0.30.0/frontend/dockerui/config.go).

## Dockerfile arguments and stages

OCI configuration accepts `workload.build_args` (a map of non-secret strings)
and `workload.build_target` (a named Dockerfile stage). Both are editable in the
configuration form and captured in each immutable build specification. Arguments
are passed literally to BuildKit, without host shell evaluation. `BUILDKIT_`
names are reserved. At most 32 arguments and 16 KiB of values are accepted.
These settings require a repository Dockerfile; automatic detection fails clearly
if it cannot find one rather than silently generating an incompatible recipe.
Build arguments may appear in layers, provenance and logs: use runtime secrets
for credentials, never build arguments. Build-time secret mounts are not supported.
