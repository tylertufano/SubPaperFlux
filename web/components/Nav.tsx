import Link from 'next/link'
import { signIn, signOut, useSession } from 'next-auth/react'
import { useI18n } from '../lib/i18n'

export default function Nav() {
  const { data: session, status } = useSession()
  const { t, locale, setLocale } = useI18n()
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="container py-3 flex items-center gap-4">
        <Link href="/" className="font-semibold">SubPaperFlux</Link>
        <Link href="/bookmarks" className="text-gray-700 hover:text-gray-900">{t('nav_bookmarks')}</Link>
        <Link href="/jobs" className="text-gray-700 hover:text-gray-900">{t('nav_jobs')}</Link>
        <Link href="/credentials" className="text-gray-700 hover:text-gray-900">{t('nav_credentials')}</Link>
        <Link href="/site-configs" className="text-gray-700 hover:text-gray-900">{t('nav_site_configs')}</Link>
        <Link href="/admin" className="text-gray-700 hover:text-gray-900">{t('nav_admin')}</Link>
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
