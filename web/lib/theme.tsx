import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useI18n } from './i18n'

export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'spf-theme'
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null | undefined): Theme | null {
  if (!storage) {
    return null
  }
  try {
    const value = storage.getItem(THEME_STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch (error) {
    return null
  }
}

export function storeTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | null | undefined): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(THEME_STORAGE_KEY, theme)
  } catch (error) {
    // Ignore storage errors (e.g., Safari private browsing)
  }
}

export function resolvePreferredTheme(
  options: {
    storage?: Pick<Storage, 'getItem'> | null
    matchMedia?: ((query: string) => MediaQueryList) | null
  } = {},
): Theme {
  const stored = readStoredTheme(options.storage ?? (typeof window !== 'undefined' ? window.localStorage : null))
  if (stored) {
    return stored
  }

  const matchMedia = options.matchMedia ?? (typeof window !== 'undefined' ? window.matchMedia?.bind(window) : null)
  try {
    const darkQueryList = matchMedia ? matchMedia(DARK_MEDIA_QUERY) : null
    if (darkQueryList && darkQueryList.matches) {
      return 'dark'
    }
  } catch (error) {
    // matchMedia may throw in unsupported environments
  }
  return 'light'
}

export function applyDocumentTheme(theme: Theme, doc: Document | null = typeof document !== 'undefined' ? document : null) {
  if (!doc) {
    return
  }
  if (theme === 'dark') {
    doc.documentElement.classList.add('dark')
  } else {
    doc.documentElement.classList.remove('dark')
  }
}

export function getInlineThemeScript(): string {
  return `(() => {
  const storageKey = '${THEME_STORAGE_KEY}';
  const mediaQuery = '${DARK_MEDIA_QUERY}';
  try {
    let theme = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === 'light' || stored === 'dark') {
        theme = stored;
      }
    }
    if (!theme && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const list = window.matchMedia(mediaQuery);
      if (list && typeof list.matches === 'boolean' && list.matches) {
        theme = 'dark';
      }
    }
    if (theme !== 'dark') {
      theme = 'light';
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    if (typeof window !== 'undefined') {
      window.__SPF_THEME = theme;
    }
  } catch (error) {
    // Swallow errors to avoid blocking rendering
  }
})();`
}

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const liveRegionRef = useRef<HTMLSpanElement | null>(null)
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') {
      return 'light'
    }
    const initial = window.__SPF_THEME ?? resolvePreferredTheme()
    applyDocumentTheme(initial)
    return initial
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const initial = window.__SPF_THEME ?? resolvePreferredTheme()
    setThemeState(initial)
    applyDocumentTheme(initial)
  }, [])

  const announce = useCallback(
    (nextTheme: Theme) => {
      if (!liveRegionRef.current) {
        return
      }
      liveRegionRef.current.textContent =
        nextTheme === 'dark' ? t('theme_announcement_dark') : t('theme_announcement_light')
    },
    [t],
  )

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      setThemeState(nextTheme)
      if (typeof window !== 'undefined') {
        window.__SPF_THEME = nextTheme
        storeTheme(nextTheme, window.localStorage)
      }
      applyDocumentTheme(nextTheme)
      announce(nextTheme)
    },
    [announce],
  )

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <span ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export { THEME_STORAGE_KEY }
