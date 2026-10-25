import { PreDeployResult, type ReleaseJob } from './release-job'
import { Diagnostic } from './diagnostic'
import { Button } from './components/button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from './api-client'
interface Deployment {
  preDeploy?: ReleaseJob | null
  id: string
  revisionId: string
  createdAt: string
  status: string
  instances: {
    id: string
    node: string
    state: string
    diagnostic: string | null
    hasLogs: boolean
  }[]
}
interface Page {
  deployments: Deployment[]
  nextCursor: string | null
}
export function DeploymentHistory({ serviceId }: { serviceId: string }) {
  const history = useInfiniteQuery({
    queryKey: ['deployment-history', serviceId],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page>(
        '/services/' + serviceId + '/deployments' + (pageParam ? '?before=' + pageParam : ''),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 10000,
  })
  return (
    <section aria-label="Deployment history" className="space-y-3">
      <h3 className="text-sm">Deployment history</h3>
      <p className="text-xs text-muted">
        Open an instance’s retained logs, including stopped and replaced instances.
      </p>
      {history.error && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {history.error.message}
        </p>
      )}
      {history.isPending && <p className="text-xs text-muted">Loading deployments…</p>}
      {history.data?.pages[0].deployments.length === 0 && (
        <p className="text-xs text-muted">No deployments yet.</p>
      )}
      {history.data?.pages
        .flatMap((p) => p.deployments)
        .map((d) => (
          <details
            key={d.id}
            className="history-deployment [border:1px_solid_light-dark(#e4e4e7,_#29292d)] [border-radius:8px] [overflow:hidden] [&_>_summary]:[display:flex] [&_>_summary]:[flex-wrap:wrap] [&_>_summary]:[align-items:center] [&_>_summary]:[gap:12px] [&_>_summary]:[padding:12px] [&_>_summary]:[cursor:pointer] [&_>_summary]:[background:light-dark(#f4f4f5,_#19191c)] [&_>_summary]:[font-size:12px] [&_time]:[color:light-dark(#52525b,_#9999a4)] [&_time]:[margin-left:auto]"
            open
          >
            <summary>
              <span
                className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]"
                data-state={d.status === 'active' ? 'succeeded' : d.status}
              >
                {d.status === 'releasing' ? 'Pre-deploy' : d.status}
              </span>
              <code>{d.id.slice(0, 8)}</code>
              <time dateTime={d.createdAt}>{new Date(d.createdAt).toLocaleString()}</time>
            </summary>
            {d.preDeploy && (
              <div className="px-4 py-3">
                <PreDeployResult job={d.preDeploy} serviceId={serviceId} />
              </div>
            )}
            {d.instances.map((i) => (
              <div
                className="border-t border-zinc-800 px-4 py-3"
                key={i.id}
                data-has-logs={i.hasLogs}
                data-instance-history
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
                    <span>{i.node}</span>
                    <code>{i.id.slice(0, 8)}</code>
                    <span className="text-muted">{i.state}</span>
                  </div>
                  <Link
                    className="button secondary shrink-0 [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
                    to="/services/$serviceId/logs"
                    params={{ serviceId }}
                    search={{ instance: i.id }}
                  >
                    View logs
                  </Link>
                </div>
                {i.diagnostic && <Diagnostic code={i.diagnostic} />}
              </div>
            ))}
            {!d.instances.length && (
              <p className="text-xs text-muted p-3">No instances were assigned.</p>
            )}
          </details>
        ))}
      {history.hasNextPage && (
        <Button disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
          Older deployments
        </Button>
      )}
    </section>
  )
}
