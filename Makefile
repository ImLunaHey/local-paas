## Optional checkout-local settings shared by the API and frontend.
-include .local/development.mk

DATABASE_URL ?= postgresql:///local_paas?host=$(CURDIR)/.local/socket&port=55432
export DATABASE_URL PUBLIC_ORIGIN

.PHONY: db db-stop api api-foreground build-worker web web-foreground up check test-db
db:
	bash infra/services/database.sh

db-stop:
	bash infra/services/database.sh --stop

api: db
	bash infra/services/api.sh

api-foreground:
	cargo run -p control-plane --bin control-plane

build-worker: db
	bash infra/builder/worker.sh

web:
	bash infra/services/web.sh

web-foreground:
	cd web && npm run dev

# Existing provisioned Lake stack; does not create VMs or initialize OpenBao.
up:
	$(MAKE) api
	$(MAKE) web
	$(MAKE) build-worker

check:
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace
	cd web && npm run format:check
	cd web && npm run build

test-db:
	cargo test -p control-plane --tests -- --ignored
