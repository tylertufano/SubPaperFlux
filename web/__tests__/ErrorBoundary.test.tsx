import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ErrorBoundary from '../components/ErrorBoundary'
import { I18nContext } from '../lib/i18n'
import enMessages from '../locales/en/common.json'

const messages = enMessages as Record<string, string>

function renderWithI18n(ui: React.ReactElement) {
  const value = {
    locale: 'en',
    locales: ['en', 'pseudo'],
    setLocale: vi.fn(),
    t: (key: string) => messages[key] ?? key,
  }
  return render(<I18nContext.Provider value={value}>{ui}</I18nContext.Provider>)
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('renders fallback UI with retry and contact link when a child throws', async () => {
    const onRetry = vi.fn()

    const ThrowingComponent = () => {
      throw new Error('Fetch failed')
    }

    renderWithI18n(
      <ErrorBoundary onRetry={onRetry}>
        <ThrowingComponent />
      </ErrorBoundary>,
    )

    expect(
      screen.getByRole('heading', { name: messages.error_boundary_title }),
    ).toBeInTheDocument()
    expect(screen.getByText(messages.error_boundary_message)).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: messages.btn_retry })
    expect(retryButton).toBeInTheDocument()

    fireEvent.click(retryButton)
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1))

    const contactLink = screen.getByRole('link', {
      name: messages.error_boundary_contact_support,
    })
    expect(contactLink).toHaveAttribute('href', 'mailto:support@subpaperflux.com')
  })

})
