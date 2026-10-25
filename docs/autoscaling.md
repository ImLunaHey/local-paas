# Conservative CPU autoscaling

Configuration → Autoscaling enables a policy on an explicitly stateless HTTP OCI
service. It is disabled by default. Managed databases, celld fleets, singleton
workers, volume attachments and pre-deploy commands are ineligible. Existing
active deployment snapshots must also be eligible. Do not enable this for an app
that owns durable local state or cannot tolerate arbitrary replica shutdown.
One-off and scheduled jobs retain their independent ownership and cleanup rules;
any unfinished job freezes scaling of its parent service.

The provider-neutral policy supports minimum/maximum replicas (0–32 / 1–32), a
CPU target (10–90% of the configured per-replica CPU reservation), separate
scale-out and scale-in stabilization windows, a cooldown and a maximum change of
1–4 replicas per decision. Defaults are 1–3 replicas, 70% CPU, 30 seconds of
sustained high load, 300 seconds of sustained low load, 60 seconds of cooldown,
and one replica per change. The controller evaluates at most once every 15
seconds. Policy edits use operation IDs and optimistic versions.

Scale-out requires utilization above 110% of the target; scale-in requires less
than half the target. Within that dead band the count is retained. The CPU-derived
recommendation is `ceil(current replicas × utilization / target)`, limited by
policy bounds. Stabilization observes consecutive evaluations in the same
direction, not a single spike. A gap over 30 seconds resets stabilization.
Cooldowns, direction, timestamps, desired counts and decisions live in PostgreSQL.
Concurrent controllers use the same transaction lock as placement and deployment;
a restart cannot refund a cooldown or duplicate a committed evaluation.

Every running replica must have a ready observation and CPU measurement less
than 15 seconds old, on a node seen within 30 seconds. Missing CPU is unknown,
never zero. Node/agent/report delay adds to the control loop delay. Host CPU is
not a workload scaling signal. An unavailable metrics source freezes changes
and resets stabilization; this may leave a busy service underprovisioned until
observations recover. Memory, latency and predictive signals are not implemented.

## Placement, rollouts and safety limits

Scale-out reserves slots through the regular scheduler. Allocatable CPU/memory,
organization ownership, existing reservations, stopped-slot route quarantine,
capabilities, distinct-node
placement, cordon and drain state all apply. Optional allowlists match enrollment
node names and physical `failure_domain` labels. The default placement preference
uses less occupied physical domains first. It is a preference, not a guarantee;
three colocated worker VMs still share one physical failure domain.

New replicas inherit the active immutable revision, configuration and pinned secret
references. They receive no ingress or private traffic until the agent certifies
stabilized readiness. A failed start or 180-second readiness deadline stops the
candidate and latches automatic scaling; save the policy again or deploy to clear
that latch after cleanup. There is no automatic retry storm.

Scale-in removes routing first, waits 20 seconds for short route leases to expire,
then requests shutdown. The slot remains reserved until authenticated cleanup.
Normal scale-in does not promise to finish every existing application request;
applications must handle graceful shutdown. A new scale action waits for previous
starts, drains and cleanup. Relocations and rollouts also pause scaling. A rollout
uses the current policy-controlled count (at least one for a new revision),
clamped to the policy, and reserves its entire candidate set. It cannot start
until prior scaling/relocation/job cleanup has completed. This bounds rollout
surge to one additional candidate set, at most the policy maximum, and the global
budget must accommodate it. No rolling incremental rollout is implied.

The `scaling_limits` singleton is a local operator control, intentionally outside
organization-editable service policies. Defaults permit 16 enabled policies and
cap occupied reservations at 64 instances, 16000 millicores and 32768 MiB. Counts
include fixed services, jobs, old revisions and cleanup-pending instances.
Autoscaling, autoscaled rollouts and relocations check these budgets; unrelated
fixed-replica deployments retain their existing placement contract. They can
consume the remaining budget and block scaling. These are reservation ceilings,
not measured host headroom or quotas on application connections. Size policies
for database connection pools and other backing-service limits as well.

A host operator can change the singleton in PostgreSQL, for example:

```sql
UPDATE scaling_limits
SET enabled = false
WHERE singleton;
```

This pauses new automatic changes and autoscaled rollouts/relocations. Already
committed starts/drains finish safely. Lowering a ceiling does not evict workloads.
Turning a per-service policy off freezes its count; deploying with the policy off
uses the configured fixed replica count again. Explicitly stopping a deployment
leaves it stopped, including when a policy or a wake request exists.

## Sleep and cold starts

A minimum of zero additionally requires CPU at or below 1% of the reservation,
no ingress requests or open response/WebSocket streams for the idle timeout
(default 600 seconds, minimum 300), and the normal scale-in stabilization window.
Ingress heartbeats must remain fresh. With no registered route or unavailable
independent ingress, scale-in of a zero-minimum service freezes. A long-lived
stream refreshes activity until it closes. CPU idleness is not proof that hidden
background tasks are safe to stop; applications must explicitly tolerate this.

Only registered preview/domain HTTP routes activate sleeping services. The first
request records a durable, coalesced wake request and receives **503 with
`Retry-After: 5`**. Browser GET navigations accepting HTML show a **Waking up
service** page. It polls ingress readiness every five seconds and reloads the
original URL (including its path, query and fragment) once a healthy, unexpired
route is available. These HEAD probes use `X-Local-Paas-Wake-Check: 1` and never
reach the application on registered authorities; only a 204 with
`X-Local-Paas-Wake-Status: ready` triggers the reload. Pages and probes are not
cached. Without JavaScript the page refreshes every five seconds instead.

