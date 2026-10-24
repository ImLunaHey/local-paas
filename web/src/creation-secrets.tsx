import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'

export interface CreationSecretsHandle {
  read: () => { id: string; name: string; value: string }[]
  saved: (id: string) => void
}

// Only row IDs and completion flags enter React state. Values live in password
// inputs until OpenBao acknowledges them, never in Query variables or caches.
export function CreationSecrets({
  ref,
  locked,
}: {
  ref: Ref<CreationSecretsHandle>
  locked: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const completed = useRef(new Set<string>())
  const [rows, setRows] = useState<string[]>([])
  const [savedRows, setSavedRows] = useState<Set<string>>(() => new Set())
  useImperativeHandle(ref, () => ({
    read() {
      const names = new Set<string>()
      return rows.flatMap((id) => {
        const row = container.current!.querySelector(`[data-secret-row="${id}"]`)!
        const name = row.querySelector<HTMLInputElement>('[data-name]')!.value.trim()
        const value = row.querySelector<HTMLInputElement>('[data-value]')!.value
        if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(name) || names.has(name))
          throw new Error('Give each secret a unique environment variable name.')
        names.add(name)
        if (completed.current.has(id)) return []
        if (!value) throw new Error('Enter a value for each secret, or remove the unused row.')
        return [{ id, name, value }]
      })
    },
    saved(id) {
      container.current!.querySelector<HTMLInputElement>(
        `[data-secret-row="${id}"] [data-value]`,
      )!.value = ''
      completed.current.add(id)
      setSavedRows(new Set(completed.current))
    },
  }))
  return (
    <div ref={container} className="space-y-4">
      <p className="text-xs text-muted">
        Optional. Values are saved in OpenBao before the first build starts.
      </p>
      {rows.map((id, index) => (
        <div
          key={id}
          data-secret-row={id}
          className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Field label={`Secret name ${index + 1}`}>
            <Input
              data-name
              autoComplete="off"
              placeholder="DATABASE_URL"
              required
              readOnly={locked}
            />
          </Field>
          <Field label={`Secret value ${index + 1}`}>
            <Input
              data-value
              type="password"
              autoComplete="new-password"
              required={!savedRows.has(id)}
              disabled={savedRows.has(id)}
              placeholder={savedRows.has(id) ? 'Saved in OpenBao' : 'Enter value'}
            />
          </Field>
          <Button
            disabled={locked}
            aria-label={`Remove secret ${index + 1}`}
            onClick={() => setRows(rows.filter((row) => row !== id))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button disabled={locked} onClick={() => setRows([...rows, crypto.randomUUID()])}>
        Add secret
      </Button>
    </div>
  )
}
