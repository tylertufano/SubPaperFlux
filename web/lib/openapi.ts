import { Configuration, Middleware, ResponseError, FetchError } from '../sdk/src/runtime'
import { V1Api } from '../sdk/src/apis/V1Api'
import { AdminApi } from '../sdk/src/apis/AdminApi'
import { BookmarksApi } from '../sdk/src/apis/BookmarksApi'
import { CredentialsApi } from '../sdk/src/apis/CredentialsApi'
import { SiteConfigsApi } from '../sdk/src/apis/SiteConfigsApi'
import { FeedsApi } from '../sdk/src/apis/FeedsApi'
import type { Credential } from '../sdk/src/models/Credential'
import type { SiteConfigOut } from '../sdk/src/models/SiteConfigOut'
import type { ResponseCopySiteConfigV1V1SiteConfigsConfigIdCopyPost } from '../sdk/src/models/ResponseCopySiteConfigV1V1SiteConfigsConfigIdCopyPost'
import type { Body as SiteConfigRequest } from '../sdk/src/models/Body'
import type { JobScheduleCreate } from '../sdk/src/models/JobScheduleCreate'
import type { JobScheduleUpdate } from '../sdk/src/models/JobScheduleUpdate'
import { auth, signIn } from '../auth'
import type { Session } from 'next-auth'
import { getSession } from 'next-auth/react'

export type UiConfig = {
  apiBase: string
  userMgmtCore: boolean
  userMgmtUi: boolean
}

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function parseEnvBoolean(value?: string | null): boolean {
  if (value == null) return true
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) return true
  return TRUTHY_ENV_VALUES.has(normalized)
}

const BUILD_API_BASE = process.env.NEXT_PUBLIC_API_BASE || ''
const BUILD_USER_MGMT_CORE = parseEnvBoolean(process.env.NEXT_PUBLIC_USER_MGMT_CORE)
const BUILD_USER_MGMT_UI = parseEnvBoolean(process.env.NEXT_PUBLIC_USER_MGMT_UI)
const CSRF = process.env.NEXT_PUBLIC_CSRF_TOKEN || '1'
export const OIDC_ACCESS_TOKEN_HEADER = 'X-OIDC-Access-Token'

type UiConfigWindow = Window & {
  __SPF_UI_CONFIG?: UiConfig
  __SPF_API_BASE?: string
}

let uiConfigPromise: Promise<UiConfig> | null = null

// Warn at runtime if we are on HTTPS but API base is insecure HTTP
if (typeof window !== 'undefined') {
  try {
    if (window.location.protocol === 'https:' && BUILD_API_BASE && BUILD_API_BASE.startsWith('http://')) {
      // eslint-disable-next-line no-console
      console.warn('[SubPaperFlux] Insecure NEXT_PUBLIC_API_BASE over HTTPS page:', BUILD_API_BASE)
    }
  } catch {}
}

export function readUiConfigFromEnv(): UiConfig {
  return {
    apiBase: process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || '',
    userMgmtCore: parseEnvBoolean(process.env.USER_MGMT_CORE),
    userMgmtUi: parseEnvBoolean(process.env.USER_MGMT_UI ?? process.env.NEXT_PUBLIC_USER_MGMT_UI),
  }
}

const BUILD_UI_CONFIG: UiConfig = {
  apiBase: BUILD_API_BASE,
  userMgmtCore: BUILD_USER_MGMT_CORE,
  userMgmtUi: BUILD_USER_MGMT_UI,
}

function normalizeUiConfig(candidate: unknown, fallback: UiConfig): UiConfig {
  if (!candidate || typeof candidate !== 'object') {
    return { ...fallback }
  }
  const value = candidate as Partial<Record<keyof UiConfig, unknown>>
  return {
    apiBase: typeof value.apiBase === 'string' ? value.apiBase : fallback.apiBase,
    userMgmtCore: typeof value.userMgmtCore === 'boolean' ? value.userMgmtCore : fallback.userMgmtCore,
    userMgmtUi: typeof value.userMgmtUi === 'boolean' ? value.userMgmtUi : fallback.userMgmtUi,
  }
}

function storeUiConfig(config: UiConfig) {
  if (typeof window === 'undefined') return
  const w = window as UiConfigWindow
  const copy: UiConfig = { ...config }
  w.__SPF_UI_CONFIG = copy
  w.__SPF_API_BASE = copy.apiBase
}

export async function getUiConfig(): Promise<UiConfig> {
  if (typeof window === 'undefined') {
    return readUiConfigFromEnv()
  }
  const w = window as UiConfigWindow
  if (w.__SPF_UI_CONFIG) {
    return w.__SPF_UI_CONFIG
  }
  if (!uiConfigPromise) {
    const fallback = { ...BUILD_UI_CONFIG }
    uiConfigPromise = (async () => {
      try {
        const res = await fetch('/ui-config')
        if (res.ok) {
          const data = await res.json()
          const normalized = normalizeUiConfig(data, fallback)
          storeUiConfig(normalized)
          return normalized
        }
      } catch {}
      storeUiConfig(fallback)
      return fallback
    })()
    uiConfigPromise.finally(() => {
      uiConfigPromise = null
    })
  }
  return uiConfigPromise
}

let clientsPromise: Promise<{
  v1: V1Api
  admin: AdminApi
  bookmarks: BookmarksApi
  creds: CredentialsApi
  sites: SiteConfigsApi
  feeds: FeedsApi
}> | null = null

type AuthorizedRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string | undefined>
  errorMessage?: string
  expectJson?: boolean
}

async function resolveApiBase(): Promise<string> {
  const config = await getUiConfig()
  return config.apiBase
}

export class AuthorizationRedirectError extends Error {
  constructor(message = 'Authentication required. Redirecting to sign-in.') {
    super(message)
    this.name = 'AuthorizationRedirectError'
  }
}

function resolveCallbackUrl(): string {
  if (typeof window !== 'undefined' && window?.location?.href) {
    return window.location.href
  }
  if (typeof process !== 'undefined') {
    const fromEnv = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (fromEnv && fromEnv.length > 0) {
      return fromEnv
    }
  }
  return '/'
}

