import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Messages = Record<string, string>
type Catalog = Record<string, Messages>

const catalog: Catalog = {
  en: {
    home_welcome: 'Welcome. Use the navigation to explore bookmarks, jobs, and admin tools.',
    nav_bookmarks: 'Bookmarks',
    nav_jobs: 'Jobs',
    nav_credentials: 'Credentials',
    nav_site_configs: 'Site Configs',
    nav_admin: 'Admin',
    btn_sign_in: 'Sign in',
    btn_sign_out: 'Sign out',
    bookmarks_title: 'Bookmarks',
    bookmarks_search: 'Search',
    bookmarks_saved_views: 'Saved Views',
    bookmarks_save_as: 'Save as...',
    jobs_title: 'Jobs',
    credentials_title: 'Credentials',
    site_configs_title: 'Site Configs',
  },
}

type I18nCtx = { locale: string; setLocale: (l: string) => void; t: (k: string) => string }
const Ctx = createContext<I18nCtx>({ locale: 'en', setLocale: () => {}, t: (k) => k })

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState('en')
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('locale') : null
    if (saved) setLocale(saved)
  }, [])
  const t = useMemo(() => {
    const messages = catalog[locale] || catalog.en
    return (k: string) => messages[k] ?? k
  }, [locale])
  const setL = (l: string) => { setLocale(l); if (typeof window !== 'undefined') localStorage.setItem('locale', l) }
  return <Ctx.Provider value={{ locale, setLocale: setL, t }}>{children}</Ctx.Provider>
}

export function useI18n() { return useContext(Ctx) }

