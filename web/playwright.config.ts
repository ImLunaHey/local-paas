import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5188'
const authState = process.env.E2E_AUTH_STATE
const browserNames = process.env.CI
  ? (['chromium', 'firefox', 'webkit'] as const)
  : (['chromium'] as const)

export default defineConfig({
  testDir: './tests',
  projects: authState
    ? [
        {
          name: 'setup',
          testMatch: /auth\.setup\.ts/,
        },
        ...browserNames.map((browserName) => ({
          name: browserName,
          dependencies: ['setup'],
          testIgnore: /auth\.setup\.ts/,
          use: { browserName, storageState: authState },
        })),
      ]
    : undefined,
  workers: 1,
  use: {
    baseURL,
    colorScheme: 'dark',
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
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
