import Link from 'next/link'
import { useRouter } from 'next/router'
import { signIn, signOut, useSession } from 'next-auth/react'
import { useI18n } from '../lib/i18n'
import React from 'react'
import DropdownMenu from './DropdownMenu'

export default function Nav() {
  const { data: session, status } = useSession()
  const { t, locale, setLocale } = useI18n()
  const { pathname } = useRouter()
  const baseLinkStyles = 'px-2 py-1 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
  const linkClass = (href: string) =>
    `${baseLinkStyles} ${pathname === href ? 'text-blue-600 font-semibold' : 'text-gray-700 hover:text-gray-900'}`
  return (
    <nav className="bg-white border-b border-gray-200" role="navigation" aria-label={t('nav_main_label')}>
      <div className="container py-3 flex items-center gap-4">
        <Link href="/" className={`${baseLinkStyles} font-semibold`} aria-current={pathname === '/' ? 'page' : undefined}>
          SubPaperFlux
        </Link>
        <Link href="/bookmarks" className={linkClass('/bookmarks')} aria-current={pathname === '/bookmarks' ? 'page' : undefined}>
          {t('nav_bookmarks')}
        </Link>
        <DropdownMenu
          label={t('nav_jobs')}
          baseHref="/jobs"
          currentPath={pathname}
          items={[
            { href: '/jobs', label: t('nav_jobs_all') },
            { href: '/jobs-dead', label: t('nav_jobs_dead') },
          ]}
        />
        <DropdownMenu
          label={t('nav_feeds')}
          baseHref="/feeds"
          currentPath={pathname}
          items={[
            { href: '/feeds', label: t('nav_feeds_all') },
            { href: '/feeds#create-feed', label: t('nav_feeds_create') },
          ]}
        />
        <DropdownMenu
          label={t('nav_credentials')}
          baseHref="/credentials"
          currentPath={pathname}
          items={[
            { href: '/credentials', label: t('credentials_title') },
            { href: '/credentials#create-credential', label: t('nav_credentials_create') },
          ]}
        />
        <DropdownMenu
          label={t('nav_site_configs')}
          baseHref="/site-configs"
          currentPath={pathname}
          items={[
            { href: '/site-configs', label: t('site_configs_title') },
            { href: '/site-configs#create-site-config', label: t('nav_site_configs_create') },
          ]}
        />
        <Link href="/admin" className={linkClass('/admin')} aria-current={pathname === '/admin' ? 'page' : undefined}>
          {t('nav_admin')}
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {status === 'authenticated' ? (
            <DropdownMenu
              label={session?.user?.name ? String(session.user.name) : t('nav_account_fallback')}
              baseHref={pathname}
              currentPath={pathname}
              items={[
                { href: '/me', label: t('nav_profile') },
                { href: '/me/tokens', label: t('nav_tokens') },
                { href: '/admin/users', label: t('nav_users') },
                { href: '/admin/audit', label: t('nav_audit') },
                { href: '/admin', label: t('nav_admin') },
                { label: t('btn_sign_out'), onClick: () => signOut() },
              ]}
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

// Generic DropdownMenu is used for Jobs; reuse it for future menus as needed.
