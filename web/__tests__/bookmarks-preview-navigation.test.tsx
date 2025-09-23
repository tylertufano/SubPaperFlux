import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Bookmarks from '../pages/bookmarks'
import { I18nProvider } from '../lib/i18n'

const { useSWRMock, mutateBookmarksMock, mutateTagsMock, mutateFoldersMock, mutatePreviewMock, useSessionMock } = vi.hoisted(() => ({
  useSWRMock: vi.fn(),
  mutateBookmarksMock: vi.fn(),
  mutateTagsMock: vi.fn(),
  mutateFoldersMock: vi.fn(),
  mutatePreviewMock: vi.fn(),
  useSessionMock: vi.fn(() => ({
    data: { user: { permissions: ['bookmarks:read'] } },
    status: 'authenticated' as const,
  })),
}))

vi.mock('swr', () => ({
  __esModule: true,
  default: (key: any, fetcher?: any) => useSWRMock(key, fetcher),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/bookmarks' }),
}))

vi.mock('../lib/bulkPublish', () => ({
  streamBulkPublish: vi.fn(),
}))

vi.mock('../lib/openapi', () => ({
  v1: {
    listBookmarksV1BookmarksGet: vi.fn(),
    listFeedsV1V1FeedsGet: vi.fn(),
    listTagsBookmarksTagsGet: vi.fn(),
    listFoldersBookmarksFoldersGet: vi.fn(),
    previewBookmarkV1BookmarksBookmarkIdPreviewGet: vi.fn(),
  },
}))

vi.mock('next-auth/react', () => ({
  __esModule: true,
  useSession: () => useSessionMock(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../components', async () => {
  const previewModule = await vi.importActual('../components/PreviewPane') as any
  const toolbarModule = await vi.importActual('../components/BulkActionToolbar') as any
  return {
    __esModule: true,
    BulkPublishModal: () => null,
    BulkActionToolbar: toolbarModule.default,
    BulkTagModal: () => null,
    ProgressModal: () => null,
    Alert: ({ message }: { message: React.ReactNode }) => (
      <div data-testid="alert">{message}</div>
    ),
    EmptyState: ({ message }: { message: React.ReactNode }) => (
      <div data-testid="empty-state">{message}</div>
    ),
    Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
    Nav: () => <nav data-testid="nav">Nav</nav>,
    DropdownMenu: () => null,
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PreviewPane: previewModule.default,
  }
})

describe('Bookmarks preview keyboard navigation', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
    mutateBookmarksMock.mockReset()
    mutateTagsMock.mockReset()
    mutateFoldersMock.mockReset()
    mutatePreviewMock.mockReset()
    useSessionMock.mockReset()
    useSessionMock.mockReturnValue({
      data: { user: { permissions: ['bookmarks:read'] } },
      status: 'authenticated' as const,
    })
    localStorage.clear()

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
      if (!key) {
        return {
          data: undefined,
          error: undefined,
          isLoading: false,
          mutate: vi.fn(),
        }
      }

      if (Array.isArray(key) && key[0] === '/v1/bookmarks') {
        if (key[2] === 'preview') {
          const bookmarkId = key[1]
          return {
            data: `Preview for ${bookmarkId}`,
            error: undefined,
            isLoading: false,
            mutate: mutatePreviewMock,
          }
        }
        return {
          data: bookmarksData,
          error: undefined,
          isLoading: false,
          mutate: mutateBookmarksMock,
        }
      }

      if (Array.isArray(key) && key[0] === '/v1/bookmarks/tags') {
        return {
          data: { items: [] },
          error: undefined,
          isLoading: false,
          mutate: mutateTagsMock,
        }
      }

      if (Array.isArray(key) && key[0] === '/v1/bookmarks/folders') {
        return {
          data: { items: [] },
          error: undefined,
          isLoading: false,
          mutate: mutateFoldersMock,
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

  it('moves selection with arrow keys and keeps focus in sync', async () => {
    render(
      <I18nProvider>
        <Bookmarks />
      </I18nProvider>,
    )

    const firstRow = screen.getByText('First Bookmark').closest('tr') as HTMLTableRowElement
    const secondRow = screen.getByText('Second Bookmark').closest('tr') as HTMLTableRowElement
    const previewRegion = screen.getByRole('region', { name: 'Preview' })

    expect(firstRow).not.toBeNull()
    expect(secondRow).not.toBeNull()

    firstRow.focus()
    expect(firstRow).toHaveFocus()

    fireEvent.keyDown(firstRow, { key: 'ArrowDown' })

    await waitFor(() => expect(secondRow).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(secondRow).toHaveFocus())
    await waitFor(() => expect(previewRegion).toHaveTextContent('Preview for bookmark-2'))
    await waitFor(() => {
      expect(
        useSWRMock.mock.calls.some(
          ([key]) => Array.isArray(key) && key[0] === '/v1/bookmarks' && key[1] === 'bookmark-2' && key[2] === 'preview',
        ),
      ).toBe(true)
    })

    fireEvent.keyDown(secondRow, { key: 'ArrowUp' })

    await waitFor(() => expect(firstRow).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(firstRow).toHaveFocus())
    await waitFor(() => expect(previewRegion).toHaveTextContent('Preview for bookmark-1'))
    await waitFor(() => {
      expect(
        useSWRMock.mock.calls.some(
          ([key]) => Array.isArray(key) && key[0] === '/v1/bookmarks' && key[1] === 'bookmark-1' && key[2] === 'preview',
        ),
      ).toBe(true)
    })
  })

  it('activates previews with Enter and Space', async () => {
    render(
      <I18nProvider>
        <Bookmarks />
      </I18nProvider>,
    )

    const firstRow = screen.getByText('First Bookmark').closest('tr') as HTMLTableRowElement
    const secondRow = screen.getByText('Second Bookmark').closest('tr') as HTMLTableRowElement
    const previewRegion = screen.getByRole('region', { name: 'Preview' })

    expect(firstRow).not.toBeNull()
    expect(secondRow).not.toBeNull()

    firstRow.focus()
    expect(firstRow).toHaveFocus()

    fireEvent.keyDown(firstRow, { key: 'Enter' })

    await waitFor(() => expect(firstRow).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(previewRegion).toHaveTextContent('Preview for bookmark-1'))
    await waitFor(() => {
      expect(
        useSWRMock.mock.calls.some(
          ([key]) => Array.isArray(key) && key[0] === '/v1/bookmarks' && key[1] === 'bookmark-1' && key[2] === 'preview',
        ),
      ).toBe(true)
    })

    secondRow.focus()
    expect(secondRow).toHaveFocus()

    fireEvent.keyDown(secondRow, { key: 'Space' })

    await waitFor(() => expect(secondRow).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(previewRegion).toHaveTextContent('Preview for bookmark-2'))
    await waitFor(() => {
      expect(
        useSWRMock.mock.calls.some(
          ([key]) => Array.isArray(key) && key[0] === '/v1/bookmarks' && key[1] === 'bookmark-2' && key[2] === 'preview',
        ),
      ).toBe(true)
    })
  })
})
