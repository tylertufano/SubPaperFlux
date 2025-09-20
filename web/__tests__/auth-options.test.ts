import { describe, expect, it } from 'vitest'

import { authOptions } from '../auth'
import { ALL_PERMISSIONS, derivePermissionsFromRoles } from '../lib/rbac'

type OidcProvider = {
  id: string
  profile: (profile: any) => any
}

describe('authOptions profile callback', () => {
  function getOidcProvider(): OidcProvider {
    const provider = authOptions.providers?.find((entry) => (entry as any).id === 'oidc') as OidcProvider | undefined
    if (!provider) {
      throw new Error('OIDC provider not configured for authOptions')
    }
    return provider
  }

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
})
