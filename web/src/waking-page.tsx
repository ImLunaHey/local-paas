import { lazy, Suspense, useDeferredValue, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api-client'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'
import { Select } from './components/select'
import { cn } from 'cn'
import { wakingPagePreview } from './waking-page-preview'
import type { WakingPageState } from './generated/model/wakingPageState'

const maxBytes = 128 * 1024
const HtmlEditor = lazy(() =>
  import('./components/html-editor').then((module) => ({ default: module.HtmlEditor })),
)
const editorFallback = <p className="h-[480px] p-4 text-xs text-muted">Loading HTML editor…</p>

function download(html: string, filename: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function PageEditor({
  serviceId,
  serviceName,
  state,
}: {
  serviceId: string
  serviceName: string
  state: WakingPageState
}) {
  const client = useQueryClient()
  const saved = state.html ?? state.starterTemplate
  const [draft, setDraft] = useState(saved)
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [previewWidth, setPreviewWidth] = useState('full')
  const previewDraft = useDeferredValue(draft)
  const changed = draft !== saved
  const save = useMutation({
    mutationFn: (html: string | null) => {
      if (html !== null) {
        if (new TextEncoder().encode(html).byteLength > maxBytes)
          throw new Error('The HTML must be 128 KiB or smaller.')
        if (html.split('{{readiness_script}}').length !== 2)
          throw new Error('Include {{readiness_script}} exactly once, before </body>.')
      }
      return api<WakingPageState>(`/services/${serviceId}/waking-page`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedVersion: state.version,
          html,
        }),
      })
    },
    onSuccess: (data) => client.setQueryData(['waking-page', serviceId], data),
  })
  async function loadFile(file: File | undefined) {
    if (!file) return
    setFileError(null)
    setLoadingFile(true)
    try {
      if (!/\.html?$/i.test(file.name)) throw new Error('Choose an .html or .htm file.')
      if (file.size > maxBytes) throw new Error('The HTML file must be 128 KiB or smaller.')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      setDraft(content)
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : 'The file could not be read as UTF-8 HTML.',
      )
    } finally {
      setLoadingFile(false)
    }
  }
  const busy = save.isPending || loadingFile
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(draft)
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-xs text-muted">
          {changed
            ? 'Unsaved changes'
            : state.html == null
              ? 'Using the dashboard-themed default page.'
              : 'Custom HTML page saved.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setDraft(state.starterTemplate)}
          >
            Use starter template
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => download(draft, 'waking-page.html')}
          >
            Download HTML
          </Button>
        </div>
      </div>
      <Field
        label="Import HTML file"
        hint="Optional: load a UTF-8 .html file into the editor. Maximum 128 KiB."
      >
        <Input
          type="file"
          accept=".html,.htm,text/html"
          disabled={busy}
          onChange={(event) => {
            void loadFile(event.target.files?.[0])
            event.currentTarget.value = ''
          }}
        />
      </Field>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <section
          className="min-w-0 overflow-hidden rounded-lg border border-line"
          aria-label="HTML editor"
        >
          <div className="flex h-12 items-center justify-between gap-3 border-b border-line bg-zinc-900 px-4 text-xs">
            <span className="font-medium">HTML template</span>
            <span className="text-muted">
              {(new TextEncoder().encode(draft).byteLength / 1024).toFixed(1)} / 128 KiB
            </span>
          </div>
          <Suspense fallback={editorFallback}>
            <HtmlEditor value={draft} onChange={setDraft} disabled={busy} />
          </Suspense>
        </section>
        <section
          className="min-w-0 overflow-hidden rounded-lg border border-line"
          aria-label="Page preview"
        >
          <div className="flex h-12 items-center justify-between gap-3 border-b border-line bg-zinc-900 px-4 text-xs">
            <span className="font-medium">Live preview</span>
            <Select
              aria-label="Preview width"
              className="min-h-8 w-auto py-1"
              value={previewWidth}
              onChange={(event) => setPreviewWidth(event.target.value)}
            >
              <option value="full">Full width</option>
              <option value="mobile">Mobile · 390px</option>
            </Select>
          </div>
          <div className="flex h-[480px] justify-center overflow-hidden bg-zinc-950">
            <iframe
              title="Waking page preview"
              sandbox=""
              referrerPolicy="no-referrer"
              inert
              tabIndex={-1}
              className={cn('h-full w-full border-0', {
                'max-w-[390px]': previewWidth === 'mobile',
              })}
              srcDoc={wakingPagePreview(previewDraft, serviceName)}
            />
          </div>
        </section>
      </div>
      <p id="waking-editor-help" className="text-xs leading-relaxed text-muted">
        Edit HTML and CSS above, or import a file. Tab moves out of the editor. The preview shows
        your unsaved design; scripts, navigation and readiness polling are disabled.
      </p>
      {(fileError || save.error) && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {fileError || save.error?.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !changed}>
          {save.isPending ? 'Saving…' : 'Save waking page'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !changed}
          onClick={() => {
            setDraft(saved)
            setFileError(null)
            save.reset()
          }}
        >
          Discard edits
        </Button>
        {state.html != null && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => save.mutate(null)}>
            Restore default page
          </Button>
        )}
      </div>
    </form>
  )
}

export function WakingPageSettings({
  serviceId,
  serviceName = 'Your service',
}: {
  serviceId: string
  serviceName?: string
}) {
  const query = useQuery({
    queryKey: ['waking-page', serviceId],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => api<WakingPageState>(`/services/${serviceId}/waking-page`, { signal }),
  })
  return (
    <section className="space-y-4 border-t border-line pt-5" aria-label="Waking page">
      <h3 className="text-sm font-medium">Waking page</h3>
      <p className="text-xs leading-relaxed text-muted">
        Customise what visitors see while this service starts. Edit the template and preview your
        changes before saving. The page is public on this service’s routes, so include only public
        content.
      </p>
      {query.error && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {query.error.message}
        </p>
      )}
      {query.data && (
        <PageEditor
          key={`${serviceId}:${query.data.version}`}
          serviceId={serviceId}
          serviceName={serviceName}
          state={query.data}
        />
      )}
      {!query.data && !query.error && <p className="text-xs text-muted">Loading waking page…</p>}
      <details className="space-y-4 text-xs text-muted">
        <summary className="cursor-pointer py-2 text-zinc-200">
          Template variables and automatic refresh
        </summary>
        <dl className="grid gap-3 text-xs text-muted">
          <div>
            <dt className="font-mono text-zinc-200">{'{{service_name}}'}</dt>
            <dd>The service name, escaped for HTML text or a quoted attribute.</dd>
          </div>
          <div>
            <dt className="font-mono text-zinc-200">{'{{retry_after_seconds}}'}</dt>
            <dd>The readiness check interval in seconds.</dd>
          </div>
          <div>
            <dt className="font-mono text-zinc-200">{'{{readiness_script}}'}</dt>
            <dd>
              Required once, on its own before &lt;/body&gt;. Injects automatic readiness checks and
              refresh. Do not put it inside a comment or another tag.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-zinc-200">{'{{csp_nonce}}'}</dt>
            <dd>
              Use in nonce="{'{{csp_nonce}}'}" on any custom inline scripts. Scripts without it are
              blocked.
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-relaxed text-muted">
          Add <code>data-waking-status</code> to a text element to receive a message if startup
          takes longer than a minute. Keep template variables out of JavaScript and CSS; use them in
          HTML only.
        </p>
      </details>
      <Button
        type="button"
        variant="ghost"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        Reload saved page
      </Button>
    </section>
  )
}
