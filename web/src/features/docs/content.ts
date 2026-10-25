import { guideContent } from './guide-content'

export type Doc = {
  slug: string
  title: string
  group: string
  description: string
  body: string
  example?: 'service' | 'deployment'
  related?: string[]
}
const article = (
  slug: string,
  title: string,
  group: string,
  description: string,
  body: string,
  example?: Doc['example'],
  related?: string[],
): Doc => ({ slug, title, group, description, body, example, related })
const start = 'Getting started'
const deploy = 'Deploy'
const configure = 'Configure'
const operate = 'Manage'

const authored: Doc[] = [
  article(
    '',
    'Build something. Ship it.',
    start,
    'Everything you need to take an application from your laptop to a running service.',
    `
## Your application, from source to service

local/paas brings your code, deployments, databases, and runtime tools into one workspace. These guides are for people deploying applications to an existing platform. You do not need to provision servers or install a cluster to follow them.

Start with an account and access to your team's organization. If you do not have an invitation or the platform URL, ask your workspace administrator. This release is a private alpha: available capacity, public domains, and backup arrangements depend on your workspace.

## Choose your first deployment

- [Deploy a Node.js app](/docs/nodejs) with a complete, dependency-free HTTP server.
- [Deploy a Python app](/docs/python) with FastAPI and a locked uv environment.
- [Deploy a Go app](/docs/go) using a standalone HTTP server.
- [Use a Dockerfile](/docs/dockerfile) when you need control over system packages or a custom build.

Already have an application? Follow [Deploy an application](/docs/deployments) for the dashboard workflow, or [Upload local source](/docs/source-uploads) if your code is not available through Git.

## Understand your workspace

A **project** groups related applications. An **environment** separates a project's production, staging, or development configuration. A **service** is an application, worker, or database in an environment.

A **build** turns source into an image. A **deployment** starts that image with a specific configuration and checks whether it is ready. These are separate operations: a successful build does not mean an application is serving traffic.

Put your web app and its database in the same project and environment to keep their configuration and access deliberate. Use separate databases for staging rather than pointing test code at production data.

## After your first deployment

Add [variables and secrets](/docs/variables), connect a [database](/docs/storage), and configure a [custom domain](/docs/networking). Use [logs and metrics](/docs/observability) to diagnose behavior, and learn [how to roll back](/docs/rollbacks) before you need it.

For automation, the [API reference](/docs/api) includes a live request editor. You can sign in, create a scoped API key, and run a request without leaving the documentation.
`,
    undefined,
    ['deployments', 'nodejs', 'api'],
  ),
  article(
    'deployments',
    'Deploy an application',
    start,
    'Create a service, build your source, and put a healthy revision online.',
    `
## Before you begin

You need access to an organization, a project and environment, and source code that can be built reproducibly. For generated builds, commit your dependency lockfile. Your HTTP application must bind to **0.0.0.0**, not only localhost, and expose a readiness endpoint that does not require authentication.

Public Git URLs must not contain credentials. Private-repository authentication is not available in this release; use [a source upload](/docs/source-uploads) for code the builder cannot fetch. Do not embed access tokens in a repository URL.

## 1. Create the service

Open **Projects**, choose a project and environment, and select **New service → App**. Give the service a recognizable name, such as storefront. Pick the organization and environment carefully: they determine configuration inheritance and who can manage the service.

For a Git source, enter the repository URL and select a branch, tag, or full commit. A branch is resolved to a specific commit for each build, so later branch changes do not silently change an already-built image.

## 2. Configure the build

Use **Automatic** for a supported standalone repository. A Dockerfile takes precedence unless you select generation through build settings. Generated recipes support Node.js, Bun, Python, Go, Rust, Ruby, and PHP with their required manifests and lockfiles.

Select **Dockerfile** for workspaces, unusual directory layouts, additional system libraries, or a build you already maintain. Set the build context and Dockerfile path relative to the selected source. See [build commands](/docs/builds) for override behavior.

Build-time commands belong in build settings; the long-running server command belongs in start settings. Neither field is a secret store. Put credentials in [secret bindings](/docs/variables).

## 3. Set the port and readiness check

Match the container port to the server's listening port, for example 3000, and set a readiness path such as /health. A Dockerfile EXPOSE instruction alone does not configure routing. Ensure the endpoint returns a successful HTTP response only after your application can accept requests.

## 4. Build, then deploy

Save the service and start a build. Open its output to follow dependency installation and compilation. A successful build records an immutable image digest. If it fails, correct the first meaningful error and build again; repeatedly clicking deploy cannot repair a failed build.

Deploy the successful revision. Watch the candidate progress through preparation, readiness, and promotion. Until promotion succeeds, the previous healthy revision continues serving. On a first deployment there is no previous revision to fall back to.

## 5. Verify the running application

Open the available service preview, check a real application route, and inspect logs for startup errors. A private preview is not a public custom domain. Follow [domains and networking](/docs/networking) when you are ready to expose the app publicly.

Check both the deployment state and the application response. If readiness fails, compare the listening address, configured port, and readiness path. If a database connection fails, confirm the database is ready and that the service has an explicit connection binding in this environment.
`,
    'deployment',
    ['health-checks', 'rollbacks', 'networking'],
  ),
  article(
    'nodejs',
    'Deploy a Node.js app',
    deploy,
    'A complete HTTP service, a committed lockfile, and your first healthy deployment.',
    `
## Create the application

This example uses Node's built-in HTTP server, so there are no framework dependencies to hide. Create an empty directory and add these two files. The app serves a home page and a separate readiness endpoint.

~~~json package.json
{
  "name": "hello-platform",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": { "start": "node server.js" }
}
~~~

~~~javascript server.js
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 3000)
const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('Hello from local/paas!\\n')
})

server.listen(port, '0.0.0.0', () => {
  console.log('Listening on port', port)
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
~~~

## Test and lock dependencies

Run the following commands locally. Even without dependencies, commit the generated package-lock.json so the recipe has an unambiguous package-manager contract.

~~~bash
npm install
npm start
~~~

In another terminal, check the response. Both requests should return HTTP 200.

~~~bash
curl -i http://localhost:3000/
curl -i http://localhost:3000/health
~~~

Commit package.json, package-lock.json, and server.js to your repository, or include them in a [source upload](/docs/source-uploads). Do not include node_modules or local environment files.

## Configure the service

Open a project and environment, then select **New service → App**. Set the source to your repository and branch, choose **Automatic**, and configure port **3000** and readiness path **/health**. The recipe uses the start script; this example does not need a build command.

If you use pnpm, Yarn, or Bun in your existing app, commit only the lockfile for that manager. Multiple competing lockfiles make detection ambiguous. A TypeScript application also needs a complete compilation setup, including its tsconfig and an output path that matches the start script.

## Deploy and verify

Build the service, inspect the output, then deploy the resulting image. Once readiness passes, open the preview and verify the greeting. Check runtime logs for the listening message. Add a public domain separately when your workspace has public routing available.

## Troubleshooting

**Readiness fails:** confirm that the process binds to 0.0.0.0 and that PORT matches the service port. The platform cannot reach a server bound only to localhost.

**Missing start script:** define scripts.start or an explicit start override. Do not use a development watcher as your production process.

**Module not found:** check that the dependency is declared and installed by your committed lockfile. If compilation emits dist/server.js, verify that file is actually produced before starting it.

**Native libraries or monorepo layout:** use a [Dockerfile](/docs/dockerfile) with the required packages and paths rather than relying on an unsupported automatic recipe.
`,
    'service',
    ['variables', 'health-checks', 'github'],
  ),
  article(
    'python',
    'Deploy a Python app',
    deploy,
    'Run a FastAPI application with frozen dependencies and an explicit production command.',
    `
## Create the project

Use uv locally to create a standalone application and lock FastAPI and Uvicorn. Commit both pyproject.toml and uv.lock. The generated recipe installs the frozen lockfile rather than resolving dependencies during deployment.

~~~bash
uv init --app hello-api
cd hello-api
uv add fastapi 'uvicorn[standard]'
~~~

Add the following app.py at the project root. The module name in the start command must match this filename.

~~~python app.py
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def home():
    return {"message": "Hello from local/paas!"}

@app.get("/health")
def health():
    return {"status": "ok"}
~~~

## Run it locally

~~~bash
uv run uvicorn app:app --host 0.0.0.0 --port 8000
~~~

Open http://localhost:8000/health and confirm the JSON response. Do not add --reload to the production command. A reloader is useful for local edits, but it is not your deployed server process.

## Configure and deploy

Create an App service in the intended project and environment. Choose Automatic or Generated build mode and set the start command to the command below. Set container port **8000** and readiness path **/health**.

~~~bash
exec uv run uvicorn app:app --host 0.0.0.0 --port 8000
~~~

Build the source and review the dependency installation output. Deploy the successful image, wait for readiness, and open its preview. Runtime logs should show that Uvicorn has started and accepted requests.

## Add configuration safely

Read application settings from environment variables. Use secret bindings for credentials; do not commit .env files or put a database password in the start command. Connect a database explicitly before adding a readiness check that depends on it.

## Troubleshooting

**Could not import module app:** app.py must be in the selected context and define the app object. If your application is in a package, use the actual dotted module path.

**Frozen install fails:** update the lockfile locally and commit it alongside pyproject.toml. Do not disable locking to hide a mismatch.

**Missing system libraries:** generated recipes do not promise arbitrary native packages. Use a Dockerfile for OS-level dependencies or a multi-language workspace.

**Process starts but readiness fails:** compare port 8000, the binding address, and /health. Inspect the candidate's logs, not only the previous active revision's output.
`,
    'service',
    ['builds', 'variables', 'observability'],
  ),
  article(
    'go',
    'Deploy a Go app',
    deploy,
    'Build a small Go HTTP server with an explicit, reproducible Dockerfile.',
    `
## Create a complete HTTP server

Create a module with go mod init example.com/hello and add main.go. This example uses only the standard library. It deliberately uses a Dockerfile so a dependency-free module does not need an artificial go.sum file to satisfy generated-recipe detection.

~~~go main.go
package main

import (
    "fmt"
    "log"
    "net/http"
    "os"
)

func main() {
    port := os.Getenv("PORT")
    if port == "" { port = "8080" }
    mux := http.NewServeMux()
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        fmt.Fprintln(w, "ok")
    })
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "Hello from local/paas!")
    })
    log.Fatal(http.ListenAndServe(":"+port, mux))
}
~~~

## Build the image

The first stage compiles a static binary; the second provides a small runtime with CA certificates. The process listens on every interface. Commit main.go, go.mod, and this Dockerfile.

~~~dockerfile Dockerfile
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/server .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/server /server
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/server"]
~~~

## Test before deployment

~~~bash
go run .
# In another terminal:
curl -i http://localhost:8080/health
~~~

Create an App service, choose your source, and select Dockerfile mode with Dockerfile at the repository root. Set container port **8080** and readiness path **/health**. EXPOSE is documentation inside the image; you still need to configure the service port.

Build, inspect the compiler output, and deploy the resulting image. Open the preview after readiness passes and inspect the runtime logs if it does not respond.

## Using the generated Go recipe

For an existing standalone module with go.mod and go.sum, Automatic can compile the root package to /app/app. Commit both manifests. If your main package lives under cmd/server, or you need CGO and system libraries, keep an explicit Dockerfile and adjust the build target and runtime dependencies.

For any application, avoid writing durable data into the image filesystem. Use a database or a deliberately attached volume, and test shutdown and recovery behavior before relying on multiple replicas.
`,
    undefined,
    ['dockerfile', 'health-checks', 'storage'],
  ),
  article(
    'health-checks',
    'Health checks',
    deploy,
    'Tell the platform when a process is ready to serve—not just when it has started.',
    `
## Readiness is a traffic gate

A running process can still be warming caches, opening database connections, or loading application state. Readiness is the signal that a candidate can accept traffic. Configure an explicit HTTP path and container port in the service's runtime settings.

Use a lightweight endpoint such as /health. It should not require a login, redirect to another hostname, or perform expensive writes. Bind the application to 0.0.0.0. Check the exact response locally before deploying.

## Choose what the check proves

A simple process check returns success once startup is complete. A dependency-aware check can fail while a required database is unavailable. Choose intentionally: an optional analytics provider should not usually remove your entire application from service.

Do not return success before initialization has finished. Equally, avoid heavy queries on every probe. If you need dependency checks, bound their timeouts so the health endpoint cannot hang indefinitely.

## Understand promotion

During deployment, the candidate must pass readiness through the configured stabilization period before promotion. Existing healthy traffic stays on the previous revision while this happens. A failed candidate does not become successful because it briefly started a container.

On the first deployment there is no fallback revision. Keep the service private until the application and its dependencies have been verified. For public domains, routing and TLS observations are additional checks—not implied by a readiness response.

## Diagnose a failed check

1. Select the failing deployment and inspect its candidate instance logs.
2. Confirm the app is still running and did not exit after startup.
3. Compare the configured port with the listening port in the logs.
4. Confirm the path exists without authentication and returns success.
5. Check required secret bindings and database connections.

A 404 usually means the path is wrong. Connection refusal usually means the wrong port, an app bound to localhost, or a process that has not started. An application 500 points toward startup or dependency failure; inspect its logs.

## Readiness versus liveness

Readiness governs whether an instance can serve traffic. Liveness and process-exit observations inform recovery after startup. Repeated crashes can exhaust a restart budget; they should not be mistaken for a healthy deployment. Follow the recorded health history when investigating repeated recovery attempts.

Need to return to an earlier revision? Use the separate [rollback guide](/docs/rollbacks). Health checks do not undo database migrations.
`,
    'deployment',
    ['rollbacks', 'observability', 'nodejs'],
  ),
  article(
    'rollbacks',
    'Roll back a deployment',
    deploy,
    'Recover a retained application revision and understand what a rollback cannot undo.',
    `
## Before you roll back

Identify the last known-good deployment in the service's deployment history. Review its source commit, image, configuration, and health. A rollback uses a retained revision; it is not a new build of the current branch.

Check whether the application made external changes. Database migrations, messages already published, uploaded objects, and third-party API calls are not reversed by changing the running application image. Confirm that the previous application version can still use the current data schema.

## Request the rollback

Open the service's deployment history, select the appropriate retained deployment, and use its rollback action. Review the target before confirming. Keep the deployment timeline open until the platform records the result.

The request starts a coordinated transition. The older revision must still be healthy, and routing must acknowledge the change. An accepted request alone is not evidence that traffic has moved.

## Verify the result

Check the active deployment identity, application health, runtime logs, and a real user-facing request. For public domains, confirm the route is serving the expected revision. Watch for compatibility failures against data created by the newer application.

If neither the previous nor candidate revision is healthy, a rollback cannot promise recovery. Diagnose the shared dependency or configuration problem and involve your workspace administrator if capacity or routing is unavailable.

## Recover from a failed candidate

Before promotion, a failed candidate leaves the previous healthy route untouched. You may not need a manual rollback at all. Inspect the deployment state first so you do not introduce another change while the platform is already preserving the working revision.

After promotion, returning traffic requires a confirmed route change before the candidate can be stopped. Follow the recorded outcome rather than assuming the button completed synchronously.

## Make future rollbacks safer

Use backward-compatible, expand-and-contract database migrations. Keep credentials and configuration compatible through a release transition. Test a rollback in a non-production environment and retain a known-good revision while validating a new release.

For automation, the [API explorer](/docs/api) exposes the rollback operation. It performs a real write and requires deployment permissions; review its target ID before sending.
`,
    undefined,
    ['health-checks', 'observability', 'environments'],
  ),
  article(
    'api',
    'API reference',
    'Reference',
    'Explore request schemas, create a scoped key, and send real requests from this page.',
    `
## Authentication and scope

The explorer uses your current browser session and active organization, or an API key you enter explicitly. Sign in to create a personal organization key. Select only the permissions your integration needs and choose an expiry of 1–90 days. The raw key is returned once; only its hash is stored by the server.

A key is bound to its creator and organization. It cannot exceed the creator's current role, manage authentication, create other keys, or gain platform-administrator access. Removing membership, banning the account, revoking the key, or reaching its expiry prevents further authorized use.

~~~bash
# Set API_KEY securely in your shell; never commit it.
curl --fail-with-body "$PLATFORM_URL/api/projects" \\
  -H "Authorization: Bearer $API_KEY"
~~~

## Request conventions

Send JSON with Content-Type: application/json. IDs are opaque identifiers from previous responses—not names. For versioned updates, use the latest version or ETag required by the operation. A conflict means you must reload state and review your intended update, not blindly replay a stale request.

The reference below is generated from the checked-in OpenAPI contract. It documents the schema-covered operations, not every internal dashboard or agent endpoint. Authentication internals and infrastructure-only endpoints are intentionally not exposed as playground actions.

## Responses and errors

The explorer shows the HTTP status and response body, including error responses. A 401 means authentication failed; a 403 means the credential or role lacks access. A 404 can mean the target is absent or outside your organization. A 409 indicates a state, validation, or concurrency conflict. Read the returned code and error rather than matching English text in an integration.

Queued builds and deployments finish asynchronously. Follow their recorded state instead of treating a successful request as successful deployment. Writes below affect real resources in your selected organization. No request is sent until you choose **Send request**; writes require an additional acknowledgement.
`,
    undefined,
    ['api-keys', 'deployments'],
  ),
  article(
    'api-keys',
    'API keys',
    'Reference',
    'Create, use, and revoke short-lived credentials for your organization.',
    `
## Create a key

Sign in using the panel below and select your organization. Name the key after its purpose, for example staging-readonly-ci. Choose the shortest useful expiry, up to 90 days, and explicitly select its permissions. Read-only access is a good starting point for an integration that only inspects state.

Keys are personal: they belong to you and one organization. You cannot grant a permission you do not currently hold. Platform-administrator status does not turn a personal key into a platform-wide credential. An impersonated session cannot create keys.

## Store it once

Copy the returned value into your CI secret store or password manager. The page does not persist it in local storage, URL parameters, or the shared query cache. Refreshing or leaving the page loses the displayed value; the server cannot reveal it again.

Do not put the key in a repository, screenshots, command-line query parameters, or an application shipped to browsers. Send it in the Authorization header over HTTPS. HTTP should only be used for isolated local development.

## Test with the explorer

Open the [API reference](/docs/api), choose API key authentication, and paste the value into the password field. Start with a read request such as GET /api/projects. A 403 may mean either the selected key scope or your current organization role does not allow the operation.

Keys cannot access authentication routes or manage other API keys. Use your browser session to create and revoke credentials. Changing the organization in the documentation clears the current explorer and key form state.

## Rotate and revoke

Create a replacement key, update the integration's secret store, verify a request, then revoke the old key. Revocation applies to subsequent requests; it cannot undo a build or write already accepted.

The list below shows metadata and prefixes, never full credentials. At most 20 active keys are allowed per user and organization. Revoke unused keys instead of creating indefinitely many credentials.

If you suspect a leak, revoke the key immediately and review the organization's audit history for activity attributed to that key. Do not wait for expiry.
`,
    undefined,
    ['api'],
  ),
]

