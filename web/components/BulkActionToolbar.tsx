import { formatNumberValue, useNumberFormatter } from '../lib/format'
import { useI18n } from '../lib/i18n'

type BulkActionDescriptor = {
  label: string
  onClick: () => void
  busy?: boolean
  disabled?: boolean
}

type Props = {
  selectedCount: number
  disabled?: boolean
  onClearSelection: () => void
  actions: BulkActionDescriptor[]
}

export type { BulkActionDescriptor }

export default function BulkActionToolbar({ selectedCount, disabled = false, onClearSelection, actions }: Props) {
  const { t } = useI18n()
  const numberFormatter = useNumberFormatter()
  const formattedCount = formatNumberValue(selectedCount, numberFormatter, '0')
  const hasSelection = selectedCount > 0
  const clearDisabled = disabled || !hasSelection

  return (
    <div className="p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700" aria-live="polite">
          {t('bulk_actions_selected_count', { count: formattedCount })}
        </span>
        <button
          type="button"
          className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          onClick={onClearSelection}
          disabled={clearDisabled}
        >
          {t('bulk_actions_clear')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action, index) => {
          const isBusy = Boolean(action.busy)
          const actionDisabled = disabled || !hasSelection || action.disabled || isBusy
          return (
            <button
              key={`${action.label}-${index}`}
              type="button"
              className="btn"
              onClick={action.onClick}
              disabled={actionDisabled}
              aria-busy={isBusy || undefined}
            >
              {action.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
