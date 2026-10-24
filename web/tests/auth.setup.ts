import { expect, test as setup } from '@playwright/test'
import fs from 'node:fs'

const authState = process.env.E2E_AUTH_STATE
const passwordFile = process.env.E2E_AUTH_PASSWORD_FILE

setup('authenticate browser tests', async ({ page }) => {
  if (!authState || !passwordFile) throw new Error('Browser authentication is not configured')

  const password = fs.readFileSync(passwordFile, 'utf8').trim()
  await page.goto('/')
  await page.getByLabel('Username').fill('root')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  await page.context().storageState({ path: authState })
})
