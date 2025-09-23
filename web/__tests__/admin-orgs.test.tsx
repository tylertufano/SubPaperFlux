import React from 'react'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, useSWRMock } from './helpers/renderWithSWR'
import AdminOrgs from '../pages/admin/orgs'

const openApiSpies = vi.hoisted(() => ({
  listAdminOrgs: vi.fn(),
  getOrg: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
}))

const { useFeatureFlagsMock } = vi.hoisted(() => ({
  useFeatureFlagsMock: vi.fn(() => ({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/admin/orgs' }),
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
    listAdminOrganizationsV1AdminOrgsGet: openApiSpies.listAdminOrgs,
    getOrganizationV1AdminOrgsOrganizationIdGet: openApiSpies.getOrg,
    addOrganizationMemberV1AdminOrgsOrganizationIdMembersPost: openApiSpies.addMember,
    removeOrganizationMemberV1AdminOrgsOrganizationIdMembersUserIdDelete: openApiSpies.removeMember,
  },
}))

const defaultPage = {
  items: [],
  total: 0,
  page: 1,
  size: 20,
  has_next: false,
  total_pages: 1,
}

const defaultSession = {
  user: {
    name: 'Admin User',
    email: 'admin@example.com',
    permissions: [
      'bookmarks:read',
      'bookmarks:manage',
      'credentials:read',
      'credentials:manage',
      'site_configs:read',
      'site_configs:manage',
    ],
  },
  expires: '2099-01-01T00:00:00.000Z',
} as const

type RenderOptions = {
  data?: typeof defaultPage
  mutate?: ReturnType<typeof vi.fn>
}

function renderPage({ data = defaultPage, mutate = vi.fn().mockResolvedValue(undefined) }: RenderOptions = {}) {
  const handlers = [
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/admin/orgs',
      value: makeSWRSuccess(data, { mutate }),
    },
  ]
  renderWithSWR(<AdminOrgs />, {
    locale: 'en',
    swr: { handlers },
    session: defaultSession,
  })
  return { mutate }
}

describe('AdminOrgs page', () => {
  beforeEach(() => {
    cleanup()
    useSWRMock.mockReset()
    Object.values(openApiSpies).forEach((spy) => spy.mockReset())
    openApiSpies.listAdminOrgs.mockResolvedValue(defaultPage)
    const detail = {
      id: 'org-1',
      slug: 'default',
      name: 'Default Org',
      description: null,
      is_default: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      member_count: 0,
      members: [],
    }
    openApiSpies.getOrg.mockResolvedValue(detail)
    openApiSpies.addMember.mockResolvedValue(detail)
    openApiSpies.removeMember.mockResolvedValue(detail)
    useFeatureFlagsMock.mockReset()
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })
  })

  it('renders search form when feature is enabled', () => {
    renderPage()

    const searchForm = screen.getByRole('search')
    expect(within(searchForm).getByLabelText('Search organizations')).toBeInTheDocument()
    expect(useSWRMock).toHaveBeenCalled()
  })

  it('adds a member and refreshes data', async () => {
    const organization = {
      id: 'org-123',
      slug: 'example',
      name: 'Example Org',
      description: 'Example description',
      is_default: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      member_count: 1,
    }
    const detail = {
      ...organization,
      member_count: 1,
      members: [
        {
          id: 'user-1',
          email: 'one@example.com',
          full_name: 'User One',
          is_active: true,
          joined_at: '2024-01-02T00:00:00Z',
        },
      ],
    }
    const updatedDetail = {
      ...detail,
      member_count: 2,
      members: [
        ...detail.members,
        {
          id: 'user-2',
          email: 'two@example.com',
          full_name: 'User Two',
          is_active: true,
          joined_at: '2024-01-03T00:00:00Z',
        },
      ],
    }
    openApiSpies.getOrg.mockResolvedValue(detail)
    openApiSpies.addMember.mockResolvedValue(updatedDetail)
    const mutate = vi.fn().mockResolvedValue(undefined)

    renderPage({
      data: { ...defaultPage, items: [organization], total: 1 },
      mutate,
    })

    fireEvent.click(await screen.findByRole('button', { name: 'View details' }))

    const input = await screen.findByLabelText('User ID')
    fireEvent.change(input, { target: { value: 'user-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(openApiSpies.addMember).toHaveBeenCalled())
    expect(openApiSpies.addMember).toHaveBeenCalledWith({
      organizationId: 'org-123',
      adminOrganizationMembershipChange: { user_id: 'user-2' },
    })

    await screen.findByText('Added user-2 to Example Org.')
    await screen.findByText('User Two')
    expect(mutate).toHaveBeenCalled()
  })

  it('removes a member after confirmation', async () => {
    const organization = {
      id: 'org-456',
      slug: 'team',
      name: 'Team Org',
      description: null,
      is_default: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      member_count: 2,
    }
    const detail = {
      ...organization,
      members: [
        {
          id: 'alpha',
          email: 'alpha@example.com',
          full_name: 'Alpha User',
          is_active: true,
          joined_at: '2024-01-03T00:00:00Z',
        },
        {
          id: 'beta',
          email: 'beta@example.com',
          full_name: 'Beta User',
          is_active: true,
          joined_at: '2024-01-04T00:00:00Z',
        },
      ],
    }
    const updatedDetail = {
      ...organization,
      member_count: 1,
      members: [detail.members[1]],
    }
    openApiSpies.getOrg.mockResolvedValue(detail)
    openApiSpies.removeMember.mockResolvedValue(updatedDetail)
    const mutate = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage({
      data: { ...defaultPage, items: [organization], total: 1 },
      mutate,
    })

    fireEvent.click(await screen.findByRole('button', { name: 'View details' }))
    const removeButtons = await screen.findAllByRole('button', { name: 'Remove' })
    fireEvent.click(removeButtons[0])

    expect(confirmSpy).toHaveBeenCalledWith('Remove Alpha User from Team Org?')

    await waitFor(() => expect(openApiSpies.removeMember).toHaveBeenCalled())
    expect(openApiSpies.removeMember).toHaveBeenCalledWith({
      organizationId: 'org-456',
      userId: 'alpha',
    })

    await screen.findByText('Removed Alpha User from Team Org.')
    expect(mutate).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })
})
