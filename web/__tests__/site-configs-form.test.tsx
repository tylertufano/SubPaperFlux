import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, type RenderWithSWROptions } from './helpers/renderWithSWR'
import SiteConfigs from '../pages/site-configs'

const openApiSpies = vi.hoisted(() => ({
  listSiteConfigs: vi.fn(),
  createSiteConfig: vi.fn(),
  deleteSiteConfig: vi.fn(),
  testSiteConfig: vi.fn(),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/site-configs' }),
}))

vi.mock('../components', async () => {
  const actual = await vi.importActual<Record<string, any>>('../components')
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    __esModule: true,
    ...actual,
    Nav: () => React.createElement('nav', { 'data-testid': 'nav' }, 'Nav'),
    Breadcrumbs: () => React.createElement('nav', { 'data-testid': 'breadcrumbs' }, 'Breadcrumbs'),
    EmptyState: ({ message, action }: { message: ReactNode; action?: ReactNode }) => (
      React.createElement('div', { 'data-testid': 'empty-state' }, message, action ?? null)
    ),
    Alert: ({ kind = 'info', message, onClose }: { kind?: 'info' | 'success' | 'warning' | 'error'; message: string; onClose?: () => void }) => {
      const role = kind === 'error' ? 'alert' : 'status'
      return React.createElement(
        'div',
        { role, 'data-testid': `alert-${role}` },
        message,
        onClose ? React.createElement('button', { onClick: onClose }, '×') : null,
      )
    },
  }
})

vi.mock('../lib/openapi', () => ({
  __esModule: true,
  v1: {
    listSiteConfigsV1V1SiteConfigsGet: openApiSpies.listSiteConfigs,
    testSiteConfigV1SiteConfigsConfigIdTestPost: openApiSpies.testSiteConfig,
  },
  siteConfigs: {
    createSiteConfigSiteConfigsPost: openApiSpies.createSiteConfig,
    deleteSiteConfigSiteConfigsConfigIdDelete: openApiSpies.deleteSiteConfig,
  },
}))

export const listSiteConfigsMock = openApiSpies.listSiteConfigs
export const createSiteConfigMock = openApiSpies.createSiteConfig
export const deleteSiteConfigMock = openApiSpies.deleteSiteConfig
export const testSiteConfigMock = openApiSpies.testSiteConfig

export const defaultSiteConfigsResponse = {
  items: [
    {
      id: 'config-1',
      name: 'Example Site',
      site_url: 'https://example.com/login',
      username_selector: '#username',
      password_selector: '#password',
      login_button_selector: 'button[type="submit"]',
      cookies_to_store: ['sessionid'],
      owner_user_id: 'user-1',
    },
  ],
}

export type SiteConfigsSetupOptions = {
  data?: typeof defaultSiteConfigsResponse
  locale?: string
  swr?: RenderWithSWROptions['swr']
}

export type SiteConfigFormControls = {
  name: HTMLInputElement
  siteUrl: HTMLInputElement
  usernameSelector: HTMLInputElement
  passwordSelector: HTMLInputElement
  loginSelector: HTMLInputElement
  cookies: HTMLInputElement
  scopeGlobal: HTMLInputElement
}

export type SiteConfigsSetupResult = RenderResult & {
  form: HTMLElement
  withinForm: ReturnType<typeof within>
  inputs: SiteConfigFormControls
  queryBanner: () => HTMLElement | null
  withinBanner: () => ReturnType<typeof within> | null
  mutate: ReturnType<typeof vi.fn>
}

export async function setup(options: SiteConfigsSetupOptions = {}): Promise<SiteConfigsSetupResult> {
  const { data = defaultSiteConfigsResponse, locale = 'en', swr } = options

  Object.values(openApiSpies).forEach((spy) => spy.mockReset())
  openApiSpies.listSiteConfigs.mockResolvedValue(data)

  const mutate = vi.fn()
  const baseHandler = {
    matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/site-configs',
    value: makeSWRSuccess(data, { mutate }),
  }
  const handlers = [baseHandler, ...(swr?.handlers ?? [])]
  const swrConfig: RenderWithSWROptions['swr'] = {
    ...swr,
    handlers,
  }

  const renderResult = renderWithSWR(<SiteConfigs />, {
    locale,
    swr: swrConfig,
  })

  const nameInput = (await screen.findByLabelText(/^Name$/i)) as HTMLInputElement
  const form = nameInput.closest('form') as HTMLElement
  const withinForm = within(form)
  const inputs: SiteConfigFormControls = {
    name: nameInput,
    siteUrl: withinForm.getByLabelText(/Site URL/i) as HTMLInputElement,
    usernameSelector: withinForm.getByLabelText(/Username selector/i) as HTMLInputElement,
    passwordSelector: withinForm.getByLabelText(/Password selector/i) as HTMLInputElement,
    loginSelector: withinForm.getByLabelText(/Login button selector/i) as HTMLInputElement,
    cookies: withinForm.getByLabelText(/Cookies to store/i) as HTMLInputElement,
    scopeGlobal: withinForm.getByRole('checkbox', { name: /Global/i }) as HTMLInputElement,
  }

  const queryBanner = () => screen.queryByRole('alert') ?? screen.queryByRole('status')
  const withinBanner = () => {
    const banner = queryBanner()
    return banner ? within(banner) : null
  }

  return Object.assign(renderResult, {
    form,
    withinForm,
    inputs,
    queryBanner,
    withinBanner,
    mutate,
  })
}

