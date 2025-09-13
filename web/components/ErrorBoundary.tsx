import React from 'react'

type State = { hasError: boolean; error?: any }

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
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
    if (this.state.hasError) {
      return (
        <div className="container py-8">
          <div className="card p-6">
            <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-gray-600">Try reloading the page. If the problem persists, contact support.</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

