import { useEffect, useRef } from 'react'
import { signIn, signOut, useSession } from 'next-auth/react'
import type { Session } from 'next-auth'

const REFRESH_ERROR = 'RefreshAccessTokenError'

type SessionStatus = ReturnType<typeof useSession>['status']

type SessionData = ReturnType<typeof useSession>['data']

type SessionWithOptionalError = Session & { error?: unknown }

function getSessionError(session: SessionData): unknown {
  if (!session) return undefined
  if (typeof session !== 'object') return undefined
  return (session as SessionWithOptionalError).error
}

function shouldTriggerReauth(session: SessionData, status: SessionStatus): boolean {
  if (getSessionError(session) === REFRESH_ERROR) {
    return true
  }
  if (status === 'authenticated' && !session?.user) {
    return true
  }
  return false
}

export function useSessionReauth(): ReturnType<typeof useSession> {
  const sessionResult = useSession()
  const triggeredRef = useRef(false)
  const { data: session, status } = sessionResult

  useEffect(() => {
    if (triggeredRef.current) return
    if (!shouldTriggerReauth(session, status)) return
    triggeredRef.current = true

    void (async () => {
      try {
        await signOut({ redirect: false })
      } catch (error) {
        console.error('Failed to sign out before reauthentication', error)
      } finally {
        await signIn()
      }
    })()
  }, [session, status])

  return sessionResult
}
