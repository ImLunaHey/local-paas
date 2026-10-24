import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import { zipSync } from 'fflate'

test('new service selects registered domains and saves OpenBao secrets before building', async ({
  page,
}) => {
  const name = `setup-${Date.now()}`,
    hostname = `${name}.invalid`
  await page.goto('/')
  await page.evaluate(
    async ({ name, hostname }) => {
      for (const [path, body] of [
        ['/projects', { name }],
        ['/domains', { hostname }],
      ] as const) {
        const response = await fetch('/api' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error('Fixture creation failed')
      }
    },
    { name, hostname },
  )
  await page.goto(`/services/new?project=${name}&environment=production`)
  await page.getByRole('button', { name: 'App', exact: true }).click()
  await page.getByLabel('Service name', { exact: true }).fill('web')
  await page.getByLabel('Deployment source', { exact: true }).selectOption('upload')
  const archive = zipSync(
    {
      Dockerfile: fs.readFileSync('../examples/storage-canary/Dockerfile'),
      'main.rs': fs.readFileSync('../examples/storage-canary/main.rs'),
    },
    { level: 0 },
  )
  await page.getByLabel('Source files', { exact: true }).setInputFiles({
    name: 'canary.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(archive),
  })
  await expect(page.getByText('Source ready ·', { exact: false })).toBeVisible()
  await page.getByLabel('Domains', { exact: true }).selectOption(hostname)
  await expect(page.getByLabel('Secret names (optional)')).toHaveCount(0)

  await expect(page.getByRole('heading', { name: '05 Secrets' })).toBeVisible()
  await page.getByRole('button', { name: 'Add secret', exact: true }).click()
  await page.getByLabel('Secret name 1', { exact: true }).fill('CANARY_SECRET')
  const secret = 'disposable-' + crypto.randomUUID()
  await page.getByLabel('Secret value 1', { exact: true }).fill(secret)
  await page.getByRole('button', { name: 'Add secret', exact: true }).click()
  await page.getByLabel('Secret name 2', { exact: true }).fill('SECOND_SECRET')
  await page.getByLabel('Secret value 2', { exact: true }).fill('disposable-' + crypto.randomUUID())
  await page.screenshot({ path: '../.local/inline-secrets-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '../.local/inline-secrets-mobile.png', fullPage: true })

  let writes = 0,
    registrations = 0,
    id = '',
    builds = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/services')
      registrations++
  })
  await page.route('**/api/services/*/secrets', async (route) => {
    if (route.request().method() === 'PUT' && ++writes === 2) {
      id = new URL(route.request().url()).pathname.split('/')[3]
      await route.fulfill({
        status: 503,
        json: { error: 'Secret storage temporarily unavailable' },
      })
    } else await route.continue()
  })
  await page.route('**/api/services/*/builds', async (route) => {
    if (route.request().method() === 'POST' && ++builds === 1) {
      // The build committed, but its response was lost. Retrying must not duplicate it.
      const response = await route.fetch({
        url: 'http://127.0.0.1:5188' + new URL(route.request().url()).pathname,
      })
      expect(response.ok()).toBe(true)
      await route.fulfill({ status: 503, json: { error: 'Response interrupted' } })
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Create and build', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry creation', exact: true })).toBeEnabled()
  await expect(page).toHaveURL(/\/services\/new\?/)
  await expect(page.getByLabel('Secret value 1', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Secret value 1', { exact: true })).toBeDisabled()
  const state = await page.evaluate(
    async (id) => ({
      builds: await (await fetch(`/api/services/${id}/builds`)).json(),
      domains: await (await fetch('/api/domains')).json(),
    }),
    id,
  )
  expect(state.builds).toHaveLength(0)
  expect(
    state.domains.items.find((d: { hostname: string }) => d.hostname === hostname).service_id,
  ).toBe(id)
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click()
  await expect(page.getByText('Response interrupted', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/services/${id}/builds$`))
  const stored = await page.evaluate(
    async (id) => ({
      service: await (await fetch(`/api/services/${id}`)).json(),
      builds: await (await fetch(`/api/services/${id}/builds`)).json(),
    }),
    id,
  )
  expect(registrations).toBe(1)
  expect(stored.service.spec.secrets).toEqual(['CANARY_SECRET', 'SECOND_SECRET'])
  expect(JSON.stringify(stored).includes(secret)).toBe(false)
  expect(stored.builds).toHaveLength(1)
  expect(stored.builds[0].spec.secrets).toEqual(['CANARY_SECRET', 'SECOND_SECRET'])
})
