import { expect, test } from '@playwright/test'

const service = process.env.PLATFORM_JOB_CANARY
test.skip(!service, 'requires the disposable examples/job-canary service')

test.beforeEach(async ({ page }) => {
  await page.goto(`/services/${service}/jobs`)
  const spec = await page.evaluate(async (id) => {
    const response = await fetch(`/api/services/${id}`)
    if (!response.ok) throw new Error('Canary service missing')
    return (await response.json()).spec
  }, service)
  expect(spec.project).toBe('platform-storage-canary')
  expect(spec.name).toMatch(/^job-canary-/)
  await expect(page.getByRole('heading', { name: 'Run a job' })).toBeVisible()
})

test('job workspace displays shared forms and retained history at desktop and mobile widths', async ({
  page,
}) => {
  const run = page.getByRole('form', { name: 'Run a job' })
  await run.getByLabel('Executable', { exact: true }).fill('/canary')
  await run.getByLabel('Arguments', { exact: true }).fill('sleep\n20')
  await expect(run.getByLabel('Time limit (seconds)')).toHaveValue('300')
  await expect(page.getByRole('link', { name: 'Jobs', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.getByText(/^(Add|Edit) schedule$/).click()
  const schedule = page.getByRole('form', { name: 'Job schedule' })
  await expect(schedule.getByLabel('Repeat every (minutes)')).toBeVisible()
  await page.screenshot({ path: '../.local/jobs-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '../.local/jobs-mobile.png', fullPage: true })
  await expect(page.getByText('This tab couldn’t be displayed')).toHaveCount(0)
})

test('run action retains exit results and logs; schedule can be saved and paused', async ({
  page,
}) => {
  const form = page.getByRole('form', { name: 'Run a job' })
  await form.getByLabel('Executable', { exact: true }).fill('/canary')
  const created = page.waitForResponse(
    (r) => r.url().endsWith(`/services/${service}/jobs`) && r.request().method() === 'POST',
  )
  await form.getByRole('button', { name: 'Run now', exact: true }).click()
  const response = await created
  expect(response.ok()).toBe(true)
  const { id } = await response.json()
  const row = page.getByText(`Run ${id.slice(0, 8)}`, { exact: false }).locator('../..')
  await expect(row.getByText('Succeeded · exit 0', { exact: true })).toBeVisible({ timeout: 90000 })
  await row.getByRole('link', { name: 'View logs' }).click()
  await expect(page).toHaveURL(/\/logs\?instance=/)
  await expect(page.getByText('job.start', { exact: false }).first()).toBeVisible({
    timeout: 20000,
  })
  await page.goto(`/services/${service}/jobs`)
  await page.getByText(/^(Add|Edit) schedule$/).click()
  const schedule = page.getByRole('form', { name: 'Job schedule' })
  await schedule.getByLabel('Repeat every (minutes)').fill('120')
  await schedule.getByLabel('Schedule enabled').check()
  await schedule.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByText('Every 120 minutes', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Pause schedule' }).click()
  await expect(page.getByText('Paused', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause schedule' })).toHaveCount(0)
})
