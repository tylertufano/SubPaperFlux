import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, type RenderWithSWROptions, useSWRMock } from './helpers/renderWithSWR'
import Credentials from '../pages/credentials'

const openApiSpies = vi.hoisted(() => ({
  listCredentials: vi.fn(),
  listSiteConfigs: vi.fn(),
  createCredential: vi.fn(),
  createInstapaperFromLogin: vi.fn(),
  deleteCredential: vi.fn(),
  updateCredential: vi.fn(),
  getCredential: vi.fn(),
  testInstapaper: vi.fn(),
  testMiniflux: vi.fn(),
  getCredentialCookies: vi.fn(),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/credentials' }),
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
  }
})

vi.mock('../lib/openapi', () => ({
  __esModule: true,
  v1: {
    listCredentialsV1V1CredentialsGet: openApiSpies.listCredentials,
    listSiteConfigsV1V1SiteConfigsGet: openApiSpies.listSiteConfigs,
    testInstapaperV1IntegrationsInstapaperTestPost: openApiSpies.testInstapaper,
    testMinifluxV1IntegrationsMinifluxTestPost: openApiSpies.testMiniflux,
    getCredentialCookiesV1V1CredentialsCredIdCookiesGet: openApiSpies.getCredentialCookies,
  },
  creds: {
    createCredentialCredentialsPost: openApiSpies.createCredential,
    deleteCredentialCredentialsCredIdDelete: openApiSpies.deleteCredential,
    getCredentialCredentialsCredIdGet: openApiSpies.getCredential,
    updateCredentialCredentialsCredIdPut: openApiSpies.updateCredential,
  },
  createInstapaperCredentialFromLogin: openApiSpies.createInstapaperFromLogin,
}))

export const listCredentialsMock = openApiSpies.listCredentials
export const listSiteConfigsMock = openApiSpies.listSiteConfigs
export const createCredentialMock = openApiSpies.createCredential
export const createInstapaperFromLoginMock = openApiSpies.createInstapaperFromLogin
export const deleteCredentialMock = openApiSpies.deleteCredential
export const updateCredentialMock = openApiSpies.updateCredential
export const getCredentialMock = openApiSpies.getCredential
export const testInstapaperMock = openApiSpies.testInstapaper
export const testMinifluxMock = openApiSpies.testMiniflux
export const getCredentialCookiesMock = openApiSpies.getCredentialCookies

export const defaultCredentialsResponse = { items: [] as any[] }
export const defaultSiteConfigsResponse = { items: [{ id: 'sc-1', name: 'Example Site', owner_user_id: 'user-123' }] }

export type CredentialsSetupOptions = {
  data?: any
  locale?: string
  swr?: RenderWithSWROptions['swr']
  siteConfigs?: any
}

export type CredentialFormControls = {
  kind: HTMLSelectElement
  description: HTMLInputElement | null
  siteConfig: HTMLSelectElement | null
  username: HTMLInputElement | null
  password: HTMLInputElement | null
  instapaperUsername: HTMLInputElement | null
  instapaperPassword: HTMLInputElement | null
  minifluxUrl: HTMLInputElement | null
  apiKey: HTMLInputElement | null
  oauthToken: HTMLInputElement | null
  oauthSecret: HTMLInputElement | null
  consumerKey: HTMLInputElement | null
  consumerSecret: HTMLInputElement | null
}

export type CredentialsSetupResult = RenderResult & {
  form: HTMLElement
  withinForm: ReturnType<typeof within>
  inputs: CredentialFormControls
  queryBanner: () => HTMLElement | null
  withinBanner: () => ReturnType<typeof within> | null
  mutate: ReturnType<typeof vi.fn>
}

