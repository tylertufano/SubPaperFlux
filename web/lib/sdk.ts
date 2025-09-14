import { getSession } from 'next-auth/react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
const CSRF = process.env.NEXT_PUBLIC_CSRF_TOKEN || '1'

async function headersJSON() {
  const session = await getSession()
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.accessToken) h['Authorization'] = `Bearer ${session.accessToken}`
  h['X-CSRF-Token'] = CSRF
  return h
}

async function get(path: string, params?: Record<string, any>) {
  const url = new URL(`${API_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
  const res = await fetch(url.toString(), { headers: await headersJSON() })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

async function post(path: string, body?: any) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: await headersJSON(), body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  try { return await res.json() } catch { return {} }
}

async function del(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: await headersJSON() })
  if (!res.ok && res.status !== 204) throw new Error(`${res.status} ${path}`)
  return true
}

export const sdk = {
  // Bookmarks
  listBookmarks: (params: { page?: number; size?: number; search?: string; fuzzy?: boolean; feed_id?: string; since?: string; until?: string }) => get('/v1/bookmarks', params),
  bulkDeleteBookmarks: (ids: string[], deleteRemote = true) => post('/v1/bookmarks/bulk-delete', { ids, delete_remote: deleteRemote }),
  exportBookmarks: (fmt: 'json' | 'csv', params: any) => get('/v1/bookmarks/export', { format: fmt, ...params }),

  // Feeds
  listFeeds: () => get('/v1/feeds'),

  // Jobs
  listJobs: (params: { page?: number; status?: string }) => get('/v1/jobs', params),
  retryJob: (id: string) => post(`/v1/jobs/${id}/retry`),
  getJob: (id: string) => get(`/v1/jobs/${id}`),
  retryAllJobs: (body: { status?: string | string[]; type?: string } = {}) => post('/v1/jobs/retry-all', body),
  validateJob: (type: string, payload: any) => post('/v1/jobs/validate', { type, payload }),

  // Credentials
  listCredentials: (params: { page?: number; include_global?: boolean } = {}) => get('/v1/credentials', params),
  createCredential: (kind: string, data: any, global = false) => post('/credentials', { kind, data, owner_user_id: global ? null : undefined }),
  deleteCredential: (id: string) => del(`/credentials/${id}`),
  testInstapaper: (credId: string) => post('/v1/integrations/instapaper/test', { credential_id: credId }),
  testMiniflux: (credId: string) => post('/v1/integrations/miniflux/test', { credential_id: credId }),

  // Site configs
  listSiteConfigs: (params: { page?: number; include_global?: boolean } = {}) => get('/v1/site-configs', params),
  createSiteConfig: (body: any, global = false) => post('/site-configs', { ...body, owner_user_id: global ? null : undefined }),
  deleteSiteConfig: (id: string) => del(`/site-configs/${id}`),
  testSiteConfig: (id: string) => post(`/v1/site-configs/${id}/test`),
}
