import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, renderHook, screen } from '@testing-library/react'

import Debug from '../pages/me/debug'
import { I18nContext, I18nProvider } from '../lib/i18n'
import { useFormatDateTime } from '../lib/format'

const { useSessionMock, signInMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(() => ({ data: null, status: 'unauthenticated' as const })),
  signInMock: vi.fn(),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/me/debug' }),
}))

vi.mock('../components', () => ({
  __esModule: true,
  Nav: () => <nav data-testid="nav">Nav</nav>,
  Breadcrumbs: ({ items }: { items: any[] }) => (
    <div data-testid="breadcrumbs">{items?.length ?? 0}</div>
  ),
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('next-auth/react', () => ({
  __esModule: true,
  useSession: () => useSessionMock(),
  signIn: (...args: any[]) => signInMock(...args),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const originalDateTimeFormat = Intl.DateTimeFormat

function setMockDateTimeFormat(
  implementation: (
    locale?: string,
    options?: Intl.DateTimeFormatOptions,
  ) => Intl.DateTimeFormat,
) {
  const mock = vi.fn(function (this: unknown, locale?: string, options?: Intl.DateTimeFormatOptions) {
    return implementation(locale, options)
  })
  Object.defineProperty(Intl, 'DateTimeFormat', {
    configurable: true,
    writable: true,
    value: mock as unknown as Intl.DateTimeFormat,
  })
  return mock
}

describe('useFormatDateTime', () => {
  afterEach(() => {
    cleanup()
    Object.defineProperty(Intl, 'DateTimeFormat', {
      configurable: true,
      writable: true,
      value: originalDateTimeFormat,
    })
    vi.restoreAllMocks()
    useSessionMock.mockReset()
    signInMock.mockReset()
  })

  beforeEach(() => {
    try {
      localStorage.setItem('locale', 'en')
    } catch {}
  })

  it('falls back when Intl.DateTimeFormat throws a RangeError', () => {
    const calls: Array<{ locale?: string; options?: Intl.DateTimeFormatOptions }> = []
    const mock = setMockDateTimeFormat((locale, options) => {
      calls.push({ locale, options })
      if (calls.length === 1) {
        throw new RangeError('unsupported locale')
      }
      if (locale !== 'en-US' || (options && ('dateStyle' in options || 'timeStyle' in options))) {
        throw new RangeError('still unsupported')
      }
      return {
        format: (date: Date) => `fallback:${date.toISOString()}`,
      } as Intl.DateTimeFormat
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nContext.Provider
        value={{ locale: 'custom-locale', locales: ['custom-locale'], setLocale: () => {}, t: (key) => key }}
      >
        {children}
      </I18nContext.Provider>
    )

    const { result } = renderHook(
      () => useFormatDateTime({ dateStyle: 'medium', timeStyle: 'short' }),
      { wrapper },
    )

    const output = result.current(new Date('2024-01-01T00:00:00.000Z'))

    expect(output).toBe('fallback:2024-01-01T00:00:00.000Z')
    expect(mock).toHaveBeenCalledTimes(4)
    expect(calls.some((entry) => entry.locale === 'en-US' && entry.options === undefined)).toBe(true)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('allows the debug page to render with the fallback formatter', async () => {
    const mock = setMockDateTimeFormat((locale, options) => {
      if (locale !== 'en-US' || (options && ('dateStyle' in options || 'timeStyle' in options))) {
        throw new RangeError('unsupported configuration')
      }
      return {
        format: (date: Date) => `fallback:${date.toISOString()}`,
      } as Intl.DateTimeFormat
    })

    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'Test User',
          roles: [],
          groups: [],
          permissions: [],
        },
        expires: '2024-01-01T00:00:00.000Z',
        accessToken: 'access-token',
      },
      status: 'authenticated' as const,
    })

    render(
      <I18nProvider>
        <Debug />
      </I18nProvider>,
    )

    expect(mock).toHaveBeenCalled()
    expect(
      await screen.findByText('Local: fallback:2024-01-01T00:00:00.000Z'),
    ).toBeInTheDocument()
  })
})
