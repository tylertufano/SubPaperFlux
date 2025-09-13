import { getSession } from 'next-auth/react'
import {
  Configuration,
  CredentialsApi,
  SiteConfigsApi,
  V1Api,
} from '../../sdk/ts/src'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
const CSRF = process.env.NEXT_PUBLIC_CSRF_TOKEN || '1'

async function getConfig(): Promise<Configuration> {
  const session = await getSession()
  return new Configuration({
    basePath: API_BASE,
    accessToken: session?.accessToken as any,
  })
}

export const sdk = {
  // Bookmarks
  listBookmarks: async (params: {
    page?: number
    size?: number
    search?: string
    fuzzy?: boolean
    feed_id?: string
    since?: string
    until?: string
  }) => {
    const api = new V1Api(await getConfig())
    return api.listBookmarksV1BookmarksGet(params)
  },
  bulkDeleteBookmarks: async (ids: string[], deleteRemote = true) => {
    const api = new V1Api(await getConfig())
    return api.bulkDeleteBookmarksV1BookmarksBulkDeletePost({
      requestBody: { ids, delete_remote: deleteRemote },
      xCsrfToken: CSRF,
    })
  },
  exportBookmarks: async (fmt: 'json' | 'csv', params: any) => {
    const api = new V1Api(await getConfig())
    return api.exportBookmarksV1BookmarksExportGet({ format: fmt, ...params })
  },

  // Feeds
  listFeeds: async () => {
    const api = new V1Api(await getConfig())
    return api.listFeedsV1V1FeedsGet()
  },

  // Jobs
  listJobs: async (params: { page?: number; status?: string }) => {
    const api = new V1Api(await getConfig())
    return api.listJobsV1JobsGet(params)
  },
  retryJob: async (id: string) => {
    const api = new V1Api(await getConfig())
    return api.retryJobV1JobsJobIdRetryPost({ jobId: id }, { headers: { 'X-CSRF-Token': CSRF } })
  },
  getJob: async (id: string) => {
    const api = new V1Api(await getConfig())
    return api.getJobV1JobsJobIdGet({ jobId: id })
  },
  retryAllJobs: async (body: { status?: string | string[]; type?: string } = {}) => {
    const api = new V1Api(await getConfig())
    return api.retryAllJobsV1JobsRetryAllPost({ requestBody: body }, { headers: { 'X-CSRF-Token': CSRF } })
  },
  validateJob: async (type: string, payload: any) => {
    const api = new V1Api(await getConfig())
    return api.validateJobPayloadV1JobsValidatePost({ requestBody: { type, payload } })
  },

  // Credentials
  listCredentials: async (params: { page?: number; include_global?: boolean } = {}) => {
    const api = new V1Api(await getConfig())
    return api.listCredentialsV1V1CredentialsGet(params)
  },
  createCredential: async (kind: string, data: any, global = false) => {
    const api = new CredentialsApi(await getConfig())
    return api.createCredentialCredentialsPost({
      credential: { kind, data, ownerUserId: global ? null : undefined },
      xCsrfToken: CSRF,
    })
  },
  deleteCredential: async (id: string) => {
    const api = new CredentialsApi(await getConfig())
    return api.deleteCredentialCredentialsCredIdDelete({ credId: id, xCsrfToken: CSRF })
  },
  testInstapaper: async (credId: string) => {
    const api = new V1Api(await getConfig())
    return api.testInstapaperV1IntegrationsInstapaperTestPost({ requestBody: { credential_id: credId } })
  },
  testMiniflux: async (credId: string) => {
    const api = new V1Api(await getConfig())
    return api.testMinifluxV1IntegrationsMinifluxTestPost({ requestBody: { credential_id: credId } })
  },

  // Site configs
  listSiteConfigs: async (params: { page?: number; include_global?: boolean } = {}) => {
    const api = new V1Api(await getConfig())
    return api.listSiteConfigsV1V1SiteConfigsGet(params)
  },
  createSiteConfig: async (body: any, global = false) => {
    const api = new SiteConfigsApi(await getConfig())
    return api.createSiteConfigSiteConfigsPost({
      siteConfig: { ...body, owner_user_id: global ? null : undefined },
      xCsrfToken: CSRF,
    })
  },
  deleteSiteConfig: async (id: string) => {
    const api = new SiteConfigsApi(await getConfig())
    return api.deleteSiteConfigSiteConfigsConfigIdDelete({ configId: id, xCsrfToken: CSRF })
  },
  testSiteConfig: async (id: string) => {
    const api = new V1Api(await getConfig())
    return api.testSiteConfigV1SiteConfigsConfigIdTestPost({ configId: id })
  },
}
