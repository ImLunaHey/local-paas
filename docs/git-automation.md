# Git provider automation

GitHub source connections can turn authenticated repository events into durable
build requests. The provider adapter supports public repositories and private
repositories through repository-scoped GitHub App installation credentials.

## Trust boundary

Creating a connection requires operator authorization for the active
organization. The configured repository must exactly match the service's
credential-free `https://github.com/owner/repository` source. The webhook secret
must contain 32–512 bytes. It and the optional GitHub App private key are written
to the dedicated OpenBao instance and are never returned, persisted in
PostgreSQL, or included in audit data.

PostgreSQL records the connection policy and bounded delivery metadata. It does
not retain webhook bodies, signatures, authenticated clone URLs, or provider
tokens. App and installation IDs are non-secret routing metadata; the database
stores only the opaque OpenBao path for key material. A SHA-256 body digest
detects a delivery ID reused with different input.

Configure the external authority that terminates and forwards webhook requests:

```text
GITHUB_WEBHOOK_HOST=hooks.platform.example
```

The value is an exact HTTP `Host` authority, including a port when one is used.
Without it, webhook requests remain limited to loopback development access. This
setting only permits the request authority; the operator must separately install
a verified HTTPS reverse proxy and restrict the management API as described in
the installation guide. Local development does not authorize DNS, proxy, or
firewall changes.

After upgrading an existing installation, run `make unseal` once to reconcile the
controller's OpenBao policy before creating a source connection. The command
retains the existing controller identity and secret data.

Create a connection with `POST /api/source-connections`:

```json
{
  "serviceId": "0199f5d2-4c58-7000-8000-000000000001",
  "repository": "owner/repository",
  "webhookSecret": "a separately generated high-entropy shared secret",
  "events": ["push", "tag", "pull_request"],
  "githubAppId": 12345,
  "githubInstallationId": 67890,
  "githubPrivateKey": "-----BEGIN RSA PRIVATE KEY-----\n..."
}
```

Omit all three `github*` fields for a public-only connection. For private
access, the GitHub App must be installed on this repository and grant repository
Contents read permission. Preview status publishing additionally requires Checks
write permission. The worker signs a nine-minute App JWT and asks GitHub for a
fresh installation token restricted again to this one repository and the exact
permission needed by the operation. Installation tokens are never
cached. A manual build of the connected service uses the same credential path.

Use the same secret in the GitHub webhook configuration and point its payload URL
to `/api/webhooks/github/{connectionId}`. Select JSON content and enable only the
events in the connection policy. A connection and its recent observations are
available from `GET /api/source-connections` and
`GET /api/source-connections/{connectionId}/deliveries`.

## Delivery semantics

The adapter requires GitHub's `X-Hub-Signature-256`, `X-GitHub-Delivery`, and
`X-GitHub-Event` headers. HMAC comparison is constant-time. Delivery IDs are
unique per connection and are checked transactionally; an exact retry returns the
original observation, while reuse with a different event or body digest fails.
GitHub does not sign a delivery timestamp, so freshness is not invented from an
untrusted payload timestamp. The delivery ID is the replay boundary.

Accepted pushes and tag pushes record the full `after` commit. Pull requests are
accepted only for `opened`, `reopened`, and `synchronize`, and fork pull requests
are denied by default. The delivery observation, pinned commit, build snapshot,
and build event commit in one PostgreSQL transaction. The builder receives only
the immutable commit, never the mutable branch or tag.

The configured event list is intentionally a build policy, not an implicit
production-deploy policy. Successful builds create revisions through the normal
transactional flow; traffic changes still require the existing explicit deploy
operation. Thus a duplicate delivery cannot create a duplicate build or logical
deployment.

If a service already has a queued or running build, the delivery is recorded as
`blocked`; it is not reported as accepted and no second build is fabricated.
Unsupported events, disabled policies, deleted refs, and fork pull requests are
recorded as `ignored` with a non-secret reason. GitHub `ping` verifies the
connection without starting a build.

## Revocation, rotation, and repository changes

GitHub rejects a removed or suspended installation, revoked key, missing
repository grant, or transferred repository that is no longer covered by the
installation. GitHub denial fails the build with `source_authentication_failed`;
an OpenBao or provider-connectivity outage uses
`source_authentication_unavailable`. In both cases the connection changes to
`error` and exposes a credential-free remediation message. No successful build
or revision is fabricated.

