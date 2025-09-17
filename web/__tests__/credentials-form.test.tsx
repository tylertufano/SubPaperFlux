import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithSWR, makeSWRSuccess, type RenderWithSWROptions, useSWRMock } from './helpers/renderWithSWR'
import Credentials from '../pages/credentials'

const openApiSpies = vi.hoisted(() => ({
  listCredentials: vi.fn(),
  createCredential: vi.fn(),
  deleteCredential: vi.fn(),
  updateCredential: vi.fn(),
  getCredential: vi.fn(),
  testInstapaper: vi.fn(),
  testMiniflux: vi.fn(),
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
    testInstapaperV1IntegrationsInstapaperTestPost: openApiSpies.testInstapaper,
    testMinifluxV1IntegrationsMinifluxTestPost: openApiSpies.testMiniflux,
  },
  creds: {
    createCredentialCredentialsPost: openApiSpies.createCredential,
    deleteCredentialCredentialsCredIdDelete: openApiSpies.deleteCredential,
    getCredentialCredentialsCredIdGet: openApiSpies.getCredential,
    updateCredentialCredentialsCredIdPut: openApiSpies.updateCredential,
  },
}))

export const listCredentialsMock = openApiSpies.listCredentials
export const createCredentialMock = openApiSpies.createCredential
export const deleteCredentialMock = openApiSpies.deleteCredential
export const updateCredentialMock = openApiSpies.updateCredential
export const getCredentialMock = openApiSpies.getCredential
export const testInstapaperMock = openApiSpies.testInstapaper
export const testMinifluxMock = openApiSpies.testMiniflux

export const defaultCredentialsResponse = { items: [] as any[] }

export type CredentialsSetupOptions = {
  data?: any
  locale?: string
  swr?: RenderWithSWROptions['swr']
}

export type CredentialFormControls = {
  kind: HTMLSelectElement
  scopeGlobal: HTMLInputElement
  username: HTMLInputElement | null
  password: HTMLInputElement | null
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
  const { data = defaultCredentialsResponse, locale = 'en', swr } = options

  Object.values(openApiSpies).forEach((spy) => spy.mockReset())
  openApiSpies.listCredentials.mockResolvedValue(data)

  const mutate = vi.fn()
  const baseHandler = {
    matcher: (key: any) => Array.isArray(key) && key[0] === '/v1/credentials',
    value: makeSWRSuccess(data, { mutate }),
  }
  const handlers = [baseHandler, ...(swr?.handlers ?? [])]
  const swrConfig: RenderWithSWROptions['swr'] = {
    ...swr,
    handlers,
  }

  const renderResult = renderWithSWR(<Credentials />, {
    locale,
    swr: swrConfig,
  })

  const kindSelect = (await screen.findByLabelText(/Kind/)) as HTMLSelectElement
  const form = kindSelect.closest('form') as HTMLElement
  const withinForm = within(form)
  const findInput = (label: string | RegExp) => withinForm.queryByLabelText(label) as HTMLInputElement | null

  const inputs: CredentialFormControls = {
    kind: kindSelect,
    scopeGlobal: withinForm.getByRole('checkbox', { name: /Global/ }) as HTMLInputElement,
    username: findInput('Username'),
    password: findInput('Password'),
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
    expect(inputs.username).toBeInstanceOf(HTMLInputElement)
    expect(inputs.password).toBeInstanceOf(HTMLInputElement)
    expect(queryBanner()).toBeNull()
  })
})

describe('credential editing', () => {
  const existingCredential = { id: 'cred-1', kind: 'site_login', ownerUserId: null }
  const maskedCredentialResponse = { data: { username: 'alice', password: '********' } }

  async function openEditForm() {
    const idCell = await screen.findByRole('cell', { name: existingCredential.id })
    const row = idCell.closest('tr')
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

      fireEvent.change(usernameInput, { target: { value: 'bob' } })
      expect(usernameInput).toHaveValue('bob')

      const saveButton = within(editForm).getByRole('button', { name: 'Save' })
      fireEvent.click(saveButton)

      await waitFor(() => expect(updateCredentialMock).toHaveBeenCalledTimes(1))
      expect(updateCredentialMock).toHaveBeenCalledWith({
        credId: existingCredential.id,
        credential: {
          kind: existingCredential.kind,
          data: { username: 'bob' },
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

  it('keeps the dialog open and shows an error banner when the update fails', async () => {
    const { mutate, unmount } = await setup({ data: { items: [existingCredential] } })

    try {
      getCredentialMock.mockResolvedValueOnce(maskedCredentialResponse)
      updateCredentialMock.mockRejectedValueOnce(new Error('Update failed'))

      const editForm = await openEditForm()
      const usernameInput = within(editForm).getByLabelText('Username') as HTMLInputElement
      fireEvent.change(usernameInput, { target: { value: 'bob' } })

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

    const usernameInput = inputs.username
    const passwordInput = inputs.password
    expect(usernameInput).toBeTruthy()
    expect(passwordInput).toBeTruthy()
    if (!usernameInput || !passwordInput) throw new Error('site_login inputs not rendered')

    fireEvent.change(usernameInput, { target: { value: 'alice' } })
    fireEvent.change(usernameInput, { target: { value: '' } })

    fireEvent.change(passwordInput, { target: { value: 'secret' } })
    fireEvent.change(passwordInput, { target: { value: '' } })

    fireEvent.submit(form)

    expect(await withinForm.findByText('Username is required')).toBeInTheDocument()
    expect(await withinForm.findByText('Password is required')).toBeInTheDocument()
    expect(createCredentialMock).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('submits valid site login credentials and shows a success banner', async () => {
    const { withinForm, inputs, mutate } = await setup()

    createCredentialMock.mockResolvedValueOnce({})

    const swrState = useSWRMock.mock.results.at(-1)?.value as { mutate?: ReturnType<typeof vi.fn> }
    expect(swrState?.mutate).toBe(mutate)

    const usernameInput = inputs.username
    const passwordInput = inputs.password
    if (!usernameInput || !passwordInput) throw new Error('site_login inputs not rendered')

    fireEvent.change(usernameInput, { target: { value: 'valid-user' } })
    fireEvent.change(passwordInput, { target: { value: 'correct horse battery staple' } })

    const submitButton = withinForm.getByRole('button', { name: 'Create' })
    fireEvent.click(submitButton)

    await waitFor(() => expect(createCredentialMock).toHaveBeenCalledTimes(1))

    const bannerMessage = await screen.findByText('Credential created')
    expect(bannerMessage.closest('[role="status"]')).toBeInTheDocument()
    await waitFor(() => expect(mutate).toHaveBeenCalled())
  })

  it('shows an error banner when the credential creation request fails', async () => {
    const { withinForm, inputs, mutate } = await setup()

    const error = new Error('Network exploded')
    createCredentialMock.mockRejectedValueOnce(error)

    const usernameInput = inputs.username
    const passwordInput = inputs.password
    if (!usernameInput || !passwordInput) throw new Error('site_login inputs not rendered')

    fireEvent.change(usernameInput, { target: { value: 'valid-user' } })
    fireEvent.change(passwordInput, { target: { value: 'correct horse battery staple' } })

    const submitButton = withinForm.getByRole('button', { name: 'Create' })
    fireEvent.click(submitButton)

    await waitFor(() => expect(createCredentialMock).toHaveBeenCalledTimes(1))

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(error.message)
    expect(mutate).not.toHaveBeenCalled()
  })
})
