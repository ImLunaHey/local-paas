# Log history and workload metrics

The platform uses its own pinned ClickHouse process, data directory and credentials.
It does not connect to, configure, or reuse Lake's existing ClickHouse instance.
The dedicated HTTP listener is 127.0.0.1:18123; data is on NVMe under the ignored
.local/platform-services/clickhouse directory. infra/services/start.sh provisions
this instance and a separate OpenBao listener. Neither is exposed through Tailscale.

Runtime log ingestion first commits to PostgreSQL. An independent worker batches
rows into ClickHouse, then marks them archived. Retries deduplicate by service and
sequence using ReplacingMergeTree and FINAL reads. A separate PostgreSQL key index
prevents repeated agent tails from re-inserting entries after cache eviction.
Only acknowledged PostgreSQL copies older than 24 hours are pruned. Pending logs
are retained during ClickHouse outages. UI status shows pending rows and physical
archive size, and explicitly reports archive failures instead of claiming a full
history search succeeded.

There is no ClickHouse TTL or automatic archive expiry. This means retained until
explicit deletion or storage loss, not infinite capacity or an off-site backup
guarantee. Monitor NVMe capacity, queue growth and service health. Both database
backup/restore and an off-site destination remain required for production.

JSON object lines retain their original text and fields. Common string severities
and Pino numeric levels are normalized; stdout/stderr remain independent streams.
Plain text and JSON without a recognized level stay unclassified. Queries support
text, severity, stream, instance, date range and nested JSON scalar equality.
Queries are parameterized in both PostgreSQL and ClickHouse. History pagination
and live following use sequence cursors; the browser holds at most 5,000 rows.

The current node transport is still a bounded rotating-log tail, not a lossless
collector: sustained output faster than its polling window or an extended node
disconnection can exceed local retention. Archival cannot recover output already
lost before ingestion. Build logs remain a separate pipeline.

Metrics include CPU, memory, PIDs, block-device read/write rates and network RX/TX
rates from each application's cgroup and network namespace. Counter resets are
discarded. Unsupported/stale measurements are null, not fake zeroes. Combined
charts sum recently reporting instances; instance selection shows an individual
allocation. Combined coverage is visible and includes rollout candidates while
they execute. Block I/O excludes cached and tmpfs-only activity; network usage
excludes loopback and includes readiness probes.

Checked with Rust formatting, Clippy, unit tests, disposable PostgreSQL integration
tests, frontend compilation and real browser checks through Tailscale HTTPS.

The runtime log view applies filters automatically (text input waits 250 ms), with
sticky column headings and expandable structured fields. JSON keys such as `event`
and `elapsed` become columns automatically; recognized severity and message fields
use their existing columns. Plain stdout/stderr text remains in Message. Missing
fields display a dash; objects and arrays use compact JSON. The table shows up to
12 additional fields and scrolls horizontally on narrow screens. Expanding a row
retains every field, the original output, and nested scalar filter actions.
Activity lists paginated
deployment history and links to an instance's archived logs using a `?instance=`
URL; this does not require the container or node to still exist. Retention limits
and pre-ingestion loss limitations described above still apply.

Runtime metrics use TanStack Charts with a shared dark tooltip, available to both
pointer and keyboard users. TanStack Query and Router devtools are available from
the floating launcher in development mode; production builds omit the panels.
