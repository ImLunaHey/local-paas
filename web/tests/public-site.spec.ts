import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('public site', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('homepage stays public and dashboard opens sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('main h1')).toBeVisible()
    await expect(page.getByLabel('Username')).toHaveCount(0)
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('docs navigate client-side and mobile navigation restores focus', async ({ page }) => {
    await page.goto('/docs')
    await expect(page.locator('article h1')).toBeVisible()
    await page.evaluate(() => document.documentElement.setAttribute('data-route-probe', 'alive'))
    await page
      .locator('aside')
      .getByRole('link', { name: 'Deploy a Node.js app', exact: true })
      .click()
    await expect(page).toHaveURL(/\/docs\/nodejs$/)
    await expect(page.locator('article h1')).toHaveText('Deploy a Node.js app')
    await expect(page.locator('html')).toHaveAttribute('data-route-probe', 'alive')
    await expect(page.locator('article h1')).toBeFocused()
    await page.setViewportSize({ width: 390, height: 844 })
    const trigger = page.getByRole('button', { name: 'Open documentation menu' })
    await trigger.click()
    await expect(page.getByRole('dialog', { name: 'Documentation menu' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test('homepage and docs are accessible at desktop and mobile widths', async ({ page }) => {
    test.setTimeout(120_000)
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const route of ['/', '/docs/nodejs', '/docs/api']) {
        await page.goto(route)
        await expect(page.locator('main h1').first()).toBeVisible()
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
        expect(results.violations, `${route} at ${width}px`).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      }
    }
  })
})
