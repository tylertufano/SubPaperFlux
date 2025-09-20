import NextAuth from 'next-auth'
import type { Account, NextAuthConfig, Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

import { derivePermissionsFromRoles, normalizeIdentifierList } from './lib/rbac'

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

type ClaimContainer = Record<string, unknown>

function isIterableObject(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as any)[Symbol.iterator] === 'function'
}

function collectClaimValues(
  source: unknown,
  normalizedTargets: Set<string>,
  results: unknown[],
  visited: Set<unknown>,
): void {
  if (source === null || source === undefined) {
    return
  }
  if (typeof source !== 'object') {
    return
  }
  if (visited.has(source)) {
    return
  }
  visited.add(source)

  if (isIterableObject(source)) {
    for (const entry of source) {
      collectClaimValues(entry, normalizedTargets, results, visited)
    }
    return
  }

  const record = source as ClaimContainer
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeClaimKey(key)
    if (normalizedTargets.has(normalizedKey)) {
      results.push(value)
    }
    collectClaimValues(value, normalizedTargets, results, visited)
  }
}

function extractClaimList(profile: unknown, candidateKeys: readonly string[]): string[] {
  if (!profile || typeof profile !== 'object') {
    return []
  }
  const normalizedTargets = new Set(candidateKeys.map((key) => normalizeClaimKey(key)))
  const collected: unknown[] = []
  collectClaimValues(profile, normalizedTargets, collected, new Set())
  return normalizeIdentifierList(collected)
}

function extractGroups(profile: unknown): string[] {
  return extractClaimList(profile, ['groups', 'group'])
}

function extractRoles(profile: unknown): string[] {
  return extractClaimList(profile, ['roles', 'role'])
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
        const groups = extractGroups(profile)
        const roles = extractRoles(profile)
        const permissions = derivePermissionsFromRoles(roles)
        return {
          id: profile.sub,
          name: profile.name || profile.preferred_username || profile.sub,
          email: profile.email,
          displayName: displayName ?? null,
          groups,
          roles,
          permissions,
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
      if (user && typeof user === 'object') {
        const candidate = user as {
          displayName?: unknown
          groups?: unknown
          roles?: unknown
        }
        const displayName = candidate.displayName
        if (typeof displayName === 'string' && displayName.trim().length > 0) {
          token.displayName = displayName.trim()
        } else {
          delete token.displayName
        }
        const roles = normalizeIdentifierList(candidate.roles ?? [])
        const groups = normalizeIdentifierList(candidate.groups ?? [])
        token.roles = roles
        token.groups = groups
        token.permissions = derivePermissionsFromRoles(roles)
      }
      if (!Array.isArray(token.roles)) {
        token.roles = []
      }
      if (!Array.isArray(token.groups)) {
        token.groups = []
      }
      token.permissions = derivePermissionsFromRoles(token.roles)
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
        session.user.roles = Array.isArray(token.roles) ? [...token.roles] : []
        session.user.groups = Array.isArray(token.groups) ? [...token.groups] : []
        session.user.permissions = Array.isArray(token.permissions)
          ? [...token.permissions]
          : derivePermissionsFromRoles(token.roles)
      }
      return session
    },
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
}

const { handlers, auth, signIn, signOut } = NextAuth(authOptions)

export { handlers, auth, signIn, signOut }
