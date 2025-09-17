import type { FullConfig } from '@playwright/test'

const DEFAULT_BASE_URL = 'http://localhost:3000'

export default async function globalSetup(_config: FullConfig) {
  if (!process.env.NEXT_PUBLIC_API_BASE) {
    process.env.NEXT_PUBLIC_API_BASE = DEFAULT_BASE_URL
  }
}
