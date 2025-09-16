import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Bookmarks from '../pages/bookmarks'
import { I18nProvider } from '../lib/i18n'

const { useSWRMock, mutateMock } = vi.hoisted(() => ({
  useSWRMock: vi.fn(),
  mutateMock: vi.fn(),
}))

const { streamBulkPublishMock } = vi.hoisted(() => ({
  streamBulkPublishMock: vi.fn(),
}))

vi.mock('swr', () => ({
  __esModule: true,
  default: (key: any, fetcher?: any) => useSWRMock(key, fetcher),
}))

vi.mock('../lib/bulkPublish', () => ({
  streamBulkPublish: (args: any) => streamBulkPublishMock(args),
}))

vi.mock('../components', async () => {
  const modalModule = await vi.importActual('../components/BulkPublishModal') as any
  const progressModule = await vi.importActual('../components/ProgressModal') as any
  return {
    __esModule: true,
    BulkPublishModal: modalModule.default,
    ProgressModal: progressModule.default,
    Alert: ({ kind, message }: { kind: string; message: React.ReactNode }) => (
      <div data-testid="alert" data-kind={kind}>
        {message}
      </div>
    ),
    EmptyState: ({ message, action }: any) => (
      <div data-testid="empty-state">
        <div>{message}</div>
        {action}
      </div>
    ),
    Nav: () => <nav data-testid="nav">Nav</nav>,
    DropdownMenu: () => null,
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PreviewPane: ({ snippet }: { snippet?: string }) => (
      <div data-testid="preview-pane">{snippet}</div>
    ),
  }
})

function renderBookmarks() {
  return render(
    <I18nProvider>
      <Bookmarks />
    </I18nProvider>,
  )
}

describe('Bookmarks bulk publish modal', () => {
  beforeEach(() => {
    mutateMock.mockReset()
    streamBulkPublishMock.mockReset()
    useSWRMock.mockReset()
    const bookmarksData = {
      items: [
        {
          id: 'bookmark-1',
          title: 'First Bookmark',
          url: 'https://example.com/one',
          published_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'bookmark-2',
          title: 'Second Bookmark',
          url: 'https://example.com/two',
          published_at: '2024-01-02T00:00:00Z',
        },
      ],
      total: 2,
      totalPages: 1,
      hasNext: false,
    }
    useSWRMock.mockImplementation((key: any) => {
      if (Array.isArray(key) && key[0] === '/v1/bookmarks') {
        if (key[2] === 'preview') {
          return {
            data: '<p>Preview</p>',
            error: undefined,
            isLoading: false,
            mutate: vi.fn(),
          }
        }
        return {
          data: bookmarksData,
          error: undefined,
          isLoading: false,
          mutate: mutateMock,
        }
      }
      if (Array.isArray(key) && key[0] === '/v1/feeds') {
        return {
          data: { items: [] },
          error: undefined,
          isLoading: false,
          mutate: vi.fn(),
        }
      }
      return {
        data: undefined,
        error: undefined,
        isLoading: false,
        mutate: vi.fn(),
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('transitions modal through streaming events and shows partial failure summary', async () => {
    streamBulkPublishMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: 'start', total: 2 })
      await Promise.resolve()
      onEvent?.({ type: 'item', id: 'bookmark-1', status: 'running' })
      await Promise.resolve()
      onEvent?.({ type: 'item', id: 'bookmark-1', status: 'success' })
      await Promise.resolve()
      onEvent?.({ type: 'item', id: 'bookmark-2', status: 'error', message: 'API said nope' })
      await Promise.resolve()
      onEvent?.({ type: 'complete', success: 1, failed: 1 })
      return { success: 1, failed: 1 }
    })

    renderBookmarks()

    const firstCheckbox = screen.getByLabelText('Select bookmark First Bookmark')
    const secondCheckbox = screen.getByLabelText('Select bookmark Second Bookmark')
    fireEvent.click(firstCheckbox)
    fireEvent.click(secondCheckbox)

    const publishButton = screen.getByRole('button', { name: 'Publish Selected' })
    expect(publishButton).toBeEnabled()
    fireEvent.click(publishButton)

    await waitFor(() => expect(streamBulkPublishMock).toHaveBeenCalledTimes(1))

    const callArgs = streamBulkPublishMock.mock.calls[0][0]
    expect(callArgs.requestBody.items).toHaveLength(2)
    expect(callArgs.requestBody.items[0]).toMatchObject({ id: 'bookmark-1' })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/Publishing 2 items/)).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByTestId('progress-item-bookmark-2')).toHaveTextContent('Failed — API said nope')
    })

    await waitFor(() => {
      expect(screen.getByText('1 published, 1 failed.')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByTestId('alert')).toHaveTextContent('Published 1 items; 1 failed.')
    })

    expect(mutateMock).toHaveBeenCalled()
  })

  it('shows API error details when bulk publish fails', async () => {
    streamBulkPublishMock.mockRejectedValue(new Error('Server exploded'))

    renderBookmarks()

    fireEvent.click(screen.getByLabelText('Select bookmark First Bookmark'))
    fireEvent.click(screen.getByLabelText('Select bookmark Second Bookmark'))

    fireEvent.click(screen.getByRole('button', { name: 'Publish Selected' }))

    await waitFor(() => expect(streamBulkPublishMock).toHaveBeenCalledTimes(1))

    await waitFor(() => {
      expect(screen.getByText('Publish failed: Server exploded')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByTestId('alert')).toHaveTextContent('Bulk publish failed: Server exploded')
    })

    expect(mutateMock).not.toHaveBeenCalled()
  })
})
