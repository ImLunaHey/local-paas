import { defineConfig } from 'orval'
export default defineConfig({
  management: {
    input: '../docs/api/openapi.json',
    output: {
      target: 'src/generated/management.ts',
      schemas: 'src/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: 'src/api-client.ts', name: 'apiFetch' },
      },
    },
  },
})
