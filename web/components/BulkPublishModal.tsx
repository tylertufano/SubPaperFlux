import { useEffect, useMemo, useRef, useState } from 'react'
import ProgressModal, { type ProgressModalItem, type ProgressModalStatus } from './ProgressModal'
import { useI18n } from '../lib/i18n'
import { formatNumberValue, useNumberFormatter } from '../lib/format'
import { streamBulkPublish, type BulkPublishEvent } from '../lib/bulkPublish'

export type BulkPublishSummary = {
  success: number
  failed: number
}

export type BulkPublishResult = {
  status: ProgressModalStatus
  items: ProgressModalItem[]
  summary: BulkPublishSummary
  errorMessage?: string | null
}

type PublishRequestItem = {
  id?: string | number | null
  title?: string | null
  url?: string | null
  label?: string | null
  [key: string]: unknown
}

type BulkPublishModalProps = {
  open: boolean
  runKey: string | number
  requestBody: { items: PublishRequestItem[]; [key: string]: unknown }
  fallbackLabel?: string
  title?: string
  onComplete?: (result: BulkPublishResult) => void
  onCancel?: (result: BulkPublishResult) => void
  onError?: (error: Error, result: BulkPublishResult | null) => void
  onClose?: () => void
}

type ModalState = {
  status: ProgressModalStatus
  items: ProgressModalItem[]
  summary: BulkPublishSummary | null
  totalCount: number
  errorMessage: string | null
}

const initialState: ModalState = {
  status: 'running',
  items: [],
  summary: null,
  totalCount: 0,
  errorMessage: null,
}

const safeNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value === null || value === undefined) {
    return 0
  }
  const parsed = Number(value as any)
  return Number.isFinite(parsed) ? parsed : 0
}

const summariseItems = (items: ProgressModalItem[]): BulkPublishSummary => {
  return items.reduce<BulkPublishSummary>(
    (acc, item) => {
      if (item.status === 'success') acc.success += 1
      if (item.status === 'failure' || item.status === 'error') acc.failed += 1
      return acc
    },
    { success: 0, failed: 0 },
  )
}

const resolveSummary = (
  summary: BulkPublishSummary | null | undefined,
  items: ProgressModalItem[],
): BulkPublishSummary => {
  if (summary) {
    return {
      success: safeNumber(summary.success),
      failed: safeNumber(summary.failed),
    }
  }
  return summariseItems(items)
}

const resolveLabel = (item: PublishRequestItem, fallback: string): string => {
  const candidates = [item.label, item.title, item.url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim()
      if (trimmed) return trimmed
    }
  }
  if (item.id !== null && item.id !== undefined) {
    const idText = String(item.id)
    if (idText.trim()) return idText.trim()
  }
  return fallback
}

