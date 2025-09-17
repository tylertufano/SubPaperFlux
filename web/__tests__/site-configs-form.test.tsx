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
  updateSiteConfig: vi.fn(),
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
    updateSiteConfigSiteConfigsConfigIdPut: openApiSpies.updateSiteConfig,
  },
}))

export const listSiteConfigsMock = openApiSpies.listSiteConfigs
export const createSiteConfigMock = openApiSpies.createSiteConfig
export const deleteSiteConfigMock = openApiSpies.deleteSiteConfig
export const testSiteConfigMock = openApiSpies.testSiteConfig
export const updateSiteConfigMock = openApiSpies.updateSiteConfig

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
  it('submits normalized cookies while toggling owner scope and shows success feedback', async () => {
    const { form, inputs, withinForm, mutate, unmount } = await setup()

    try {
      const submitButton = withinForm.getByRole('button', { name: 'Create' })
      const fillForm = (
        values: Partial<{
          name: string
          siteUrl: string
          username: string
          password: string
          login: string
          cookies: string
        }> = {},
      ) => {
        fireEvent.change(inputs.name, { target: { value: values.name ?? 'Acme Login' } })
        fireEvent.change(inputs.siteUrl, { target: { value: values.siteUrl ?? 'https://acme.example/login' } })
        fireEvent.change(inputs.usernameSelector, { target: { value: values.username ?? '#username' } })
        fireEvent.change(inputs.passwordSelector, { target: { value: values.password ?? '#password' } })
        fireEvent.change(inputs.loginSelector, { target: { value: values.login ?? 'button[type="submit"]' } })
        fireEvent.change(inputs.cookies, {
          target: { value: values.cookies ?? 'session=abc,  theme , ,  xyz  ' },
        })
      }

      createSiteConfigMock.mockResolvedValue({})

      fireEvent.click(inputs.scopeGlobal)
      fireEvent.click(inputs.scopeGlobal)
      fillForm()

      expect(submitButton).toBeEnabled()

      fireEvent.click(submitButton)

      await waitFor(() => expect(createSiteConfigMock).toHaveBeenCalledTimes(1))
      const firstCall = createSiteConfigMock.mock.calls[0][0]
      expect(firstCall.siteConfig).toMatchObject({
        name: 'Acme Login',
        site_url: 'https://acme.example/login',
        username_selector: '#username',
        password_selector: '#password',
        login_button_selector: 'button[type="submit"]',
        cookies_to_store: ['session=abc', 'theme', 'xyz'],
      })
      expect(firstCall.siteConfig.ownerUserId).toBeUndefined()

      const firstSuccess = await screen.findByText('Site config created')
      expect(firstSuccess.closest('[role="status"]')).toBeInTheDocument()
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))

      fillForm({
        name: 'Global Entry',
        siteUrl: 'https://global.example/login',
        username: '#global-user',
        password: '#global-pass',
        login: 'button.global-submit',
        cookies: 'token=one, two , , three',
      })
      fireEvent.click(inputs.scopeGlobal)
      expect(inputs.scopeGlobal.checked).toBe(true)

      fireEvent.click(submitButton)

      await waitFor(() => expect(createSiteConfigMock).toHaveBeenCalledTimes(2))
      const secondCall = createSiteConfigMock.mock.calls[1][0]
      expect(secondCall.siteConfig).toMatchObject({
        name: 'Global Entry',
        site_url: 'https://global.example/login',
        username_selector: '#global-user',
        password_selector: '#global-pass',
        login_button_selector: 'button.global-submit',
        cookies_to_store: ['token=one', 'two', 'three'],
      })
      expect(secondCall.siteConfig.ownerUserId).toBeNull()

      const secondSuccess = await screen.findByText('Site config created')
      expect(secondSuccess.closest('[role="status"]')).toBeInTheDocument()
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2))
    } finally {
      unmount()
    }
  })
})

