import Link from 'next/link'
import { useRouter } from 'next/router'
import { signIn, signOut, useSession } from 'next-auth/react'
import { useI18n } from '../lib/i18n'

export default function Nav() {
  const { data: session, status } = useSession()
  const { t, locale, setLocale } = useI18n()
  const { pathname } = useRouter()
  const linkClass = (href: string) =>
    pathname === href ? 'text-blue-600 font-semibold' : 'text-gray-700 hover:text-gray-900'
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="container py-3 flex items-center gap-4">
        <Link href="/" className="font-semibold">SubPaperFlux</Link>
        <Link href="/bookmarks" className={linkClass('/bookmarks')}>{t('nav_bookmarks')}</Link>
        <Link href="/jobs" className={linkClass('/jobs')}>{t('nav_jobs')}</Link>
        <Link href="/credentials" className={linkClass('/credentials')}>{t('nav_credentials')}</Link>
        <Link href="/site-configs" className={linkClass('/site-configs')}>{t('nav_site_configs')}</Link>
        <Link href="/admin" className={linkClass('/admin')}>{t('nav_admin')}</Link>
        <div className="ml-auto flex items-center gap-2">
          <select className="input" value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">EN</option>
          </select>
          {status === 'authenticated' ? (
            <>
              <span className="text-gray-600">{session?.user?.name}</span>
              <button className="btn" onClick={() => signOut()}>{t('btn_sign_out')}</button>
            </>
          ) : (
            <button className="btn" onClick={() => signIn('oidc')}>{t('btn_sign_in')}</button>
          )}
        </div>
      </div>
    </nav>
  )
}
