import { Buffer } from 'buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { authOptions } from '../auth'
import { ALL_PERMISSIONS, derivePermissionsFromRoles } from '../lib/rbac'

type OidcProvider = {
  id: string
  profile: (profile: any) => any
  authorization?: { params?: Record<string, unknown> }
}

const originalFetch = globalThis.fetch
const originalGroupRoleMap = process.env.OIDC_GROUP_ROLE_MAP
const originalGroupRoleDefaults = process.env.OIDC_GROUP_ROLE_DEFAULTS
const originalTokenEndpoint = process.env.OIDC_TOKEN_ENDPOINT

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch
  } else {
    delete (globalThis as any).fetch
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (originalGroupRoleMap === undefined) {
    delete process.env.OIDC_GROUP_ROLE_MAP
  } else {
    process.env.OIDC_GROUP_ROLE_MAP = originalGroupRoleMap
  }
  if (originalGroupRoleDefaults === undefined) {
    delete process.env.OIDC_GROUP_ROLE_DEFAULTS
  } else {
    process.env.OIDC_GROUP_ROLE_DEFAULTS = originalGroupRoleDefaults
  }
  if (originalTokenEndpoint === undefined) {
    delete process.env.OIDC_TOKEN_ENDPOINT
  } else {
    process.env.OIDC_TOKEN_ENDPOINT = originalTokenEndpoint
  }
})

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function buildIdToken(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

function getOidcProvider(): OidcProvider {
  const provider = authOptions.providers?.find((entry) => (entry as any).id === 'oidc') as
    | OidcProvider
    | undefined
  if (!provider) {
    throw new Error('OIDC provider not configured for authOptions')
  }
  return provider
}

describe('authOptions provider configuration', () => {
  it('requests group claims via the authorization scope', () => {
    const provider = getOidcProvider()
    const scope = provider.authorization?.params?.scope
    expect(typeof scope).toBe('string')
    const normalized = scope
      ?.split(/\s+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
    expect(normalized).toContain('groups')
  })
})

describe('authOptions profile callback', () => {
  it('normalizes role and group claims from the profile payload', () => {
    const provider = getOidcProvider()
    const result = provider.profile({
      sub: 'user-123',
      name: 'Example Person',
      email: 'user@example.com',
      roles: ['ADMIN', 'editor', 'ADMIN'],
      groups: ['Ops', 'Ops', 'QA'],
      claims: {
        Roles: ['Manager'],
        Groups: ['Support'],
      },
      realm_access: { roles: ['Realm-Admin'] },
      resource_access: {
        account: { roles: ['Account-Viewer'] },
      },
    })

    expect(result.roles).toEqual(['admin', 'editor', 'manager', 'realm-admin', 'account-viewer'])
    expect(result.groups).toEqual(['ops', 'qa', 'support'])
    expect(result.permissions).toEqual([...ALL_PERMISSIONS])
  })

  it('falls back to empty collections when claims are missing', () => {
    const provider = getOidcProvider()
    const result = provider.profile({
      sub: 'user-456',
      name: 'Fallback User',
      email: 'fallback@example.com',
    })

    expect(result.roles).toEqual([])
    expect(result.groups).toEqual([])
    expect(result.permissions).toEqual([])
  })

  it('derives name and email from alternative claim keys', () => {
    const provider = getOidcProvider()
    const result = provider.profile({
      sub: 'user-654',
      given_name: 'Taylor',
      family_name: 'Swift',
      emails: ['primary@example.com', 'alt@example.com'],
      'cognito:groups': ['Writers', 'Reviewers'],
    })

    expect(result.name).toBe('Taylor Swift')
    expect(result.displayName).toBe('Taylor Swift')
    expect(result.email).toBe('primary@example.com')
    expect(result.groups).toEqual(['writers', 'reviewers'])
  })
})

describe('authOptions callbacks', () => {
  function buildUser() {
    const provider = authOptions.providers?.find((entry) => (entry as any).id === 'oidc') as OidcProvider | undefined
    if (!provider) {
      throw new Error('OIDC provider not configured for authOptions')
    }
    return provider.profile({
      sub: 'user-789',
      name: 'Callback User',
      email: 'callback@example.com',
      roles: ['Admin'],
      groups: ['Staff'],
    })
  }

  it('derives roles from configured group mappings when explicit role claims are absent', async () => {
    process.env.OIDC_GROUP_ROLE_MAP = 'staff=admin'
    process.env.OIDC_GROUP_ROLE_DEFAULTS = 'auditor'

    const provider = getOidcProvider()
    const user = provider.profile({
      sub: 'user-303',
      name: 'Group Only User',
      groups: ['Staff'],
    })

    const token = await authOptions.callbacks?.jwt?.({
      token: {},
      user,
      account: null,
    } as any)

    expect(token?.groups).toEqual(['staff'])
    expect(token?.roles).toEqual(['auditor', 'admin'])
    expect(token?.permissions).toEqual([...ALL_PERMISSIONS])

    const session = await authOptions.callbacks?.session?.({
      session: { user: {} },
      token: token!,
    } as any)

    expect(session?.user?.groups).toEqual(['staff'])
    expect(session?.user?.roles).toEqual(['auditor', 'admin'])
    expect(session?.user?.permissions).toEqual([...ALL_PERMISSIONS])
  })

  it('persists normalized roles, groups, and permissions onto the JWT and session', async () => {
    const user = buildUser()
    const token = await authOptions.callbacks?.jwt?.({
      token: {},
      user,
      account: { access_token: 'access-token', id_token: 'id-token' } as any,
    } as any)

    expect(token?.roles).toEqual(['admin'])
    expect(token?.groups).toEqual(['staff'])
    expect(token?.permissions).toEqual([...ALL_PERMISSIONS])

    const session = await authOptions.callbacks?.session?.({
      session: { user: {} },
      token: token!,
    } as any)

    expect(session?.user?.roles).toEqual(['admin'])
    expect(session?.user?.groups).toEqual(['staff'])
    expect(session?.user?.permissions).toEqual([...ALL_PERMISSIONS])
  })

  it('stores refresh token metadata when provided during sign-in', async () => {
    const user = buildUser()
    const expiresAt = Math.floor(Date.now() / 1000) + 60

    const token = await authOptions.callbacks?.jwt?.({
      token: {},
      user,
      account: {
        access_token: 'access-token',
        id_token: 'id-token',
        refresh_token: 'refresh-token',
        expires_at: expiresAt,
      } as any,
    } as any)

    expect(token?.refreshToken).toBe('refresh-token')
    expect(typeof token?.accessTokenExpires).toBe('number')
    expect((token as any)?.accessTokenExpires).toBeGreaterThan(Date.now())
    expect((token as any)?.accessTokenExpires).toBeLessThan(Date.now() + 5 * 60 * 1000)

    const session = await authOptions.callbacks?.session?.({
      session: { user: {} },
      token: token!,
    } as any)

    expect(session?.accessToken).toBe('access-token')
    expect((session as any)?.accessTokenExpires).toBe((token as any)?.accessTokenExpires)
    expect((session as any)?.error).toBeUndefined()
  })

  it('retains derived permissions when the JWT callback runs without a user payload', async () => {
    const user = buildUser()
    const initialToken = await authOptions.callbacks?.jwt?.({
      token: {},
      user,
      account: null,
    } as any)

    const subsequentToken = await authOptions.callbacks?.jwt?.({
      token: initialToken!,
      user: null,
      account: null,
    } as any)

    const expectedPermissions = derivePermissionsFromRoles(['admin'])
    expect(subsequentToken?.roles).toEqual(['admin'])
    expect(subsequentToken?.permissions).toEqual(expectedPermissions)
  })

  it('augments JWT and session details from ID token claims when profile data is missing', async () => {
    const provider = getOidcProvider()
    const user = provider.profile({
      sub: 'user-999',
    })
    const idToken = buildIdToken({
      sub: 'user-999',
      email: 'user999@example.com',
      name: 'ID Token User',
      display_name: 'ID Token Display',
      groups: ['Engineering', 'QA'],
      roles: ['Admin', 'Auditor'],
    })

    const token = await authOptions.callbacks?.jwt?.({
      token: { sub: 'user-999', name: user.name },
      user,
      account: { access_token: 'access-token', id_token: idToken } as any,
    } as any)

    const expectedPermissions = derivePermissionsFromRoles(['admin', 'auditor'])
    expect(token?.roles).toEqual(['admin', 'auditor'])
    expect(token?.groups).toEqual(['engineering', 'qa'])
    expect(token?.permissions).toEqual(expectedPermissions)
    expect(token?.email).toBe('user999@example.com')
    expect(token?.name).toBe('ID Token User')
    expect(token?.displayName).toBe('ID Token Display')

    const session = await authOptions.callbacks?.session?.({
      session: { user: {} },
      token: token!,
    } as any)

    expect(session?.user?.id).toBe('user-999')
    expect(session?.user?.name).toBe('ID Token User')
    expect(session?.user?.email).toBe('user999@example.com')
    expect(session?.user?.displayName).toBe('ID Token Display')
    expect(session?.user?.roles).toEqual(['admin', 'auditor'])
    expect(session?.user?.groups).toEqual(['engineering', 'qa'])
    expect(session?.user?.permissions).toEqual(expectedPermissions)
  })

  it('hydrates identity attributes from the userinfo endpoint when ID token claims are insufficient', async () => {
    const provider = getOidcProvider()
    const user = provider.profile({
      sub: 'user-101',
    })

    const idToken = buildIdToken({
      sub: 'user-101',
    })

    const userInfoPayload = {
      sub: 'user-101',
      uid: 'internal-user-101',
      name: 'Userinfo Name',
      display_name: 'Userinfo Display',
      email: 'userinfo@example.com',
      roles: ['Admin', 'Auditor'],
      groups: ['Engineering', 'QA'],
    }

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => userInfoPayload,
    })

    vi.stubGlobal('fetch', fetchMock)

    const token = await authOptions.callbacks?.jwt?.({
      token: { sub: 'user-101' },
      user,
      account: { access_token: 'access-token', id_token: idToken } as any,
    } as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const userInfoBase = (process.env.OIDC_USERINFO_ENDPOINT ?? process.env.OIDC_ISSUER ?? 'http://localhost/oidc').replace(
      /\/\.well-known\/openid-configuration$/,
      '',
    )
    const trimmedBase = userInfoBase.replace(/\/+$/, '')
    const normalizedUserInfoUrl = trimmedBase.toLowerCase().endsWith('/userinfo')
      ? trimmedBase
      : `${trimmedBase}/userinfo`
    expect(fetchMock).toHaveBeenCalledWith(
      normalizedUserInfoUrl,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    )

    const expectedPermissions = derivePermissionsFromRoles(['admin', 'auditor'])
    expect(token?.roles).toEqual(['admin', 'auditor'])
    expect(token?.groups).toEqual(['engineering', 'qa'])
    expect(token?.permissions).toEqual(expectedPermissions)
    expect(token?.email).toBe('userinfo@example.com')
    expect(token?.name).toBe('Userinfo Name')
    expect((token as any)?.userId).toBe('internal-user-101')
    expect(token?.displayName).toBe('Userinfo Display')

    const session = await authOptions.callbacks?.session?.({
      session: { user: {} },
      token: token!,
    } as any)

    expect(session?.user?.id).toBe('internal-user-101')
    expect(session?.user?.name).toBe('Userinfo Name')
    expect(session?.user?.email).toBe('userinfo@example.com')
    expect(session?.user?.displayName).toBe('Userinfo Display')
    expect(session?.user?.roles).toEqual(['admin', 'auditor'])
    expect(session?.user?.groups).toEqual(['engineering', 'qa'])
    expect(session?.user?.permissions).toEqual(expectedPermissions)
  })

  it('replaces placeholder identifiers with richer ID token claims', async () => {
    const provider = getOidcProvider()
    const user = provider.profile({
      sub: 'user-202',
    })

    const idToken = buildIdToken({
      sub: 'user-202',
      given_name: 'Jordan',
      family_name: 'Fischer',
      emails: ['jordan@example.com'],
      oid: 'guid-202',
      groups: ['Engineering', 'QA'],
    })

    const token = await authOptions.callbacks?.jwt?.({
      token: { sub: 'user-202', name: '7f3b6bb2-82a8-429b-bc03-b5d43fa7f7a5' },
      user,
      account: { access_token: 'access-token', id_token: idToken } as any,
    } as any)

    expect(token?.name).toBe('Jordan Fischer')
    expect(token?.email).toBe('jordan@example.com')
    expect((token as any)?.userId).toBe('guid-202')
    expect(token?.groups).toEqual(['engineering', 'qa'])

    const session = await authOptions.callbacks?.session?.({
      session: { user: {} },
      token: token!,
    } as any)

    expect(session?.user?.id).toBe('guid-202')
    expect(session?.user?.name).toBe('Jordan Fischer')
    expect(session?.user?.email).toBe('jordan@example.com')
    expect(session?.user?.displayName).toBe('Jordan Fischer')
    expect(session?.user?.groups).toEqual(['engineering', 'qa'])
  })

  it('refreshes access tokens when nearing expiration', async () => {
    const refreshTokenEndpoint = 'https://issuer.example.com/token'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: refreshTokenEndpoint }),
      })
      .mockImplementationOnce(async (url, init) => {
        expect(url).toBe(refreshTokenEndpoint)
        expect(init?.method).toBe('POST')
        expect(init?.body).toContain('grant_type=refresh_token')
        expect(init?.body).toContain('refresh_token=initial-refresh')
        return {
          ok: true,
          json: async () => ({
            access_token: 'refreshed-access',
            refresh_token: 'refreshed-refresh',
            id_token: buildIdToken({
              sub: 'user-789',
              email: 'refreshed@example.com',
              display_name: 'Refreshed Display',
            }),
            expires_in: 3600,
          }),
        }
      })

    vi.stubGlobal('fetch', fetchMock)

    const refreshedToken = await authOptions.callbacks?.jwt?.({
      token: {
        accessToken: 'initial-access',
        idToken: buildIdToken({ sub: 'user-789' }),
        refreshToken: 'initial-refresh',
        accessTokenExpires: Date.now() - 1000,
        roles: ['admin'],
        groups: ['staff'],
        permissions: derivePermissionsFromRoles(['admin']),
        sub: 'user-789',
        userInfoSynced: true,
      },
      user: null,
      account: null,
    } as any)

    const tokenRequest = fetchMock.mock.calls.find(([url]) => url === refreshTokenEndpoint)
    expect(tokenRequest).toBeDefined()
    expect(refreshedToken?.accessToken).toBe('refreshed-access')
    expect((refreshedToken as any)?.refreshToken).toBe('refreshed-refresh')
    expect((refreshedToken as any)?.accessTokenExpires).toBeGreaterThan(Date.now())
    expect((refreshedToken as any)?.refreshError).toBeUndefined()
    expect((refreshedToken as any)?.email).toBe('refreshed@example.com')
    expect((refreshedToken as any)?.displayName).toBe('Refreshed Display')

    const session = await authOptions.callbacks?.session?.({
      session: { user: {} },
      token: refreshedToken!,
    } as any)

    expect(session?.accessToken).toBe('refreshed-access')
    expect((session as any)?.accessTokenExpires).toBe((refreshedToken as any)?.accessTokenExpires)
    expect((session as any)?.error).toBeUndefined()
    expect(session?.user?.email).toBe('refreshed@example.com')
    expect(session?.user?.displayName).toBe('Refreshed Display')
  })

  it('surfaces refresh failures so the UI can prompt for reauthentication', async () => {
    const refreshTokenEndpoint = 'https://issuer.example.com/token'
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url) => {
        if (typeof url === 'string' && url.endsWith('/.well-known/openid-configuration')) {
          return {
            ok: true,
            json: async () => ({ token_endpoint: refreshTokenEndpoint }),
          }
        }
        if (url === refreshTokenEndpoint) {
          return { ok: false }
        }
        throw new Error(`Unexpected fetch call to ${String(url)}`)
      })

    vi.stubGlobal('fetch', fetchMock)

    const refreshedToken = await authOptions.callbacks?.jwt?.({
      token: {
        accessToken: 'initial-access',
        idToken: buildIdToken({ sub: 'user-789' }),
        refreshToken: 'initial-refresh',
        accessTokenExpires: Date.now() - 1000,
        roles: ['admin'],
        groups: ['staff'],
        permissions: derivePermissionsFromRoles(['admin']),
        sub: 'user-789',
        userInfoSynced: true,
      },
      user: null,
      account: null,
    } as any)

    const tokenRequest = fetchMock.mock.calls.find(([url]) => url === refreshTokenEndpoint)
    expect(tokenRequest).toBeDefined()
    expect((refreshedToken as any)?.accessToken).toBeUndefined()
    expect((refreshedToken as any)?.idToken).toBeUndefined()
    expect((refreshedToken as any)?.refreshToken).toBeUndefined()
    expect((refreshedToken as any)?.refreshError).toBe(true)

    const session = await authOptions.callbacks?.session?.({
      session: { user: {} },
      token: refreshedToken!,
    } as any)

    expect(session?.accessToken).toBeUndefined()
    expect((session as any)?.error).toBe('RefreshAccessTokenError')
    expect((session as any)?.user).toBeUndefined()
  })
})