async function triggerOidcRedirect(): Promise<never> {
  const callbackUrl = resolveCallbackUrl()
  try {
    await signIn('oidc', { callbackUrl, redirect: true })
  } catch (error) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Failed to initiate OIDC sign-in after 401 response.', error)
    }
    throw new AuthorizationRedirectError('Authentication failed and redirect could not be initiated.')
  }
  throw new AuthorizationRedirectError('Authentication required. Redirecting to sign-in.')
}

async function loadSession(): Promise<Session | null> {
  if (typeof window === 'undefined') {
    return auth()
  }
  return getSession()
}

function resolveSessionToken(session: Session | null | undefined): string | undefined {
  if (!session) return undefined
  if (typeof session.idToken === 'string' && session.idToken.length > 0) {
    return session.idToken
  }
  if (typeof session.accessToken === 'string' && session.accessToken.length > 0) {
    return session.accessToken
  }
  return undefined
}

function resolveSessionAccessToken(session: Session | null | undefined): string | undefined {
  if (!session) return undefined
  if (typeof session.accessToken === 'string' && session.accessToken.length > 0) {
    return session.accessToken
  }
  return undefined
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  if (Array.isArray(headers)) {
    const result: Record<string, string> = {}
    for (const [key, value] of headers) {
      if (typeof value === 'undefined') continue
      result[key] = String(value)
    }
    return result
  }
  return { ...(headers as Record<string, string>) }
}

function applyAccessTokenHeader(
  headers: Record<string, string>,
  accessToken: string | undefined,
): Record<string, string> {
  if (accessToken) {
    headers[OIDC_ACCESS_TOKEN_HEADER] = accessToken
  } else {
    delete headers[OIDC_ACCESS_TOKEN_HEADER]
  }
  return headers
}

async function getClients() {
  if (!clientsPromise) {
    clientsPromise = (async () => {
      const basePath = await resolveApiBase()
      const retry: Middleware = {
        post: async ({ response, url, init }) => {
          // Pass through successful responses
          if (response.status < 500 && response.status !== 429) return undefined
          // Retry on 429/503/504 and 5xx
          const shouldRetry = response.status === 429 || response.status === 503 || response.status === 504 || (response.status >= 500)
          if (!shouldRetry) return undefined
          const max = 2
          for (let attempt = 1; attempt <= max; attempt++) {
            const retryAfter = response.headers.get('retry-after')
            const base = retryAfter ? (parseInt(retryAfter, 10) * 1000 || 0) : 300
            const delay = base * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
            await new Promise(r => setTimeout(r, delay))
            try {
              const next = await fetch(url, init)
              if (next.ok) return next
              if (attempt === max) return next
            } catch {
              if (attempt === max) return response
            }
          }
          return undefined
        },
        onError: async ({ url, init }) => {
          const max = 2
          for (let attempt = 1; attempt <= max; attempt++) {
            const delay = 300 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
            await new Promise(r => setTimeout(r, delay))
            try {
              const next = await fetch(url, init)
              if (next.ok) return next
            } catch {
              // continue
            }
          }
          return undefined
        }
      }
      const attachAccessToken: Middleware = {
        pre: async context => {
          try {
            const session = await loadSession()
            const accessToken = resolveSessionAccessToken(session)
            const headers = normalizeHeaders(context.init.headers as HeadersInit | undefined)
            applyAccessTokenHeader(headers, accessToken)
            return { url: context.url, init: { ...context.init, headers } }
          } catch (error) {
            // If session resolution fails, continue without modifying headers
            return undefined
          }
        },
      }
      const cfg = new Configuration({
        basePath,
        accessToken: async () => {
          const session = await loadSession()
          const token = resolveSessionToken(session)
          return token ?? ''
        },
        headers: { 'X-CSRF-Token': CSRF, 'x-csrf-token': CSRF },
        middleware: [retry, attachAccessToken],
      })
      return {
        v1: new V1Api(cfg),
        admin: new AdminApi(cfg),
        bookmarks: new BookmarksApi(cfg),
        creds: new CredentialsApi(cfg),
        sites: new SiteConfigsApi(cfg),
        feeds: new FeedsApi(cfg),
      }
    })()
  }
  return clientsPromise
}

