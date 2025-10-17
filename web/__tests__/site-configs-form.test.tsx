import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, type RenderWithSWROptions } from './helpers/renderWithSWR'
import SiteConfigs from '../pages/site-configs'
import type { SiteConfigsPage } from '../sdk/src/models/SiteConfigsPage'
import type { SiteConfigApiOut } from '../sdk/src/models/SiteConfigApiOut'
import type { SiteConfigSeleniumOut } from '../sdk/src/models/SiteConfigSeleniumOut'
import type { SiteConfigRecord } from '../lib/openapi'

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

const seleniumItem: SiteConfigSeleniumOut = {
  loginType: 'selenium',
  id: 'config-1',
  name: 'Example Site',
  siteUrl: 'https://example.com/login',
  ownerUserId: 'user-1',
  successTextClass: 'alert alert-success',
  expectedSuccessText: 'Signed in successfully',
  requiredCookies: ['sessionid'],
  seleniumConfig: {
    usernameSelector: '#username',
    passwordSelector: '#password',
    loginButtonSelector: 'button[type="submit"]',
    postLoginSelector: '',
    cookiesToStore: ['sessionid'],
  },
}

const apiItem: SiteConfigApiOut = {
  loginType: 'api',
  id: 'api-config-1',
  name: 'API Example',
  siteUrl: 'https://api.example/login',
  ownerUserId: null,
  successTextClass: 'toast toast-success',
  expectedSuccessText: 'API signed in',
  requiredCookies: ['session'],
  apiConfig: {
    endpoint: 'https://example.com/api/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test': 'value' },
    body: { login: '{{username}}', pass: '{{password}}', remember_me: true },
    cookiesToStore: ['session'],
    cookies: { refresh: '$.tokens.refresh' },
  },
}

const rawApiItemResponse = {
  id: 'api-config-raw',
  login_type: 'api',
  name: 'Raw API Example',
  site_url: 'https://raw.example/login',
  owner_user_id: null,
  success_text_class: 'toast toast-success',
  expected_success_text: 'Raw API signed in',
  required_cookies: ['session'],
  api_config: {
    endpoint: 'https://raw.example/api/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { login: '{{username}}', pass: '{{password}}' },
    cookies_to_store: ['session', 'refresh'],
    cookies: { refresh: '$.tokens.refresh' },
  },
}

export const defaultSiteConfigsResponse: SiteConfigsPage = {
  items: [seleniumItem],
  total: 1,
  page: 1,
  size: 25,
  hasNext: false,
  totalPages: 1,
}

export type SiteConfigsSetupOptions = {
  data?: SiteConfigsPage | SiteConfigApiOut[] | SiteConfigSeleniumOut[] | SiteConfigRecord[]
  locale?: string
  swr?: RenderWithSWROptions['swr']
}

export type SiteConfigFormControls = {
  name: HTMLInputElement
  siteUrl: HTMLInputElement
  loginTypeRadios: HTMLInputElement[]
  successTextClass: HTMLInputElement
  expectedSuccessText: HTMLInputElement
  requiredCookies: HTMLInputElement
  usernameSelector?: HTMLInputElement
  passwordSelector?: HTMLInputElement
  loginSelector?: HTMLInputElement
  postLoginSelector?: HTMLInputElement
  cookiesText?: HTMLInputElement
  apiLoginUrl?: HTMLInputElement
  apiMethod?: HTMLSelectElement
  apiPayloadMode?: HTMLSelectElement
  apiLoginIdParam?: HTMLInputElement
  apiPasswordParam?: HTMLInputElement
  apiCookiesToStore?: HTMLInputElement
  apiAddCustomFieldButton?: HTMLButtonElement
  apiCustomKeyInputs?: HTMLInputElement[]
  apiCustomValueInputs?: HTMLInputElement[]
}

export type SiteConfigsSetupResult = RenderResult & {
  form: HTMLElement
  withinForm: ReturnType<typeof within>
  inputs: SiteConfigFormControls
  queryBanner: () => HTMLElement | null
  withinBanner: () => ReturnType<typeof within> | null
  mutate: ReturnType<typeof vi.fn>
}