describe('site configs error handling', () => {
  it('surfaces create failures in the banner with the thrown message', async () => {
    const { inputs, withinForm, mutate, withinBanner, unmount } = await setup()

    try {
      fireEvent.change(inputs.name, { target: { value: 'Acme Login' } })
      fireEvent.change(inputs.siteUrl, { target: { value: 'https://acme.example/login' } })
      fireEvent.change(inputs.usernameSelector, { target: { value: '#username' } })
      fireEvent.change(inputs.passwordSelector, { target: { value: '#password' } })
      fireEvent.change(inputs.loginSelector, { target: { value: 'button[type="submit"]' } })

      const submitButton = withinForm.getByRole('button', { name: 'Create' })
      expect(submitButton).toBeEnabled()

      createSiteConfigMock.mockRejectedValueOnce(new Error('Create failed'))

      fireEvent.click(submitButton)

      await waitFor(() => expect(createSiteConfigMock).toHaveBeenCalledTimes(1))

      const banner = await screen.findByRole('alert')
      expect(banner).toBeInTheDocument()
      const bannerUtils = withinBanner()
      expect(bannerUtils?.getByText('Create failed')).toBeInTheDocument()
      expect(mutate).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it('surfaces test failures in the banner with the thrown message', async () => {
    const { withinBanner, unmount } = await setup()

    try {
      testSiteConfigMock.mockRejectedValueOnce(new Error('Test failure'))

      const testButton = await screen.findByRole('button', { name: 'Test Login' })
      fireEvent.click(testButton)

      await waitFor(() => expect(testSiteConfigMock).toHaveBeenCalledTimes(1))

      const banner = await screen.findByRole('alert')
      expect(banner).toBeInTheDocument()
      const bannerUtils = withinBanner()
      expect(bannerUtils?.getByText('Test failure')).toBeInTheDocument()
    } finally {
      unmount()
    }
  })
})

describe('site configs edit form', () => {
  it('retains inline validation when blanked and saves updates while clearing errors on success', async () => {
    const { mutate, withinBanner, unmount } = await setup()

    try {
      const editButton = await screen.findByRole('button', { name: 'Edit' })
      fireEvent.click(editButton)

      const editForm = await screen.findByRole('form', { name: /edit site config/i })
      const withinEditForm = within(editForm)
      const usernameInput = withinEditForm.getByLabelText('Username selector') as HTMLInputElement
      const passwordInput = withinEditForm.getByLabelText('Password selector') as HTMLInputElement
      const loginInput = withinEditForm.getByLabelText('Login button selector') as HTMLInputElement
      const cookiesInput = withinEditForm.getByLabelText('Cookies to store (comma-separated)') as HTMLInputElement
      const saveButton = withinEditForm.getByRole('button', { name: 'Save' }) as HTMLButtonElement

      expect(saveButton).toBeEnabled()

      fireEvent.change(usernameInput, { target: { value: ' ' } })
      expect(usernameInput).toHaveAttribute('aria-describedby', 'edit-site-config-username-selector-error')
      const inlineError = withinEditForm.getByText('Required')
      expect(inlineError).toHaveAttribute('id', 'edit-site-config-username-selector-error')
      expect(saveButton).toBeDisabled()

      fireEvent.change(usernameInput, { target: { value: '#updated-user' } })
      expect(withinEditForm.queryByText('Required')).not.toBeInTheDocument()
      expect(usernameInput).not.toHaveAttribute('aria-describedby', 'edit-site-config-username-selector-error')
      expect(saveButton).toBeEnabled()

      fireEvent.change(passwordInput, { target: { value: '#updated-pass' } })
      fireEvent.change(loginInput, { target: { value: 'button.updated-submit' } })
      fireEvent.change(cookiesInput, { target: { value: 'sessionid, remember_me ,  extra  ' } })

      updateSiteConfigMock.mockResolvedValueOnce({})
      mutate.mockClear()

      fireEvent.click(saveButton)

      await waitFor(() => expect(updateSiteConfigMock).toHaveBeenCalledTimes(1))
      const updateCall = updateSiteConfigMock.mock.calls[0][0]
      expect(updateCall).toEqual({
        configId: 'config-1',
        siteConfig: {
          id: 'config-1',
          name: 'Example Site',
          site_url: 'https://example.com/login',
          username_selector: '#updated-user',
          password_selector: '#updated-pass',
          login_button_selector: 'button.updated-submit',
          cookies_to_store: ['sessionid', 'remember_me', 'extra'],
          owner_user_id: 'user-1',
        },
      })

      const successBanner = await screen.findByText('Site config updated')
      expect(successBanner.closest('[role="status"]')).toBeInTheDocument()
      const bannerUtils = withinBanner()
      expect(bannerUtils?.getByText('Site config updated')).toBeInTheDocument()
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))

      await waitFor(() =>
        expect(screen.queryByRole('form', { name: /edit site config/i })).not.toBeInTheDocument(),
      )
    } finally {
      unmount()
    }
  })
})
