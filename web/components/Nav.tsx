import Link from 'next/link'
import { useRouter } from 'next/router'
import { signIn, signOut, useSession } from 'next-auth/react'
import { useI18n } from '../lib/i18n'
import { useFeatureFlags } from '../lib/featureFlags'
import React from 'react'
import DropdownMenu from './DropdownMenu'

const localeStorageKey = 'locale'

type LocaleDropdownProps = {
  locale: string
  locales: string[]
  setLocale: (l: string) => void
  t: (k: string, vars?: Record<string, string | number>) => string
  triggerClassName: string
}

function getLocaleLabel(code: string, t: LocaleDropdownProps['t']) {
  const key = `locale_${code}`
  const value = t(key)
  return value === key ? code : value
}

function LocaleDropdown({ locale, locales, setLocale, t, triggerClassName }: LocaleDropdownProps) {
  const [open, setOpen] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const menuId = React.useId()

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(localeStorageKey)
    if (stored && locales.includes(stored)) {
      setLocale(stored)
    }
  }, [locales, setLocale])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(localeStorageKey, locale)
  }, [locale])

  React.useEffect(() => {
    if (!open) return
    function handlePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('touchstart', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('touchstart', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  function focusFirstItem() {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    items && items[0]?.focus()
  }

  function focusLastItem() {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    items && items[items.length - 1]?.focus()
  }

  function focusNext(prev = false) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])
    const active = document.activeElement as HTMLElement | null
    const currentIndex = active ? items.findIndex((item) => item === active) : -1
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + (prev ? -1 : 1) + items.length) % items.length
    items[nextIndex]?.focus()
  }

  const currentLabel = getLocaleLabel(locale, t)

  return (
    <div className="relative inline-block text-sm">
      <button
        ref={buttonRef}
        type="button"
        className={`${triggerClassName} inline-flex items-center gap-1 text-sm`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('nav_locale_label')}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
            setTimeout(() => focusFirstItem(), 0)
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            setTimeout(() => focusLastItem(), 0)
          }
        }}
      >
        <span aria-hidden>{currentLabel}</span>
        <span className="ml-1 text-gray-500" aria-hidden>
          ▾
        </span>
      </button>
      <div
        id={menuId}
        ref={menuRef}
        className={(open ? 'block ' : 'hidden ') + 'absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow z-30 min-w-[150px]'}
        role="menu"
        aria-label={t('nav_locale_label')}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            focusNext(false)
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            focusNext(true)
          }
          if (event.key === 'Home') {
            event.preventDefault()
            focusFirstItem()
          }
          if (event.key === 'End') {
            event.preventDefault()
            focusLastItem()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
            buttonRef.current?.focus()
          }
        }}
      >
        {locales.map((code) => {
          const label = getLocaleLabel(code, t)
          const isActive = code === locale
          return (
            <button
              key={code}
              type="button"
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                isActive ? 'bg-gray-100 text-blue-600 font-semibold' : 'text-gray-700 hover:bg-gray-50'
              }`}
              role="menuitemradio"
              aria-checked={isActive}
              tabIndex={-1}
              onClick={() => {
                setLocale(code)
                setOpen(false)
                buttonRef.current?.focus()
              }}
            >
              <span>{label}</span>
              {isActive ? (
                <span className="ml-2 text-blue-600" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Nav() {
  const { data: session, status } = useSession()
  const { t, locale, setLocale, locales } = useI18n()
  const { pathname } = useRouter()
  const { userMgmtCore, userMgmtUi } = useFeatureFlags()
  const baseLinkStyles = 'px-2 py-1 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
  const linkClass = (href: string) =>
    `${baseLinkStyles} ${pathname === href ? 'text-blue-600 font-semibold' : 'text-gray-700 hover:text-gray-900'}`
  const accountItems = [
    { href: '/me', label: t('nav_profile') },
    { href: '/me/tokens', label: t('nav_tokens') },
    ...(userMgmtCore && userMgmtUi
      ? [
          { href: '/admin/users', label: t('nav_users') },
          { href: '/admin/roles', label: t('nav_roles') },
          { href: '/admin/audit', label: t('nav_audit') },
        ]
      : []),
    { href: '/admin', label: t('nav_admin') },
    { label: t('btn_sign_out'), onClick: () => signOut() },
  ]
  return (
    <nav className="bg-white border-b border-gray-200" role="navigation" aria-label={t('nav_main_label')}>
      <div className="container py-3 flex items-center gap-4">
        <Link href="/" className={`${baseLinkStyles} font-semibold`} aria-current={pathname === '/' ? 'page' : undefined}>
          {t('nav_brand')}
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
          <LocaleDropdown
            locale={locale}
            locales={locales}
            setLocale={setLocale}
            t={t}
            triggerClassName={`${baseLinkStyles} text-gray-700 hover:text-gray-900`}
          />
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

// Generic DropdownMenu is used for Jobs; reuse it for future menus as needed.