function resolveInputs(withinForm: ReturnType<typeof within>): SiteConfigFormControls {
  const loginTypeRadios = withinForm.getAllByRole('radio') as HTMLInputElement[]
  const base: SiteConfigFormControls = {
    name: withinForm.getByLabelText(/^Name$/i) as HTMLInputElement,
    siteUrl: withinForm.getByLabelText(/^Site URL$/i) as HTMLInputElement,
    loginTypeRadios,
  }
  base.successTextClass = withinForm.getByLabelText(/Success message CSS class/i) as HTMLInputElement
  base.expectedSuccessText = withinForm.getByLabelText(/Expected success text/i) as HTMLInputElement
  base.requiredCookies = withinForm.getByLabelText(/Required cookies/i) as HTMLInputElement
  const usernameSelector = withinForm.queryByLabelText(/Username selector/i) as HTMLInputElement | null
  if (usernameSelector) {
    base.usernameSelector = usernameSelector
    base.passwordSelector = withinForm.getByLabelText(/Password selector/i) as HTMLInputElement
    base.loginSelector = withinForm.getByLabelText(/Login button selector/i) as HTMLInputElement
    base.postLoginSelector = withinForm.getByLabelText(/Post-login selector/i) as HTMLInputElement
    base.cookiesText = withinForm.getByLabelText(/Cookies to store/i) as HTMLInputElement
  }
  const apiLoginUrl = withinForm.queryByLabelText(/Login URL/i) as HTMLInputElement | null
  if (apiLoginUrl) {
    base.apiLoginUrl = apiLoginUrl
    base.apiMethod = withinForm.getByLabelText(/HTTP method/i, { selector: 'select' }) as HTMLSelectElement
    base.apiPayloadMode = withinForm.getByLabelText(/Payload encoding/i, {
      selector: 'select',
    }) as HTMLSelectElement
    base.apiLoginIdParam = withinForm.getByLabelText(/Login ID parameter name/i) as HTMLInputElement
    base.apiPasswordParam = withinForm.getByLabelText(/Password parameter name/i) as HTMLInputElement
    base.apiCookiesToStore = withinForm.getByLabelText(/^Cookies to store$/i) as HTMLInputElement
    base.apiAddCustomFieldButton = withinForm.getByRole('button', { name: /Add payload field/i }) as HTMLButtonElement
    base.apiCustomKeyInputs = withinForm.queryAllByLabelText(/Custom payload key/i) as HTMLInputElement[]
    base.apiCustomValueInputs = withinForm.queryAllByLabelText(/Custom payload value/i) as HTMLInputElement[]
  }
  return base
}

