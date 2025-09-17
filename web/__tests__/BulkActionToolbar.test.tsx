import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BulkActionToolbar from '../components/BulkActionToolbar'
import { I18nProvider } from '../lib/i18n'

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>

afterEach(() => {
  cleanup()
})

describe('BulkActionToolbar', () => {
  it('disables actions and clear button when nothing is selected', () => {
    render(
      <BulkActionToolbar
        selectedCount={0}
        onClearSelection={vi.fn()}
        actions={[
          { label: 'Publish Selected', onClick: vi.fn() },
          { label: 'Delete Selected', onClick: vi.fn() },
        ]}
      />, { wrapper },
    )

    expect(screen.getByText('0 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Publish Selected' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeDisabled()
  })

  it('calls onClearSelection when the clear button is pressed', () => {
    const onClear = vi.fn()
    render(
      <BulkActionToolbar
        selectedCount={3}
        onClearSelection={onClear}
        actions={[
          { label: 'Publish Selected', onClick: vi.fn() },
          { label: 'Delete Selected', onClick: vi.fn() },
        ]}
      />, { wrapper },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('renders multiple actions and marks busy ones as such', () => {
    const publish = vi.fn()
    const remove = vi.fn()
    render(
      <BulkActionToolbar
        selectedCount={2}
        actions={[
          { label: 'Publish Selected', onClick: publish, busy: true },
          { label: 'Delete Selected', onClick: remove },
        ]}
        onClearSelection={vi.fn()}
      />, { wrapper },
    )

    const publishButton = screen.getByRole('button', { name: /Publish Selected/ })
    expect(publishButton).toBeDisabled()
    expect(publishButton).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeEnabled()
  })
})
