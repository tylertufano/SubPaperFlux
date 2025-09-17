import type { APIRequestContext, APIResponse } from '@playwright/test'
import { test as authTest, expect, type TestUser } from './auth'

type CredentialSeed = {
  kind: string
  data: Record<string, unknown>
  ownerUserId?: string | null
}

type BookmarkSeed = {
  url: string
  title?: string
  instapaperBookmarkId?: string
  contentLocation?: string | null
  feedId?: string | null
  publishedAt?: string | Date
}

type JobSeed = {
  type: string
  payload: Record<string, unknown>
}

type DeleteOptions = {
  path?: string
}

type BookmarkDeleteOptions = DeleteOptions & {
  deleteRemote?: boolean
}

type ApiHelper = {
  baseURL: string
  accessToken: string
  request: APIRequestContext
  createCredential(input: CredentialSeed, options?: { path?: string }): Promise<unknown>
  deleteCredential(id: string, options?: DeleteOptions): Promise<void>
  createBookmark(input: BookmarkSeed, options?: { path?: string }): Promise<unknown>
  deleteBookmark(id: string, options?: BookmarkDeleteOptions): Promise<void>
  enqueueJob(input: JobSeed, options?: { path?: string }): Promise<unknown>
  rawPost<T = unknown>(path: string, body: unknown): Promise<T>
  rawDelete(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<void>
}

function normalizeBaseURL(base: string): string {
  return base.replace(/\/$/, '')
}

async function parseResponse<T>(response: APIResponse, method: string, path: string): Promise<T> {
  const text = await response.text()
  if (!response.ok()) {
    throw new Error(
      `[api] ${method.toUpperCase()} ${path} failed (${response.status()}): ${text || 'no response body'}`,
    )
  }
  if (!text) {
    return undefined as T
  }
  const contentType = response.headers()['content-type'] ?? ''
  if (contentType.includes('application/json')) {
    return JSON.parse(text) as T
  }
  return text as unknown as T
}

function ensureApiBase(user?: TestUser): string {
  const apiBase = process.env.API_BASE ?? process.env.NEXT_PUBLIC_API_BASE
  if (!apiBase) {
    const hint = user?.email ? ` for ${user.email}` : ''
    throw new Error(`[api] API_BASE environment variable is required${hint}`)
  }
  return apiBase
}

export const test = authTest.extend<{ api: ApiHelper }>({
  api: async ({ request, oidc, testUser }, use) => {
    const apiBase = normalizeBaseURL(ensureApiBase(testUser))
    const tokens = await oidc.issueTokens(testUser)
    const context = await request.newContext({
      baseURL: apiBase,
      extraHTTPHeaders: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'X-CSRF-Token': process.env.NEXT_PUBLIC_CSRF_TOKEN ?? '1',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })

    const post = async <T = unknown>(path: string, body: unknown) => {
      const response = await context.post(path, { data: body })
      return parseResponse<T>(response, 'POST', path)
    }

    const del = async (path: string, params?: Record<string, string | number | boolean | null | undefined>) => {
      const serialized: Record<string, string> | undefined = params
        ? Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
            if (value === undefined || value === null) return acc
            acc[key] = String(value)
            return acc
          }, {})
        : undefined
      const response = await context.delete(path, serialized ? { params: serialized } : undefined)
      await parseResponse(response, 'DELETE', path)
    }

    const api: ApiHelper = {
      baseURL: apiBase,
      accessToken: tokens.accessToken,
      request: context,
      createCredential: async (input, options) => {
        const payload: Record<string, unknown> = {
          kind: input.kind,
          data: input.data,
        }
        if (input.ownerUserId !== undefined) {
          payload.owner_user_id = input.ownerUserId
        }
        return post(options?.path ?? '/credentials/', payload)
      },
      deleteCredential: async (id, options) => {
        const path = (options?.path ?? '/credentials/').replace(/\/$/, '/')
        await del(`${path}${encodeURIComponent(id)}`)
      },
      createBookmark: async (input, options) => {
        const path = options?.path ?? '/bookmarks/'
        const payload: Record<string, unknown> = {
          url: input.url,
        }
        if (input.instapaperBookmarkId) {
          payload.instapaper_bookmark_id = input.instapaperBookmarkId
        } else {
          payload.instapaper_bookmark_id = `e2e-${Date.now()}`
        }
        if (input.title !== undefined) payload.title = input.title
        if (input.contentLocation !== undefined) payload.content_location = input.contentLocation
        if (input.feedId !== undefined) payload.feed_id = input.feedId
        if (input.publishedAt !== undefined) {
          payload.published_at =
            typeof input.publishedAt === 'string' ? input.publishedAt : input.publishedAt.toISOString()
        }
        return post(path, payload)
      },
      deleteBookmark: async (id, options) => {
        const path = (options?.path ?? '/bookmarks/').replace(/\/$/, '/')
        await del(`${path}${encodeURIComponent(id)}`, {
          delete_remote: options?.deleteRemote ?? true,
        })
      },
      enqueueJob: async (input, options) => {
        const path = options?.path ?? '/jobs/'
        return post(path, {
          type: input.type,
          payload: input.payload,
        })
      },
      rawPost: post,
      rawDelete: async (path, params) => {
        await del(path, params)
      },
    }

    try {
      await use(api)
    } finally {
      await context.dispose()
    }
  },
})

export { expect }
export type { ApiHelper, BookmarkSeed, CredentialSeed, JobSeed }
