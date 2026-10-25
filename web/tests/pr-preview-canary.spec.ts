import { expect, test } from '@playwright/test'

const serviceId = process.env.PREVIEW_CANARY_SERVICE_ID
const pullRequest = process.env.PREVIEW_CANARY_PR
const expectedText = process.env.PREVIEW_CANARY_EXPECTED_TEXT

test('qualified private PR preview is ready and reachable', async ({ page, request }) => {
  test.skip(
    !serviceId || !pullRequest || !expectedText,
    'Requires PREVIEW_CANARY_SERVICE_ID, PREVIEW_CANARY_PR and PREVIEW_CANARY_EXPECTED_TEXT',
  )
  await page.goto(`/services/${serviceId}/builds`)
  const section = page.getByRole('region', { name: 'Pull request previews' })
  const preview = section.getByRole('listitem').filter({ hasText: `PR #${pullRequest}` })
  await expect(preview.getByText('ready', { exact: true })).toBeVisible()
  await expect(preview.getByText('GitHub check: published')).toBeVisible()
  const link = preview.getByRole('link', { name: 'Open private preview' })
  const url = await link.getAttribute('href')
  expect(url).toMatch(/^https:\/\//)
  if (!url) throw new Error('Ready preview has no URL')
  const response = await request.get(url)
  expect(response.ok()).toBe(true)
  await expect(response.text()).resolves.toContain(expectedText)
})
