# Install and operate a private Linux host

## Host prerequisites

Use a dedicated ordinary operator account on a systemd Linux host, with sudo
access for installation. Ubuntu 22.04/24.04, Debian, Fedora and NixOS are intended
host families. The installer does not replace your OS or rebuild NixOS. OpenRC-only
systems, macOS and Windows hosts are not supported by this installer.

- x86-64 (`x86_64-linux`) or ARM64 (`aarch64-linux`). Builder and workers run the
  host's native architecture. Images must support that architecture.
- Hardware virtualization exposed through `/dev/kvm`, a `kvm` group with access
  to that device, and unified cgroup v2. Cloud VMs need nested virtualization;
  an ARM server without KVM cannot run this topology.
- At least **16 GiB available RAM** and **100 GiB free disk** before installation;
  compilation/build bursts need additional headroom. Put the checkout and VM
  state on healthy local SSD/NVMe. VM state lives under `/var/lib`, so check that
  filesystem's free space too if it differs from the checkout.
- Internet access for Nix caches, Cargo/npm packages, OCI registries and Git.
- A systemd user session (`systemctl --user status` must work). Log in as the
  operator over SSH; running `sudo su` alone may not create a user manager.
- One installation per host. Ports, service names and isolation UIDs are reserved
  below. The checkout path must use letters, digits, `/`, `.`, `_`, `-` only.
  Keep the checkout at its installed path; systemd units reference it.

