import { expect, type Page } from '@playwright/test'

export async function newApp(page: Page) {
  const project = `browser-${crypto.randomUUID().slice(0, 8)}`
  await page.goto('/projects')
  await page.getByLabel('Project name', { exact: true }).fill(project)
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('heading', { name: project, exact: true })).toBeVisible()
  await page.goto(`/services/new?project=${project}&environment=production`)
  await page.getByRole('button', { name: 'App', exact: true }).click()
  return project
}
