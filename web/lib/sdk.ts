import { getSession } from 'next-auth/react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
const CSRF = process.env.NEXT_PUBLIC_CSRF_TOKEN || '1'

async function authHeaders() {
  const session = await getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.accessToken) headers['Authorization'] = `Bearer ${session.accessToken}`
  headers['X-CSRF-Token'] = CSRF
  return headers
}

async function get(path: string, params?: Record<string, any>) {
  const url = new URL(`${API_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
  const h = await authHeaders()
  const res = await fetch(url.toString(), { headers: h })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

async function post(path: string, body?: any) {
  const h = await authHeaders()
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: h, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

async function del(path: string) {
  const h = await authHeaders()
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: h })
  if (!res.ok && res.status !== 204) throw new Error(`${res.status} ${path}`)
  return true
}

export const sdk = {
  // Bookmarks
  listBookmarks: (params: { page?: number; search?: string; feed_id?: string; since?: string; until?: string; fuzzy?: boolean }) => get('/v1/bookmarks', params),
  bulkDeleteBookmarks: (ids: string[], deleteRemote = true) => post('/v1/bookmarks/bulk-delete', { ids, delete_remote: deleteRemote }),
  exportBookmarks: (fmt: 'json' | 'csv', params: any) => get('/v1/bookmarks/export', { format: fmt, ...params }),

  // Feeds
  listFeeds: () => get('/v1/feeds'),

  // Jobs
  listJobs: (params: { page?: number; status?: string }) => get('/v1/jobs', params),
  retryJob: (id: string) => post(`/v1/jobs/${id}/retry`),
  validateJob: (type: string, payload: any) => post('/v1/jobs/validate', { type, payload }),

  // Credentials
  listCredentials: () => get('/v1/credentials'),
  createCredential: (kind: string, data: any, global = false) => post('/credentials', { kind, data, owner_user_id: global ? null : undefined }),
  deleteCredential: (id: string) => del(`/credentials/${id}`),
  testInstapaper: (credId: string) => post('/v1/integrations/instapaper/test', { credential_id: credId }),
  testMiniflux: (credId: string) => post('/v1/integrations/miniflux/test', { credential_id: credId }),

  // Site configs
  listSiteConfigs: () => get('/v1/site-configs'),
  createSiteConfig: (body: any, global = false) => post('/site-configs', { ...body, owner_user_id: global ? null : undefined }),
  deleteSiteConfig: (id: string) => del(`/site-configs/${id}`),
  testSiteConfig: (id: string) => post(`/v1/site-configs/${id}/test`),
}