async function authorizedRequest<T = any>(path: string, options: AuthorizedRequestOptions = {}): Promise<T> {
  const { errorMessage, expectJson, headers: overrideHeaders, ...rest } = options
  const basePath = await resolveApiBase()
  const session = await loadSession()
  const token = resolveSessionToken(session)
  const accessToken = resolveSessionAccessToken(session)
  const headers: Record<string, string> = {
    'X-CSRF-Token': CSRF,
  }
  if (overrideHeaders) {
    for (const [key, value] of Object.entries(overrideHeaders)) {
      if (value !== undefined) {
        headers[key] = value
      }
    }
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  applyAccessTokenHeader(headers, accessToken)

  const normalizedBase = basePath ? basePath.replace(/\/$/, '') : ''
  const response = await fetch(`${normalizedBase}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  })

  if (response.status === 401) {
    return triggerOidcRedirect()
  }

  if (!response.ok) {
    const message = (await response.text())?.trim()
    throw new Error(message || errorMessage || `Request failed (${response.status})`)
  }

  if (expectJson === false || response.status === 204) {
    return null as T
  }

  return response.json() as Promise<T>
}

export type InstapaperOnboardingRequest = {
  description: string
  username: string
  password: string
  scope_global?: boolean
}

export async function createInstapaperCredentialFromLogin(payload: InstapaperOnboardingRequest) {
  return authorizedRequest('/credentials/instapaper/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export type AuditLogEntry = {
  id: string
  entity_type: string
  entity_id: string
  action: string
  owner_user_id?: string | null
  actor_user_id?: string | null
  details?: Record<string, any>
  created_at: string
}

export type AuditLogsPage = {
  items: AuditLogEntry[]
  total: number
  page: number
  size: number
  has_next?: boolean
  total_pages?: number
}

type AuditLogQuery = {
  page?: number
  size?: number
  entityType?: string
  entityId?: string
  action?: string
  ownerUserId?: string
  actorUserId?: string
  since?: string
  until?: string
}

export type AdminUserOrganization = {
  id: string
  slug: string
  name: string
  description?: string | null
  is_default?: boolean
  joined_at: string
}

export type AdminUserOrganizationMembership = {
  organization_id: string
  organization_slug: string
  organization_name: string
  organization_description?: string | null
  organization_is_default?: boolean
  joined_at: string
}

export type AdminUser = {
  id: string
  email?: string | null
  full_name?: string | null
  picture_url?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  last_login_at?: string | null
  groups: string[]
  roles: string[]
  is_admin: boolean
  quota_credentials?: number | null
  quota_site_configs?: number | null
  quota_feeds?: number | null
  quota_api_tokens?: number | null
  role_overrides: AdminUserRoleOverrides
  organization_ids: string[]
  organization_memberships: AdminUserOrganizationMembership[]
  organizations: AdminUserOrganization[]
}

export type AdminUserRoleOverrides = {
  enabled: boolean
  preserve: string[]
  suppress: string[]
}

export type AdminUsersPage = {
  items: AdminUser[]
  total: number
  page: number
  size: number
  has_next?: boolean
  total_pages?: number
}

type AdminUsersQuery = {
  page?: number
  size?: number
  search?: string
  isActive?: boolean
  role?: string
  organization_id?: string
}

type AdminUserUpdatePayload = {
  is_active?: boolean
  confirm?: boolean
  quota_credentials?: number | null
  quota_site_configs?: number | null
  quota_feeds?: number | null
  quota_api_tokens?: number | null
}

type AdminUserRoleOverridesUpdatePayload = {
  enabled?: boolean
  preserve?: string[]
  suppress?: string[]
}

export type AdminOrganizationMember = {
  id: string
  email?: string | null
  full_name?: string | null
  is_active?: boolean | null
  joined_at: string
}

export type AdminOrganization = {
  id: string
  slug: string
  name: string
  description?: string | null
  is_default?: boolean
  created_at: string
  updated_at: string
  member_count?: number
}

export type AdminOrganizationDetail = AdminOrganization & {
  members: AdminOrganizationMember[]
}

export type AdminOrganizationsPage = {
  items: AdminOrganization[]
  total: number
  page: number
  size: number
  has_next?: boolean
  total_pages?: number
}

type AdminOrganizationsQuery = {
  page?: number
  size?: number
  search?: string
  is_default?: boolean
}

export type SiteWelcomeContent = {
  headline?: string | null
  subheadline?: string | null
  body?: string | null
  cta_text?: string | null
  cta_url?: string | null
  [key: string]: unknown
}

export type SiteWelcomeSettingOut = {
  key: string
  value: SiteWelcomeContent
  created_at?: string | null
  updated_at?: string | null
  updated_by_user_id?: string | null
}

export type SiteWelcomeSettingUpdate = {
  headline?: string | null
  subheadline?: string | null
  body?: string | null
  cta_text?: string | null
  cta_url?: string | null
  [key: string]: unknown
}

export type AdminOrganizationCreatePayload = {
  slug: string
  name: string
  description?: string | null
  is_default?: boolean | null
}

export type AdminOrganizationUpdatePayload = {
  slug?: string | null
  name?: string | null
  description?: string | null
  is_default?: boolean | null
}

export type AdminOrganizationMembershipChangePayload = {
  user_id: string
}

export type RoleGrantRequest = {
  description?: string | null
  create_missing?: boolean
  is_system?: boolean | null
}

export type AdminRoleListItem = {
  id: string
  name: string
  description?: string | null
  is_system?: boolean
  created_at: string
  updated_at: string
  assigned_user_count?: number
}

export type AdminRoleDetail = AdminRoleListItem & {
  metadata?: Record<string, any>
}

export type AdminRolesPage = {
  items: AdminRoleListItem[]
  total: number
  page: number
  size: number
  has_next?: boolean
  total_pages?: number
}

type AdminRolesQuery = {
  page?: number
  size?: number
  search?: string
}

export type AdminRoleCreatePayload = {
  name: string
  description?: string | null
  is_system?: boolean | null
}

export type AdminRoleUpdatePayload = {
  name?: string | null
  description?: string | null
}

export type ApiToken = {
  id: string
  name: string
  description?: string | null
  scopes: string[]
  created_at: string
  updated_at: string
  last_used_at?: string | null
  expires_at?: string | null
  revoked_at?: string | null
}

export type ApiTokenWithSecret = ApiToken & { token: string }

export type ApiTokensPage = {
  items: ApiToken[]
  total: number
  page: number
  size: number
  has_next?: boolean
  total_pages?: number
}

type ApiTokensQuery = {
  page?: number
  size?: number
  include_revoked?: boolean
}

export type ApiTokenCreate = {
  name: string
  description?: string | null
  scopes?: string[]
  expires_at?: string | null
}

export type MeNotificationPreferences = {
  email_job_updates: boolean
  email_digest: boolean
}

export type MeProfile = {
  id: string
  email?: string | null
  full_name?: string | null
  picture_url?: string | null
  locale?: string | null
  notification_preferences: MeNotificationPreferences
}

export type MeUpdatePayload = {
  locale?: string | null
  notification_preferences?: Partial<MeNotificationPreferences>
}

async function listAuditLogs(params: AuditLogQuery = {}): Promise<AuditLogsPage> {
  const query = new URLSearchParams()
  if (params.page !== undefined) query.set('page', String(params.page))
  if (params.size !== undefined) query.set('size', String(params.size))
  if (params.entityType) query.set('entity_type', params.entityType)
  if (params.entityId) query.set('entity_id', params.entityId)
  if (params.action) query.set('action', params.action)
  if (params.ownerUserId) query.set('owner_user_id', params.ownerUserId)
  if (params.actorUserId) query.set('actor_user_id', params.actorUserId)
  if (params.since) query.set('since', params.since)
  if (params.until) query.set('until', params.until)

  const search = query.toString()
  return authorizedRequest<AuditLogsPage>(`/v1/admin/audit${search ? `?${search}` : ''}`, {
    errorMessage: 'Failed to load audit logs',
  })
}

async function listAdminUsers(params: AdminUsersQuery = {}): Promise<AdminUsersPage> {
  const query = new URLSearchParams()
  if (params.page !== undefined) query.set('page', String(params.page))
  if (params.size !== undefined) query.set('size', String(params.size))
  if (params.search) query.set('search', params.search)
  if (params.role) query.set('role', params.role)
  if (params.organization_id) query.set('organization_id', params.organization_id)
  if (params.isActive !== undefined) query.set('is_active', String(params.isActive))

  const search = query.toString()
  return authorizedRequest<AdminUsersPage>(`/v1/admin/users${search ? `?${search}` : ''}`, {
    errorMessage: 'Failed to load users',
  })
}

async function getAdminUser(userId: string): Promise<AdminUser> {
  return authorizedRequest<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}`, {
    errorMessage: 'Failed to load user',
  })
}

async function updateAdminUser(userId: string, payload: AdminUserUpdatePayload): Promise<AdminUser> {
  return authorizedRequest<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    errorMessage: 'Failed to update user',
  })
}

