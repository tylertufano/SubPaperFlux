import React from 'react'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminSiteSettings from '../pages/admin/site-settings'
import { renderWithSWR, makeSWRSuccess } from './helpers/renderWithSWR'
import type { SiteWelcomeSettingOut } from '../lib/openapi'

const openApiSpies = vi.hoisted(() => ({
  getSiteWelcomeSetting: vi.fn(),
  updateSiteWelcomeSetting: vi.fn(),
}))

const { useFeatureFlagsMock } = vi.hoisted(() => ({
  useFeatureFlagsMock: vi.fn(() => ({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/admin/site-settings' }),
}))

vi.mock('../components', () => ({
  __esModule: true,
  Nav: () => <nav data-testid="nav">Nav</nav>,
  Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
  Alert: ({ kind, message }: { kind: string; message: React.ReactNode }) => (
    <div data-testid={`alert-${kind}`}>{message}</div>
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
    getSiteWelcomeSetting: openApiSpies.getSiteWelcomeSetting,
    updateSiteWelcomeSetting: openApiSpies.updateSiteWelcomeSetting,
  },
}))

const defaultWelcomeSetting: SiteWelcomeSettingOut = {
  key: 'welcome',
  value: {
    headline: 'Welcome to SubPaperFlux',
    subheadline: 'Collect and share articles',
    body: 'Curate reading lists for your team.',
    cta_text: 'Start reading',
    cta_url: 'https://example.com/start',
  },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  updated_by_user_id: 'admin-1',
}

type RenderOptions = {
  data?: SiteWelcomeSettingOut
}

function renderPage({ data = defaultWelcomeSetting }: RenderOptions = {}) {
  const mutate = vi.fn().mockResolvedValue(undefined)
  const handlers = [
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/site-settings/welcome',
      value: makeSWRSuccess(data, { mutate }),
    },
  ]

  renderWithSWR(<AdminSiteSettings />, {
    locale: 'en',
    swr: { handlers },
  })
}

describe('AdminSiteSettings page', () => {
  beforeEach(() => {
    cleanup()
    useFeatureFlagsMock.mockReset()
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })
    openApiSpies.getSiteWelcomeSetting.mockReset()
    openApiSpies.updateSiteWelcomeSetting.mockReset()
    openApiSpies.getSiteWelcomeSetting.mockResolvedValue(defaultWelcomeSetting)
    openApiSpies.updateSiteWelcomeSetting.mockResolvedValue(defaultWelcomeSetting)
  })

  it('renders welcome settings form', async () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Site settings' })).toBeInTheDocument()
    await screen.findByDisplayValue('Welcome to SubPaperFlux')
    expect(screen.getByLabelText('Subheadline')).toHaveValue('Collect and share articles')
    expect(screen.getByLabelText('Body')).toHaveValue('Curate reading lists for your team.')
    expect(screen.getByLabelText('Call-to-action text')).toHaveValue('Start reading')
    expect(screen.getByLabelText('Call-to-action URL')).toHaveValue('https://example.com/start')
    expect(screen.queryByTestId('alert-success')).toBeNull()
  })

  it('validates CTA requirements before saving', async () => {
    renderPage()

    const ctaText = screen.getByLabelText('Call-to-action text') as HTMLInputElement
    const ctaUrl = screen.getByLabelText('Call-to-action URL') as HTMLInputElement

    fireEvent.change(ctaText, { target: { value: ' ' } })
    fireEvent.change(ctaUrl, { target: { value: 'ftp://invalid' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const alert = await screen.findByTestId('alert-error')
    expect(alert).toHaveTextContent('Enter a valid URL starting with http:// or https://.')
    expect(alert).toHaveTextContent('Enter call-to-action text when providing a URL.')
    expect(openApiSpies.updateSiteWelcomeSetting).not.toHaveBeenCalled()
  })

  it('saves updates and revalidates the welcome content', async () => {
    const updatedSetting: SiteWelcomeSettingOut = {
      ...defaultWelcomeSetting,
      value: {
        headline: 'Hello world',
        subheadline: 'A new reading hub',
        body: 'Your daily digest awaits.',
        cta_text: 'Join now',
        cta_url: 'https://example.com/join',
      },
    }
    openApiSpies.updateSiteWelcomeSetting.mockResolvedValueOnce(updatedSetting)

    renderPage()

    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: '  Hello world  ' } })
    fireEvent.change(screen.getByLabelText('Subheadline'), { target: { value: 'A new reading hub' } })
    fireEvent.change(screen.getByLabelText('Body'), {
      target: { value: '  Your daily digest awaits. ' },
    })
    fireEvent.change(screen.getByLabelText('Call-to-action text'), {
      target: { value: ' Join now ' },
    })
    fireEvent.change(screen.getByLabelText('Call-to-action URL'), {
      target: { value: 'https://example.com/join' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(openApiSpies.updateSiteWelcomeSetting).toHaveBeenCalled())
    expect(openApiSpies.updateSiteWelcomeSetting).toHaveBeenCalledWith({
      siteWelcomeSettingUpdate: {
        headline: 'Hello world',
        subheadline: 'A new reading hub',
        body: 'Your daily digest awaits.',
        cta_text: 'Join now',
        cta_url: 'https://example.com/join',
      },
    })

    const successAlert = await screen.findByTestId('alert-success')
    expect(successAlert).toHaveTextContent('Updated welcome message.')
    expect(screen.getByLabelText('Headline')).toHaveValue('Hello world')
  })

  it('shows API errors when the update fails', async () => {
    openApiSpies.updateSiteWelcomeSetting.mockRejectedValueOnce(new Error('Forbidden'))

    renderPage()

    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'New headline' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const errorAlert = await screen.findByTestId('alert-error')
    expect(errorAlert).toHaveTextContent('Forbidden')
  })
})
