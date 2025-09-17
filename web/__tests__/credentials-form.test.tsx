import { screen, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Credentials from '../pages/credentials'
import { renderWithSWR, makeSWRSuccess, type RenderWithSWROptions } from './helpers/renderWithSWR'

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

  const form = await screen.findByRole('form', { name: 'Create Credential' })
  const withinForm = within(form)
  const findInput = (label: string | RegExp) => withinForm.queryByLabelText(label) as HTMLInputElement | null

  const inputs: CredentialFormControls = {
    kind: withinForm.getByLabelText(/Kind/) as HTMLSelectElement,
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
