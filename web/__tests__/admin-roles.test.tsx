import React from 'react'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, useSWRMock } from './helpers/renderWithSWR'
import AdminRoles from '../pages/admin/roles'

const openApiSpies = vi.hoisted(() => ({
  listAdminRoles: vi.fn(),
  createAdminRole: vi.fn(),
  updateAdminRole: vi.fn(),
  deleteAdminRole: vi.fn(),
}))

const { useFeatureFlagsMock } = vi.hoisted(() => ({
  useFeatureFlagsMock: vi.fn(() => ({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/admin/roles' }),
}))

vi.mock('../components', () => ({
  __esModule: true,
  Nav: () => <nav data-testid="nav">Nav</nav>,
  Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
  Alert: ({ message }: { message: React.ReactNode }) => <div data-testid="alert">{message}</div>,
  EmptyState: ({ message, action }: { message: React.ReactNode; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <div>{message}</div>
      {action}
    </div>
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
    listAdminRoles: openApiSpies.listAdminRoles,
    createAdminRole: openApiSpies.createAdminRole,
    updateAdminRole: openApiSpies.updateAdminRole,
    deleteAdminRole: openApiSpies.deleteAdminRole,
  },
}))

const defaultRolesPage = {
  items: [],
  total: 0,
  page: 1,
  size: 20,
  has_next: false,
  total_pages: 1,
}

type RenderOptions = {
  data?: typeof defaultRolesPage
  mutate?: ReturnType<typeof vi.fn>
}

function renderPage({ data = defaultRolesPage, mutate = vi.fn().mockResolvedValue(undefined) }: RenderOptions = {}) {
  const handlers = [
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/admin/roles',
      value: makeSWRSuccess(data, { mutate }),
    },
  ]

  renderWithSWR(<AdminRoles />, {
    locale: 'en',
    swr: { handlers },
  })

  return { mutate }
}

describe('AdminRoles page', () => {
  beforeEach(() => {
    cleanup()
    useSWRMock.mockReset()
    Object.values(openApiSpies).forEach((spy) => spy.mockReset())
    openApiSpies.listAdminRoles.mockResolvedValue(defaultRolesPage)
    openApiSpies.createAdminRole.mockResolvedValue(undefined)
    openApiSpies.updateAdminRole.mockResolvedValue(undefined)
    openApiSpies.deleteAdminRole.mockResolvedValue(undefined)
    useFeatureFlagsMock.mockReset()
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })
  })

  it('renders search form when feature is enabled', () => {
    renderPage()

    const searchForm = screen.getByRole('search')
    expect(within(searchForm).getByLabelText('Search')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New role' })).toBeInTheDocument()
    expect(useSWRMock).toHaveBeenCalled()
  })

  it('shows informational alert when user management UI is disabled', () => {
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: false, isLoaded: true })

    renderWithSWR(<AdminRoles />, { locale: 'en' })

    const alert = screen.getByTestId('alert')
    expect(alert).toHaveTextContent('Role management is currently disabled.')
    expect(useSWRMock).toHaveBeenCalled()
    for (const [key] of useSWRMock.mock.calls) {
      expect(key).toBeNull()
    }
  })

  it('validates create form requires role name', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'New role' }))

    const dialog = await screen.findByRole('dialog', { name: 'Create role' })
    const nameInput = within(dialog).getByLabelText('Role name') as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await screen.findByText('Enter a role name.')
    expect(openApiSpies.createAdminRole).not.toHaveBeenCalled()
  })

  it('creates a role and triggers revalidation', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined)

    renderPage({ mutate })

    fireEvent.click(screen.getByRole('button', { name: 'New role' }))

    const dialog = await screen.findByRole('dialog', { name: 'Create role' })
    const nameInput = within(dialog).getByLabelText('Role name') as HTMLInputElement
    const descriptionInput = within(dialog).getByLabelText('Description (optional)') as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'managers' } })
    fireEvent.change(descriptionInput, { target: { value: 'Team managers' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(openApiSpies.createAdminRole).toHaveBeenCalled())
    expect(openApiSpies.createAdminRole).toHaveBeenCalledWith({
      adminRoleCreate: {
        name: 'managers',
        description: 'Team managers',
      },
    })

    await screen.findByText('Created role managers.')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Create role' })).not.toBeInTheDocument(),
    )
    expect(mutate).toHaveBeenCalled()
  })

  it('updates a role and triggers revalidation', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined)
    const role = {
      id: 'role-1',
      name: 'editors',
      description: 'Editing team',
      is_system: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      assigned_user_count: 5,
    }

    renderPage({
      data: { ...defaultRolesPage, items: [role], total: 1 },
      mutate,
    })

    const roleName = await screen.findByText('editors')
    const row = roleName.closest('tr') as HTMLTableRowElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit role editors' })
    const nameInput = within(dialog).getByLabelText('Role name') as HTMLInputElement
    const descriptionInput = within(dialog).getByLabelText('Description (optional)') as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'editors v2' } })
    fireEvent.change(descriptionInput, { target: { value: 'Updated description' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(openApiSpies.updateAdminRole).toHaveBeenCalled())
    expect(openApiSpies.updateAdminRole).toHaveBeenCalledWith({
      roleId: 'role-1',
      adminRoleUpdate: {
        name: 'editors v2',
        description: 'Updated description',
      },
    })

    await screen.findByText('Updated role editors v2.')
    expect(mutate).toHaveBeenCalled()
  })

  it('prevents deleting system roles', async () => {
    const role = {
      id: 'role-2',
      name: 'system-role',
      description: 'System role',
      is_system: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      assigned_user_count: 10,
    }

    renderPage({ data: { ...defaultRolesPage, items: [role], total: 1 } })

    const deleteButton = await screen.findByRole('button', { name: 'Delete' })
    expect(deleteButton).toBeDisabled()
    expect(deleteButton).toHaveAttribute('title', 'System roles cannot be deleted.')

    fireEvent.click(deleteButton)
    expect(openApiSpies.deleteAdminRole).not.toHaveBeenCalled()
  })

  it('deletes a role after confirmation and triggers revalidation', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined)
    const role = {
      id: 'role-3',
      name: 'temp-role',
      description: null,
      is_system: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      assigned_user_count: 0,
    }

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    try {
      renderPage({
        data: { ...defaultRolesPage, items: [role], total: 1 },
        mutate,
      })

      const roleName = await screen.findByText('temp-role')
      const row = roleName.closest('tr') as HTMLTableRowElement
      const deleteButton = within(row).getByRole('button', { name: 'Delete' })

      fireEvent.click(deleteButton)

      expect(confirmSpy).toHaveBeenCalledWith('Delete role temp-role? This cannot be undone.')

      await waitFor(() => expect(openApiSpies.deleteAdminRole).toHaveBeenCalled())
      expect(openApiSpies.deleteAdminRole).toHaveBeenCalledWith({ roleId: 'role-3' })

      await screen.findByText('Deleted role temp-role.')
      expect(mutate).toHaveBeenCalled()
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
