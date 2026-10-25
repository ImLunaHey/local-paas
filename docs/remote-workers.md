# Remote workers

The platform can connect up to four additional Linux hosts as worker nodes 4–7.
Each host runs one isolated NixOS worker VM and uses the same agent protocol,
scheduler, cordon/drain, logs, metrics and secret-delivery paths as local workers.
The VM has 2 GiB RAM, one vCPU, four workload slots and a 16 GiB virtual disk.
Reserve additional host resources for Linux, compilation and image/volume growth.

This is an operator-driven setup, not automatic network enrollment. Both hosts
must already have reachable private IPv4 addresses over Tailscale, NetBird or
another trusted encrypted network. The setup does not install either VPN, expose
public listeners, run workloads directly on the host, or provision a public edge.
Use the same repository revision and native CPU architecture on all hosts. Mixed
architectures and cross-builds are not supported yet.

## Transport and trust

A separate stunnel link uses TLS 1.3 and distinct, pinned certificates for each
controller/worker pair. Both sides authenticate their peer. The agent still makes
outbound HTTPS requests with its own certificate and node token; the controller
never uses SSH to operate workloads. SSH/SCP may be used once by the operator to
transfer a bundle.

The link forwards a fixed set of platform ports, not arbitrary host destinations:

- Outbound agent sync, secret delivery, logs/metrics and file operations.
- Pull-only registry access through a separate Caddy endpoint. Only GET/HEAD
  under `/v2/` are allowed; uploads, deletes and unrelated paths are rejected.
- Inbound declared workload ports for ingress, database tools and backups.
- Private service/database/storage connections routed through the controller.

Plaintext endpoints bind to loopback. Worker VM firewall rules continue to deny
NAS/LAN access; individual workloads receive only their explicit connection grants.
A root-compromised node remains a trusted platform member with access to forwarded
service endpoints: this is not an untrusted multi-tenant node enrollment system.

The controller is a data-plane hub and a single point of failure. Remote hardware
adds a physical failure domain but does not make the control plane, registry or
routing highly available. Volumes remain pinned to their owning node; a shared
volume cannot be mounted by services on different nodes. The scheduler's
`distinctNodes` constraint does not enforce distinct physical hosts.

For node index `N`, the controller listens on its configured private address at:

- `30000 + N*100`: agent gateway;
- `30001 + N*100`: read-only registry;
- `30010 + N*100` through `30037 + N*100`: slot relays for the other nodes,
  excluding this worker's four offsets.

The worker listens on its configured private address at `30040 + N*100` through
`30043 + N*100` for its four workload slots. For node 4 these are controller
30400, 30401, 30410–30421 and 30426–30437, and worker 30440–30443. Allow these TCP
ports only between the named peers in VPN ACLs and host firewalls. Do not forward
these ports from the Internet. Bind failures fail startup; the installer never
reconfigures an unrelated listener or firewall.

## Prepare on the controller

First upgrade the controller and **all existing workers** to this revision using
the documented maintenance process. The updated agent and host firewall recognize
slots 4–7. Rebuild/restart existing worker VMs during a maintenance window; running
old agents do not gain the new port policy automatically. Apply database migrations
with `make migrate`. Preserve all existing node credentials and VM disks.

Create `.local/remote-worker-4.json` with non-secret settings:

```json
{
  "index": 4,
  "name": "worker-4",
  "failureDomain": "physical-host-b",
  "controllerAddress": "100.64.0.10",
  "workerAddress": "100.64.0.20",
  "controllerRoot": "/home/operator/local-paas",
  "workerRoot": "/home/operator/local-paas"
}
```

Use the real checkout paths and private addresses. Reserve a unique index 4–7
for each remote node. Use the same failure-domain label for nodes sharing a
physical host. Labels are metadata, not a hardware detection mechanism.

```sh
nix develop
nix build .#default --out-link .local/host-tools
cargo build -p platform-remote-worker -p control-plane --bins
cargo run -p platform-remote-worker -- prepare .local/remote-worker-4.json
```

Preparation creates `.local/remote-workers/4/controller` and `worker` with private
permissions. It signs the agent certificate using the existing worker authority;
the authority's private key is never copied into the remote bundle. Preparation
refuses to overwrite an existing bundle. An interrupted preparation leaves no
usable enrolled node and can be retried. No database mutation, VM startup or
network listener occurs during preparation.

Transfer **only the `worker` directory** over an authenticated confidential channel
to `<workerRoot>/.local/remote-workers/4/worker`. Preserve permissions, and ensure
`.local/remote-workers` and its node directory are mode 0700. Never commit, paste or
publish these bundles: the worker bundle contains private credentials and its ISO.
Do not copy the controller checkout's `.local` directory.

Install controller link services and enroll using the controller's database URL:

```sh
cargo run -p platform-remote-worker -- install controller .local/remote-workers/4/controller
# DATABASE_URL must refer to this installation's controller database.
cargo run -p control-plane --bin enroll-node -- .local/remote-workers/4/controller/enrollment.json
sudo loginctl enable-linger "$USER"
```

