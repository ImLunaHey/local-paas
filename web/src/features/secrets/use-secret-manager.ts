import type { SecretSet } from './secret-types'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
export function useSecretManager({ service }: { service: Service }) {
  const client = useQueryClient()
  const form = useRef<HTMLFormElement>(null)
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const secrets = useQuery({
    queryKey: ['secrets', service.id],
    queryFn: () => api<SecretSet>('/services/' + service.id + '/secrets'),
  })
  const changed = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['secrets', service.id] }),
      client.invalidateQueries({ queryKey: ['services', service.id] }),
    ])
    setNotice('Saved. Deploy a revision to apply the new secret version.')
    setDirty(false)
  }
  // Never place secret values in React state, mutation variables or Query/devtools caches.
  const save = useMutation({
    mutationFn: async () => {
      const data = new FormData(form.current!)
      const body = JSON.stringify({
        name: data.get('name'),
        value: data.get('value'),
        expectedVersion: secrets.data?.version,
      })
      form.current!.reset()
      return api('/services/' + service.id + '/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    },
    onSuccess: changed,
  })
  const remove = useMutation({
    mutationFn: (name: string) =>
      api('/services/' + service.id + '/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value: null, expectedVersion: secrets.data?.version }),
      }),
    onSuccess: changed,
  })
  const busy = save.isPending || remove.isPending
  const storedNames = new Set(secrets.data?.names)
  const ownNames = new Set(secrets.data?.ownNames)

  return {
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
  }
}
export type SecretManagerState = ReturnType<typeof useSecretManager>
