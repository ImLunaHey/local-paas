## Optional checkout-local settings shared by the API and frontend.
-include .local/development.mk

DATABASE_URL ?= postgresql:///local_paas?host=$(CURDIR)/.local/socket&port=55432
export DATABASE_URL PUBLIC_ORIGIN

.PHONY: db db-stop api web check test-db
db:
	mkdir -p .local/socket
	chmod 700 .local
	test -f .local/postgres/PG_VERSION || initdb -D .local/postgres --auth-local=trust --auth-host=reject --no-instructions
	pg_ctl -D .local/postgres status >/dev/null 2>&1 || pg_ctl -D .local/postgres -l .local/postgres.log -o "-k $(CURDIR)/.local/socket -h '' -p 55432" -w start
	psql 'postgresql:///postgres?host=$(CURDIR)/.local/socket&port=55432' -tAc "SELECT 1 FROM pg_database WHERE datname = 'local_paas'" | grep -q 1 || createdb -h '$(CURDIR)/.local/socket' -p 55432 local_paas

db-stop:
	pg_ctl -D .local/postgres -m fast -w stop

api:
	cargo run -p control-plane

web:
	cd web && npm run dev

check:
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace
	cd web && npm run format:check
	cd web && npm run build

test-db:
	cargo test -p control-plane --test api -- --ignored