const metadata: [string, string, string, string?][] = [
  ['rust', 'Deploy a Rust app', deploy],
  ['dockerfile', 'Deploy with a Dockerfile', deploy],
  ['other-runtimes', 'Bun, Ruby & PHP', deploy],
  ['builds', 'Builds & start commands', deploy],
  ['source-uploads', 'Upload local source', deploy],
  ['variables', 'Variables & secrets', configure],
  ['networking', 'Domains & networking', configure],
  ['storage', 'Databases & storage', configure],
  ['environments', 'Environments', configure],
  ['observability', 'Logs & metrics', operate],
  ['github', 'GitHub deployments', operate],
  ['scaling', 'Replicas & autoscaling', operate],
  ['jobs', 'Workers & jobs', operate],
]

const supplements: Record<string, string> = {
  builds: `## Read the build evidence\n\nSelect the build record to inspect its source commit, detected language, recipe, and output. Detection is not a guarantee that every framework layout is supported. When detection fails, check which manifest and lockfile were found at the build context root. Keep one package-manager lockfile and commit the matching manifest.\n\nA build command must terminate successfully and leave the runtime files the start command expects. A start command must keep the application in the foreground. Do not start a daemon and exit: the platform supervises the process, not a detached child.\n\n## Fix a failed build\n\nFind the first dependency or compiler error rather than the final nonzero-exit summary. Reproduce the command from a clean checkout using the same lockfile. Verify case-sensitive paths; files that appear to work on a case-insensitive laptop may be absent in Linux. Never resolve an install failure by embedding a package-registry token in a command or source URL.\n\nIf the project needs OS packages, multiple workspace packages, or a custom runtime, select Dockerfile mode and make those steps explicit. Successful compilation still needs a separate deployment and readiness check.`,
  variables: `## Put each value in the right place\n\nUse plain configuration for non-sensitive values such as NODE_ENV=production or a log-level setting. Use a secret for DATABASE_URL, signing keys, provider credentials, or any value that grants access. Give bindings descriptive names and keep application code reading those names from its process environment.\n\nCreate the secret through the workspace's secret controls and bind its name to the service. Secret values are not ordinary configuration fields; specifications contain references. A missing binding should be treated as a startup error, not silently replaced with production credentials.\n\n## Apply and verify a change\n\nReview the environment before saving. A child environment can shadow inherited configuration, so two services with the same variable name may resolve different values. Deploy a new revision after a configuration change and verify the application's behavior without printing the value.\n\nExisting deployments use pinned configuration and secret references. Rotating a secret does not justify assuming every running process has already received the new value. Follow the new deployment through readiness and retire the previous credential only after the transition is verified.\n\n## Troubleshooting\n\nFor a missing variable, inspect the service binding and the selected environment. For connection errors, check that the referenced database or external provider accepts the credential. Redaction is best effort; applications must not log passwords, tokens, connection strings, or full environment dumps.`,
  networking: `## Configure a custom domain\n\nOpen Domains, add the hostname, and choose the service target. Use a hostname you control and follow the DNS ownership instructions displayed for that record. Do not invent a verification token or point DNS at an assumed platform address.\n\nOwnership verification, route activation, and TLS are separate states. Wait for the observed route and certificate status, then make an HTTPS request to the hostname. A saved domain record alone does not prove that traffic reaches the app. Public routing must already be enabled for your workspace; ask its administrator if it is unavailable.\n\n## Private service connections\n\nKeep databases and internal workers private. Create an explicit service connection and use its generated binding rather than copying an internal IP into code. Internal addresses can change as workloads move; a connection binding records the intended relationship. Never publish a database port merely to connect two services.\n\n## Diagnose routing problems\n\nIf the private preview works but the public hostname does not, inspect DNS, ownership, route, and TLS status. If neither works, start with the application's port, listening address, readiness, and logs. A private preview URL is restricted to the platform's access boundary; it is not a public share link.`,
  storage: `## Connect an application to PostgreSQL\n\nCreate a PostgreSQL service in the application's project and environment, then wait for its actual healthy state. Open the application's database connection controls and add an explicit connection to that database. Use the injected secret binding, commonly DATABASE_URL, in your application's database client. Never copy a credential into a build command or commit it to source.\n\nRun migrations through a tested one-off job or pre-deploy command. Check the exit status and logs before promoting application code that requires the new schema. A failed pre-deploy migration blocks promotion; a successful application rollback does not reverse a migration.\n\n## Choose Redis, objects, or a volume\n\nRedis is appropriate for application caches and queues, but define how your app handles its unavailability. Object storage exposes an S3-compatible interface for files accessed through an API; it is not a mounted filesystem. A volume is a filesystem attachment for an application that needs persistent paths.\n\nVolumes are node-pinned in this release. Attaching one changes placement and recovery options and prevents treating the service as freely relocatable stateless compute. Do not assume a local volume is replicated or protected against loss of its host.\n\n## Protect application data\n\nAsk your workspace administrator which data is included in scheduled backups and how to request a restore. Verify retention and recovery through a non-production restore before depending on them. A healthy database indicator proves current runtime health, not backup coverage.\n\nUse separate databases for staging and production. Test destructive migrations against disposable data and restrict application credentials to the intended environment.`,
  environments: `## Create a staging workflow\n\nOpen the project, create a separate environment, and decide whether it should inherit from another environment. Review inherited configuration before creating services. A staging environment should use staging databases and credentials, even when the application source is identical to production.\n\nDeploy the same commit you intend to release, verify readiness and real application behavior, and record the source revision. Creating an environment does not automatically clone all runtime data, provision a database copy, or promote traffic from another environment.\n\n## Review overrides\n\nA local value can shadow a parent value with the same name. When a service behaves differently between environments, compare the effective configuration and secret bindings—not only the local fields visible in one form. Avoid printing effective secret values while debugging.\n\n## Preview isolation\n\nPull-request environments follow their source connection's preview policy. They do not automatically inherit production secrets. Grant only the explicit preview credentials required for the application and use disposable or isolated data. Closing a preview queues cleanup, but retained historical records remain useful for audit and diagnosis.`,
  observability: `## Follow a failing request\n\nStart with the service and environment that received the request. Confirm the active deployment, then select the relevant instance and time range in runtime logs. Filter by level or text, and expand a structured row to inspect fields. Compare timestamps with deployment events to distinguish a new release from a recurring application failure.\n\nRetained logs may include a process that has since stopped. Select the current instance when investigating current behavior, and select the old instance when diagnosing a previous failure. Missing log data is not proof that nothing happened; verify the selected range and collection availability.\n\n## Read resource measurements\n\nCPU is reported in millicores, memory in bytes, with process, disk, and network measurements where available. Compare observations to configured limits before changing replicas. An empty chart is missing data, not zero consumption. The platform does not currently promise request-rate analytics or distributed tracing from these charts.\n\n## Safe logging\n\nWrite application output to stdout and stderr. Structured JSON helps filtering, but never include secret values or full connection strings. Platform redaction is best effort and cannot guarantee removal of every sensitive value your application emits.\n\nFor a restart loop, inspect process exit markers and health transitions. For a failed build, open build output rather than runtime logs: the application may never have started.`,
  github: `## Prepare a source connection\n\nChoose a credential-free repository URL and the branch that should trigger builds. Configure the webhook using the connection's documented secret mechanism and delivery URL. The platform verifies signatures and deduplicates deliveries. Do not paste a signing secret into a repository URL or log it while testing.\n\nPrivate-repository checkout and GitHub App installation credentials remain release limitations. For inaccessible repositories, use local source uploads rather than assuming a GitHub sign-in grants the builder access.\n\n## Diagnose a delivery\n\nOpen the source connection's deliveries and inspect its recorded outcome. Check the event's repository and branch against the policy, then follow the resulting build. A webhook accepted by the endpoint is not proof that the source was built or deployed. A repeated delivery ID does not create another independent deployment.\n\n## Use previews safely\n\nEnable the parent source connection's preview policy deliberately. Same-repository pull requests can create isolated preview environments; forked code is not implicitly trusted with your secrets. Review preview templates, secret grants, and quotas before enabling automatic work.\n\nWhen a pull request closes, watch cleanup complete. An old healthy preview can remain available while a replacement candidate fails; inspect the displayed commit before reviewing a change.`,
  scaling: `## Choose fixed replicas first\n\nOpen the service runtime controls and set a small fixed count. Verify that requests can reach any replica without relying on local in-memory sessions. Store shared state in an appropriate external service and make startup and shutdown safe to repeat. More replicas are not a substitute for fixing a process that fails readiness.\n\n## Enable a conservative policy\n\nReview eligibility, minimum and maximum replicas, CPU target, stabilization windows, cooldown, and per-decision limits. The CPU target is a percentage of the configured CPU limit, not the physical host's total capacity. Leave capacity for candidate deployments as well as the steady-state service.\n\nStart with a minimum above zero for an application that should respond immediately. Scale-to-zero introduces a waking response while the next request starts a healthy instance; clients should tolerate that transition. It requires sustained near-idle CPU and no recent requests or open response streams.\n\n## Read the decision\n\nInspect the policy's latest decision and the observed replica count. Missing or stale metrics freeze decisions rather than pretending the service is idle. A desired count can differ from the number of ready replicas while placement or startup is in progress.\n\nVolumes, managed databases, singleton workers, pre-deploy commands, and active jobs can make a service ineligible. Keep stateful workloads out of this stateless scaling workflow.`,
  jobs: `## Test a one-off command\n\nChoose the service revision and enter a command that exits when its work is complete. Verify its configuration and database bindings first. Run it once, follow the logs, and inspect the final exit status. A queued job has not completed, and a retry may repeat external side effects.\n\nDesign imports, notifications, and billing tasks with idempotency keys or durable progress records. Do not retry a partially completed job without understanding what already happened. Keep credentials in secret bindings rather than command arguments.\n\n## Schedule only tested work\n\nCreate an interval schedule for a command that has succeeded manually. Intervals use elapsed UTC time, not cron expressions or a local timezone calendar. Review the latest run and failure behavior before relying on the schedule for time-sensitive work.\n\n## Gate a deployment\n\nA pre-deploy command is useful for backward-compatible database migrations. It must succeed before candidate instances start. Failure blocks promotion and preserves the active revision, but it cannot undo a migration that partially changed external state. Test rollback compatibility separately.\n\n## Long-running workers\n\nUse Worker execution for a queue consumer that stays running. It has no HTTP port, readiness path, or public domain, and currently runs as a singleton. Application-level fencing and idempotency remain necessary for external side effects during recovery.`,
  'source-uploads': `## Prepare a clean upload\n\nStart from a reviewed source directory. Include the application manifest, lockfile, source files, and Dockerfile when using one. Exclude dependency directories, build caches, Git metadata, private keys, and dotenv files. Inspect the archive locally before uploading; an ignored file in Git can still exist in a ZIP made from your filesystem.\n\n## Register the source\n\nChoose local upload in the new-service form. Select the supported files or ZIP archive and wait for upload completion. The resulting source digest identifies that exact content. A future edit on your laptop does not change the existing upload; upload again and create a new build.\n\nSet the build context to the directory containing the manifest or Dockerfile. Archives with an extra enclosing directory require the matching context. If detection reports no manifest, compare the archive layout with the configured root before changing build commands.\n\n## Build and verify\n\nCreate the service and build the retained upload. Follow the output and deploy only the successful image. If validation rejects paths, archive size, or unsupported content, fix the upload rather than repeatedly retrying the same file.\n\nUploads are useful for private source that the Git builder cannot fetch. They do not establish automatic deployments: each subsequent change needs a new upload and build.`,
  dockerfile: `## A complete Node.js image\n\nFor the application in the [Node.js guide](/docs/nodejs), this Dockerfile installs from the lockfile and runs as a non-root user. Keep package-lock.json alongside package.json.\n\n~~~dockerfile Dockerfile\nFROM node:22-bookworm-slim\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev\nCOPY --chown=node:node server.js ./\nUSER node\nEXPOSE 3000\nCMD ["node", "server.js"]\n~~~\n\n## Keep the context intentional\n\nAdd a .dockerignore excluding node_modules, .git, .env files, and local caches. Copy only the files required by the build and runtime. An image layer can retain a secret even if a later step deletes it, so never COPY credentials into an image.\n\nFor compiled applications, use a separate build stage and copy the compiled output into a runtime stage. Ensure runtime libraries and CA certificates are present. Pin dependencies and review base image changes through your normal release workflow.\n\n## Configure routing separately\n\nSet the service's container port and readiness path explicitly. EXPOSE does not publish a domain or create a readiness check. The process must run in the foreground and listen on every interface. Test the image locally, then build it on the platform and inspect the actual deployment outcome.`,
  rust: `## Minimal application structure\n\nStart with cargo new example-api and implement an HTTP server using your chosen framework. Commit Cargo.toml, Cargo.lock, and src. Run cargo build --locked --release locally before deploying. The server must bind to 0.0.0.0 and expose a lightweight readiness route.\n\nGenerated Rust builds do not guess which binary in a manifest you intended to run. Set an explicit command matching the binary name produced by Cargo, for example exec ./target/release/example-api. Check the build output if the expected executable is missing.\n\n## Configuration and verification\n\nCreate an App service with Automatic or Generated mode, set the container port to the port your server uses, and choose the readiness path you implemented. Build, inspect compiler errors, then deploy the successful revision. Confirm both readiness and a real endpoint before attaching a public domain.\n\nIf your application needs OpenSSL development packages, another native library, or a Cargo workspace layout, use a Dockerfile with explicit build and runtime dependencies. A successful link in a build image does not prove the final runtime image contains every required shared library.`,
  'other-runtimes': `## Choose the recipe deliberately\n\nA supported language is not a promise that every framework layout is detected. Keep the package manifest and matching lockfile at the selected context root. Use a Dockerfile for a monorepo, OS-level dependencies, or multiple competing language roots.\n\n## Bun\n\nCommit package.json and bun.lock or bun.lockb. Define the start script to run the production entrypoint and the build script if compilation is required. Bind your server to 0.0.0.0 and configure the same port in the service. Do not keep an npm or pnpm lockfile beside the Bun lockfile unless you intend to handle that ambiguity with an explicit Dockerfile.\n\n## Ruby\n\nCommit Gemfile and Gemfile.lock. Set a foreground production server command appropriate for your application, such as bundle exec puma with an explicit bind address and port. Add the application's readiness route; a Rails or Rack application should not require a signed-in session to pass readiness. Review native gem requirements and choose a Dockerfile when additional system packages are needed.\n\n## PHP\n\nCommit composer.json and composer.lock and define a production runtime command explicitly. A CLI process that exits is not an HTTP service. Frameworks with a web server, extensions, or compiled assets often need a Dockerfile to describe the complete runtime. Do not treat PHP's development server as a production deployment recommendation.\n\nFor each runtime, test the exact start command locally, build on the platform, and inspect candidate logs if readiness fails.`,
}

