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
  await page.getByLabel('Service name', { exact: true }).fill('web')
  await page.getByLabel('Deployment source', { exact: true }).selectOption('upload')
  const archive = zipSync(
    {
      Dockerfile: fs.readFileSync('../examples/storage-canary/Dockerfile'),
      'main.rs': fs.readFileSync('../examples/storage-canary/main.rs'),
    },
    { level: 0 },
  )
  await page
    .getByLabel('Source files', { exact: true })
    .setInputFiles({
      name: 'canary.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(archive),
    })
  await expect(page.getByText('Source ready ·', { exact: false })).toBeVisible()
  await page.getByLabel('Domains', { exact: true }).selectOption(hostname)
  await expect(page.getByLabel('Secret names (optional)')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue to secrets', exact: true }).click()
  await expect(page).toHaveURL(/\/services\/[^/]+\/setup$/)
  const id = new URL(page.url()).pathname.split('/')[2]
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
  const secret = 'disposable-' + crypto.randomUUID()
  await page.getByLabel('Name', { exact: true }).fill('CANARY_SECRET')
  await page.getByLabel('Value', { exact: true }).fill(secret)
  await expect(page.getByRole('button', { name: 'Finish and build' })).toBeDisabled()
  await page.getByRole('button', { name: 'Save secret', exact: true }).click()
  await expect(page.getByText('Local value stored', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Value', { exact: true })).toHaveValue('')
  const stored = await page.evaluate(
    async (id) => await (await fetch(`/api/services/${id}`)).json(),
    id,
  )
  expect(stored.spec.secrets).toEqual(['CANARY_SECRET'])
  expect(JSON.stringify(stored).includes(secret)).toBe(false)
  await page.screenshot({ path: '../.local/service-setup-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '../.local/service-setup-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Finish and build' }).click()
  await expect(page).toHaveURL(new RegExp(`/services/${id}/builds$`))
  const builds = await page.evaluate(
    async (id) => await (await fetch(`/api/services/${id}/builds`)).json(),
    id,
  )
  expect(builds).toHaveLength(1)
  expect(builds[0].spec.secrets).toEqual(['CANARY_SECRET'])
})
