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

Runtime qualification is in progress: unit, SQL and browser tests validate the
model and UI; database engines and shared filesystem access require VM smoke and
persistence tests before this is treated as usable production storage.

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
health-gated active deployments; database data backup/restore drills remain open.
PostgreSQL's pinned entrypoint directs its initialization client to the explicit
/tmp socket, matching the hardened container's writable tmpfs layout.

References: https://docs.rustfs.com/en/security-compliance/iam and
https://docs.rustfs.com/en/operations/status-check.
