import { getSession } from 'next-auth/react'
import { Configuration } from '../../sdk/ts/src/runtime'
import { V1Api } from '../../sdk/ts/src/apis/V1Api'
import { CredentialsApi } from '../../sdk/ts/src/apis/CredentialsApi'
import { SiteConfigsApi } from '../../sdk/ts/src/apis/SiteConfigsApi'
import { AdminApi } from '../../sdk/ts/src/apis/AdminApi'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
const CSRF = process.env.NEXT_PUBLIC_CSRF_TOKEN || '1'

const config = new Configuration({
  basePath: API_BASE,
  // Provide access token dynamically from NextAuth session on each request
  accessToken: async () => {
    const session = await getSession()
    return (session?.accessToken as string) || ''
  },
  // Send CSRF header when cookie-mode auth is used; harmless otherwise
  headers: {
    'X-CSRF-Token': CSRF,
  },
})

export const v1 = new V1Api(config)
export const creds = new CredentialsApi(config)
export const siteConfigs = new SiteConfigsApi(config)
export const admin = new AdminApi(config)

