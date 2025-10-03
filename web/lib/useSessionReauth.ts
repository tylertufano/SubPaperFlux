import { useEffect, useRef } from 'react'
import { signIn, signOut, useSession } from 'next-auth/react'

const REFRESH_ERROR = 'RefreshAccessTokenError'

type SessionStatus = ReturnType<typeof useSession>['status']

type SessionData = ReturnType<typeof useSession>['data']

function shouldTriggerReauth(session: SessionData, status: SessionStatus): boolean {
  if (session?.error === REFRESH_ERROR) {
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
