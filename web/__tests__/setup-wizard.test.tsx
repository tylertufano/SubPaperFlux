import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import SetupWizard from '../components/setup/SetupWizard'
import { renderWithSWR, makeSWRSuccess } from './helpers/renderWithSWR'

const v1Mocks = vi.hoisted(() => ({
  getSiteSetupStatus: vi.fn(),
  updateSiteSetupStatus: vi.fn(),
  getSiteWelcomeSetting: vi.fn(),
  updateSiteWelcomeSetting: vi.fn(),
  createCredentialCredentialsPost: vi.fn(),
  createFeedFeedsPost: vi.fn(),
}))

vi.mock('../lib/openapi', () => ({
  __esModule: true,
  v1: v1Mocks,
}))

describe('SetupWizard', () => {
  beforeEach(() => {
    v1Mocks.getSiteSetupStatus.mockReset()
    v1Mocks.updateSiteSetupStatus.mockReset()
    v1Mocks.getSiteWelcomeSetting.mockReset()
    v1Mocks.updateSiteWelcomeSetting.mockReset()
    v1Mocks.createCredentialCredentialsPost.mockReset()
    v1Mocks.createFeedFeedsPost.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('guides administrators through setup steps', async () => {
    const setupStatus = {
      key: 'setup_status',
      value: {
        completed: false,
        current_step: 'welcome',
        last_completed_step: null,
        welcome_configured: false,
        credentials_created: false,
        feeds_imported: false,
      },
    }
    const welcomeSetting = {
      key: 'welcome',
      value: {
        headline: 'Hello',
        subheadline: 'Start here',
        body: 'Welcome to SubPaperFlux.',
        cta_text: 'Learn more',
        cta_url: 'https://example.com',
      },
    }

    v1Mocks.updateSiteWelcomeSetting.mockResolvedValue(welcomeSetting)
    v1Mocks.updateSiteSetupStatus
      .mockResolvedValueOnce({
        key: 'setup_status',
        value: {
          completed: false,
          current_step: 'credentials',
          last_completed_step: 'welcome',
          welcome_configured: true,
          credentials_created: false,
          feeds_imported: false,
        },
      })
      .mockResolvedValueOnce({
        key: 'setup_status',
        value: {
          completed: false,
          current_step: 'feeds',
          last_completed_step: 'credentials',
          welcome_configured: true,
          credentials_created: true,
          feeds_imported: false,
        },
      })
      .mockResolvedValueOnce({
        key: 'setup_status',
        value: {
          completed: true,
          current_step: 'complete',
          last_completed_step: 'feeds',
          welcome_configured: true,
          credentials_created: true,
          feeds_imported: true,
        },
      })
    v1Mocks.createCredentialCredentialsPost.mockResolvedValue({})
    v1Mocks.createFeedFeedsPost.mockResolvedValue({})

    renderWithSWR(<SetupWizard />, {
      session: { user: { isAdmin: true } } as any,
      swr: {
        handlers: [
          {
            matcher: (key) => Array.isArray(key) && key[0] === '/v1/site-settings/setup-status',
            value: makeSWRSuccess(setupStatus),
          },
          {
            matcher: (key) => Array.isArray(key) && key[0] === '/v1/site-settings/welcome',
            value: makeSWRSuccess(welcomeSetting),
          },
        ],
      },
    })

    const headlineField = await screen.findByLabelText('Headline')
    fireEvent.change(headlineField, { target: { value: 'Welcome friends' } })
    fireEvent.change(screen.getByLabelText('Subheadline'), { target: { value: 'Ready to read' } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Collect your favorite articles.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save welcome message' }))

    await waitFor(() => expect(v1Mocks.updateSiteWelcomeSetting).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(v1Mocks.updateSiteSetupStatus).toHaveBeenCalledTimes(1))

    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'Main login' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'reader' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }))

    await waitFor(() => expect(v1Mocks.createCredentialCredentialsPost).toHaveBeenCalledWith({
      credential: {
        kind: 'site_login',
        description: 'Main login',
        data: { username: 'reader', password: 'secret' },
      },
    }))
    await waitFor(() => expect(v1Mocks.updateSiteSetupStatus).toHaveBeenCalledTimes(2))

    fireEvent.change(await screen.findByLabelText('Feed URL'), {
      target: { value: 'https://example.com/feed.xml' },
    })
    fireEvent.change(screen.getByLabelText('Poll frequency'), { target: { value: '30m' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create feed' }))

    await waitFor(() => expect(v1Mocks.createFeedFeedsPost).toHaveBeenCalledWith({
      feed: {
        url: 'https://example.com/feed.xml',
        pollFrequency: '30m',
      },
    }))
    await waitFor(() => expect(v1Mocks.updateSiteSetupStatus).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('link', { name: 'Go to dashboard' })).toBeInTheDocument()
  })

  it('shows completion state when setup already finished', async () => {
    const completeStatus = {
      key: 'setup_status',
      value: {
        completed: true,
        current_step: 'complete',
        last_completed_step: 'feeds',
        welcome_configured: true,
        credentials_created: true,
        feeds_imported: true,
      },
    }
    const onFinished = vi.fn()

    renderWithSWR(<SetupWizard onSetupFinished={onFinished} />, {
      session: { user: { isAdmin: true } } as any,
      swr: {
        handlers: [
          {
            matcher: (key) => Array.isArray(key) && key[0] === '/v1/site-settings/setup-status',
            value: makeSWRSuccess(completeStatus),
          },
        ],
      },
    })

    expect(await screen.findByRole('link', { name: 'Go to dashboard' })).toBeInTheDocument()
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(v1Mocks.updateSiteSetupStatus).not.toHaveBeenCalled()
  })
})
