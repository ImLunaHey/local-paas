# Background services

## Installed hosts

`make setup-install` creates persistent management units under `local-paas.target`
and persistent system units for the builder/workers, with firewall setup before VM
startup. It enables user lingering. These survive logout and host reboot. The
installed web unit runs Caddy against built frontend assets. OpenBao starts sealed;
run `make unseal` after reboot. See [installation and recovery](install.md).

## Development

The platform runs independently of the terminal or editor. `make db`,
`make api`, `make web`, and `make build-worker` use the systemd user manager;
none leaves a daemon in the invoking terminal’s process group.

For an already provisioned development checkout, `make up` starts the database, rebuilds
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

The standalone launchers use transient development units. They survive terminal and editor restarts, but are not a host-reboot bootstrap system. Enable user lingering if services need to survive logout. A reboot still
requires the documented infrastructure startup sequence, including OpenBao
unsealing; this change does not introduce automatic secret recovery.

For a deliberately attached process, use `make api-foreground` or
`make web-foreground`. The API foreground target reads the Makefile's database and
origin settings; the supervised API loads `.local/platform.env` when present,
otherwise exported settings and available local service files. Keep the supervised targets for normal use.