const inherited = metadata.map(([slug, title, group]) => {
  const guide = guideContent[slug]
  const body = guide.sections
    .map(
      (section) =>
        `## ${section.title}\n\n${section.body}${section.bullets ? '\n\n' + section.bullets.map((s) => '- ' + s).join('\n') : ''}${section.code ? '\n\n~~~' + (section.language ?? 'bash') + '\n' + section.code + '\n~~~' : ''}`,
    )
    .join('\n\n')
  return article(
    slug,
    title,
    group,
    guide.lead,
    (slug === 'other-runtimes' ? '' : body) + '\n\n' + (supplements[slug] ?? ''),
    undefined,
    ['deployments', 'observability'],
  )
})
const languages = new Set(['nodejs', 'python', 'go', 'rust', 'other-runtimes', 'dockerfile'])
const documentOrder = [
  '',
  'deployments',
  'nodejs',
  'python',
  'go',
  'rust',
  'other-runtimes',
  'dockerfile',
  'builds',
  'source-uploads',
  'health-checks',
  'rollbacks',
  'variables',
  'networking',
  'storage',
  'environments',
  'github',
  'observability',
  'scaling',
  'jobs',
  'api',
  'api-keys',
]
export const docs: Doc[] = [
  ...authored.filter((d) => d.group === start),
  ...authored.filter((d) => d.group === deploy),
  ...inherited,
  ...authored.filter((d) => d.group === 'Reference'),
]
  .map((doc) => ({ ...doc, group: languages.has(doc.slug) ? 'Languages' : doc.group }))
  .sort((a, b) => documentOrder.indexOf(a.slug) - documentOrder.indexOf(b.slug))
export const groups = [start, 'Languages', deploy, configure, operate, 'Reference']
export function navigationTitle(doc: Doc) {
  return doc.slug === '' ? 'Overview' : doc.title
}
export function headingId(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}
export function sections(doc: Doc) {
  return [...doc.body.matchAll(/^## (.+)$/gm)].map((match) => ({
    title: match[1],
    id: headingId(match[1]),
  }))
}
export function searchDocs(query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return docs
    .filter((doc) =>
      terms.every((term) =>
        `${doc.title} ${doc.description} ${doc.body}`.toLowerCase().includes(term),
      ),
    )
    .sort(
      (a, b) =>
        Number(b.title.toLowerCase().includes(query.toLowerCase())) -
        Number(a.title.toLowerCase().includes(query.toLowerCase())),
    )
    .slice(0, 8)
}