Rotate a GitHub App key from the dashboard or with
`PUT /api/source-connections/{id}/github-key` and a JSON body containing only
`githubPrivateKey`. OpenBao performs a compare-and-set replacement while
preserving the webhook secret; PostgreSQL returns to `configured` without ever
receiving key material. Keep the old GitHub key active until this request
succeeds, then revoke it at GitHub. The next successful token exchange changes
the connection to `active`.

After repository transfer, update the service repository and recreate its source
connection with the new owner plus the installation that covers it. If an
installation is removed, reinstall the App with Contents read access and rotate
the stored key if necessary. Replaying an old delivery does not test recovery:
queue a new manual build or send a new signed event so the worker mints a fresh
token.

## Current limits

- Do not put credentials in a repository URL. GitHub App authentication is the
  only private-source mechanism.
- Provider status checks and connection deletion remain follow-up work.
- Automatic production deployment is deliberately not implied by source events.
- Blocked deliveries require an operator to request a later build; they are not
  silently retried.
- PR preview creation requires the explicit policy described below; accepting a
  build-only pull-request event does not create an environment.

These limits keep provider automation from bypassing the existing isolated
builder, immutable revision, secret-reference, and truthful-state boundaries.

## Pull-request preview environments

A source connection can opt into isolated previews from its service's Builds page.
The preview policy owns PR events once configured (including when disabled); it
never falls back to building the production service. Push/tag policies are
unchanged. Enable GitHub's `pull_request` webhook deliveries, including `closed`.
With a configured GitHub App, lifecycle transitions publish a `local-paas preview`
Check against the exact head commit. The check links to the dashboard and includes
the private preview URL once allocated. Publishing failures are visible in the
dashboard and never make a build or deployment appear successful.

`PUT /api/source-connections/{id}/preview-policy` accepts:

```json
{
  "enabled": true,
  "maxActive": 3,
  "maxBuilds": 1,
  "ttlHours": 24,
  "resources": { "cpuMillis": 250, "memoryMib": 256 },
  "services": [
    {
      "sourceServiceId": "the-public-http-service-uuid",
      "resources": { "cpuMillis": 250, "memoryMib": 256 },
      "secretReferences": ["PREVIEW_API_KEY"],
      "allowedDependencies": ["the-api-service-uuid"]
    },
    {
      "sourceServiceId": "the-api-service-uuid",
      "resources": { "cpuMillis": 250, "memoryMib": 256 },
      "secretReferences": [],
      "allowedDependencies": []
    }
  ]
}
```

Omitting `services` preserves the safe single-service default with no secrets or
dependencies. Templates contain 1–5 services from the source environment. Every
service must use the connected repository; the PR head commit is pinned across
all of them. Existing private connections survive only when their target appears
in both the template and that service's `allowedDependencies` list, then they are
remapped to the preview service UUID.

Policy management requires source management plus project/service creation,
build execution, and deployment execution/stop permissions. Manual cleanup also
requires deployment stop permission. The policy API and preview listing are
organization-scoped. GET on the policy endpoint returns `null` until configured.

The policy snapshots each service's HTTP OCI build and readiness settings. Each
preview gets distinct service UUIDs and an environment with **no parent**.
Production domains, volumes, unlisted private connections, database/object-storage
bindings, build arguments, pre-deploy commands, jobs, schedules and scaling
policies are not copied. Secret values never enter PostgreSQL: an explicit list
of existing secret names creates an audited grant from the source service, and
the normal deployment snapshot materializes only those names inside OpenBao for
the preview workload. One desired replica per service uses its template's resource
limits. A normal rolling deployment can temporarily reserve a second replica.
Build/start commands remain part of the reviewed source
configuration: preview code can make external requests, so applications must
avoid production side effects and require no production credentials. No
production seed data or persistent preview storage is supplied.

