import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5188'

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      // Test the real tailnet endpoint on hosts that don't accept MagicDNS.
      // TLS certificate validation and the browser's HTTPS origin remain intact.
      args: process.env.E2E_RESOLVE_IP
        ? [`--host-resolver-rules=MAP ${new URL(baseURL).hostname} ${process.env.E2E_RESOLVE_IP}`]
        : [],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Run make db and make api separately. The API must use a disposable DB.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5188',
    reuseExistingServer: !process.env.CI,
  },
})
