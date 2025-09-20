import Link from 'next/link'
import { useRouter } from 'next/router'
import { signIn, signOut, useSession } from 'next-auth/react'
import { useI18n } from '../lib/i18n'
import { useFeatureFlags } from '../lib/featureFlags'
import DropdownMenu from './DropdownMenu'
import {
  PERMISSION_MANAGE_BOOKMARKS,
  PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
  PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS,
  hasPermission,
} from '../lib/rbac'

type AdminCandidate = Record<string, unknown>

type SessionUser = {
  displayName?: string | null
  name?: string | null
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as any)[Symbol.iterator] === 'function'
}

function extractPermissionList(user: unknown): string[] {
  if (!user || typeof user !== 'object') {
    return []
  }
  const record = user as { permissions?: unknown }
  const { permissions } = record
  if (!permissions) {
    return []
  }
  const results: string[] = []
  const add = (value: unknown) => {
    if (typeof value !== 'string') {
      return
    }
    const trimmed = value.trim()
    if (trimmed) {
      results.push(trimmed)
    }
  }
  if (typeof permissions === 'string') {
    add(permissions)
    return results
  }
  if (Array.isArray(permissions)) {
    for (const entry of permissions) {
      add(entry)
    }
    return results
  }
  if (isIterable(permissions)) {
    for (const entry of permissions) {
      add(entry)
    }
  }
  return results
}

function extractFirstName(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const commaIndex = trimmed.indexOf(',')
  const base = commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed
  const normalized = base.trim()
  if (!normalized) {
    return null
  }
  const [first] = normalized.split(/\s+/)
  return first || null
}

function normalizeDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function accountLabelFromUser(user: SessionUser | null | undefined): string | null {
  if (!user) {
    return null
  }
  const fromDisplayName = normalizeDisplayName(user.displayName)
  if (fromDisplayName) {
    return fromDisplayName
  }
  return extractFirstName(user.name)
}

function includesAdminRole(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.toLowerCase() === 'admin')
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'admin'
  }
  return false
}

function userHasAdminAccess(user: unknown): boolean {
  if (!user || typeof user !== 'object') {
    return false
  }
  const candidate = user as AdminCandidate
  if (typeof candidate.isAdmin === 'boolean') {
    return candidate.isAdmin
  }
  if (typeof candidate.is_admin === 'boolean') {
    return candidate.is_admin
  }
  const roleSources = [candidate.roles, candidate.groups, candidate.permissions, candidate.role, candidate.group]
  return roleSources.some((source) => includesAdminRole(source))
}

export default function Nav() {
  const { data: session, status } = useSession()
  const { t } = useI18n()
  const { pathname } = useRouter()
  const { userMgmtCore, userMgmtUi } = useFeatureFlags()
  const baseLinkStyles =
    'px-2 py-1 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
  const linkClass = (href: string) =>
    `${baseLinkStyles} ${pathname === href ? 'text-blue-600 font-semibold' : 'text-gray-700 hover:text-gray-900'}`
  const permissions = extractPermissionList(session?.user)
  const userMgmtEnabled = Boolean(userMgmtCore && userMgmtUi)
  const isAuthenticated = status === 'authenticated'
  const isAdminUser = isAuthenticated && userHasAdminAccess(session?.user)
  const hasAdminAccess = Boolean(userMgmtEnabled && isAdminUser)
  const canManageFeeds = Boolean(
    userMgmtEnabled &&
      isAuthenticated &&
      (isAdminUser || hasPermission(permissions, PERMISSION_MANAGE_BOOKMARKS)),
  )
  const canManageCredentials = Boolean(
    userMgmtEnabled &&
      isAuthenticated &&
      (isAdminUser || hasPermission(permissions, PERMISSION_MANAGE_GLOBAL_CREDENTIALS)),
  )
  const canManageSiteConfigs = Boolean(
    userMgmtEnabled &&
      isAuthenticated &&
      (isAdminUser || hasPermission(permissions, PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS)),
  )
  const shouldShowFeedsMenu = userMgmtEnabled && isAuthenticated
  const shouldShowBookmarksLink = isAuthenticated
  const shouldShowJobsLink = isAuthenticated

  const adminAccountItems = hasAdminAccess
    ? [
        { href: '/admin', label: t('nav_admin') },
        { href: '/admin/site-settings', label: t('nav_site_settings') },
        { href: '/admin/users', label: t('nav_users') },
        { href: '/admin/roles', label: t('nav_roles') },
        { href: '/admin/orgs', label: t('nav_orgs') },
        { href: '/admin/audit', label: t('nav_audit') },
      ]
    : []

  const accountItems = [
    { href: '/me', label: t('nav_profile') },
    { href: '/me/tokens', label: t('nav_tokens') },
    ...adminAccountItems,
    { label: t('btn_sign_out'), onClick: () => signOut() },
  ]

  const accountLabel = accountLabelFromUser(session?.user) ?? t('nav_account_fallback')

  return (
    <nav className="bg-white border-b border-gray-200" role="navigation" aria-label={t('nav_main_label')}>
      <div className="container py-3 flex items-center gap-4">
        <Link href="/" className={`${baseLinkStyles} font-semibold`} aria-current={pathname === '/' ? 'page' : undefined}>
          {t('nav_brand')}
        </Link>
        {shouldShowBookmarksLink ? (
          <Link
            href="/bookmarks"
            className={linkClass('/bookmarks')}
            aria-current={pathname === '/bookmarks' ? 'page' : undefined}
          >
            {t('nav_bookmarks')}
          </Link>
        ) : null}
        {shouldShowJobsLink ? (
          <Link href="/jobs" className={linkClass('/jobs')} aria-current={pathname === '/jobs' ? 'page' : undefined}>
            {t('nav_jobs')}
          </Link>
        ) : null}
        {shouldShowFeedsMenu ? (
          <DropdownMenu
            label={t('nav_feeds')}
            baseHref="/feeds"
            currentPath={pathname}
            items={[
              { href: '/feeds', label: t('nav_feeds_all') },
              ...(canManageFeeds ? [{ href: '/feeds#create-feed', label: t('nav_feeds_create') }] : []),
            ]}
          />
        ) : null}
        {canManageCredentials ? (
          <Link
            href="/credentials"
            className={linkClass('/credentials')}
            aria-current={pathname === '/credentials' ? 'page' : undefined}
          >
            {t('nav_credentials')}
          </Link>
        ) : null}
        {canManageSiteConfigs ? (
          <Link
            href="/site-configs"
            className={linkClass('/site-configs')}
            aria-current={pathname === '/site-configs' ? 'page' : undefined}
          >
            {t('nav_site_configs')}
          </Link>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {status === 'authenticated' ? (
            <DropdownMenu
              label={accountLabel}
              baseHref={pathname}
              currentPath={pathname}
              items={accountItems}
            />
          ) : (
            <DropdownMenu
              label={t('btn_sign_in')}
              baseHref={pathname}
              currentPath={pathname}
              items={[{ label: t('btn_sign_in'), onClick: () => signIn('oidc') }]}
            />
          )}
        </div>
      </div>
    </nav>
  )
}

// Generic DropdownMenu is used for feeds and account menus; reuse it for future menus as needed.
