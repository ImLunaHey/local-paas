import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { cn: fileURLToPath(new URL('./src/cn.ts', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.*', 'src/test-setup.ts', 'src/generated/**'],
    },
  },
})