describe('site configs form setup helper', () => {
  it('renders the create site config form with default fields and data', async () => {
    const { form, inputs, queryBanner, unmount } = await setup()

    try {
      expect(form).toBeInTheDocument()
      expect(inputs.name).toBeInstanceOf(HTMLInputElement)
      expect(inputs.siteUrl.value).toBe('')
      expect(inputs.scopeGlobal.checked).toBe(false)
      expect(queryBanner()).toBeNull()
      expect(await screen.findByText('Example Site')).toBeInTheDocument()
    } finally {
      unmount()
    }
  })
})

describe('site configs creation validation', () => {
  it('shows inline errors and skips submission when required fields are empty', async () => {
    const { form, inputs, unmount } = await setup()

    try {
      fireEvent.change(inputs.name, { target: { value: ' ' } })
      fireEvent.change(inputs.siteUrl, { target: { value: ' ' } })
      fireEvent.change(inputs.usernameSelector, { target: { value: ' ' } })
      fireEvent.change(inputs.passwordSelector, { target: { value: ' ' } })
      fireEvent.change(inputs.loginSelector, { target: { value: ' ' } })

      fireEvent.submit(form)

      expect(inputs.name).toHaveAttribute('aria-describedby', 'create-site-config-name-error')
      expect(inputs.siteUrl).toHaveAttribute('aria-describedby', 'create-site-config-url-error')
      expect(inputs.usernameSelector).toHaveAttribute(
        'aria-describedby',
        'create-site-config-username-selector-error',
      )
      expect(inputs.passwordSelector).toHaveAttribute(
        'aria-describedby',
        'create-site-config-password-selector-error',
      )
      expect(inputs.loginSelector).toHaveAttribute(
        'aria-describedby',
        'create-site-config-login-selector-error',
      )

      expect(within(form).getByText('Name is required')).toBeInTheDocument()
      expect(within(form).getByText('Valid URL required')).toBeInTheDocument()
      expect(within(form).getAllByText('Required')).toHaveLength(3)

      expect(createSiteConfigMock).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it('blocks submission when the site URL is invalid', async () => {
    const { form, inputs, unmount } = await setup()

    try {
      fireEvent.change(inputs.name, { target: { value: 'Example' } })
      fireEvent.change(inputs.siteUrl, { target: { value: 'example.com/login' } })
      fireEvent.change(inputs.usernameSelector, { target: { value: '#user' } })
      fireEvent.change(inputs.passwordSelector, { target: { value: '#pass' } })
      fireEvent.change(inputs.loginSelector, { target: { value: 'button[type="submit"]' } })

      const submitButton = within(form).getByRole('button', { name: 'Create' })
      expect(submitButton).toBeDisabled()

      fireEvent.submit(form)

      await screen.findByTestId('alert-alert')
      expect(within(form).getByText('Valid URL required')).toBeInTheDocument()
      expect(await screen.findByText('Site URL is invalid')).toBeInTheDocument()
      expect(createSiteConfigMock).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })
})

describe('site configs creation success path', () => {
  it('submits normalized cookies and owner scope, then shows success feedback', async () => {
    const { form, inputs, mutate, unmount } = await setup()

    try {
      fireEvent.change(inputs.name, { target: { value: 'Acme Login' } })
      fireEvent.change(inputs.siteUrl, { target: { value: 'https://acme.example/login' } })
      fireEvent.change(inputs.usernameSelector, { target: { value: '#username' } })
      fireEvent.change(inputs.passwordSelector, { target: { value: '#password' } })
      fireEvent.change(inputs.loginSelector, { target: { value: 'button[type="submit"]' } })
      fireEvent.change(inputs.cookies, { target: { value: 'session=abc,  theme , ,  xyz  ' } })
      fireEvent.click(inputs.scopeGlobal)

      const submitButton = within(form).getByRole('button', { name: 'Create' })
      expect(submitButton).toBeEnabled()

      createSiteConfigMock.mockResolvedValueOnce({})

      fireEvent.click(submitButton)

      await waitFor(() => expect(createSiteConfigMock).toHaveBeenCalledTimes(1))
      expect(createSiteConfigMock).toHaveBeenCalledWith({
        siteConfig: {
          name: 'Acme Login',
          site_url: 'https://acme.example/login',
          username_selector: '#username',
          password_selector: '#password',
          login_button_selector: 'button[type="submit"]',
          cookies_to_store: ['session=abc', 'theme', 'xyz'],
          ownerUserId: null,
        },
      })

      const successMessage = await screen.findByText('Site config created')
      expect(successMessage.closest('[role="status"]')).toBeInTheDocument()
      await waitFor(() => expect(mutate).toHaveBeenCalled())
    } finally {
      unmount()
    }
  })
})
