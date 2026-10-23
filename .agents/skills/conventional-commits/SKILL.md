---
name: conventional-commits
description: Write Conventional Commit messages when committing changes in the local-paas repository. Apply to implementation, fixes, tests, documentation, and maintenance commits.
---

# Repository commit convention

Use `type(scope): description`, with an optional scope. Use a short imperative
description that states the actual change. Choose `feat` for new behaviour,
`fix` for corrections, or an appropriate maintenance type such as `docs`, `test`,
`refactor`, `build`, `ci`, or `chore`.

Useful scopes in this repository include `api`, `builds`, `runtime`, `web`, and
`skills`. Examples: `feat(builds): record immutable image revisions` and
`fix(web): allow the configured Tailscale origin`.

Use `!` and a `BREAKING CHANGE:` footer for an incompatible public contract
change; explain the required migration. Put non-obvious reasons and relevant
validation in the body when helpful.

Before committing, review the staged diff and ensure the message describes only
that diff. Keep unrelated work separate and exclude secrets, local PostgreSQL
data, build output, and developer-machine settings. Run the checks required by
AGENTS.md for the affected code. Never claim an unrun check passed.

This convention does not authorize pushing, publishing, or rewriting history.
