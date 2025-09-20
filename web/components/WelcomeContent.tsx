import { useMemo } from 'react'
import sanitizeHtml from 'sanitize-html'
import { marked } from 'marked'
import type { SiteWelcomeContent } from '../lib/openapi'
import { useI18n } from '../lib/i18n'

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...new Set([
      ...sanitizeHtml.defaults.allowedTags,
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'pre',
      'code',
    ]),
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: [...(sanitizeHtml.defaults.allowedAttributes?.a ?? []), 'target', 'rel'],
  },
  allowedSchemesByTag: {
    ...sanitizeHtml.defaults.allowedSchemesByTag,
    a: ['http', 'https', 'mailto'],
  },
}

function normalizeValue(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type WelcomeContentProps = {
  content?: SiteWelcomeContent | null
  isLoading?: boolean
  error?: Error | null
}

export default function WelcomeContent({ content, isLoading, error }: WelcomeContentProps) {
  const { t } = useI18n()
  const headline = normalizeValue(content?.headline) ?? t('nav_brand')
  const subheadline = normalizeValue(content?.subheadline) ?? t('home_welcome')
  const body = normalizeValue(content?.body)
  const ctaText = normalizeValue(content?.cta_text)
  const ctaUrl = normalizeValue(content?.cta_url)

  const bodyHtml = useMemo(() => {
    if (!body) {
      return null
    }
    try {
      const rawHtml = marked.parse(body, { breaks: true })
      const html = typeof rawHtml === 'string' ? rawHtml : String(rawHtml)
      return sanitizeHtml(html, SANITIZE_OPTIONS)
    } catch (err) {
      console.error('[WelcomeContent] Failed to parse welcome markdown', err)
      return null
    }
  }, [body])

  const isExternalCta = Boolean(ctaUrl && /^https?:\/\//i.test(ctaUrl))
  const ctaProps = isExternalCta ? { target: '_blank', rel: 'noreferrer noopener' } : undefined

  return (
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50 via-white to-white shadow-sm">
      <div className="px-6 py-12 md:px-10 md:py-16">
        <div className="max-w-2xl space-y-6">
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-gray-900">{headline}</h1>
            <p className="text-lg text-gray-700">{subheadline}</p>
          </div>
          {isLoading ? <p className="text-sm text-gray-500">{t('loading_text')}</p> : null}
          {error ? (
            <div
              className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
              role="status"
            >
              {t('home_welcome_error')}
            </div>
          ) : null}
          {bodyHtml ? (
            <div
              className="space-y-4 text-gray-700 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : null}
          {ctaText && ctaUrl ? (
            <div>
              <a className="btn" href={ctaUrl} {...ctaProps}>
                {ctaText}
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
