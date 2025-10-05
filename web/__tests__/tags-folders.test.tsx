import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FoldersTagsPage from '../pages/folders-tags'
import { I18nProvider } from '../lib/i18n'

const { useSWRMock, mutateTagsMock, mutateFoldersMock, useSessionMock } = vi.hoisted(() => ({
  useSWRMock: vi.fn(),
  mutateTagsMock: vi.fn(),
  mutateFoldersMock: vi.fn(),
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
  useRouter: () => ({ pathname: '/folders-tags' }),
}))

vi.mock('../components', () => ({
  __esModule: true,
  Alert: ({ kind, message, onClose }: { kind: string; message: React.ReactNode; onClose?: () => void }) => (
    <div data-testid="alert" data-kind={kind}>
      {message}
      {onClose ? <button onClick={onClose}>x</button> : null}
    </div>
  ),
  Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
  Nav: () => <nav data-testid="nav">Nav</nav>,
}))

vi.mock('next-auth/react', () => ({
  __esModule: true,
  useSession: () => useSessionMock(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../lib/openapi', () => ({
  v1: {
    listTagsBookmarksTagsGet: vi.fn(),
    createTagBookmarksTagsPost: (...args: any[]) => createTagMock(...args),
    updateTagBookmarksTagsTagIdPut: (...args: any[]) => updateTagMock(...args),
    deleteTagBookmarksTagsTagIdDelete: (...args: any[]) => deleteTagMock(...args),
    listFoldersBookmarksFoldersGet: vi.fn(),
    createFolderBookmarksFoldersPost: (...args: any[]) => createFolderMock(...args),
    updateFolderBookmarksFoldersFolderIdPut: (...args: any[]) => updateFolderMock(...args),
    deleteFolderBookmarksFoldersFolderIdDelete: (...args: any[]) => deleteFolderMock(...args),
  },
}))

function renderPage() {
  return render(
    <I18nProvider>
      <FoldersTagsPage />
    </I18nProvider>,
  )
}

describe('Folders & Tags management page', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
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

    const tagsData = { items: [{ id: 'tag-1', name: 'Initial Tag', bookmark_count: 1 }] }
    const foldersData = {
      items: [
        { id: 'folder-1', name: 'Reading List', bookmark_count: 2, instapaper_folder_id: '123' },
      ],
    }

    useSWRMock.mockImplementation((key: any) => {
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

  it('creates a new tag and refreshes the list', async () => {
    createTagMock.mockResolvedValueOnce({})

    renderPage()

    const tagsSection = screen.getByRole('heading', { name: 'Tags' }).closest('section') as HTMLElement
    fireEvent.change(within(tagsSection).getByLabelText('Tag name'), { target: { value: 'New Tag' } })
    fireEvent.click(within(tagsSection).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createTagMock).toHaveBeenCalledWith({ tagCreate: { name: 'New Tag' } })
    })

    await waitFor(() => {
      expect(mutateTagsMock).toHaveBeenCalledTimes(1)
    })

    await screen.findByTestId('alert')
    expect(screen.getByText('Created tag New Tag.')).toBeInTheDocument()
  })

  it('edits and deletes folders', async () => {
    updateFolderMock.mockResolvedValueOnce({})
    deleteFolderMock.mockResolvedValueOnce({})

    renderPage()

    const folderSection = screen.getByRole('heading', { name: 'Folders' }).closest('section') as HTMLElement
    const folderItem = within(folderSection).getByText('Reading List').closest('li') as HTMLElement

    fireEvent.click(within(folderItem).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(folderItem).getByLabelText('Edit folder Reading List'), { target: { value: 'Updated List' } })
    fireEvent.click(within(folderItem).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateFolderMock).toHaveBeenCalledWith({
        folderId: 'folder-1',
        folderUpdate: { name: 'Updated List', instapaper_folder_id: '123' },
      })
    })

    await waitFor(() => {
      expect(mutateFoldersMock).toHaveBeenCalledTimes(1)
    })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(folderItem).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteFolderMock).toHaveBeenCalledWith({ folderId: 'folder-1' })
    })

    await waitFor(() => {
      expect(mutateFoldersMock).toHaveBeenCalledTimes(2)
    })

    confirmSpy.mockRestore()
  })
})
