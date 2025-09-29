const { withSentryConfig } = require('@sentry/nextjs')
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
  analyzerMode: 'static',
  reportFilename: ({ isServer }) => `../analyze/${isServer ? 'server' : 'client'}.html`,
  generateStatsFile: true,
  statsFilename: ({ isServer }) => `../analyze/${isServer ? 'server' : 'client'}-stats.json`,
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
  },
}

const sentryWebpackPluginOptions = {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: process.env.SENTRY_RELEASE,
  dryRun: !process.env.SENTRY_AUTH_TOKEN,
}

module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), sentryWebpackPluginOptions)

