import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { makeSWRSuccess, renderWithSWR } from './helpers/renderWithSWR'
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
  const alertModule = (await vi.importActual('../components/Alert')) as { default: React.ComponentType<any> }
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

describe('Admin integration status', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.dir = 'ltr'
  })

  it('renders connectivity, rate limits, and backoff details for integrations', async () => {
    renderWithSWR(<Admin />, {
      locale: 'en',
      session: defaultSession as any,
      swr: {
        fallback: (key) => {
          if (Array.isArray(key) && key[0] === '/v1/status') {
            return makeSWRSuccess({ status: 'ok', version: '1.0.0' })
          }
          if (Array.isArray(key) && key[0] === '/v1/status/db') {
            return makeSWRSuccess({ ok: true, details: { backend: 'postgres' } })
          }
          if (Array.isArray(key) && key[0] === '/v1/status/integrations') {
            return makeSWRSuccess({
              ok: true,
              details: {
                instapaper: {
                  ok: true,
                  status: 200,
                  checked_at: '2024-01-01T00:00:00Z',
                  credential_id: 'cred-inst',
                  rate_limit: {
                    limit: 1000,
                    remaining: 990,
                    window_seconds: 60,
                    reset_at: '2024-01-01T00:01:00Z',
                  },
                },
                miniflux: {
                  ok: false,
                  status: 503,
                  last_checked_at: '2024-01-01T00:05:00Z',
                  error: 'Service unavailable',
                  credentialId: 'cred-min',
                  rateLimit: {
                    limit: 100,
                    remaining: 0,
                    windowSeconds: 60,
                  },
                  backoff: {
                    seconds: 30,
                    until: '2024-01-01T00:05:30Z',
                    attempts: 2,
                    last_error: 'Timeout waiting for API',
                  },
                  endpoint: '/v1/integrations/miniflux/test',
                },
              },
            })
          }
          return makeSWRSuccess(undefined)
        },
      },
    })

    const integrationsTable = await screen.findByRole('table', { name: 'Integration connectivity status' })
    const instapaperRow = within(integrationsTable).getByText('Instapaper').closest('tr') as HTMLTableRowElement
    const minifluxRow = within(integrationsTable).getByText('Miniflux').closest('tr') as HTMLTableRowElement

    expect(instapaperRow).toBeTruthy()
    if (instapaperRow) {
      const instapaperWithin = within(instapaperRow)
      expect(instapaperWithin.getByText('Connected')).toBeInTheDocument()
      expect(instapaperWithin.getByText('Credential: cred-inst')).toBeInTheDocument()
      expect(instapaperWithin.getByText(/Limit: 1000/)).toBeInTheDocument()
      expect(instapaperWithin.getByText(/Remaining: 990/)).toBeInTheDocument()
    }

    expect(minifluxRow).toBeTruthy()
    if (minifluxRow) {
      const minifluxWithin = within(minifluxRow)
      expect(minifluxWithin.getByText('Failed')).toBeInTheDocument()
      expect(minifluxWithin.getByText('Error: Service unavailable')).toBeInTheDocument()
      expect(minifluxWithin.getByText(/Wait 30s/)).toBeInTheDocument()
      expect(minifluxWithin.getByText(/Attempts: 2/)).toBeInTheDocument()
      expect(minifluxWithin.getByRole('button', { name: 'Retry Miniflux check' })).toBeEnabled()
    }
  })

  it('shows retry guidance when a check fails without credentials', async () => {
    renderWithSWR(<Admin />, {
      locale: 'en',
      session: defaultSession as any,
      swr: {
        fallback: (key) => {
          if (Array.isArray(key) && key[0] === '/v1/status') {
            return makeSWRSuccess({ status: 'ok', version: '1.0.0' })
          }
          if (Array.isArray(key) && key[0] === '/v1/status/db') {
            return makeSWRSuccess({ ok: true, details: { backend: 'postgres' } })
          }
          if (Array.isArray(key) && key[0] === '/v1/status/integrations') {
            return makeSWRSuccess({
              ok: false,
              details: {
                instapaper: {
                  ok: false,
                  error: 'credential_id is required',
                  endpoint: '/v1/integrations/instapaper/test',
                },
              },
            })
          }
          return makeSWRSuccess(undefined)
        },
      },
    })

    const connectivityHeadings = await screen.findAllByRole('heading', { name: 'Integration connectivity' })
    expect(connectivityHeadings.length).toBeGreaterThan(0)
    const table = await screen.findByRole('table', { name: 'Integration connectivity status' })
    const rows = within(table).getAllByRole('row').slice(1)
    const instapaperRow = rows.find(r => within(r).queryByText('Instapaper'))
    expect(instapaperRow).toBeTruthy()
    const rowWithin = within(instapaperRow as HTMLTableRowElement)
    expect(rowWithin.getByText('Enter a credential ID to test this integration.')).toBeInTheDocument()
    const retryButton = rowWithin.getByRole('button', { name: 'Retry Instapaper check' }) as HTMLButtonElement
    expect(retryButton).toBeDisabled()
    expect(rowWithin.getByText('Provide a credential ID to enable retry actions.')).toBeInTheDocument()
  })
})
