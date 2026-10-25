function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// This policy precedes all user content and cannot be loosened by a later meta.
// The iframe also uses an empty sandbox and is inert: no scripts, forms, cookies,
// top-level navigation or pointer/keyboard interaction with uploaded markup.
export function wakingPagePreview(template: string, serviceName: string) {
  const variables: Record<string, string> = {
    service_name: escapeHtml(serviceName),
    retry_after_seconds: '5',
    readiness_script: '',
    csp_nonce: 'preview-only',
  }
  const content = template.replace(/\{\{([^{}]+)\}\}/g, (token, name: string) =>
    Object.hasOwn(variables, name) ? variables[name] : token,
  )
  return (
    "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'\">" +
    content
  )
}
