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
  listOrganizations: vi.fn(),
  addOrganizationMember: vi.fn(),
  removeOrganizationMember: vi.fn(),
  getAdminUser: vi.fn(),
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
    listAdminOrganizationsV1AdminOrgsGet: openApiSpies.listOrganizations,
    addOrganizationMemberV1AdminOrgsOrganizationIdMembersPost: openApiSpies.addOrganizationMember,
    removeOrganizationMemberV1AdminOrgsOrganizationIdMembersUserIdDelete:
      openApiSpies.removeOrganizationMember,
    getAdminUserV1AdminUsersUserIdGet: openApiSpies.getAdminUser,
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

const defaultOrganizationsPage = {
  items: [],
  total: 0,
  page: 1,
  size: 20,
  has_next: false,
  total_pages: 1,
}

const exampleUserOrganization = {
  id: 'org-1',
  slug: 'acme',
  name: 'Acme Inc.',
  description: 'Acme organization',
  is_default: true,
  joined_at: '2024-01-01T00:00:00Z',
}

const exampleOrganizationMembership = {
  organization_id: 'org-1',
  organization_slug: 'acme',
  organization_name: 'Acme Inc.',
  organization_description: 'Acme organization',
  organization_is_default: true,
  joined_at: '2024-01-01T00:00:00Z',
}

const exampleOrganizationSuggestion = {
  id: 'org-2',
  slug: 'beta',
  name: 'Beta Org',
  description: 'Beta organization',
  is_default: false,
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-02T00:00:00Z',
}

type RenderOptions = {
  data?: typeof defaultUsersPage
  mutate?: ReturnType<typeof vi.fn>
  organizations?: typeof defaultOrganizationsPage
}

function renderPage({
  data = defaultUsersPage,
  mutate = vi.fn().mockResolvedValue(undefined),
  organizations = defaultOrganizationsPage,
}: RenderOptions = {}) {
  const handlers = [
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/admin/users',
      value: makeSWRSuccess(data, { mutate }),
    },
    {
      matcher: (key: any, fetcher?: any) =>
        Array.isArray(key) && key[0] === '/v1/admin/orgs/search',
      value: (key: any, fetcher?: any) => {
        if (fetcher) {
          fetcher(key)
        }
        return makeSWRSuccess(organizations)
      },
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
    openApiSpies.listOrganizations.mockResolvedValue(defaultOrganizationsPage)
    openApiSpies.addOrganizationMember.mockResolvedValue(undefined)
    openApiSpies.removeOrganizationMember.mockResolvedValue(undefined)
    openApiSpies.getAdminUser.mockResolvedValue(undefined)
    useFeatureFlagsMock.mockReset()
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })
  })

  it('renders search form when feature is enabled', () => {
    renderPage()

    const searchForm = screen.getByRole('search')
    expect(within(searchForm).getByLabelText('Search')).toBeInTheDocument()
    expect(useSWRMock).toHaveBeenCalled()
  })

  it('displays organizations in the table and drawer', async () => {
    const user = {
      id: 'user-3',
      email: 'viewer@example.com',
      full_name: 'Viewer Example',
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
      role_overrides: { enabled: false, preserve: [], suppress: [] },
      organizations: [exampleUserOrganization],
      organization_ids: ['org-1'],
      organization_memberships: [exampleOrganizationMembership],
    }

    renderPage({
      data: { ...defaultUsersPage, items: [user], total: 1 },
    })

    await screen.findByText('Acme Inc.')

    const viewDetailsButtons = await screen.findAllByRole('button', { name: 'View details' })
    fireEvent.click(viewDetailsButtons[viewDetailsButtons.length - 1])

    const organizationHeading = await screen.findByText('Organizations', { selector: 'h4' })
    const organizationSection = organizationHeading.parentElement as HTMLElement
    expect(within(organizationSection).getByText('Acme Inc.')).toBeInTheDocument()
    const organizationInput = within(organizationSection).getByLabelText('Assign organization') as HTMLInputElement
    expect(organizationInput.value).toBe('acme')
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

  it('reassigns organizations through membership endpoints', async () => {
    const user = {
      id: 'user-4',
      email: 'member@example.com',
      full_name: 'Member Example',
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
      role_overrides: { enabled: false, preserve: [], suppress: [] },
      organizations: [exampleUserOrganization],
      organization_ids: ['org-1'],
      organization_memberships: [exampleOrganizationMembership],
    }
    const updatedUser = {
      ...user,
      organizations: [
        {
          id: 'org-2',
          slug: 'beta',
          name: 'Beta Org',
          description: 'Beta organization',
          is_default: false,
          joined_at: '2024-02-03T00:00:00Z',
        },
      ],
      organization_ids: ['org-2'],
      organization_memberships: [
        {
          organization_id: 'org-2',
          organization_slug: 'beta',
          organization_name: 'Beta Org',
          organization_description: 'Beta organization',
          organization_is_default: false,
          joined_at: '2024-02-03T00:00:00Z',
        },
      ],
    }
    const mutate = vi.fn().mockResolvedValue(undefined)
    openApiSpies.getAdminUser.mockResolvedValue(updatedUser)

    renderPage({
      data: { ...defaultUsersPage, items: [user], total: 1 },
      mutate,
      organizations: { ...defaultOrganizationsPage, items: [exampleOrganizationSuggestion] },
    })

    const viewDetailsButtons = await screen.findAllByRole('button', { name: 'View details' })
    fireEvent.click(viewDetailsButtons[viewDetailsButtons.length - 1])

    const organizationInput = await screen.findByLabelText('Assign organization')
    fireEvent.change(organizationInput, { target: { value: 'beta' } })

    fireEvent.click(screen.getByRole('button', { name: 'Update organization' }))

    await waitFor(() => expect(openApiSpies.removeOrganizationMember).toHaveBeenCalled())
    expect(openApiSpies.removeOrganizationMember).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'user-4',
    })
    await waitFor(() => expect(openApiSpies.addOrganizationMember).toHaveBeenCalled())
    expect(openApiSpies.addOrganizationMember).toHaveBeenCalledWith({
      organizationId: 'org-2',
      adminOrganizationMembershipChange: { user_id: 'user-4' },
    })
    await waitFor(() => expect(openApiSpies.getAdminUser).toHaveBeenCalledWith({ userId: 'user-4' }))
    await screen.findByText('Assigned Member Example to Beta Org.')
    expect(mutate).toHaveBeenCalled()
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
      role_overrides: { enabled: false, preserve: [], suppress: [] },
      organizations: [],
      organization_ids: [],
      organization_memberships: [],
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
      role_overrides: { enabled: false, preserve: [], suppress: [] },
      organizations: [],
      organization_ids: [],
      organization_memberships: [],
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
