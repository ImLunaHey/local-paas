import { expect, test } from '@playwright/test'
import fs from 'node:fs'

test('host history uses persisted samples and supports ranges on desktop and mobile', async ({
  page,
}) => {
  const passwordFile = process.env.E2E_AUTH_PASSWORD_FILE
  if (!passwordFile) throw new Error('Browser authentication is not configured')
  const password = fs.readFileSync(passwordFile, 'utf8').trim()
  await page.context().clearCookies()
  await page.goto('/')
  await page.getByLabel('Username').fill('root')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Platform overview', exact: true })).toBeVisible()
  await page.goto('/platform/host')
  await expect(page.getByLabel('Host history range')).toHaveValue('15m')
  await expect(page.getByText('History is saved in PostgreSQL', { exact: false })).toBeVisible()
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch('/api/hosts')
        return (await response.json()).host.samples.length
      }),
    )
    .toBeGreaterThan(0)
  const response = page.waitForResponse((r) => r.url().includes('/api/hosts?range=24h'))
  await page.getByLabel('Host history range').selectOption('24h')
  const payload = await (await response).json()
  expect(payload.host.retentionDays).toBe(30)
  expect(payload.host.samples.length).toBeGreaterThan(0)
  expect(payload.host.samples.length).toBeLessThanOrEqual(361)
  // A fresh database may have only one 4-minute bucket in the 24h range.
  await page.getByLabel('Host history range').selectOption('15m')
  await expect(page.getByLabel('Host CPU history')).toBeVisible({ timeout: 20000 })
  await page.screenshot({ path: '../.local/host-history-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: '../.local/host-history-mobile.png', fullPage: true })
})
