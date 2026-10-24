import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api-client'
import type { Service } from './generated/model/service'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'
import { Select } from './components/select'
interface Storage {
  buckets: { id: string; name: string; status: string; storageId: string; storage: string }[]
  binding: { bucketId: string; status: string; readOnly: boolean } | null
}
// oxlint-disable-next-line react-doctor/no-high-complexity-react-function -- Existing view retained during tooling migration; decomposition is a separate refactor.
export function BucketPanel({ service }: { service: Service }) {
  const managed = service.spec.workload.kind === 'rustfs-service'
  const client = useQueryClient()
  const state = useQuery({
    queryKey: ['buckets', service.id],
    queryFn: () => api<Storage>('/services/' + service.id + '/buckets'),
    refetchInterval: 5000,
  })
  const [name, setName] = useState('')
  const [bucket, setBucket] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const operation = useRef<{ name: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      if (managed) {
        if (operation.current?.name !== name) operation.current = { name, id: crypto.randomUUID() }
        return api('/services/' + service.id + '/buckets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, operationId: operation.current.id }),
        })
      }
      const secrets = await api<{ version: number }>('/services/' + service.id + '/secrets')
      return api('/services/' + service.id + '/storage-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucketId: bucket,
          readOnly: readOnly,
          expectedSecretVersion: secrets.version,
        }),
      })
    },
    onSuccess: async () => {
      operation.current = null
      await client.invalidateQueries({ queryKey: ['buckets'] })
      await client.invalidateQueries({ queryKey: ['secrets'] })
      await client.invalidateQueries({ queryKey: ['services'] })
    },
  })
  const detach = useMutation({
    mutationFn: async () => {
      const secrets = await api<{ version: number }>('/services/' + service.id + '/secrets')
      return api('/services/' + service.id + '/storage-connection', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedSecretVersion: secrets.version }),
      })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['buckets'] })
      await client.invalidateQueries({ queryKey: ['secrets'] })
      await client.invalidateQueries({ queryKey: ['services'] })
    },
  })
  const own = state.data?.buckets.filter((b) => b.storageId === service.id) ?? []
  const current = state.data?.buckets.find((b) => b.id === state.data?.binding?.bucketId)
  return (
    <section className="panel space-y-5 p-6 mt-6">
      <div className="section-heading">
        <h2>{managed ? 'S3 buckets' : 'S3 storage attachment'}</h2>
        <span className="chip">RustFS · private</span>
      </div>
      <p className="text-xs text-muted">
        {managed
          ? 'Create private buckets after deploying this storage service. Attach them from an application’s Storage tab.'
          : 'Attach a bucket from this environment. The platform supplies scoped credentials through OpenBao; configure your S3 client for path-style requests.'}
      </p>
      {current && (
        <Link
          className="button"
          to="/services/$serviceId/storage"
          params={{ serviceId: service.id }}
          search={{ browse: 'objects' }}
        >
          Browse files
        </Link>
      )}
      {current && (
        <p className="text-sm">
          Attached: {current.storage} / {current.name} ·{' '}
          {state.data?.binding?.readOnly ? 'read only' : 'read/write'}
        </p>
      )}
      {current && (
        <div className="space-y-2">
          <Button disabled={detach.isPending} onClick={() => detach.mutate()}>
            Detach bucket
          </Button>
          <p className="text-xs text-muted">
            Detaching immediately revokes this app’s access. Bucket contents remain intact.
          </p>
        </div>
      )}
      {managed && own.length > 0 && (
        <ul className="divide-y divide-zinc-800">
          {own.map((b) => (
            <li key={b.id} className="py-3 text-sm flex justify-between gap-4">
              <span>{b.name}</span>
              <span className="text-xs text-muted">{b.status}</span>
            </li>
          ))}
        </ul>
      )}
      {!current && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
        >
          {managed ? (
            <Field label="Bucket name">
              <Input
                required
                minLength={3}
                maxLength={63}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="uploads"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field label="Bucket">
                <Select required value={bucket} onChange={(e) => setBucket(e.target.value)}>
                  <option value="">Choose a bucket</option>
                  {state.data?.buckets
                    .filter((b) => b.status === 'ready')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.storage} / {b.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Bucket access">
                <Select
                  value={readOnly ? 'ro' : 'rw'}
                  onChange={(e) => setReadOnly(e.target.value === 'ro')}
                >
                  <option value="rw">Read and write</option>
                  <option value="ro">Read only</option>
                </Select>
              </Field>
            </>
          )}
          <Button variant="primary" type="submit" disabled={mutation.isPending}>
            {managed ? 'Create bucket' : 'Attach bucket'}
          </Button>
        </form>
      )}
      {!managed && (
        <p className="text-xs text-muted">
          Adds S3_ENDPOINT, S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
          Redeploy the application to use them. Administrator credentials are never supplied to
          apps.
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-xs text-emerald-300">
          {managed ? 'Bucket created.' : 'Bucket attached. Redeploy to use it.'}
        </p>
      )}
      {(state.error || mutation.error || detach.error) && (
        <p role="alert" className="error-notice">
          {(state.error || mutation.error)?.message}
        </p>
      )}
    </section>
  )
}
