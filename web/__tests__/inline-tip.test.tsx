import React, { type ReactNode } from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import InlineTip from '../components/InlineTip'
import { I18nProvider } from '../lib/i18n'

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>

afterEach(() => {
  cleanup()
})

describe('InlineTip', () => {
  it('renders the provided message and dismiss button', () => {
    render(<InlineTip message="Remember to save" />, { wrapper })

    expect(screen.getByText('Remember to save')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss tip' })).toBeInTheDocument()
  })

  it('hides the tip when dismissed', () => {
    render(<InlineTip message="Check filters" />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }))

    expect(screen.queryByText('Check filters')).not.toBeInTheDocument()
  })

  it('calls onDismiss when provided', () => {
    const onDismiss = vi.fn()
    render(<InlineTip message="Try a regex" onDismiss={onDismiss} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
