import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { authOptions } from '../auth'
import { ALL_PERMISSIONS, derivePermissionsFromRoles } from '../lib/rbac'

type OidcProvider = {
  id: string
  profile: (profile: any) => any
}

const originalFetch = globalThis.fetch

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch
  } else {
    delete (globalThis as any).fetch
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function buildIdToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
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
})
