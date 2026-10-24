# Development backups and restore drills

`platform-backup` is a Rust operator for the existing private Lake stack. Restic
handles authenticated encryption, deduplication and snapshot integrity. This uses
the platform's own repository on NVMe, independently of Lake's other services.
The repository key is a private file; it is never printed or embedded in metadata.

Each complete backup set contains:

- A PostgreSQL custom-format dump of control-plane desired state, history, audit
  events, configuration references and cached telemetry.
- Custom-format dumps of active managed PostgreSQL databases and full RDB exports
  of active managed Redis databases, using credentials read from OpenBao.
- The file-backed OpenBao store, its TLS/configuration, controller identity and
  recovery material, inside an encrypted Restic snapshot.
- An encrypted manifest identifying the exact component snapshots. The manifest
  is written only after every component succeeds; a partial run is not a complete set.

Only active databases are selected. An unhealthy selected database fails the run;
stopped database volumes are not exported. Each database has its own consistent
snapshot; this is not a transaction across all services. Application credentials
are supplied only to child-process environments. PostgreSQL dumps stream directly
to Restic using `--stdin-from-command`, so a failed dump cannot silently become a
successful empty backup. Redis's temporary RDB and all restore material use a
private directory on verified `/run/user` tmpfs. Child stderr is withheld because
database/tool errors can contain application data.

OpenBao 2.6.4 currently uses file storage. The operator briefly stops **only the
dedicated OpenBao service**, captures its files and control-plane database, then
restarts and unseals it. Keeping it offline through the control-plane dump prevents
that dump from referencing secret versions newer than the authority snapshot.
Running applications keep their already-delivered secrets; new secret operations
can fail during this window. A persistent maintenance marker, normal error cleanup
and the backup unit's `ExecStopPost` resume the authority after interruptions.
An online Raft snapshot would require a separately tested storage migration.

## Run and schedule

On the already provisioned checkout, as Luna:

```sh
nix build path:./infra/services -o .local/service-tools
bash infra/services/backup.sh init     # once; never overwrite a lost repository key
bash infra/services/backup.sh install
systemctl --user start local-paas-backup.service
systemctl --user list-timers local-paas-backup.timer
```

The persistent user timer runs daily at 03:30 local time, with up to 15 minutes of
jitter. It runs backup followed by restore verification and survives T3/thread
restarts. The unit bounds memory, disables swap/core dumps and supervises all child
processes. Lake's existing user lingering is required for unattended runs. The
rest of the development stack still needs its normal bootstrap after host reboot.

To verify the latest complete set without taking another backup:

```sh
bash infra/services/backup.sh verify
```

Verification reads the manifest from the encrypted repository, not just a local
status file. It restores each archive with Restic checksum verification, loads the
SQL into a new disposable PostgreSQL cluster, loads the RDB into disposable Redis,
and unseals a separate OpenBao instance. PostgreSQL/Redis run inside Bubblewrap
namespaces with only the temporary restore directory writable, no host LAN and no
NAS/home filesystem mounts. Their Unix sockets are private. The restore sandbox
uses the C locale rather than relying on the host's locale archive.

Restored PostgreSQL catalog queries prove that the imported databases are usable.
Every deployment's recorded secret version is checked against the restored
authority without printing values. The original databases and authority are never
restore targets. Temporary children and files are removed when the drill ends.
OpenBao's disposable TLS listener uses loopback 28200, not the live 18200 endpoint.

The 2026-10-24 live drill restored the control-plane database, one managed
PostgreSQL database and one Redis database, then verified nine pinned secret
versions in restored OpenBao. A separate interruption drill stopped the backup
while OpenBao was shutting down: `ExecStopPost` waited for the old transient unit
to be collected, restarted/unsealed the authority, and preserved the previous
complete backup manifest. Future runs repeat the restore check against their own
inventory; these observations are not a guarantee for untested database versions.

Backup starts, completion/failure and restore results appear in the global audit
log as actions by `backup-worker`. Local `.local/backups/latest.json` identifies
the last complete set; `verification.json` records the last drill result. A complete
backup and a verified restore are distinct states. Inspect failures with:

```sh
systemctl --user status local-paas-backup.service
journalctl --user -u local-paas-backup.service
```

## Recovery boundaries

The default encrypted repository is `.local/backups/repository`; its recovery key
is `.local/backups/repository.key`. **Both are currently on Lake.** Keep an independent
copy of the key and configure an off-site repository before relying on these
backups for hardware-loss recovery. No off-site destination has been selected or
configured. Restic destinations can be supplied using `RESTIC_REPOSITORY` and
`RESTIC_PASSWORD_FILE`; scheduled runs read optional `.local/backups/destination.env`.
That file should contain credential-file references, not secret values. Initialize
and verify a new destination explicitly before switching the timer to it.

There is no automatic deletion/pruning policy yet. Monitor repository capacity.
Archived ClickHouse logs, the OCI registry, uploaded source archives, worker
identities, RustFS objects and arbitrary application volumes are not in this backup
set. Restoring control-plane records alone cannot recover those external resources.
Their backup topology and the production bootstrap remain separate release gates.

The operator deliberately provides a nondestructive restore drill, not an
overwrite-live-data button. For an actual recovery, stop/isolate controllers and
builders before restoring desired state, recover into new destinations, and
reconcile instance identities and routing before enabling orchestration. Restore
application databases into new services/volumes and validate them before changing
application connections. Preserve current state for rollback. Never run a restored
controller alongside the original against the same workers.

OpenBao backups follow its [storage backup guidance](https://openbao.org/docs/concepts/storage/).
Restic's [command-input backup contract](https://github.com/restic/restic/blob/master/doc/040_backup.rst)
explains why the operator checks producer exit status rather than trusting an
unqualified stdin pipeline.
