import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000'
const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  timeout: isCI ? 120_000 : 60_000,
  expect: {
    timeout: 5_000,
  },
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !isCI,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_BASE: baseURL,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: isCI ? [['github'], ['list']] : 'list',
  globalSetup: './e2e/playwright.setup',
})
