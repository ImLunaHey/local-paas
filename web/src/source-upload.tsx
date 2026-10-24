import { useState } from 'react'
import { zip } from 'fflate'
import { api } from './api'
import { Field, Input } from './ui'

export function SourceUpload({
  project,
  digest,
  onChange,
}: {
  project: string
  digest?: string
  onChange: (digest: string | undefined) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  async function upload(files: FileList | null) {
    if (!files?.length || busy) return
    setBusy(true)
    setError(undefined)
    onChange(undefined)
    try {
      if (files.length > 10000) throw new Error('Select at most 10,000 files.')
      let body: Uint8Array<ArrayBuffer>
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        if (files[0].size > 32 * 1024 * 1024)
          throw new Error('ZIP archives must be at most 32 MiB.')
        body = new Uint8Array(await files[0].arrayBuffer())
      } else {
        const entries: Record<string, Uint8Array> = Object.create(null)
        let size = 0
        for (const file of Array.from(files)) {
          size += file.size
          if (file.size > 16 * 1024 * 1024 || size > 30 * 1024 * 1024)
            throw new Error(
              'Local selection supports 16 MiB per file and 30 MiB total. Use ZIP for larger compressed sources.',
            )
          const name = file.webkitRelativePath
            ? file.webkitRelativePath.split('/').slice(1).join('/')
            : file.name
          if (
            name
              .split('/')
              .some(
                (p) =>
                  [
                    '.git',
                    'node_modules',
                    '.env',
                    '.npmrc',
                    '.pypirc',
                    'id_rsa',
                    'id_ed25519',
                  ].includes(p) || p.startsWith('.env.'),
              )
          )
            throw new Error(
              'Remove dotenv files, credentials, .git and node_modules before uploading.',
            )
          if (entries[name])
            throw new Error('Selected files have duplicate names; use a ZIP to preserve folders.')
          entries[name] = new Uint8Array(await file.arrayBuffer())
        }
        body = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) =>
          zip(entries, { level: 0 }, (error, data) =>
            error ? reject(error) : resolve(new Uint8Array(data)),
          ),
        )
      }
      const result = await api<{ digest: string }>(
        `/source-uploads?project=${encodeURIComponent(project)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body,
        },
      )
      onChange(result.digest)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Choose a ZIP or select multiple source files. ZIP limits: 32 MiB compressed, 128 MiB
        expanded, 16 MiB per file. Secrets belong in OpenBao.
      </p>
      <Field label="Source files">
        <Input type="file" multiple disabled={busy} onChange={(e) => void upload(e.target.files)} />
      </Field>
      {busy && (
        <p role="status" className="text-xs text-muted">
          Validating and storing source…
        </p>
      )}
      {digest && (
        <p role="status" className="text-xs text-emerald-300">
          Source ready · {digest.slice(0, 12)}
        </p>
      )}
      {error && (
        <p role="alert" className="error-notice">
          {error}
        </p>
      )}
    </div>
  )
}
