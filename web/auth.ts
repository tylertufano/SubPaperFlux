import { Buffer } from 'node:buffer'

import NextAuth from 'next-auth'
import type { Account, NextAuthConfig, Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

import { derivePermissionsFromRoles, normalizeIdentifierList } from './lib/rbac'

const WELL_KNOWN_SUFFIX = '/.well-known/openid-configuration'

function resolveIssuer(rawIssuer: string): string {
  if (!rawIssuer) {
    return ''
  }
  if (rawIssuer.endsWith(WELL_KNOWN_SUFFIX)) {
    return rawIssuer.slice(0, -WELL_KNOWN_SUFFIX.length)
  }
  return rawIssuer
}

const issuer = resolveIssuer(process.env.OIDC_ISSUER ?? 'http://localhost/oidc')
const rawUserInfoBase = process.env.OIDC_USERINFO_ENDPOINT ?? issuer
const trimmedUserInfoBase = rawUserInfoBase.replace(/\/+$/, '')
const userInfoEndpoint = trimmedUserInfoBase.toLowerCase().endsWith('/userinfo')
  ? trimmedUserInfoBase
  : `${trimmedUserInfoBase}/userinfo`

type ClaimContainer = Record<string, unknown>

type MutableToken = JWT & {
  accessToken?: string
  displayName?: string
  email?: string
  groups?: string[]
  idToken?: string
  name?: string
  permissions?: string[]
  roles?: string[]
  sub?: string
  userId?: string
  userInfoSynced?: boolean
}

function normalizeClaimKey(key: string): string {
  const segments = key.split(/[/:]/)
  const last = segments[segments.length - 1] ?? key
  return last.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function decodeJwtClaims(token: unknown): ClaimContainer | null {
  if (typeof token !== 'string') {
    return null
  }
  const segments = token.split('.')
  if (segments.length < 2) {
    return null
  }
  try {
    const payload = Buffer.from(segments[1]!, 'base64url').toString('utf8')
    const parsed = JSON.parse(payload)
    if (parsed && typeof parsed === 'object') {
      return parsed as ClaimContainer
    }
  } catch {
    return null
  }
  return null
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

function extractFirstStringValue(source: unknown, visited: Set<unknown> = new Set()): string | undefined {
  if (source === null || source === undefined) {
    return undefined
  }
  if (typeof source === 'string') {
    const trimmed = source.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof source === 'number' || typeof source === 'boolean' || typeof source === 'bigint') {
    const text = String(source).trim()
    return text.length > 0 ? text : undefined
  }
  if (Array.isArray(source)) {
    for (const entry of source) {
      const result = extractFirstStringValue(entry, visited)
      if (result) {
        return result
      }
    }
    return undefined
  }
  if (isIterableObject(source)) {
    for (const entry of source as Iterable<unknown>) {
      const result = extractFirstStringValue(entry, visited)
      if (result) {
        return result
      }
    }
    return undefined
  }
  if (typeof source === 'object') {
    if (visited.has(source)) {
      return undefined
    }
    visited.add(source)
    for (const entry of Object.values(source as ClaimContainer)) {
      const result = extractFirstStringValue(entry, visited)
      if (result) {
        return result
      }
    }
  }
  return undefined
}

function extractStringClaim(profile: unknown, candidateKeys: readonly string[]): string | undefined {
  if (!profile || typeof profile !== 'object') {
    return undefined
  }
  const normalizedTargets = new Set(candidateKeys.map((key) => normalizeClaimKey(key)))
  const collected: unknown[] = []
  collectClaimValues(profile, normalizedTargets, collected, new Set())
  for (const entry of collected) {
    const result = extractFirstStringValue(entry)
    if (result) {
      return result
    }
  }
  return undefined
}

function extractGroups(profile: unknown): string[] {
  return extractClaimList(profile, ['groups', 'group'])
}

function extractRoles(profile: unknown): string[] {
  return extractClaimList(profile, ['roles', 'role'])
}

function applyClaimsToToken(token: MutableToken, claims: ClaimContainer): void {
  const claimRoles = extractRoles(claims)
  if (claimRoles.length > 0) {
    token.roles = normalizeIdentifierList([token.roles ?? [], claimRoles])
  }

  const claimGroups = extractGroups(claims)
  if (claimGroups.length > 0) {
    token.groups = normalizeIdentifierList([token.groups ?? [], claimGroups])
  }

  const resolvedDisplayName = resolveDisplayName(claims)
  if (resolvedDisplayName && (!token.displayName || token.displayName.trim().length === 0)) {
    token.displayName = resolvedDisplayName
  }

  const fallbackName =
    extractStringClaim(claims, ['name', 'preferred_username', 'given_name', 'display_name', 'displayName']) ||
    resolvedDisplayName
  if (fallbackName) {
    const trimmedName = fallbackName.trim()
    if (!token.name || token.name === token.sub || token.name.toString().trim().length === 0) {
      token.name = trimmedName
    }
  }

  const fallbackEmail = extractStringClaim(claims, ['email', 'mail', 'emailaddress', 'userprincipalname'])
  if (fallbackEmail) {
    const trimmedEmail = fallbackEmail.trim()
    if (trimmedEmail.length > 0) {
      token.email = trimmedEmail
    }
  }

  const fallbackUserId = extractStringClaim(claims, ['uid', 'user_id', 'userid', 'id'])
  if (fallbackUserId) {
    const trimmedUserId = fallbackUserId.trim()
    if (trimmedUserId.length > 0) {
      token.userId = trimmedUserId
    }
  }
}

function shouldSyncFromUserInfo(token: MutableToken): boolean {
  if (token.userInfoSynced) {
    return false
  }
  const missingName = !token.name || token.name === token.sub || token.name.toString().trim().length === 0
  const missingEmail = !token.email || token.email.toString().trim().length === 0
  const missingDisplayName = !token.displayName || token.displayName.toString().trim().length === 0
  const missingRoles = !Array.isArray(token.roles) || token.roles.length === 0
  const missingGroups = !Array.isArray(token.groups) || token.groups.length === 0
  const missingUserId = !token.userId || token.userId.toString().trim().length === 0
  return missingName || missingEmail || missingDisplayName || missingRoles || missingGroups || missingUserId
}

async function fetchUserInfoClaims(accessToken: unknown): Promise<ClaimContainer | null> {
  if (typeof accessToken !== 'string') {
    return null
  }
  const trimmedToken = accessToken.trim()
  if (!trimmedToken) {
    return null
  }
  if (typeof fetch !== 'function') {
    return null
  }
  try {
    const response = await fetch(userInfoEndpoint, {
      headers: { Authorization: `Bearer ${trimmedToken}` },
      cache: 'no-store',
    })
    if (!response.ok) {
      return null
    }
    const payload = await response.json()
    if (payload && typeof payload === 'object') {
      return payload as ClaimContainer
    }
  } catch {
    return null
  }
  return null
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
      const mutableToken = token as MutableToken

      if (account) {
        if (typeof account.access_token === 'string' && account.access_token.trim().length > 0) {
          mutableToken.accessToken = account.access_token
        }
        if (typeof account.id_token === 'string' && account.id_token.trim().length > 0) {
          mutableToken.idToken = account.id_token
        }
      }
      const idTokenValue =
        typeof account?.id_token === 'string'
          ? account.id_token
          : typeof mutableToken.idToken === 'string'
            ? mutableToken.idToken
            : undefined
      const idTokenClaims = idTokenValue ? decodeJwtClaims(idTokenValue) : null
      if (user && typeof user === 'object') {
        const candidate = user as {
          displayName?: unknown
          groups?: unknown
          roles?: unknown
        }
        const displayName = candidate.displayName
        if (typeof displayName === 'string' && displayName.trim().length > 0) {
          mutableToken.displayName = displayName.trim()
        } else {
          delete mutableToken.displayName
        }
        const roles = normalizeIdentifierList(candidate.roles ?? [])
        const groups = normalizeIdentifierList(candidate.groups ?? [])
        mutableToken.roles = roles
        mutableToken.groups = groups
        mutableToken.permissions = derivePermissionsFromRoles(roles)
        if (typeof (user as any).id === 'string' && (user as any).id.trim().length > 0) {
          mutableToken.userId = (user as any).id.trim()
        }
      }
      if (!Array.isArray(mutableToken.roles)) {
        mutableToken.roles = []
      }
      if (!Array.isArray(mutableToken.groups)) {
        mutableToken.groups = []
      }
      if (idTokenClaims) {
        applyClaimsToToken(mutableToken, idTokenClaims)
      }
      const accessTokenValue =
        typeof account?.access_token === 'string'
          ? account.access_token
          : typeof mutableToken.accessToken === 'string'
            ? mutableToken.accessToken
            : undefined
      if (shouldSyncFromUserInfo(mutableToken) && accessTokenValue) {
        const userInfoClaims = await fetchUserInfoClaims(accessTokenValue)
        if (userInfoClaims) {
          applyClaimsToToken(mutableToken, userInfoClaims)
          mutableToken.userInfoSynced = true
        }
      }
      mutableToken.permissions = derivePermissionsFromRoles(mutableToken.roles)
      return mutableToken
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken
      session.idToken = token.idToken
      if (session.user) {
        const mutableToken = token as MutableToken
        const explicitUserId =
          typeof mutableToken.userId === 'string' && mutableToken.userId.trim().length > 0
            ? mutableToken.userId.trim()
            : undefined
        const fallbackUserId =
          typeof mutableToken.sub === 'string' && mutableToken.sub.trim().length > 0
            ? mutableToken.sub.trim()
            : undefined
        if (explicitUserId || fallbackUserId) {
          session.user.id = explicitUserId ?? fallbackUserId
        }
        if (typeof mutableToken.name === 'string' && mutableToken.name.trim().length > 0) {
          session.user.name = mutableToken.name.trim()
        }
        if (typeof mutableToken.email === 'string' && mutableToken.email.trim().length > 0) {
          session.user.email = mutableToken.email.trim()
        }
        if (typeof mutableToken.displayName === 'string' && mutableToken.displayName.trim().length > 0) {
          session.user.displayName = mutableToken.displayName
        } else {
          delete session.user.displayName
        }
        session.user.roles = Array.isArray(mutableToken.roles) ? [...mutableToken.roles] : []
        session.user.groups = Array.isArray(mutableToken.groups) ? [...mutableToken.groups] : []
        session.user.permissions = Array.isArray(mutableToken.permissions)
          ? [...mutableToken.permissions]
          : derivePermissionsFromRoles(mutableToken.roles)
      }
      return session
    },
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
}

const { handlers, auth, signIn, signOut } = NextAuth(authOptions)

export { handlers, auth, signIn, signOut }
