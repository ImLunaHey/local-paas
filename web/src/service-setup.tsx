import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { api, type Service } from './api'
import { SecretManager } from './secrets'
import { Button } from './ui'

export function ServiceSetup({ service }: { service: Service }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const operation = useRef(crypto.randomUUID())
  const [secretsReady, setSecretsReady] = useState(true)
  const finish = useMutation({
    mutationFn: async () => {
      if (service.spec.workload.kind === 'oci-service')
        await api(`/services/${service.id}/builds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation_id: operation.current }),
        })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['builds', service.id] })
      await navigate({ to: '/services/$serviceId/builds', params: { serviceId: service.id } })
    },
  })
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">STEP 2 OF 2</p>
        <h2 className="mt-2 text-lg">Add secrets</h2>
        <p className="mt-2 text-sm text-muted">
          Your service is saved. Add any required secrets before starting its first build, or
          continue if it doesn’t need any.
        </p>
      </div>
      <SecretManager service={service} onReadyChange={setSecretsReady} />
      {finish.error && (
        <p role="alert" className="error-notice">
          {finish.error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/services/$serviceId/configuration"
          params={{ serviceId: service.id }}
          className="button secondary"
        >
          Edit configuration
        </Link>
        <Button
          variant="primary"
          disabled={!secretsReady || finish.isPending}
          onClick={() => finish.mutate()}
        >
          {finish.isPending
            ? 'Finishing…'
            : service.spec.workload.kind === 'oci-service'
              ? 'Finish and build'
              : 'Finish setup'}
        </Button>
      </div>
    </div>
  )
}
