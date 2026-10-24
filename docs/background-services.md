# Background development services

The platform runs independently of T3 Code and its agent threads. `make db`,
`make api`, `make web`, and `make build-worker` use the systemd user manager;
none leaves a daemon in the invoking terminal's or T3's process group.

For Lake's existing provisioned checkout, `make up` starts the database, rebuilds
and restarts the API, starts Vite, and ensures the build worker is running. It
returns after launching them. It does not provision VMs, change DNS, initialize
OpenBao, or replace any database. PostgreSQL startup waits for readiness before
the API launches. Vite keeps its usual hot reload.

| Component | Supervisor | Unit |
| --- | --- | --- |
| Control-plane PostgreSQL | User | `local-paas-postgres` |
| API and reconcilers | User | `local-paas-api` |
| Independent preview ingress | User | `local-paas-ingress` |
| Vite frontend | User | `local-paas-web` |
| Build queue worker | User | `local-paas-build-worker` |
| Agent gateway | User | `local-paas-agent-gateway` |
| Dedicated OpenBao | User | `local-paas-openbao` |
| Dedicated ClickHouse | User | `local-paas-clickhouse` |
| Builder VM and registry | System | `local-paas-builder` |
| Three worker VMs | System | `local-paas-worker-1`, `-2`, `-3` |

Inspect user services with `systemctl --user status 'local-paas-*'`, and system
services with `systemctl status 'local-paas-*'`. Follow API output using
`journalctl --user -u local-paas-api -f`; substitute another unit for its logs.

`make api` rebuilds and restarts the API and ensures independent ingress is running.
An already-running ingress is left alone; after an ingress code change use
`bash infra/services/ingress.sh --restart`. `make web` is an idempotent start;
`bash infra/services/web.sh --restart` recreates its unit when launcher settings
change. `systemctl --user restart local-paas-web` restarts the existing unit.
`make db-stop` gracefully stops PostgreSQL without deleting data. To start it
again, run `make db`; a bare `pg_ctl start` would reintroduce thread ownership.
The database launcher migrates an old unsupervised instance with a graceful
stop/start, retaining the existing `.local/postgres` directory.

The current units are transient development units. They survive T3/thread/terminal
restarts, but are not a host-reboot bootstrap system. Lake already has user
lingering enabled, so logging out does not stop its user manager. A reboot still
requires the documented infrastructure startup sequence, including OpenBao
unsealing; this change does not introduce automatic secret recovery.

For a deliberately attached process, use `make api-foreground` or
`make web-foreground`. The API foreground target reads the Makefile's database and
origin settings; the supervised API uses Lake's dedicated-service settings from
`infra/services/api.sh`. Keep the supervised targets for normal use.

## 2026-10-24 restart incident

PostgreSQL had been started by `pg_ctl` inside a T3-owned shell. Daemonizing gave it
PID 1 as its parent but left it in `t3code.service`'s cgroup. Restarting T3 therefore
stopped it, while the independently supervised API continued running and reported
database failures. PostgreSQL shut down cleanly, and restarting the same data
directory restored existing host history. Samples during the outage remain a gap.

The database now runs in its own foreground systemd service, and the Makefile
makes supervision the default for all long-lived development entry points.