export async function setup(options: CredentialsSetupOptions = {}): Promise<CredentialsSetupResult> {
  const { data = defaultCredentialsResponse, locale = 'en', swr, siteConfigs = defaultSiteConfigsResponse } = options

  Object.values(openApiSpies).forEach((spy) => spy.mockReset())
  const cloneValue = (value: any): any => {
    if (Array.isArray(value)) {
      return value.map((item) => cloneValue(item))
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]))
    }
    return value
  }
  const initialData = cloneValue(data)
  const initialSiteConfigs = cloneValue(siteConfigs)
  openApiSpies.listCredentials.mockResolvedValue(initialData)
  openApiSpies.listSiteConfigs.mockResolvedValue(initialSiteConfigs)

  let currentData = initialData
  let currentSiteConfigs = initialSiteConfigs

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
    matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/credentials',
    value: () => makeSWRSuccess(currentData, { mutate }),
  }
  const siteConfigsHandler = {
    matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/site-configs',
    value: () => makeSWRSuccess(currentSiteConfigs),
  }
  const handlers = [baseHandler, siteConfigsHandler, ...(swr?.handlers ?? [])]
  const swrConfig: RenderWithSWROptions['swr'] = {
    ...swr,
    handlers,
  }

  const renderResult = renderWithSWR(<Credentials />, {
    locale,
    swr: swrConfig,
    session: {
      user: {
        id: 'user-123',
        name: 'Test User',
        email: 'user@example.com',
        permissions: ['credentials:manage'],
      },
      expires: '2099-01-01T00:00:00.000Z',
    },
  })

  const kindSelect = (await screen.findByLabelText(/Kind/)) as HTMLSelectElement
  const form = kindSelect.closest('form') as HTMLElement
  const withinForm = within(form)
  const findInput = (label: string | RegExp) => withinForm.queryByLabelText(label) as HTMLInputElement | null
  const findSelect = (label: string | RegExp) => withinForm.queryByLabelText(label) as HTMLSelectElement | null

  const inputs: CredentialFormControls = {
    kind: kindSelect,
    description: findInput('Description'),
    siteConfig: findSelect('Site Config'),
    username: findInput('Username'),
    password: findInput('Password'),
    instapaperUsername: findInput(/Instapaper username/i),
    instapaperPassword: findInput(/Instapaper password/i),
    minifluxUrl: findInput('Miniflux URL'),
    apiKey: findInput('API Key'),
    oauthToken: findInput('OAuth Token'),
    oauthSecret: findInput('OAuth Token Secret'),
    consumerKey: findInput('Consumer Key'),
    consumerSecret: findInput('Consumer Secret'),
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

describe('credentials form setup helper', () => {
  it('renders the create credential form with default fields', async () => {
    const { form, inputs, queryBanner } = await setup()
    expect(form).toBeInTheDocument()
    expect(inputs.kind).toBeInstanceOf(HTMLSelectElement)
    expect(inputs.description).toBeInstanceOf(HTMLInputElement)
    expect(inputs.siteConfig).toBeInstanceOf(HTMLSelectElement)
    expect(inputs.username).toBeInstanceOf(HTMLInputElement)
    expect(inputs.password).toBeInstanceOf(HTMLInputElement)
    expect(queryBanner()).toBeNull()
  })
})

describe('credential editing', () => {
  const existingCredential = {
    id: 'cred-1',
    kind: 'site_login',
    ownerUserId: null,
    description: 'Existing credential',
    site_config_id: 'sc-1',
  }
  const maskedCredentialResponse = {
    description: 'Existing credential',
    data: { username: 'alice', password: '********' },
    site_config_id: 'sc-1',
  }

  async function openEditForm() {
    const descriptionNode = await screen.findByText(existingCredential.description)
    const row = descriptionNode.closest('tr')
    if (!row) {
      throw new Error('credential row not found')
    }
    const editButton = within(row).getByRole('button', { name: 'Edit' })
    fireEvent.click(editButton)
    await waitFor(() => expect(getCredentialMock).toHaveBeenCalledWith({ credId: existingCredential.id }))
    const form = await screen.findByRole('form', { name: `Edit Credential ${existingCredential.id}` })
    return form
  }

  it('omits masked values when saving and resets state on success', async () => {
    const { mutate, unmount } = await setup({ data: { items: [existingCredential] } })

    try {
      getCredentialMock.mockResolvedValueOnce(maskedCredentialResponse)
      updateCredentialMock.mockResolvedValueOnce({})

      const editForm = await openEditForm()
      const usernameInput = within(editForm).getByLabelText('Username') as HTMLInputElement
      expect(usernameInput).toHaveValue('alice')
      const siteConfigSelect = within(editForm).getByLabelText('Site Config') as HTMLSelectElement
      expect(siteConfigSelect).toHaveValue('sc-1')

      const descriptionInput = within(editForm).getByLabelText('Description') as HTMLInputElement
      expect(descriptionInput).toHaveValue('Existing credential')

      fireEvent.change(usernameInput, { target: { value: 'bob' } })
      expect(usernameInput).toHaveValue('bob')

      fireEvent.change(descriptionInput, { target: { value: 'Updated credential' } })
      expect(descriptionInput).toHaveValue('Updated credential')

      const saveButton = within(editForm).getByRole('button', { name: 'Save' })
      fireEvent.click(saveButton)

      await waitFor(() => expect(updateCredentialMock).toHaveBeenCalledTimes(1))
      expect(updateCredentialMock).toHaveBeenCalledWith({
        credId: existingCredential.id,
        credential: {
          kind: existingCredential.kind,
          description: 'Updated credential',
          data: { username: 'bob' },
          siteConfigId: 'sc-1',
        },
      })

      const successMessage = await screen.findByText('Credential updated')
      expect(successMessage.closest('[role="status"]')).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.queryByRole('form', { name: `Edit Credential ${existingCredential.id}` })).not.toBeInTheDocument(),
      )
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    } finally {
      unmount()
    }
  })

  it('keeps the edit form open and shows an error banner when the update fails', async () => {
    const { mutate, unmount } = await setup({ data: { items: [existingCredential] } })

    try {
      getCredentialMock.mockResolvedValueOnce(maskedCredentialResponse)
      updateCredentialMock.mockRejectedValueOnce(new Error('Update failed'))

      const editForm = await openEditForm()
      const usernameInput = within(editForm).getByLabelText('Username') as HTMLInputElement
      fireEvent.change(usernameInput, { target: { value: 'bob' } })

      const descriptionInput = within(editForm).getByLabelText('Description') as HTMLInputElement
      fireEvent.change(descriptionInput, { target: { value: 'Updated credential' } })

      const saveButton = within(editForm).getByRole('button', { name: 'Save' })
      fireEvent.click(saveButton)

      await waitFor(() => expect(updateCredentialMock).toHaveBeenCalledTimes(1))
      const errorMessage = await screen.findByText('Update failed')
      expect(errorMessage.closest('[role="alert"]')).toBeInTheDocument()

      expect(screen.getByRole('form', { name: `Edit Credential ${existingCredential.id}` })).toBeInTheDocument()
      expect(mutate).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })
})

