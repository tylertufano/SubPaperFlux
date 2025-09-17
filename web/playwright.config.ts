import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000'
const isCI = !!process.env.CI
const oidcStubPort = Number(process.env.OIDC_STUB_PORT ?? 4455)
const defaultOidcIssuer = `http://127.0.0.1:${oidcStubPort}/oidc`
const oidcIssuer = process.env.OIDC_ISSUER ?? defaultOidcIssuer
const oidcClientId = process.env.OIDC_CLIENT_ID ?? 'local'
const oidcClientSecret = process.env.OIDC_CLIENT_SECRET ?? 'local'
const oidcJwksUrl = process.env.OIDC_JWKS_URL ?? `${oidcIssuer.replace(/\/$/, '')}/jwks`
const nextAuthSecret = process.env.NEXTAUTH_SECRET ?? 'devsecret'

process.env.OIDC_ISSUER = oidcIssuer
process.env.OIDC_CLIENT_ID = oidcClientId
process.env.OIDC_CLIENT_SECRET = oidcClientSecret
process.env.OIDC_JWKS_URL = oidcJwksUrl
process.env.NEXTAUTH_SECRET = nextAuthSecret

export default defineConfig({
  testDir: '../web/e2e',
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
      OIDC_ISSUER: oidcIssuer,
      OIDC_CLIENT_ID: oidcClientId,
      OIDC_CLIENT_SECRET: oidcClientSecret,
      OIDC_JWKS_URL: oidcJwksUrl,
      NEXTAUTH_SECRET: nextAuthSecret,
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
