import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useSWRMock } from './helpers/renderWithSWR'
import Home from '../pages/index'
import { I18nProvider } from '../lib/i18n'

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(() => ({ data: null, status: 'unauthenticated' as const })),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/' }),
}))

vi.mock('../components', () => ({
  __esModule: true,
  Nav: () => <nav data-testid="nav">Nav</nav>,
  Breadcrumbs: ({ items }: { items: any[] }) => <div data-testid="breadcrumbs">{items?.length ?? 0}</div>,
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('next-auth/react', () => ({
  __esModule: true,
  useSession: () => useSessionMock(),
}))

type SwrState<Data> = {
  data?: Data
  error?: unknown
  isLoading: boolean
  mutate: () => Promise<void>
}

function makeState<Data>(data?: Data): SwrState<Data> {
  return { data, error: undefined, isLoading: false, mutate: vi.fn() }
}

describe('Home page', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    useSessionMock.mockReset()
    useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' as const })
    useSWRMock.mockReset()
    try {
      localStorage.setItem('locale', 'en')
    } catch {}
  })

  it('renders welcome content for anonymous visitors', async () => {
    const welcomeSetting = {
      key: 'welcome',
      value: {
        headline: 'Hello visitors',
        subheadline: 'Automate your reading list',
        body: 'Build **amazing** things with SubPaperFlux.',
        cta_text: 'Start now',
        cta_url: 'https://example.com/start',
      },
    }

    useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' as const })
    useSWRMock.mockImplementation((key: any) => {
      if (Array.isArray(key) && key[0] === '/v1/site-settings/welcome' && key[1] === 'public') {
        return makeState(welcomeSetting)
      }
      return makeState()
    })

    render(
      <I18nProvider>
        <Home />
      </I18nProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Hello visitors' })).toBeInTheDocument()
    expect(screen.getByText('Automate your reading list')).toBeInTheDocument()
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'P' && element.textContent?.includes('Build amazing things with SubPaperFlux.'),
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start now' })).toHaveAttribute('href', 'https://example.com/start')
    expect(screen.queryByText('Dashboard')).toBeNull()
  })

  it('renders dashboard metrics for authenticated users', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Admin' } },
      status: 'authenticated' as const,
    })

    useSWRMock.mockImplementation((key: any) => {
      if (!Array.isArray(key)) {
        return makeState()
      }
      const [resource, status] = key
      if (resource === '/v1/bookmarks/count') return makeState({ total: 12 })
      if (resource === '/v1/jobs' && status === '') return makeState({ total: 34 })
      if (resource === '/v1/jobs' && status === 'failed') return makeState({ total: 2 })
      if (resource === '/v1/jobs' && status === 'dead') return makeState({ total: 1 })
      if (resource === '/v1/jobs' && status === 'queued') return makeState({ total: 5 })
      if (resource === '/v1/jobs' && status === 'in_progress') return makeState({ total: 3 })
      if (resource === '/v1/feeds') return makeState({ total: 4 })
      if (resource === '/v1/credentials') return makeState({ total: 6 })
      if (resource === '/v1/status') return makeState({ status: 'ok', version: '1.2.3' })
      if (resource === '/v1/status/db') return makeState({ ok: true, details: { pg_trgm_enabled: true, indexes: { idx1: true } } })
      if (resource === '/v1/site-settings/welcome') return makeState({ key: 'welcome', value: {} })
      return makeState()
    })

    render(
      <I18nProvider>
        <Home />
      </I18nProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Jobs Status')).toBeInTheDocument()
    expect(screen.getByText('Database Health')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Start now' })).toBeNull()
  })
})
