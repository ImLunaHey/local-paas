#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cargo build -p node-agent
mkdir -p .local/worker-flake
cp infra/workers/{flake.nix,flake.lock,vm.nix} .local/worker-flake/
cp infra/workers/secret-exec.rs .local/worker-flake/
cp target/debug/node-agent .local/worker-flake/node-agent-bin
nix build path:./.local/worker-flake#tools -o .local/worker-tools
for worker_index in 1 2 3; do
  nix build "path:./.local/worker-flake#worker$worker_index" -o ".local/worker-$worker_index-vm"
done
