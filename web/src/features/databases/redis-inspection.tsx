import { number, bytes, ratio, keyspaceFields } from './database-inspection-format'
import { DataTable } from './database-data-table'
import { Stat } from './database-stat'
import type { Snapshot } from './database-inspection-types'

export function RedisInspection({ snapshot }: { snapshot: Snapshot }) {
  const s = snapshot.stats
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Memory used"
          value={bytes(s.usedMemory)}
          hint={`Limit ${s.maxmemory === 0 ? 'unlimited' : bytes(s.maxmemory)} · peak ${bytes(s.usedMemoryPeak)}`}
        />
        <Stat
          label="Connected clients"
          value={number(s.connectedClients)}
          hint={`${number(s.blockedClients)} blocked · includes inspector`}
        />
        <Stat
          label="Commands / second"
          value={number(s.instantaneousOpsPerSec)}
          hint={`${number(s.totalCommandsProcessed)} processed since start`}
        />
        <Stat
          label="Cache hit rate"
          value={ratio(s.keyspaceHits, s.keyspaceMisses)}
          hint={`${number(s.keyspaceHits)} hits · ${number(s.keyspaceMisses)} misses`}
        />
      </div>
      <DataTable
        title="Keyspaces"
        fields={keyspaceFields}
        data={snapshot.keyspaces ?? []}
        empty="No keys stored yet."
      />
      <section className="panel p-5">
        <h3 className="text-sm font-medium">Persistence and eviction</h3>
        <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              'Append-only file',
              s.aofEnabled === 1 ? 'Enabled' : s.aofEnabled === 0 ? 'Disabled' : '—',
            ],
            ['Last AOF write', s.aofLastWriteStatus ?? '—'],
            ['Last AOF rewrite', s.aofLastBgrewriteStatus ?? '—'],
            [
              'AOF rewrite',
              s.aofRewriteInProgress === 1
                ? 'In progress'
                : s.aofRewriteInProgress === 0
                  ? 'Idle'
                  : '—',
            ],
            ['Last snapshot', s.rdbLastBgsaveStatus ?? '—'],
            ['Process memory (RSS)', bytes(s.usedMemoryRss)],
            ['Evicted keys', number(s.evictedKeys)],
            ['Expired keys', number(s.expiredKeys)],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-2 text-sm tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
