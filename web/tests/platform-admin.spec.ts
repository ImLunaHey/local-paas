import { expect, test } from '@playwright/test'
import fs from 'node:fs'

test('root receives the installation-wide dashboard', async ({ page }) => {
  const passwordFile = process.env.E2E_AUTH_PASSWORD_FILE
  if (!passwordFile) throw new Error('Browser authentication is not configured')
  const password = fs.readFileSync(passwordFile, 'utf8').trim()

  await page.context().clearCookies()
  await page.goto('/')
  await page.getByLabel('Username').fill('root')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Platform overview', exact: true })).toBeVisible()
  await expect(page.getByText('Platform administration', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Organizations', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Host', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Billing', exact: true })).toBeVisible()
  await expect(page.getByText('CONTROL PLANE', { exact: true })).toHaveCount(0)

  await page.getByRole('link', { name: 'Organizations', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible()
  await expect(page.getByText('admin', { exact: true }).first()).toBeVisible()

  await page.getByRole('link', { name: 'Users', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
  await expect(page.getByText('Global role: admin', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: /^admin\b/ }).click()
  await expect(page.getByRole('heading', { name: 'admin', exact: true })).toBeVisible()
  await page.getByLabel('Display name').fill('Luna Admin')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('User profile updated.')
  await expect(page.getByRole('heading', { name: 'Luna Admin', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Host', exact: true }).click()
  await expect(page.getByRole('heading', { name: /resources/ })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  const navigationLinks = page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link')
  const firstLinkBox = await navigationLinks.first().boundingBox()
  const lastLinkBox = await navigationLinks.last().boundingBox()
  expect(firstLinkBox).not.toBeNull()
  expect(lastLinkBox).not.toBeNull()
  expect(lastLinkBox?.y).toBe(firstLinkBox?.y)
  await page.getByRole('link', { name: 'Billing', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible()
  await expect(page.getByText('Billing is not configured', { exact: true })).toBeVisible()
})
