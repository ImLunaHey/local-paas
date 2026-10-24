import { Button, Input, Select } from './ui'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Hammer, LoaderCircle, RefreshCw, Terminal, X } from 'lucide-react'
import { api, sourceLabel, sourceReference } from './api'
import type { Build, Revision, Service, SourceKind } from './api'

const active = (build?: Build) => build?.status === 'queued' || build?.status === 'running'
const errors: Record<string, string> = {
  auto_ignore_unsupported:
    'The .dockerignore contains patterns automatic generation cannot safely translate. Provide a Dockerfile for this app.',
  context_exclusion_failed:
    'This diagnostic image was invalidated after a remote-context exclusion issue. Queue a new build with the corrected generator.',
  auto_language_unsupported:
    'No Dockerfile or supported package.json found in the build context. Add a Dockerfile or choose the directory containing your app.',
  auto_provider_unsupported:
    'Automatic detection currently supports public GitHub repositories. Choose Repository Dockerfile only for other hosts.',
  auto_source_unavailable:
    'Could not inspect source metadata. Check repository access and retry; automatic detection does not bypass network or permission failures.',
  auto_package_invalid:
    'package.json or its scripts are invalid. Fix the manifest or supply a Dockerfile.',
  auto_start_missing:
    'Set a Start command in Configuration, add scripts.start to package.json, or provide a Dockerfile with an explicit startup command.',
  auto_lockfile_missing:
    'Commit a package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, yarn.lock, bun.lock or bun.lockb for reproducible dependency installation.',
  auto_package_manager_conflict:
    'Lockfiles and packageManager disagree, multiple package managers were detected, or the packageManager version is not exact. Keep one package manager or provide a Dockerfile.',
  auto_runtime_unsupported:
    'The declared runtime version is outside the pinned Node 22/24 or Bun 1.4.4 presets. Provide a Dockerfile for another runtime version.',
  auto_workspace_unsupported:
    'Workspace projects need an explicit Dockerfile for now. Automatic detection supports standalone application packages.',
  uploaded_source_invalid:
    'The uploaded source is missing, corrupt or exceeds archive limits. Upload it again in Configuration.',
  source_ref_not_found: 'The requested branch or tag does not exist in the repository.',
  source_resolution_failed:
    'Could not resolve the source reference. Check repository access and retry.',
  build_failed: 'BuildKit reported a failure. Review the build output below.',
  build_client_failed: 'The build client could not start or read output. Check the builder setup.',
  build_timeout: 'The build exceeded its configured time limit.',
  worker_lease_expired:
    'The worker stopped reporting. Its result cannot become a revision; queue a new build to retry.',
  worker_lease_lost: 'The worker lost its lease. Queue a new build to retry.',
  repository_not_allowed: 'This repository host is not on the builder allowlist.',
  builder_configuration: 'The builder configuration is incomplete or invalid.',
  invalid_image_metadata: 'The builder returned no valid image digest. No revision was created.',
}

