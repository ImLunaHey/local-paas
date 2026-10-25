import { useVolumeAttachment } from './use-volume-attachment'

import { HardDrive } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import type { Service } from '../../generated/model/service'
import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Input } from '../../components/input'
import { Select } from '../../components/select'

export function StoragePanel({ service }: { service: Service }) {
  const {
    current,
    id,
    setId,
    path,
    setPath,
    readOnly,
    setReadOnly,
    name,
    setName,
    size,
    setSize,
    volumes,
    selected,
    create,
    save,
  } = useVolumeAttachment({ service })
  return (
    <section className="panel space-y-5 p-6 mt-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
      <div className="flex items-center gap-3">
        <HardDrive size={20} className="text-accent" />
        <h2>Persistent storage</h2>
        {current && volumes.data?.items.some((v) => v.id === current.id && v.node) && (
          <Link
            className="ml-auto text-xs text-orange-300 hover:underline"
            to="/services/$serviceId/storage"
            params={{ serviceId: service.id }}
            search={{ browse: 'volume' }}
          >
            Browse files
          </Link>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Share a volume between services in this environment. All attached services run on its owning
        worker. A file browser can use a read-only attachment while your app writes files.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3 items-end">
          <Field label="Volume">
            <Select
              value={id}
              onChange={(e) => {
                setId(e.target.value)
                save.reset()
              }}
            >
              <option value="">No persistent volume</option>
              {volumes.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.sizeGib} GiB
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mount path">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={!id}
              required={!!id}
              placeholder="/data"
            />
          </Field>
          <Field label="Access">
            <Select
              value={readOnly ? 'ro' : 'rw'}
              onChange={(e) => setReadOnly(e.target.value === 'ro')}
              disabled={!id}
            >
              <option value="rw">Read and write</option>
              <option value="ro">Read only</option>
            </Select>
          </Field>
        </div>
        {selected && (
          <div className="rounded-lg border border-zinc-800 p-4 text-xs space-y-2">
            <p>
              {selected.node ? `Stored on ${selected.node}` : 'Worker assigned at first deployment'}{' '}
              · {selected.sizeGib} GiB
            </p>
            {selected.services.length > 0 ? (
              <ul className="space-y-1 text-muted">
                {selected.services.map((s) => (
                  <li key={s.id}>
                    {s.name} → {s.mountPath} · {s.readOnly ? 'read only' : 'read/write'}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No services attached yet.</p>
            )}
          </div>
        )}
        <p className="text-xs text-muted">
          Attaching storage sets this service to one replica. Stop it before deploying a
          replacement; other services using the volume keep running. Detaching retains all files.
          Coordinate concurrent writes in your applications.
        </p>
        <Button variant="primary" type="submit" disabled={save.isPending}>
          Save storage attachment
        </Button>
        {save.isSuccess && (
          <p role="status" className="text-xs text-emerald-300">
            Attachment saved. Deploy to use it.
          </p>
        )}
      </form>
      <details className="border-t border-zinc-800 pt-4">
        <summary className="cursor-pointer text-sm">Create a shared volume</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-[1fr_120px_auto] items-end"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Volume name">
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="uploads"
              maxLength={63}
            />
          </Field>
          <Field label="Size (GiB)">
            <Input
              required
              type="number"
              min={1}
              max={2}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Create volume
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted">
          Development volumes are limited to 2 GiB and stay on one worker. They are not replicated
          or backed up automatically.
        </p>
      </details>
      {(volumes.error || save.error || create.error) && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(volumes.error || save.error || create.error)?.message}
        </p>
      )}
    </section>
  )
}
