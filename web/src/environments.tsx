import { Button, Input, Field } from './ui'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
export interface Environment {
  id: string
  project: string
  name: string
  service_count: number
}
export const environmentsQuery = {
  queryKey: ['environments'],
  queryFn: () => api<{ items: Environment[] }>('/environments'),
}
export function EnvironmentManager() {
  const client = useQueryClient()
  const query = useQuery(environmentsQuery)
  const [project, setProject] = useState('personal')
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api('/environments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, name }),
      }),
    onSuccess: async () => {
      setName('')
      await client.invalidateQueries({ queryKey: ['environments'] })
    },
  })
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Environments</h1>
          <p>Separate services, deployments and secrets for development, staging and production.</p>
        </div>
      </div>
      <section className="panel p-6 space-y-5">
        <h2>Create an environment</h2>
        <form
          className="grid sm:grid-cols-3 gap-4 items-end"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Project">
            <Input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              required
              pattern="[a-z0-9][a-z0-9-]*"
              maxLength={63}
            />
          </Field>
          <Field label="Environment name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="staging"
              required
              pattern="[a-z0-9][a-z0-9-]*"
              maxLength={63}
            />
          </Field>
          <Button variant="primary" disabled={create.isPending} type="submit">
            Create environment
          </Button>
        </form>
        {(create.error || query.error) && (
          <p role="alert" className="error-notice">
            {(create.error || query.error)?.message}
          </p>
        )}
        {create.isSuccess && (
          <p role="status" className="text-xs text-muted">
            Environment created. Register services in it from the service form.
          </p>
        )}
        <div className="space-y-3">
          {query.data?.items.map((e) => (
            <div className="revision-row flex justify-between gap-3" key={e.id}>
              <div>
                <strong>
                  {e.project} / {e.name}
                </strong>
                <p className="text-xs text-muted mt-1">Independent service and secret scope</p>
              </div>
              <span className="chip">{e.service_count} services</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          Creating an environment creates no workloads and copies no secrets. Register a separate
          service to deploy the same repository into another environment.
        </p>
      </section>
    </>
  )
}
