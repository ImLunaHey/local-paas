import { SecretList } from './secret-list'

import { useSecretManager } from './use-secret-manager'
import { Button } from '../../components/button'
import { Input } from '../../components/input'
import { Field } from '../../components/field'

import type { Service } from '../../generated/model/service'

export function SecretManager({ service }: { service: Service }) {
  const {
    form,
    notice,
    setNotice,
    dirty,
    setDirty,
    secrets,
    save,
    remove,
    busy,
    storedNames,
    ownNames,
  } = useSecretManager({ service })
  return (
    <section
      className="panel p-6 space-y-5 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
      aria-label="Service secrets"
    >
      <div className="section-heading [display:flex] [justify-content:space-between] [align-items:center] [margin-bottom:15px] [gap:12px] max-[720px]:[&_.tiny-label]:[font-size:8px] max-[720px]:[&_.tiny-label]:[letter-spacing:0.6px]">
        <h2>Secrets</h2>
        <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
          OpenBao · version {secrets.data?.version ?? '—'}
        </span>
      </div>
      <p className="text-xs text-muted">
        Values are stored in OpenBao and are never shown again. Each deployment uses a fixed
        version. Removing a secret applies to future deployments.
      </p>
      {(secrets.error || save.error || remove.error) && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(secrets.error || save.error || remove.error)?.message}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {secrets.data && !secrets.data.configured && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          OpenBao is not configured.
        </p>
      )}
      <form
        ref={form}
        onChange={() => setDirty(true)}
        autoComplete="off"
        className="grid sm:grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setNotice('')
          save.mutate()
        }}
      >
        <Field label="Name">
          <Input
            name="name"
            disabled={busy}
            required
            pattern="[A-Z_][A-Z0-9_]*"
            maxLength={128}
            placeholder="DATABASE_URL"
            autoComplete="off"
          />
        </Field>
        <Field label="Value">
          <Input
            name="value"
            disabled={busy}
            type="password"
            required
            maxLength={32768}
            autoComplete="new-password"
            placeholder="New secret value"
          />
        </Field>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button variant="primary" disabled={busy || !secrets.data?.configured} type="submit">
            Save secret
          </Button>
          {(dirty || save.isError) && (
            <Button
              disabled={busy}
              onClick={() => {
                form.current?.reset()
                save.reset()
                setNotice('')
              }}
            >
              Discard unsaved secret
            </Button>
          )}
        </div>
      </form>
      <SecretList
        secrets={secrets}
        service={service}
        storedNames={storedNames}
        ownNames={ownNames}
        busy={busy}
        remove={remove}
      />
    </section>
  )
}
