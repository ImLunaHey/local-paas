# Environments and private networking

Environments are project-scoped namespaces. The Environments page creates them
without copying secrets or deploying anything. The service list filters by
project/environment, and registration suggests existing environment names.
A registered service cannot change its project or environment: register a separate
service in the destination so its deployments, routing and secret identity remain
independent. Configuration and deployment histories belong to that service UUID.

Every service page has an Open app action when a URL exists, otherwise Set up URL.
Networking displays the configured container port, the active deployment's port,
and its private HTTPS endpoint. Saving a URL mapping updates routing immediately.
Changing the container port updates desired configuration; the active deployment
keeps its old port until a new deployment passes readiness.

Lake currently reserves HTTPS ports 5201–5205 for private previews through
Tailscale Serve, all forwarded to the loopback preview proxy at port 8090. Existing
port 443 routes and dashboard port 5188 are untouched. An endpoint can belong to
only one service; concurrent claims conflict. The API offers only explicitly
configured PREVIEW_HOST/PREVIEW_PORTS endpoints. Configure TLS forwarding before
adding ports to that allowlist. infra/services/api.sh runs the API with Lake's
current dedicated service connections and endpoint allowlist.

These are tailnet URLs, not public custom domains. The domains field in a
specification does not yet provision DNS or the future DigitalOcean edge.
The preview proxy still runs with the API and has its existing HTTP limits.

Validated with database tests for environment filtering, immovable service
identity, port updates, optimistic concurrency and rejecting unconfigured URLs.
Browser checks cover header links, Networking routes/reloads and environment
navigation/filtering through the real Tailscale HTTPS endpoint.
