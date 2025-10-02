import { useMemo, type ReactNode } from 'react'
import sanitizeHtml from 'sanitize-html'
import { useI18n } from '../lib/i18n'

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'th',
    'tr',
    'td',
    'pre',
    'code',
    'blockquote',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
}

type PreviewPaneProps = {
  snippet?: string | null
  className?: string
  emptyState?: ReactNode
  labelledBy?: string
  ariaLabel?: string
  tabIndex?: number
}

export default function PreviewPane({
  snippet,
  className,
  emptyState,
  labelledBy,
  ariaLabel,
  tabIndex = 0,
}: PreviewPaneProps) {
  const { t } = useI18n()
  const sanitized = useMemo(() => {
    if (!snippet) {
      return ''
    }

    const trimmed = snippet.trim()

    if (!trimmed) {
      return ''
    }

    return sanitizeHtml(trimmed, SANITIZE_OPTIONS)
  }, [snippet])

  const containerClasses = [
    'rounded-lg border border-gray-200 bg-white p-4 shadow-sm',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
  ]

  if (className) {
    containerClasses.push(className)
  }

  const labelProps =
    labelledBy && labelledBy.trim().length > 0
      ? { 'aria-labelledby': labelledBy }
      : ariaLabel
        ? { 'aria-label': ariaLabel }
        : {}

  const defaultEmptyState = useMemo(
    () => (
      <p className="text-sm text-gray-500">{t('bookmarks_preview_select_prompt')}</p>
    ),
    [t],
  )

  return (
    <section
      role="region"
      aria-live="polite"
      tabIndex={tabIndex}
      className={containerClasses.join(' ')}
      {...labelProps}
    >
      {sanitized ? (
        <div
          className="text-sm leading-relaxed text-gray-800 [&>blockquote]:border-l-4 [&>blockquote]:border-gray-200 [&>blockquote]:pl-4 [&>blockquote]:text-gray-600 [&>code]:rounded [&>code]:bg-gray-100 [&>code]:px-1 [&>code]:py-0.5 [&>h1]:mt-0 [&>h1]:text-lg [&>h1]:font-semibold [&>h2]:mt-6 [&>h2]:text-base [&>h2]:font-semibold [&>ol]:ml-5 [&>ol]:list-decimal [&>p]:mb-4 [&>pre]:overflow-x-auto [&>pre]:rounded-md [&>pre]:bg-gray-900 [&>pre]:p-4 [&>pre]:text-gray-100 [&>ul]:ml-5 [&>ul]:list-disc"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      ) : (
        emptyState ?? defaultEmptyState
      )}
    </section>
  )
}
