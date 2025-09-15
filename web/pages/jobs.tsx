import useSWR from 'swr'
import Nav from '../components/Nav'
import { v1 } from '../lib/openapi'
import Alert from '../components/Alert'
import EmptyState from '../components/EmptyState'
import React, { useState, useEffect } from 'react'
import { useI18n } from '../lib/i18n'
import Link from 'next/link'

export default function Jobs() {
  const { t } = useI18n()
  const [status, setStatus] = useState<string>('')
  const [page, setPage] = useState(1)
  const { data, error, isLoading, mutate } = useSWR([`/v1/jobs`, page, status], ([, p, s]) => v1.listJobsV1JobsGet({ page: p, status: s }))
  const [now, setNow] = useState<number>(Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), size: "20" })
    if (status) params.set('status', status)
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || ''
    const url = `${apiBase}/v1/jobs/stream?${params.toString()}`
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        mutate(d, false)
      } catch (err) {
        // ignore malformed events
      }
    }
    return () => {
      es.close()
    }
  }, [page, status, mutate])
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [detailsCache, setDetailsCache] = useState<Record<string, any>>({})

  function clearFilters() {
    setStatus('')
    setPage(1)
    mutate()
  }

  return (
    <div>
      <Nav />
      <main className="container py-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-xl font-semibold">{t('jobs_title')}</h2>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/jobs-dead" className="btn">{t('nav_jobs_dead')}</Link>
          </div>
        </div>
        <div className="card p-4 mb-4 flex items-center gap-2 flex-wrap">
          <label className="text-gray-700">{t('status_label')}: </label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="queued">Queued</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
            <option value="dead">Dead</option>
          </select>
          <button className="btn" onClick={() => mutate()}>{t('btn_search')}</button>
          <button className="btn" onClick={clearFilters}>{t('btn_clear')}</button>
          <button className="btn" onClick={() => { setStatus('failed,dead'); setPage(1); mutate() }}>{t('nav_jobs_dead')}</button>
          <div className="grow" />
          <button
            className="btn"
            onClick={async () => {
              try {
                await v1.retryAllJobsV1JobsRetryAllPost({ requestBody: { status: ['failed', 'dead'] } })
                setBanner({ kind: 'success', message: t('btn_retry_all_failed_dead') })
                mutate()
              } catch (e: any) {
                setBanner({ kind: 'error', message: e.message || String(e) })
              }
            }}
          >{t('btn_retry_all_failed_dead')}</button>
        </div>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}
        {error && <Alert kind="error" message={String(error)} />}
        {data && (
          <>
            <div className="card p-0 overflow-hidden">
              {(!data.items || data.items.length === 0) ? (
                <div className="p-4">
                  <EmptyState
                    title={t('empty_jobs_title')}
                    description={t('empty_jobs_desc')}
                    actionLabel={t('btn_clear_filters')}
                    onAction={clearFilters}
                  />
                </div>
              ) : (
              <table className="table" aria-label="Jobs">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="th" scope="col">{t('id_label')}</th>
                    <th className="th" scope="col">{t('type_label')}</th>
                    <th className="th" scope="col">{t('status_label')}</th>
                    <th className="th" scope="col">{t('attempts_label')}</th>
                    <th className="th" scope="col">{t('last_error_label')}</th>
                    <th className="th" scope="col">{t('actions_label')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((j: any) => (
                    <React.Fragment key={j.id}>
                      <tr key={j.id} className="odd:bg-white even:bg-gray-50">
                        <td className="td">{j.id}</td>
                        <td className="td">{j.type}</td>
                        <td className="td">
                          {j.status}
                          {j.type === 'publish' && (j.details?.deduped === true) && (
                            <span className="ml-2 px-2 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800">deduped</span>
                          )}
                          {j.type === 'rss_poll' && (j.details?.published != null) && (
                            <span className="ml-2 px-2 py-0.5 text-xs rounded bg-green-100 text-green-800">{j.details.published}/{j.details.total}</span>
                          )}
                        </td>
                        <td className="td">{j.attempts}</td>
                        <td className="td">
                          {j.last_error || ''}
                          {(j.status === 'queued' && j.available_at && j.available_at > now) && (
                            <span className="ml-2 text-gray-600">retry in {Math.max(0, Math.floor(j.available_at - now))}s</span>
                          )}
                        </td>
                        <td className="td flex gap-2">
                          <button
                            className="btn"
                            onClick={async () => {
                              const next = { ...expanded, [j.id]: !expanded[j.id] }
                              setExpanded(next)
                              if (!detailsCache[j.id]) {
                                try {
                                  const full = await v1.getJobV1JobsJobIdGet({ jobId: j.id })
                                  setDetailsCache({ ...detailsCache, [j.id]: full })
                                } catch (e) {
                                  // ignore errors here; banner not necessary for details
                                }
                              }
                            }}
                          >Details</button>
                          {(j.status === 'failed' || j.status === 'dead') && (
                            <button className="btn" onClick={async () => { try { await v1.retryJobV1JobsJobIdRetryPost({ jobId: j.id }); setBanner({ kind: 'success', message: t('btn_retry') }); mutate() } catch (e: any) { setBanner({ kind: 'error', message: `Retry failed: ${e.message || e}` }) } }}>{t('btn_retry')}</button>
                          )}
                        </td>
                      </tr>
                      {expanded[j.id] && (
                        <tr key={`${j.id}-details`} className="bg-gray-50">
                          <td className="td" colSpan={6}>
                            <div className="p-3">
                              <h4 className="font-semibold mb-2">Details</h4>
                              <pre className="text-sm bg-white p-3 rounded border overflow-auto">
{JSON.stringify(detailsCache[j.id]?.details ?? j.details ?? {}, null, 2)}
                              </pre>
                              <h4 className="font-semibold my-2">Payload</h4>
                              <pre className="text-sm bg-white p-3 rounded border overflow-auto">
{JSON.stringify(detailsCache[j.id]?.payload ?? j.payload ?? {}, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span className="text-gray-700">Page {page} / {data.totalPages}</span>
              <button className="btn" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
