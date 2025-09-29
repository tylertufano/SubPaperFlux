import * as Sentry from '@sentry/nextjs'
import { createSentryRuntimeConfig } from '../sentry.config'

type SentryGlobal = typeof globalThis & {
  __subpaperfluxSentryInitialized?: boolean
}

const globalWithFlag = globalThis as SentryGlobal

export function initSentry() {
  if (globalWithFlag.__subpaperfluxSentryInitialized) {
    return
  }

  const { dsn, environment, release, tracesSampleRate, enabled } = createSentryRuntimeConfig()

  Sentry.init({
    dsn,
    environment,
    release,
    enabled,
    tracesSampleRate,
  })

  globalWithFlag.__subpaperfluxSentryInitialized = true
}
