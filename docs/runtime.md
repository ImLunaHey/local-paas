# Runtime implementation

The control plane persists deployments and node assignments in PostgreSQL. A
transaction-scoped advisory lock serializes placement and promotion. Deployments
snapshot the current runtime configuration and reference an immutable image
revision. Retry operation IDs return the original deployment. celld and workloads
with secret references are rejected until their dedicated execution paths exist.

Enrolled nodes have stable UUIDs, individual hashed bearer credentials, fixed
allocatable resources and four or fewer slots. The versioned outbound agent
protocol carries desired assignments, generations, health, logs and measurements.
The intended transport is mutual TLS over the private network. Node reports are
accepted only for allocations owned by that node at the current generation.
Agents retain healthy containers if the controller becomes unavailable.

Candidates must all report stabilized readiness before promotion. The ingress
selects only fresh ready instances in the active deployment. Promotion changes
that set transactionally, then asks agents to stop the old instances gracefully.
A failed candidate is stopped while the previous active deployment remains.
Explicit stop removes routing immediately and increments assignment generations.
Slots remain reserved until cleanup is acknowledged. This initial scheduler does
not automatically move allocations from lost nodes; they recover on that node.

Runtime logs are deduplicated by instance and entry identity, limited to 512 KiB
per instance. Metrics are retained for one hour; the UI query exposes the most
recent 15 minutes. CPU and memory measurements describe application cgroups,
not configured limits. Stale nodes and observations are excluded from ingress.

The private preview proxy listens on loopback port 8090, accepts only authorities
registered in `preview_routes`, and supports HTTP requests up to 8 MiB with a
60-second upstream timeout. It does not yet support WebSocket upgrades. Public
edge routing, production authentication, backup/restore and fleet management
remain separate release gates.
