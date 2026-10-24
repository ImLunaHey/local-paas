import { expect, test, type Page } from '@playwright/test'

const id = '00000000-0000-4000-8000-000000000001'
function entry(sequence: number, fields: Record<string, unknown> | null, line = '') {
  return {
    sequence,
    instance_id: id,
    revision_id: id,
    node: 'worker-1',
    timestamp: `2026-10-24T08:29:${String(sequence).padStart(2, '0')}Z`,
    stream: fields ? 'stdout' : 'stderr',
    level: fields?.level ?? 'unclassified',
    fields,
    line: fields ? JSON.stringify(fields) : line,
    message: fields ? (fields.message ?? JSON.stringify(fields)) : line,
  }
}
type Entry = ReturnType<typeof entry>

async function mockLogs(page: Page, entries: () => Entry[]) {
  // Browser-only fixtures: no services, logs, or other records are written to the API.
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let json: unknown = { items: [] }
    if (url.pathname.endsWith('/health')) json = { status: 'ok' }
    if (url.pathname.endsWith(`/services/${id}`))
      json = {
        id,
        version: 1,
        spec: {
          schema_version: 1,
          name: 'log-viewer-test',
          project: 'test',
          environment: 'development',
          source: { repository: 'https://github.com/example/app', branch: 'main' },
          resources: { cpu_millis: 100, memory_mib: 64 },
          distinct_nodes: false,
          domains: [],
          secrets: [],
          workload: { kind: 'oci-service', dockerfile: 'Dockerfile', context: '.', replicas: 1 },
        },
      }
    if (url.pathname.endsWith('/runtime'))
      json = { instances: [], deployments: [], healthy_nodes: 0, preview_url: null }
    if (url.pathname.endsWith('/log-storage'))
      json = { available: true, configured: true, pending_entries: 0, bytes_on_disk: 0 }
    if (url.pathname.endsWith('/runtime/logs')) {
      const rows = entries()
      const after = Number(url.searchParams.get('after') ?? 0)
      json = {
        entries: rows.filter((row) => row.sequence > after),
        markers: [{ id: 'start', timestamp: rows[0].timestamp, message: 'Deployment started' }],
        next_cursor: rows.at(-1)?.sequence ?? 0,
        oldest_cursor: rows[0]?.sequence,
        has_more: false,
        archive_warning: null,
      }
    }
    await route.fulfill({ json })
  })
  await page.goto(`/services/${id}/logs`)
}

test('structured columns, plain stderr, details and field filters work together', async ({
  page,
}) => {
  await mockLogs(page, () => [
    entry(1, { level: 'info', event: 'worker.tick', elapsed: 0 }),
    entry(2, { level: 'info', event: 'worker.stopped' }),
    entry(3, null, 'Connection closed'),
    entry(4, {
      level: 'info',
      message: 'Handled request',
      request: { id: 'r1' },
      ok: false,
      tags: ['a'],
      result: null,
    }),
  ])
  const table = page.getByRole('table', { name: 'Runtime log entries' })
  await expect(table.getByRole('columnheader')).toHaveText([
    'Time',
    'Level',
    'Stream',
    'Instance',
    'event',
    'elapsed',
    'request',
    'ok',
    'tags',
    'result',
    'Message',
  ])
  const tick = table.getByRole('row').filter({ hasText: 'worker.tick' })
  await expect(tick.getByRole('cell').nth(5)).toHaveText('0')
  await expect(
    table.getByRole('row').filter({ hasText: 'worker.stopped' }).getByRole('cell').nth(5),
  ).toHaveText('—')
  await expect(table.getByRole('row').filter({ hasText: 'Connection closed' })).toContainText(
    'stderr',
  )
  await expect(table.getByRole('cell', { name: 'false', exact: true })).toBeVisible()
  await expect(table.getByRole('cell', { name: 'null', exact: true })).toBeVisible()
  await expect(table.getByRole('cell', { name: '["a"]', exact: true })).toBeVisible()
  await expect(table.getByRole('cell', { name: '{"id":"r1"}', exact: true })).toBeVisible()
  await expect(tick).not.toContainText('{"level"')
  await page.getByRole('button', { name: 'Expand log 4', exact: true }).click()
  const detail = page.getByRole('region', { name: 'Log 4 details' })
  await expect(detail).toContainText('request.id')
  const filtered = page.waitForRequest((r) => {
    const url = new URL(r.url())
    return url.searchParams.get('field') === 'request.id' && url.searchParams.get('value') === 'r1'
  })
  await detail.getByTitle('Filter request.id', { exact: true }).click()
  await filtered
})

test('live schemas add columns without raw JSON messages and stay scrollable on mobile', async ({
  page,
}) => {
  const rows = [entry(1, { level: 'info', event: 'worker.tick', elapsed: 15 })]
  await mockLogs(page, () => rows)
  const table = page.getByRole('table', { name: 'Runtime log entries' })
  await expect(table.getByRole('columnheader')).toHaveText([
    'Time',
    'Level',
    'Stream',
    'Instance',
    'event',
    'elapsed',
  ])
  rows.push(entry(2, { level: 'info', event: 'worker.tick', elapsed: 16, attempt: 2 }))
  await expect(table.getByRole('columnheader')).toHaveText([
    'Time',
    'Level',
    'Stream',
    'Instance',
    'event',
    'elapsed',
    'attempt',
  ])
  await expect(table.getByText('Deployment started', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Pause live logs' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const scroll = page.getByLabel('Application output', { exact: true })
  expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await page.getByRole('button', { name: 'Expand log 1', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Log 1 details' })).toContainText('worker.tick')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
