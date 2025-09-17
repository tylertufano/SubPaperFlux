import { FormEvent, useEffect, useMemo, useState } from 'react'
import { formatNumberValue, useNumberFormatter } from '../lib/format'
import { useI18n } from '../lib/i18n'

type TagOption = {
  id: string
  name?: string | null
}

type BulkTagModalProps = {
  open: boolean
  selectedCount: number
  tags: TagOption[]
  onClose: () => void
  onSubmit: (payload: { tags: string[]; clear: boolean }) => Promise<void>
  onSuccess?: (payload: { tags: string[]; clear: boolean }) => void
}

type Mode = 'apply' | 'clear'

const parseTags = (value: string): string[] => {
  const raw = value.split(',').map(tag => tag.trim()).filter(Boolean)
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of raw) {
    const normalized = tag.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(tag)
  }
  return result
}

export default function BulkTagModal({ open, selectedCount, tags, onClose, onSubmit, onSuccess }: BulkTagModalProps) {
  const { t } = useI18n()
  const numberFormatter = useNumberFormatter()
  const [mode, setMode] = useState<Mode>('apply')
  const [inputValue, setInputValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formattedCount = formatNumberValue(selectedCount, numberFormatter, '0')

  useEffect(() => {
    if (open) {
      setMode('apply')
      setInputValue('')
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  const suggestions = useMemo(() => {
    const seen = new Set<string>()
    return tags
      .map(tag => typeof tag?.name === 'string' ? tag.name.trim() : '')
      .filter(name => {
        if (!name) return false
        const normalized = name.toLowerCase()
        if (seen.has(normalized)) return false
        seen.add(normalized)
        return true
      })
      .sort((a, b) => a.localeCompare(b))
  }, [tags])

  const handleSuggestionClick = (name: string) => {
    if (!name) return
    setMode('apply')
    setError(null)
    setInputValue(prev => {
      const existing = parseTags(prev)
      const normalized = name.toLowerCase()
      if (existing.some(tag => tag.toLowerCase() === normalized)) {
        return existing.join(', ')
      }
      const next = [...existing, name]
      return next.join(', ')
    })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return

    const clear = mode === 'clear'
    const tagsToApply = clear ? [] : parseTags(inputValue)

    if (!clear && tagsToApply.length === 0) {
      setError(t('bookmarks_bulk_tags_validation'))
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await onSubmit({ tags: tagsToApply, clear })
      if (onSuccess) {
        onSuccess({ tags: tagsToApply, clear })
      } else {
        onClose()
      }
    } catch (err: any) {
      const reason = (err?.message || String(err) || '').trim() || t('bookmarks_bulk_tags_error_generic')
      setError(t('bookmarks_bulk_tags_error', { reason }))
      setSubmitting(false)
      return
    }

    setSubmitting(false)
  }

  if (!open) return null

  const descriptionId = 'bulk-tag-modal-description'
  const titleId = 'bulk-tag-modal-title'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div
        className="card w-full max-w-xl p-4 space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="space-y-1">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('bookmarks_bulk_tags_title')}
          </h2>
          <p id={descriptionId} className="text-sm text-gray-600 dark:text-gray-300">
            {t('bookmarks_bulk_tags_selected', { count: formattedCount })}
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <fieldset className="space-y-3">
            <legend className="sr-only">{t('bookmarks_bulk_tags_mode_label')}</legend>
            <label className="flex gap-3">
              <input
                type="radio"
                name="bulk-tag-mode"
                value="apply"
                checked={mode === 'apply'}
                onChange={() => { setMode('apply'); setError(null) }}
                disabled={submitting}
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t('bookmarks_bulk_tags_mode_apply')}
                </span>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {t('bookmarks_bulk_tags_mode_apply_help')}
                </p>
                <label className="flex flex-col gap-1 mt-2" htmlFor="bulk-tag-input">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {t('bookmarks_assign_tags_label')}
                  </span>
                  <input
                    id="bulk-tag-input"
                    className="input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={t('bookmarks_assign_tags_placeholder')}
                    disabled={submitting || mode !== 'apply'}
                  />
                </label>
              </div>
            </label>
            <label className="flex gap-3">
              <input
                type="radio"
                name="bulk-tag-mode"
                value="clear"
                checked={mode === 'clear'}
                onChange={() => { setMode('clear'); setError(null) }}
                disabled={submitting}
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t('bookmarks_bulk_tags_mode_clear')}
                </span>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {t('bookmarks_bulk_tags_mode_clear_help')}
                </p>
              </div>
            </label>
          </fieldset>
          {suggestions.length > 0 && mode === 'apply' && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('bookmarks_bulk_tags_suggestions')}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="rounded px-2 py-1 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={() => handleSuggestionClick(name)}
                    disabled={submitting}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn text-sm" onClick={onClose} disabled={submitting}>
              {t('btn_cancel')}
            </button>
            <button type="submit" className="btn text-sm" disabled={submitting} aria-busy={submitting || undefined}>
              {t('bookmarks_bulk_tags_submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
