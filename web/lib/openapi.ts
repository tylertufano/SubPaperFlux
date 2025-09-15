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

export const v1 = {
  listBookmarksV1BookmarksGet: async (p: any = {}) => (await getClients()).bookmarks.listBookmarksBookmarksGet(p),
  bulkDeleteBookmarksV1BookmarksBulkDeletePost: async ({ requestBody }: { requestBody: any }) => (await getClients()).bookmarks.bulkDeleteBookmarksV1BookmarksBulkDeletePost({ requestBody, xCsrfToken: CSRF }),
  countBookmarksV1BookmarksCountGet: async (p: any = {}) => (await getClients()).bookmarks.countBookmarksV1BookmarksCountGet(p),

  listFeedsV1V1FeedsGet: async (p: any = {}) => (await getClients()).v1.listFeedsV1V1FeedsGet(p),
  listCredentialsV1V1CredentialsGet: async (p: any = {}) => (await getClients()).v1.listCredentialsV1V1CredentialsGet(p),
  listSiteConfigsV1V1SiteConfigsGet: async (p: any = {}) => (await getClients()).v1.listSiteConfigsV1V1SiteConfigsGet(p),

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
