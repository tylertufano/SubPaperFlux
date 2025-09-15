import React from 'react'
import { I18nContext } from '../lib/i18n'

type State = { hasError: boolean; error?: any }

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  static contextType = I18nContext
  declare context: React.ContextType<typeof I18nContext>
  constructor(props: any) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error }
  }
  componentDidCatch(error: any, info: any) {
    // TODO: send to monitoring if desired
    console.error('UI ErrorBoundary caught', error, info)
  }
  render() {
    const { t } = this.context
    if (this.state.hasError) {
      return (
        <div className="container py-8">
          <div className="card p-6">
            <h1 className="text-xl font-semibold mb-2">{t('error_boundary_title')}</h1>
            <p className="text-gray-600">{t('error_boundary_message')}</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

