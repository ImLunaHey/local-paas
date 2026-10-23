# Project instructions

This is a new application platform, independent of Anvil. Read README.md and
docs/architecture.md before changing platform behaviour.

- Use the repository's [conventional-commits skill](.agents/skills/conventional-commits/SKILL.md)
  whenever creating a commit. Commit messages must follow Conventional Commits.

- Backend and node-agent code is Rust. Frontend is TypeScript with Vite, React,
  Tailwind CSS, TanStack Router, and TanStack Query.
- Keep OCI services and dedicated celld application fleets distinct.
- Never equate the three Lake worker VMs with three physical failure domains.
- Persist desired state and audit events transactionally in PostgreSQL. Do not
  fake successful builds, deployments, nodes, or runtime health in the UI.
- Never persist or log secret values. Configuration contains references only.
- Runtime implementations belong behind the internal runtime interface; no
  containerd identifiers in scheduler/domain types.
- Local development does not authorize infrastructure provisioning, Railway
  mutations, or production deployment. Railway inventory is queries only and
  must not request variable values.
- Run cargo fmt --check, cargo clippy --workspace --all-targets -- -D warnings,
  cargo test --workspace, and npm run build in web for relevant changes.
  Database integration tests require a disposable PostgreSQL test database.
