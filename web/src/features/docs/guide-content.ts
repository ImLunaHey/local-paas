export type GuideSection = {
  id: string
  title: string
  body: string
  bullets?: string[]
  code?: string
  language?: string
  visual?: string
}
export const guideContent: Record<string, { lead: string; sections: GuideSection[] }> = {
  nodejs: {
    lead: 'This quickstart takes a Node.js repository from a committed lockfile to a healthy production URL. You do not need to write a Dockerfile for a supported standalone app.',
    sections: [
      {
        id: 'prepare',
        title: '1. Prepare your repository',
        body: 'Keep package.json and exactly one lockfile at the repository root. The generated recipe uses scripts.build when it exists and scripts.start to launch the service.',
        bullets: [
          'npm: package-lock.json',
          'pnpm: pnpm-lock.yaml',
          'Yarn: yarn.lock',
          'Bun: bun.lock or bun.lockb',
        ],
        code: `{
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "engines": { "node": ">=22" }
}`,
        language: 'json',
      },
      {
        id: 'listen',
        title: '2. Listen on the configured port',
        body: 'Bind the HTTP server to 0.0.0.0, not localhost. In the service form, set the same container port your process listens on and choose an explicit readiness path such as /health.',
        code: `const port = Number(process.env.PORT ?? 3000)
app.listen(port, '0.0.0.0')`,
        language: 'javascript',
      },
      {
        id: 'create',
        title: '3. Create the service',
        body: 'Open a project and environment, choose New service → App, connect the repository, and leave Build mode on Automatic. Select the branch or commit you want to deploy, then set the port and readiness path.',
        visual: 'service',
      },
      {
        id: 'deploy',
        title: '4. Build and deploy',
        body: 'Choose Create and build. Follow the build output until an immutable image digest is recorded, then deploy it. Traffic changes only after the candidate passes readiness and stabilization.',
        visual: 'deployment',
      },
      {
        id: 'troubleshoot',
        title: 'Common Node.js failures',
        body: 'A missing or ambiguous lockfile stops recipe detection. A missing start script requires an explicit start command. Workspace roots and unsupported native dependencies should use a reviewed Dockerfile.',
      },
    ],
  },
  python: {
    lead: 'The generated Python recipe installs a frozen uv environment. You provide the production entrypoint because the platform does not guess your framework or module layout.',
    sections: [
      {
        id: 'prepare',
        title: '1. Lock dependencies',
        body: 'Commit pyproject.toml and uv.lock at the selected build context root. Mixed-language roots, missing locks, and unsupported native system dependencies should use a Dockerfile.',
        code: `[project]
name = "example-api"
requires-python = ">=3.13"
dependencies = ["fastapi", "uvicorn[standard]"]`,
        language: 'toml',
      },
      {
        id: 'start',
        title: '2. Set the start command',
        body: 'In Build settings, use an explicit production command and bind it to every interface. Commands are visible configuration, so never include secret values.',
        code: 'exec uv run uvicorn app:app --host 0.0.0.0 --port 8000',
        language: 'bash',
      },
      {
        id: 'configure',
        title: '3. Configure the service',
        body: 'Choose Automatic or Generated build mode, set container port 8000, and configure a lightweight readiness path. Add environment variables and secrets separately from the command.',
      },
      {
        id: 'deploy',
        title: '4. Deploy',
        body: 'Create and build the service, inspect the frozen dependency install, then deploy the resulting image. The route changes only after the Python process passes readiness and stabilization.',
      },
    ],
  },
  go: {
    lead: 'The Go recipe compiles the root package to /app/app and uses that binary as the default runtime command.',
    sections: [
      {
        id: 'prepare',
        title: '1. Prepare the module',
        body: 'Commit go.mod and go.sum at the build context root. The root package must build as an application; use a Dockerfile for a monorepo or a command in another directory.',
        code: `module example.com/api

go 1.25`,
        language: 'go',
      },
      {
        id: 'listen',
        title: '2. Listen for HTTP',
        body: 'Bind the server to 0.0.0.0 and the configured container port. Keep a cheap endpoint for readiness checks.',
        code: `port := os.Getenv("PORT")
if port == "" { port = "8080" }
log.Fatal(http.ListenAndServe(":"+port, mux))`,
        language: 'go',
      },
      {
        id: 'build',
        title: '3. Build from source',
        body: 'Create an App, connect the repository, and leave build mode on Automatic. With no Dockerfile present, the locked root package is compiled into a minimal runtime image.',
      },
      {
        id: 'deploy',
        title: '4. Deploy and verify',
        body: 'Set the port and readiness path, create the build, then deploy its immutable digest. Review runtime logs and health history before assigning a production domain.',
      },
    ],
  },
  rust: {
    lead: 'Rust projects use cargo build --locked --release. Because a Cargo manifest can produce several binaries, you must state exactly what to run.',
    sections: [
      {
        id: 'prepare',
        title: '1. Commit the lockfile',
        body: 'Place Cargo.toml and Cargo.lock at the build context root. Generated recipes support standalone applications; workspaces and extra system libraries should use a Dockerfile.',
      },
      {
        id: 'command',
        title: '2. Set the runtime command',
        body: 'Set an explicit start command naming the release binary. Use exec so the process receives shutdown signals directly.',
        code: 'exec ./target/release/example-api',
        language: 'bash',
      },
      {
        id: 'network',
        title: '3. Configure networking',
        body: 'Bind the server to 0.0.0.0, set its container port in Configuration, and expose a readiness endpoint that does not depend on slow external work.',
      },
      {
        id: 'deploy',
        title: '4. Deploy the release image',
        body: 'Inspect the locked release build, deploy the recorded digest, and wait for readiness stabilization before attaching traffic.',
      },
    ],
  },
  'other-runtimes': {
    lead: 'Bun, Ruby, and PHP have reviewed generated recipes for straightforward standalone applications. More complex repositories should provide a Dockerfile.',
    sections: [
      {
        id: 'bun',
        title: 'Bun',
        body: 'Commit package.json and a Bun lockfile. The recipe uses scripts.build when present and scripts.start at runtime. A pinned Bun version must match the supported preset.',
      },
      {
        id: 'ruby',
        title: 'Ruby',
        body: 'Commit Gemfile and Gemfile.lock with an exact Bundler version, then provide an explicit start command such as exec bundle exec puma -C config/puma.rb.',
      },
      {
        id: 'php',
        title: 'PHP',
        body: 'Commit composer.json and composer.lock. Production Composer dependencies are installed during the build; provide the server command and configured port explicitly.',
      },
      {
        id: 'dockerfile',
        title: 'When to use a Dockerfile',
        body: 'Use a Dockerfile for monorepos, mixed-language roots, native OS packages, custom web servers, or any runtime layout outside the reviewed recipe contract.',
      },
    ],
  },
  dockerfile: {
    lead: 'A Dockerfile is the most explicit deployment contract. Automatic mode prefers a Dockerfile when one exists; Dockerfile mode requires it.',
    sections: [
      {
        id: 'contract',
        title: 'Dockerfile contract',
        body: 'The file and build context must be repository-relative. BuildKit runs the build in an isolated builder and records the resulting image digest. The image must support the worker CPU architecture.',
      },
      {
        id: 'example',
        title: 'Minimal example',
        body: 'Use a small runtime image, install locked dependencies, and keep the runtime command in the image.',
        code: `FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["npm", "start"]`,
        language: 'docker',
      },
      {
        id: 'runtime',
        title: 'Runtime settings',
        body: 'EXPOSE is documentation only. Set the container port and readiness path in the service configuration, and make the process listen on 0.0.0.0.',
      },
      {
        id: 'private-dependencies',
        title: 'Private dependencies',
        body: 'Build credentials are session-scoped and do not become image layers or runtime variables. Custom Dockerfile frontends and insecure BuildKit entitlements are disabled.',
      },
    ],
  },
  builds: {
    lead: 'Every build starts from pinned source and ends with either a recorded immutable image digest or an explicit failure.',
    sections: [
      {
        id: 'modes',
        title: 'Choose a build mode',
        body: 'Automatic prefers an existing Dockerfile, otherwise it detects one supported root ecosystem. Generated deliberately ignores a repository Dockerfile. Dockerfile mode never applies command overrides.',
      },
      {
        id: 'recipes',
        title: 'Generated recipes',
        body: 'Generated recipes support Node, Bun, Python, Go, Rust, Ruby, and PHP with committed lockfiles. Ambiguous roots, unsupported workspaces, and unreviewed native dependencies fail with guidance instead of guessing.',
      },
      {
        id: 'commands',
        title: 'Build and start commands',
        body: 'Overrides are captured in the generated recipe and visible in build history. Python, Go, Rust, Ruby, and PHP require an explicit start command because the platform does not infer frameworks or entrypoints.',
      },
      {
        id: 'diagnostics',
        title: 'Read build diagnostics',
        body: 'The Builds page shows source identity, detector and generator versions, effective commands, required files, image digest, and logs. A failed build cannot be deployed.',
      },
    ],
  },
  health: {
    lead: 'Health is a deployment gate and a continuous runtime signal. local/paas does not equate a built image or started process with a working application.',
    sections: [
      {
        id: 'readiness',
        title: 'Readiness checks',
        body: 'Set the container port and an explicit HTTP readiness path such as /health. The candidate must answer successfully through its worker endpoint before it can receive application traffic.',
      },
      {
        id: 'stabilization',
        title: 'Stabilization and promotion',
        body: 'After the first healthy response, the candidate remains in stabilization long enough to prove the result is not transient. Only then does the edge promote the new revision and acknowledge the route.',
        visual: 'health',
      },
      {
        id: 'continuous-health',
        title: 'Continuous health',
        body: 'Readiness, liveness, process exits, and agent reachability remain separate observations. Repeated failures withdraw an unhealthy backend and can trigger bounded restart or replacement behavior.',
      },
      {
        id: 'failed-candidate',
        title: 'When a candidate fails',
        body: 'A failure before promotion leaves the previous healthy revision serving traffic. Inspect the deployment timeline, instance health history, and logs before retrying with a corrected image or configuration.',
      },
      {
        id: 'rollback',
        title: 'Roll back a deployment',
        body: 'Choose a previous deployment with a retained image, start rollback, and wait for that revision to pass current readiness. The platform restores and acknowledges the old healthy route before stopping the failed candidate.',
      },
      {
        id: 'limits',
        title: 'Rollback limits',
        body: 'Rollback is not a time machine: it reuses an immutable image but still applies current platform availability constraints. No traffic guarantee exists when neither the current nor selected revision can become healthy.',
      },
    ],
  },
  'source-uploads': {
    lead: 'Use a ZIP or select local files when the source is not hosted by a connected Git provider.',
    sections: [
      {
        id: 'upload',
        title: 'Upload source',
        body: 'Create an App in an existing project, choose ZIP or local files, and select the source. ZIP preserves nested directories; multi-file selection packages files without compression.',
      },
      {
        id: 'limits',
        title: 'Limits',
        body: 'Archives are limited to 32 MiB compressed, 128 MiB expanded, 16 MiB per file, and 10,000 entries. Local file selection accepts 30 MiB total.',
      },
      {
        id: 'safety',
        title: 'Validation',
        body: 'Traversal, symlinks, special files, encryption, duplicate paths, .git, dotenv files, node_modules, and known credential filenames are rejected before storage and again before extraction.',
      },
      {
        id: 'retention',
        title: 'Retention and rebuilds',
        body: 'Uploads are content-addressed and deduplicated. Keep source archives with control-plane backups: rollback uses retained image digests, but a future rebuild needs the archive.',
      },
    ],
  },
  variables: {
    lead: 'Configuration names live with the service specification. Secret values live in OpenBao and never appear in API responses, audit metadata, or image layers.',
    sections: [
      {
        id: 'add',
        title: 'Add variables and secrets',
        body: 'During service creation, add name/value rows under Secrets. Existing services manage them from the Secrets tab. A successful save clears acknowledged values from the browser immediately.',
        visual: 'secrets',
      },
      {
        id: 'inheritance',
        title: 'Environment inheritance',
        body: 'Child environments can inherit secret names and values from an ancestor. A local value overrides the inherited name; removing the override exposes the inherited value again.',
      },
      {
        id: 'deployments',
        title: 'Pinned deployments',
        body: 'Each deployment pins the resolved secret bundle. Editing a value does not silently change an already-running revision; deploy a new revision to use it.',
      },
      {
        id: 'files',
        title: 'Runtime delivery',
        body: 'Workloads receive variables at process start and private read-only files under /.platform-secrets. Do not print secrets: log redaction is best effort and cannot recognize transformed values.',
      },
    ],
  },
  networking: {
    lead: 'A service becomes reachable only through an explicit port and route. Saving a domain never claims success until the edge reports a healthy route.',
    sections: [
      {
        id: 'port',
        title: 'Set the application port',
        body: 'Configure the container port your process listens on. Changing it updates desired configuration; the active revision keeps its old port until a new deployment becomes healthy.',
      },
      {
        id: 'private',
        title: 'Private service URLs',
        body: 'Networking shows the active deployment port and private HTTPS endpoint. Preview endpoints require a configured private TLS proxy forwarding to the independent ingress.',
      },
      {
        id: 'domains',
        title: 'Custom domains',
        body: 'Choose a verified domain from the global Domains registry. A domain can belong to only one service, and reassignment uses version checks so stale forms cannot overwrite ownership.',
        visual: 'domain',
      },
      {
        id: 'health',
        title: 'Routing health',
        body: 'Only healthy backends receive application traffic. If a candidate fails before promotion, the previous healthy revision remains active.',
      },
    ],
  },
  storage: {
    lead: 'Create managed data services beside applications, or attach persistent storage when a workload must keep local state.',
    sections: [
      {
        id: 'databases',
        title: 'PostgreSQL and Redis',
        body: 'Choose New service → Database, select PostgreSQL or Redis, and create it in the same project and environment as the application that uses it.',
        visual: 'database',
      },
      {
        id: 'connect',
        title: 'Connect an application',
        body: 'Use the generated service connection in the application configuration. Credentials remain secret references; the UI and API do not return raw passwords.',
      },
      {
        id: 'objects',
        title: 'Object storage',
        body: 'RustFS provides S3-compatible object storage. Create a Storage service, then use its scoped endpoint and secret references from the application.',
      },
      {
        id: 'volumes',
        title: 'Persistent volumes',
        body: 'Local volumes are pinned to a node. Treat node relocation and backup planning differently for stateful services; replicas do not make one physical host highly available.',
      },
    ],
  },
  environments: {
    lead: 'Environments partition services and configuration inside a project. New projects begin with production and development.',
    sections: [
      {
        id: 'create',
        title: 'Create an environment',
        body: 'Use the Environments page to create an empty namespace or create one from a parent. A service identity cannot move between environments; register a new service in the destination.',
      },
      {
        id: 'copy',
        title: 'Copy from a parent',
        body: 'A child copies source service specifications with new service IDs and no domains. It does not deploy, copy database contents, or copy running instances.',
      },
      {
        id: 'configuration',
        title: 'Configuration inheritance',
        body: 'Configuration is copied at creation. Secret references resolve through the ancestor chain, with local values overriding inherited names.',
      },
      {
        id: 'previews',
        title: 'Pull request previews',
        body: 'GitHub preview environments are isolated and do not inherit production configuration. Their lifecycle is controlled by the parent service preview policy.',
      },
    ],
  },
  observability: {
    lead: 'Use deployment events, logs, metrics, and health history together to understand what the platform did and what the process reported.',
    sections: [
      {
        id: 'deployments',
        title: 'Deployment timeline',
        body: 'The deployment view distinguishes building, preparing, stabilizing, promoting, draining, failed, and rolled-back states. A started process is not shown as healthy until readiness succeeds.',
      },
      {
        id: 'logs',
        title: 'Runtime logs',
        body: 'Logs include deployment and real process start/restart markers. Choose an instance to inspect retained output; sensitive values are redacted on a best-effort basis.',
      },
      {
        id: 'metrics',
        title: 'Metrics',
        body: 'Inspect recent CPU and memory use per instance alongside node reachability and deployment health. Use these measurements to tune fixed replicas and capacity.',
        visual: 'metrics',
      },
      {
        id: 'health',
        title: 'Health history',
        body: 'Readiness, liveness, process exits, restart exhaustion, and recent transitions remain distinct so a routing failure is not confused with a build failure.',
      },
    ],
  },
  github: {
    lead: 'Connect GitHub to turn branch updates and pull requests into auditable builds without giving repository code control-plane credentials.',
    sections: [
      {
        id: 'connect',
        title: 'Connect a repository',
        body: 'Create a source connection, select the repository and branch, and verify the webhook. Deliveries are signed, deduplicated, and retained with their processing outcome.',
      },
      {
        id: 'automatic',
        title: 'Automatic deployments',
        body: 'Enable the service policy for the chosen branch. Each accepted delivery resolves a commit, queues a build, and deploys only the resulting immutable image.',
      },
      {
        id: 'previews',
        title: 'Pull request previews',
        body: 'Enable previews on the parent service to create isolated environment and service records for pull requests. A failed candidate preserves the previous healthy preview revision.',
        visual: 'preview',
      },
      {
        id: 'cleanup',
        title: 'Close and clean up',
        body: 'Closing a pull request queues runtime cleanup and releases its private endpoint. Historical environment and service records remain for auditability.',
      },
    ],
  },
  scaling: {
    lead: 'Scale a stateless HTTP service to a fixed replica count, or enable CPU autoscaling when the application can safely start and stop interchangeable replicas.',
    sections: [
      {
        id: 'fixed',
        title: 'Set a fixed replica count',
        body: 'Use the Runtime controls to choose the desired number of replicas. New replicas use the active immutable image, configuration, and pinned secret references, and receive no traffic before readiness.',
      },
      {
        id: 'eligibility',
        title: 'Autoscaling eligibility',
        body: 'Autoscaling is available only for stateless HTTP services. Volumes, managed databases, singleton workers, pre-deploy commands, and active jobs make a service ineligible.',
      },
      {
        id: 'policy',
        title: 'Configure a policy',
        body: 'Choose minimum and maximum replicas, a CPU target, scale-out and scale-in stabilization windows, cooldown, and the maximum replicas changed per decision. Start conservatively and leave capacity for rollouts.',
        visual: 'scaling',
      },
      {
        id: 'decisions',
        title: 'Understand decisions',
        body: 'The controller needs fresh CPU and readiness observations from every running replica. Missing metrics freeze scaling; they are never interpreted as zero usage.',
      },
      {
        id: 'zero',
        title: 'Scale to zero',
        body: 'A minimum of zero additionally requires sustained near-idle CPU and no recent requests or open response streams. The next request uses the configured waking page while a healthy replica starts.',
      },
    ],
  },
  jobs: {
    lead: 'Not every process serves HTTP. Configure a worker for a long-running consumer, or run bounded commands as jobs, schedules, and deployment gates.',
    sections: [
      {
        id: 'workers',
        title: 'Background workers',
        body: 'Choose Worker execution for a long-running process with one replica and no port, readiness path, or domain. The image or generated recipe still defines its start command.',
      },
      {
        id: 'one-off',
        title: 'One-off jobs',
        body: 'Run an explicit command against a selected service revision and follow its output and exit status. Retrying a non-idempotent command can repeat its effects, so design jobs accordingly.',
      },
      {
        id: 'schedules',
        title: 'Scheduled jobs',
        body: 'Attach an interval schedule to a tested job command. Intervals use elapsed UTC time rather than a timezone-based cron calendar.',
      },
      {
        id: 'pre-deploy',
        title: 'Pre-deploy commands',
        body: 'Use a pre-deploy command for migrations or other gates that must succeed before candidate instances start. A failed command blocks promotion and leaves the active revision untouched.',
        visual: 'job',
      },
      {
        id: 'connections',
        title: 'Configuration and connections',
        body: 'Workers and jobs receive the same pinned configuration, secrets, and private service connections as the parent service revision.',
      },
    ],
  },
  nodes: {
    lead: 'Nodes are schedulable worker VMs. Capacity, health, labels, assignments, and relocation are visible from the Nodes page.',
    sections: [
      {
        id: 'capacity',
        title: 'Capacity and placement',
        body: 'Configured allocatable CPU and memory are distinct from current usage. The scheduler reserves resources before starting an assignment and records the selected node.',
      },
      {
        id: 'scale',
        title: 'Scale replicas',
        body: 'Set a fixed replica count from the service runtime controls. Each replica has independent placement and health; multiple worker VMs on one host are still one physical failure domain.',
      },
      {
        id: 'drain',
        title: 'Drain a node',
        body: 'Drain prevents new placement and relocates eligible stateless assignments through the same health-gated handoff used for recovery.',
      },
      {
        id: 'loss',
        title: 'Node loss',
        body: 'A missing heartbeat starts replacement only after the loss threshold. Stateful, pinned, or singleton workloads may need operator action instead of automatic relocation.',
      },
    ],
  },
  backups: {
    lead: 'A useful backup covers platform state and every external data plane needed to reconstruct or continue a workload.',
    sections: [
      {
        id: 'scope',
        title: 'What to protect',
        body: 'Back up PostgreSQL desired state and audit records, OpenBao data, retained source uploads, registry data, and the application databases or object stores you operate.',
      },
      {
        id: 'run',
        title: 'Run a backup',
        body: 'Select healthy active databases and start a backup from the control plane. An unhealthy selected database fails the run instead of producing a misleading success.',
      },
      {
        id: 'restore',
        title: 'Restore safely',
        body: 'Restore into an isolated target, verify schema and object counts, then validate an application against it before changing production references.',
      },
      {
        id: 'drills',
        title: 'Practice recovery',
        body: 'A retained archive is not a recovery guarantee. Schedule restore drills and record the time, dependencies, credentials, and manual decisions required.',
      },
    ],
  },
  upgrades: {
    lead: 'Treat an upgrade as a controlled change to the management plane, agents, database schema, and build/runtime contracts.',
    sections: [
      {
        id: 'prepare',
        title: 'Before upgrading',
        body: 'Read release notes, confirm supported host resources and CPU architecture, take verified backups, and record current node and deployment health.',
      },
      {
        id: 'control-plane',
        title: 'Upgrade the control plane',
        body: 'Apply migrations with the documented release tooling and restart management services. Do not proceed while schema or health checks are failing.',
      },
      {
        id: 'workers',
        title: 'Upgrade workers',
        body: 'Drain and update workers one at a time. Confirm agent authentication, capacity, runtime health, and a successful replacement before moving to the next node.',
      },
      {
        id: 'verify',
        title: 'Verify the release',
        body: 'Build a disposable canary, deploy it through readiness, inspect logs and metrics, test its route, and confirm rollback before declaring the upgrade complete.',
      },
    ],
  },
}