async function updateAdminUserRoleOverrides(
  userId: string,
  payload: AdminUserRoleOverridesUpdatePayload,
): Promise<AdminUser> {
  return authorizedRequest<AdminUser>(
    `/v1/admin/users/${encodeURIComponent(userId)}/role-overrides`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      errorMessage: 'Failed to update role overrides',
    },
  )
}

async function clearAdminUserRoleOverrides(userId: string): Promise<AdminUser> {
  return authorizedRequest<AdminUser>(
    `/v1/admin/users/${encodeURIComponent(userId)}/role-overrides`,
    {
      method: 'DELETE',
      errorMessage: 'Failed to clear role overrides',
    },
  )
}

async function grantAdminUserRole(
  userId: string,
  roleName: string,
  payload?: RoleGrantRequest,
): Promise<AdminUser> {
  return authorizedRequest<AdminUser>(
    `/v1/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleName)}`,
    {
      method: 'POST',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      errorMessage: 'Failed to grant role',
    },
  )
}

async function revokeAdminUserRole(userId: string, roleName: string, confirm = false): Promise<void> {
  const query = confirm ? '?confirm=true' : ''
  await authorizedRequest(`/v1/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleName)}${query}`, {
    method: 'DELETE',
    expectJson: false,
    errorMessage: 'Failed to revoke role',
  })
}

async function listAdminOrganizations(params: AdminOrganizationsQuery = {}): Promise<AdminOrganizationsPage> {
  const query = new URLSearchParams()
  if (params.page !== undefined) query.set('page', String(params.page))
  if (params.size !== undefined) query.set('size', String(params.size))
  if (params.search) query.set('search', params.search)
  if (params.is_default !== undefined) query.set('is_default', String(params.is_default))

  const search = query.toString()
  return authorizedRequest<AdminOrganizationsPage>(`/v1/admin/orgs${search ? `?${search}` : ''}`, {
    errorMessage: 'Failed to load organizations',
  })
}

async function fetchAdminOrganization(organizationId: string): Promise<AdminOrganizationDetail> {
  return authorizedRequest<AdminOrganizationDetail>(`/v1/admin/orgs/${encodeURIComponent(organizationId)}`, {
    errorMessage: 'Failed to load organization',
  })
}

async function createAdminOrganizationRequest(
  payload: AdminOrganizationCreatePayload,
): Promise<AdminOrganizationDetail> {
  return authorizedRequest<AdminOrganizationDetail>('/v1/admin/orgs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    errorMessage: 'Failed to create organization',
  })
}

async function updateAdminOrganizationRequest(
  organizationId: string,
  payload: AdminOrganizationUpdatePayload,
): Promise<AdminOrganizationDetail> {
  return authorizedRequest<AdminOrganizationDetail>(`/v1/admin/orgs/${encodeURIComponent(organizationId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    errorMessage: 'Failed to update organization',
  })
}

async function deleteAdminOrganizationRequest(organizationId: string): Promise<void> {
  await authorizedRequest(`/v1/admin/orgs/${encodeURIComponent(organizationId)}`, {
    method: 'DELETE',
    expectJson: false,
    errorMessage: 'Failed to delete organization',
  })
}

async function addAdminOrganizationMemberRequest(
  organizationId: string,
  payload: AdminOrganizationMembershipChangePayload,
): Promise<AdminOrganizationDetail> {
  return authorizedRequest<AdminOrganizationDetail>(
    `/v1/admin/orgs/${encodeURIComponent(organizationId)}/members`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      errorMessage: 'Failed to add member',
    },
  )
}

async function removeAdminOrganizationMemberRequest(
  organizationId: string,
  userId: string,
): Promise<AdminOrganizationDetail> {
  return authorizedRequest<AdminOrganizationDetail>(
    `/v1/admin/orgs/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      errorMessage: 'Failed to remove member',
    },
  )
}

async function requestSiteWelcomeSetting(authenticated: boolean): Promise<SiteWelcomeSettingOut> {
  if (authenticated) {
    return authorizedRequest<SiteWelcomeSettingOut>('/v1/site-settings/welcome', {
      errorMessage: 'Failed to load welcome message',
    })
  }

  const basePath = await resolveApiBase()
  const normalizedBase = basePath ? basePath.replace(/\/$/, '') : ''

  try {
    const response = await fetch(`${normalizedBase}/v1/site-settings/welcome`, {
      method: 'GET',
      headers: { 'X-CSRF-Token': CSRF },
      credentials: 'include',
    })

    if (!response.ok) {
      const message = (await response.text())?.trim()
      throw new Error(message || 'Failed to load welcome message')
    }

    return (await response.json()) as SiteWelcomeSettingOut
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message || 'Failed to load welcome message')
  }
}

async function fetchSiteWelcomeSetting(): Promise<SiteWelcomeSettingOut> {
  return requestSiteWelcomeSetting(true)
}

async function fetchPublicSiteWelcomeSetting(): Promise<SiteWelcomeSettingOut> {
  return requestSiteWelcomeSetting(false)
}

