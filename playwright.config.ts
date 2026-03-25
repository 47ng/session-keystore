import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  use: {
    baseURL: 'http://localhost:3456'
  },
  webServer: {
    command: 'npx serve e2e/fixture -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: true
  }
})
