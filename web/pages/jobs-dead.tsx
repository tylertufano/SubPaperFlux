import useSWR from 'swr'
import Nav from '../components/Nav'
import { v1 } from '../lib/openapi'
import Alert from '../components/Alert'
import EmptyState from '../components/EmptyState'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useI18n } from '../lib/i18n'

export default function JobsDead() {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const { data, error, isLoading, mutate } = useSWR([`/v1/jobs`, page, 'dead'], ([, p]) => v1.listJobsV1JobsGet({ page: p, status: 'dead' }))
  const [now, setNow] = useState<number>(Date.now() / 1000)
  useEffect(() => { const id = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(id) }, [])
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [detailsCache, setDetailsCache] = useState<Record<string, any>>({})

  return (
    <div>
      <Nav />
      <main className="container py-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 id="jobs-dead-heading" className="text-xl font-semibold">{t('nav_jobs_dead')}</h2>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/jobs" className="btn">{t('jobs_back_to_all')}</Link>
          </div>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                await v1.retryAllJobsV1JobsRetryAllPost({ requestBody: { status: ['dead'] } })
                setBanner({ kind: 'success', message: t('jobs_dead_requeued') })
                mutate()
              } catch (e: any) {
                setBanner({ kind: 'error', message: e.message || String(e) })
              }
            }}
          >{t('jobs_dead_retry_all')}</button>
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
                    title={t('jobs_dead_empty_title')}
                    description={t('jobs_dead_empty_desc')}
                  />
                </div>
              ) : (
              <table className="table" role="table" aria-label={t('jobs_dead_table_label')}>
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
                        <td className="td">{j.status}</td>
                        <td className="td">{j.attempts}</td>
                        <td className="td">{j.last_error || ''}</td>
                        <td className="td flex gap-2">
                          <button
                            type="button"
                            className="btn"
                            aria-expanded={Boolean(expanded[j.id])}
                            aria-controls={expanded[j.id] ? `dead-job-details-${j.id}` : undefined}
                            onClick={async () => {
                              const next = { ...expanded, [j.id]: !expanded[j.id] }
                              setExpanded(next)
                              if (!detailsCache[j.id]) {
                                try {
                                  const full = await v1.getJobV1JobsJobIdGet({ jobId: j.id })
                                  setDetailsCache({ ...detailsCache, [j.id]: full })
                                } catch {}
                              }
                            }}
                          >{t('jobs_details')}</button>
                          <button type="button" className="btn" onClick={async () => { try { await v1.retryJobV1JobsJobIdRetryPost({ jobId: j.id }); setBanner({ kind: 'success', message: t('jobs_dead_retry_success') }); mutate() } catch (e: any) { setBanner({ kind: 'error', message: t('jobs_retry_failed', { reason: e.message || String(e) }) }) } }}>{t('btn_retry')}</button>
                        </td>
                      </tr>
                      {expanded[j.id] && (
                        <tr key={`${j.id}-details`} id={`dead-job-details-${j.id}`} className="bg-gray-50">
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
              <span className="text-gray-700">{t('pagination_status', { page, total: data.totalPages ?? 1 })}</span>
              <button className="btn" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>{t('pagination_next')}</button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
