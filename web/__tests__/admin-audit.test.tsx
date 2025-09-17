import React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, useSWRMock } from './helpers/renderWithSWR'
import AdminAudit from '../pages/admin/audit'

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/admin/audit' }),
}))

vi.mock('../components', async () => {
  const toolbarModule = await vi.importActual('../components/BulkActionToolbar') as any
  return {
    __esModule: true,
    Nav: () => <nav data-testid="nav">Nav</nav>,
    Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
    BulkActionToolbar: toolbarModule.default,
    BulkTagModal: () => null,
    Alert: ({ message }: { message: React.ReactNode }) => (
      <div data-testid="alert">{message}</div>
    ),
    EmptyState: ({ message, action }: { message: React.ReactNode; action?: React.ReactNode }) => (
      <div data-testid="empty-state">
        <div>{message}</div>
        {action}
      </div>
    ),
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

describe('AdminAudit page', () => {
  beforeEach(() => {
    useSWRMock.mockReset()
  })

  it('renders audit log entries, details, and filter actions', async () => {
    const sample = {
      items: [
        {
          id: 'alog_001',
          entity_type: 'bookmark',
          entity_id: 'bm_001',
          action: 'delete',
          owner_user_id: 'admin',
          actor_user_id: 'admin',
          details: { instapaper_bookmark_id: 'insta-001', delete_remote: false },
          created_at: '2024-05-01T12:00:00Z',
        },
        {
          id: 'alog_000',
          entity_type: 'credential',
          entity_id: 'cred_001',
          action: 'update',
          owner_user_id: 'admin',
          actor_user_id: 'admin',
          details: { kind: 'site_login', updated_fields: ['note'] },
          created_at: '2024-05-01T11:00:00Z',
        },
      ],
      total: 2,
      page: 1,
      size: 50,
      has_next: false,
      total_pages: 1,
    }

    let lastKey: any = null

    renderWithSWR(<AdminAudit />, {
      locale: 'en',
      swr: {
        handlers: [
          {
            matcher: (key) => Array.isArray(key) && key[0] === '/v1/admin/audit',
            value: (key) => {
              lastKey = key
              return makeSWRSuccess(sample)
            },
          },
        ],
      },
    })

    expect(screen.getByRole('heading', { level: 2, name: 'Audit Log' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Audit events' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('bookmark')).toBeInTheDocument()
    expect(screen.getByText('credential')).toBeInTheDocument()

    const viewButtons = screen.getAllByRole('button', { name: 'View details' })
    fireEvent.click(viewButtons[0])

    const drawer = await screen.findByRole('dialog', { name: 'Audit event details' })
    expect(within(drawer).getByText('alog_001')).toBeInTheDocument()
    expect(within(drawer).getAllByText('bm_001')[0]).toBeInTheDocument()
    expect(within(drawer).getByText(/"instapaper_bookmark_id": "insta-001"/)).toBeInTheDocument()

    const filterByAction = screen.getByRole('button', { name: 'Filter by action' })
    fireEvent.click(filterByAction)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(Array.isArray(lastKey)).toBe(true)
      expect(lastKey[5]).toBe('delete')
      expect(lastKey[1]).toBe(1)
    })
  })

  it('shows empty state when no audit events exist', () => {
    renderWithSWR(<AdminAudit />, {
      locale: 'en',
      swr: {
        handlers: [
          {
            matcher: (key) => Array.isArray(key) && key[0] === '/v1/admin/audit',
            value: makeSWRSuccess({ items: [], total: 0, page: 1, size: 50, has_next: false, total_pages: 1 }),
          },
        ],
      },
    })

    const forms = screen.getAllByRole('search')
    expect(forms.length).toBeGreaterThan(0)
    const form = forms[0]
    expect(within(form).getByRole('button', { name: 'Clear Filters' })).toBeInTheDocument()

    const emptyState = screen.getByTestId('empty-state')
    const emptyButton = within(emptyState).getByRole('button', { name: 'Clear Filters' })
    expect(emptyButton).toBeInTheDocument()
  })
})