export async function setup(options: SiteConfigsSetupOptions = {}): Promise<SiteConfigsSetupResult> {
  const { data = defaultSiteConfigsResponse, locale = 'en', swr } = options

  Object.values(openApiSpies).forEach((spy) => spy.mockReset())
  openApiSpies.listSiteConfigs.mockResolvedValue(data)

  let currentData: typeof data = data

  const mutate = vi.fn(async (updater?: any) => {
    let resolved = currentData
    if (typeof updater === 'function') {
      resolved = updater(currentData)
    } else if (updater !== undefined) {
      resolved = updater
    }

    if (resolved instanceof Promise) {
      resolved = await resolved
    }

    if (resolved !== undefined) {
      currentData = resolved
    }

    return currentData
  })
  const baseHandler = {
    matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/site-configs',
    value: () => makeSWRSuccess(currentData, { mutate }),
  }
  const handlers = [baseHandler, ...(swr?.handlers ?? [])]
  const swrConfig: RenderWithSWROptions['swr'] = {
    ...swr,
    handlers,
  }

  const renderResult = renderWithSWR(<SiteConfigs />, {
    locale,
    swr: swrConfig,
    session: {
      user: {
        name: 'Admin User',
        email: 'admin@example.com',
        permissions: ['site_configs:read', 'site_configs:manage'],
      },
      expires: '2099-01-01T00:00:00.000Z',
    },
  })

  const [nameInput] = (await screen.findAllByLabelText(/^Name$/i)) as HTMLInputElement[]
  const form = nameInput.closest('form') as HTMLElement
  const withinForm = within(form)
  const inputs = resolveInputs(withinForm)

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

describe('site configs table display', () => {
  it('shows login type labels and summaries for selenium and api configs', async () => {
    const tableData: SiteConfigsPage = {
      items: [seleniumItem, apiItem],
      total: 2,
      page: 1,
      size: 25,
      hasNext: false,
      totalPages: 1,
    }

    const { unmount } = await setup({ data: tableData })

    try {
      const table = await screen.findByRole('table', { name: /site configs/i })
      const rows = within(table).getAllByRole('row')
      const dataRows = rows.slice(1)
      expect(dataRows).toHaveLength(2)

      const seleniumRow = dataRows[0]
      const apiRow = dataRows[1]

      expect(within(seleniumRow).getByText('Browser automation')).toBeInTheDocument()
      expect(within(apiRow).getByText('Direct API')).toBeInTheDocument()

      const seleniumCells = within(seleniumRow).getAllByRole('cell')
      const apiCells = within(apiRow).getAllByRole('cell')
      expect(seleniumCells).toHaveLength(4)
      expect(apiCells).toHaveLength(4)
    } finally {
      unmount()
    }
  })
})

describe('site configs creation validation', () => {
  it('shows inline errors for selenium config when required fields are empty', async () => {
    const { form, inputs, unmount } = await setup()

    try {
      fireEvent.change(inputs.name, { target: { value: ' ' } })
      fireEvent.change(inputs.siteUrl, { target: { value: ' ' } })
      inputs.usernameSelector && fireEvent.change(inputs.usernameSelector, { target: { value: ' ' } })
      inputs.passwordSelector && fireEvent.change(inputs.passwordSelector, { target: { value: ' ' } })
      inputs.loginSelector && fireEvent.change(inputs.loginSelector, { target: { value: ' ' } })

      fireEvent.submit(form)

      expect(inputs.name).toHaveAttribute('aria-describedby', 'create-site-config-name-error')
      expect(inputs.siteUrl).toHaveAttribute('aria-describedby', 'create-site-config-url-error')
      expect(inputs.usernameSelector).toHaveAttribute('aria-describedby', 'create-site-config-username-selector-error')
      expect(inputs.passwordSelector).toHaveAttribute('aria-describedby', 'create-site-config-password-selector-error')
      expect(inputs.loginSelector).toHaveAttribute('aria-describedby', 'create-site-config-login-selector-error')
      expect(inputs.requiredCookies).toHaveAttribute('aria-describedby', 'create-site-config-required-cookies-error')

      expect(within(form).getByText('Name is required')).toBeInTheDocument()
      expect(within(form).getByText('Valid URL required')).toBeInTheDocument()
      expect(within(form).getByText('Add at least one cookie to store or require')).toBeInTheDocument()
      expect(within(form).getAllByText('Required')).toHaveLength(3)
      expect(createSiteConfigMock).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it('rejects site URLs that are not HTTP or HTTPS', async () => {
    const { form, inputs, unmount } = await setup()

    try {
      fireEvent.change(inputs.name, { target: { value: 'Acme Login' } })
      fireEvent.change(inputs.siteUrl, { target: { value: 'ftp://acme.example/login' } })
      fireEvent.change(inputs.usernameSelector!, { target: { value: '#username' } })
      fireEvent.change(inputs.passwordSelector!, { target: { value: '#password' } })
      fireEvent.change(inputs.loginSelector!, { target: { value: 'button[type="submit"]' } })
      fireEvent.change(inputs.cookiesText!, { target: { value: 'sid' } })
      fireEvent.change(inputs.requiredCookies, { target: { value: 'sid' } })

      fireEvent.submit(form)

      await waitFor(() =>
        expect(within(form).getByText('Valid URL required')).toBeInTheDocument(),
      )
      expect(createSiteConfigMock).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it('validates API configs including structured inputs', async () => {
    const { form, withinForm, inputs, unmount } = await setup()

    try {
      const apiRadio = inputs.loginTypeRadios.find((radio) => radio.value === 'api')
      expect(apiRadio).toBeDefined()
      fireEvent.click(apiRadio!)

      const apiInputs = resolveInputs(withinForm)
      fireEvent.change(apiInputs.name, { target: { value: 'API Config' } })
      fireEvent.change(apiInputs.siteUrl, { target: { value: 'https://api.example/login' } })

      fireEvent.submit(form)

      const loginUrlDescribedBy = apiInputs.apiLoginUrl?.getAttribute('aria-describedby') ?? ''
      expect(loginUrlDescribedBy.split(' ')).toContain('create-site-config-login-url-error')
      expect(apiInputs.apiLoginIdParam).toHaveAttribute('aria-describedby', 'create-site-config-login-id-error')
      expect(apiInputs.apiPasswordParam).toHaveAttribute('aria-describedby', 'create-site-config-password-param-error')
      const cookiesDescribedBy = apiInputs.apiCookiesToStore?.getAttribute('aria-describedby') ?? ''
      expect(cookiesDescribedBy.split(' ')).toContain('create-site-config-api-cookies-error')
      expect(apiInputs.requiredCookies).toHaveAttribute('aria-describedby', 'create-site-config-required-cookies-error')
      expect(withinForm.getByText('Login URL is required')).toBeInTheDocument()
      expect(withinForm.getByText('Enter a login ID parameter name')).toBeInTheDocument()
      expect(withinForm.getByText('Enter a password parameter name')).toBeInTheDocument()
      expect(withinForm.getAllByText('Add at least one cookie to store or require')).toHaveLength(2)

      fireEvent.change(apiInputs.successTextClass, { target: { value: 'alert-success' } })
      fireEvent.submit(form)
      expect(apiInputs.expectedSuccessText).toHaveAttribute('aria-describedby', 'create-site-config-expected-success-text-error')
      expect(withinForm.getByText('Enter expected success text when a CSS class is provided')).toBeInTheDocument()

      fireEvent.change(apiInputs.expectedSuccessText, { target: { value: 'Welcome back' } })
      fireEvent.change(apiInputs.successTextClass, { target: { value: ' ' } })
      fireEvent.submit(form)
      expect(apiInputs.successTextClass).toHaveAttribute('aria-describedby', 'create-site-config-success-text-class-error')
      expect(withinForm.getByText('Enter a CSS class when expected success text is provided')).toBeInTheDocument()

      fireEvent.change(apiInputs.successTextClass, { target: { value: 'alert-success' } })

      fireEvent.change(apiInputs.apiLoginUrl!, { target: { value: 'notaurl' } })
      fireEvent.submit(form)
      expect(withinForm.getByText('Enter a valid login URL')).toBeInTheDocument()

      fireEvent.change(apiInputs.apiLoginUrl!, { target: { value: 'https://example.com/api/login' } })
      fireEvent.change(apiInputs.apiLoginIdParam!, { target: { value: 'user' } })
      fireEvent.change(apiInputs.apiPasswordParam!, { target: { value: 'pass' } })
      fireEvent.change(apiInputs.apiCookiesToStore!, { target: { value: 'session' } })
      fireEvent.change(apiInputs.apiMethod!, { target: { value: 'TRACE' } })

      fireEvent.submit(form)

      expect(withinForm.getByText(/Method is required|Choose a supported HTTP method/)).toBeInTheDocument()
      expect(apiInputs.apiMethod).toHaveAttribute('aria-describedby', 'create-site-config-method-error')
      expect(createSiteConfigMock).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })
})

describe('site configs creation success path', () => {
  it('submits selenium configs with required fields', async () => {
    const { form, inputs, withinForm, mutate, unmount } = await setup()

    try {
      fireEvent.change(inputs.name, { target: { value: 'Acme Login' } })
      fireEvent.change(inputs.siteUrl, { target: { value: 'https://acme.example/login' } })
      fireEvent.change(inputs.usernameSelector!, { target: { value: '#username' } })
      fireEvent.change(inputs.passwordSelector!, { target: { value: '#password' } })
      fireEvent.change(inputs.loginSelector!, { target: { value: 'button[type="submit"]' } })
      fireEvent.change(inputs.cookiesText!, { target: { value: 'sid, theme , extra' } })
      fireEvent.change(inputs.successTextClass, { target: { value: 'alert success' } })
      fireEvent.change(inputs.expectedSuccessText, { target: { value: 'Signed in!' } })
      fireEvent.change(inputs.requiredCookies, { target: { value: 'sid, theme' } })

      createSiteConfigMock.mockResolvedValueOnce({})

      fireEvent.submit(form)

      await waitFor(() => expect(createSiteConfigMock).toHaveBeenCalledTimes(1))
      const firstCall = createSiteConfigMock.mock.calls[0][0]
      expect(firstCall).toEqual({
        body: {
          loginType: 'selenium',
          name: 'Acme Login',
          siteUrl: 'https://acme.example/login',
          successTextClass: 'alert success',
          expectedSuccessText: 'Signed in!',
          requiredCookies: ['sid', 'theme'],
          seleniumConfig: {
            usernameSelector: '#username',
            passwordSelector: '#password',
            loginButtonSelector: 'button[type="submit"]',
            cookiesToStore: ['sid', 'theme', 'extra'],
          },
          ownerUserId: undefined,
        },
      })

      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    } finally {
      unmount()
    }
  })

  it('submits API configs with parsed payloads', async () => {
    const { form, withinForm, mutate, unmount } = await setup()

    try {
      fireEvent.click(withinForm.getByRole('radio', { name: /Direct API/i }))
      const inputs = resolveInputs(withinForm)

      fireEvent.change(inputs.name, { target: { value: 'API Login' } })
      fireEvent.change(inputs.siteUrl, { target: { value: 'https://api.example/login' } })
      fireEvent.change(inputs.apiLoginUrl!, { target: { value: 'https://example.com/api/login' } })
      fireEvent.change(inputs.apiMethod!, { target: { value: 'POST' } })
      fireEvent.change(inputs.apiLoginIdParam!, { target: { value: 'user_id' } })
      fireEvent.change(inputs.apiPasswordParam!, { target: { value: 'passcode' } })
      fireEvent.change(inputs.apiCookiesToStore!, { target: { value: 'session, refresh' } })
      fireEvent.change(inputs.successTextClass, { target: { value: 'toast-success' } })
      fireEvent.change(inputs.expectedSuccessText, { target: { value: 'API login ok' } })
      fireEvent.change(inputs.requiredCookies, { target: { value: 'session, refresh' } })

      createSiteConfigMock.mockResolvedValueOnce({})

      fireEvent.submit(form)

      await waitFor(() => expect(createSiteConfigMock).toHaveBeenCalledTimes(1))
      const payload = createSiteConfigMock.mock.calls[0][0].body
      expect(payload).toMatchObject({
        loginType: 'api',
        name: 'API Login',
        siteUrl: 'https://api.example/login',
        successTextClass: 'toast-success',
        expectedSuccessText: 'API login ok',
        requiredCookies: ['session', 'refresh'],
        apiConfig: {
          endpoint: 'https://example.com/api/login',
          method: 'POST',
          body: { user_id: '{{username}}', passcode: '{{password}}' },
          cookiesToStore: ['session', 'refresh'],
          headers: { 'Content-Type': 'application/json' },
        },
      })
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    } finally {
      unmount()
    }
  })

  it('supports custom payload fields and urlencoded mode', async () => {
    const { form, withinForm, mutate, unmount } = await setup()

    try {
      fireEvent.click(withinForm.getByRole('radio', { name: /Direct API/i }))
      let inputs = resolveInputs(withinForm)

      fireEvent.change(inputs.name, { target: { value: 'API Login' } })
      fireEvent.change(inputs.siteUrl, { target: { value: 'https://api.example/login' } })
      fireEvent.change(inputs.apiLoginUrl!, { target: { value: 'https://example.com/api/login' } })
      fireEvent.change(inputs.apiMethod!, { target: { value: 'POST' } })
      fireEvent.change(inputs.apiLoginIdParam!, { target: { value: 'user_id' } })
      fireEvent.change(inputs.apiPasswordParam!, { target: { value: 'passcode' } })
      fireEvent.change(inputs.apiCookiesToStore!, { target: { value: 'session' } })
      fireEvent.change(inputs.requiredCookies, { target: { value: 'session' } })

      fireEvent.click(inputs.apiAddCustomFieldButton!)
      inputs = resolveInputs(withinForm)

      const [keyInput] = inputs.apiCustomKeyInputs ?? []
      const [valueInput] = inputs.apiCustomValueInputs ?? []
      expect(keyInput).toBeDefined()
      expect(valueInput).toBeDefined()
      fireEvent.change(keyInput!, { target: { value: 'remember_me' } })
      fireEvent.change(valueInput!, { target: { value: 'true' } })

      fireEvent.change(inputs.apiPayloadMode!, { target: { value: 'form' } })

      createSiteConfigMock.mockResolvedValueOnce({})

      fireEvent.submit(form)

      await waitFor(() => expect(createSiteConfigMock).toHaveBeenCalledTimes(1))
      const payload = createSiteConfigMock.mock.calls[0][0].body
      expect(payload).toMatchObject({
        loginType: 'api',
        apiConfig: {
          endpoint: 'https://example.com/api/login',
          method: 'POST',
          body: {
            user_id: '{{username}}',
            passcode: '{{password}}',
            remember_me: 'true',
          },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      })

      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    } finally {
      unmount()
    }
  })
})

describe('site configs error handling', () => {
  it('surfaces create failures in the banner with the thrown message', async () => {
    const { form, withinForm, inputs, withinBanner, mutate, unmount } = await setup()

    try {
      fireEvent.change(inputs.name, { target: { value: 'Acme Login' } })
      fireEvent.change(inputs.siteUrl, { target: { value: 'https://acme.example/login' } })
      fireEvent.change(inputs.usernameSelector!, { target: { value: '#username' } })
      fireEvent.change(inputs.passwordSelector!, { target: { value: '#password' } })
      fireEvent.change(inputs.loginSelector!, { target: { value: 'button[type="submit"]' } })
      fireEvent.change(inputs.cookiesText!, { target: { value: 'sid' } })
      fireEvent.change(inputs.requiredCookies, { target: { value: 'sid' } })

      createSiteConfigMock.mockRejectedValueOnce(new Error('Create failed'))

      fireEvent.submit(form)

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
  it('saves updates and clears errors on success', async () => {
    const { mutate, withinBanner, unmount } = await setup()

    try {
      const editButton = await screen.findByRole('button', { name: 'Edit' })
      fireEvent.click(editButton)

      const editForm = await screen.findByRole('form', { name: /edit site config/i })
      const withinEditForm = within(editForm)
      const usernameInput = withinEditForm.getByLabelText('Username selector') as HTMLInputElement
      const passwordInput = withinEditForm.getByLabelText('Password selector') as HTMLInputElement
      const loginInput = withinEditForm.getByLabelText('Login button selector') as HTMLInputElement
      const successClassInput = withinEditForm.getByLabelText('Success message CSS class (optional)') as HTMLInputElement
      const expectedTextInput = withinEditForm.getByLabelText('Expected success text (optional)') as HTMLInputElement
      const requiredCookiesInput = withinEditForm.getByLabelText('Required cookies (comma-separated)') as HTMLInputElement
      const saveButton = withinEditForm.getByRole('button', { name: 'Save' }) as HTMLButtonElement

      fireEvent.change(usernameInput, { target: { value: ' ' } })
      expect(usernameInput).toHaveAttribute('aria-describedby', 'edit-site-config-username-selector-error')
      expect(saveButton).toBeDisabled()

      fireEvent.change(usernameInput, { target: { value: '#updated-user' } })
      expect(usernameInput).not.toHaveAttribute('aria-describedby', 'edit-site-config-username-selector-error')
      expect(saveButton).toBeEnabled()

      fireEvent.change(passwordInput, { target: { value: '#updated-pass' } })
      fireEvent.change(loginInput, { target: { value: 'button.updated-submit' } })
      fireEvent.change(successClassInput, { target: { value: 'alert-updated' } })
      fireEvent.change(expectedTextInput, { target: { value: 'Welcome updated' } })
      fireEvent.change(requiredCookiesInput, { target: { value: 'sessionid, theme' } })

      updateSiteConfigMock.mockResolvedValueOnce({})
      mutate.mockClear()

      fireEvent.click(saveButton)

      await waitFor(() => expect(updateSiteConfigMock).toHaveBeenCalledTimes(1))
      const updateCall = updateSiteConfigMock.mock.calls[0][0]
      expect(updateCall.body).toMatchObject({
        loginType: 'selenium',
        id: 'config-1',
        name: 'Example Site',
        siteUrl: 'https://example.com/login',
        successTextClass: 'alert-updated',
        expectedSuccessText: 'Welcome updated',
        requiredCookies: ['sessionid', 'theme'],
        seleniumConfig: {
          usernameSelector: '#updated-user',
          passwordSelector: '#updated-pass',
          loginButtonSelector: 'button.updated-submit',
        },
        ownerUserId: 'user-1',
      })

      const successBanner = await screen.findByText('Site config updated')
      expect(successBanner.closest('[role="status"]')).toBeInTheDocument()
      const bannerUtils = withinBanner()
      expect(bannerUtils?.getByText('Site config updated')).toBeInTheDocument()
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.queryByRole('form', { name: /edit site config/i })).not.toBeInTheDocument())
    } finally {
      unmount()
    }
  })

  it('hydrates api-specific fields including payload mode and custom payload rows', async () => {
    const tableData: SiteConfigsPage = {
      items: [apiItem],
      total: 1,
      page: 1,
      size: 25,
      hasNext: false,
      totalPages: 1,
    }
    const { unmount } = await setup({ data: tableData })

    try {
      const editButton = await screen.findByRole('button', { name: 'Edit' })
      fireEvent.click(editButton)

      const editForm = await screen.findByRole('form', { name: /edit site config/i })
      const withinEditForm = within(editForm)
      const payloadMode = withinEditForm.getByLabelText('Payload encoding') as HTMLSelectElement
      expect(payloadMode.value).toBe('json')

      const keyInputs = withinEditForm.getAllByLabelText(/Custom payload key/i) as HTMLInputElement[]
      const valueInputs = withinEditForm.getAllByLabelText(/Custom payload value/i) as HTMLInputElement[]
      expect(keyInputs).toHaveLength(1)
      expect(valueInputs).toHaveLength(1)
      expect(keyInputs[0].value).toBe('remember_me')
      expect(valueInputs[0].value).toBe('true')
    } finally {
      unmount()
    }
  })

  it('hydrates api cookies to store values provided in snake_case responses', async () => {
    const tableData: SiteConfigsPage = {
      items: [rawApiItemResponse as any],
      total: 1,
      page: 1,
      size: 25,
      hasNext: false,
      totalPages: 1,
    }
    const { unmount } = await setup({ data: tableData })

    try {
      const editButton = await screen.findByRole('button', { name: 'Edit' })
      fireEvent.click(editButton)

      const editForm = await screen.findByRole('form', { name: /edit site config/i })
      const withinEditForm = within(editForm)
      const cookiesInput = withinEditForm.getByLabelText('Cookies to store') as HTMLInputElement
      expect(cookiesInput.value).toBe('session,refresh')
    } finally {
      unmount()
    }
  })
})
