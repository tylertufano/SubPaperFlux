import { describe, expect, it, vi } from 'vitest'
import {
  applyDocumentTheme,
  getInlineThemeScript,
  readStoredTheme,
  resolvePreferredTheme,
  THEME_STORAGE_KEY,
} from '../lib/theme'

describe('theme helpers', () => {
  it('reads a stored theme value', () => {
    const storage = { getItem: vi.fn(() => 'dark') }
    expect(readStoredTheme(storage)).toBe('dark')
    expect(storage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY)
  })

  it('ignores invalid stored values', () => {
    const storage = { getItem: vi.fn(() => 'invalid') }
    expect(readStoredTheme(storage)).toBeNull()
  })

  it('prefers stored values over media query', () => {
    const storage = { getItem: vi.fn(() => 'light') }
    const matchMedia = vi.fn(() => ({ matches: true } as MediaQueryList))
    expect(resolvePreferredTheme({ storage, matchMedia })).toBe('light')
    expect(storage.getItem).toHaveBeenCalled()
    expect(matchMedia).not.toHaveBeenCalled()
  })

  it('falls back to matchMedia when no stored value exists', () => {
    const storage = { getItem: vi.fn(() => null) }
    const matchMedia = vi.fn(() => ({ matches: true } as MediaQueryList))
    expect(resolvePreferredTheme({ storage, matchMedia })).toBe('dark')
  })

  it('returns light when matchMedia is unavailable', () => {
    const storage = { getItem: vi.fn(() => null) }
    expect(resolvePreferredTheme({ storage, matchMedia: null })).toBe('light')
  })

  it('applies the theme class to the document element', () => {
    document.documentElement.classList.remove('dark')
    applyDocumentTheme('dark', document)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    applyDocumentTheme('light', document)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('produces an inline script that references the storage key', () => {
    const script = getInlineThemeScript()
    expect(script).toContain(THEME_STORAGE_KEY)
  })
})