describe('credential creation form', () => {
  it('shows validation errors and prevents submission when required site login fields are empty', async () => {
    const { form, withinForm, inputs, mutate } = await setup()

    const descriptionInput = inputs.description
    const siteConfigSelect = inputs.siteConfig
    const usernameInput = inputs.username
    const passwordInput = inputs.password
    expect(descriptionInput).toBeTruthy()
    expect(siteConfigSelect).toBeTruthy()
    expect(usernameInput).toBeTruthy()
    expect(passwordInput).toBeTruthy()
    if (!descriptionInput || !siteConfigSelect || !usernameInput || !passwordInput) {
      throw new Error('site_login inputs not rendered')
    }

    fireEvent.change(usernameInput, { target: { value: 'alice' } })
    fireEvent.change(usernameInput, { target: { value: '' } })

    fireEvent.change(passwordInput, { target: { value: 'secret' } })
    fireEvent.change(passwordInput, { target: { value: '' } })

    fireEvent.submit(form)

    expect(await withinForm.findByText('Description is required')).toBeInTheDocument()
    expect(await withinForm.findByText('Username is required')).toBeInTheDocument()
    expect(await withinForm.findByText('Password is required')).toBeInTheDocument()
    fireEvent.change(descriptionInput, { target: { value: 'Filled description' } })
    fireEvent.change(usernameInput, { target: { value: 'alice' } })
    fireEvent.change(passwordInput, { target: { value: 'secret' } })
    fireEvent.submit(form)
    await waitFor(() => expect(siteConfigSelect).toHaveAttribute('aria-invalid', 'true'))
    expect(createCredentialMock).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('submits valid site login credentials and shows a success banner', async () => {
    const { withinForm, inputs, mutate } = await setup()

    createCredentialMock.mockResolvedValueOnce({})

    const descriptionInput = inputs.description
    const siteConfigSelect = inputs.siteConfig
    const usernameInput = inputs.username
    const passwordInput = inputs.password
    if (!descriptionInput || !siteConfigSelect || !usernameInput || !passwordInput) throw new Error('site_login inputs not rendered')

    fireEvent.change(descriptionInput, { target: { value: 'Site login credential' } })
    fireEvent.change(siteConfigSelect, { target: { value: 'sc-1' } })
    fireEvent.change(usernameInput, { target: { value: 'valid-user' } })
    fireEvent.change(passwordInput, { target: { value: 'correct horse battery staple' } })

    const submitButton = withinForm.getByRole('button', { name: 'Create' })
    fireEvent.click(submitButton)

    await waitFor(() => expect(createCredentialMock).toHaveBeenCalledTimes(1))
    expect(createCredentialMock).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({
        description: 'Site login credential',
        siteConfigId: 'sc-1',
        ownerUserId: 'user-123',
      }),
    }))

    const bannerMessage = await screen.findByText('Credential created')
    expect(bannerMessage.closest('[role="status"]')).toBeInTheDocument()
    await waitFor(() => expect(mutate).toHaveBeenCalled())
  })

  it('shows an error banner when the credential creation request fails', async () => {
    const { withinForm, inputs, mutate } = await setup()

    const error = new Error('Network exploded')
    createCredentialMock.mockRejectedValueOnce(error)

    const descriptionInput = inputs.description
    const siteConfigSelect = inputs.siteConfig
    const usernameInput = inputs.username
    const passwordInput = inputs.password
    if (!descriptionInput || !siteConfigSelect || !usernameInput || !passwordInput) throw new Error('site_login inputs not rendered')

    fireEvent.change(descriptionInput, { target: { value: 'Site login credential' } })
    fireEvent.change(siteConfigSelect, { target: { value: 'sc-1' } })
    fireEvent.change(usernameInput, { target: { value: 'valid-user' } })
    fireEvent.change(passwordInput, { target: { value: 'correct horse battery staple' } })

    const submitButton = withinForm.getByRole('button', { name: 'Create' })
    fireEvent.click(submitButton)

    await waitFor(() => expect(createCredentialMock).toHaveBeenCalledTimes(1))

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(error.message)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('submits instapaper login credentials via the onboarding endpoint', async () => {
    const { withinForm, inputs, mutate } = await setup()

    createInstapaperFromLoginMock.mockResolvedValueOnce({})

    const descriptionInput = inputs.description
    const kindSelect = inputs.kind
    if (!descriptionInput) throw new Error('description input not rendered')

    fireEvent.change(descriptionInput, { target: { value: 'Instapaper credential' } })
    fireEvent.change(kindSelect, { target: { value: 'instapaper' } })

    const usernameInput = withinForm.getByLabelText('Instapaper username or email') as HTMLInputElement
    const passwordInput = withinForm.getByLabelText('Instapaper password') as HTMLInputElement

    fireEvent.change(usernameInput, { target: { value: 'alice@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'correct horse battery staple' } })

    const submitButton = withinForm.getByRole('button', { name: 'Create' })
    fireEvent.click(submitButton)

      await waitFor(() => expect(createInstapaperFromLoginMock).toHaveBeenCalledTimes(1))
      expect(createInstapaperFromLoginMock).toHaveBeenCalledWith({
        description: 'Instapaper credential',
        username: 'alice@example.com',
        password: 'correct horse battery staple',
      })

    const bannerMessage = await screen.findByText('Credential created')
    expect(bannerMessage.closest('[role="status"]')).toBeInTheDocument()
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(createCredentialMock).not.toHaveBeenCalled()
  })
})
