import { BuildWorkerStatus } from './build-worker-status'
import { ImageRevisions } from './image-revisions'
import { BuildHistory } from './build-history'

import { BuildRequestForm } from './build-request-form'
import { BuildLogs } from './build-logs'
import { SourceAutomation } from './source-automation'

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
      <section
        className="panel p-6 mb-7 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
        aria-label="Fleet deployments"
      >
        <h2>Fleet deployments</h2>
        <p className="text-muted text-xs mt-3">
          celld uses a separate deployment runner. OCI build actions do not apply to this
          application.
        </p>
      </section>
    )

  return (
    <>
      <section
        className="panel p-6 mb-7 space-y-5 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
        aria-label="Service builds"
      >
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
        <div className="build-workspace [display:grid] [grid-template-columns:minmax(260px,_0.85fr)_minmax(0,_1.4fr)] [gap:28px] [padding-top:6px] max-[1100px]:[grid-template-columns:minmax(0,_1fr)]">
          <div className="build-controls space-y-4 [min-width:0]">
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
              <p
                className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
                role="alert"
              >
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
          <div className="build-console [min-width:0] [&_.build-log]:[min-height:280px] [&_.build-log]:[max-height:390px]">
            {selected ? (
              <BuildLogs key={selected.id} build={selected} />
            ) : (
              <div className="console-empty [height:100%] [min-height:280px] [border:1px_solid_light-dark(#e4e4e7,_#242427)] [border-radius:7px] [background:light-dark(#fafafa,_#0b0b0d)] [display:flex] [align-items:center] [justify-content:center] [flex-direction:column] [gap:12px] [color:light-dark(#52525b,_#a0a0a8)] [font-size:12px] [&_p]:[font-size:11px] [&_p]:[text-align:center] [&_p]:[padding:0_15px]">
                <Terminal size={24} strokeWidth={1.4} />
                <span>Build output</span>
                <p>Queue a build to follow its progress here.</p>
              </div>
            )}
          </div>
        </div>
        <ImageRevisions revisions={revisions} />
      </section>
      {service.spec.source?.repository?.includes('github.com') && (
        <SourceAutomation service={service} />
      )}
    </>
  )
}
