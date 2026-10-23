import { Diagnostic } from './diagnostic'
import { Button } from './ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from './api'
interface Deployment {
  id: string
  revision_id: string
  created_at: string
  status: string
  instances: {
    id: string
    node: string
    state: string
    diagnostic: string | null
    has_logs: boolean
  }[]
}
interface Page {
  deployments: Deployment[]
  next_cursor: string | null
}
export function DeploymentHistory({ serviceId }: { serviceId: string }) {
  const history = useInfiniteQuery({
    queryKey: ['deployment-history', serviceId],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page>(
        '/services/' + serviceId + '/deployments' + (pageParam ? '?before=' + pageParam : ''),
      ),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: 10000,
  })
  return (
    <section aria-label="Deployment history" className="space-y-3">
      <h3 className="text-sm">Deployment history</h3>
      <p className="text-xs text-muted">
        Open an instance’s retained logs, including stopped and replaced instances.
      </p>
      {history.error && (
        <p role="alert" className="error-notice">
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
          <details key={d.id} className="history-deployment" open>
            <summary>
              <span className="chip" data-state={d.status === 'active' ? 'succeeded' : d.status}>
                {d.status}
              </span>
              <code>{d.id.slice(0, 8)}</code>
              <time dateTime={d.created_at}>{new Date(d.created_at).toLocaleString()}</time>
            </summary>
            {d.instances.map((i) => (
              <div
                className="border-t border-zinc-800 px-4 py-3"
                key={i.id}
                data-has-logs={i.has_logs}
                data-instance-history
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
                    <span>{i.node}</span>
                    <code>{i.id.slice(0, 8)}</code>
                    <span className="text-muted">{i.state}</span>
                  </div>
                  <Link
                    className="button secondary shrink-0"
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
