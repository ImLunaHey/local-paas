# Workspace overview and host telemetry

The homepage (`/`) lists the latest twelve deployments and eight builds across
projects, with links to service history and build logs. Counts use live node and
instance leases. Projects now live at `/projects`; `/hosts` shows the machine
running the control API and enrolled worker reservations. Cmd/Ctrl+K searches
projects, services, and navigation actions. Project settings support optimistic
name changes without changing IDs, secret paths, or historical snapshots.

The Rust API samples Linux `/proc` and `/sys/block` every five seconds, retaining
180 samples in memory. Missing measurements are null, counter resets produce gaps,
and CPU accounting excludes guest counters already included in user/nice totals.
Memory used is total minus available. Root filesystem space is measured with
statvfs. Disk throughput sums nvme/sd/vd block devices, excluding partitions;
network throughput sums non-loopback interfaces and may double-count tunneled
traffic. These are whole-host measurements, including unrelated services and VMs.
They do not establish ZFS health or measure ARC separately. Host history resets
when the API restarts and is not yet archived to ClickHouse.

Worker rows show scheduler capacity and occupied reservations, not VM resource
consumption. The initial workers remain one physical failure domain. Service-row
sparklines use the existing runtime metrics API and sum currently reporting
instances. TanStack Charts provides the graphs and shared dark tooltips.

Networking offers an automatic private URL allocation. The API serializes
allocation in PostgreSQL, preserves an existing URL when enabled again, and
rejects exhaustion without changing service configuration. An app's container
port is independent of the platform-managed HTTPS port. Custom public domains
use the separate acknowledged edge lifecycle on the Domains page.

The global `/domains` registry stores normalized hostnames and one optional web
service assignment per hostname. Project/environment selection determines the
service; assignments can move between projects without re-registering the domain.
Updates use optimistic versions and committed audits retain the previous and new
service IDs. `EDGE_CNAME_TARGET` may supply the shared CNAME destination once the
edge is provisioned. Each card shows its TXT ownership record, desired and
acknowledged generations, certificate expiry, lease expiry and actionable pending
or failure states. The edge worker verifies DNS, updates Caddy through its API,
and observes TLS and route health; saving an assignment never claims success.
DNS-provider writes remain explicit operator work. Registry
assignments are separate from current private Tailscale URLs and legacy manifest
domain declarations.
