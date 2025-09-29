import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Bookmarks from '../pages/bookmarks'
import { I18nProvider } from '../lib/i18n'

const { useSWRMock, mutateBookmarksMock, mutateTagsMock, mutateFoldersMock } = vi.hoisted(() => ({
  useSWRMock: vi.fn(),
  mutateBookmarksMock: vi.fn(),
  mutateTagsMock: vi.fn(),
  mutateFoldersMock: vi.fn(),
}))

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(() => ({
    data: { user: { permissions: ['bookmarks:read'] } },
    status: 'authenticated' as const,
  })),
}))

const { bulkUpdateFoldersMock } = vi.hoisted(() => ({
  bulkUpdateFoldersMock: vi.fn(),
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
    bulkUpdateBookmarkTagsV1BookmarksBulkTagsPost: vi.fn(),
    bulkUpdateBookmarkFoldersV1BookmarksBulkFoldersPost: (...args: any[]) => bulkUpdateFoldersMock(...args),
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
    BulkTagModal: () => null,
    ProgressModal: () => null,
    Alert: ({ kind, message }: { kind: string; message: React.ReactNode }) => (
      <div data-testid="alert" data-kind={kind}>{message}</div>
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

describe('Bulk folder assignment modal', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
    mutateBookmarksMock.mockReset()
    mutateTagsMock.mockReset()
    mutateFoldersMock.mockReset()
    useSessionMock.mockReset()
    useSessionMock.mockReturnValue({
      data: { user: { permissions: ['bookmarks:read'] } },
      status: 'authenticated' as const,
    })
    bulkUpdateFoldersMock.mockReset()

    const bookmarksData = {
      items: [
        {
          id: 'bookmark-1',
          title: 'First Bookmark',
          url: 'https://example.com/one',
          published_at: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
      totalPages: 1,
      hasNext: false,
    }
    const tagsData = { items: [] }
    const foldersData = {
      items: [
        { id: 'folder-1', name: 'Reading List', bookmark_count: 2 },
        { id: 'folder-2', name: 'Later', bookmark_count: 0 },
      ],
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
          data: foldersData,
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

  it('assigns selected bookmarks to an existing folder', async () => {
    bulkUpdateFoldersMock.mockResolvedValueOnce(undefined)

    renderBookmarks()

    fireEvent.click(screen.getByLabelText('Select bookmark First Bookmark'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }))

    const dialog = await screen.findByRole('dialog', { name: 'Update folders for selected bookmarks' })
    const folderSelect = within(dialog).getByLabelText('Folder') as HTMLSelectElement
    fireEvent.change(folderSelect, { target: { value: 'folder-2' } })

    const instapaperInput = within(dialog).getByLabelText('Instapaper folder ID (optional)') as HTMLInputElement
    fireEvent.change(instapaperInput, { target: { value: '12345' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(bulkUpdateFoldersMock).toHaveBeenCalledTimes(1))

    const request = bulkUpdateFoldersMock.mock.calls[0][0]?.bulkBookmarkFolderUpdate
    expect(request?.bookmarkIds).toEqual(['bookmark-1'])
    expect(request?.folderId).toBe('folder-2')
    expect(request?.instapaperFolderId).toBe('12345')

    await waitFor(() => expect(screen.getByTestId('alert')).toHaveAttribute('data-kind', 'success'))
    expect(screen.getByTestId('alert')).toHaveTextContent('Moved 1 bookmarks to Later.')

    expect(mutateFoldersMock).toHaveBeenCalled()
    expect(mutateBookmarksMock).toHaveBeenCalled()

    expect(screen.getByText('0 selected')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Update folders for selected bookmarks' })).not.toBeInTheDocument()
  })

  it('clears folder assignments when requested', async () => {
    bulkUpdateFoldersMock.mockResolvedValueOnce(undefined)

    renderBookmarks()

    fireEvent.click(screen.getByLabelText('Select bookmark First Bookmark'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }))

    const dialog = await screen.findByRole('dialog', { name: 'Update folders for selected bookmarks' })
    fireEvent.click(within(dialog).getByText('Clear folder assignment'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(bulkUpdateFoldersMock).toHaveBeenCalledTimes(1))

    const request = bulkUpdateFoldersMock.mock.calls[0][0]?.bulkBookmarkFolderUpdate
    expect(request?.bookmarkIds).toEqual(['bookmark-1'])
    expect(request?.folderId).toBeNull()
    expect(request?.instapaperFolderId).toBeNull()

    await waitFor(() => expect(screen.getByTestId('alert')).toHaveAttribute('data-kind', 'success'))
    expect(screen.getByTestId('alert')).toHaveTextContent('Cleared folders from 1 bookmarks.')

    expect(mutateFoldersMock).toHaveBeenCalled()
    expect(mutateBookmarksMock).toHaveBeenCalled()
  })

  it('shows an error banner when the bulk folder update fails', async () => {
    bulkUpdateFoldersMock.mockRejectedValueOnce(new Error('Boom'))

    renderBookmarks()

    fireEvent.click(screen.getByLabelText('Select bookmark First Bookmark'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }))

    const dialog = await screen.findByRole('dialog', { name: 'Update folders for selected bookmarks' })
    const folderSelect = within(dialog).getByLabelText('Folder') as HTMLSelectElement
    fireEvent.change(folderSelect, { target: { value: 'folder-1' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(bulkUpdateFoldersMock).toHaveBeenCalledTimes(1))

    await waitFor(() => expect(screen.getByTestId('alert')).toHaveAttribute('data-kind', 'error'))
    expect(screen.getByTestId('alert')).toHaveTextContent('Failed to update folders: Boom')

    expect(within(dialog).getByText('Failed to update folders: Boom')).toBeInTheDocument()

    expect(mutateFoldersMock).not.toHaveBeenCalled()
    expect(mutateBookmarksMock).not.toHaveBeenCalled()

    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Update folders for selected bookmarks' })).toBeInTheDocument()
  })
})
