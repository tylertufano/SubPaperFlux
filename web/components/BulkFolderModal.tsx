import { FormEvent, useEffect, useMemo, useState } from 'react'
import { formatNumberValue, useNumberFormatter } from '../lib/format'
import { useI18n } from '../lib/i18n'

type FolderOption = {
  id: string
  name?: string | null
}

type BulkFolderModalProps = {
  open: boolean
  selectedCount: number
  folders: FolderOption[]
  onClose: () => void
  onSubmit: (payload: { folderId: string | null; instapaperId: string | null; clear: boolean }) => Promise<void>
  onSuccess?: (payload: { folderId: string | null; instapaperId: string | null; clear: boolean }) => void
}

type Mode = 'assign' | 'clear'

type FolderOptionView = {
  id: string
  label: string
}

export default function BulkFolderModal({ open, selectedCount, folders, onClose, onSubmit, onSuccess }: BulkFolderModalProps) {
  const { t } = useI18n()
  const numberFormatter = useNumberFormatter()
  const formattedCount = formatNumberValue(selectedCount, numberFormatter, '0')
  const [mode, setMode] = useState<Mode>('assign')
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [instapaperValue, setInstapaperValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMode('assign')
      setSelectedFolderId('')
      setInstapaperValue('')
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  const folderOptions = useMemo<FolderOptionView[]>(() => {
    return folders
      .map((folder) => {
        const id = typeof folder?.id === 'string' ? folder.id : ''
        if (!id) return null
        const rawName = typeof folder?.name === 'string' ? folder.name.trim() : ''
        const label = rawName || t('bookmarks_folder_fallback')
        return { id, label }
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label)) as FolderOptionView[]
  }, [folders, t])

  if (!open) return null

  const descriptionId = 'bulk-folder-modal-description'
  const titleId = 'bulk-folder-modal-title'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return

    const clear = mode === 'clear'
    const trimmedInstapaper = instapaperValue.trim()
    const folderId = clear ? null : (selectedFolderId || null)

    if (!clear && !folderId) {
      setError(t('bookmarks_bulk_folders_validation'))
      return
    }

    setSubmitting(true)
    setError(null)

    const payload = {
      folderId,
      instapaperId: clear ? null : (trimmedInstapaper ? trimmedInstapaper : null),
      clear,
    }

    try {
      await onSubmit(payload)
    } catch (err: any) {
      const reason = (err?.message || String(err) || '').trim() || t('bookmarks_bulk_folders_error_generic')
      setError(t('bookmarks_bulk_folders_error', { reason }))
      setSubmitting(false)
      return
    }

    setSubmitting(false)

    if (onSuccess) {
      onSuccess(payload)
    } else {
      onClose()
    }
  }

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
            {t('bookmarks_bulk_folders_title')}
          </h2>
          <p id={descriptionId} className="text-sm text-gray-600 dark:text-gray-300">
            {t('bookmarks_bulk_folders_selected', { count: formattedCount })}
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <fieldset className="space-y-3">
            <legend className="sr-only">{t('bookmarks_bulk_folders_mode_label')}</legend>
            <label className="flex gap-3">
              <input
                type="radio"
                name="bulk-folder-mode"
                value="assign"
                checked={mode === 'assign'}
                onChange={() => { setMode('assign'); setError(null) }}
                disabled={submitting}
              />
              <div className="flex-1 space-y-2">
                <div className="space-y-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {t('bookmarks_bulk_folders_mode_assign')}
                  </span>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    {t('bookmarks_bulk_folders_mode_assign_help')}
                  </p>
                </div>
                <label className="flex flex-col gap-1" htmlFor="bulk-folder-select">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {t('bookmarks_bulk_folders_select_label')}
                  </span>
                  <select
                    id="bulk-folder-select"
                    className="input"
                    value={selectedFolderId}
                    onChange={(event) => { setSelectedFolderId(event.target.value); setError(null) }}
                    disabled={submitting || mode !== 'assign'}
                  >
                    <option value="">{t('bookmarks_bulk_folders_select_placeholder')}</option>
                    {folderOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1" htmlFor="bulk-folder-instapaper">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {t('bookmarks_bulk_folders_instapaper_label')}
                  </span>
                  <input
                    id="bulk-folder-instapaper"
                    className="input"
                    value={instapaperValue}
                    onChange={(event) => setInstapaperValue(event.target.value)}
                    placeholder={t('bookmarks_bulk_folders_instapaper_placeholder')}
                    disabled={submitting || mode !== 'assign'}
                  />
                </label>
              </div>
            </label>
            <label className="flex gap-3">
              <input
                type="radio"
                name="bulk-folder-mode"
                value="clear"
                checked={mode === 'clear'}
                onChange={() => { setMode('clear'); setError(null) }}
                disabled={submitting}
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t('bookmarks_bulk_folders_mode_clear')}
                </span>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {t('bookmarks_bulk_folders_mode_clear_help')}
                </p>
              </div>
            </label>
          </fieldset>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn text-sm" onClick={onClose} disabled={submitting}>
              {t('btn_cancel')}
            </button>
            <button type="submit" className="btn text-sm" disabled={submitting}>
              {t('bookmarks_bulk_folders_submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
