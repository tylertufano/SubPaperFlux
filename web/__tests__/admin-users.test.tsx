import React from 'react'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, useSWRMock } from './helpers/renderWithSWR'
import AdminUsers from '../pages/admin/users'

const { useFeatureFlagsMock } = vi.hoisted(() => ({
  useFeatureFlagsMock: vi.fn(() => ({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/admin/users' }),
}))

vi.mock('../components', () => ({
  __esModule: true,
  Nav: () => <nav data-testid="nav">Nav</nav>,
  Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
  Alert: ({ message }: { message: React.ReactNode }) => <div data-testid="alert">{message}</div>,
  EmptyState: ({ message }: { message: React.ReactNode }) => (
    <div data-testid="empty-state">{message}</div>
  ),
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../lib/featureFlags', () => ({
  __esModule: true,
  useFeatureFlags: () => useFeatureFlagsMock(),
}))

describe('AdminUsers page', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
    useFeatureFlagsMock.mockReset()
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })
  })

  it('renders search form when feature is enabled', () => {
    renderWithSWR(<AdminUsers />, {
      locale: 'en',
      swr: {
        handlers: [
          {
            matcher: (key) => Array.isArray(key) && key[0] === '/v1/admin/users',
            value: makeSWRSuccess({ items: [], total: 0, page: 1, size: 20, has_next: false, total_pages: 1 }),
          },
        ],
      },
    })

    const searchForm = screen.getByRole('search')
    expect(within(searchForm).getByLabelText('Search')).toBeInTheDocument()
    expect(useSWRMock).toHaveBeenCalled()
  })

  it('shows informational alert when user management UI is disabled', () => {
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: false, isLoaded: true })

    renderWithSWR(<AdminUsers />, { locale: 'en' })

    const alert = screen.getByTestId('alert')
    expect(alert).toHaveTextContent('User management is currently disabled.')
    expect(useSWRMock).toHaveBeenCalled()
    for (const [key] of useSWRMock.mock.calls) {
      expect(key).toBeNull()
    }
  })
})
