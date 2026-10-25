import { expect, test } from '@playwright/test'
import { newApp } from './fixtures'

// These exercise the real Rust API/PostgreSQL path; no network mocks.
// They leave uniquely named specifications in the development database.
test('register an OCI service, queue and cancel a build, and retain it on reload', async ({
  page,
}) => {
  const name = `browser-oci-${Date.now()}`
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  await newApp(page)
  await page.getByLabel('Service name').fill(name)
  await page.getByLabel('Git repository').fill('https://github.com/example/web-canary.git')
  await page.getByLabel('Commit SHA').fill('a'.repeat(40))
  await page.getByRole('button', { name: 'Create and build', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByText('Not deployed', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/builds$/)
  await page.getByRole('link', { name: 'Activity', exact: true }).click()
  await expect(page).toHaveURL(/\/activity$/)
  await expect(page.getByLabel('Service builds', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Service registered', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Builds', exact: true }).click()
  // The queue/cancel suite runs with the build worker stopped. No fake images.
  await expect(page.getByText('Waiting for builder', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel build', exact: true }).click()
  await expect(page.getByTestId('build-status')).toHaveText('cancelled')
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
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(
    page.getByRole('form', { name: 'Service configuration' }).getByRole('status'),
  ).toHaveText('Configuration saved.')
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
  await page.getByRole('link', { name: 'Builds', exact: true }).click()
  await expect(page.getByLabel('Build branch')).toHaveValue('feature/forms')
  await page.getByRole('button', { name: 'Queue build', exact: true }).click()
  await expect(page.getByTestId('build-status')).toHaveText('queued')
  await page.getByRole('button', { name: 'Cancel build', exact: true }).click()
  await expect(page.getByTestId('build-status')).toHaveText('cancelled')
  await page.getByRole('link', { name: 'Project services' }).click()
  await expect(page.getByRole('link').filter({ hasText: name })).toBeVisible()
})

test('register a separate celld fleet and surface backend validation failures', async ({
  page,
}) => {
  const name = `browser-celld-${Date.now()}`
  await newApp(page)
  await page.getByRole('button', { name: /celld application/ }).click()
  await page.getByLabel('Service name').fill(name)
  await page.getByLabel('Git repository').fill('https://github.com/example/durable-canary.git')
  await page.getByLabel('Commit SHA').fill('b'.repeat(40))
  await page.getByLabel('Wrangler configuration').fill('../wrangler.jsonc')
  await page.getByLabel('Bucket configuration reference').fill('browser-test-bucket')
  await page.getByRole('button', { name: 'Create service', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('workload.wrangler')
  await page.getByLabel('Wrangler configuration').fill('wrangler.jsonc')
  await page.getByRole('button', { name: 'Create service', exact: true }).click()
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
  await newApp(page)
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
  await page.getByRole('link', { name: 'Builds', exact: true }).click()
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
  await expect(page.getByLabel('Application output')).toContainText('Ready in')
  await page.getByLabel('Level', { exact: true }).selectOption('error')
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

test('open the application from its header and inspect networking', async ({ page }) => {
  const serviceId = process.env.E2E_RUNNING_SERVICE_ID
  test.skip(!serviceId, 'Requires a ready private application')
  await page.goto('/services/' + serviceId + '/logs')
  const { service, networking } = await page.evaluate(async (id) => {
    const [service, networking] = await Promise.all([
      fetch('/api/services/' + id).then((r) => r.json()),
      fetch('/api/services/' + id + '/networking').then((r) => r.json()),
    ])
    return { service, networking }
  }, serviceId)
  test.skip(!networking.authority, 'Requires a configured private preview URL')
  await expect(page.getByRole('link', { name: 'Open app ↗', exact: true })).toHaveAttribute(
    'href',
    `https://${networking.authority}`,
  )
  await page.getByRole('link', { name: 'Networking', exact: true }).click()
  await expect(page).toHaveURL(/\/networking$/)
  await expect(page.getByLabel('Container port', { exact: true })).toHaveValue(
    String(service.spec.workload.port),
  )
  await expect(page.getByRole('switch', { name: 'Enable private URL' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.getByText(`HTTPS → container port ${networking.activePort}`)).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Service networking')).toBeVisible()
  await page.getByRole('link', { name: 'Project services', exact: true }).click()
  await expect(page.getByRole('heading', { name: service.spec.project, exact: true })).toBeVisible()
  const environments = page.getByLabel('Project environment')
  const alternatives = await environments
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
  if (alternatives.length > 1) await environments.selectOption(alternatives[1])
  await expect(page.getByRole('heading', { name: service.spec.project, exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
})

test('open archived instance logs from activity and filter on change', async ({ page }) => {
  const id = process.env.E2E_RUNNING_SERVICE_ID
  test.skip(!id, 'Requires a real deployment history')
  await page.goto('/services/' + id + '/activity')
  const history = page.getByLabel('Deployment history')
  const old = history
    .locator('[data-instance-history][data-has-logs=true]')
    .filter({ hasText: 'stopped' })
    .first()
  await expect(old).toBeVisible()
  const href = await old.getByRole('link', { name: 'View logs' }).getAttribute('href')
  const instance = new URL(href!, 'https://localhost').searchParams.get('instance')!
  await old.getByRole('link', { name: 'View logs' }).click()
  await expect(page).toHaveURL(/\/logs\?instance=/)
  await expect(page.getByText('Showing instance')).toContainText(instance)
  await expect(page.locator('.log-columns')).toContainText('Message')
  const rows = page.locator('.runtime-log-row')
  await expect(rows.first()).toBeVisible()
  for (const text of await rows.locator('.log-line .log-instance').allTextContents())
    expect(text).toBe(instance.slice(0, 8))
  await rows.first().locator('summary').first().click()
  await expect(rows.first().locator('.log-detail')).toBeVisible()
  await page.getByLabel('Search logs', { exact: true }).fill('no-match-' + crypto.randomUUID())
  await expect(page.getByRole('heading', { name: 'No matching log entries' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply filters' })).toHaveCount(0)
  await page.getByLabel('Search logs', { exact: true }).fill('')
  await expect(rows.first()).toBeVisible()
  await page.reload()
  await expect(page.getByText('Showing instance')).toContainText(instance)
  await page.screenshot({ path: '../.local/logs-compact.png', fullPage: true })
})

test('all metric charts have dark pointer and keyboard tooltips', async ({ page }) => {
  const id = process.env.E2E_RUNNING_SERVICE_ID
  test.skip(!id, 'Requires live metrics')
  await page.goto('/services/' + id + '/metrics')
  const charts = page.locator('.metric-chart')
  await expect(charts).toHaveCount(6)
  for (const chart of await charts.all()) {
    const image = chart.getByRole('img')
    await image.scrollIntoViewIfNeeded()
    const box = await image.boundingBox()
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5)
    const tip = chart.locator('.metric-tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toHaveCSS('background-color', 'rgb(26, 26, 30)')
    await expect(tip).toContainText('Combined')
    await page.mouse.move(0, 0)
    await image.focus()
    await page.keyboard.press('ArrowRight')
    await expect(tip).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await page.screenshot({ path: '../.local/metrics-tanstack.png', fullPage: true })
})

test('expose TanStack Query and Router devtools', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Open TanStack Devtools', exact: true }).click()
  await expect(page.getByText('TanStack Query', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('TanStack Router', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Close TanStack Devtools', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Open TanStack Devtools', exact: true }),
  ).toBeVisible()
})

test('project environment form uses aligned shared controls at desktop and mobile widths', async ({
  page,
}) => {
  await page.goto('/app')
  const projects = await page.evaluate(async () => (await fetch('/api/projects')).json())
  const project =
    projects.items.find((p: { name: string }) => p.name === 'personal') ?? projects.items[0]
  test.skip(!project, 'Requires an existing project')
  await page.goto('/projects/' + project.id)
  await page.getByText('Create or shadow an environment', { exact: true }).click()
  const input = page.getByLabel('Environment name', { exact: true })
  const select = page.getByLabel('Shadow source', { exact: true })
  const button = page.getByRole('button', { name: 'Create environment', exact: true })
  await expect(input).toBeVisible()
  await expect(select).toBeVisible()
  const boxes = await Promise.all([input.boundingBox(), select.boundingBox(), button.boundingBox()])
  expect(
    Math.max(...boxes.map((b) => b!.height)) - Math.min(...boxes.map((b) => b!.height)),
  ).toBeLessThanOrEqual(1)
  expect(
    Math.max(...boxes.map((b) => b!.y + b!.height)) -
      Math.min(...boxes.map((b) => b!.y + b!.height)),
  ).toBeLessThanOrEqual(1)
  await expect(select).toHaveCSS('background-color', 'rgb(23, 23, 25)')
  await page.screenshot({ path: '../.local/project-controls-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(select).toBeVisible()
  await expect(button).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
  await page.screenshot({ path: '../.local/project-controls-mobile.png', fullPage: true })
})

test('audit table filters within headers and expands actions without HTTP traffic', async ({
  page,
}) => {
  const project = `audit-browser-${Date.now()}`
  await page.goto('/projects')
  await page.getByLabel('Project name', { exact: true }).fill(project)
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('heading', { name: project, exact: true })).toBeVisible()
  await page.goto('/audit')
  const table = page.getByRole('table', { name: 'Audit entries', exact: true })
  await expect(table).toBeVisible()
  await expect(table.locator('thead').getByLabel('Filter action')).toBeVisible()
  await expect(table.locator('thead').getByLabel('Filter outcome')).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Actor', exact: true })).toBeVisible()
  await expect(table.locator('[data-audit-entry]').first()).toBeVisible()
  const first = table.locator('[data-audit-entry]').first()
  await first.getByRole('button').click()
  await expect(first.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  await expect(table.getByText('Action ID', { exact: true }).first()).toBeVisible()
  await table.getByLabel('Filter action').fill('no-such-platform-action')
  await expect(table.getByText('No matching audit entries.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(table.locator('[data-audit-entry]').first()).toBeVisible()
  await table.getByLabel('Filter outcome').selectOption('committed')
  await expect
    .poll(async () => {
      const outcomes = await table.locator('[data-audit-entry] td:last-child').allTextContents()
      return outcomes.length > 0 && outcomes.every((value) => value === 'committed')
    })
    .toBe(true)
  const forbidden = await page.evaluate(async () => {
    const data = await fetch('/api/audit').then((response) => response.json())
    return data.entries.some(
      (entry: { action: string; target_type: string }) =>
        entry.target_type === 'request' || /^(GET|POST|PUT|DELETE) /.test(entry.action),
    )
  })
  expect(forbidden).toBe(false)
  await page.screenshot({ path: '../.local/audit-table-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
  await page.screenshot({ path: '../.local/audit-table-mobile.png', fullPage: true })
})
