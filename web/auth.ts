import NextAuth from 'next-auth'
import type { Account, NextAuthConfig, Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

const issuer = process.env.OIDC_ISSUER!

function normalizeClaimKey(key: string): string {
  const segments = key.split(/[/:]/)
  const last = segments[segments.length - 1] ?? key
  return last.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function resolveDisplayName(profile: unknown): string | undefined {
  if (!profile || typeof profile !== 'object') {
    return undefined
  }

  const record = profile as Record<string, unknown>
  const explicitClaim = typeof process.env.OIDC_DISPLAY_NAME_CLAIM === 'string'
    ? process.env.OIDC_DISPLAY_NAME_CLAIM.trim()
    : ''

  if (explicitClaim) {
    const explicit = record[explicitClaim]
    if (typeof explicit === 'string') {
      const trimmed = explicit.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }

  const candidateClaims = ['display_name', 'displayName']

  for (const claim of candidateClaims) {
    const raw = record[claim]
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }

  const normalizedTargets = new Set(candidateClaims.map((claim) => normalizeClaimKey(claim)))
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      continue
    }
    if (normalizedTargets.has(normalizeClaimKey(key))) {
      const trimmed = value.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }

  return undefined
}

export const authOptions: NextAuthConfig = {
  providers: [
    {
      id: 'oidc',
      name: 'OIDC',
      type: 'oidc',
      issuer,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      idToken: true,
      checks: ['pkce', 'state'],
      authorization: { params: { scope: 'openid profile email' } },
      profile(profile: any) {
        const displayName = resolveDisplayName(profile)
        return {
          id: profile.sub,
          name: profile.name || profile.preferred_username || profile.sub,
          email: profile.email,
          displayName: displayName ?? null,
        }
      },
    } as any,
  ],
  callbacks: {
    async jwt({ token, user, account }: { token: JWT; user?: User | null; account: Account | null | undefined }) {
      if (account) {
        token.accessToken = account.access_token
        token.idToken = account.id_token
      }
      if (user && typeof user === 'object' && 'displayName' in user) {
        const displayName = (user as { displayName?: unknown }).displayName
        if (typeof displayName === 'string' && displayName.trim().length > 0) {
          token.displayName = displayName.trim()
        } else {
          delete token.displayName
        }
      }
      return token
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken
      session.idToken = token.idToken
      if (session.user) {
        if (typeof token.displayName === 'string' && token.displayName.trim().length > 0) {
          session.user.displayName = token.displayName
        } else {
          delete session.user.displayName
        }
      }
      return session
    },
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
}

const { handlers, auth, signIn, signOut } = NextAuth(authOptions)

export { handlers, auth, signIn, signOut }
