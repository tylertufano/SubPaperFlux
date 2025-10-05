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

const {
  createTagMock,
  updateTagMock,
  deleteTagMock,
  createFolderMock,
  updateFolderMock,
  deleteFolderMock,
} = vi.hoisted(() => ({
  createTagMock: vi.fn(),
  updateTagMock: vi.fn(),
  deleteTagMock: vi.fn(),
  createFolderMock: vi.fn(),
  updateFolderMock: vi.fn(),
  deleteFolderMock: vi.fn(),
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
    createTagBookmarksTagsPost: (...args: any[]) => createTagMock(...args),
    updateTagBookmarksTagsTagIdPut: (...args: any[]) => updateTagMock(...args),
    deleteTagBookmarksTagsTagIdDelete: (...args: any[]) => deleteTagMock(...args),
    createFolderBookmarksFoldersPost: (...args: any[]) => createFolderMock(...args),
    updateFolderBookmarksFoldersFolderIdPut: (...args: any[]) => updateFolderMock(...args),
    deleteFolderBookmarksFoldersFolderIdDelete: (...args: any[]) => deleteFolderMock(...args),
    bulkDeleteBookmarksV1BookmarksBulkDeletePost: vi.fn(),
  },
}))

vi.mock('../components', async () => {
  const actual = await vi.importActual<typeof import('../components')>('../components')
  return {
    __esModule: true,
    ...actual,
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

describe('Tag and folder catalogs', () => {
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
    createTagMock.mockReset()
    updateTagMock.mockReset()
    deleteTagMock.mockReset()
    createFolderMock.mockReset()
    updateFolderMock.mockReset()
    deleteFolderMock.mockReset()

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
    const foldersData = {
      items: [
        { id: 'folder-1', name: 'Reading List', bookmark_count: 2, instapaper_folder_id: '123' },
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

  it('creates a new tag from the catalog form', async () => {
    createTagMock.mockResolvedValueOnce({})

    renderBookmarks()

    const tagsSection = within(screen.getByRole('region', { name: 'Tags' }))
    fireEvent.change(tagsSection.getByLabelText('Tag name'), { target: { value: 'Research' } })
    fireEvent.click(tagsSection.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createTagMock).toHaveBeenCalledTimes(1))
    expect(createTagMock).toHaveBeenCalledWith({ tagCreate: { name: 'Research' } })
    expect(mutateTagsMock).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('alert')).toHaveTextContent('Created tag Research.'))
  })

  it('updates an existing folder entry', async () => {
    updateFolderMock.mockResolvedValueOnce({})

    renderBookmarks()

    const foldersSection = within(screen.getByRole('region', { name: 'Folders' }))
    fireEvent.click(foldersSection.getByRole('button', { name: 'Edit' }))

    const nameInput = foldersSection.getByLabelText('Edit folder Reading List') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Daily Reads' } })

    const folderListItem = nameInput.closest('li') as HTMLElement | null
    if (!folderListItem) {
      throw new Error('Expected folder list item to exist')
    }
    const folderItemScope = within(folderListItem)
    const instapaperInput = folderItemScope.getByLabelText('Instapaper folder ID') as HTMLInputElement
    fireEvent.change(instapaperInput, { target: { value: '456' } })

    fireEvent.click(folderItemScope.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateFolderMock).toHaveBeenCalledTimes(1))
    expect(updateFolderMock).toHaveBeenCalledWith({
      folderId: 'folder-1',
      folderUpdate: { name: 'Daily Reads', instapaper_folder_id: '456' },
    })
    expect(mutateFoldersMock).toHaveBeenCalled()
    expect(mutateBookmarksMock).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('alert')).toHaveTextContent('Updated folder Daily Reads.'))
  })

  it('does not render per-bookmark tag or folder actions', () => {
    renderBookmarks()

    expect(screen.queryByRole('button', { name: 'Edit Tags' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move Folder' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign tags' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move to folder' })).not.toBeInTheDocument()
  })
})
