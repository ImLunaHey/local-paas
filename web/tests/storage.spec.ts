import { expect, test } from '@playwright/test'
import fs from 'node:fs'

test('scoped creation, breadcrumb environments and shared volume attachments', async ({ page }) => {
  await page.goto('/')
  const name = `storage-${Date.now()}`
  const spec = JSON.parse(fs.readFileSync('../examples/oci-service.json', 'utf8'))
  const fixture = await page.evaluate(
    async ({ name, spec }) => {
      const post = async (path: string, body: unknown) => {
        const r = await fetch('/api' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      }
      const p = await post('/projects', { name })
      await post('/environments', { project: name, name: 'development' })
      const make = (app: string) =>
        post('/services', {
          operation_id: crypto.randomUUID(),
          build_on_create: false,
          spec: { ...spec, project: name, environment: 'production', name: app },
        })
      return {
        project: p.id,
        app: (await make('app')).id,
        browser: (await make('file-browser')).id,
      }
    },
    { name, spec },
  )
  await page.goto(`/services/new?project=${name}&environment=production`)
  await expect(page.getByLabel('Project environment')).toHaveValue('production')
  await page.getByRole('button', { name: 'Database', exact: true }).click()
  await expect(page.locator('input[name="project"]')).toHaveAttribute('type', 'hidden')
  await page.getByLabel('Database engine').selectOption('redis-service')
  await expect(page.getByLabel('Service name')).toHaveValue('redis')
  await expect(page.locator('input[name="environment"]')).toHaveValue('production')
  await page.getByLabel('Project environment').selectOption('development')
  await expect(page).toHaveURL(/environment=development/)
  await page.getByRole('button', { name: 'Database', exact: true }).click()
  await expect(page.locator('input[name="environment"]')).toHaveValue('development')
  await page.screenshot({ path: '../.local/database-scoped-desktop.png', fullPage: true })
  await page.goto(`/services/${fixture.app}/storage`)
  await expect(page.getByRole('heading', { name: 'Persistent storage' })).toBeVisible()
  await page.getByText('Create a shared volume', { exact: true }).click()
  await page.getByLabel('Volume name').fill('uploads')
  await page.getByRole('button', { name: 'Create volume', exact: true }).click()
  await expect(page.getByLabel('Volume', { exact: true })).not.toHaveValue('')
  const volume = await page.getByLabel('Volume', { exact: true }).inputValue()
  await page.getByRole('button', { name: 'Save storage attachment' }).click()
  await expect(page.getByText('app → /data · read/write')).toBeVisible()
  await page.goto(`/services/${fixture.browser}/storage`)
  await page.getByLabel('Volume', { exact: true }).selectOption(volume)
  await page.getByLabel('Access', { exact: true }).selectOption('ro')
  await page.getByRole('button', { name: 'Save storage attachment' }).click()
  await expect(page.getByText('file-browser → /data · read only')).toBeVisible()
  const panel = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Persistent storage' }) })
  await panel.screenshot({ path: '../.local/shared-volume-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.screenshot({ path: '../.local/shared-volume-mobile.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.reload()
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue(volume)
  await expect(page.getByLabel('Access', { exact: true })).toHaveValue('ro')
})

test('RustFS file browser uploads, downloads and preserves existing objects', async ({ page }) => {
  const id = process.env.E2E_BUCKET_SERVICE_ID
  test.skip(!id, 'Requires a disposable service attached to a RustFS bucket')
  await page.goto(`/services/${id}/storage`)
  await expect(
    page.getByRole('navigation', { name: 'Service navigation' }).getByRole('link'),
  ).toHaveText([
    'Builds',
    'Logs',
    'Metrics',
    'Activity',
    'Configuration',
    'Networking',
    'Storage',
    'Secrets',
  ])
  await page.getByRole('link', { name: 'Browse files', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Browse bucket' })).toBeVisible()
  const name = `browser-${Date.now()}.txt`,
    body = 'browser storage canary\n'
  await page
    .getByLabel('Upload storage files')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(body) })
  await expect(page.getByText(name, { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download ' + name, exact: true }).click()
  const saved = await download
  const stream = await saved.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  expect(Buffer.concat(chunks).toString()).toBe(body)
  const restored = 'restored-' + name
  await page
    .getByLabel('Upload storage files')
    .setInputFiles({ name: restored, mimeType: 'text/plain', buffer: Buffer.concat(chunks) })
  await expect(page.getByText(restored, { exact: true })).toBeVisible()
  const restoredBody = await page.evaluate(
    async ({ id, restored }) =>
      (
        await fetch(
          `/api/services/${id}/storage/files?download=true&path=${encodeURIComponent(restored)}`,
        )
      ).text(),
    { id, restored },
  )
  expect(restoredBody).toBe(body)

  await page
    .getByLabel('Upload storage files')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('should not replace') })
  await expect(page.getByRole('alert')).toContainText('already exists')
  await page.screenshot({ path: '../.local/s3-files-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: '../.local/s3-files-mobile.png', fullPage: true })
})

test('shared volume browser restores downloaded files and enforces read-only attachments', async ({
  page,
}) => {
  const writer = process.env.E2E_VOLUME_WRITER_ID,
    reader = process.env.E2E_VOLUME_READER_ID
  test.skip(!writer || !reader, 'Requires disposable services sharing a mounted volume')
  const name = `volume-browser-${Date.now()}.txt`,
    body = 'shared browser restore canary\n'
  await page.goto(`/services/${writer}/storage`)
  await page.getByRole('link', { name: 'Browse files', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Browse volume' })).toBeVisible()
  await page
    .getByLabel('Upload storage files')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(body) })
  await expect(page.getByText(name, { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download ' + name, exact: true }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  const backup = Buffer.concat(chunks)
  expect(backup.toString()).toBe(body)
  const restored = 'restored-' + name
  await page
    .getByLabel('Upload storage files')
    .setInputFiles({ name: restored, mimeType: 'text/plain', buffer: backup })
  await expect(page.getByText(restored, { exact: true })).toBeVisible()
  await page.screenshot({ path: '../.local/volume-browser-desktop.png', fullPage: true })
  await page.goto(`/services/${reader}/storage`)
  await page.getByRole('link', { name: 'Browse files', exact: true }).click()
  await expect(page.getByText('Read only', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Upload storage files')).toHaveCount(0)
  await expect(page.getByText(restored, { exact: true })).toBeVisible()
  const verified = await page.evaluate(
    async ({ reader, restored }) => {
      const path = `/api/services/${reader}/volume/files?path=${encodeURIComponent(restored)}`
      return {
        body: await (await fetch(path + '&download=true')).text(),
        upload: (
          await fetch(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: 'must not replace',
          })
        ).status,
      }
    },
    { reader: reader!, restored },
  )
  expect(verified.body).toBe(body)
  expect(verified.upload).toBe(409)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '../.local/volume-browser-mobile.png', fullPage: true })
})
