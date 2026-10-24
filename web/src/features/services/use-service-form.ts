import { readServiceForm } from './service-form-spec'

import { createService, updateService } from '../../generated/management'

import { domainsQuery } from '../../domains-query'
import { type CreationSecretsHandle } from '../../creation-secrets'

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'

import { api } from '../../api-client'
import { sourceReference } from '../../api'

import type { Service } from '../../generated/model/service'
import type { ServiceSpec } from '../../generated/model/serviceSpec'

import type { SourceKind } from '../../api'

export function useServiceForm(service?: Service) {
  const scope = useSearch({ strict: false }) as { project?: string; environment?: string }
  const [baseline, setBaseline] = useState(service)
  const spec = baseline?.spec
  const oci = spec?.workload.kind === 'oci-service' ? spec.workload : undefined
  const celld = spec?.workload.kind === 'celld-service' ? spec.workload : undefined
  const initialRef = spec ? sourceReference(spec.source) : { kind: 'commit' as const, value: '' }
  const [sourceMode, setSourceMode] = useState<'git' | 'upload'>(
    spec?.source?.upload ? 'upload' : 'git',
  )
  const [uploadDigest, setUploadDigest] = useState(spec?.source?.upload)
  const [sourceKind, setSourceKind] = useState<SourceKind>(initialRef.kind)
  const [sourceValue, setSourceValue] = useState(initialRef.value)
  const [buildMode, setBuildMode] = useState<'auto' | 'dockerfile' | 'generated'>(
    oci?.buildMode ?? 'auto',
  )
  const [execution, setExecution] = useState<'http' | 'worker'>(oci?.execution ?? 'http')
  const [dirty, setDirty] = useState(false)
  const domains = useQuery(domainsQuery)
  const domainsReady = domains.isSuccess
  const secretsDraft = useRef<CreationSecretsHandle>(null)
  const created = useRef<Service | null>(null)
  const [creationLocked, setCreationLocked] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [reloading, setReloading] = useState(false)
  const [reloadError, setReloadError] = useState<Error | null>(null)
  const navigate = useNavigate()
  const client = useQueryClient()
  const [kind, setKind] = useState<'oci-service' | 'celld-service'>(
    spec?.workload.kind === 'celld-service' ? 'celld-service' : 'oci-service',
  )
  const worker = kind === 'oci-service' && execution === 'worker'
  // Preserve the operation ID across retries of an identical submission, even
  // if a response was lost. A changed spec is a different operation.
  const pending = useRef<{ serialized: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: async (spec: ServiceSpec) => {
      const serialized = JSON.stringify({ spec, version: baseline?.version })
      if (!created.current && pending.current?.serialized !== serialized)
        pending.current = { serialized, id: crypto.randomUUID() }
      // Read inside the mutation; secret values never become mutation variables.
      const entries = baseline ? [] : secretsDraft.current!.read()
      const saved =
        created.current ??
        (await (baseline
          ? updateService(baseline.id, {
              operationId: pending.current!.id,
              expectedVersion: baseline.version,
              spec,
            })
          : createService({ operationId: pending.current!.id, spec, buildOnCreate: false })))
      if (baseline) return saved
      created.current = saved
      setCreationLocked(true)
      for (const entry of entries) {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- Each secret update consumes the version returned by the preceding write.
        const { version } = await api<{ version: number }>(`/services/${saved.id}/secrets`)
        await api(`/services/${saved.id}/secrets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: entry.name, value: entry.value, expectedVersion: version }),
        })
        entry.value = ''
        secretsDraft.current!.saved(entry.id)
      }
      if (saved.spec.workload.kind === 'oci-service')
        await api(`/services/${saved.id}/builds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationId: pending.current!.id }),
        })
      return saved
    },
    onSuccess: async (service) => {
      await client.invalidateQueries({ queryKey: ['services'] })
      if (baseline) {
        pending.current = null
        setBaseline(service)
        setDirty(false)
        await client.invalidateQueries({ queryKey: ['events', service.id] })
        return
      }
      await navigate({ to: '/services/$serviceId/builds', params: { serviceId: service.id } })
    },
  })
  async function reloadSaved() {
    if (!baseline) return
    setReloading(true)
    setReloadError(null)
    try {
      const saved = await api<Service>(`/services/${baseline.id}`)
      setBaseline(saved)
      if (saved.spec.workload.kind === 'oci-service')
        setBuildMode(saved.spec.workload.buildMode ?? 'auto')
      const ref = sourceReference(saved.spec.source)
      setSourceKind(ref.kind)
      setSourceValue(ref.value)
      setSourceMode(saved.spec.source?.upload ? 'upload' : 'git')
      setUploadDigest(saved.spec.source?.upload)
      setFormVersion((value) => value + 1)
      setDirty(false)
      pending.current = null
      mutation.reset()
    } catch (error) {
      setReloadError(error as Error)
    } finally {
      setReloading(false)
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutation.isPending) return
    if (created.current) {
      mutation.mutate(created.current.spec)
      return
    }
    const submitted = readServiceForm(event.currentTarget, {
      kind,
      buildMode,
      worker,
      sourceMode,
      uploadDigest,
      sourceKind,
      sourceValue,
      spec,
    })
    if (submitted) mutation.mutate(submitted)
  }

  return {
    scope,
    baseline,
    spec,
    oci,
    celld,
    sourceMode,
    setSourceMode,
    uploadDigest,
    setUploadDigest,
    sourceKind,
    setSourceKind,
    sourceValue,
    setSourceValue,
    buildMode,
    setBuildMode,
    execution,
    setExecution,
    dirty,
    setDirty,
    domainsReady,
    secretsDraft,
    creationLocked,
    formVersion,
    reloading,
    reloadError,
    kind,
    setKind,
    worker,
    mutation,
    reloadSaved,
    submit,
  }
}
export type ServiceFormState = ReturnType<typeof useServiceForm>
