import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Bookmarks from '../pages/bookmarks'
import { I18nProvider } from '../lib/i18n'

const { useSWRMock, mutateBookmarksMock, mutatePreviewMock } = vi.hoisted(() => ({
  useSWRMock: vi.fn(),
  mutateBookmarksMock: vi.fn(),
  mutatePreviewMock: vi.fn(),
}))

const { useSessionMock } = vi.hoisted(() => ({
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

vi.mock('../components', async () => {
  const actual = await vi.importActual<typeof import('../components')>('../components')
  return {
    __esModule: true,
    ...actual,
    Alert: ({ message }: { message: React.ReactNode }) => (
      <div role="alert">{message}</div>
    ),
    BulkPublishModal: () => null,
    EmptyState: ({ message, action }: { message: React.ReactNode; action?: React.ReactNode }) => (
      <div>
        <div>{message}</div>
        {action}
      </div>
    ),
    Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
    Nav: () => <nav data-testid="nav">Nav</nav>,
  }
})

vi.mock('next-auth/react', () => ({
  __esModule: true,
  useSession: () => useSessionMock(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../lib/openapi', () => ({
  v1: {
    listBookmarksV1BookmarksGet: vi.fn(),
    bulkDeleteBookmarksV1BookmarksBulkDeletePost: vi.fn(),
    listFeedsV1V1FeedsGet: vi.fn(),
    previewBookmarkV1BookmarksBookmarkIdPreviewGet: vi.fn(),
  },
}))

describe('Bookmarks filters and pagination', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
    mutateBookmarksMock.mockReset()
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

      if (Array.isArray(key) && key[0] === '/v1/feeds') {
        return {
          data: { items: [{ id: 'feed-1', url: 'https://example.com/feed' }] },
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

  function renderBookmarks() {
    return render(
      <I18nProvider>
        <Bookmarks />
      </I18nProvider>,
    )
  }

  it('updates SWR keys when filters, pagination, and sorting change', async () => {
    renderBookmarks()

    await screen.findByText('Bookmark One')

    const getBookmarkKeys = () =>
      useSWRMock.mock.calls
        .filter(([key]) => Array.isArray(key) && key[0] === '/v1/bookmarks')
        .map(([key]) => key as any[])

    let bookmarkCallCount = getBookmarkKeys().length

    const expectLatestBookmarkKey = async (assert: (key: any[]) => void) => {
      await waitFor(() => {
        expect(getBookmarkKeys().length).toBeGreaterThan(bookmarkCallCount)
      })
      bookmarkCallCount = getBookmarkKeys().length
      const latestKey = getBookmarkKeys()[bookmarkCallCount - 1]
      assert(latestKey)
    }

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await expectLatestBookmarkKey((key) => {
      expect(key[1]).toBe(2)
    })

    const searchForm = screen.getByRole('search')
    fireEvent.change(within(searchForm).getByLabelText('Keyword'), { target: { value: 'read later' } })
    fireEvent.click(within(searchForm).getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(mutateBookmarksMock).toHaveBeenCalledTimes(1)
    })
    await expectLatestBookmarkKey((key) => {
      expect(key[1]).toBe(1)
      expect(key[2]).toBe('read later')
    })

    const feedSelect = within(searchForm).getByLabelText('Feed') as HTMLSelectElement
    fireEvent.change(feedSelect, { target: { value: 'feed-1' } })
    expect(feedSelect).toHaveValue('feed-1')
    await expectLatestBookmarkKey((key) => {
      expect(key[8]).toBe('feed-1')
    })

    fireEvent.click(screen.getByRole('button', { name: /^Title/ }))
    await expectLatestBookmarkKey((key) => {
      expect(key[1]).toBe(1)
      expect(key[11]).toBe('title')
      expect(key[12]).toBe('asc')
    })

    await waitFor(() => {
      expect(mutateBookmarksMock).toHaveBeenCalledTimes(2)
    })
  })
})
