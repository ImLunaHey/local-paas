# Operator authentication and authorization

The management plane uses lucid-auth on the Rust API and the official Better Auth React client. Registration is closed. Password credentials use the provider's Argon2 verifier, browser sessions are server-side and revocable, and the session cookie is HTTP-only with Better Auth's origin and CSRF checks. Node agents, edge components, OpenBao workloads, and build workers retain their separate credentials; an operator session never authenticates one of those trust domains.

## Bootstrap and recovery

Run the migration and interactive bootstrap from the checkout that owns the local PostgreSQL service:

```sh
make db
make bootstrap-auth
```

The command accepts only a local PostgreSQL connection. Its wrapper reads the root and organization administrator usernames and passwords from ignored `.local/dev-auth.env` when present and securely prompts for either missing password. Copy `dev-auth.example.env` to that path, restrict it to the current user, and fill in locally chosen values when repeatable credentials are useful. A value beginning with `op://` is resolved with the 1Password CLI; any other value is used directly, so vault access is optional. Usernames default to `root` and `admin`. The wrapper creates or updates those users, creates the `admin` organization, and assigns the organization administrator its `admin` role. It is idempotent and can be rerun to recover or rotate those two password credentials. Changing a username creates or updates that identity but does not delete an account created under a previous username. The bootstrap executable accepts the two passwords on standard input and does not contain a default credential. Existing unscoped local projects and domains are adopted by the `admin` organization during the first bootstrap.

The authentication signing secret is generated with mode `0600` at `.local/auth.secret`; installed services receive only its path. Back it up separately from the database. Replacing it and restarting the API invalidates signed browser state. After a suspected operator or session compromise, rotate the secret, rerun bootstrap from the trusted host, and review the audit log before restoring access.

For an installed service, `BETTER_AUTH_SECRET_FILE`, `PUBLIC_ORIGIN`, and trusted proxy behavior must describe the URL the browser actually uses. Do not trust forwarded host or scheme headers from an unrestricted proxy. Keep the control plane private even with application authentication, and terminate TLS before exposing it beyond loopback.

## Authorization model

Global `admin` is the installation superuser and is reserved for recovery and cross-organization administration. Organization members receive one or more organization roles:

The platform administrator dashboard lists every account and exposes a user profile for updating
identity fields and global roles, suspending access, and reviewing or revoking active sessions. It
also shows controller-host and worker health. The active administrator cannot remove their own
global administrator role, suspend themselves, or revoke their current session from that screen.

- `owner` and `admin` manage members, invitations, teams, and custom roles.
- `operator` manages projects, services, builds, deployments, jobs, domains, storage, and secret references.
- `viewer` has read-only platform access.
- `member` has no platform access until assigned another built-in or custom role.

Organizations can create custom roles from the Organization screen. Permissions cover projects, services, builds, deployments, secrets, nodes, jobs, backups, audit records, domains, and storage. API middleware checks the permission and the resource's organization before invoking a management handler. Better Auth independently authorizes organization, team, invitation, role, and global administrator endpoints.

Creating an OCI service requires both `service:create` and `build:execute` when
`buildOnCreate` is omitted or `true`. A caller with only `service:create` must set
`buildOnCreate:false`. Build permission is checked before any service, build, or
registration event is created, against both API key scopes and current organization
roles. celld registration does not queue an OCI build and needs no build permission.

## Threat model

Browser sessions are exposed to credential theft, CSRF, hostile origins, session fixation, and compromised operators. The API therefore denies anonymous management requests, validates the local Host header, rejects untrusted browser origins, requires JSON for mutations, and relies on Better Auth's same-site HTTP-only cookie, origin validation, expiry, rotation, logout, and server-side revocation. The frontend is only an affordance: every permission is enforced in the API.

API clients must use a valid browser session or scoped personal API key and an approved origin when sending an Origin header. A session grants only the active organization's permissions. Resource lookups return not found across organization boundaries to avoid confirming identifiers. Global administrators deliberately cross this boundary and should not be used for routine work.

## Personal API keys

Migration 0039 adds organization-bound personal keys. Browser sessions can list and
revoke their own keys through `/api/api-keys`, or create one by providing a name,
an expiry of 1–90 days, and explicit resource/action permissions. Creation checks
current organization membership and rejects impersonated sessions. Each owner
can have at most 20 active keys in an organization.

The server generates a high-entropy `lp_` credential and returns it once with
`Cache-Control: no-store`. PostgreSQL stores its SHA-256 verifier and a short
identification prefix, never the credential. Creation/revocation and their audit
events commit in the same transaction. The documentation UI keeps the returned
credential out of local storage and TanStack's query/mutation caches.

Use `Authorization: Bearer <key>` over HTTPS. Every request intersects the key's
permissions with the creator's current organization role; expiry, revocation,
account bans, and removed memberships take effect on subsequent requests. A key
never acquires platform-administrator privileges and cannot access authentication
or key-management endpoints. Audit actors identify the key, not its raw value.

The documentation preview must use an explicitly trusted HTTPS origin when its
API uses secure session cookies. Do not rewrite arbitrary browser origins or
disable CSRF checks to make a preview login work. An older API exposes a clear
feature-unavailable notice; deploy the matching API and reviewed migrations before
enabling key creation on that installation.

Audit records store user identifiers and organization IDs, never cookies, passwords, tokens, recovery material, or secret values. Database triggers remain the transactional source for desired-state changes; request audit entries add the authenticated actor and outcome. Agent endpoints remain outside the operator middleware and continue to enforce their existing node credentials.

Lockout recovery is a host-console operation: stop public access, rotate the signing secret if compromise is suspected, rerun `make bootstrap-auth`, and revoke other sessions from the administrator API. Database access alone is not treated as an operator identity.