The workflow supports up to five stateless HTTP services per connection/PR identity.
Multiple source connections to the same repository have independent policies and
quotas. Limits are 1–10 admitted previews, 1–3 concurrent queued/running builds,
1–168 hours after the latest accepted event, 100–2000 CPU millis and 64–2048 MiB
per replica. Limits include previews waiting for cleanup; lowering a quota does
not evict existing previews. Resource/build template edits apply to newly created
previews. Admission and build concurrency limits apply on the next reconciliation;
TTL is recorded on each accepted event. No worker, database, volume, celld fleet,
or public route is created by this workflow.

### Events, progress and cleanup

- Signed `opened`, `synchronize`, and `reopened` events record the full head SHA.
  Both head and base repository identities must match the source connection.
  Forks fail closed. `closed` requests cleanup, including merged PRs.
- Delivery-ID retries return their original observation. PR `updated_at` orders
  different deliveries; older events are ignored. Equal timestamps are ambiguous:
  close wins, and other updates are ignored with a visible reason. This is an
  ordering signal in an authenticated payload, not a signed freshness guarantee.
  Send a later synchronize/reopen event if GitHub changes shared a timestamp.
- Events received while building coalesce to the newest accepted commit. A
  superseded build may finish, but its result does not start a new deployment.
  Builds reuse the source connection's private-repository authentication and the
  isolated BuildKit path. Traffic changes use normal readiness-gated deployment.
- Missing URL capacity, build capacity or worker capacity remains visible as
  blocked/pending/deploying state. Build or candidate failures remain visible;
  a failed candidate preserves the previous healthy preview revision. A fresh
  healthy observation is required for `ready`; stale observations are degraded.
- `GET /api/source-connections/{id}/previews` returns the latest 100 records with
  commit, primary service/environment/build/deployment IDs, service count, expiry,
  lifecycle state, provider publishing state, reason and URL.
  A link can exist while a preview is building; it does not imply readiness.
- `DELETE /api/source-connections/{id}/previews/{previewId}`, disabling the policy,
  or expiry requests cleanup. Routes are withdrawn, queued builds cancelled,
  running builds asked to cancel, and instances told to stop. Cleanup waits for
  terminal builds, authenticated stopped observations, and ingress/private route
  lease expiry. Unknown instance state never counts as confirmed shutdown.
- History (including environment/service identities, builds, revisions, stopped
  instances and audit records) is retained after closure; no active routes,
  workloads or reservations are retained once cleanup is confirmed. Image
  garbage collection belongs to the production registry retention work. A newer
  explicit `reopened` event is required after manual cleanup/expiry. Reopening
  during cleanup waits for completion and reuses the environment identity.

Private URLs come only from the operator-configured `PREVIEW_HOST` /
`PREVIEW_PORTS` pool; no DNS, proxy, tailnet or infrastructure provisioning occurs.
Exhaustion is reported before building. Released URLs may later serve another
preview. Configure forwarding as described in [private networking](environments-networking.md).
Ordinary mutation controls cannot edit a managed preview service, attach secrets,
run jobs, start manual builds, add services/volumes to its environment, shadow it,
or attach public domains; use the parent connection's policy and cleanup controls.

Database tests cover event ordering/replays, multi-service dependency remapping,
audited secret grants, isolation, quotas, build coalescing, capacity waits,
deployment failure preservation, restart reconciliation, expiry and shutdown
barriers. The disposable browser fixture exercises signed webhook acceptance,
policy persistence, blocked and ready progress, preview-link navigation, manual
cleanup, provider state, API failures, and desktop/mobile layouts. Real worker
qualification uses the opt-in preview canary below; no public preview is implied.

For a real-host qualification, open or update a same-repository PR whose template
serves a unique marker, wait for the GitHub Check to succeed, then run the browser
harness with the source service, PR number and marker:

```sh
PREVIEW_CANARY_SERVICE_ID=<uuid> \
PREVIEW_CANARY_PR=<number> \
PREVIEW_CANARY_EXPECTED_TEXT=<marker> \
E2E_BASE_URL=<installed-private-dashboard-url> \
E2E_AUTH_STATE=/tmp/preview-canary-auth.json \
E2E_AUTH_PASSWORD_FILE=<local-admin-password-file> \
pnpm --dir web test:e2e pr-preview-canary.spec.ts
```

Close the PR and confirm the dashboard reaches `closed`, the Check is cancelled,
and the prior URL no longer routes before declaring the drill complete. The drill
uses existing private routing and workers; it does not provision infrastructure.
