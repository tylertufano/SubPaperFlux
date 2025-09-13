import { getSession } from 'next-auth/react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
const CSRF = process.env.NEXT_PUBLIC_CSRF_TOKEN || '1'

export async function apiGet(path: string, params?: Record<string, any>) {
  const session = await getSession()
  const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : ''
    }
  })
  if (!res.ok) throw new Error(`GET ${url} ${res.status}`)
  return res.json()
}

export async function apiPost(path: string, body?: any) {
  const session = await getSession()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : '',
      'X-CSRF-Token': CSRF,
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`POST ${path} ${res.status}`)
  return res.json()
}

export async function apiDelete(path: string) {
  const session = await getSession()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : '',
      'X-CSRF-Token': CSRF,
    }
  })
  if (!res.ok && res.status !== 204) throw new Error(`DELETE ${path} ${res.status}`)
  return true
}