async function updateSiteWelcomeSettingRequest(
  payload: SiteWelcomeSettingUpdate,
): Promise<SiteWelcomeSettingOut> {
  return authorizedRequest<SiteWelcomeSettingOut>('/v1/site-settings/welcome', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    errorMessage: 'Failed to update welcome message',
  })
}

async function fetchAdminRoles(params: AdminRolesQuery = {}): Promise<AdminRolesPage> {
  const query = new URLSearchParams()
  if (params.page !== undefined) query.set('page', String(params.page))
  if (params.size !== undefined) query.set('size', String(params.size))
  if (params.search) query.set('search', params.search)

  const search = query.toString()
  return authorizedRequest<AdminRolesPage>(`/v1/admin/roles${search ? `?${search}` : ''}`, {
    errorMessage: 'Failed to load roles',
  })
}

async function createAdminRoleRequest(payload: AdminRoleCreatePayload): Promise<AdminRoleDetail> {
  return authorizedRequest<AdminRoleDetail>('/v1/admin/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    errorMessage: 'Failed to create role',
  })
}

async function updateAdminRoleRequest(
  roleId: string,
  payload: AdminRoleUpdatePayload,
): Promise<AdminRoleDetail> {
  return authorizedRequest<AdminRoleDetail>(`/v1/admin/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    errorMessage: 'Failed to update role',
  })
}

async function deleteAdminRoleRequest(roleId: string): Promise<void> {
  await authorizedRequest(`/v1/admin/roles/${encodeURIComponent(roleId)}`, {
    method: 'DELETE',
    expectJson: false,
    errorMessage: 'Failed to delete role',
  })
}

async function fetchAdminRoleDetail(roleId: string): Promise<AdminRoleDetail> {
  return authorizedRequest<AdminRoleDetail>(`/v1/admin/roles/${encodeURIComponent(roleId)}`, {
    errorMessage: 'Failed to load role',
  })
}

async function listApiTokens(params: ApiTokensQuery = {}): Promise<ApiTokensPage> {
  const query = new URLSearchParams()
  if (params.page !== undefined) query.set('page', String(params.page))
  if (params.size !== undefined) query.set('size', String(params.size))
  if (params.include_revoked !== undefined) query.set('include_revoked', String(params.include_revoked))

  const search = query.toString()
  return authorizedRequest<ApiTokensPage>(`/v1/me/tokens${search ? `?${search}` : ''}`, {
    errorMessage: 'Failed to load tokens',
  })
}

async function createApiToken(payload: ApiTokenCreate): Promise<ApiTokenWithSecret> {
  return authorizedRequest<ApiTokenWithSecret>('/v1/me/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    errorMessage: 'Failed to create token',
  })
}

async function revokeApiToken(tokenId: string): Promise<void> {
  await authorizedRequest(`/v1/me/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    expectJson: false,
    errorMessage: 'Failed to revoke token',
  })
}

async function getMeProfile(): Promise<MeProfile> {
  return authorizedRequest<MeProfile>('/v1/me', {
    errorMessage: 'Failed to load profile',
  })
}

async function updateMeProfile(payload: MeUpdatePayload): Promise<MeProfile> {
  return authorizedRequest<MeProfile>('/v1/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    errorMessage: 'Failed to update profile',
  })
}

