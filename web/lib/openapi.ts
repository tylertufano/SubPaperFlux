import { Configuration } from '../sdk/src/runtime'
import { V1Api } from '../sdk/src/apis/V1Api'
import { CredentialsApi } from '../sdk/src/apis/CredentialsApi'
import { SiteConfigsApi } from '../sdk/src/apis/SiteConfigsApi'
import { FeedsApi } from '../sdk/src/apis/FeedsApi'
import { getSession } from 'next-auth/react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || ''

// Warn at runtime if we are on HTTPS but API base is insecure HTTP
if (typeof window !== 'undefined') {
  try {
    if (window.location.protocol === 'https:' && API_BASE && API_BASE.startsWith('http://')) {
      // eslint-disable-next-line no-console
      console.warn('[SubPaperFlux] Insecure NEXT_PUBLIC_API_BASE over HTTPS page:', API_BASE)
    }
  } catch {}
}
const CSRF = process.env.NEXT_PUBLIC_CSRF_TOKEN || '1'

const config = new Configuration({
  basePath: API_BASE,
  accessToken: async () => {
    const session = await getSession()
    return (session?.accessToken as string) || ''
  },
  headers: { 'X-CSRF-Token': CSRF },
})

const v1Client = new V1Api(config)
const credClient = new CredentialsApi(config)
const siteClient = new SiteConfigsApi(config)
const feedsClient = new FeedsApi(config)

export const v1 = {
  listBookmarksV1BookmarksGet: (p: any = {}) => v1Client.listBookmarksV1BookmarksGet(p),
  bulkDeleteBookmarksV1BookmarksBulkDeletePost: ({ requestBody }: { requestBody: any }) => v1Client.bulkDeleteBookmarksV1BookmarksBulkDeletePost({ requestBody, xCsrfToken: CSRF }),
  countBookmarksV1BookmarksCountGet: (p: any = {}) => v1Client.countBookmarksV1BookmarksCountGet(p),

  listFeedsV1V1FeedsGet: (p: any = {}) => v1Client.listFeedsV1V1FeedsGet(p),
  listCredentialsV1V1CredentialsGet: (p: any = {}) => v1Client.listCredentialsV1V1CredentialsGet(p),
  listSiteConfigsV1V1SiteConfigsGet: (p: any = {}) => v1Client.listSiteConfigsV1V1SiteConfigsGet(p),

  listJobsV1JobsGet: (p: any = {}) => v1Client.listJobsV1JobsGet(p),
  getJobV1JobsJobIdGet: ({ jobId }: { jobId: string }) => v1Client.getJobV1JobsJobIdGet({ jobId }),
  retryJobV1JobsJobIdRetryPost: ({ jobId }: { jobId: string }) => v1Client.retryJobV1JobsJobIdRetryPost({ jobId }),
  retryAllJobsV1JobsRetryAllPost: ({ requestBody }: { requestBody: any }) => v1Client.retryAllJobsV1JobsRetryAllPost({ requestBody }),

  testInstapaperV1IntegrationsInstapaperTestPost: ({ requestBody }: { requestBody: any }) => v1Client.testInstapaperV1IntegrationsInstapaperTestPost({ requestBody }),
  testMinifluxV1IntegrationsMinifluxTestPost: ({ requestBody }: { requestBody: any }) => v1Client.testMinifluxV1IntegrationsMinifluxTestPost({ requestBody }),
  testSiteConfigV1SiteConfigsConfigIdTestPost: ({ configId }: { configId: string }) => v1Client.testSiteConfigV1SiteConfigsConfigIdTestPost({ configId }),

  getStatusV1StatusGet: () => v1Client.getStatusV1StatusGet(),
  dbStatusV1StatusDbGet: () => v1Client.dbStatusV1StatusDbGet(),

  postgresPrepareV1AdminPostgresPreparePost: () => v1Client.postgresPrepareV1AdminPostgresPreparePost(),
  postgresEnableRlsV1AdminPostgresEnableRlsPost: () => v1Client.postgresEnableRlsV1AdminPostgresEnableRlsPost(),
}

export const creds = {
  createCredentialCredentialsPost: ({ credential }: { credential: any }) => credClient.createCredentialCredentialsPost({ credential, xCsrfToken: CSRF }),
  deleteCredentialCredentialsCredIdDelete: ({ credId }: { credId: string }) => credClient.deleteCredentialCredentialsCredIdDelete({ credId, xCsrfToken: CSRF }),
}

export const siteConfigs = {
  createSiteConfigSiteConfigsPost: ({ siteConfig }: { siteConfig: any }) => siteClient.createSiteConfigSiteConfigsPost({ siteConfig, xCsrfToken: CSRF }),
  deleteSiteConfigSiteConfigsConfigIdDelete: ({ configId }: { configId: string }) => siteClient.deleteSiteConfigSiteConfigsConfigIdDelete({ configId, xCsrfToken: CSRF }),
}

export const feeds = {
  createFeedFeedsPost: ({ feed }: { feed: any }) => feedsClient.createFeedFeedsPost({ feed }),
  deleteFeedFeedsFeedIdDelete: ({ feedId }: { feedId: string }) => feedsClient.deleteFeedFeedsFeedIdDelete({ feedId }),
  updateFeedFeedsFeedIdPut: ({ feedId, feed }: { feedId: string; feed: any }) => feedsClient.updateFeedFeedsFeedIdPut({ feedId, feed }),
}
