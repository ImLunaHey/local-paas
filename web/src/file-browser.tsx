import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Folder, File, Download, RefreshCw, Upload } from 'lucide-react'
import { api } from './api-client'
import type { Service } from './generated/model/service'
import { Button } from './components/button'
import { Input } from './components/input'
const fileSizeFormatter = new Intl.NumberFormat()

interface Listing {
  items: { path: string; kind: 'file' | 'directory'; size?: number; modified?: string }[]
  cursor?: string | null
  readOnly: boolean
  limitBytes: number
}
export function FileBrowser({ service, kind }: { service: Service; kind: 'objects' | 'volume' }) {
  const search = useSearch({ strict: false }) as { path?: string }
  const prefix = search.path ?? ''
  const navigate = useNavigate()
  const client = useQueryClient()
  const [cursor, setCursor] = useState('')
  const endpoint =
    '/services/' + service.id + (kind === 'objects' ? '/storage/files' : '/volume/files')
  const query = useQuery({
    queryKey: ['storage-files', service.id, kind, prefix, cursor],
    queryFn: () =>
      api<Listing>(
        endpoint + '?' + new URLSearchParams({ path: prefix, ...(cursor ? { cursor } : {}) }),
      ),
  })
  const upload = useMutation({
    mutationFn: async (files: globalThis.File[]) => {
      for (const file of files) {
        if (file.size > (query.data?.limitBytes ?? 16 * 1024 * 1024))
          throw new Error(file.name + ' exceeds the 16 MiB transfer limit')
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- Serialize transfers to bound memory/agent load and stop at the first failed upload.
        await api(endpoint + '?' + new URLSearchParams({ path: prefix + file.name }), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        })
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['storage-files', service.id] }),
  })
  const change = (path: string) => {
    setCursor('')
    void navigate({
      to: '/services/$serviceId/storage',
      params: { serviceId: service.id },
      search: { browse: kind, path },
    })
  }
  const parent = prefix.replace(/[^/]+\/$/, '')
  return (
    <section className="panel p-5 sm:p-6 space-y-5 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h2>Browse {kind === 'objects' ? 'bucket' : 'volume'}</h2>
          <p className="mt-1 text-xs text-muted break-all">/{prefix}</p>
        </div>
        <Link
          className="text-xs text-muted"
          to="/services/$serviceId/storage"
          params={{ serviceId: service.id }}
          search={{}}
        >
          Storage settings
        </Link>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <Button disabled={!prefix} onClick={() => change(parent)}>
          <ArrowLeft size={14} />
          Parent folder
        </Button>
        <Button aria-label="Refresh files" onClick={() => void query.refetch()}>
          <RefreshCw size={14} />
        </Button>
        {!query.data?.readOnly && query.data && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-3 text-xs">
            <Upload size={14} />
            {upload.isPending ? 'Uploading…' : 'Upload files'}
            <Input
              className="hidden"
              aria-label="Upload storage files"
              type="file"
              multiple
              disabled={upload.isPending}
              onChange={(e) => {
                if (e.target.files?.length) upload.mutate(Array.from(e.target.files))
                e.target.value = ''
              }}
            />
          </label>
        )}
        {query.data?.readOnly && (
          <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
            Read only
          </span>
        )}
      </div>
      {(query.error || upload.error) && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(query.error || upload.error)?.message}
        </p>
      )}
      {query.isPending ? (
        <p className="text-xs text-muted">Loading files…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 text-muted">
              <tr>
                <th className="py-3 font-medium">Name</th>
                <th className="px-4 font-medium text-right">Size</th>
                <th className="font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {query.data?.items.map((f) => (
                <tr key={f.path}>
                  <td className="py-4 max-w-72">
                    <div className="flex items-center gap-2 min-w-0">
                      {f.kind === 'directory' ? (
                        <Folder size={15} className="shrink-0 text-orange-300" />
                      ) : (
                        <File size={15} className="shrink-0 text-muted" />
                      )}
                      {f.kind === 'directory' ? (
                        <button
                          type="button"
                          className="text-left break-all hover:text-orange-300"
                          onClick={() => change(f.path)}
                        >
                          {f.path.slice(prefix.length).replace(/\/$/, '')}
                        </button>
                      ) : (
                        <span className="break-all">{f.path.slice(prefix.length)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 text-right text-muted whitespace-nowrap">
                    {f.kind === 'file' ? fileSizeFormatter.format(f.size ?? 0) + ' B' : '—'}
                  </td>
                  <td className="text-right">
                    {f.kind === 'file' && (
                      <a
                        className="inline-flex p-2 text-muted hover:text-white"
                        aria-label={'Download ' + f.path}
                        download={f.path.split('/').pop()}
                        href={
                          '/api' +
                          endpoint +
                          '?' +
                          new URLSearchParams({ path: f.path, download: 'true' })
                        }
                      >
                        <Download size={16} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.data?.items.length === 0 && (
            <p className="py-8 text-center text-muted text-sm">This folder is empty.</p>
          )}
        </div>
      )}
      {query.data?.cursor && (
        <Button onClick={() => setCursor(query.data!.cursor!)}>Next page</Button>
      )}
      {upload.isSuccess && (
        <p role="status" className="text-xs text-emerald-300">
          Files uploaded.
        </p>
      )}
      <p className="text-xs text-muted">
        Transfers are limited to 16 MiB per file. Uploads keep existing files intact; use a
        different filename to add another version.
      </p>
    </section>
  )
}
