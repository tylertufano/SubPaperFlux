import React from 'react'
import { I18nContext } from '../lib/i18n'

type Props = React.PropsWithChildren<{ onRetry?: () => void | Promise<void> }>
type State = { hasError: boolean; error?: unknown }

export default class ErrorBoundary extends React.Component<Props, State> {
  static contextType = I18nContext
  declare context: React.ContextType<typeof I18nContext>

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // TODO: send to monitoring if desired
    console.error('UI ErrorBoundary caught', error, info)
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined }, () => {
      const { onRetry } = this.props
      if (onRetry) {
        Promise.resolve(onRetry()).catch((err) => {
          console.error('ErrorBoundary retry handler failed', err)
        })
      }
    })
  }

  render() {
    const { t } = this.context
    if (this.state.hasError) {
      return (
        <div className="container py-12">
          <div className="mx-auto flex max-w-xl flex-col items-center rounded-lg border border-gray-200 bg-white p-10 text-center shadow-sm">
            <div className="mb-4 text-5xl" aria-hidden="true">
              😵
            </div>
            <h1 className="mb-3 text-2xl font-semibold text-gray-900">{t('error_boundary_title')}</h1>
            <p className="mb-6 text-base text-gray-600">{t('error_boundary_message')}</p>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <button type="button" className="btn" onClick={this.handleRetry}>
                {t('btn_retry')}
              </button>
              <a className="text-sm font-medium text-blue-600 hover:underline" href="mailto:support@subpaperflux.com">
                {t('error_boundary_contact_support')}
              </a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

