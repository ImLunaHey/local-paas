import { chromium, expect, firefox, webkit } from '@playwright/test'
import fs from 'node:fs'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5188'
const authState = process.env.E2E_AUTH_STATE
const passwordFile = process.env.E2E_AUTH_PASSWORD_FILE

export default async function authenticateBrowserTests() {
  if (!authState || !passwordFile) throw new Error('Browser authentication is not configured')

  const browserName = process.env.E2E_BROWSER || 'chromium'
  if (!['chromium', 'firefox', 'webkit'].includes(browserName))
    throw new Error(`Unsupported E2E browser: ${browserName}`)
  const browserType =
    browserName === 'firefox' ? firefox : browserName === 'webkit' ? webkit : chromium
  const password = fs.readFileSync(passwordFile, 'utf8').trim()
  const browser = await browserType.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: process.env.E2E_RESOLVE_IP
      ? [`--host-resolver-rules=MAP ${new URL(baseURL).hostname} ${process.env.E2E_RESOLVE_IP}`]
      : [],
  })
  try {
    const page = await browser.newPage({ baseURL })
    await page.goto('/')
    await page.getByLabel('Username').fill('imlunahey')
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await page.context().storageState({ path: authState })
  } finally {
    await browser.close()
  }
}
