export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init)
  if (!response.ok) {
    const text = await response.text()
    let message = `Request failed (${response.status})`
    let code = 'request_failed'
    try {
      const error = JSON.parse(text) as {
        code?: string
        error?: string
        issues?: { field: string; message: string }[]
      }
      code = typeof error.code === 'string' ? error.code : code
      message =
        error.issues?.map((issue) => `${issue.field}: ${issue.message}`).join('\n') ||
        error.error ||
        message
    } catch {
      /* A proxy may return non-JSON errors. Never render arbitrary response bodies. */
    }
    throw new ApiRequestError(message, code, response.status)
  }
  return response.json() as Promise<T>
}

// Orval passes complete API paths. Preserve signals and the shared coded-error handling.
export function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  return api<T>(url.startsWith('/api') ? url.slice(4) : url, options)
}
