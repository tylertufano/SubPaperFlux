import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionReauth } from '../lib/useSessionReauth'

const authMocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
  signIn: vi.fn(),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => authMocks.useSession(),
  signOut: authMocks.signOut,
  signIn: authMocks.signIn,
}))

function TestComponent() {
  useSessionReauth()
  return null
}

describe('useSessionReauth', () => {
  beforeEach(() => {
    authMocks.useSession.mockReset()
    authMocks.signOut.mockReset()
    authMocks.signIn.mockReset()
  })

  it('triggers reauthentication when the session reports a refresh error', async () => {
    authMocks.useSession.mockReturnValue({
      data: { error: 'RefreshAccessTokenError' },
      status: 'authenticated',
    })
    authMocks.signOut.mockResolvedValue(undefined)
    authMocks.signIn.mockResolvedValue(undefined)

    render(<TestComponent />)

    await waitFor(() => {
      expect(authMocks.signOut).toHaveBeenCalledWith({ redirect: false })
    })
    expect(authMocks.signIn).toHaveBeenCalled()
  })

  it('requests reauthentication if the session is authenticated without a user', async () => {
    authMocks.useSession.mockReturnValue({
      data: { user: undefined },
      status: 'authenticated',
    })
    authMocks.signOut.mockResolvedValue(undefined)
    authMocks.signIn.mockResolvedValue(undefined)

    render(<TestComponent />)

    await waitFor(() => {
      expect(authMocks.signOut).toHaveBeenCalled()
    })
    expect(authMocks.signIn).toHaveBeenCalled()
  })

  it('does not trigger reauthentication for a healthy session', async () => {
    authMocks.useSession.mockReturnValue({
      data: { user: { id: 'user-1' } },
      status: 'authenticated',
    })

    render(<TestComponent />)

    await waitFor(() => {
      expect(authMocks.signOut).not.toHaveBeenCalled()
      expect(authMocks.signIn).not.toHaveBeenCalled()
    })
  })
})
