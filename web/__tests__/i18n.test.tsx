import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { detectLocale, getLocaleFromAcceptLanguage, I18nProvider, useI18n } from '../lib/i18n'

describe('detectLocale', () => {
  it('prefers a saved locale when available', () => {
    const storage = { getItem: vi.fn().mockReturnValue('pseudo') }
    expect(detectLocale({ storage })).toBe('pseudo')
  })

  it('falls back to navigator languages when storage is empty', () => {
    const storage = { getItem: vi.fn().mockReturnValue(null) }
    expect(detectLocale({ storage, navigatorLanguages: ['fr-FR', 'pseudo'] })).toBe('pseudo')
  })

  it('uses the provided default when nothing else matches', () => {
    expect(detectLocale({ defaultLocale: 'pseudo', navigatorLanguages: ['fr-FR'], navigatorLanguage: 'fr-CA' })).toBe('pseudo')
  })
})

describe('getLocaleFromAcceptLanguage', () => {
  it('returns the first supported locale from the header', () => {
    expect(getLocaleFromAcceptLanguage('fr-CA;q=0.9, pseudo;q=0.8, en;q=0.7')).toBe('pseudo')
  })

  it('falls back to default when header is empty', () => {
    expect(getLocaleFromAcceptLanguage(undefined, 'pseudo')).toBe('pseudo')
  })
})

describe('I18nProvider', () => {
  it('propagates locale changes to the document element', async () => {
    document.documentElement.lang = 'en'
    const { result } = renderHook(() => useI18n(), { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider> })

    expect(document.documentElement.lang).toBe('en')

    await act(async () => {
      result.current.setLocale('pseudo')
      await Promise.resolve()
    })

    expect(document.documentElement.lang).toBe('pseudo')
  })
})
