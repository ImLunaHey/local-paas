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
    <section className="panel p-6 space-y-5" aria-label="Service secrets">
      <div className="section-heading">
        <h2>Secrets</h2>
        <span className="chip">OpenBao · version {secrets.data?.version ?? '—'}</span>
      </div>
      <p className="text-xs text-muted">
        Values are stored in OpenBao and are never shown again. Each deployment uses a fixed
        version. Removing a secret applies to future deployments.
      </p>
      {(secrets.error || save.error || remove.error) && (
        <p role="alert" className="error-notice">
          {(secrets.error || save.error || remove.error)?.message}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {secrets.data && !secrets.data.configured && (
        <p role="alert" className="error-notice">
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
