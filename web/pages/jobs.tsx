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
            <Link href="/jobs-dead" className="btn">Dead-letter Queue</Link>
          </div>
        </div>
        <div className="card p-4 mb-4 flex items-center gap-2 flex-wrap">
          <label className="text-gray-700">Status: </label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="queued">Queued</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
            <option value="dead">Dead</option>
          </select>
          <button className="btn" onClick={() => mutate()}>Filter</button>
          <button className="btn" onClick={clearFilters}>Clear</button>
          <button className="btn" onClick={() => { setStatus('failed,dead'); setPage(1); mutate() }}>Failed/Dead</button>
          <div className="grow" />
          <button
            className="btn"
            onClick={async () => {
              try {
                await v1.retryAllJobsV1JobsRetryAllPost({ requestBody: { status: ['failed', 'dead'] } })
                setBanner({ kind: 'success', message: 'Requeued all failed/dead jobs' })
                mutate()
              } catch (e: any) {
                setBanner({ kind: 'error', message: e.message || String(e) })
              }
            }}
          >Retry All Failed/Dead</button>
        </div>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">Loading...</p>}
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
                    <th className="th" scope="col">ID</th>
                    <th className="th" scope="col">Type</th>
                    <th className="th" scope="col">Status</th>
                    <th className="th" scope="col">Attempts</th>
                    <th className="th" scope="col">Last Error</th>
                    <th className="th" scope="col">Actions</th>
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
                            <button className="btn" onClick={async () => { try { await v1.retryJobV1JobsJobIdRetryPost({ jobId: j.id }); setBanner({ kind: 'success', message: 'Job requeued' }); mutate() } catch (e: any) { setBanner({ kind: 'error', message: `Retry failed: ${e.message || e}` }) } }}>Retry</button>
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
