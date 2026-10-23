import { expect, test } from '@playwright/test'

// These exercise the real Rust API/PostgreSQL path; no network mocks.
// They leave uniquely named specifications in the development database.
test('register an OCI service, queue and cancel a build, and retain it on reload', async ({
  page,
}) => {
  const name = `browser-oci-${Date.now()}`
  await page.goto('/')
  await expect(page.getByText('Connected locally')).toBeVisible()
  await page.getByRole('link', { name: 'Register service', exact: true }).click()
  await page.getByLabel('Project', { exact: true }).fill('browser-tests')
  await page.getByLabel('Service name').fill(name)
  await page.getByLabel('Git repository').fill('https://github.com/example/web-canary.git')
  await page.getByLabel('Commit SHA').fill('a'.repeat(40))
  await page.getByRole('button', { name: 'Register service', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByText('Not deployed', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/builds$/)
  await page.getByRole('link', { name: 'Activity', exact: true }).click()
  await expect(page).toHaveURL(/\/activity$/)
  await expect(page.getByLabel('Service builds', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Service registered', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Builds & revisions', exact: true }).click()
  // The queue/cancel suite runs with the build worker stopped. No fake images.
  await expect(page.getByText('Waiting for builder', { exact: true })).toBeVisible()
  await page.getByLabel('Bypass build cache').check()
  await page.getByRole('button', { name: 'Queue build', exact: true }).click()
  await expect(page.getByTestId('build-status')).toHaveText('queued')
  await expect(page.getByText('Cache bypassed', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Queue build', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel build', exact: true }).click()
  await expect(page.getByTestId('build-status')).toHaveText('cancelled')
  await expect(
    page.getByText('A revision appears only after a successful image push.'),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByTestId('build-status')).toHaveText('cancelled')
  await page.getByRole('link', { name: 'Configuration', exact: true }).click()
  await expect(page.getByLabel('Git repository')).toHaveValue(
    'https://github.com/example/web-canary.git',
  )
  const stale = await page.context().newPage()
  await stale.goto(page.url())
  await expect(stale.getByLabel('Dockerfile path')).toHaveValue('Dockerfile')
  await page.getByLabel('Dockerfile path').fill('../Dockerfile')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('workload.dockerfile')
  await page.getByLabel('Dockerfile path').fill('deploy/Dockerfile')
  await page.getByLabel('Source type', { exact: true }).selectOption('branch')
  await page.getByLabel('Branch', { exact: true }).fill('feature/forms')
  await page.getByLabel('Memory per instance (MiB)').fill('1024')
  await page.getByLabel('Build method').selectOption('generated')
  await page.getByLabel('Build command (optional)').fill('npm run build -- --mode production')
  await page.getByLabel('Start command (optional)').fill('node dist/server.js')
  await page.getByLabel('Domains (optional)').fill('canary.example.com')
  await page.getByLabel('Secret names (optional)').fill('DATABASE_URL, SESSION_SECRET')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toHaveText('Configuration saved.')
  await stale.getByLabel('Memory per instance (MiB)').fill('2048')
  await stale.getByRole('button', { name: 'Save changes' }).click()
  await expect(stale.getByRole('alert')).toContainText('configuration changed')
  await expect(stale.getByLabel('Memory per instance (MiB)')).toHaveValue('2048')
  await stale.getByRole('button', { name: 'Reload saved configuration' }).click()
  await expect(stale.getByLabel('Memory per instance (MiB)')).toHaveValue('1024')
  await expect(stale.getByLabel('Branch', { exact: true })).toHaveValue('feature/forms')
  await stale.close()
  await page.reload()
  await expect(page.getByLabel('Dockerfile path')).toHaveValue('deploy/Dockerfile')
  await expect(page.getByLabel('Build method')).toHaveValue('generated')
  await expect(page.getByLabel('Build command (optional)')).toHaveValue(
    'npm run build -- --mode production',
  )
  await expect(page.getByLabel('Start command (optional)')).toHaveValue('node dist/server.js')
  await expect(page.getByLabel('Secret names (optional)')).toHaveValue(
    'DATABASE_URL, SESSION_SECRET',
  )
  await page.getByRole('link', { name: 'Builds & revisions', exact: true }).click()
  await expect(page.getByLabel('Build branch')).toHaveValue('feature/forms')
  await page.getByRole('button', { name: 'Queue build', exact: true }).click()
  await expect(page.getByTestId('build-status')).toHaveText('queued')
  await page.getByRole('button', { name: 'Cancel build', exact: true }).click()
  await expect(page.getByTestId('build-status')).toHaveText('cancelled')
  await page.getByRole('link', { name: 'All services' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
})

test('register a separate celld fleet and surface backend validation failures', async ({
  page,
}) => {
  const name = `browser-celld-${Date.now()}`
  await page.goto('/services/new')
  await page.getByRole('button', { name: /celld application/ }).click()
  await page.getByLabel('Project', { exact: true }).fill('browser-tests')
  await page.getByLabel('Service name').fill(name)
  await page.getByLabel('Git repository').fill('https://github.com/example/durable-canary.git')
  await page.getByLabel('Commit SHA').fill('b'.repeat(40))
  await page.getByLabel('Wrangler configuration').fill('../wrangler.jsonc')
  await page.getByLabel('Bucket configuration reference').fill('browser-test-bucket')
  await page.getByRole('button', { name: 'Register service', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('workload.wrangler')
  await page.getByLabel('Wrangler configuration').fill('wrangler.jsonc')
  await page.getByRole('button', { name: 'Register service', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByText('Dedicated celld application fleet')).toBeVisible()
  await page.getByRole('link', { name: 'Configuration', exact: true }).click()
  await expect(page).toHaveURL(/\/configuration$/)
  await expect(page.getByLabel('Fleet members')).toHaveValue('3')
  await expect(page.getByLabel('Dockerfile path')).toHaveCount(0)
  await page.getByLabel('Fleet members').fill('2')
  await page.getByLabel('Source type', { exact: true }).selectOption('tag')
  await page.getByLabel('Tag', { exact: true }).fill('v1.0')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toHaveText('Configuration saved.')
  await page.reload()
  await expect(page.getByLabel('Fleet members')).toHaveValue('2')
  await expect(page.getByLabel('Tag', { exact: true })).toHaveValue('v1.0')
  await expect(page.getByRole('button', { name: 'Queue build', exact: true })).toHaveCount(0)
})

test('mobile registration remains usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/services/new')
  await expect(page.getByRole('heading', { name: 'Give your application a home.' })).toBeVisible()
  await page.getByRole('button', { name: /celld application/ }).click()
  await expect(page.getByLabel('Bucket configuration reference')).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(overflow).toBe(false)
})

test('show a real pushed image, build logs and digest on desktop and mobile', async ({ page }) => {
  const serviceId = process.env.E2E_COMPLETED_BUILD_SERVICE_ID
  test.skip(!serviceId, 'Requires the completed isolated-VM build canary')
  await page.goto(`/services/${serviceId}`)
  const history = page.getByLabel('Build history (latest 50)')
  const completed = history.locator('option').filter({ hasText: 'succeeded' }).first()
  await expect(completed).toHaveCount(1)
  await history.selectOption((await completed.getAttribute('value'))!)
  await expect(page.getByTestId('build-status')).toHaveText('succeeded')
  await expect(
    page.getByText('Image pushed and revision recorded. Use Deploy revision to start this image.'),
  ).toBeVisible()
  await expect(page.locator('code').filter({ hasText: '@sha256:' }).first()).toBeVisible()
  await expect(page.getByLabel('Build output')).toContainText('pushing manifest')
  await page.getByRole('link', { name: 'Logs', exact: true }).click()
  await expect(page).toHaveURL(/\/logs$/)
  await expect(page.getByRole('heading', { name: 'No running instances' })).toBeVisible()
  await expect(page.getByLabel('Build output')).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Runtime logs', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Metrics', exact: true }).click()
  await expect(page).toHaveURL(/\/metrics$/)
  await expect(page.getByRole('heading', { name: 'No runtime metrics yet' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Runtime metrics', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
  await page.goBack()
  await expect(page).toHaveURL(/\/logs$/)
  await page.getByRole('link', { name: 'View build output', exact: true }).click()
  await expect(page).toHaveURL(/\/builds$/)
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.getByRole('link', { name: 'Configuration', exact: true }).click()
  await expect(page.getByLabel('Build output')).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Service configuration', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/builds$/)
  await expect(page.getByLabel('Service builds', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
})

test('show live application logs, measured usage and the private preview', async ({ page }) => {
  const serviceId = process.env.E2E_RUNNING_SERVICE_ID
  test.skip(!serviceId, 'Requires a real ready runtime deployment')
  await page.goto(`/services/${serviceId}/logs`)
  await expect(page.getByLabel('Application output')).toContainText('Ready in')
  await expect(page.getByText('Following · updates every 3 seconds')).toBeVisible()
  await page.getByRole('button', { name: 'Pause live logs' }).click()
  await expect(page.getByRole('button', { name: 'Resume live logs' })).toBeVisible()
  await page.getByRole('button', { name: 'Resume live logs' }).click()
  await page.getByRole('link', { name: 'Metrics', exact: true }).click()
  await expect(page).toHaveURL(/\/metrics$/)
  await expect(page.getByRole('img', { name: 'CPU usage (millicores)' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Memory usage (MiB)' })).toBeVisible()
  const readings = page.getByLabel('Runtime metrics').locator('.metric strong')
  await expect(readings.nth(1)).toHaveText(/\d+\.\d+ MiB/)
  await expect(readings.nth(2)).toHaveText(/[1-9]\d*/)
  await page.screenshot({ path: '../.local/runtime-metrics.png', fullPage: true })
  await page.reload()
  await expect(page.getByLabel('Runtime metrics')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
  await page.getByRole('link', { name: 'Logs', exact: true }).click()
  await expect(page.getByLabel('Application output')).toContainText('Ready in')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
  await page.getByRole('link', { name: 'Builds & revisions', exact: true }).click()
  const href = await page
    .getByRole('link', { name: 'Open application', exact: true })
    .getAttribute('href')
  expect(href).toBeTruthy()
  const app = await page.context().newPage()
  const response = await app.goto(href!)
  expect(response?.status()).toBe(200)
  await expect(app.locator('body')).not.toBeEmpty()
  await app.close()
})

test('filter retained logs and switch combined and instance metrics', async ({ page }) => {
  const serviceId = process.env.E2E_RUNNING_SERVICE_ID
  test.skip(!serviceId, 'Requires a real running service')
  await page.goto('/services/' + serviceId + '/logs')
  await expect(page.getByText('ClickHouse connected', { exact: true })).toBeVisible()
  await page.getByLabel('Search logs', { exact: true }).fill('Ready in')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page.getByLabel('Application output')).toContainText('Ready in')
  await page.getByLabel('Level', { exact: true }).selectOption('error')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page.getByRole('heading', { name: 'No matching log entries' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByLabel('Application output')).toContainText('Ready in')
  await page.getByRole('link', { name: 'Metrics', exact: true }).click()
  await expect(page.getByText('Combined view', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Network received (KiB/s)' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Disk write (KiB/s)' })).toBeVisible()
  const instance = await page
    .getByLabel('Runtime instance')
    .locator('option')
    .nth(1)
    .getAttribute('value')
  await page.getByLabel('Runtime instance').selectOption(instance!)
  await expect(page.getByText('Instance view', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
})
