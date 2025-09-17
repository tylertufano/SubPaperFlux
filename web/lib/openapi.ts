import { Configuration, Middleware, ResponseError, FetchError } from '../sdk/src/runtime'
import { V1Api } from '../sdk/src/apis/V1Api'
import { BookmarksApi } from '../sdk/src/apis/BookmarksApi'
import { CredentialsApi } from '../sdk/src/apis/CredentialsApi'
import { SiteConfigsApi } from '../sdk/src/apis/SiteConfigsApi'
import { FeedsApi } from '../sdk/src/apis/FeedsApi'
import { getSession } from 'next-auth/react'

const BUILD_API_BASE = process.env.NEXT_PUBLIC_API_BASE || ''
const CSRF = process.env.NEXT_PUBLIC_CSRF_TOKEN || '1'

// Warn at runtime if we are on HTTPS but API base is insecure HTTP
if (typeof window !== 'undefined') {
  try {
    if (window.location.protocol === 'https:' && BUILD_API_BASE && BUILD_API_BASE.startsWith('http://')) {
      // eslint-disable-next-line no-console
      console.warn('[SubPaperFlux] Insecure NEXT_PUBLIC_API_BASE over HTTPS page:', BUILD_API_BASE)
    }
  } catch {}
}

let clientsPromise: Promise<{ v1: V1Api; bookmarks: BookmarksApi; creds: CredentialsApi; sites: SiteConfigsApi; feeds: FeedsApi }> | null = null

type AuthorizedRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string | undefined>
  errorMessage?: string
  expectJson?: boolean
}

async function resolveApiBase(): Promise<string> {
  if (typeof window === 'undefined') {
    return process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || ''
  }
  if (BUILD_API_BASE) return BUILD_API_BASE
  const w: any = window as any
  if (typeof w.__SPF_API_BASE === 'string') return w.__SPF_API_BASE
  try {
    const res = await fetch('/ui-config')
    if (res.ok) {
      const data = await res.json()
      if (typeof data.apiBase === 'string') return data.apiBase
    }
  } catch {}
  return ''
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
      const cfg = new Configuration({
        basePath,
        accessToken: async () => {
          const session = await getSession()
          return (session?.accessToken as string) || ''
        },
        headers: { 'X-CSRF-Token': CSRF },
        middleware: [retry],
      })
      return {
        v1: new V1Api(cfg),
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
  const session = await getSession()
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
  const token = session?.accessToken as string | undefined
  if (token) headers['Authorization'] = `Bearer ${token}`

  const normalizedBase = basePath ? basePath.replace(/\/$/, '') : ''
  const response = await fetch(`${normalizedBase}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    const message = (await response.text())?.trim()
    throw new Error(message || errorMessage || `Request failed (${response.status})`)
  }

  if (expectJson === false || response.status === 204) {
    return null as T
  }

  return response.json() as Promise<T>
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
}

type AdminUserUpdatePayload = {
  is_active?: boolean
  confirm?: boolean
  quota_credentials?: number | null
  quota_site_configs?: number | null
  quota_feeds?: number | null
  quota_api_tokens?: number | null
}

export type RoleGrantRequest = {
  description?: string | null
  create_missing?: boolean
  is_system?: boolean | null
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
  const session = await getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': CSRF,
  }
  const token = session?.accessToken as string | undefined
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${basePath}/v1/bookmarks/bulk-publish`, {
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
    const session = await getSession()
    const headers: Record<string, string> = {
      'X-CSRF-Token': CSRF,
    }
    const token = session?.accessToken as string | undefined
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
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

  listJobsV1JobsGet: async (p: any = {}) => (await getClients()).v1.listJobsV1JobsGet(p),
  getJobV1JobsJobIdGet: async ({ jobId }: { jobId: string }) => (await getClients()).v1.getJobV1JobsJobIdGet({ jobId }),
  retryJobV1JobsJobIdRetryPost: async ({ jobId }: { jobId: string }) => (await getClients()).v1.retryJobV1JobsJobIdRetryPost({ jobId }),
  retryAllJobsV1JobsRetryAllPost: async ({ requestBody }: { requestBody: any }) => (await getClients()).v1.retryAllJobsV1JobsRetryAllPost({ requestBody }),

  testInstapaperV1IntegrationsInstapaperTestPost: async ({ requestBody }: { requestBody: any }) => (await getClients()).v1.testInstapaperV1IntegrationsInstapaperTestPost({ requestBody }),
  testMinifluxV1IntegrationsMinifluxTestPost: async ({ requestBody }: { requestBody: any }) => (await getClients()).v1.testMinifluxV1IntegrationsMinifluxTestPost({ requestBody }),
  testSiteConfigV1SiteConfigsConfigIdTestPost: async ({ configId }: { configId: string }) => (await getClients()).v1.testSiteConfigV1SiteConfigsConfigIdTestPost({ configId }),

  getStatusV1StatusGet: async () => (await getClients()).v1.getStatusV1StatusGet(),
  dbStatusV1StatusDbGet: async () => (await getClients()).v1.dbStatusV1StatusDbGet(),

  postgresPrepareV1AdminPostgresPreparePost: async () => (await getClients()).v1.postgresPrepareV1AdminPostgresPreparePost(),
  postgresEnableRlsV1AdminPostgresEnableRlsPost: async () => (await getClients()).v1.postgresEnableRlsV1AdminPostgresEnableRlsPost(),

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
}

export const siteConfigs = {
  createSiteConfigSiteConfigsPost: async ({ siteConfig }: { siteConfig: any }) => (await getClients()).sites.createSiteConfigSiteConfigsPost({ siteConfig, xCsrfToken: CSRF }),
  deleteSiteConfigSiteConfigsConfigIdDelete: async ({ configId }: { configId: string }) => (await getClients()).sites.deleteSiteConfigSiteConfigsConfigIdDelete({ configId, xCsrfToken: CSRF }),
  updateSiteConfigSiteConfigsConfigIdPut: async ({ configId, siteConfig }: { configId: string; siteConfig: any }) => (await getClients()).sites.updateSiteConfigSiteConfigsConfigIdPut({ configId, siteConfig, xCsrfToken: CSRF }),
}

export const feeds = {
  createFeedFeedsPost: async ({ feed }: { feed: any }) => (await getClients()).feeds.createFeedFeedsPost({ feed }),
  deleteFeedFeedsFeedIdDelete: async ({ feedId }: { feedId: string }) => (await getClients()).feeds.deleteFeedFeedsFeedIdDelete({ feedId }),
  updateFeedFeedsFeedIdPut: async ({ feedId, feed }: { feedId: string; feed: any }) => (await getClients()).feeds.updateFeedFeedsFeedIdPut({ feedId, feed }),
}