export default function BulkPublishModal({
  open,
  runKey,
  requestBody,
  fallbackLabel,
  title,
  onComplete,
  onCancel,
  onError,
  onClose,
}: BulkPublishModalProps) {
  const { t } = useI18n()
  const numberFormatter = useNumberFormatter()
  const [modalState, setModalState] = useState<ModalState>(initialState)
  const stateRef = useRef(modalState)
  const controllerRef = useRef<AbortController | null>(null)
  const cancelledByUserRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const onCancelRef = useRef(onCancel)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    stateRef.current = modalState
  }, [modalState])

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    if (!open) {
      if (controllerRef.current && !controllerRef.current.signal.aborted) {
        controllerRef.current.abort()
      }
      controllerRef.current = null
      return
    }

    const requestItems = Array.isArray(requestBody?.items) ? requestBody.items : []
    const fallback = typeof fallbackLabel === 'string' && fallbackLabel.trim()
      ? fallbackLabel.trim()
      : t('bookmarks_select_row_unknown')
    const progressItems = requestItems.map<ProgressModalItem>((item, index) => ({
      id: String(item?.id ?? index + 1),
      label: resolveLabel(item, fallback),
      status: 'pending',
    }))
    const resetState: ModalState = {
      status: 'running',
      items: progressItems,
      summary: null,
      totalCount: requestItems.length,
      errorMessage: null,
    }
    stateRef.current = resetState
    setModalState(resetState)

    const payloadItems = requestItems.map((item) => {
      const { label: _ignored, ...rest } = item
      return rest
    })
    const payload = { ...requestBody, items: payloadItems }

    const controller = new AbortController()
    controllerRef.current = controller
    cancelledByUserRef.current = false

    const handleEvent = (event: BulkPublishEvent) => {
      if (controllerRef.current !== controller) return
      if (event.type === 'item') {
        setModalState((prev) => {
          if (controllerRef.current !== controller) return prev
          const nextItems = prev.items.map((item) => {
            if (item.id !== String(event.id)) return item
            let nextStatus: ProgressModalItem['status']
            switch (event.status) {
              case 'success':
                nextStatus = 'success'
                break
              case 'failure':
                nextStatus = 'failure'
                break
              case 'pending':
                nextStatus = 'pending'
                break
              case 'running':
                nextStatus = 'running'
                break
              case 'error':
                nextStatus = 'failure'
                break
              default:
                nextStatus = 'pending'
            }
            return {
              ...item,
              status: nextStatus,
              message: event.message ? String(event.message) : undefined,
            }
          })
          return { ...prev, items: nextItems }
        })
      } else if (event.type === 'start') {
        const total = safeNumber(event.total)
        if (total > 0) {
          setModalState((prev) => {
            if (controllerRef.current !== controller) return prev
            return { ...prev, totalCount: total }
          })
        }
      } else if (event.type === 'error') {
        const reason = event.message ? String(event.message) : t('bookmarks_publish_modal_failed_generic')
        setModalState((prev) => {
          if (controllerRef.current !== controller) return prev
          return { ...prev, status: 'error', errorMessage: reason }
        })
      } else if (event.type === 'complete') {
        const summary = resolveSummary(
          { success: safeNumber(event.success), failed: safeNumber(event.failed) },
          stateRef.current.items,
        )
        setModalState((prev) => {
          if (controllerRef.current !== controller) return prev
          return { ...prev, summary }
        })
      }
    }

    ;(async () => {
      try {
        const summary = await streamBulkPublish({
          requestBody: payload,
          signal: controller.signal,
          onEvent: handleEvent,
        })
        if (controllerRef.current !== controller) return

        const current = stateRef.current
        const effectiveSummary = resolveSummary(summary ?? current.summary, current.items)

        if (!summary && !current.summary && current.status === 'error' && current.errorMessage) {
          const errorState: ModalState = {
            ...current,
            summary: effectiveSummary,
            totalCount: current.totalCount || effectiveSummary.success + effectiveSummary.failed,
            status: 'error',
            errorMessage: current.errorMessage,
          }
          stateRef.current = errorState
          setModalState(errorState)
          const result: BulkPublishResult = {
            status: 'error',
            items: errorState.items,
            summary: effectiveSummary,
            errorMessage: errorState.errorMessage,
          }
          onErrorRef.current?.(new Error(errorState.errorMessage ?? 'Bulk publish failed'), result)
        } else {
          const hasFailureMessage = Boolean(current.errorMessage && current.errorMessage.trim())
          const failedCount = effectiveSummary.failed
          const finalStatus: ProgressModalStatus = hasFailureMessage || failedCount > 0 ? 'error' : 'success'
          const finalError = finalStatus === 'success' ? null : current.errorMessage
          const nextState: ModalState = {
            ...current,
            status: finalStatus,
            summary: effectiveSummary,
            totalCount: current.totalCount || effectiveSummary.success + effectiveSummary.failed,
            errorMessage: finalError,
          }
          stateRef.current = nextState
          setModalState(nextState)
          const result: BulkPublishResult = {
            status: finalStatus,
            items: nextState.items,
            summary: nextState.summary ?? summariseItems(nextState.items),
            errorMessage: nextState.errorMessage,
          }
          onCompleteRef.current?.(result)
        }
      } catch (err) {
        if (controllerRef.current !== controller) return
        if (err && typeof err === 'object' && (err as any).name === 'AbortError') {
          if (cancelledByUserRef.current) {
            const current = stateRef.current
            const summary = resolveSummary(current.summary, current.items)
            const cancelledState: ModalState = {
              ...current,
              status: 'cancelled',
              summary,
              totalCount: current.totalCount || summary.success + summary.failed,
              errorMessage: null,
            }
            stateRef.current = cancelledState
            setModalState(cancelledState)
            const result: BulkPublishResult = {
              status: 'cancelled',
              items: cancelledState.items,
              summary,
              errorMessage: null,
            }
            onCancelRef.current?.(result)
          }
        } else {
          const reason = err instanceof Error ? err.message : String(err)
          const current = stateRef.current
          const summary = resolveSummary(current.summary, current.items)
          const errorState: ModalState = {
            ...current,
            status: 'error',
            summary,
            totalCount: current.totalCount || summary.success + summary.failed,
            errorMessage: reason,
          }
          stateRef.current = errorState
          setModalState(errorState)
          const result: BulkPublishResult = {
            status: 'error',
            items: errorState.items,
            summary,
            errorMessage: reason,
          }
          onErrorRef.current?.(err instanceof Error ? err : new Error(reason), result)
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null
        }
      }
    })()

    return () => {
      if (controllerRef.current === controller && !controller.signal.aborted) {
        controller.abort()
      }
    }
  }, [open, runKey, requestBody, fallbackLabel, t])

  const handleCancel = () => {
    const controller = controllerRef.current
    if (!controller || controller.signal.aborted) return
    cancelledByUserRef.current = true
    controller.abort()
  }

  const derivedSummary = useMemo(() => resolveSummary(modalState.summary, modalState.items), [modalState.summary, modalState.items])
  const totalCandidates = [modalState.totalCount, modalState.items.length, derivedSummary.success + derivedSummary.failed]
  const total = totalCandidates.find((value) => typeof value === 'number' && value > 0) ?? modalState.items.length
  const formattedTotal = formatNumberValue(total, numberFormatter, '0')
  const resolvedTitle = title ?? t('bookmarks_publish_progress_title', { count: formattedTotal })
  const formattedSuccess = formatNumberValue(derivedSummary.success, numberFormatter, '0')
  const formattedFailed = formatNumberValue(derivedSummary.failed, numberFormatter, '0')
  const failureReason = modalState.errorMessage?.trim()

  let resolvedMessage: string
  if (modalState.status === 'cancelled') {
    resolvedMessage = t('bookmarks_publish_modal_cancelled')
  } else if (modalState.status === 'success') {
    const successTotal = derivedSummary.success > 0 ? derivedSummary.success : total
    resolvedMessage = t('bookmarks_publish_modal_success', { count: formatNumberValue(successTotal, numberFormatter, '0') })
  } else if (modalState.status === 'error') {
    if (failureReason) {
      resolvedMessage = t('bookmarks_publish_modal_failed', { reason: failureReason })
    } else if (derivedSummary.failed > 0) {
      resolvedMessage = t('bookmarks_publish_modal_partial', { success: formattedSuccess, failed: formattedFailed })
    } else {
      resolvedMessage = t('bookmarks_publish_modal_failed_generic')
    }
  } else {
    if (derivedSummary.failed > 0) {
      resolvedMessage = t('bookmarks_publish_modal_partial', { success: formattedSuccess, failed: formattedFailed })
    } else {
      resolvedMessage = t('bookmarks_publish_in_progress', { count: formattedTotal })
    }
  }

  if (!open) {
    return null
  }

  return (
    <ProgressModal
      open={open}
      title={resolvedTitle}
      status={modalState.status}
      items={modalState.items}
      message={resolvedMessage}
      onCancel={modalState.status === 'running' ? handleCancel : undefined}
      onClose={modalState.status !== 'running' ? onClose : undefined}
    />
  )
}
