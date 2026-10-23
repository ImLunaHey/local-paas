import { expect, test } from '@playwright/test'

// These exercise the real Rust API/PostgreSQL path; no network mocks.
// They leave uniquely named specifications in the development database.
test('register an OCI service, inspect its audit event, and retain it on reload', async ({
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
  await expect(page.getByText('Registered · not deployed')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Service registered', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
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
  await expect(page.locator('pre')).toContainText('"members": 3')
  await expect(page.locator('pre')).not.toContainText('dockerfile')
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
