import { useCallback, useMemo } from 'react'
import { useI18n } from './i18n'

type NumberLike = number | bigint | string
type DateLike = Date | number | bigint | string

function optionsKey(
  options?: Intl.NumberFormatOptions | Intl.DateTimeFormatOptions,
): string {
  if (!options) return ''
  const entries = Object.entries(options as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, value] as const)
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(Object.fromEntries(entries))
}

function parseNumber(input: NumberLike | null | undefined): number | bigint | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number' || typeof input === 'bigint') return input
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^-?\d+$/.test(trimmed)) {
    try {
      return BigInt(trimmed)
    } catch {
      // fall through to number parsing
    }
  }
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : null
}

function parseDate(input: DateLike | null | undefined): Date | null {
  if (input === null || input === undefined) return null
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input
  }
  if (typeof input === 'number') {
    const date = new Date(input)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof input === 'bigint') {
    const date = new Date(Number(input))
    return Number.isNaN(date.getTime()) ? null : date
  }
  const trimmed = input.trim()
  if (!trimmed) return null
  const direct = new Date(trimmed)
  if (!Number.isNaN(direct.getTime())) {
    return direct
  }
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) {
    return null
  }
  const date = new Date(numeric)
  return Number.isNaN(date.getTime()) ? null : date
}

export function useNumberFormatter(options?: Intl.NumberFormatOptions) {
  const { locale } = useI18n()
  const key = optionsKey(options)
  return useMemo(() => new Intl.NumberFormat(locale, options), [locale, key])
}

export function useDateTimeFormatter(options?: Intl.DateTimeFormatOptions) {
  const { locale } = useI18n()
  const key = optionsKey(options)
  return useMemo(() => new Intl.DateTimeFormat(locale, options), [locale, key])
}

export function useFormatNumber(options?: Intl.NumberFormatOptions) {
  const formatter = useNumberFormatter(options)
  return useCallback(
    (value: NumberLike | null | undefined, fallback = ''): string => {
      const numeric = parseNumber(value)
      return numeric === null ? fallback : formatter.format(numeric)
    },
    [formatter],
  )
}

export function useFormatDateTime(options?: Intl.DateTimeFormatOptions) {
  const formatter = useDateTimeFormatter(options)
  return useCallback(
    (value: DateLike | null | undefined, fallback = ''): string => {
      const date = parseDate(value)
      return date ? formatter.format(date) : fallback
    },
    [formatter],
  )
}

export function formatNumberValue(
  value: NumberLike | null | undefined,
  formatter: Intl.NumberFormat,
  fallback = '',
): string {
  const numeric = parseNumber(value)
  return numeric === null ? fallback : formatter.format(numeric)
}

export function formatDateTimeValue(
  value: DateLike | null | undefined,
  formatter: Intl.DateTimeFormat,
  fallback = '',
): string {
  const date = parseDate(value)
  return date ? formatter.format(date) : fallback
}