Enrollment is transactional, audited and retry-safe. It refuses conflicting node
identities, names, capacity or endpoint ranges. A remote node starts **cordoned**.
Repeating enrollment preserves its subsequent maintenance state.

Prepared nodes are platform-owned by default. To dedicate a node to an
organization, add its opaque authentication organization ID as
`organization_id` in the controller copy of `enrollment.json` before enrollment.
The control plane verifies that the organization exists. Organization-owned
nodes are visible and manageable only by that organization and can run workloads
for that organization; platform-owned capacity remains hidden from tenants.

## Install on the remote host

Use a dedicated operator account with sudo on systemd Linux, cgroup v2 and KVM.
Install Nix and Git as described in [installation](install.md), then check out the
**same commit** at the exact `workerRoot` path in the plan. Plan for at least
4 GiB available RAM and 40 GiB free SSD/NVMe for the worker installation, with
additional headroom for compiling Rust/Nix outputs and retained application data.
Check `/var/lib` separately if it is on another filesystem.

Do not run `make setup-install` here; that provisions a complete controller stack.
After transferring the worker bundle:

```sh
nix develop
nix build .#default --out-link .local/host-tools
cargo build -p platform-remote-worker -p control-plane --bins
bash infra/workers/build.sh 4
cargo run -p platform-remote-worker -- install worker .local/remote-workers/4/worker
cargo run -p control-plane --bin platform-setup -- remote-worker 4
sudo loginctl enable-linger "$USER"
```

The remote command creates only worker 4's isolated VM account (UID 61004), disk
directory, credentials, egress firewall and persistent system service. It does not
create PostgreSQL, OpenBao, ClickHouse, a registry, a builder or additional VMs.
Link processes run as persistent user services; the VM and its firewall run as
system services. They are independent of terminals and coding-agent sessions.
On NixOS, newly generated units must not conflict with declaratively managed units;
if a unit already exists, reconcile it through that host's configuration first.

Check on both hosts:

```sh
systemctl --user status local-paas-remote-4-link
# Controller only:
systemctl --user status local-paas-remote-4-registry
# Worker host only:
sudo systemctl status local-paas-worker-4 local-paas-worker-4-firewall
```

Wait for an authenticated heartbeat on the Nodes page. Check the node name,
allocatable capacity and physical-host label, then select **Resume scheduling**.
Deploy a disposable canary to that node (cordon other nodes for the test if
necessary, after reviewing pending deployments). Verify a real image pull,
readiness, preview response, retained logs and metrics. Exercise a private
connection and the storage/database paths you intend to use before migrating data.

Test a link interruption, agent restart and host reboot. Verify the node becomes
unavailable, opted-in stateless relocation follows existing lease rules, and the
returning agent reconciles without duplicating singleton work. Gracefully drain
before planned VM/host shutdown; persistent workloads and jobs can block drain.
Do not describe a heartbeat alone as successful end-to-end installation.

## Renewal, revocation and removal

Monitor certificate expiry with `openssl x509 -in FILE -noout -dates`. Link
certificates last 365 days. Agent certificates last 14 days and are additionally
limited by the existing worker authority's expiry; the local development authority
and gateway certificate initially last only 30 days. Automated rotation is not
implemented. Do not disable verification to work around expiry.

Renew agent certificates with the same node identity using the controller's worker
CA, rebuild the credentials ISO, and replace it during a drained VM maintenance
window. For link certificate rotation, distribute the new peer certificate before
switching identities, restart both link services, verify both directions, then
remove old trust. Keep the token/node ID and workload disks; `prepare` intentionally
does not rotate an enrolled identity. See [stunnel authentication and rotation](https://www.stunnel.org/auth.html).

For revocation, stop and disable this node's controller link service immediately,
then revoke its agent token through the audited operator command:

```sh
systemctl --user disable --now local-paas-remote-4-link
cargo run -p control-plane --bin enroll-node -- revoke NODE_UUID
```

This invalidates subsequent sync/secret/file requests and removes routing freshness.
It does **not** prove remote processes have stopped. Fence or shut down the remote
host before replacing side-effecting singleton workloads. Never reuse the node's
index/identity or erase its disk while allocations or pinned volumes remain.
For planned removal, drain first, stop the worker VM and both link services, and
preserve any required state before explicitly deleting local artifacts.

## Validation status

Automated tests exercise real mutually authenticated stunnel connections in both
directions, wrong-client and plaintext rejection, real Caddy registry method/path
restrictions, private bundle generation, idempotent enrollment, concurrent endpoint
reservation and audited revocation. These tests use disposable loopback endpoints
and PostgreSQL, not installation credentials.

A two-physical-host installation, VPN partition/recovery, remote reboot and native
ARM64 remote deployment still require a real-host drill. No remote machine was
available for this implementation. The installation procedure is available for
that qualification; it is not a claim that those drills have passed.
