# Image builds and the Lake development builder

Registration saves configuration. **Queue build** snapshots that configuration,
optionally overrides its commit for this build, and writes a durable PostgreSQL
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
service is allowed. The build snapshot is immutable even when a commit override
differs from the registered service. Failed/cancelled/interrupted jobs never
create revisions. An interrupted push may leave an unreferenced registry image.

BuildKit fetches a credential-free HTTPS Git repository at the full commit SHA.
The initial host allowlist is `github.com`. Dockerfile paths are repository-relative;
the context can independently select a subdirectory. No host checkout, local
directory, SSH agent, Docker socket, developer dotenv file or build secret is
forwarded. Custom Dockerfile frontends and insecure entitlements are disabled.
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

## Start the disposable VM

Luna explicitly authorized this builder VM on Lake. These commands create a
dedicated host system user, task-specific nftables table and transient systemd
service. They do not rebuild Lake or provision the three workload workers.

Recheck memory, load and NVMe headroom before starting. This experiment uses two
vCPUs, 3 GiB guest RAM, a 4 GiB host cgroup limit, 200% CPU quota and a 16 GiB
virtual disk. State resides at `/var/lib/local-paas-builder` on Lake's root NVMe;
the degraded ZFS pool is not used.

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
source .local/builder.env
make build-worker
```

On Lake, this worker is currently running as the transient user unit
`local-paas-build-worker`. Inspect it with `systemctl --user status
local-paas-build-worker`; stop it before browser queue tests with `systemctl
--user stop local-paas-build-worker`. In non-login shells on Lake, prefix these
commands with `XDG_RUNTIME_DIR=/run/user/1000`. The VM itself is a separate system
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

The VM unit is transient: after a host reboot, explicitly run `start.sh` again.
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

- `POST /api/services/{id}/builds`: `operation_id`, optional `commit`, `no_cache`.
- `GET /api/services/{id}/builds`: latest 50 jobs.
- `GET /api/builds/{id}`: state and immutable source snapshot.
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
synthetic local context; the product build runner never does.

```sh
source .local/builder.env
cargo test -p platform-build-runner --test vm -- --ignored
```

The fixture targets Lake's current Tailscale IP; update that target deliberately
when running on another host. Set `E2E_COMPLETED_BUILD_SERVICE_ID` to the build
canary service UUID to additionally verify its actual logs/digest in the browser.

Verified on Lake on 2026-10-23: real Git → VM build → registry push → persisted
revision, registry manifest body matching its recorded SHA-256, mTLS rejecting a
client without a certificate, the Rust Dockerfile isolation test, cancellation
of a running job, and worker SIGKILL leading to lease expiry without a revision.
Rust checks, 18 PostgreSQL integration tests and four Tailscale browser tests
passed. Showcase Studio's registered commit fetched successfully but failed
because its root Dockerfile is absent; its service configuration was preserved.

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
