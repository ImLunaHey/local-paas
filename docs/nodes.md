# Nodes and relocation

The Nodes page reports configured allocatable CPU/memory, occupied slots, reserved
persistent storage, heartbeat age and per-instance observations. It does not claim
these are physical host totals. The initial three VMs remain one Lake failure domain.

Cordon prevents placement without stopping applications. Drain also requests
replacement of eligible instances. A node is shown as drained only after all its
instances have acknowledged cleanup. Persistent databases, shared-volume apps,
singleton workers and jobs block drain; the page explains each restriction.
Resume scheduling removes cordon/drain but does not undo an in-flight handoff.

Relocation is disabled by default and enabled per service using **Allow concurrent
replacement**. Enable it only for HTTP applications that tolerate overlapping
copies. It does not promise exactly-once effects. Both the active deployment's
workload and the policy must permit relocation; a volume attachment disqualifies
it. Node loss starts replacement after 45 seconds without a heartbeat. This is an
availability policy for opted-in applications, not fencing of the unreachable VM.

The reconciler creates a new instance of the same immutable deployment, preserving
its pinned secrets and configuration. It excludes the source node and, for distinct
placement, nodes occupied by other replicas. Capacity shortage leaves the original
running and retries placement on subsequent reconciliation. Candidate instances
are excluded from public/private routing and local restart recovery until ready.
After readiness, routes switch transactionally, then a 20-second route-drain window
precedes shutdown. A failing replacement or lost readiness during this window
restores the original route if the original is still desired. This cannot make an
unreachable original healthy.

Old slots stay occupied until authenticated cleanup is confirmed, even after an
unreachable instance has been replaced. A returning agent receives the new stop
generation. A failed candidate stops and blocks automatic retries; **Retry failed
moves** allows another attempt only after candidate cleanup. This avoids an endless
replacement loop. A new deployment or explicit stop cancels unfinished relocations.
Node actions use operation IDs; retries with a different payload conflict. Desired
state, operation records and audit events commit in the same transaction.

Disposable PostgreSQL tests cover concurrent reconciliation, duplicate operations,
opt-in policy, lost heartbeats, blocked stateful workloads, placement shortage,
stale readiness, failed candidates, cancellation, and resumption from a fresh
controller connection. Live VM/network drills are explicitly opt-in development
operations and must not target unrelated workloads.
