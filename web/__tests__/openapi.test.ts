import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authMock, signInMock, getSessionMock } = vi.hoisted(() => ({
  authMock: vi.fn(async () => null),
  signInMock: vi.fn(async () => undefined),
  getSessionMock: vi.fn(async () => null),
}))

vi.mock('../auth', () => ({
  auth: () => authMock(),
  signIn: (...args: any[]) => signInMock(...args),
}))

vi.mock('next-auth/react', () => ({
  getSession: () => getSessionMock(),
}))

describe('authorizedRequest', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  afterEach(() => {
    vi.restoreAllMocks()
    authMock.mockReset()
    signInMock.mockReset()
    getSessionMock.mockReset()
    if (originalFetch) {
      global.fetch = originalFetch
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch
    }
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key]
      }
    })
    Object.assign(process.env, originalEnv)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window
    vi.resetModules()
  })

  beforeEach(() => {
    vi.resetModules()
    authMock.mockImplementation(async () => null)
    signInMock.mockImplementation(async () => undefined)
    getSessionMock.mockImplementation(async () => null)
  })

  it('triggers an OIDC sign-in redirect in the browser on 401 responses', async () => {
    process.env.NEXT_PUBLIC_OIDC_AUTO_LOGIN = 'true'
    const windowMock: any = {
      location: {
        href: 'https://app.example.com/library',
        protocol: 'https:',
      },
    }
    windowMock.__SPF_UI_CONFIG = {
      apiBase: 'https://api.example.com',
      userMgmtCore: true,
      userMgmtUi: true,
    }
    ;(globalThis as any).window = windowMock

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: vi.fn(async () => 'Unauthorized'),
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    const { createInstapaperCredentialFromLogin, AuthorizationRedirectError } = await import('../lib/openapi')

    let signInResolved = false
    signInMock.mockImplementation(async (...args: any[]) => {
      signInResolved = true
      return undefined
    })

    await expect(
      createInstapaperCredentialFromLogin({ description: 'd', username: 'u', password: 'p' }),
    ).rejects.toBeInstanceOf(AuthorizationRedirectError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signInMock).toHaveBeenCalledWith('oidc', {
      callbackUrl: 'https://app.example.com/library',
      redirect: true,
    })
    expect(signInResolved).toBe(true)
  })

  it('uses a server-side fallback callback URL when window is unavailable', async () => {
    process.env.NEXT_PUBLIC_OIDC_AUTO_LOGIN = 'true'
    process.env.API_BASE = 'https://api.example.com'
    process.env.NEXTAUTH_URL = 'https://app.example.com/after-login'

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: vi.fn(async () => 'Unauthorized'),
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    const { createInstapaperCredentialFromLogin, AuthorizationRedirectError } = await import('../lib/openapi')

    await expect(
      createInstapaperCredentialFromLogin({ description: 'd', username: 'u', password: 'p' }),
    ).rejects.toBeInstanceOf(AuthorizationRedirectError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signInMock).toHaveBeenCalledWith('oidc', {
      callbackUrl: 'https://app.example.com/after-login',
      redirect: true,
    })
  })

  it('does not trigger automatic sign-in when auto-login is disabled', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: vi.fn(async () => 'Unauthorized'),
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    const { createInstapaperCredentialFromLogin } = await import('../lib/openapi')

    await expect(
      createInstapaperCredentialFromLogin({ description: 'd', username: 'u', password: 'p' }),
    ).rejects.toThrowError('Unauthorized')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signInMock).not.toHaveBeenCalled()
  })
})
