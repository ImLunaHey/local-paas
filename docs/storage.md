# Development storage

Services inherit their project and environment from the workspace. The breadcrumb
switches environments; creation forms do not redefine that identity.

PostgreSQL and Redis use pinned images built in the isolated builder, managed
OpenBao passwords, and node-owned fixed-size ext4 volumes. Database connections
are explicit: the platform writes DATABASE_URL or REDIS_URL into the application's
OpenBao path and grants that deployment access only to the database's private
endpoint. Redeploy the application to adopt the connection. Old workers cannot
receive database or shared-volume assignments until they advertise support.

Shared application volumes are independent resources in a project environment.
Multiple services can attach the same volume at different absolute data paths,
read/write or read-only. The first deployment assigns its owning worker; all
subsequent attachments are colocated there. This is a shared local filesystem,
not cross-node or replicated storage. Apps must coordinate concurrent writes.
Each attached service has one replica and must confirm its old instance stopped
before deploying again. Other services sharing the volume continue running.
Unknown or disconnected instances cannot release that single-writer fence.

Volumes are retained when services stop or detach. Shadowing an environment does
not copy volume attachments or contents. Managed database volumes are private to
the database; share database access through connections, not its raw data files.

The development workers currently allow 1–2 GiB per volume, with an 8 GiB aggregate
reservation ceiling per worker. Backing files are fully allocated before use,
mounted nodev/nosuid/noexec, and persist on worker NVMe virtual disks. No data is
placed on Lake's ZFS array. A volume is not a backup. Automatic backups, expansion,
delete/restore workflows and physical-worker failover remain unimplemented.

Development qualification includes real VM deployments, shared read/write and
read-only filesystem access, and a worker stop/start with byte-for-byte file
retention. The three VMs still share one physical failure domain. Production
backup automation and loss-of-host recovery are separate release gates.

## RustFS and the Storage tab

RustFS is a distinct managed service using the official 1.0.3 image pinned by
SHA-256 digest. Its console is disabled and its API is reachable only through
private worker endpoints. This single-node deployment has no hardware redundancy.
It is not a qualified object store for celld fleets.

Create buckets on the RustFS service's Storage tab, then attach them from an app's
Storage tab. Each app receives its own IAM identity and bucket-only policy, with
read-only or read/write access. S3_ENDPOINT, S3_BUCKET, AWS_REGION,
AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are delivered through OpenBao.
Configure clients for path-style S3 requests. Redeploy to adopt the attachment.
Detaching revokes the app identity immediately and retains bucket contents.

Browse files uses that app's restricted identity. Listing is paginated; downloads
are attachments, never inline HTML. Upload/download currently support 16 MiB per
file. Conditional uploads refuse to replace existing keys. The frontend receives
no credentials. Upload/download actions are audited without file contents.

Live development checks passed for RustFS bucket isolation, denial of admin APIs,
object upload/download and conditional-write conflicts, and object retention
through a confirmed stop and replacement deployment. Redis and PostgreSQL reached
health-gated active deployments. The disposable PostgreSQL dump/restore and
Redis key export/restore drills below have passed.
PostgreSQL's pinned entrypoint directs its initialization client to the explicit
/tmp socket, matching the hardened container's writable tmpfs layout.

References: https://docs.rustfs.com/en/security-compliance/iam and
https://docs.rustfs.com/en/operations/status-check.

## Database inspection

PostgreSQL and Redis services open in a dedicated database workspace. PostgreSQL reports
database size, connections, cumulative transaction counters and buffer cache hits.
Its TanStack tables list application relations and expose columns, types,
nullability, primary keys and index metadata. Row counts are catalog estimates;
partition sizes are per relation, not recursive. Inspection returns at most 200
tables, 1,600 columns for a selected table and 100 indexes, with truncation notices.

Redis reports memory, clients, command rate, cache hits, keyspaces, eviction and
persistence counters through fixed INFO sections. No key scan or value read runs.
The browser polls every 15 seconds and retains a visibly dated snapshot on error.

Inspection reads the existing managed credential from OpenBao, connects only to
an allocated healthy worker endpoint, and never exposes the password or raw engine
errors. PostgreSQL connections default to read-only transactions with a catalog-only
search path, two-second statement timeout and 500 ms lock timeout. Both engines
have an eight-second overall deadline and share a four-request concurrency cap.
There is no arbitrary SQL or database editing API in this increment.

## Shared-volume file browsing

An attached app exposes **Browse files** once its volume has an owner. Browsing
uses outbound authenticated worker polling, separate from workload heartbeats.
Only the owning worker can claim or complete an operation. Attachment scope and
version are checked before dispatch and before returning a result. Read-only
attachments reject uploads on both controller and agent.

The Linux agent uses fd-relative openat2 confinement, disallows symlinks and
nested mount traversal, and reads regular files only. Uploads use an unnamed
staging inode and atomic create-only publication; existing paths are never
replaced. Files use the workload's mapped UID/GID. Workloads must coordinate
concurrent writes; downloads are not filesystem snapshots.

Transfers are capped at 16 MiB, with four concurrent browser requests and a
20-second RPC deadline. Listings inspect at most 10,000 entries and return 200
per page. Payloads remain in memory and are excluded from audit/database records.
The broker is intentionally ephemeral: a controller restart interrupts transfers
without stopping workloads. After an uncertain upload, refresh before retrying;
create-only publication prevents a retry from overwriting a completed file.


## Reproducible recovery drills

Opt-in Rust tests in `crates/control-plane/src/backup_drills.rs` reject any service
outside the `platform-storage-canary` project. Set `DATABASE_URL` for the platform,
`OPENBAO_ADDR`, `OPENBAO_CA_FILE`, and `OPENBAO_TOKEN_FILE`, plus the explicit
`PLATFORM_DATABASE_SMOKE_POSTGRES` and/or `PLATFORM_DATABASE_SMOKE_REDIS` service IDs.
No credential values belong in shell arguments or test logs. Then run:

`cargo test -p control-plane --lib backup_drills -- --ignored`

The PostgreSQL test inserts a unique marker, makes a custom-format `pg_dump`,
removes the source marker, restores into a new database, verifies its content,
and removes the restored database and temporary archive. The archive is in a
private temporary directory. Tool paths default to NixOS's system binaries;
`PLATFORM_PG_DUMP` and `PLATFORM_PG_RESTORE` can supply absolute paths elsewhere.
This tests a database dump; role/global configuration recovery and off-site backup
retention are not covered.

The Redis test exports one expiring canary key with DUMP, deletes it, uses RESTORE
under a new name, compares its value, and removes the fixture keys. This verifies
logical key recovery, **not a consistent whole-database RDB/AOF restore**. Full
Redis disaster recovery remains a production gate.

`web/tests/storage.spec.ts` checks file export/reupload under a new name for S3
and shared volumes, content equality, create-only uploads, and read-only access.
Supply `E2E_BUCKET_SERVICE_ID`, `E2E_VOLUME_WRITER_ID`, and `E2E_VOLUME_READER_ID`
for disposable fixtures. A manual worker-2 stop/start additionally confirmed both
shared app processes read the same retained file after their volume remounted.
File-level export is not a filesystem snapshot or a complete bucket backup.

These drills passed on 2026-10-24. They do not provide scheduled backups,
off-site copies, backup browsing, or a product restore workflow.
