import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import enMessages from '../locales/en/common.json'
import pseudoMessages from '../locales/pseudo/common.json'

type Messages = Record<string, string>
type Catalog = Record<string, Messages>

const catalog: Catalog = {
  en: enMessages as Messages,
  pseudo: pseudoMessages as Messages,
}

const supportedLocales = Object.keys(catalog)
const storageKey = 'locale'

type I18nCtx = {
  locale: string
  locales: string[]
  setLocale: (l: string) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}
const Ctx = createContext<I18nCtx>({ locale: 'en', locales: supportedLocales, setLocale: () => {}, t: (k) => k })
export const I18nContext = Ctx

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState('en')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem(storageKey)
    if (saved && supportedLocales.includes(saved)) {
      setLocaleState(saved)
    }
  }, [])
  const t = useMemo(() => {
    const messages = { ...catalog.en, ...(catalog[locale] || {}) }
    return (k: string, vars?: Record<string, string | number>) => {
      const template = messages[k] ?? k
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : ''))
    }
  }, [locale])
  const setL = (l: string) => {
    const next = supportedLocales.includes(l) ? l : 'en'
    setLocaleState(next)
    if (typeof window !== 'undefined') localStorage.setItem(storageKey, next)
  }
  return <Ctx.Provider value={{ locale, locales: supportedLocales, setLocale: setL, t }}>{children}</Ctx.Provider>
}

export function useI18n() { return useContext(Ctx) }