Install Git, sudo and Nix through your distribution or the
[official Nix installer](https://github.com/NixOS/nix-installer#install-nix).
Use a multi-user Nix installation with `nix-command` and `flakes` enabled.
The installer supports x86-64 and ARM64 Linux; NixOS is not required.

Clone this repository, then enter `nix develop`. The root `flake.lock` pins Rust,
Node, PostgreSQL tools and installation utilities. The infrastructure flakes also
have committed lockfiles. Do not update locks during a deployment incident.

## Configuration

```sh
nix develop
install -d -m 700 .local
cp platform.example.json .local/platform.json
```

Edit `.local/platform.json` before provisioning. Leave the example unchanged for
loopback/SSH dashboard access. For a private HTTPS reverse proxy, for example:

```json
{
  "public_origin": "https://platform.example.ts.net:5188",
  "preview_host": "platform.example.ts.net",
  "preview_ports": [5201, 5202, 5203, 5204, 5205]
}
```

`public_origin` is one exact browser HTTPS origin, without a trailing slash.
`preview_host` and ports describe endpoints you will actually expose privately;
setting these does not create DNS, certificates or proxy listeners. Blank preview
host disables selectable private endpoints until you configure them.

Installation writes `.local/platform.env` with references, never secret values.
It is read by systemd and the development launchers. After installation edit this
file to change origins/preview configuration, update `.local/frontend.Caddyfile`'s
trusted host matcher when changing the dashboard hostname, then restart API and
frontend. The JSON is an installation input, not a live settings source. Treat the
environment file as trusted operator configuration; do not put application dotenv
content or secret values there. Development callers may alternatively set exported
`PUBLIC_ORIGIN`, `PREVIEW_HOST`, `PREVIEW_PORTS`, `DATABASE_URL` and secret-file paths.
A saved platform.env takes precedence over exported variables.

## Provision

```sh
make setup-check
make setup-install
```

The Rust installer checks configuration, host prerequisites and conflicts, builds
pinned tools/VMs and application binaries, initializes management PostgreSQL,
starts dedicated OpenBao and ClickHouse, creates private credentials, enrolls
three nodes, and installs persistent systemd units. It serves `web/dist` using
Caddy. Installation waits for the API, dashboard, registry and all three
**authenticated node heartbeats**; a unit merely being started is not readiness.

A failed installation can be retried with `make setup-install` from the same
checkout. Existing private identities and configuration are retained. A changed
configuration file is not silently overwritten. Inspect the failing step first;
the installer leaves partial resources available for diagnosis instead of deleting
data. `.local/install-started` identifies this installation attempt—do not create
it manually to bypass conflict detection. `make setup-prepare` builds tools/images
and identities without starting services. `platform-setup render` prints proposed
user units without installing them or printing credential values.

The VM users reserve UIDs 61000–61003. Existing accounts/occupied required ports
cause fresh installation to fail. VM processes have no host filesystem shares;
root-owned nftables rules are installed before every VM boot and restrict each
VM UID's access to private/management networks. No global firewall flush occurs.
Root helper code and firewall inputs live in root-owned `/var/lib/local-paas`,
outside the VM users' writable state directories.

The builder has 3 GiB RAM / 2 vCPUs; workers have 2 GiB / 1 vCPU each and four
runtime slots. This is a bounded initial topology, not an unlimited scheduler.
Their VM disks are 16 GiB each. Reserve space for caches, registry, PostgreSQL,
ClickHouse logs and source uploads in addition to those disks.

## Access and first deployment

On the host open `http://localhost:5188`. From another computer:

```sh
ssh -N -L 5188:127.0.0.1:5188 operator@your-host
```

Then open `http://localhost:5188` locally. The dashboard has no application-level
login: access to this tunnel grants administrative access. Never publicly expose
5188 or 8080. All management listeners stay on loopback.

Alternatively, after configuring `public_origin`, use private Tailscale Serve:

```sh
tailscale serve --bg --https=5188 http://127.0.0.1:5188
# Repeat for each configured application preview port, mapping to ingress:
tailscale serve --bg --https=5201 http://127.0.0.1:8090
```

Use sudo if your Tailscale installation requires it. Restrict tailnet access to
trusted operators. Do not enable Funnel. TLS and private DNS belong to this proxy;
the platform does not silently configure your VPN. NetBird/public VPS integration
remains a separate deployment task described in [ingress](ingress.md).

Create a project, select its environment, and add an app. Start with a disposable
HTTP service whose Dockerfile supports your host CPU architecture, listens on
`0.0.0.0`, has a readiness path and can run concurrently. Public GitHub repositories
and validated uploads are supported; private Git authentication is not implemented.
Set resources/port/readiness and secrets, then create/build it. Verify the image
digest and build diagnostics before deploying a revision. The Nodes page should
show three healthy workers; application readiness gates routing. Map a configured
private preview endpoint in Networking to open the application.

For SSH-only testing without a TLS preview, add a reserved test hostname such as
`canary.example.test` in Domains and assign it to the service. Forward port 8090 and
send `curl -H 'Host: canary.example.test' http://127.0.0.1:8090/`. This exercises the
private route; the domain correctly remains pending external DNS/edge setup.

Database and Storage creation provision PostgreSQL, Redis or RustFS as services.
Their persistent data is pinned to its owning node. A shared volume permits multiple
services on that same node, not cross-node block storage. See [storage](storage.md).

## Restart and upgrade

Installed user units belong to `local-paas.target`; user lingering is enabled so
they start without an interactive login. Builder/worker system units start at boot
behind `local-paas-firewall.service`. Healthy apps survive a controller restart;
a host restart still interrupts all three nodes together.

```sh
systemctl --user status 'local-paas-*'
systemctl status 'local-paas-*'
journalctl --user -u local-paas-api -f
sudo journalctl -u local-paas-worker-1 -f
```

**OpenBao starts sealed after a reboot.** From the checkout, enter `nix develop`
and run `make unseal`. This uses the private local recovery file and does not
print its contents. It also replaces a controller token that expired during
extended downtime. Until unsealed, secret operations/new secret-bearing workloads
can fail. Recovery shares are colocated for this alpha; automatic unsealing and
independent recovery custody are not claimed.

Before upgrades, take and verify a backup. Stop the API/build worker, update the
checkout and enter the new `nix develop`, run `cargo build --workspace --bins` and
`pnpm install --frozen-lockfile && pnpm build --prefix web`, then start the API/build worker
and restart ingress. Embedded PostgreSQL migrations run on startup. **An old binary
is not a database migration rollback**; restore the matching backup if needed.
Refresh the pinned service tools with `nix build path:./infra/services -o
.local/service-tools` before restarting services/backup jobs that use them.
Do not rerun the fresh installer to upgrade an existing installation.

Worker/builder image changes require an explicit maintenance window: drain nodes,
stop VMs, rebuild their images, update each installed system unit's `ExecStart`
store path to the new resolved VM output, run `sudo systemctl daemon-reload`, and
start them again. Preserve disks, node IDs and credentials. The generated firewall
helper is a root-owned copy; replacing it also requires sudo. Automated rolling
host/agent upgrades are not implemented.

Builder and worker certificates currently last **30 days**. Rotate in a maintenance
window before expiry: stop the build worker, drain/stop workers and builder, archive
the builder TLS directory privately and regenerate it; for worker credentials,
preserve each `config.json` (stable ID/token) but regenerate the CA/server/client
certificates and ISO media. Copy new media into the stopped VM state directories
using `infra/*/start.sh --prepare` (workers take the index before `--prepare`).
Restart the gateway and VMs. Do not delete database state or generate new node IDs
as a substitute for certificate rotation. Automated rotation remains a release gate.

## State, backup and removal

Keep `.local` and VM disks private and out of Git. Initialization/unseal shares and
root recovery credentials are under `.local/platform-services/recovery`; controller
and node credentials also remain private files. Secret values are stored encrypted
by OpenBao and delivered into workload tmpfs. Filesystem access by the operator/root
is trusted; this installation is not a hostile multi-user host configuration.

Local encrypted backup commands are optional and documented in [backups](backups.md).
They cover control-plane PostgreSQL, active managed PostgreSQL/Redis and OpenBao,
not RustFS objects, arbitrary shared volumes, uploaded source, registry images or
ClickHouse archives. No off-site backup is enabled. Keeping the repository and its
encryption key on one host does not protect against loss of that host.

To stop without deleting data: `systemctl --user stop local-paas.target`, then
`sudo systemctl stop local-paas-builder local-paas-worker-{1,2,3}`. Disable those
units/target to prevent boot startup. Remove only this installation's unit files
and reload systemd when uninstalling. Keep firewall rules while any VM is running;
only remove the named `local_paas_builder` / `local_paas_worker_*` tables after all
VMs stop. Preserve `.local` and `/var/lib/local-paas*` until their backups/restores
are verified. No automatic destructive uninstall is provided.

## Reserved endpoints

All host TCP endpoints bind loopback. Do not forward management infrastructure.

| Ports | Purpose |
| --- | --- |
| 5188 / 8080 / 8090 | Dashboard / API / application ingress |
| 12340 / 15000 | mTLS BuildKit / private development registry |
| 18123 / 18200–18201 / 18443 | Dedicated ClickHouse / OpenBao / mTLS node gateway |
| 21000–21003, 21100–21103, 21200–21203 | Worker application forwards |
| PostgreSQL 55432 | Unix socket only, in `.local/socket` |

## Validation status

Verified on 2026-10-24 using a fresh Ubuntu 24.04 x86-64 cloud image in a temporary
VM with nested KVM, 20 GiB RAM and a 160 GiB virtual disk:

- Installed Nix and provisioned the entire stack from a source-only checkout.
  No Lake database, credentials, installed tools or VM state were copied.
- All three authenticated workers, isolated builder/registry, API, static dashboard,
  independent ingress, PostgreSQL, dedicated ClickHouse and OpenBao became ready.
- Uploaded a disposable HTTP Dockerfile, built and recorded an immutable image,
  and deployed two ready replicas on distinct worker nodes.
- Verified the expected application response through independent ingress.
- Rebooted the Ubuntu host, confirmed persistent services/VMs restarted, explicitly
  unsealed OpenBao, and verified the same deployment recovered and served traffic.
- Shut down the temporary qualification host afterward; existing Lake services
  were not used for this deployment.

Local x86-64 validation also includes the pinned Rust/frontend checks, disposable
PostgreSQL integration tests and isolated OpenBao bootstrap/unseal/token-recovery
coverage. Both architecture variants of the infrastructure are Nix-evaluated.
Pinned Node/Bun/PostgreSQL/Redis/RustFS image indexes include ARM64.

CI is configured for native tests on Ubuntu 22.04/24.04 x86-64 and Ubuntu 24.04
ARM64. **A complete native ARM64 installation/reboot drill has not been run here.**
CI has not run remotely before repository publication, and does not boot the four-VM
stack. Other Linux distributions and mixed hardware require their own qualification;
this Ubuntu test does not establish production HA or a general security audit.