export async function bulkPublishBookmarksStream({ requestBody, signal }: { requestBody: any; signal?: AbortSignal }) {
  const basePath = await resolveApiBase()
  const session = await loadSession()
  const token = resolveSessionToken(session)
  const accessToken = resolveSessionAccessToken(session)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': CSRF,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  if (accessToken) {
    headers[OIDC_ACCESS_TOKEN_HEADER] = accessToken
  }
  const normalizedBase = basePath ? basePath.replace(/\/$/, '') : ''
  return fetch(`${normalizedBase}/v1/bookmarks/bulk-publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody ?? {}),
    signal,
    credentials: 'include',
  })
}

export const v1 = {
  listBookmarksV1BookmarksGet: async (p: any = {}) => (await getClients()).bookmarks.listBookmarksBookmarksGet(p),
  bulkDeleteBookmarksV1BookmarksBulkDeletePost: async ({ requestBody }: { requestBody: any }) => (await getClients()).bookmarks.bulkDeleteBookmarksV1BookmarksBulkDeletePost({ requestBody, xCsrfToken: CSRF }),
  countBookmarksV1BookmarksCountGet: async (p: any = {}) => (await getClients()).bookmarks.countBookmarksV1BookmarksCountGet(p),
  listTagsBookmarksTagsGet: async () => (await getClients()).bookmarks.listTagsBookmarksTagsGet(),
  createTagBookmarksTagsPost: async ({ tagCreate }: { tagCreate: any }) => (await getClients()).bookmarks.createTagBookmarksTagsPost({ tagCreate, xCsrfToken: CSRF }),
  updateTagBookmarksTagsTagIdPut: async ({ tagId, tagUpdate }: { tagId: string; tagUpdate: any }) => (await getClients()).bookmarks.updateTagBookmarksTagsTagIdPut({ tagId, tagUpdate, xCsrfToken: CSRF }),
  deleteTagBookmarksTagsTagIdDelete: async ({ tagId }: { tagId: string }) => (await getClients()).bookmarks.deleteTagBookmarksTagsTagIdDelete({ tagId, xCsrfToken: CSRF }),
  getBookmarkTagsBookmarksBookmarkIdTagsGet: async ({ bookmarkId }: { bookmarkId: string }) => (await getClients()).bookmarks.getBookmarkTagsBookmarksBookmarkIdTagsGet({ bookmarkId }),
  updateBookmarkTagsBookmarksBookmarkIdTagsPut: async ({ bookmarkId, bookmarkTagsUpdate }: { bookmarkId: string; bookmarkTagsUpdate: any }) =>
    (await getClients()).bookmarks.updateBookmarkTagsBookmarksBookmarkIdTagsPut({ bookmarkId, bookmarkTagsUpdate, xCsrfToken: CSRF }),
  bulkUpdateBookmarkTagsBookmarksBulkTagsPost: async ({ bulkBookmarkTagUpdate }: { bulkBookmarkTagUpdate: any }) =>
    (await getClients()).bookmarks.bulkUpdateBookmarkTagsBookmarksBulkTagsPost({ bulkBookmarkTagUpdate, xCsrfToken: CSRF }),
  bulkUpdateBookmarkTagsV1BookmarksBulkTagsPost: async ({ bulkBookmarkTagUpdate }: { bulkBookmarkTagUpdate: any }) =>
    (await getClients()).bookmarks.bulkUpdateBookmarkTagsV1BookmarksBulkTagsPost({ bulkBookmarkTagUpdate, xCsrfToken: CSRF }),
  bulkUpdateBookmarkFoldersBookmarksBulkFoldersPost: async ({
    bulkBookmarkFolderUpdate,
  }: {
    bulkBookmarkFolderUpdate: any
  }) =>
    (await getClients()).bookmarks.bulkUpdateBookmarkFoldersBookmarksBulkFoldersPost({
      bulkBookmarkFolderUpdate,
      xCsrfToken: CSRF,
    }),
  bulkUpdateBookmarkFoldersV1BookmarksBulkFoldersPost: async ({
    bulkBookmarkFolderUpdate,
  }: {
    bulkBookmarkFolderUpdate: any
  }) =>
    (await getClients()).bookmarks.bulkUpdateBookmarkFoldersV1BookmarksBulkFoldersPost({
      bulkBookmarkFolderUpdate,
      xCsrfToken: CSRF,
    }),
  listFoldersBookmarksFoldersGet: async () => (await getClients()).bookmarks.listFoldersBookmarksFoldersGet(),
  createFolderBookmarksFoldersPost: async ({ folderCreate }: { folderCreate: any }) => (await getClients()).bookmarks.createFolderBookmarksFoldersPost({ folderCreate, xCsrfToken: CSRF }),
  updateFolderBookmarksFoldersFolderIdPut: async ({ folderId, folderUpdate }: { folderId: string; folderUpdate: any }) =>
    (await getClients()).bookmarks.updateFolderBookmarksFoldersFolderIdPut({ folderId, folderUpdate, xCsrfToken: CSRF }),
  deleteFolderBookmarksFoldersFolderIdDelete: async ({ folderId }: { folderId: string }) =>
    (await getClients()).bookmarks.deleteFolderBookmarksFoldersFolderIdDelete({ folderId, xCsrfToken: CSRF }),
  getBookmarkFolderBookmarksBookmarkIdFolderGet: async ({ bookmarkId }: { bookmarkId: string }) => (await getClients()).bookmarks.getBookmarkFolderBookmarksBookmarkIdFolderGet({ bookmarkId }),
  updateBookmarkFolderBookmarksBookmarkIdFolderPut: async ({ bookmarkId, bookmarkFolderUpdate }: { bookmarkId: string; bookmarkFolderUpdate: any }) =>
    (await getClients()).bookmarks.updateBookmarkFolderBookmarksBookmarkIdFolderPut({ bookmarkId, bookmarkFolderUpdate, xCsrfToken: CSRF }),
  deleteBookmarkFolderBookmarksBookmarkIdFolderDelete: async ({ bookmarkId }: { bookmarkId: string }) =>
    (await getClients()).bookmarks.deleteBookmarkFolderBookmarksBookmarkIdFolderDelete({ bookmarkId, xCsrfToken: CSRF }),
  previewBookmarkV1BookmarksBookmarkIdPreviewGet: async ({ bookmarkId }: { bookmarkId: string }) => {
    const basePath = await resolveApiBase()
    const session = await loadSession()
    const headers: Record<string, string> = {
      'X-CSRF-Token': CSRF,
    }
    const token = resolveSessionToken(session)
    const accessToken = resolveSessionAccessToken(session)
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    if (accessToken) {
      headers[OIDC_ACCESS_TOKEN_HEADER] = accessToken
    }
    const res = await fetch(`${basePath}/v1/bookmarks/${encodeURIComponent(bookmarkId)}/preview`, {
      method: 'GET',
      headers,
      credentials: 'include',
    })
    if (res.status === 404) {
      return ''
    }
    if (!res.ok) {
      const message = (await res.text())?.trim()
      throw new Error(message || `Failed to load preview (${res.status})`)
    }
    return res.text()
  },

  listFeedsV1V1FeedsGet: async (p: any = {}) => (await getClients()).v1.listFeedsV1V1FeedsGet(p),
  listCredentialsV1V1CredentialsGet: async (p: any = {}) => (await getClients()).v1.listCredentialsV1V1CredentialsGet(p),
  listSiteConfigsV1V1SiteConfigsGet: async (p: any = {}) => (await getClients()).v1.listSiteConfigsV1V1SiteConfigsGet(p),
  listJobSchedulesV1JobSchedulesGet: async (p: any = {}) => (await getClients()).v1.listJobSchedulesV1JobSchedulesGet(p),
  createJobScheduleV1JobSchedulesPost: async ({
    jobScheduleCreate,
  }: {
    jobScheduleCreate: JobScheduleCreate
  }) => (await getClients()).v1.createJobScheduleV1JobSchedulesPost({ jobScheduleCreate }),
  getJobScheduleV1JobSchedulesScheduleIdGet: async ({
    scheduleId,
  }: {
    scheduleId: string
  }) => (await getClients()).v1.getJobScheduleV1JobSchedulesScheduleIdGet({ scheduleId }),
  updateJobScheduleV1JobSchedulesScheduleIdPatch: async ({
    scheduleId,
    jobScheduleUpdate,
  }: {
    scheduleId: string
    jobScheduleUpdate: JobScheduleUpdate
  }) =>
    (await getClients()).v1.updateJobScheduleV1JobSchedulesScheduleIdPatch({
      scheduleId,
      jobScheduleUpdate,
    }),
  deleteJobScheduleV1JobSchedulesScheduleIdDelete: async ({
    scheduleId,
  }: {
    scheduleId: string
  }) => (await getClients()).v1.deleteJobScheduleV1JobSchedulesScheduleIdDelete({ scheduleId }),
  toggleJobScheduleV1JobSchedulesScheduleIdTogglePost: async ({
    scheduleId,
  }: {
    scheduleId: string
  }) => (await getClients()).v1.toggleJobScheduleV1JobSchedulesScheduleIdTogglePost({ scheduleId }),
  runJobScheduleNowV1JobSchedulesScheduleIdRunNowPost: async ({
    scheduleId,
  }: {
    scheduleId: string
  }) => (await getClients()).v1.runJobScheduleNowV1JobSchedulesScheduleIdRunNowPost({ scheduleId }),
  copyCredentialV1CredentialsCredIdCopyPost: async ({ credId }: { credId: string }): Promise<Credential> =>
    (await getClients()).v1.copyCredentialV1CredentialsCredIdCopyPost({ credId }),
  copySiteConfigV1V1SiteConfigsConfigIdCopyPost: async ({
    configId,
  }: {
    configId: string
  }): Promise<ResponseCopySiteConfigV1V1SiteConfigsConfigIdCopyPost> =>
    (await getClients()).v1.copySiteConfigV1V1SiteConfigsConfigIdCopyPost({ configId }),
  getSiteWelcomeSetting: async () => fetchSiteWelcomeSetting(),
  updateSiteWelcomeSetting: async ({
    siteWelcomeSettingUpdate,
  }: {
    siteWelcomeSettingUpdate: SiteWelcomeSettingUpdate
  }) => updateSiteWelcomeSettingRequest(siteWelcomeSettingUpdate),
  getPublicSiteWelcomeSetting: async () => fetchPublicSiteWelcomeSetting(),
  getSiteWelcomeSettingV1SiteSettingsWelcomeGet: async () => fetchSiteWelcomeSetting(),
  getPublicSiteWelcomeSettingV1SiteSettingsWelcomeGet: async () => fetchPublicSiteWelcomeSetting(),
  updateSiteWelcomeSettingV1SiteSettingsWelcomePut: async ({
    siteWelcomeSettingUpdate,
  }: {
    siteWelcomeSettingUpdate: SiteWelcomeSettingUpdate
  }) => updateSiteWelcomeSettingRequest(siteWelcomeSettingUpdate),

  listAuditLogsV1AdminAuditGet: async (p: AuditLogQuery = {}) => listAuditLogs(p),
  listAdminUsersV1AdminUsersGet: async (p: AdminUsersQuery = {}) => listAdminUsers(p),
  getAdminUserV1AdminUsersUserIdGet: async ({ userId }: { userId: string }) => getAdminUser(userId),
  updateAdminUserV1AdminUsersUserIdPatch: async ({
    userId,
    adminUserUpdate,
  }: {
    userId: string
    adminUserUpdate: AdminUserUpdatePayload
  }) => updateAdminUser(userId, adminUserUpdate),
  updateAdminUserRoleOverridesV1AdminUsersUserIdRoleOverridesPatch: async ({
    userId,
    adminUserRoleOverridesUpdate,
  }: {
    userId: string
    adminUserRoleOverridesUpdate: AdminUserRoleOverridesUpdatePayload
  }) => updateAdminUserRoleOverrides(userId, adminUserRoleOverridesUpdate),
  clearAdminUserRoleOverridesV1AdminUsersUserIdRoleOverridesDelete: async ({
    userId,
  }: {
    userId: string
  }) => clearAdminUserRoleOverrides(userId),
  grantAdminUserRoleV1AdminUsersUserIdRolesRoleNamePost: async ({
    userId,
    roleName,
    roleGrantRequest,
  }: {
    userId: string
    roleName: string
    roleGrantRequest?: RoleGrantRequest
  }) => grantAdminUserRole(userId, roleName, roleGrantRequest),
  revokeAdminUserRoleV1AdminUsersUserIdRolesRoleNameDelete: async ({
    userId,
    roleName,
    confirm,
  }: {
    userId: string
    roleName: string
    confirm?: boolean
  }) => revokeAdminUserRole(userId, roleName, Boolean(confirm)),

  listAdminOrganizationsV1AdminOrgsGet: async (p: AdminOrganizationsQuery = {}) => listAdminOrganizations(p),
  createOrganizationV1AdminOrgsPost: async ({
    adminOrganizationCreate,
  }: {
    adminOrganizationCreate: AdminOrganizationCreatePayload
  }) => createAdminOrganizationRequest(adminOrganizationCreate),
  getOrganizationV1AdminOrgsOrganizationIdGet: async ({
    organizationId,
  }: {
    organizationId: string
  }) => fetchAdminOrganization(organizationId),
  updateOrganizationV1AdminOrgsOrganizationIdPatch: async ({
    organizationId,
    adminOrganizationUpdate,
  }: {
    organizationId: string
    adminOrganizationUpdate: AdminOrganizationUpdatePayload
  }) => updateAdminOrganizationRequest(organizationId, adminOrganizationUpdate),
  deleteOrganizationV1AdminOrgsOrganizationIdDelete: async ({
    organizationId,
  }: {
    organizationId: string
  }) => deleteAdminOrganizationRequest(organizationId),
  addOrganizationMemberV1AdminOrgsOrganizationIdMembersPost: async ({
    organizationId,
    adminOrganizationMembershipChange,
  }: {
    organizationId: string
    adminOrganizationMembershipChange: AdminOrganizationMembershipChangePayload
  }) =>
    addAdminOrganizationMemberRequest(organizationId, adminOrganizationMembershipChange),
  removeOrganizationMemberV1AdminOrgsOrganizationIdMembersUserIdDelete: async ({
    organizationId,
    userId,
  }: {
    organizationId: string
    userId: string
  }) => removeAdminOrganizationMemberRequest(organizationId, userId),

  listAdminRoles: async (p: AdminRolesQuery = {}) => fetchAdminRoles(p),
  createAdminRole: async ({
    adminRoleCreate,
  }: {
    adminRoleCreate: AdminRoleCreatePayload
  }) => createAdminRoleRequest(adminRoleCreate),
  updateAdminRole: async ({
    roleId,
    adminRoleUpdate,
  }: {
    roleId: string
    adminRoleUpdate: AdminRoleUpdatePayload
  }) => updateAdminRoleRequest(roleId, adminRoleUpdate),
  deleteAdminRole: async ({ roleId }: { roleId: string }) => deleteAdminRoleRequest(roleId),
  getAdminRole: async ({ roleId }: { roleId: string }) => fetchAdminRoleDetail(roleId),

  listRolesV1AdminRolesGet: async (p: AdminRolesQuery = {}) => fetchAdminRoles(p),
  createRoleV1AdminRolesPost: async ({
    adminRoleCreate,
  }: {
    adminRoleCreate: AdminRoleCreatePayload
  }) => createAdminRoleRequest(adminRoleCreate),
  updateRoleV1AdminRolesRoleIdPatch: async ({
    roleId,
    adminRoleUpdate,
  }: {
    roleId: string
    adminRoleUpdate: AdminRoleUpdatePayload
  }) => updateAdminRoleRequest(roleId, adminRoleUpdate),
  deleteRoleV1AdminRolesRoleIdDelete: async ({ roleId }: { roleId: string }) => deleteAdminRoleRequest(roleId),
  getRoleV1AdminRolesRoleIdGet: async ({ roleId }: { roleId: string }) => fetchAdminRoleDetail(roleId),

  listJobsV1JobsGet: async (p: any = {}) => (await getClients()).v1.listJobsV1JobsGet(p),
  getJobV1JobsJobIdGet: async ({ jobId }: { jobId: string }) => (await getClients()).v1.getJobV1JobsJobIdGet({ jobId }),
  retryJobV1JobsJobIdRetryPost: async ({ jobId }: { jobId: string }) => (await getClients()).v1.retryJobV1JobsJobIdRetryPost({ jobId }),
  retryAllJobsV1JobsRetryAllPost: async ({ requestBody }: { requestBody: any }) => (await getClients()).v1.retryAllJobsV1JobsRetryAllPost({ requestBody }),

  testInstapaperV1IntegrationsInstapaperTestPost: async ({ requestBody }: { requestBody: any }) => (await getClients()).v1.testInstapaperV1IntegrationsInstapaperTestPost({ requestBody }),
  testMinifluxV1IntegrationsMinifluxTestPost: async ({ requestBody }: { requestBody: any }) => (await getClients()).v1.testMinifluxV1IntegrationsMinifluxTestPost({ requestBody }),
  testSiteConfigV1SiteConfigsConfigIdTestPost: async ({ configId }: { configId: string }) => (await getClients()).v1.testSiteConfigV1SiteConfigsConfigIdTestPost({ configId }),

  getStatusV1StatusGet: async () => (await getClients()).v1.getStatusV1StatusGet(),
  dbStatusV1StatusDbGet: async () => (await getClients()).v1.dbStatusV1StatusDbGet(),

  postgresPrepareV1AdminPostgresPreparePost: async () => (await getClients()).admin.postgresPrepareAdminPostgresPreparePost(),
  postgresEnableRlsV1AdminPostgresEnableRlsPost: async () =>
    (await getClients()).admin.postgresEnableRlsAdminPostgresEnableRlsPost(),

  listMeTokensV1MeTokensGet: async (p: ApiTokensQuery = {}) => listApiTokens(p),
  createMeTokenV1MeTokensPost: async ({ apiTokenCreate }: { apiTokenCreate: ApiTokenCreate }) =>
    createApiToken(apiTokenCreate),
  revokeMeTokenV1MeTokensTokenIdDelete: async ({ tokenId }: { tokenId: string }) => revokeApiToken(tokenId),
}

export const me = {
  getProfile: async () => getMeProfile(),
  updateProfile: async (payload: MeUpdatePayload) => updateMeProfile(payload),
}

export const creds = {
  createCredentialCredentialsPost: async ({ credential }: { credential: any }) => (await getClients()).creds.createCredentialCredentialsPost({ credential, xCsrfToken: CSRF }),
  deleteCredentialCredentialsCredIdDelete: async ({ credId }: { credId: string }) => (await getClients()).creds.deleteCredentialCredentialsCredIdDelete({ credId, xCsrfToken: CSRF }),
  getCredentialCredentialsCredIdGet: async ({ credId }: { credId: string }) => (await getClients()).creds.getCredentialCredentialsCredIdGet({ credId }),
  updateCredentialCredentialsCredIdPut: async ({ credId, credential }: { credId: string; credential: any }) => (await getClients()).creds.updateCredentialCredentialsCredIdPut({ credId, credential, xCsrfToken: CSRF }),
  copyCredentialToUser: async ({ credId }: { credId: string }): Promise<Credential> =>
    (await getClients()).v1.copyCredentialV1CredentialsCredIdCopyPost({ credId }),
}

export const siteConfigs = {
  createSiteConfigSiteConfigsPost: async ({ body }: { body: SiteConfigRequest }) =>
    (await getClients()).sites.createSiteConfigSiteConfigsPost({ body, xCsrfToken: CSRF }),
  deleteSiteConfigSiteConfigsConfigIdDelete: async ({ configId }: { configId: string }) =>
    (await getClients()).sites.deleteSiteConfigSiteConfigsConfigIdDelete({ configId, xCsrfToken: CSRF }),
  updateSiteConfigSiteConfigsConfigIdPut: async ({ configId, body }: { configId: string; body: SiteConfigRequest }) =>
    (await getClients()).sites.updateSiteConfigSiteConfigsConfigIdPut({ configId, body, xCsrfToken: CSRF }),
  copySiteConfigToUser: async ({
    configId,
  }: {
    configId: string
  }): Promise<ResponseCopySiteConfigV1V1SiteConfigsConfigIdCopyPost> =>
    (await getClients()).v1.copySiteConfigV1V1SiteConfigsConfigIdCopyPost({ configId }),
}

export const feeds = {
  createFeedFeedsPost: async ({ feed }: { feed: any }) => (await getClients()).feeds.createFeedFeedsPost({ feed }),
  deleteFeedFeedsFeedIdDelete: async ({ feedId }: { feedId: string }) => (await getClients()).feeds.deleteFeedFeedsFeedIdDelete({ feedId }),
  updateFeedFeedsFeedIdPut: async ({ feedId, feed }: { feedId: string; feed: any }) => (await getClients()).feeds.updateFeedFeedsFeedIdPut({ feedId, feed }),
}
