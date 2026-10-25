---
name: dev
description: Run and access the local-paas development environment, including signing in to its local dashboard. Use for local development, browser checks, and authenticated UI work in this repository; do not use these credentials for installed or production environments.
---

# Local development

Follow the development workflow in the repository README. Start the database,
bootstrap authentication, API, and web frontend with the documented Make targets.

For the local development dashboard at `http://localhost:5188`, the two
development-only accounts default to:

- Platform administrator: username `root`
- Organization administrator: username `admin`

Use the organization administrator for ordinary organization-scoped work and the
platform administrator only when the task requires installation-wide access.
Read each username and password from ignored `.local/dev-auth.env`; the variables
are `LOCAL_PAAS_ROOT_USERNAME`, `LOCAL_PAAS_ROOT_PASSWORD`,
`LOCAL_PAAS_ADMIN_USERNAME`, and `LOCAL_PAAS_ADMIN_PASSWORD`. Values may be local
strings or 1Password CLI secret references. Team members with access to the
`local-paas` vault should use:

- Platform username: `op://local-paas/r3uuvggnvinyvlndiikcjv4t2q/username`
- Platform password: `op://local-paas/r3uuvggnvinyvlndiikcjv4t2q/password`
- Organization username: `op://local-paas/uxemyvck54wxvww2dtj64cpjt4/username`
- Organization password: `op://local-paas/uxemyvck54wxvww2dtj64cpjt4/password`

Never print, log, persist elsewhere, or include a retrieved value in chat. Do not
run `op read` as a standalone command whose output will be captured. If neither
local configuration nor authorized vault access is available, ask the developer
which credentials they chose; do not reset them. Never reuse or assume these
credentials for an installed, remote, or production environment.
