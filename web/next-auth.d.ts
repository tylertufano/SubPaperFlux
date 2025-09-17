import '@auth/core/jwt'
import '@auth/core/types'
import type { NextAuthConfig as NextAuthConfigBase } from 'next-auth/lib/index.js'

export type { Account, DefaultSession, Profile, Session, User } from '@auth/core/types'
export type { NextAuthConfigBase as NextAuthConfig }
export * from 'next-auth/lib/index.js'
export { default } from 'next-auth/lib/index.js'

declare module '@auth/core/types' {
  interface Session {
    accessToken?: string
    idToken?: string
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    accessToken?: string
    idToken?: string
  }
}
