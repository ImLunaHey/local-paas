import { expect, test } from '@playwright/test'
import { createHmac, randomBytes } from 'node:crypto'

test('PR preview policy, signed events, failures and cleanup at desktop and mobile widths', async ({
  page,
}) => {
  const project = `previews-${crypto.randomUUID().slice(0, 8)}`
  const secret = randomBytes(32).toString('hex')
  await page.goto('/app')
  const fixture = await page.evaluate(
    async ({ project, secret }) => {
      const create = async (path: string, body: unknown) => {
        const response = await fetch('/api' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error('Preview fixture creation failed')
        return response.json()
      }
      const service = await create('/services', {
        operationId: crypto.randomUUID(),
        buildOnCreate: false,
        spec: {
          schemaVersion: 1,
          project,
          environment: 'production',
          name: 'web',
          source: {
            repository: 'https://github.com/example/web-canary.git',
            commit: 'a'.repeat(40),
          },
          resources: { cpuMillis: 500, memoryMib: 512 },
          distinctNodes: false,
          domains: [],
          secrets: [],
          workload: {
            kind: 'oci-service',
            dockerfile: 'Dockerfile',
            context: '.',
            replicas: 1,
            port: 3000,
            readiness: { path: '/health', intervalSeconds: 10, stabilizationSeconds: 30 },
          },
        },
      })
      const connection = await create('/source-connections', {
        serviceId: service.id,
        repository: 'example/web-canary',
        webhookSecret: secret,
        events: ['pull_request'],
      })
      return { serviceId: service.id, connectionId: connection.id }
    },
    { project, secret },
  )
  await page.goto(`/services/${fixture.serviceId}/builds`)
  const section = page.getByRole('region', { name: 'Pull request previews' })
  await expect(section.getByText('No PR previews yet.', { exact: false })).toBeVisible()
  await section.getByLabel('Enable automatic PR previews').check()
  await section.getByLabel('Maximum active previews').fill('2')
  await section.getByRole('button', { name: 'Save preview policy' }).click()
  await expect(section.getByRole('status')).toHaveText('Preview policy saved.')
  await page.reload()
  await expect(section.getByLabel('Enable automatic PR previews')).toBeChecked()
  await expect(section.getByLabel('Maximum active previews')).toHaveValue('2')
  const body = JSON.stringify({
    repository: { full_name: 'example/web-canary' },
    number: 42,
    action: 'opened',
    pull_request: {
      updated_at: new Date().toISOString(),
      head: { ref: 'change', sha: 'b'.repeat(40), repo: { full_name: 'example/web-canary' } },
      base: { repo: { full_name: 'example/web-canary' } },
    },
  })
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  // Webhook authentication is exercised against the API, independently of browser sessions.
  const response = await page.request.post(
    `${process.env.API_TARGET}/api/webhooks/github/${fixture.connectionId}`,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'pull_request',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': signature,
      },
      data: body,
    },
  )
  expect(response.status()).toBe(202)
  await expect(section.getByText('PR #42', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(section.getByText('No configured private preview URL is available')).toBeVisible({
    timeout: 15_000,
  })
  const previewsPath = `**/api/source-connections/${fixture.connectionId}/previews`
  await page.route(previewsPath, async (route) => {
    const upstream = await route.fetch()
    const previews = (await upstream.json()) as Array<Record<string, unknown>>
    await route.fulfill({
      json: previews.map((preview) => ({
        ...preview,
        status: 'ready',
        reason: 'All preview services are ready',
        previewUrl: 'https://preview.test/pr-42',
        providerStatus: 'published',
      })),
    })
  })
  await page.context().route('https://preview.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main><h1>Reachable PR preview</h1><p>isolated preview route</p></main>',
    }),
  )
  await page.reload()
  await expect(section.getByText('ready', { exact: true })).toBeVisible()
  await expect(section.getByText('GitHub check: published')).toBeVisible()
  const popupPromise = page.waitForEvent('popup')
  await section.getByRole('link', { name: 'Open private preview' }).click()
  const previewPage = await popupPromise
  await expect(previewPage.getByRole('heading', { name: 'Reachable PR preview' })).toBeVisible()
  await previewPage.close()
  await page.unroute(previewsPath)
  await page.reload()
  await section.screenshot({ path: '../.local/pr-previews-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await section.screenshot({ path: '../.local/pr-previews-mobile.png' })
  await section.getByRole('button', { name: 'Clean up PR 42' }).click()
  await expect(section.getByText('closed', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(section.getByRole('button', { name: 'Clean up PR 42' })).toHaveCount(0)
  await page.route(previewsPath, (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  )
  await page.reload()
  await expect(section.getByText('Previews are unavailable.')).toBeVisible({ timeout: 15_000 })
})
