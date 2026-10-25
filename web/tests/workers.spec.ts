import { expect, test } from '@playwright/test'

test('worker creation omits HTTP configuration and preserves shared forms', async ({ page }) => {
  const project = `workers-${Date.now()}`
  await page.goto('/app')
  await page.evaluate(async (name) => {
    const r = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!r.ok) throw new Error('Project creation failed')
  }, project)
  await page.goto(`/services/new?project=${project}&environment=production`)
  await page.getByRole('button', { name: 'App', exact: true }).click()
  await page.getByLabel('Process type', { exact: true }).selectOption('worker')
  await expect(page.getByLabel('HTTP port', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Readiness path', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Replicas', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '05 Secrets' })).toBeVisible()
  await page.getByLabel('Service name', { exact: true }).fill('background-canary')
  await page.locator('input[name=repository]').fill('https://github.com/example/worker.git')
  // Intercept the build request only; persist the service through the real API.
  await page.route('**/api/services/*/builds', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    else await route.continue()
  })
  await page.getByLabel('Commit SHA', { exact: true }).fill('a'.repeat(40))
  await page.screenshot({ path: '../.local/worker-form-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '../.local/worker-form-mobile.png', fullPage: true })
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/services') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Create and build/ }).click()
  const saved = await response
  expect(saved.ok()).toBe(true)
  const service = await saved.json()
  expect(service.spec.workload.execution).toBe('worker')
  expect(service.spec.workload.replicas).toBe(1)
  expect(service.spec.workload.port).toBeUndefined()
  expect(service.spec.workload.readiness).toBeUndefined()
  expect(service.spec.domains).toEqual([])
  await expect(page).toHaveURL(new RegExp(`/services/${service.id}/builds$`))
  await expect(page.getByRole('link', { name: 'Set up URL' })).toHaveCount(0)
  await expect(page.getByText('Background worker · singleton', { exact: true })).toBeVisible()
  await page.goto(`/services/${service.id}/configuration`)
  await expect(page.getByLabel('Process type', { exact: true })).toBeDisabled()
})
