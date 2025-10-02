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

export const DEFAULT_LOCALE = 'en'

type StorageLike = Pick<Storage, 'getItem'>

const safeGetItem = (storage?: StorageLike, key?: string): string | undefined => {
  if (!storage || !key) return undefined
  try {
    return storage.getItem(key) ?? undefined
  } catch (error) {
    console.warn('Unable to access storage for locale detection', error)
    return undefined
  }
}

const normalizeLocale = (locale?: string | null): string | undefined => {
  if (!locale) return undefined
  const lower = locale.toLowerCase()
  if (supportedLocales.includes(lower)) return lower
  const base = lower.split(/[-_]/)[0]
  if (base && supportedLocales.includes(base)) return base
  return undefined
}

type DetectLocaleOptions = {
  defaultLocale?: string
  storage?: StorageLike
  navigatorLanguages?: readonly string[] | null
  navigatorLanguage?: string | null
  documentLocale?: string | null
}

export const detectLocale = (options?: DetectLocaleOptions): string => {
  const documentLocale = options?.documentLocale ?? (typeof document !== 'undefined' ? document.documentElement.lang : undefined)
  const fallback = normalizeLocale(options?.defaultLocale)
    ?? normalizeLocale(documentLocale)
    ?? DEFAULT_LOCALE

  const storageSource = options?.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  const saved = normalizeLocale(safeGetItem(storageSource, storageKey))
  if (saved) return saved

  const languages = options?.navigatorLanguages ?? (typeof navigator !== 'undefined' ? navigator.languages : undefined)
  if (languages) {
    for (const locale of languages) {
      const normalized = normalizeLocale(locale)
      if (normalized) return normalized
    }
  }

  const language = options?.navigatorLanguage ?? (typeof navigator !== 'undefined' ? navigator.language : undefined)
  const normalizedLanguage = normalizeLocale(language)
  if (normalizedLanguage) return normalizedLanguage

  return fallback
}

export const getLocaleFromAcceptLanguage = (header?: string | null, fallback?: string): string => {
  const normalizedFallback = normalizeLocale(fallback) ?? DEFAULT_LOCALE
  if (!header) return normalizedFallback
  const candidates = header
    .split(',')
    .map((part) => part.split(';')[0]?.trim())
    .filter((part): part is string => Boolean(part))
  return detectLocale({
    defaultLocale: normalizedFallback,
    navigatorLanguages: candidates,
    navigatorLanguage: null,
    storage: { getItem: () => null },
    documentLocale: null,
  })
}

type I18nCtx = {
  locale: string
  locales: string[]
  setLocale: (l: string) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}
const Ctx = createContext<I18nCtx>({ locale: DEFAULT_LOCALE, locales: supportedLocales, setLocale: () => {}, t: (k) => k })
export const I18nContext = Ctx

export function I18nProvider({ children, defaultLocale }: { children: React.ReactNode, defaultLocale?: string }) {
  const [locale, setLocaleState] = useState(() => detectLocale({ defaultLocale }))

  useEffect(() => {
    const next = detectLocale({ defaultLocale })
    setLocaleState((current) => (current === next ? current : next))
  }, [defaultLocale])

  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement.lang !== locale) {
      document.documentElement.lang = locale
    }
  }, [locale])
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
