import type { AppProps } from 'next/app'
import { SessionProvider } from 'next-auth/react'
import '../styles/globals.css'
import ErrorBoundary from '../components/ErrorBoundary'
import { I18nProvider } from '../lib/i18n'
import { ThemeProvider } from '../lib/theme'
import { initSentry } from '../lib/sentry'

initSentry()

export default function MyApp({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  return (
    <SessionProvider session={session}>
      <I18nProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <Component {...pageProps} />
          </ErrorBoundary>
        </ThemeProvider>
      </I18nProvider>
    </SessionProvider>
  )
}
