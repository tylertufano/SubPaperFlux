import React from 'react'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithSWR, makeSWRSuccess } from './helpers/renderWithSWR'
import Admin from '../pages/admin'

vi.mock('next/link', () => ({
  __esModule: true,
  default: React.forwardRef<HTMLAnchorElement, any>(function LinkMock({ href, children, ...rest }, ref) {
    const url = typeof href === 'string' ? href : href?.pathname ?? '#'
    return (
      <a ref={ref} href={url} {...rest}>
        {children}
      </a>
    )
  }),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/admin' }),
}))

vi.mock('../components', async () => {
  const alertModule = await vi.importActual('../components/Alert') as { default: React.ComponentType<any> }
  return {
    __esModule: true,
    Alert: alertModule.default,
    Nav: () => <nav data-testid="nav">Nav</nav>,
    Breadcrumbs: ({ items }: { items: any[] }) => (
      <nav data-testid="breadcrumbs" aria-label="breadcrumbs">
        {items?.length ?? 0}
      </nav>
    ),
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

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

describe('Admin RLS warning', () => {
  afterEach(() => {
    document.documentElement.dir = 'ltr'
  })

  it('renders the Postgres warning in RTL when the backend is Postgres', () => {
    document.documentElement.dir = 'rtl'

    renderWithSWR(<Admin />, {
      locale: 'en',
      swr: {
        handlers: [
          {
            matcher: (key) => Array.isArray(key) && key[0] === '/v1/status',
            value: () => makeSWRSuccess({ status: 'ok', version: '1.2.3' }),
          },
          {
            matcher: (key) => Array.isArray(key) && key[0] === '/v1/status/db',
            value: () => makeSWRSuccess({ ok: true, details: { backend: 'postgres', pg_trgm_enabled: true, indexes: {} } }),
          },
        ],
      },
      session: defaultSession,
    })

    expect(screen.getByText(/Requires Postgres and superuser credentials\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review enable steps' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review manual rollback' })).toBeInTheDocument()
  })
})
