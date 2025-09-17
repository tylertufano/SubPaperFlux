import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Bookmarks from '../pages/bookmarks'
import { I18nProvider } from '../lib/i18n'

const {
  useSWRMock,
  mutateBookmarksMock,
  mutateTagsMock,
  mutateFoldersMock,
  mutatePreviewMock,
  updateTagMock,
} = vi.hoisted(() => ({
  useSWRMock: vi.fn(),
  mutateBookmarksMock: vi.fn(),
  mutateTagsMock: vi.fn(),
  mutateFoldersMock: vi.fn(),
  mutatePreviewMock: vi.fn(),
  updateTagMock: vi.fn(),
}))

vi.mock('swr', () => ({
  __esModule: true,
  default: (key: any, fetcher?: any) => useSWRMock(key, fetcher),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/bookmarks' }),
}))

vi.mock('../components', async () => {
  const previewModule = await vi.importActual('../components/PreviewPane') as any
  const toolbarModule = await vi.importActual('../components/BulkActionToolbar') as any
  return {
    __esModule: true,
    Alert: ({ message }: { message: React.ReactNode }) => (
      <div role="alert">{message}</div>
    ),
    Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
    BulkActionToolbar: toolbarModule.default,
    BulkFolderModal: () => null,
    BulkPublishModal: () => null,
    BulkTagModal: () => null,
    EmptyState: ({ message, action }: { message: React.ReactNode; action?: React.ReactNode }) => (
      <div>
        <div>{message}</div>
        {action}
      </div>
    ),
    Nav: () => <nav data-testid="nav">Nav</nav>,
    PreviewPane: previewModule.default,
  }
})

vi.mock('../lib/openapi', () => ({
  v1: {
    listBookmarksV1BookmarksGet: vi.fn(),
    bulkDeleteBookmarksV1BookmarksBulkDeletePost: vi.fn(),
    listTagsBookmarksTagsGet: vi.fn(),
    createTagBookmarksTagsPost: vi.fn(),
    updateTagBookmarksTagsTagIdPut: (...args: any[]) => updateTagMock(...args),
    deleteTagBookmarksTagsTagIdDelete: vi.fn(),
    getBookmarkTagsBookmarksBookmarkIdTagsGet: vi.fn(),
    bulkUpdateBookmarkTagsV1BookmarksBulkTagsPost: vi.fn(),
    listFoldersBookmarksFoldersGet: vi.fn(),
    createFolderBookmarksFoldersPost: vi.fn(),
    updateFolderBookmarksFoldersFolderIdPut: vi.fn(),
    deleteFolderBookmarksFoldersFolderIdDelete: vi.fn(),
    bulkUpdateBookmarkFoldersV1BookmarksBulkFoldersPost: vi.fn(),
    listFeedsV1V1FeedsGet: vi.fn(),
    previewBookmarkV1BookmarksBookmarkIdPreviewGet: vi.fn(),
  },
}))

describe('Bookmarks filters and pagination', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
    mutateBookmarksMock.mockReset()
    mutateTagsMock.mockReset()
    mutateFoldersMock.mockReset()
    mutatePreviewMock.mockReset()
    updateTagMock.mockReset()
    updateTagMock.mockResolvedValue({})
    localStorage.clear()

    const bookmarksData = {
      items: [
        {
          id: 'bookmark-1',
          title: 'Bookmark One',
          url: 'https://example.com/one',
          published_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'bookmark-2',
          title: 'Bookmark Two',
          url: 'https://example.com/two',
          published_at: '2024-01-02T00:00:00Z',
        },
      ],
      total: 2,
      totalPages: 3,
      hasNext: true,
    }

    const tagsData = {
      items: [
        { id: 'tag-1', name: 'Tag One', bookmark_count: 5 },
      ],
    }

    const foldersData = {
      items: [
        { id: 'folder-1', name: 'Folder One', bookmark_count: 8, instapaper_folder_id: '111' },
      ],
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

  it('passes filter state to useSWR keys and resets pagination', async () => {
    render(
      <I18nProvider>
        <Bookmarks />
      </I18nProvider>,
    )

    await screen.findByText('Bookmark One')

    const getBookmarkKeys = () => useSWRMock.mock.calls
      .filter(([key]) => Array.isArray(key) && key[0] === '/v1/bookmarks')
      .map(([key]) => key as any[])

    let bookmarkCallCount = getBookmarkKeys().length

    const expectNewBookmarkCall = async (predicate: (key: any[]) => boolean) => {
      await waitFor(() => {
        const newKeys = getBookmarkKeys().slice(bookmarkCallCount)
        expect(newKeys.some(predicate)).toBe(true)
      })
      bookmarkCallCount = getBookmarkKeys().length
    }

    // Move to page 2 and verify the key captures pagination.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await expectNewBookmarkCall((key) => key[1] === 2)

    // Submit a keyword search, expect mutate and page reset to 1.
    const searchForm = screen.getByRole('search')
    fireEvent.change(within(searchForm).getByLabelText('Keyword'), { target: { value: 'read later' } })
    fireEvent.click(within(searchForm).getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(mutateBookmarksMock).toHaveBeenCalledTimes(1)
    })
    await expectNewBookmarkCall((key) => key[1] === 1 && key[2] === 'read later')

    // Apply tag filter and ensure pagination resets.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await expectNewBookmarkCall((key) => key[1] === 2 && key[2] === 'read later')

    fireEvent.click(screen.getByRole('button', { name: 'Tag One' }))
    await expectNewBookmarkCall((key) => key[1] === 1 && key[9] === 'tag-1')

    // Apply folder filter and ensure pagination resets.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await expectNewBookmarkCall((key) => key[1] === 2 && key[9] === 'tag-1')

    fireEvent.click(screen.getByRole('button', { name: 'Folder One' }))
    await expectNewBookmarkCall((key) => key[1] === 1 && key[9] === 'tag-1' && key[10] === 'folder-1')

    // Toggle sort via column header and ensure pagination resets and mutate fires again.
    fireEvent.click(screen.getByRole('button', { name: /^Title/ }))
    await expectNewBookmarkCall((key) => key[1] === 1 && key[13] === 'title' && key[14] === 'asc')

    await waitFor(() => {
      expect(mutateBookmarksMock).toHaveBeenCalledTimes(2)
    })

    // Edit a tag to ensure banner messaging and SWR mutations occur without network calls.
    const tagListItem = screen.getByText('Tag One').closest('li') as HTMLElement
    fireEvent.click(within(tagListItem).getByRole('button', { name: 'Edit' }))

    fireEvent.change(within(tagListItem).getByLabelText('Edit tag Tag One'), { target: { value: 'Tag One Updated' } })
    fireEvent.click(within(tagListItem).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateTagMock).toHaveBeenCalledWith({ tagId: 'tag-1', tagUpdate: { name: 'Tag One Updated' } })
    })

    await waitFor(() => {
      expect(mutateTagsMock).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(mutateBookmarksMock).toHaveBeenCalledTimes(3)
    })

    await screen.findByRole('alert')
    await screen.findByText('Updated tag Tag One Updated.')
  })
})
