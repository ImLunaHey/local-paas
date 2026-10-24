import { expect, test } from '@playwright/test'

test('a page render error preserves workspace navigation and can be retried', async ({ page }) => {
  await page.route('**/api/hosts?*', (route) =>
    route.fulfill({ json: { host: { samples: [] }, nodes: {} } }),
  )
  await page.goto('/hosts')
  await expect(page.getByRole('heading', { name: 'This page couldn’t be displayed' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible()
  await page.screenshot({ path: '../.local/page-error-desktop.png', fullPage: true })
  await page.unroute('**/api/hosts?*')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Worker capacity' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const [kind, variable] of [
  ['Service', 'E2E_SERVICE_ID'],
  ['Database', 'E2E_POSTGRES_SERVICE_ID'],
] as const) {
  test(`${kind} tab errors preserve both sidebars and recover on navigation`, async ({ page }) => {
    const id = process.env[variable]
    test.skip(!id, 'Requires an existing development service')
    const events = `**/api/services/${id}/events`
    await page.route(events, (route) => route.fulfill({ json: {} }))
    await page.goto(`/services/${id}/activity`)
    await expect(
      page.getByRole('heading', { name: 'This tab couldn’t be displayed' }),
    ).toBeVisible()
    const navigation = page.getByRole('navigation', { name: `${kind} navigation` })
    await expect(navigation).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: `../.local/${kind.toLowerCase()}-tab-error-mobile.png`,
      fullPage: true,
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.unroute(events)
    await navigation.getByRole('link', { name: 'Metrics', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'This tab couldn’t be displayed' })).toHaveCount(
      0,
    )
    await navigation.getByRole('link', { name: 'Activity', exact: true }).click()
    // A cached bad response is cleared by retry without reloading the shell.
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'This tab couldn’t be displayed' })).toHaveCount(
      0,
    )
  })
}
