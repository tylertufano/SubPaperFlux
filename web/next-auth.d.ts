import '@auth/core/jwt'
import '@auth/core/types'
import type { DefaultSession } from 'next-auth'
import type { NextAuthConfig as NextAuthConfigBase } from 'next-auth/lib/index.js'

export type { Account, DefaultSession, Profile, Session, User } from '@auth/core/types'
export type { NextAuthConfigBase as NextAuthConfig }
export * from 'next-auth/lib/index.js'
export { default } from 'next-auth/lib/index.js'

declare module '@auth/core/types' {
  interface Session {
    accessToken?: string
    idToken?: string
    user?:
      | (DefaultSession['user'] & {
          displayName?: string | null
          groups?: string[]
          roles?: string[]
          permissions?: string[]
        })
      | undefined
  }

  interface User {
    displayName?: string | null
    groups?: string[]
    roles?: string[]
    permissions?: string[]
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    accessToken?: string
    idToken?: string
    displayName?: string
    groups?: string[]
    roles?: string[]
    permissions?: string[]
  }
}
