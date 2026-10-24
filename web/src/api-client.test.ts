import { afterEach, expect, test, vi } from 'vitest'
import { apiFetch } from './api-client'
afterEach(() => vi.unstubAllGlobals())

test('generated clients preserve cancellation and return the response body', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] })))
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController()
  expect(await apiFetch('/api/projects', { signal: controller.signal })).toEqual({ items: [] })
  expect(fetch).toHaveBeenCalledWith('/api/projects', { signal: controller.signal })
})

test('coded errors expose the stable code and status', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'conflict', error: 'Reload before saving.' }), {
        status: 409,
      }),
    ),
  )
  await expect(apiFetch('/api/projects')).rejects.toMatchObject({
    code: 'conflict',
    status: 409,
    message: 'Reload before saving.',
  })
})

test('unstructured proxy errors never render their potentially sensitive response body', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('private upstream detail', { status: 502 })),
  )
  await expect(apiFetch('/api/projects')).rejects.toMatchObject({
    message: 'Request failed (502)',
    code: 'request_failed',
  })
})
