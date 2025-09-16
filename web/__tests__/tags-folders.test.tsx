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

const {
  getBookmarkTagsMock,
  updateBookmarkTagsMock,
  getBookmarkFolderMock,
  updateBookmarkFolderMock,
  deleteBookmarkFolderMock,
} = vi.hoisted(() => ({
  getBookmarkTagsMock: vi.fn(),
  updateBookmarkTagsMock: vi.fn(),
  getBookmarkFolderMock: vi.fn(),
  updateBookmarkFolderMock: vi.fn(),
  deleteBookmarkFolderMock: vi.fn(),
}))

vi.mock('swr', () => ({
  __esModule: true,
  default: (key: any, fetcher?: any) => useSWRMock(key, fetcher),
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
    getBookmarkTagsBookmarksBookmarkIdTagsGet: (...args: any[]) => getBookmarkTagsMock(...args),
    updateBookmarkTagsBookmarksBookmarkIdTagsPut: (...args: any[]) => updateBookmarkTagsMock(...args),
    getBookmarkFolderBookmarksBookmarkIdFolderGet: (...args: any[]) => getBookmarkFolderMock(...args),
    updateBookmarkFolderBookmarksBookmarkIdFolderPut: (...args: any[]) => updateBookmarkFolderMock(...args),
    deleteBookmarkFolderBookmarksBookmarkIdFolderDelete: (...args: any[]) => deleteBookmarkFolderMock(...args),
  },
}))

vi.mock('../components', async () => {
  const modalModule = await vi.importActual('../components/BulkPublishModal') as any
  const progressModule = await vi.importActual('../components/ProgressModal') as any
  return {
    __esModule: true,
    BulkPublishModal: modalModule.default,
    ProgressModal: progressModule.default,
    Alert: ({ kind, message }: { kind: string; message: React.ReactNode }) => (
      <div data-testid="alert" data-kind={kind}>{message}</div>
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
  }
})

function renderBookmarks() {
  return render(
    <I18nProvider>
      <Bookmarks />
    </I18nProvider>,
  )
}

describe('Bookmark tag assignment and folder moves', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
    mutateBookmarksMock.mockReset()
    mutateTagsMock.mockReset()
    mutateFoldersMock.mockReset()
    getBookmarkTagsMock.mockReset()
    updateBookmarkTagsMock.mockReset()
    getBookmarkFolderMock.mockReset()
    updateBookmarkFolderMock.mockReset()
    deleteBookmarkFolderMock.mockReset()

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
    const tagsData = { items: [{ id: 'tag-1', name: 'Initial Tag', bookmark_count: 1 }] }
    const foldersData = { items: [
      { id: 'folder-1', name: 'Reading List', bookmark_count: 2 },
      { id: 'folder-2', name: 'Later', bookmark_count: 0 },
    ] }

    useSWRMock.mockImplementation((key: any) => {
      if (Array.isArray(key) && key[0] === '/v1/bookmarks') {
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

  it('updates bookmark tags through the assignment modal', async () => {
    getBookmarkTagsMock.mockResolvedValueOnce([
      { id: 'tag-1', name: 'Initial Tag' },
    ])
    updateBookmarkTagsMock.mockResolvedValueOnce([])

    renderBookmarks()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Tags' }))

    await waitFor(() => expect(getBookmarkTagsMock).toHaveBeenCalledWith({ bookmarkId: 'bookmark-1' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit tags for First Bookmark' })
    const input = within(dialog).getByLabelText('Tags (comma-separated)') as HTMLInputElement
    expect(input.value).toBe('Initial Tag')

    fireEvent.change(input, { target: { value: 'Alpha, Beta' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateBookmarkTagsMock).toHaveBeenCalledTimes(1))
    expect(updateBookmarkTagsMock).toHaveBeenCalledWith({
      bookmarkId: 'bookmark-1',
      bookmarkTagsUpdate: { tags: ['Alpha', 'Beta'] },
    })

    await waitFor(() => expect(screen.getByTestId('alert')).toHaveTextContent('Updated tags for First Bookmark (2 total).'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit tags for First Bookmark' })).not.toBeInTheDocument())

    expect(mutateBookmarksMock).toHaveBeenCalled()
    expect(mutateTagsMock).toHaveBeenCalled()
  })

  it('moves bookmark to a new folder from the modal', async () => {
    getBookmarkFolderMock.mockResolvedValueOnce(null)
    updateBookmarkFolderMock.mockResolvedValueOnce({})

    renderBookmarks()

    fireEvent.click(screen.getByRole('button', { name: 'Move Folder' }))

    await waitFor(() => expect(getBookmarkFolderMock).toHaveBeenCalledWith({ bookmarkId: 'bookmark-1' }))

    const dialog = await screen.findByRole('dialog', { name: 'Move First Bookmark to folder' })
    const nameInput = within(dialog).getByLabelText('New folder name') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Fresh Reads' } })

    const instapaperInput = within(dialog).getByLabelText('Instapaper folder ID') as HTMLInputElement
    fireEvent.change(instapaperInput, { target: { value: '456' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateBookmarkFolderMock).toHaveBeenCalledTimes(1))
    expect(updateBookmarkFolderMock).toHaveBeenCalledWith({
      bookmarkId: 'bookmark-1',
      bookmarkFolderUpdate: {
        folder_name: 'Fresh Reads',
        instapaper_folder_id: '456',
      },
    })

    await waitFor(() => expect(screen.getByTestId('alert')).toHaveTextContent('Created folder Fresh Reads and moved bookmark.'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move First Bookmark to folder' })).not.toBeInTheDocument())

    expect(mutateBookmarksMock).toHaveBeenCalled()
    expect(mutateFoldersMock).toHaveBeenCalled()
    expect(deleteBookmarkFolderMock).not.toHaveBeenCalled()
  })
})
