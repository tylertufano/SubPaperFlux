import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Bookmarks from '../pages/bookmarks'
import { I18nProvider } from '../lib/i18n'

const { useSWRMock, mutateBookmarksMock, mutateTagsMock } = vi.hoisted(() => ({
  useSWRMock: vi.fn(),
  mutateBookmarksMock: vi.fn(),
  mutateTagsMock: vi.fn(),
}))

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(() => ({
    data: { user: { permissions: ['bookmarks:read'] } },
    status: 'authenticated' as const,
  })),
}))

const { bulkUpdateBookmarkTagsMock } = vi.hoisted(() => ({
  bulkUpdateBookmarkTagsMock: vi.fn(),
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
    createTagBookmarksTagsPost: vi.fn(),
    updateTagBookmarksTagsTagIdPut: vi.fn(),
    deleteTagBookmarksTagsTagIdDelete: vi.fn(),
    createFolderBookmarksFoldersPost: vi.fn(),
    updateFolderBookmarksFoldersFolderIdPut: vi.fn(),
    deleteFolderBookmarksFoldersFolderIdDelete: vi.fn(),
    bulkDeleteBookmarksV1BookmarksBulkDeletePost: vi.fn(),
    bulkUpdateBookmarkTagsBookmarksBulkTagsPost: vi.fn(),
    bulkUpdateBookmarkTagsV1BookmarksBulkTagsPost: (...args: any[]) => bulkUpdateBookmarkTagsMock(...args),
    bulkUpdateBookmarkFoldersBookmarksBulkFoldersPost: vi.fn(),
    bulkUpdateBookmarkFoldersV1BookmarksBulkFoldersPost: vi.fn(),
    getBookmarkTagsBookmarksBookmarkIdTagsGet: vi.fn(),
    updateBookmarkTagsBookmarksBookmarkIdTagsPut: vi.fn(),
    getBookmarkFolderBookmarksBookmarkIdFolderGet: vi.fn(),
    updateBookmarkFolderBookmarksBookmarkIdFolderPut: vi.fn(),
    deleteBookmarkFolderBookmarksBookmarkIdFolderDelete: vi.fn(),
  },
}))

vi.mock('../components', async () => {
  const actual = await vi.importActual<typeof import('../components')>('../components')
  return {
    __esModule: true,
    ...actual,
    BulkPublishModal: () => null,
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
    Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
    Nav: () => <nav data-testid="nav">Nav</nav>,
    DropdownMenu: () => null,
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PreviewPane: ({ snippet }: { snippet?: string }) => (
      <div data-testid="preview-pane">{snippet}</div>
    ),
  }
})

vi.mock('next-auth/react', () => ({
  __esModule: true,
  useSession: () => useSessionMock(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

function renderBookmarks() {
  return render(
    <I18nProvider>
      <Bookmarks />
    </I18nProvider>,
  )
}

describe('Bulk tag assignment modal', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
    mutateBookmarksMock.mockReset()
    mutateTagsMock.mockReset()
    bulkUpdateBookmarkTagsMock.mockReset()
    useSessionMock.mockReset()
    useSessionMock.mockReturnValue({
      data: { user: { permissions: ['bookmarks:read'] } },
      status: 'authenticated' as const,
    })

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
    const tagsData = { items: [
      { id: 'tag-1', name: 'Research' },
      { id: 'tag-2', name: 'Reading' },
    ] }

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
          mutate: mutateBookmarksMock,
        }
      }
      if (Array.isArray(key) && key[0] === '/v1/bookmarks/tags') {
        return {
          data: tagsData,
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
          mutate: vi.fn(),
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

  it('applies tags to all selected bookmarks', async () => {
    bulkUpdateBookmarkTagsMock.mockResolvedValueOnce([])

    renderBookmarks()

    fireEvent.click(screen.getByLabelText('Select bookmark First Bookmark'))
    fireEvent.click(screen.getByLabelText('Select bookmark Second Bookmark'))

    const assignButton = screen.getByRole('button', { name: 'Assign Tags' })
    expect(assignButton).toBeEnabled()
    fireEvent.click(assignButton)

    const dialog = await screen.findByRole('dialog', { name: 'Assign tags to selected bookmarks' })
    const input = within(dialog).getByLabelText('Tags (comma-separated)') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Alpha, Beta' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(bulkUpdateBookmarkTagsMock).toHaveBeenCalledTimes(1))

    expect(bulkUpdateBookmarkTagsMock).toHaveBeenCalledWith({
      bulkBookmarkTagUpdate: {
        bookmarkIds: ['bookmark-1', 'bookmark-2'],
        tags: ['Alpha', 'Beta'],
        clear: false,
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('alert')).toHaveTextContent('Applied 2 tags to 2 bookmarks.')
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Assign tags to selected bookmarks' })).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assign Tags' })).toBeDisabled()
    })

    expect((screen.getByLabelText('Select bookmark First Bookmark') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('Select bookmark Second Bookmark') as HTMLInputElement).checked).toBe(false)
    expect(mutateBookmarksMock).toHaveBeenCalled()
    expect(mutateTagsMock).toHaveBeenCalled()
  })

  it('shows validation error when no tags are provided', async () => {
    renderBookmarks()

    fireEvent.click(screen.getByLabelText('Select bookmark First Bookmark'))

    fireEvent.click(screen.getByRole('button', { name: 'Assign Tags' }))

    const dialog = await screen.findByRole('dialog', { name: 'Assign tags to selected bookmarks' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Enter at least one tag or choose "Clear all tags".')
    expect(bulkUpdateBookmarkTagsMock).not.toHaveBeenCalled()
  })
})
