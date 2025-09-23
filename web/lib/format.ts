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

let hasLoggedDateTimeFallback = false

function logDateTimeFallback(error: unknown) {
  if (hasLoggedDateTimeFallback) return
  hasLoggedDateTimeFallback = true
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      'Falling back to a safe Intl.DateTimeFormat configuration due to unsupported locale or options.',
      error,
    )
  }
}

function tryCreateDateTimeFormatter(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): { formatter: Intl.DateTimeFormat | null; error: unknown } {
  try {
    return { formatter: new Intl.DateTimeFormat(locale, options), error: null }
  } catch (error) {
    return { formatter: null, error: error ?? new Error('Unknown Intl.DateTimeFormat error') }
  }
}

function stripDateAndTimeStyles(options?: Intl.DateTimeFormatOptions) {
  if (!options) return undefined
  const sanitized: Intl.DateTimeFormatOptions = { ...options }
  delete sanitized.dateStyle
  delete sanitized.timeStyle
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function createIsoDateTimeFormatter(): Intl.DateTimeFormat {
  const formatValue = (value?: Date | number) => {
    const date =
      value instanceof Date ? value : value !== undefined ? new Date(value) : new Date(Date.now())
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }

  const fallback = {
    format(value?: Date | number) {
      return formatValue(value)
    },
    formatToParts(value?: Date | number) {
      return [{ type: 'literal', value: formatValue(value) }]
    },
    formatRange(start?: Date | number, end?: Date | number) {
      return `${formatValue(start)} – ${formatValue(end)}`
    },
    formatRangeToParts(start?: Date | number, end?: Date | number) {
      return [
        { type: 'startRange', value: formatValue(start) },
        { type: 'literal', value: ' – ' },
        { type: 'endRange', value: formatValue(end) },
      ]
    },
    resolvedOptions() {
      return {
        calendar: 'gregory',
        hour12: false,
        locale: 'und',
        numberingSystem: 'latn',
        timeZone: 'UTC',
      }
    },
  }

  return fallback as unknown as Intl.DateTimeFormat
}

function createDateTimeFormatter(locale: string, options?: Intl.DateTimeFormatOptions) {
  const primary = tryCreateDateTimeFormatter(locale, options)
  if (primary.formatter) {
    return primary.formatter
  }

  const firstError = primary.error ?? new Error('Unknown Intl.DateTimeFormat error')

  logDateTimeFallback(firstError)

  const attempts: Array<[string, Intl.DateTimeFormatOptions | undefined]> = []
  const seen = new Set<string>([`${locale}:${optionsKey(options)}`])

  const hasDateStyle =
    options !== undefined && Object.prototype.hasOwnProperty.call(options, 'dateStyle')
  const hasTimeStyle =
    options !== undefined && Object.prototype.hasOwnProperty.call(options, 'timeStyle')
  const sanitizedOptions =
    hasDateStyle || hasTimeStyle ? stripDateAndTimeStyles(options) : undefined

  if (hasDateStyle || hasTimeStyle) {
    attempts.push([locale, sanitizedOptions])
  }

  if (locale !== 'en-US') {
    attempts.push(['en-US', options])
    if (hasDateStyle || hasTimeStyle) {
      attempts.push(['en-US', sanitizedOptions])
    }
  }

  attempts.push(['en-US', undefined])

  for (const [nextLocale, nextOptions] of attempts) {
    const key = `${nextLocale}:${optionsKey(nextOptions)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const result = tryCreateDateTimeFormatter(nextLocale, nextOptions)
    if (result.formatter) {
      return result.formatter
    }
  }

  return createIsoDateTimeFormatter()
}

export function useDateTimeFormatter(options?: Intl.DateTimeFormatOptions) {
  const { locale } = useI18n()
  const key = optionsKey(options)
  return useMemo(() => createDateTimeFormatter(locale, options), [locale, key])
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

