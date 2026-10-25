import { expect, it } from 'vitest'
import { wakingPagePreview } from './waking-page-preview'

it('precedes uploaded content with a restrictive CSP and omits readiness code', () => {
  const html = wakingPagePreview(
    '<h1>{{service_name}}</h1>{{retry_after_seconds}}{{readiness_script}}',
    '<img src="/api">{{readiness_script}}',
  )
  expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<h1>'))
  expect(html).toContain("default-src 'none'")
  expect(html).toContain('base-uri')
  expect(html).toContain('&lt;img src=&quot;/api&quot;&gt;{{readiness_script}}')
  expect(html).toContain('</h1>5')
  expect(html).not.toContain('X-Local-Paas-Wake-Check')
  expect(html).not.toContain('location.reload')
})
