import { expect, test } from '@playwright/test'
import { newApp } from './fixtures'

test('overview, command menu and project rename work together', async ({ page }) => {
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Latest deployments' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: '../.local/overview-desktop.png', fullPage: true })
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('combobox', { name: 'Search commands' }).fill('projects')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.goto('/app')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: '../.local/overview-mobile.png', fullPage: true })
  const name = `settings-${Date.now()}`
  const project = await page.evaluate(async (name) => {
    const r = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!r.ok) throw new Error('Cannot create project fixture')
    return r.json() as Promise<{ id: string }>
  }, name)
  await page.goto(`/projects/${project.id}/settings`)
  await page.getByLabel('Project name').fill(name + '-renamed')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toHaveText('Project settings saved.')
  await page.reload()
  await expect(page.getByLabel('Project name')).toHaveValue(name + '-renamed')
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search commands' }).fill(name + '-renamed')
  await expect(page.getByRole('option').filter({ hasText: name + '-renamed' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}(\\?|$)`))
})

test('service rows show live trends and green running status', async ({ page }) => {
  const serviceId = process.env.E2E_RUNNING_SERVICE_ID
  test.skip(!serviceId, 'Requires a live application with measurements')
  await page.goto('/app')
  const scope = await page.evaluate(async (id) => {
    const service = await fetch('/api/services/' + id).then((r) => r.json())
    const projects = await fetch('/api/projects').then((r) => r.json())
    const project = projects.items.find((p: { name: string }) => p.name === service.spec.project)
    const detail = await fetch('/api/projects/' + project.id).then((r) => r.json())
    return {
      project: project.id,
      environment: detail.environments.find(
        (e: { name: string }) => e.name === service.spec.environment,
      ).name,
    }
  }, serviceId)
  await page.goto(`/projects/${scope.project}?environment=${scope.environment}`)
  const active = page.locator(`.service-row[href="/services/${serviceId}"]`)
  await expect(active.getByText('Running', { exact: true })).toBeVisible()
  expect(
    await active.getByText('Running', { exact: true }).evaluate((el) => getComputedStyle(el).color),
  ).not.toBe('rgb(161, 161, 170)')
  await expect(active.getByLabel('CPU usage history')).toBeVisible()
  await expect(active.getByLabel('Memory usage history')).toBeVisible()
  await page.screenshot({ path: '../.local/service-trends-desktop.png', fullPage: true })
  const chart = active.getByLabel('CPU usage history')
  await chart.hover()
  await expect(page.locator('.metric-tooltip').filter({ visible: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: '../.local/service-trends-mobile.png', fullPage: true })
})

test('global domain assignments persist while the edge remains pending', async ({ page }) => {
  const project = await newApp(page)
  await page.getByLabel('Service name').fill('web-app')
  await page.getByLabel('Git repository').fill('https://github.com/example/canary.git')
  await page.getByLabel('Commit SHA').fill('a'.repeat(40))
  await page.getByRole('button', { name: 'Create and build', exact: true }).click()
  await expect(page).toHaveURL(/\/services\/[^/]+\/builds$/)
  await page.goto('/domains')
  await expect(page.getByRole('heading', { name: 'Domains', exact: true })).toBeVisible()
  await expect(page.getByText('No CNAME target configured yet.', { exact: false })).toBeVisible()
  const hostname = `browser-${Date.now()}.example.com`
  await page.getByLabel('Domain', { exact: true }).fill(hostname)
  await page.getByRole('button', { name: 'Add domain', exact: true }).click()
  const card = page.getByRole('region', { name: hostname, exact: true })
  await expect(card).toBeVisible()
  await card.getByLabel('Project for ' + hostname).selectOption({ label: project })
  await card.getByLabel('Environment for ' + hostname).selectOption({ label: 'production' })
  await card.getByLabel('Service for ' + hostname).selectOption({ label: 'web-app' })
  await card.getByRole('button', { name: 'Save assignment' }).click()
  await expect(card.getByText(`${project} / production → web-app`)).toBeVisible()
  await expect(card.getByText('Waiting for deployment')).toBeVisible()
  await expect(card.getByText('_local-paas.' + hostname, { exact: true })).toBeVisible()
  await page.reload()
  await expect(card.getByText(`${project} / production → web-app`)).toBeVisible()
  await page.screenshot({ path: '../.local/domains-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: '../.local/domains-mobile.png', fullPage: true })
  await card.getByLabel('Project for ' + hostname).selectOption('')
  await card.getByRole('button', { name: 'Save assignment' }).click()
  await expect(card.getByText('Unassigned', { exact: true }).first()).toBeVisible()
})
