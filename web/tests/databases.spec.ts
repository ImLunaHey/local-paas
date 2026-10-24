import { expect, test } from '@playwright/test'

test('PostgreSQL opens its inspector with schemas, columns and indexes', async ({ page }) => {
  const id = process.env.E2E_POSTGRES_SERVICE_ID
  test.skip(!id, 'requires a disposable PostgreSQL service with the inspection canary table')
  await page.goto(`/services/${id}`)
  await expect(page).toHaveURL(new RegExp(`/services/${id}/overview$`))
  await expect(
    page.getByLabel('Breadcrumbs', { exact: true }).getByText('Database', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Database overview' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Database navigation' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Service tabs' })).toHaveCount(0)
  await expect(page.getByText('Requested members', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'platform_inspection_canary', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Columns', exact: true })).toContainText('bigint')
  await expect(page.getByRole('table', { name: 'Columns', exact: true })).toContainText(
    'timestamp with time zone',
  )
  await expect(page.getByRole('table', { name: 'Indexes', exact: true })).toContainText(
    'platform_inspection_canary_pkey',
  )
  await expect(page.getByRole('table', { name: 'Columns', exact: true })).toContainText(
    'Primary key',
  )
  await page.reload()
  await expect(page.getByRole('table', { name: 'Columns', exact: true })).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    await page.getByRole('heading', { name: 'Database overview' }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `../.local/database-postgres-${width}.png` })
  }
  await page.getByRole('link', { name: 'Close table details' }).click()
  await expect(page.getByRole('table', { name: 'Columns', exact: true })).toHaveCount(0)
})

test('Redis shows engine statistics instead of relational table controls', async ({ page }) => {
  const id = process.env.E2E_REDIS_SERVICE_ID
  test.skip(!id, 'requires a disposable running Redis service')
  await page.goto(`/services/${id}`)
  await expect(page).toHaveURL(new RegExp(`/services/${id}/overview$`))
  await expect(
    page.getByLabel('Breadcrumbs', { exact: true }).getByText('Database', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Redis overview' })).toBeVisible()
  await expect(page.getByText('Commands / second', { exact: true })).toBeVisible()
  await expect(page.getByText('Append-only file', { exact: true })).toBeVisible()
  await expect(page.getByText('Enabled', { exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Tables', exact: true })).toHaveCount(0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    await page.getByRole('heading', { name: 'Redis overview' }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `../.local/database-redis-${width}.png` })
  }
})
