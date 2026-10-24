import { expect, test } from '@playwright/test'

test('choose app, database or storage before showing its scoped form', async ({ page }) => {
  await page.goto('/')
  const project = `creation-${Date.now()}`
  await page.evaluate(async (project) => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: project }),
    })
    if (!response.ok) throw new Error('Fixture project creation failed')
  }, project)
  await page.goto(`/services/new?project=${project}&environment=production`)
  await expect(page.getByRole('heading', { name: 'What do you want to create?' })).toBeVisible()
  await expect(page.getByLabel('Service name', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '../.local/creation-kind-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '../.local/creation-kind-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Database', exact: true }).click()
  await expect(page.getByLabel('Database engine')).toBeVisible()
  await expect(page.getByLabel('Database engine').locator('option')).toHaveCount(2)
  await page.getByLabel('Database engine').selectOption('redis-service')
  await expect(page.getByLabel('Service name', { exact: true })).toHaveValue('redis')
  await expect(page.locator('input[name=project]')).toHaveValue(project)
  await page.getByRole('button', { name: 'Change service type', exact: false }).click()
  await page.getByRole('button', { name: 'Storage', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create S3 storage', exact: true })).toBeVisible()
  await expect(page.getByLabel('Storage engine')).toHaveValue('rustfs-service')
  await expect(page.getByLabel('Storage engine').locator('option')).toHaveCount(1)
  await page.screenshot({ path: '../.local/creation-storage-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Change service type', exact: false }).click()
  await page.getByRole('button', { name: 'App', exact: true }).click()
  await expect(page.getByRole('heading', { name: '05 Secrets' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Database', exact: true })).toHaveCount(0)
})
