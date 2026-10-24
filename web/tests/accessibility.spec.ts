import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { newApp } from './fixtures'

for (const theme of ['dark', 'light'] as const) {
  test(`workspace and service creation are accessible in ${theme} mode`, async ({ page }) => {
    // Fifteen full-page axe scans across three viewports are substantially more
    // work than a single UI interaction, especially on native ARM Firefox.
    test.setTimeout(120_000)
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const route of ['/', '/projects', '/domains', '/nodes', '/audit']) {
        await page.goto(route)
        await expect(page.locator('main h1')).toBeVisible()
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
        expect(
          results.violations,
          `${route} at ${width}px: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`,
        ).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      }
    }
    await newApp(page)
    await page.screenshot({ path: `../.local/accessibility-${theme}-desktop.png`, fullPage: true })
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.screenshot({ path: `../.local/accessibility-${theme}-mobile.png`, fullPage: true })
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })
}

test('command dialog supports keyboard selection, escape and focus restoration', async ({
  page,
}) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Open command menu' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await expect(input).toBeFocused()
  await input.fill('hosts')
  await expect(page.getByRole('option', { name: 'Hosts', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Control+k')
  await input.fill('hosts')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).not.toHaveURL(/\/hosts$/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/hosts$/)
})
