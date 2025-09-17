import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, Nav } from '../components'
import { v1 } from '../lib/openapi'
import React, { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../lib/i18n'
import Link from 'next/link'
import { formatNumberValue, useNumberFormatter } from '../lib/format'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'

export default function Jobs() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const numberFormatter = useNumberFormatter()
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
      <Breadcrumbs items={breadcrumbs} />
      <main className="container py-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 id="jobs-heading" className="text-xl font-semibold">{t('jobs_title')}</h2>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/jobs-dead" className="btn">{t('nav_jobs_dead')}</Link>
          </div>
        </div>
        <form
          className="card p-4 mb-4 flex items-center gap-2 flex-wrap"
          role="search"
          aria-labelledby="jobs-heading"
          onSubmit={(e) => { e.preventDefault(); mutate() }}
        >
          <label className="text-gray-700" htmlFor="jobs-status-filter">{t('status_label')}:</label>
          <select id="jobs-status-filter" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('jobs_filter_all')}</option>
            <option value="queued">{t('jobs_status_queued')}</option>
            <option value="in_progress">{t('jobs_status_in_progress')}</option>
            <option value="done">{t('jobs_status_done')}</option>
            <option value="failed">{t('jobs_status_failed')}</option>
            <option value="dead">{t('jobs_status_dead')}</option>
          </select>
          <button type="submit" className="btn">{t('btn_search')}</button>
          <button type="button" className="btn" onClick={clearFilters}>{t('btn_clear')}</button>
          <button type="button" className="btn" onClick={() => { setStatus('failed,dead'); setPage(1); mutate() }}>{t('nav_jobs_dead')}</button>
          <div className="grow" />
          <button
            type="button"
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
        </form>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}
        {error && <Alert kind="error" message={String(error)} />}
        {data && (
          <>
            <div className="card p-0 overflow-hidden">
              {(!data.items || data.items.length === 0) ? (
                <div className="p-4">
                  <EmptyState
                    icon={<span>🧾</span>}
                    message={(
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700">{t('empty_jobs_title')}</p>
                        <p>{t('empty_jobs_desc')}</p>
                      </div>
                    )}
                    action={
                      <button type="button" className="btn" onClick={clearFilters}>
                        {t('btn_clear_filters')}
                      </button>
                    }
                  />
                </div>
              ) : (
              <table className="table" role="table" aria-label={t('jobs_table_label')}>
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
                            <span className="ml-2 px-2 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800">{t('jobs_badge_deduped')}</span>
                          )}
                          {j.type === 'rss_poll' && (j.details?.published != null) && (
                            <span className="ml-2 px-2 py-0.5 text-xs rounded bg-green-100 text-green-800">
                              {formatNumberValue(j.details?.published, numberFormatter, '0')}/
                              {formatNumberValue(j.details?.total, numberFormatter, '0')}
                            </span>
                          )}
                        </td>
                        <td className="td">{formatNumberValue(j.attempts, numberFormatter, '—')}</td>
                        <td className="td">
                          {j.last_error || ''}
                          {(j.status === 'queued' && j.available_at && j.available_at > now) && (
                            <span className="ml-2 text-gray-600">
                              {t('jobs_retry_in', {
                                seconds: formatNumberValue(
                                  Math.max(0, Math.floor(j.available_at - now)),
                                  numberFormatter,
                                  '0',
                                ),
                              })}
                            </span>
                          )}
                        </td>
                        <td className="td flex gap-2">
                          <button
                            type="button"
                            className="btn"
                            aria-expanded={Boolean(expanded[j.id])}
                            aria-controls={expanded[j.id] ? `job-row-details-${j.id}` : undefined}
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
                          >{t('jobs_details')}</button>
                          {(j.status === 'failed' || j.status === 'dead') && (
                            <button type="button" className="btn" onClick={async () => { try { await v1.retryJobV1JobsJobIdRetryPost({ jobId: j.id }); setBanner({ kind: 'success', message: t('btn_retry') }); mutate() } catch (e: any) { setBanner({ kind: 'error', message: t('jobs_retry_failed', { reason: e.message || String(e) }) }) } }}>{t('btn_retry')}</button>
                          )}
                        </td>
                      </tr>
                      {expanded[j.id] && (
                        <tr key={`${j.id}-details`} id={`job-row-details-${j.id}`} className="bg-gray-50">
                          <td className="td" colSpan={6}>
                            <div className="p-3">
                              <h4 className="font-semibold mb-2">{t('jobs_details_heading')}</h4>
                              <pre className="text-sm bg-white p-3 rounded border overflow-auto">
{JSON.stringify(detailsCache[j.id]?.details ?? j.details ?? {}, null, 2)}
                              </pre>
                              <h4 className="font-semibold my-2">{t('jobs_payload_heading')}</h4>
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
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('pagination_prev')}</button>
              <span className="text-gray-700">
                {t('pagination_status', {
                  page: numberFormatter.format(page),
                  total: numberFormatter.format(data.totalPages ?? 1),
                })}
              </span>
              <button className="btn" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>{t('pagination_next')}</button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
