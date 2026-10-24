# Development contract reset

The camelCase API change is a breaking development release. It does not include
legacy field aliases, a second API version or mixed-version agent support.

- JSON fields use camelCase: `operationId`, `schemaVersion`, `cpuMillis`,
  `buildCommand`, `instanceId`, and so on. Rust identifiers and PostgreSQL column
  names remain snake_case. Enum values such as `oci-service` and `timed_out` are
  unchanged.
- The controller and node agent use protocol **2**. Build and deploy all platform
  binaries and the dashboard from the same revision.
- Application-defined keys remain opaque: secret/environment variable names,
  build-argument names, structured log fields and third-party protocol fields
  are not renamed.
- Existing controller JSON and agent state cannot be reused. Migration 0027
  refuses a populated installation without modifying its data. Application
  startup checks the migration version and checksum; it never migrates implicitly.

## Fresh installation

Follow [installation](install.md) using a fresh database, worker state and
credentials. The installer runs `platform-migrate` before enrollment and API
startup. No data from an earlier installation is required.

## Recreating a development installation

This discards the platform's development state; it is not an in-place upgrade.
Export any application data you need before beginning. Platform backups are not
an importer for the new contract.

1. Stop accepting deployments. Stop the build worker, API, ingress and management
   target, then stop the worker and builder VMs using the installation guide.
2. Preserve the complete old installation privately if rollback is needed:
   database, `.local`, VM disks, OpenBao storage and recovery credentials. Do not
   copy individual old credentials or agent journals into a new installation.
3. Remove the old installation's units and state only after deciding that its
   data can be discarded or safely archived. The [removal guide](install.md#state-backup-and-removal)
   identifies the owned paths and firewall tables. No command in this release
   automatically deletes an installation.
4. Install the new revision with fresh platform PostgreSQL, OpenBao, registry,
   ClickHouse and worker state. Recreate projects, services and secrets through
   the dashboard, then rebuild and deploy applications.
5. Verify node protocol registration, builds, readiness, routing, logs and metrics
   before making the new installation available.

Rollback means stopping the new installation and restoring the complete old
installation with its matching binaries. Do not run old controllers or agents
against new state, or attempt to reverse individual JSON fields.

For later compatible upgrades, run `platform-migrate` explicitly with the target
release before starting its API/build worker. Keep the matching schema and binaries
together. Automated rolling platform upgrades are not implemented.
