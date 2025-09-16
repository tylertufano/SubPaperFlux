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

async function listAuditLogs(params: AuditLogQuery = {}): Promise<AuditLogsPage> {
  const basePath = await resolveApiBase()
  const session = await getSession()
  const headers: Record<string, string> = {
    'X-CSRF-Token': CSRF,
  }
  const token = session?.accessToken as string | undefined
  if (token) headers['Authorization'] = `Bearer ${token}`

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

  const normalizedBase = basePath ? basePath.replace(/\/$/, '') : ''
  const search = query.toString()
  const url = `${normalizedBase}/v1/admin/audit${search ? `?${search}` : ''}`

  const res = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    const message = (await res.text())?.trim()
    throw new Error(message || `Failed to load audit logs (${res.status})`)
  }

  return res.json()
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
