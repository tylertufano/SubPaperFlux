import Link from 'next/link'
import { useRouter } from 'next/router'
import { signIn, signOut, useSession } from 'next-auth/react'
import { useI18n } from '../lib/i18n'
import { useFeatureFlags } from '../lib/featureFlags'
import DropdownMenu from './DropdownMenu'

type AdminCandidate = Record<string, unknown>

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
  const hasAdminAccess = Boolean(userMgmtCore && userMgmtUi && userHasAdminAccess(session?.user))

  const adminAccountItems = hasAdminAccess
    ? [
        { href: '/admin', label: t('nav_admin') },
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

  return (
    <nav className="bg-white border-b border-gray-200" role="navigation" aria-label={t('nav_main_label')}>
      <div className="container py-3 flex items-center gap-4">
        <Link href="/" className={`${baseLinkStyles} font-semibold`} aria-current={pathname === '/' ? 'page' : undefined}>
          {t('nav_brand')}
        </Link>
        <Link
          href="/bookmarks"
          className={linkClass('/bookmarks')}
          aria-current={pathname === '/bookmarks' ? 'page' : undefined}
        >
          {t('nav_bookmarks')}
        </Link>
        <Link href="/jobs" className={linkClass('/jobs')} aria-current={pathname === '/jobs' ? 'page' : undefined}>
          {t('nav_jobs')}
        </Link>
        <DropdownMenu
          label={t('nav_feeds')}
          baseHref="/feeds"
          currentPath={pathname}
          items={[
            { href: '/feeds', label: t('nav_feeds_all') },
            { href: '/feeds#create-feed', label: t('nav_feeds_create') },
          ]}
        />
        <Link
          href="/credentials"
          className={linkClass('/credentials')}
          aria-current={pathname === '/credentials' ? 'page' : undefined}
        >
          {t('nav_credentials')}
        </Link>
        <Link
          href="/site-configs"
          className={linkClass('/site-configs')}
          aria-current={pathname === '/site-configs' ? 'page' : undefined}
        >
          {t('nav_site_configs')}
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {status === 'authenticated' ? (
            <DropdownMenu
              label={session?.user?.name ? String(session.user.name) : t('nav_account_fallback')}
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
