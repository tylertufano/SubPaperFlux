import Link from 'next/link'
import { useRouter } from 'next/router'
import { signIn, signOut, useSession } from 'next-auth/react'
import useSWR from 'swr'
import { useI18n } from '../lib/i18n'
import { useFeatureFlags } from '../lib/featureFlags'
import { v1 } from '../lib/openapi'
import { userHasAdminAccess } from '../lib/adminAccess'
import DropdownMenu from './DropdownMenu'
import {
  PERMISSION_MANAGE_BOOKMARKS,
  PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
  PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS,
  PERMISSION_READ_BOOKMARKS,
  PERMISSION_READ_GLOBAL_CREDENTIALS,
  extractPermissionList,
  hasPermission,
} from '../lib/rbac'

type SessionUser = {
  displayName?: string | null
  name?: string | null
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

export default function Nav() {
  const { data: session, status } = useSession()
  const { t } = useI18n()
  const { pathname } = useRouter()
  const { userMgmtUi } = useFeatureFlags()
  const baseLinkStyles =
    'px-2 py-1 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
  const linkClass = (href: string) =>
    `${baseLinkStyles} ${pathname === href ? 'text-blue-600 font-semibold' : 'text-gray-700 hover:text-gray-900'}`
  const permissions = extractPermissionList(session?.user)
  const userMgmtUiEnabled = Boolean(userMgmtUi)
  const isAuthenticated = status === 'authenticated'
  const isAdminUser = isAuthenticated && userHasAdminAccess(session?.user)
  const hasAdminAccess = Boolean(userMgmtUiEnabled && isAdminUser)
  const canReadBookmarksPermission = hasPermission(permissions, PERMISSION_READ_BOOKMARKS)
  const canManageBookmarksPermission = hasPermission(permissions, PERMISSION_MANAGE_BOOKMARKS)
  const canViewBookmarks = Boolean(
    isAuthenticated && (isAdminUser || canReadBookmarksPermission || canManageBookmarksPermission),
  )
  const canReadGlobalCredentialsPermission = hasPermission(permissions, PERMISSION_READ_GLOBAL_CREDENTIALS)
  const canManageGlobalCredentialsPermission = hasPermission(
    permissions,
    PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
  )
  const canReadCredentials = Boolean(
    userMgmtUiEnabled && isAuthenticated && (isAdminUser || canReadGlobalCredentialsPermission),
  )
  const canManageCredentials = Boolean(
    userMgmtUiEnabled && isAuthenticated && (isAdminUser || canManageGlobalCredentialsPermission),
  )
  const shouldShowCredentialsLink = canReadCredentials || canManageCredentials
  const canManageSiteConfigs = Boolean(
    userMgmtUiEnabled &&
      isAuthenticated &&
      (isAdminUser || hasPermission(permissions, PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS)),
  )
  const shouldShowFeedsMenu = Boolean(userMgmtUiEnabled && canViewBookmarks)
  const shouldShowBookmarksLink = canViewBookmarks
  const shouldShowJobsLink = canViewBookmarks
  const shouldShowJobSchedulesLink = Boolean(
    isAuthenticated && (isAdminUser || canManageBookmarksPermission),
  )
  const { data: setupStatus } = useSWR(
    hasAdminAccess ? ['/v1/site-settings/setup-status', 'nav'] : null,
    () => v1.getSiteSetupStatus(),
  )
  const shouldShowSetupLink = Boolean(hasAdminAccess && setupStatus?.value?.completed !== true)

  const defaultFeedsLabel = t('nav_feeds_all')
  const feedsMenuItems = [{ href: '/feeds', label: defaultFeedsLabel }]
  const hasOnlyDefaultFeedsItem =
    feedsMenuItems.length === 1 &&
    feedsMenuItems[0].href === '/feeds' &&
    feedsMenuItems[0].label === defaultFeedsLabel

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
        {shouldShowSetupLink ? (
          <Link
            href="/setup"
            className={linkClass('/setup')}
            aria-current={pathname === '/setup' ? 'page' : undefined}
          >
            {t('nav_setup')}
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
        {shouldShowCredentialsLink ? (
          <Link
            href="/credentials"
            className={linkClass('/credentials')}
            aria-current={pathname === '/credentials' ? 'page' : undefined}
          >
            {t('nav_credentials')}
          </Link>
        ) : null}
        {shouldShowFeedsMenu ? (
          hasOnlyDefaultFeedsItem ? (
            <Link
              href="/feeds"
              className={linkClass('/feeds')}
              aria-current={pathname === '/feeds' ? 'page' : undefined}
            >
              {t('nav_feeds')}
            </Link>
          ) : (
            <DropdownMenu
              label={t('nav_feeds')}
              baseHref="/feeds"
              currentPath={pathname}
              items={feedsMenuItems}
            />
          )
        ) : null}
        {shouldShowBookmarksLink ? (
          <Link
            href="/bookmarks"
            className={linkClass('/bookmarks')}
            aria-current={pathname === '/bookmarks' ? 'page' : undefined}
          >
            {t('nav_bookmarks')}
          </Link>
        ) : null}
        {shouldShowJobSchedulesLink ? (
          <Link
            href="/job-schedules"
            className={linkClass('/job-schedules')}
            aria-current={pathname === '/job-schedules' ? 'page' : undefined}
          >
            {t('nav_job_schedules')}
          </Link>
        ) : null}
        {shouldShowJobsLink ? (
          <Link href="/jobs" className={linkClass('/jobs')} aria-current={pathname === '/jobs' ? 'page' : undefined}>
            {t('nav_jobs')}
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
            <button
              type="button"
              className={`${baseLinkStyles} text-gray-700 hover:text-gray-900`}
              onClick={() => signIn('oidc')}
            >
              {t('btn_sign_in')}
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}

// Generic DropdownMenu is used for feeds and account menus; reuse it for future menus as needed.
