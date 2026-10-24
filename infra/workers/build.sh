#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cargo build -p node-agent
mkdir -p .local/worker-flake
cp infra/workers/{flake.nix,flake.lock,vm.nix} .local/worker-flake/
cp infra/workers/secret-exec.rs .local/worker-flake/
cp target/debug/node-agent .local/worker-flake/node-agent-bin
nix build path:./.local/worker-flake#tools -o .local/worker-tools
if [ "$#" -eq 0 ]; then set -- 1 2 3; fi
for worker_index in "$@"; do
  case "$worker_index" in 1|2|3|4|5|6|7) ;; *) echo 'Worker index must be 1–7.' >&2; exit 2;; esac
  nix build "path:./.local/worker-flake#worker$worker_index" -o ".local/worker-$worker_index-vm"
done
