import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import enMessages from '../locales/en/common.json'

type Messages = Record<string, string>
type Catalog = Record<string, Messages>

const catalog: Catalog = {
  en: enMessages as Messages,
}

type I18nCtx = { locale: string; setLocale: (l: string) => void; t: (k: string, vars?: Record<string, string | number>) => string }
const Ctx = createContext<I18nCtx>({ locale: 'en', setLocale: () => {}, t: (k) => k })
export const I18nContext = Ctx

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState('en')
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('locale') : null
    if (saved) setLocale(saved)
  }, [])
  const t = useMemo(() => {
    const messages = catalog[locale] || catalog.en
    return (k: string, vars?: Record<string, string | number>) => {
      const template = messages[k] ?? k
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : ''))
    }
  }, [locale])
  const setL = (l: string) => { setLocale(l); if (typeof window !== 'undefined') localStorage.setItem('locale', l) }
  return <Ctx.Provider value={{ locale, setLocale: setL, t }}>{children}</Ctx.Provider>
}

export function useI18n() { return useContext(Ctx) }
