import { bulkPublishBookmarksStream } from './openapi'

export type BulkPublishStartEvent = { type: 'start'; total?: number }
export type BulkPublishItemEvent = {
  type: 'item'
  id: string
  status: 'pending' | 'running' | 'success' | 'failure' | 'error'
  message?: string
  result?: Record<string, unknown>
}
export type BulkPublishCompleteEvent = { type: 'complete'; success: number; failed: number }
export type BulkPublishErrorEvent = { type: 'error'; message?: string }
export type BulkPublishEvent =
  | BulkPublishStartEvent
  | BulkPublishItemEvent
  | BulkPublishCompleteEvent
  | BulkPublishErrorEvent

export async function streamBulkPublish({
  requestBody,
  signal,
  onEvent,
}: {
  requestBody: any
  signal?: AbortSignal
  onEvent?: (event: BulkPublishEvent) => void
}): Promise<{ success: number; failed: number } | null> {
  const response = await bulkPublishBookmarksStream({ requestBody, signal })
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const data = await response.clone().json()
      const detail = (data as any)?.detail || (data as any)?.message
      if (detail) message = String(detail)
    } catch {
      try {
        const text = await response.text()
        if (text) message = text
      } catch {
        // ignore secondary error
      }
    }
    throw new Error(message)
  }

  if (!response.body) {
    throw new Error('Streaming not supported by this browser')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let summary: { success: number; failed: number } | null = null

  const emit = (payload: any) => {
    if (!payload || typeof payload !== 'object') return
    const event = payload as BulkPublishEvent
    if (event.type === 'complete') {
      const success = typeof event.success === 'number' ? event.success : Number((event as any).success ?? 0)
      const failed = typeof event.failed === 'number' ? event.failed : Number((event as any).failed ?? 0)
      summary = { success, failed }
    }
    onEvent?.(event)
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        try {
          emit(JSON.parse(line))
        } catch {
          // Skip malformed chunk
        }
      }
      newlineIndex = buffer.indexOf('\n')
    }
    if (done) {
      const finalLine = buffer.trim()
      if (finalLine) {
        try {
          emit(JSON.parse(finalLine))
        } catch {
          // ignore malformed tail chunk
        }
      }
      break
    }
  }

  return summary
}