API calls, non-navigation fetches and form submissions keep the plain 503
response. There is no queue, body persistence or automatic replay of submissions.
Clients must retry with their own appropriate idempotency rules. Unknown authorities
cannot wake services. Further requests return 503 until a ready backend is
published; cold start includes the evaluation delay, image preparation and
readiness stabilization. The first ready replica may take minutes, and exhausted
capacity or failed startup can prevent recovery entirely. Wake-up bypasses the
CPU stabilization/cooldown, but never capacity, cleanup or readiness checks.

### Custom waking pages

Each eligible service can edit its waking page in **Configuration → Autoscaling
→ Waking page**. The CodeMirror editor follows the dashboard's light/dark theme,
with HTML/CSS highlighting, line numbers, search and undo. Start from the
dashboard-themed template or import a UTF-8 HTML file (maximum **128 KiB**).
The live preview expands template variables as you type and offers a mobile
width. Edits and imports remain local until **Save waking page**; **Discard
edits** returns to the saved version. **Download HTML** exports the current draft,
and **Restore default page** removes the saved custom template. Updates
are version checked, idempotent and audited in the same PostgreSQL transaction.
Audit records contain size and a content hash, never the uploaded document.
Ingress picks up changes on its next successful refresh, normally within two
seconds. Both preview and custom domain routes use the service's page.

Templates are public application content. Do not include secrets. They are
returned as JSON to the dashboard. The editor's preview uses an isolated, inert
iframe with no script, form, navigation or same-origin permissions and a
restrictive CSP; readiness polling is omitted. It cannot access dashboard
cookies or execute uploaded code. The live page is served from application
ingress. Use inline CSS, SVG, and data URLs for
images/fonts; the sleeping application's assets and external assets are not
available to the template. Scripts require the per-response nonce below.

| Variable | Replacement |
| --- | --- |
| `{{service_name}}` | HTML-escaped service name; use in text or quoted HTML attributes, never JavaScript/CSS |
| `{{retry_after_seconds}}` | Readiness polling interval, currently `5` |
| `{{readiness_script}}` | Platform-owned polling, reload and no-JavaScript refresh code |
| `{{csp_nonce}}` | Fresh CSP nonce; use `nonce="{{csp_nonce}}"` on custom inline scripts |

Include `{{readiness_script}}` **exactly once**, on its own immediately before
`</body>`, outside comments, attributes and other tags. Unknown or unclosed
template variables are rejected. Values are substituted in one pass, so a
service name cannot introduce more template variables. Give an optional text
element the `data-waking-status` attribute to receive the longer-startup message.
The readiness script works even if that element is omitted. It checks the
original URL without calling the application and only reloads after the ingress
reports a healthy route. Custom scripts must not interfere with this behavior.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{service_name}} is waking up</title>
    <style>body { font-family: system-ui; padding: 3rem; }</style>
  </head>
  <body>
    <h1>Welcome to {{service_name}}</h1>
    <p data-waking-status>Starting up. Checking every {{retry_after_seconds}} seconds…</p>
    {{readiness_script}}
  </body>
</html>
```

The management API is `GET/PUT /api/services/{id}/waking-page`, with the same
organization scoping and service read/update permissions as other service
configuration. PUT accepts `operationId`, `expectedVersion`, and `html` (string,
or `null` to reset). GET returns `version`, `html`, and `starterTemplate`. HTML
is limited independently of the bounded JSON request body. Migration
`0032_waking_pages.sql` stores templates and idempotency metadata.

### Private dependencies

Private TCP service discovery has no HTTP activator. Policies with a zero minimum
are rejected for targets of configured or active private connections, and new
private connections to such services are rejected. Use a minimum of at least one
for private dependencies. This does not provision a public edge or external
capacity, and does not promise elasticity beyond available physical resources.

## API, history and verification

`GET /api/services/{id}/scaling` exposes the policy, version, ready/desired counts,
limiting condition, global limits and the latest 20 evaluations. Each evaluation
includes the recommendation, CPU (null when unknown), applied count, reason and
additional placement capacity estimated at that time. Capacity excludes operator
budget and placement violations, but is not a promise of future availability.
`PUT` accepts `{operationId, expectedVersion, policy}`; version zero creates a
policy. Service update permissions and organization scoping apply to both routes.

Evaluations are retained for seven days. Policy changes, applied decisions,
condition transitions and failed starts have transactional audit events retained
under the normal audit policy. Desired state never commits without its decision
and audit event. Back up the new tables with the rest of the control-plane DB.

Disposable PostgreSQL tests use controlled CPU/load observations and actual
scheduler, ingress, policy API and audit code. They exercise scale-out/scale-in,
concurrent evaluation, cooldown persistence through a fresh connection, stale
metrics, policy retries, capacity limits, rollout exclusion, startup failure and
cold-start HTTP behavior. These are repeatable control-loop load simulations,
not a live VM throughput qualification. A real workload/VM load drill remains
necessary before enabling a policy on an operator's applications; this change
does not provision or mutate that infrastructure.
