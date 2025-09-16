import { useI18n } from '../lib/i18n'

export type ProgressItemStatus = 'pending' | 'running' | 'success' | 'error'
export type ProgressModalItem = {
  id: string
  label: string
  status: ProgressItemStatus
  message?: string
}

export type ProgressModalStatus = 'running' | 'success' | 'error' | 'cancelled'

type Props = {
  open: boolean
  title: string
  status: ProgressModalStatus
  items: ProgressModalItem[]
  message?: string
  onCancel?: () => void
  onClose?: () => void
  cancelLabel?: string
  closeLabel?: string
}

const statusDotClasses: Record<ProgressItemStatus, string> = {
  pending: 'bg-gray-300 dark:bg-gray-600',
  running: 'bg-blue-500 animate-pulse',
  success: 'bg-green-500',
  error: 'bg-red-500',
}

const statusTextKeys: Record<ProgressItemStatus, string> = {
  pending: 'progress_status_pending',
  running: 'progress_status_running',
  success: 'progress_status_success',
  error: 'progress_status_error',
}

export default function ProgressModal({
  open,
  title,
  status,
  items,
  message,
  onCancel,
  onClose,
  cancelLabel,
  closeLabel,
}: Props) {
  const { t } = useI18n()
  if (!open) return null

  const descId = message ? 'progress-modal-message' : undefined
  const cancelText = cancelLabel ?? t('btn_cancel')
  const closeText = closeLabel ?? t('btn_close')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-modal-title"
        aria-describedby={descId}
        className="w-full max-w-xl overflow-hidden rounded-lg bg-white text-left shadow-xl dark:bg-gray-900"
      >
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 id="progress-modal-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
        </div>
        <div className="space-y-4 px-4 py-4">
          {message && (
            <p id={descId} className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
              {message}
            </p>
          )}
          <ul className="space-y-3" aria-live="polite">
            {items.map((item) => {
              const statusKey = statusTextKeys[item.status] ?? statusTextKeys.pending
              const dotClass = statusDotClasses[item.status] ?? statusDotClasses.pending
              return (
                <li key={item.id} className="flex items-start gap-3" data-testid={`progress-item-${item.id}`}>
                  <span className={`mt-1 inline-flex h-2.5 w-2.5 rounded-full ${dotClass}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t(statusKey)}
                      {item.message ? ` — ${item.message}` : ''}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {status === 'running' && onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              {cancelText}
            </button>
          )}
          {status !== 'running' && onClose && (
            <button type="button" className="btn" onClick={onClose}>
              {closeText}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
