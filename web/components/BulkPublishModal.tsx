import { useMemo } from 'react'
import ProgressModal, { type ProgressModalItem, type ProgressModalStatus } from './ProgressModal'
import { useI18n } from '../lib/i18n'
import { formatNumberValue, useNumberFormatter } from '../lib/format'

type NumberLike = number | string | null | undefined

export type BulkPublishSummary = {
  success?: NumberLike
  failed?: NumberLike
}

export type BulkPublishModalProps = {
  open: boolean
  status: ProgressModalStatus
  items: ProgressModalItem[]
  summary?: BulkPublishSummary | null
  totalCount?: NumberLike
  title?: string
  message?: string
  errorMessage?: string | null
  onCancel?: () => void
  onClose?: () => void
}

type ItemTotals = {
  pending: number
  running: number
  success: number
  failed: number
}

function parseCount(value: NumberLike): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  const trimmed = String(value).trim()
  if (!trimmed) return 0
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : 0
}

function hasValue(value: NumberLike): value is number | string {
  if (value === null || value === undefined) {
    return false
  }
  if (typeof value === 'number') {
    return true
  }
  return value.trim().length > 0
}

export default function BulkPublishModal({
  open,
  status,
  items,
  summary,
  totalCount,
  title,
  message,
  errorMessage,
  onCancel,
  onClose,
}: BulkPublishModalProps) {
  const { t } = useI18n()
  const numberFormatter = useNumberFormatter()

  const itemTotals = useMemo<ItemTotals>(() => {
    return items.reduce<ItemTotals>((acc, item) => {
      switch (item.status) {
        case 'success':
          acc.success += 1
          break
        case 'error':
          acc.failed += 1
          break
        case 'running':
          acc.running += 1
          break
        default:
          acc.pending += 1
          break
      }
      return acc
    }, { pending: 0, running: 0, success: 0, failed: 0 })
  }, [items])

  const summarySuccess = hasValue(summary?.success) ? parseCount(summary?.success) : null
  const summaryFailed = hasValue(summary?.failed) ? parseCount(summary?.failed) : null
  const successCount = summarySuccess ?? itemTotals.success
  const failedCount = summaryFailed ?? itemTotals.failed
  const derivedTotal = itemTotals.pending + itemTotals.running + itemTotals.success + itemTotals.failed
  const summaryTotal = (summarySuccess ?? 0) + (summaryFailed ?? 0)
  const explicitTotal = hasValue(totalCount) ? parseCount(totalCount) : null
  const total = explicitTotal ?? Math.max(items.length, summaryTotal, derivedTotal)
  const formattedTotal = formatNumberValue(total, numberFormatter, '0')

  const resolvedTitle = title ?? t('bookmarks_publish_progress_title', { count: formattedTotal })

  const formattedSuccess = formatNumberValue(successCount, numberFormatter, '0')
  const formattedFailed = formatNumberValue(failedCount, numberFormatter, '0')
  const failureReason = typeof errorMessage === 'string' && errorMessage.trim() ? errorMessage.trim() : undefined

  let resolvedMessage = message
  if (!resolvedMessage) {
    if (status === 'cancelled') {
      resolvedMessage = t('bookmarks_publish_modal_cancelled')
    } else if (status === 'success') {
      const successTotal = successCount > 0 ? successCount : total
      resolvedMessage = t('bookmarks_publish_modal_success', { count: formatNumberValue(successTotal, numberFormatter, '0') })
    } else if (status === 'error') {
      if (failureReason) {
        resolvedMessage = t('bookmarks_publish_modal_failed', { reason: failureReason })
      } else if (failedCount > 0) {
        resolvedMessage = t('bookmarks_publish_modal_partial', {
          success: formattedSuccess,
          failed: formattedFailed,
        })
      } else {
        resolvedMessage = t('bookmarks_publish_modal_failed_generic')
      }
    } else {
      if (failedCount > 0) {
        resolvedMessage = t('bookmarks_publish_modal_partial', {
          success: formattedSuccess,
          failed: formattedFailed,
        })
      } else {
        resolvedMessage = t('bookmarks_publish_in_progress', { count: formattedTotal })
      }
    }
  }

  if (!open) {
    return null
  }

  return (
    <ProgressModal
      open={open}
      title={resolvedTitle}
      status={status}
      items={items}
      message={resolvedMessage}
      onCancel={onCancel}
      onClose={onClose}
    />
  )
}
