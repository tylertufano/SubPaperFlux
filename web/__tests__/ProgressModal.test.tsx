import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProgressModal, { type ProgressModalItem } from '../components/ProgressModal'
import { I18nProvider } from '../lib/i18n'

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>

afterEach(() => {
  cleanup()
})

describe('ProgressModal', () => {
  it('shows cancel button while running', () => {
    const items: ProgressModalItem[] = [{ id: '1', label: 'First', status: 'running' }]
    const onCancel = vi.fn()
    render(
      <ProgressModal
        open
        title="Progress"
        status="running"
        items={items}
        onCancel={onCancel}
      />, { wrapper })
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.queryByText('Close')).not.toBeInTheDocument()
  })

  it('renders close button and message when finished', () => {
    const items: ProgressModalItem[] = [{ id: '1', label: 'First', status: 'success' }]
    const onClose = vi.fn()
    render(
      <ProgressModal
        open
        title="Progress"
        status="success"
        items={items}
        message="All done"
        onClose={onClose}
      />, { wrapper })
    expect(screen.getByText('Close')).toBeInTheDocument()
    expect(screen.getByText('All done')).toBeInTheDocument()
  })

  it('shows per-item status text and message', () => {
    const items: ProgressModalItem[] = [
      { id: '1', label: 'First', status: 'success', message: 'ok' },
      { id: '2', label: 'Second', status: 'failure', message: 'failed to publish' },
    ]
    render(
      <ProgressModal
        open
        title="Progress"
        status="error"
        items={items}
      />, { wrapper })
    const rows = screen.getAllByTestId(/progress-item-/)
    expect(rows[0]).toHaveTextContent('Completed')
    expect(screen.getByTestId('progress-item-2')).toHaveTextContent('Failed — failed to publish')
  })
})
