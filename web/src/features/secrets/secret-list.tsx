import { Button } from '../../components/button'

import type { Service } from '../../generated/model/service'
import type { SecretManagerState } from './use-secret-manager'

export function SecretList({
  secrets,
  service,
  storedNames,
  ownNames,
  busy,
  remove,
}: Pick<SecretManagerState, 'secrets' | 'storedNames' | 'ownNames' | 'busy' | 'remove'> & {
  service: Service
}) {
  return (
    <div className="space-y-2">
      {[...new Set([...(secrets.data?.names ?? []), ...(secrets.data?.references ?? [])])].map(
        (name) => (
          <div
            className="revision-row flex justify-between items-center gap-3 [border:1px_solid_light-dark(#d4d4d8,_#2c2c30)] [border-radius:6px] [padding:14px] [background:light-dark(#f4f4f5,_#19191b)] [&_code]:[color:light-dark(#27272a,_#d5d5dc)]"
            key={name}
          >
            <div>
              <code className="text-sm">{name}</code>
              <p className="text-xs text-muted mt-1">
                {storedNames.has(name)
                  ? secrets.data?.origins[name] === service.id
                    ? 'Local value stored'
                    : 'Inherited from shadow source · save this name to override'
                  : 'Missing value · deployment will be blocked'}
              </p>
            </div>
            <Button disabled={busy || !ownNames.has(name)} onClick={() => remove.mutate(name)}>
              Remove local value
            </Button>
          </div>
        ),
      )}
      {secrets.data?.names.length === 0 && !secrets.data.references.length && (
        <p className="text-xs text-muted">No secrets yet.</p>
      )}
    </div>
  )
}
