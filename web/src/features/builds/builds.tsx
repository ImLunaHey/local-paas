import { BuildWorkerStatus } from './build-worker-status'
import { ImageRevisions } from './image-revisions'
import { BuildHistory } from './build-history'

import { BuildRequestForm } from './build-request-form'
import { BuildLogs } from './build-logs'

import { useServiceBuilds } from './use-service-builds'

import { Hammer, Terminal } from 'lucide-react'

import type { Service } from '../../generated/model/service'

export function BuildPanel({ service }: { service: Service }) {
  const {
    setSelectedId,
    uploaded,
    sourceKind,
    setSourceKind,
    commit,
    setCommit,
    noCache,
    setNoCache,
    database,
    enabled,
    history,
    system,
    revisions,
    selected,
    busy,
    create,
    cancel,
  } = useServiceBuilds({ service })
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

  return (
    <section className="panel p-6 mb-7 space-y-5" aria-label="Service builds">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2">
          <Hammer size={17} /> Builds & revisions
        </h2>
        <BuildWorkerStatus system={system} />
      </div>
      <p className="text-xs text-muted">
        Build an immutable image from Git or uploaded source. Building does not deploy or change
        traffic.
      </p>
      <div className="build-workspace">
        <div className="build-controls space-y-4">
          <BuildRequestForm
            database={database}
            uploaded={uploaded}
            sourceKind={sourceKind}
            setSourceKind={setSourceKind}
            commit={commit}
            setCommit={setCommit}
            noCache={noCache}
            setNoCache={setNoCache}
            create={create}
            busy={busy}
            history={history}
          />
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
          {
            <BuildHistory
              history={history}
              selected={selected}
              setSelectedId={setSelectedId}
              cancel={cancel}
            />
          }
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
      <ImageRevisions revisions={revisions} />
    </section>
  )
}
