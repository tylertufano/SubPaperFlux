import { describe, expect, it, vi, afterEach } from 'vitest'
import { streamBulkPublish, type BulkPublishEvent } from '../lib/bulkPublish'
import { bulkPublishBookmarksStream } from '../lib/openapi'

vi.mock('../lib/openapi', () => ({
  bulkPublishBookmarksStream: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('streamBulkPublish', () => {
  it('rejects when API returns an error detail', async () => {
    const mocked = vi.mocked(bulkPublishBookmarksStream)
    mocked.mockResolvedValue(new Response(JSON.stringify({ detail: 'Boom' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }))
    await expect(streamBulkPublish({ requestBody: {}, onEvent: () => {} })).rejects.toThrow('Boom')
  })

  it('emits events from the NDJSON stream', async () => {
    const mocked = vi.mocked(bulkPublishBookmarksStream)
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'start', total: 2 })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'item', id: '1', status: 'pending' })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'item', id: '1', status: 'running' })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'item', id: '1', status: 'success' })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'item', id: '2', status: 'pending' })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'item', id: '2', status: 'running' })}\n`))
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: 'item', id: '2', status: 'error', message: 'ruh roh' })}\n`),
        )
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'complete', success: 1, failed: 1 })))
        controller.close()
      },
    })
    mocked.mockResolvedValue(new Response(stream, { status: 200 }))
    const events: BulkPublishEvent[] = []
    const summary = await streamBulkPublish({ requestBody: {}, onEvent: (evt) => events.push(evt) })
    expect(summary).toEqual({ success: 1, failed: 1 })
    expect(events.map((e) => e.type)).toEqual(['start', 'item', 'item', 'item', 'item', 'item', 'complete'])
    expect(events.filter((e): e is Extract<BulkPublishEvent, { type: 'item' }> => e.type === 'item')).toEqual([
      { type: 'item', id: '1', status: 'pending' },
      { type: 'item', id: '1', status: 'running' },
      { type: 'item', id: '1', status: 'success' },
      { type: 'item', id: '2', status: 'pending' },
      { type: 'item', id: '2', status: 'running' },
      { type: 'item', id: '2', status: 'error', message: 'ruh roh' },
    ])
  })
})
