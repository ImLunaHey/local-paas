# Projects, secrets and auditing

Projects are the top-level workspace resource. Each has its own environments;
new projects start with `production` and `development`. Service identity is the
project/environment/name tuple. Switching environments shows only that scope.

Creating an environment with `parent_id` copies the source service specifications,
with new service IDs and empty domains. It does not build, deploy, copy database
contents, or copy running instances. Configuration is copied at creation; secret
references and values are resolved through the ancestor chain when deploying.
Only environments in the same project may be sources, with at most eight ancestors.
Local secret values override inherited names; removing an override exposes the
inherited value again. A deployment pins the resolved bundle so subsequent parent
changes cannot alter its secrets.

## Dedicated OpenBao

`infra/services/start.sh` provisions separate platform service storage on NVMe.
OpenBao listens only on verified HTTPS at `127.0.0.1:18200`; ClickHouse has its own
platform-only instance at `127.0.0.1:18123`. Existing Lake ClickHouse is untouched.
No production data is placed on ZFS.

Explicit development initialization/unseal:

```sh
cargo run -p control-plane --bin initialize-openbao -- "$PWD/.local/platform-services"
```

The command saves credentials privately and prints no values. It initializes
three unseal shares with a two-share threshold and a limited renewable controller
token. Recovery material is currently colocated in a mode-0600 development file;
this does not provide independent recovery custody or an off-site backup.
After restarting sealed OpenBao, run this command to unseal it. Auto-unseal and
production recovery procedures remain release gates. The controller renews its
24-hour periodic identity hourly; extended downtime may require identity renewal
through the private recovery procedure.

Values live in KV v2 at `platform/data/workloads/<environment-id>/<service-id>`.
Deployment bundles live under that exact workload's `/snapshots` path. PostgreSQL
stores only names and versions. KV retains up to 1,000 versions per path; rollback
to evicted versions is not guaranteed. Deployment cannot proceed with missing
referenced values.

The Secrets tab accepts values through an uncontrolled password input. Values do
not enter React state or TanStack mutation variables/caches; the API returns only
metadata. Browser secret endpoints send `Cache-Control: no-store`. Updates use
compare-and-set versions. The external OpenBao write and PostgreSQL metadata
transaction cannot be one atomic transaction: a write may survive a DB failure.
Reload repairs version/name metadata; retry the intended update after reloading.

Agents request secrets using their authenticated node identity and current
assignment generation. The controller issues a one-read, 60-second OpenBao token
restricted to that workload's snapshot path, consumes it, and delivers only the
pinned bundle over the private mTLS connection. No broad OpenBao credential reaches
a node or workload. This currently brokers identities through the controller;
direct workload-to-OpenBao authentication is not implemented.

Each workload receives private read-only files under `/.platform-secrets`, plus
process environment injection by a static Rust launcher. The launcher preserves
the image's original entrypoint and command. Values are absent from OCI layers,
container metadata and persistent workload disks. Secret-bearing logs stay in
worker tmpfs before exact-value redaction and forwarding. Redaction is best effort:
applications must not log transformed/encoded secrets. Cleanup overwrites and
removes the secret files after stop. An agent restart can reuse the surviving
private tmpfs; a VM restart obtains the pinned bundle again.

## Audit and runtime history

`GET /api/audit` returns newest-first cursor pages with action, actor, outcome,
project, environment and time filters. The UI uses TanStack Table v9; filters live
in column headers, apply automatically and query the full server history. Rows
expand to show the target, action correlation ID and approved metadata.

Mutating product actions record `requested` followed by `succeeded` or `failed`.
Database triggers record committed changes in the same transaction. Metadata is
allowlisted: no request bodies, specifications, secret values, raw runtime errors
or credentials. Polling, health checks, HTTP access requests and agent heartbeats
do not create audit entries. Historical HTTP entries are excluded from the API,
while append-only storage is preserved. Audit inserts fail closed before an action
when storage is unavailable; an outcome-write failure leaves the original intent
entry for investigation. SQL UPDATE/DELETE are rejected for audit rows (database
administrators are still trusted and can alter that protection).

Human actions currently identify `private API caller`; individual authenticated
administrator accounts are not yet implemented. Agent actions identify the node.
Existing events imported into the audit stream are labelled historical/unknown.

Runtime log timelines include deployment and actual process-start/restart markers.
Repeated agent observations do not create duplicate markers. Activity retains old
instance links, including stopped deployments, and shows concise failure messages
with expandable technical details. Logs already archived in the dedicated
ClickHouse instance have no configured TTL; this is retention, not a backup or a
promise of lossless collection. See the observability documentation for collection
limits and outage behavior.

## Verification

Disposable PostgreSQL tests cover scoped shadowing, failed shadow attempts,
append-only audit records, filtering, and absence of HTTP/polling entries. With
`OPENBAO_ADDR`, `OPENBAO_CA_FILE` and `OPENBAO_TOKEN_FILE` set, the secret test writes
random canary values to dedicated paths, verifies inheritance and overrides,
checks older snapshots remain unchanged, and checks values never enter audit/API
metadata. A real Showcase Studio deployment reached readiness on two workers
using a pinned secret bundle. Browser checks cover header filtering, detail
expansion, retained logs, project controls and desktop/mobile layouts.
# Service creation and domains

Creation starts with a choice of App, Database or Storage, followed by the relevant
form in the selected project and environment. Database offers PostgreSQL and Redis;
Storage offers RustFS.

New application creation includes **05 Secrets** on the same form, with optional
name/value rows. **Create and build** registers the service without a build, saves
all entered values in OpenBao, and only then queues the first build. If a save
fails, the form stays open for retry using the same service and build operation.
Acknowledged values are cleared immediately; pending values remain in password
inputs for retry. Values stay out of specifications, React state and TanStack
mutation/query caches. Once registration succeeds, configuration and secret names
are locked while creation finishes. Existing applications edit values through the
Secrets tab; configuration retains their references automatically.

Service domain controls select from the global Domains registry. Saving configuration
assigns/detaches those domains in the same database transaction. A domain owned by
another service cannot be taken by this control; use explicit reassignment on Domains.
Global reassignment also updates the affected service declarations and versions, so
stale configuration forms cannot overwrite the assignment silently. No public routing
or DNS changes happen until the edge implementation is ready.