export function BuildPanel({ service }: { service: Service }) {
  const client = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const uploaded = !!service.spec.source?.upload
  const initialRef = sourceReference(service.spec.source)
  const [sourceKind, setSourceKind] = useState<SourceKind>(initialRef.kind)
  const [commit, setCommit] = useState(initialRef.value)
  const [noCache, setNoCache] = useState(false)
  const operation = useRef<{ input: string; id: string } | null>(null)
  const database =
    service.spec.workload.kind === 'postgres-service' ||
    service.spec.workload.kind === 'redis-service' ||
    service.spec.workload.kind === 'rustfs-service'
  const enabled = service.spec.workload.kind !== 'celld-service'
  const history = useQuery({
    queryKey: ['builds', service.id],
    enabled,
    queryFn: () => api<Build[]>(`/services/${service.id}/builds`),
    refetchInterval: 2000,
  })
  const system = useQuery({
    queryKey: ['build-system'],
    enabled,
    queryFn: () => api<{ workerOnline: boolean }>('/build-system'),
    refetchInterval: 5000,
  })
  const revisions = useQuery({
    queryKey: ['revisions', service.id],
    enabled,
    queryFn: () => api<Revision[]>(`/services/${service.id}/revisions`),
    refetchInterval: 3000,
  })
  const selected = history.data?.find((build) => build.id === selectedId) ?? history.data?.[0]
  const busy = history.data?.some(active) ?? false
  const create = useMutation({
    mutationFn: () => {
      const input = JSON.stringify({ [sourceKind]: commit.trim(), noCache: noCache })
      if (operation.current?.input !== input) operation.current = { input, id: crypto.randomUUID() }
      return api<Build>(`/services/${service.id}/builds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(database || uploaded ? {} : { [sourceKind]: commit.trim() }),
          noCache: noCache,
          operationId: operation.current.id,
        }),
      })
    },
    onSuccess: async (build) => {
      operation.current = null
      setSelectedId(build.id)
      await client.invalidateQueries({ queryKey: ['builds', service.id] })
      await client.invalidateQueries({ queryKey: ['events', service.id] })
    },
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api<Build>(`/builds/${id}/cancel`, { method: 'POST' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['builds', service.id] })
      await client.invalidateQueries({ queryKey: ['events', service.id] })
    },
  })
  if (!enabled)
    return (
      <section className="panel p-6 mb-7" aria-label="Fleet deployments">
        <h2>Fleet deployments</h2>
        <p className="text-muted text-xs mt-3">
          celld uses a separate deployment runner. OCI build actions do not apply to this
          application.
        </p>
      </section>
    )
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!busy && !create.isPending) create.mutate()
  }
  return (
    <section className="panel p-6 mb-7 space-y-5" aria-label="Service builds">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2">
          <Hammer size={17} /> Builds & revisions
        </h2>
        <span className="chip">
          {system.isError
            ? 'Builder status unavailable'
            : system.isPending
              ? 'Checking builder…'
              : system.data.workerOnline
                ? 'Build worker connected'
                : 'Waiting for builder'}
        </span>
      </div>
      <p className="text-xs text-muted">
        Build an immutable image from Git or uploaded source. Building does not deploy or change
        traffic.
      </p>
      <div className="build-workspace">
        <div className="build-controls space-y-4">
          <form onSubmit={submit} className="space-y-3">
            <fieldset
              disabled={database || uploaded}
              hidden={database || uploaded}
              className="space-y-3"
            >
              <label className="field">
                <span>Build source type</span>
                <Select
                  className="build-select"
                  value={sourceKind}
                  onChange={(event) => setSourceKind(event.target.value as SourceKind)}
                  disabled={create.isPending}
                >
                  <option value="branch">Branch</option>
                  <option value="tag">Tag</option>
                  <option value="commit">Commit</option>
                </Select>
              </label>
              <label className="field">
                <span>
                  {sourceKind === 'commit'
                    ? 'Build commit SHA'
                    : sourceKind === 'branch'
                      ? 'Build branch'
                      : 'Build tag'}
                </span>
                <Input
                  className="font-mono"
                  value={commit}
                  onChange={(event) => setCommit(event.target.value)}
                  pattern={sourceKind === 'commit' ? '([a-f0-9]{40}|[a-f0-9]{64})' : undefined}
                  required
                  disabled={create.isPending}
                />
              </label>
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-xs text-muted">
                <Input
                  type="checkbox"
                  checked={noCache}
                  onChange={(event) => setNoCache(event.target.checked)}
                  disabled={create.isPending}
                />
                Bypass build cache
              </label>
              <Button
                variant="primary"
                type="submit"
                disabled={busy || create.isPending || history.isPending || history.isError}
              >
                {create.isPending ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <Hammer size={15} />
                )}
                Queue build
              </Button>
            </div>
          </form>
          {!system.isPending && !system.isError && !system.data.workerOnline && (
            <p className="text-xs text-muted border-l-2 border-line pl-3">
              Requests stay queued until an isolated builder connects. No build runs on the
              control-plane host.
            </p>
          )}
          {(create.error || cancel.error || history.error) && (
            <p className="error-notice" role="alert">
              {(create.error || cancel.error || history.error)?.message}
            </p>
          )}
          {history.data?.length === 0 && (
            <p className="text-xs text-muted py-4">
              No builds yet. Queue the first build when the source is ready.
            </p>
          )}
          {!!history.data?.length && (
            <>
              <label className="field">
                <span>Build history (latest 50)</span>
                <Select
                  className="build-select"
                  value={selected?.id}
                  onChange={(event) => {
                    setSelectedId(event.target.value)
                    cancel.reset()
                  }}
                >
                  {history.data.map((build) => (
                    <option key={build.id} value={build.id}>
                      {new Date(build.createdAt).toLocaleString()} ·{' '}
                      {sourceLabel(build.spec.source)} · {build.status}
                    </option>
                  ))}
                </Select>
              </label>
              {selected && (
                <div className="space-y-4">
                  <div className="flex flex-wrap justify-between items-center gap-3">
                    <span className="flex gap-2 items-center">
                      <span
                        className="chip"
                        data-testid="build-status"
                        data-state={selected.status}
                      >
                        {selected.cancelRequested && active(selected)
                          ? 'Cancellation requested'
                          : selected.status}
                      </span>
                      <span className="text-xs text-muted">
                        {selected.noCache ? 'Cache bypassed' : 'Cache allowed'}
                      </span>
                    </span>
                    {active(selected) && (
                      <Button
                        variant="secondary"
                        disabled={cancel.isPending || selected.cancelRequested}
                        onClick={() => cancel.mutate(selected.id)}
                      >
                        <X size={14} />
                        Cancel build
                      </Button>
                    )}
                  </div>
                  {selected.resolvedCommit && (
                    <p className="text-xs text-muted break-all">
                      Resolved commit <code>{selected.resolvedCommit}</code>
                    </p>
                  )}
                  {selected.buildPlan?.kind === 'generated' && (
                    <details className="text-xs min-w-0">
                      <summary className="cursor-pointer text-accent">
                        Generated Dockerfile · {selected.buildPlan.runtime} ·{' '}
                        {selected.buildPlan.packageManager}
                      </summary>
                      <pre className="spec-preview mt-3" aria-label="Generated Dockerfile">
                        {selected.buildPlan.dockerfile}
                      </pre>
                      <p className="text-muted mt-2">
                        Saved with this build. Dotenv files, .npmrc and local dependencies are
                        excluded when copying the app into the image.
                      </p>
                    </details>
                  )}
                  {selected.buildPlan?.kind === 'dockerfile' && (
                    <p className="text-xs text-muted">
                      Repository Dockerfile: <code>{selected.buildPlan.path}</code>
                    </p>
                  )}
                  {selected.errorCode && (
                    <p className="error-notice">
                      {errors[selected.errorCode] ?? selected.errorCode}
                    </p>
                  )}
                  {selected.status === 'queued' && (
                    <p className="text-xs text-muted">
                      Saved in the build queue. Waiting for the worker to claim it.
                    </p>
                  )}
                  {selected.status === 'succeeded' && (
                    <p className="text-xs text-accent">
                      Image pushed and revision recorded. Use Deploy revision to start this image.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="build-console">
          {selected ? (
            <BuildLogs key={selected.id} build={selected} />
          ) : (
            <div className="console-empty">
              <Terminal size={24} strokeWidth={1.4} />
              <span>Build output</span>
              <p>Queue a build to follow its progress here.</p>
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-line pt-5">
        <h3 className="flex items-center gap-2">
          <Box size={15} />
          Image revisions
        </h3>
        {revisions.isError ? (
          <p className="error-notice mt-3" role="alert">
            {revisions.error.message}
          </p>
        ) : !revisions.data?.length ? (
          <p className="text-xs text-muted mt-3">
            {revisions.isPending
              ? 'Loading revisions…'
              : 'A revision appears only after a successful image push.'}
          </p>
        ) : (
          <div className="space-y-3 mt-3">
            {revisions.data.map((revision) => (
              <div key={revision.id} className="revision-row text-xs">
                <time className="text-muted">{new Date(revision.createdAt).toLocaleString()}</time>
                <code className="block text-accent break-all mt-2">
                  {revision.imageRepository}@{revision.imageDigest}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

interface LogPage {
  entries: { sequence: number; message: string }[]
  nextCursor: number
  truncated: boolean
}
interface AccumulatedLogs {
  text: string
  cursor: number
  truncated: boolean
}

function BuildLogs({ build }: { build: Build }) {
  const client = useQueryClient()
  const queryKey = ['build-logs', build.id]
  const logs = useQuery({
    queryKey,
    queryFn: async () => {
      const result = {
        ...(client.getQueryData<AccumulatedLogs>(queryKey) ?? {
          text: '',
          cursor: 0,
          truncated: false,
        }),
      }
      for (let page = 0; page < 32; page++) {
        const chunk = await api<LogPage>(`/builds/${build.id}/logs?after=${result.cursor}`)
        result.text += chunk.entries.map((entry) => entry.message).join('')
        result.cursor = chunk.nextCursor
        result.truncated = chunk.truncated
        if (chunk.entries.length < 128) break
      }
      return result
    },
    refetchInterval: 2000,
  })
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3>Build output</h3>
        <Button
          className="text-muted"
          aria-label="Refresh build logs"
          onClick={() => {
            void logs.refetch()
          }}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      {logs.isError && (
        <p className="error-notice mb-3" role="alert">
          {logs.error.message}
        </p>
      )}
      <pre className="build-log" aria-label="Build output">
        {logs.data?.text || (logs.isPending ? 'Loading build output…' : 'No build output yet.')}
      </pre>
      {logs.data?.truncated && (
        <p className="text-xs text-muted mt-2">
          Output reached its storage limit. Remaining output was discarded; build execution can
          continue.
        </p>
      )}
    </div>
  )
}
