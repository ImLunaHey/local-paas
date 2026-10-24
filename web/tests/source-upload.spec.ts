import { expect, test } from '@playwright/test'
import { zipSync } from 'fflate'
test('one source picker accepts files or ZIP and rejects compressed bombs', async ({ page }) => {
  const id = process.env.E2E_SERVICE_ID
  test.skip(!id, 'Requires a disposable development application')
  await page.goto(`/services/${id}/configuration`)
  await page.getByLabel('Deployment source', { exact: true }).selectOption('upload')
  await expect(page.locator('input[type=file]')).toHaveCount(1)
  const picker = page.getByLabel('Source files', { exact: true })
  await picker.setInputFiles([
    { name: 'Dockerfile', mimeType: 'text/plain', buffer: Buffer.from('FROM scratch\n') },
    { name: 'index.html', mimeType: 'text/html', buffer: Buffer.from('source canary') },
  ])
  await expect(page.getByText('Source ready ·', { exact: false })).toBeVisible()
  const archive = zipSync({ Dockerfile: new TextEncoder().encode('FROM scratch\n') })
  await picker.setInputFiles({
    name: 'source.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(archive),
  })
  await expect(page.getByText('Source ready ·', { exact: false })).toBeVisible()
  await page.screenshot({ path: '../.local/source-picker-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '../.local/source-picker-mobile.png', fullPage: true })
  const bomb = zipSync({ bomb: new Uint8Array(2 * 1024 * 1024) }, { level: 9 })
  await picker.setInputFiles({
    name: 'bomb.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(bomb),
  })
  await expect(page.getByRole('alert')).toContainText('compression ratio')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
})
