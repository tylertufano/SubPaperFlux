import React, { type ComponentType, type ReactElement, type ReactNode } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import { I18nProvider } from '../../lib/i18n'
import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'

type AnyFunction = (...args: any[]) => any

export type SWRMockState<Data = unknown, Error = unknown> = {
  data?: Data
  error?: Error
  isLoading?: boolean
  mutate?: AnyFunction
}

type ResolvedSWRMockState<Data = unknown, Error = unknown> = {
  data?: Data
  error?: Error
  isLoading: boolean
  mutate: AnyFunction
}

type SWRValueFactory<Data = unknown, Error = unknown> = (key: any, fetcher?: AnyFunction) => SWRMockState<Data, Error>

type SWRHandler<Data = unknown, Error = unknown> = {
  matcher: (key: any, fetcher?: AnyFunction) => boolean
  value: SWRMockState<Data, Error> | SWRValueFactory<Data, Error>
}

type SWRMockConfig = {
  handlers?: SWRHandler[]
  fallback?: SWRMockState | SWRValueFactory
}

export type RenderWithSWROptions = RenderOptions & {
  locale?: string
  swr?: SWRMockConfig
  session?: Session | null
}

const { useSWRMock } = vi.hoisted(() => ({ useSWRMock: vi.fn() }))

vi.mock('swr', () => ({
  __esModule: true,
  default: (key: any, fetcher?: AnyFunction) => useSWRMock(key, fetcher),
}))

function normalize<Data, Error>(value?: SWRMockState<Data, Error>): ResolvedSWRMockState<Data, Error> {
  const { data, error, isLoading = false, mutate } = value ?? {}
  return {
    data,
    error,
    isLoading,
    mutate: mutate ?? vi.fn(),
  }
}

function resolveValue<Data, Error>(
  entry: SWRMockState<Data, Error> | SWRValueFactory<Data, Error> | undefined,
  key: any,
  fetcher?: AnyFunction,
): ResolvedSWRMockState<Data, Error> {
  if (typeof entry === 'function') {
    return normalize((entry as SWRValueFactory<Data, Error>)(key, fetcher))
  }
  return normalize(entry)
}

function buildWrapper(session: Session | null, userWrapper?: ComponentType<{ children: ReactNode }>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const content = userWrapper ? React.createElement(userWrapper, null, children) : children
    return (
      <SessionProvider session={session}>
        <I18nProvider>{content}</I18nProvider>
      </SessionProvider>
    )
  }
}

export function renderWithSWR(ui: ReactElement, options: RenderWithSWROptions = {}): RenderResult {
  const { locale, swr, session = null, wrapper: userWrapper, ...renderOptions } = options
  const handlers = swr?.handlers ?? []
  const fallback = swr?.fallback ?? {}

  useSWRMock.mockReset()
  useSWRMock.mockImplementation((key: any, fetcher?: AnyFunction) => {
    for (const handler of handlers) {
      if (handler.matcher(key, fetcher)) {
        return resolveValue(handler.value, key, fetcher)
      }
    }
    return resolveValue(fallback, key, fetcher)
  })

  if (locale) {
    try {
      localStorage.setItem('locale', locale)
    } catch (error) {
      // Some environments (e.g. server-like tests) may not expose localStorage.
      // Ignore failures so the helper can still render components.
    }
  }

  return render(ui, { ...renderOptions, wrapper: buildWrapper(session, userWrapper) })
}

export function makeSWRSuccess<Data>(
  data: Data,
  overrides?: SWRMockState<Data>,
): ResolvedSWRMockState<Data> {
  return normalize({ data, error: undefined, isLoading: false, ...overrides })
}

export function makeSWRError<Error = unknown>(
  error: Error,
  overrides?: SWRMockState<unknown, Error>,
): ResolvedSWRMockState<unknown, Error> {
  return normalize({ data: undefined, error, isLoading: false, ...overrides })
}

export function makeSWRLoading<Data>(
  data?: Data,
  overrides?: SWRMockState<Data>,
): ResolvedSWRMockState<Data> {
  return normalize({ data, error: undefined, isLoading: true, ...overrides })
}

export { useSWRMock }
