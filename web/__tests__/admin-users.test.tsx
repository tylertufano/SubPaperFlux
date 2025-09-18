import React from 'react'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, useSWRMock } from './helpers/renderWithSWR'
import AdminUsers from '../pages/admin/users'

const openApiSpies = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  updateAdminUser: vi.fn(),
  grantRole: vi.fn(),
  revokeRole: vi.fn(),
}))

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

vi.mock('../lib/openapi', () => ({
  __esModule: true,
  v1: {
    listAdminUsersV1AdminUsersGet: openApiSpies.listAdminUsers,
    updateAdminUserV1AdminUsersUserIdPatch: openApiSpies.updateAdminUser,
    grantAdminUserRoleV1AdminUsersUserIdRolesRoleNamePost: openApiSpies.grantRole,
    revokeAdminUserRoleV1AdminUsersUserIdRolesRoleNameDelete: openApiSpies.revokeRole,
  },
}))

const defaultUsersPage = {
  items: [],
  total: 0,
  page: 1,
  size: 20,
  has_next: false,
  total_pages: 1,
}

type RenderOptions = {
  data?: typeof defaultUsersPage
  mutate?: ReturnType<typeof vi.fn>
}

function renderPage({ data = defaultUsersPage, mutate = vi.fn().mockResolvedValue(undefined) }: RenderOptions = {}) {
  const handlers = [
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/admin/users',
      value: makeSWRSuccess(data, { mutate }),
    },
  ]
  renderWithSWR(<AdminUsers />, {
    locale: 'en',
    swr: { handlers },
  })
  return { mutate }
}

describe('AdminUsers page', () => {
  beforeEach(() => {
    cleanup()
    useSWRMock.mockReset()
    Object.values(openApiSpies).forEach((spy) => spy.mockReset())
    openApiSpies.listAdminUsers.mockResolvedValue(defaultUsersPage)
    openApiSpies.updateAdminUser.mockResolvedValue(undefined)
    openApiSpies.grantRole.mockResolvedValue(undefined)
    openApiSpies.revokeRole.mockResolvedValue(undefined)
    useFeatureFlagsMock.mockReset()
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })
  })

  it('renders search form when feature is enabled', () => {
    renderPage()

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

  it('grants a role and refreshes data', async () => {
    const user = {
      id: 'user-1',
      email: 'person@example.com',
      full_name: 'Example Person',
      picture_url: null,
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      last_login_at: '2024-01-03T00:00:00Z',
      groups: [],
      roles: ['viewer'],
      is_admin: false,
      quota_credentials: null,
      quota_site_configs: null,
      quota_feeds: null,
      quota_api_tokens: null,
    }
    const updatedUser = { ...user, roles: ['viewer', 'managers'] }
    openApiSpies.grantRole.mockResolvedValue(updatedUser)
    const mutate = vi.fn().mockResolvedValue(undefined)

    renderPage({
      data: { ...defaultUsersPage, items: [user], total: 1 },
      mutate,
    })

    const viewDetailsButtons = await screen.findAllByRole('button', { name: 'View details' })
    fireEvent.click(viewDetailsButtons[viewDetailsButtons.length - 1])

    const roleInput = await screen.findByLabelText('Role name')
    const descriptionInput = screen.getByLabelText('Description (optional)')
    const createCheckbox = screen.getByLabelText('Create role if missing') as HTMLInputElement

    fireEvent.change(roleInput, { target: { value: 'managers' } })
    fireEvent.change(descriptionInput, { target: { value: 'Team managers' } })
    fireEvent.click(createCheckbox)

    fireEvent.click(screen.getByRole('button', { name: 'Grant role' }))

    await waitFor(() => expect(openApiSpies.grantRole).toHaveBeenCalled())
    expect(openApiSpies.grantRole).toHaveBeenCalledWith({
      userId: 'user-1',
      roleName: 'managers',
      roleGrantRequest: { description: 'Team managers', create_missing: true },
    })

    await screen.findByText('Granted managers to Example Person.')
    await screen.findByRole('button', { name: 'managers' })
    expect(mutate).toHaveBeenCalled()
  })

  it('revokes a role after confirmation', async () => {
    const user = {
      id: 'user-2',
      email: 'writer@example.com',
      full_name: 'Writer Example',
      picture_url: null,
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      last_login_at: '2024-01-03T00:00:00Z',
      groups: [],
      roles: ['viewer', 'editor'],
      is_admin: false,
      quota_credentials: null,
      quota_site_configs: null,
      quota_feeds: null,
      quota_api_tokens: null,
    }
    const mutate = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage({
      data: { ...defaultUsersPage, items: [user], total: 1 },
      mutate,
    })

    const viewDetailsButtons = await screen.findAllByRole('button', { name: 'View details' })
    fireEvent.click(viewDetailsButtons[viewDetailsButtons.length - 1])
    const removeButtons = await screen.findAllByRole('button', { name: 'Remove' })
    fireEvent.click(removeButtons[0])

    expect(confirmSpy).toHaveBeenCalledWith('Remove role viewer from Writer Example?')

    await waitFor(() => expect(openApiSpies.revokeRole).toHaveBeenCalled())
    expect(openApiSpies.revokeRole).toHaveBeenCalledWith({
      userId: 'user-2',
      roleName: 'viewer',
    })

    await waitFor(() => {
      const rolesHeading = screen.getByText('Roles', { selector: 'h4' })
      const rolesSection = rolesHeading.parentElement as HTMLElement
      expect(within(rolesSection).queryByRole('button', { name: 'viewer' })).not.toBeInTheDocument()
    })
    await screen.findByText('Removed viewer from Writer Example.')
    expect(mutate).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })
})
