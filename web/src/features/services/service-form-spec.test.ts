import { describe, expect, it } from 'vitest'
import { readServiceForm, type ServiceFormInput } from './service-form-spec'

const input: ServiceFormInput = {
  kind: 'oci-service',
  buildMode: 'auto',
  worker: false,
  sourceMode: 'git',
  sourceKind: 'branch',
  sourceValue: 'main',
}

function form(overrides: Record<string, string> = {}) {
  const element = document.createElement('form')
  const values = {
    project: 'personal',
    environment: 'development',
    name: 'example',
    repository: 'https://github.com/example/app',
    dockerfile: 'Dockerfile',
    context: '.',
    cpu: '500',
    memory: '512',
    replicas: '2',
    port: '3000',
    readiness: '/health',
    interval: '10',
    stabilization: '5',
    buildArgs: 'PUBLIC_URL=https://example.com/?a=b',
    ...overrides,
  }
  for (const [name, value] of Object.entries(values)) {
    const control = document.createElement(name === 'buildArgs' ? 'textarea' : 'input')
    control.name = name
    control.value = value
    element.append(control)
  }
  return element
}

describe('service configuration submission', () => {
  it('retains attached secrets, storage and private connections when editing an app', () => {
    const baseline = readServiceForm(form(), input)!
    baseline.secrets = ['DATABASE_URL']
    baseline.volume = { id: 'volume-id', mountPath: '/data', readOnly: true }
    if (baseline.workload.kind !== 'oci-service') throw new Error('Expected application')
    baseline.workload.privateConnections = [{ serviceId: 'database-id', env: 'DATABASE_HOST' }]
    const spec = readServiceForm(form({ buildCommand: 'npm run build' }), {
      ...input,
      spec: baseline,
      sourceKind: 'tag',
      sourceValue: ' v1.0.0 ',
    })!
    expect(spec.source).toEqual({ repository: 'https://github.com/example/app', tag: 'v1.0.0' })
    expect(spec.secrets).toEqual(['DATABASE_URL'])
    expect(spec.volume).toEqual(baseline.volume)
    expect(spec.workload).toMatchObject({
      buildCommand: 'npm run build',
      buildArgs: { PUBLIC_URL: 'https://example.com/?a=b' },
      privateConnections: baseline.workload.privateConnections,
      readiness: { path: '/health', intervalSeconds: 10, stabilizationSeconds: 5 },
    })
  })

  it('normalizes workers to one instance without HTTP configuration', () => {
    const element = form({ distinct: 'on', domains: 'app.example.com' })
    const spec = readServiceForm(element, { ...input, worker: true })!
    expect(spec.distinctNodes).toBe(false)
    expect(spec.domains).toEqual([])
    expect(spec.workload).toMatchObject({
      kind: 'oci-service',
      execution: 'worker',
      replicas: 1,
      port: undefined,
      readiness: undefined,
    })
  })

  it('blocks duplicate or malformed build arguments before submitting', () => {
    for (const buildArgs of ['KEY=one\nKEY=two', 'not-an-assignment']) {
      const element = form({ buildArgs })
      expect(readServiceForm(element, input)).toBeUndefined()
      expect(element.checkValidity()).toBe(false)
    }
  })

  it('keeps uploaded OCI sources and celld fleets as separate contracts', () => {
    const uploaded = readServiceForm(form(), {
      ...input,
      sourceMode: 'upload',
      uploadDigest: 'sha256:test',
    })!
    expect(uploaded.source).toEqual({ repository: '', upload: 'sha256:test' })
    const celld = readServiceForm(
      form({ wrangler: 'wrangler.jsonc', members: '3', bucket: 'fleet-store' }),
      {
        ...input,
        kind: 'celld-service',
        sourceMode: 'upload',
        uploadDigest: 'sha256:test',
      },
    )!
    expect(celld.source).toEqual({ repository: 'https://github.com/example/app', branch: 'main' })
    expect(celld.workload).toEqual({
      kind: 'celld-service',
      wrangler: 'wrangler.jsonc',
      members: 3,
      bucketRef: 'fleet-store',
    })
  })
})
