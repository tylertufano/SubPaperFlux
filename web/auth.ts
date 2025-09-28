import NextAuth from 'next-auth'
import type { Account, NextAuthConfig, Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

import { derivePermissionsFromRoles, normalizeIdentifier, normalizeIdentifierList } from './lib/rbac'
import { decodeBase64UrlSegment } from './lib/base64'

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

const ACCESS_TOKEN_REFRESH_THRESHOLD_MS = 60 * 1000

const NAME_CLAIM_CANDIDATES = ['name', 'display_name', 'displayName', 'cn', 'common_name', 'commonName'] as const
const GIVEN_NAME_CLAIM_CANDIDATES = ['given_name', 'givenName', 'first_name', 'firstName'] as const
const FAMILY_NAME_CLAIM_CANDIDATES = ['family_name', 'familyName', 'last_name', 'lastName', 'surname'] as const
const USERNAME_CLAIM_CANDIDATES = ['preferred_username', 'nickname', 'preferredName'] as const
const EMAIL_CLAIM_CANDIDATES = [
  'email',
  'mail',
  'emailaddress',
  'userprincipalname',
  'upn',
  'emails',
  'primaryemail',
] as const
const USER_ID_CLAIM_CANDIDATES = ['uid', 'user_id', 'userid', 'id', 'oid', 'objectid'] as const

type ClaimContainer = Record<string, unknown>

function combineNameParts(...parts: (string | undefined)[]): string | undefined {
  const normalizedParts = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
  if (normalizedParts.length === 0) {
    return undefined
  }
  return normalizedParts.join(' ')
}

type MutableToken = JWT & {
  accessToken?: string
  accessTokenExpires?: number
  displayName?: string
  email?: string
  groups?: string[]
  idToken?: string
  name?: string
  permissions?: string[]
  refreshError?: boolean
  refreshToken?: string
  roles?: string[]
  sub?: string
  userId?: string
  userInfoSynced?: boolean
}

type GroupRoleConfig = {
  groupRoleMap: ReadonlyMap<string, readonly string[]>
  defaultRoles: readonly string[]
}

function iterTokens(raw: string): string[] {
  return raw
    .replace(/\n/g, ',')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function parseGroupRoleMap(raw: string): Map<string, string[]> {
  const mapping = new Map<string, string[]>()

  for (const token of iterTokens(raw)) {
    const separatorIndex = token.indexOf('=')
    if (separatorIndex === -1) {
      throw new Error(`Invalid group role mapping entry: ${JSON.stringify(token)}`)
    }

    const groupSegment = token.slice(0, separatorIndex)
    const roleSegment = token.slice(separatorIndex + 1)
    const normalizedGroup = normalizeIdentifier(groupSegment)
    const normalizedRole = normalizeIdentifier(roleSegment)

    if (!normalizedGroup || !normalizedRole) {
      throw new Error(`Invalid group role mapping entry: ${JSON.stringify(token)}`)
    }

    const existing = mapping.get(normalizedGroup)
    if (existing) {
      if (!existing.includes(normalizedRole)) {
        existing.push(normalizedRole)
      }
    } else {
      mapping.set(normalizedGroup, [normalizedRole])
    }
  }

  return mapping
}

function parseDefaultRoles(raw: string): string[] {
  const defaults: string[] = []
  const seen = new Set<string>()

  for (const token of iterTokens(raw)) {
    const normalized = normalizeIdentifier(token)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    defaults.push(normalized)
  }

  return defaults
}

function loadGroupRoleConfig(): GroupRoleConfig {
  const rawMap = process.env.OIDC_GROUP_ROLE_MAP ?? ''
  const rawDefaults = process.env.OIDC_GROUP_ROLE_DEFAULTS ?? ''
  const groupRoleMap = parseGroupRoleMap(rawMap)
  const defaultRoles = parseDefaultRoles(rawDefaults)
  return { groupRoleMap, defaultRoles }
}

function resolveRolesForGroups(groups: Iterable<string>): string[] {
  const config = loadGroupRoleConfig()
  const resolved: string[] = []
  const seen = new Set<string>()

  const addRole = (role: string) => {
    if (!seen.has(role)) {
      seen.add(role)
      resolved.push(role)
    }
  }

  for (const role of config.defaultRoles) {
    addRole(role)
  }

  for (const group of groups) {
    const normalizedGroup = normalizeIdentifier(group)
    if (!normalizedGroup) {
      continue
    }
    const mappedRoles = config.groupRoleMap.get(normalizedGroup)
    if (!mappedRoles) {
      continue
    }
    for (const role of mappedRoles) {
      addRole(role)
    }
  }

  return resolved
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
    const payload = decodeBase64UrlSegment(segments[1]!)
    if (!payload) {
      return null
    }
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

  const candidateClaims = ['display_name', 'displayName'] as const

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

  const givenName = extractStringClaim(record, GIVEN_NAME_CLAIM_CANDIDATES)
  const familyName = extractStringClaim(record, FAMILY_NAME_CLAIM_CANDIDATES)
  const combinedName = combineNameParts(givenName, familyName)
  if (combinedName) {
    return combinedName
  }

  const resolvedName = resolveName(record)
  if (resolvedName) {
    return resolvedName
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

function resolveName(profile: ClaimContainer): string | undefined {
  const directName = extractStringClaim(profile, NAME_CLAIM_CANDIDATES)
  if (directName) {
    return directName
  }
  const givenName = extractStringClaim(profile, GIVEN_NAME_CLAIM_CANDIDATES)
  const familyName = extractStringClaim(profile, FAMILY_NAME_CLAIM_CANDIDATES)
  const combined = combineNameParts(givenName, familyName)
  if (combined) {
    return combined
  }
  const preferredUsername = extractStringClaim(profile, USERNAME_CLAIM_CANDIDATES)
  if (preferredUsername) {
    return preferredUsername
  }
  return undefined
}

function resolveEmail(profile: ClaimContainer): string | undefined {
  const resolved = extractStringClaim(profile, EMAIL_CLAIM_CANDIDATES)
  return resolved ? resolved.trim() : undefined
}

function resolveUserId(profile: ClaimContainer): string | undefined {
  const resolved = extractStringClaim(profile, USER_ID_CLAIM_CANDIDATES)
  return resolved ? resolved.trim() : undefined
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

  const resolvedName = resolveName(claims)
  if (resolvedName) {
    token.name = resolvedName.trim()
  }

  const resolvedEmail = resolveEmail(claims)
  if (resolvedEmail) {
    token.email = resolvedEmail
  }

  const resolvedUserId = resolveUserId(claims)
  if (resolvedUserId) {
    token.userId = resolvedUserId
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

let cachedTokenEndpoint: string | null | undefined

async function resolveTokenEndpointUrl(): Promise<string | null> {
  if (cachedTokenEndpoint !== undefined) {
    return cachedTokenEndpoint
  }

  const override = process.env.OIDC_TOKEN_ENDPOINT
  if (override && override.trim().length > 0) {
    cachedTokenEndpoint = override.trim()
    return cachedTokenEndpoint
  }

  if (typeof fetch !== 'function') {
    cachedTokenEndpoint = null
    return cachedTokenEndpoint
  }

  const normalizedIssuer = issuer.replace(/\/+$/, '')
  const wellKnownUrl = `${normalizedIssuer}${WELL_KNOWN_SUFFIX}`

  try {
    const response = await fetch(wellKnownUrl, { cache: 'no-store' })
    if (!response.ok) {
      cachedTokenEndpoint = null
      return cachedTokenEndpoint
    }
    const payload = await response.json()
    if (payload && typeof payload === 'object') {
      const endpointCandidate = (payload as Record<string, unknown>).token_endpoint
      if (typeof endpointCandidate === 'string' && endpointCandidate.trim().length > 0) {
        cachedTokenEndpoint = endpointCandidate.trim()
        return cachedTokenEndpoint
      }
    }
  } catch {
    cachedTokenEndpoint = null
    return cachedTokenEndpoint
  }

  cachedTokenEndpoint = null
  return cachedTokenEndpoint
}

async function refreshAccessToken(token: MutableToken): Promise<boolean> {
  if (typeof token.refreshToken !== 'string' || token.refreshToken.trim().length === 0) {
    return false
  }
  if (typeof fetch !== 'function') {
    return false
  }

  const tokenEndpoint = await resolveTokenEndpointUrl()
  if (!tokenEndpoint) {
    return false
  }

  const params = new URLSearchParams()
  params.set('grant_type', 'refresh_token')
  params.set('refresh_token', token.refreshToken)

  const clientId = process.env.OIDC_CLIENT_ID
  if (clientId && clientId.trim().length > 0) {
    params.set('client_id', clientId.trim())
  }

  const clientSecret = process.env.OIDC_CLIENT_SECRET
  if (clientSecret && clientSecret.trim().length > 0) {
    params.set('client_secret', clientSecret.trim())
  }

  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      cache: 'no-store',
    })
    if (!response.ok) {
      return false
    }
    const payload = await response.json()
    if (!payload || typeof payload !== 'object') {
      return false
    }
    const record = payload as Record<string, unknown>

    const accessToken = record.access_token
    if (typeof accessToken === 'string' && accessToken.trim().length > 0) {
      token.accessToken = accessToken.trim()
    }

    const refreshToken = record.refresh_token
    if (typeof refreshToken === 'string' && refreshToken.trim().length > 0) {
      token.refreshToken = refreshToken.trim()
    }

    const idToken = record.id_token
    if (typeof idToken === 'string' && idToken.trim().length > 0) {
      token.idToken = idToken.trim()
    }

    const now = Date.now()
    const expiresIn = record.expires_in
    if (typeof expiresIn === 'number' && Number.isFinite(expiresIn)) {
      token.accessTokenExpires = now + expiresIn * 1000
    } else if (typeof expiresIn === 'string' && expiresIn.trim().length > 0) {
      const parsed = Number.parseFloat(expiresIn)
      if (Number.isFinite(parsed)) {
        token.accessTokenExpires = now + parsed * 1000
      }
    } else {
      const expiresAt = record.expires_at
      if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
        token.accessTokenExpires = expiresAt * 1000
      } else if (typeof expiresAt === 'string' && expiresAt.trim().length > 0) {
        const parsedExpiresAt = Number.parseFloat(expiresAt)
        if (Number.isFinite(parsedExpiresAt)) {
          token.accessTokenExpires = parsedExpiresAt * 1000
        }
      }
    }

    token.refreshError = undefined
    return true
  } catch {
    return false
  }
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
      authorization: { params: { scope: 'openid profile email groups' } },
      profile(profile: any) {
        const claimRecord =
          profile && typeof profile === 'object' ? (profile as ClaimContainer) : ({} as ClaimContainer)
        const displayName = resolveDisplayName(profile)
        const groups = extractGroups(profile)
        const roles = extractRoles(profile)
        const permissions = derivePermissionsFromRoles(roles)
        const resolvedName = resolveName(claimRecord)
        const resolvedEmail = resolveEmail(claimRecord)
        const normalizedResolvedName = resolvedName?.trim()
        const normalizedProfileName =
          typeof profile?.name === 'string' ? profile.name.trim() : undefined
        const normalizedResolvedEmail = resolvedEmail?.trim()
        const normalizedProfileEmail =
          typeof profile?.email === 'string' ? profile.email.trim() : undefined
        return {
          id: profile.sub,
          name:
            (normalizedResolvedName && normalizedResolvedName.length > 0
              ? normalizedResolvedName
              : normalizedProfileName && normalizedProfileName.length > 0
                ? normalizedProfileName
                : profile.sub),
          email:
            (normalizedResolvedEmail && normalizedResolvedEmail.length > 0
              ? normalizedResolvedEmail
              : normalizedProfileEmail && normalizedProfileEmail.length > 0
                ? normalizedProfileEmail
                : null),
          displayName: displayName ?? (normalizedResolvedName ?? null),
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
        if (typeof account.refresh_token === 'string' && account.refresh_token.trim().length > 0) {
          mutableToken.refreshToken = account.refresh_token.trim()
        }
        if (typeof account.expires_at === 'number' && Number.isFinite(account.expires_at)) {
          mutableToken.accessTokenExpires = account.expires_at * 1000
        }
        mutableToken.refreshError = undefined
      } else {
        const expiresAt = typeof mutableToken.accessTokenExpires === 'number' ? mutableToken.accessTokenExpires : undefined
        const shouldAttemptRefresh =
          typeof expiresAt === 'number' && expiresAt - Date.now() <= ACCESS_TOKEN_REFRESH_THRESHOLD_MS
        if (shouldAttemptRefresh) {
          const refreshed = await refreshAccessToken(mutableToken)
          if (!refreshed) {
            delete mutableToken.accessToken
            delete mutableToken.idToken
            delete mutableToken.refreshToken
            delete mutableToken.accessTokenExpires
            mutableToken.refreshError = true
          }
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
      if (!mutableToken.refreshError && shouldSyncFromUserInfo(mutableToken) && accessTokenValue) {
        const userInfoClaims = await fetchUserInfoClaims(accessTokenValue)
        if (userInfoClaims) {
          applyClaimsToToken(mutableToken, userInfoClaims)
          mutableToken.userInfoSynced = true
        }
      }
      const resolvedGroupRoles = resolveRolesForGroups(mutableToken.groups ?? [])
      mutableToken.roles = normalizeIdentifierList([mutableToken.roles ?? [], resolvedGroupRoles])
      mutableToken.permissions = derivePermissionsFromRoles(mutableToken.roles)
      return mutableToken
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      const mutableToken = token as MutableToken
      if (mutableToken.refreshError) {
        session.accessToken = undefined
        session.idToken = undefined
        if (session.user) {
          ;(session as any).user = undefined
        }
        ;(session as any).error = 'RefreshAccessTokenError'
        ;(session as any).accessTokenExpires = undefined
        return session
      }

      session.accessToken = mutableToken.accessToken
      session.idToken = mutableToken.idToken
      if (typeof mutableToken.accessTokenExpires === 'number' && Number.isFinite(mutableToken.accessTokenExpires)) {
        ;(session as any).accessTokenExpires = mutableToken.accessTokenExpires
      } else {
        ;(session as any).accessTokenExpires = undefined
      }
      ;(session as any).error = undefined
      if (session.user) {
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
