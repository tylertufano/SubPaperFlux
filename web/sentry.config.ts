export type SentryRuntimeConfig = {
  dsn?: string
  environment?: string
  release?: string
  tracesSampleRate: number
  enabled: boolean
}

function parseSampleRate(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function createSentryRuntimeConfig(): SentryRuntimeConfig {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || undefined
  const environment =
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || undefined
  const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.SENTRY_RELEASE || undefined
  const tracesSampleRate = parseSampleRate(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || process.env.SENTRY_TRACES_SAMPLE_RATE,
  )

  return {
    dsn,
    environment,
    release,
    tracesSampleRate,
    enabled: Boolean(dsn),
  }
}
