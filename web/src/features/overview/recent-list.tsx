import { Status } from '../../components/status'

import type { Recent } from './overview-types'

import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Box, GitBranch } from 'lucide-react'

export function RecentList({ items, builds = false }: { items: Recent[]; builds?: boolean }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <h2>{builds ? 'Recent builds' : 'Latest deployments'}</h2>
        <span className="text-xs text-muted">
          {builds ? 'Source → image' : 'Image → application'}
        </span>
      </div>
      {items.length === 0 && (
        <div className="p-10 text-center text-sm text-muted">
          {builds
            ? 'Your first build will appear here.'
            : 'Deploy a revision to see its progress here.'}
        </div>
      )}
      {items.map((item) => (
        <Link
          key={item.id}
          to={builds ? '/services/$serviceId/builds' : '/services/$serviceId/activity'}
          params={{ serviceId: item.serviceId }}
          className="flex items-center gap-3 border-b border-zinc-800/70 px-5 py-4 last:border-0 hover:bg-zinc-800/30"
        >
          <span className="hidden sm:grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-800 text-muted">
            {builds ? <GitBranch size={16} /> : <Box size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{item.service}</div>
            <div className="mt-1 truncate text-xs text-muted">
              {item.project} / {item.environment}
            </div>
            {item.errorCode && (
              <div className="mt-1 truncate text-xs text-red-300">
                {item.errorCode.replaceAll('_', ' ')}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <Status value={item.status} />
            <time dateTime={item.createdAt} className="mt-2 block text-[10px] text-muted">
              {new Date(item.createdAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
          <ArrowUpRight size={14} className="hidden sm:block text-muted" />
        </Link>
      ))}
    </section>
  )
}
