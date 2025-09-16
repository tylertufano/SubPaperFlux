import useSWR from 'swr'
import Link from 'next/link'
import { ErrorBoundary, Nav } from '../components'
import { v1 } from '../lib/openapi'
import { useI18n } from '../lib/i18n'

function StatCard({ title, value, href }: { title: string; value: string | number; href?: string }) {
  const content = (
    <div className="card p-4">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

export default function Home() {
  const { t } = useI18n()
  // Bookmarks total (server-side count endpoint)
  const { data: bmCount, mutate: refreshBookmarks } = useSWR(['/v1/bookmarks/count'], () => v1.countBookmarksV1BookmarksCountGet({}))

  // Jobs totals by status (query with small page size; use total field)
  const { data: jobsAll, mutate: refreshJobsAll } = useSWR(['/v1/jobs', ''], () => v1.listJobsV1JobsGet({ size: 1 }))
  const { data: jobsFailed, mutate: refreshJobsFailed } = useSWR(['/v1/jobs', 'failed'], () => v1.listJobsV1JobsGet({ status: 'failed', size: 1 }))
  const { data: jobsDead, mutate: refreshJobsDead } = useSWR(['/v1/jobs', 'dead'], () => v1.listJobsV1JobsGet({ status: 'dead', size: 1 }))
  const { data: jobsQueued, mutate: refreshJobsQueued } = useSWR(['/v1/jobs', 'queued'], () => v1.listJobsV1JobsGet({ status: 'queued', size: 1 }))
  const { data: jobsInProg, mutate: refreshJobsInProg } = useSWR(['/v1/jobs', 'in_progress'], () => v1.listJobsV1JobsGet({ status: 'in_progress', size: 1 }))

  // Other totals
  const { data: feedsPage, mutate: refreshFeeds } = useSWR(['/v1/feeds'], () => v1.listFeedsV1V1FeedsGet({ size: 1 }))
  const { data: credsPage, mutate: refreshCreds } = useSWR(['/v1/credentials'], () => v1.listCredentialsV1V1CredentialsGet({ size: 1 }))

  // Health
  const { data: status, mutate: refreshStatus } = useSWR(['/v1/status'], () => v1.getStatusV1StatusGet())
  const { data: db, mutate: refreshDb } = useSWR(['/v1/status/db'], () => v1.dbStatusV1StatusDbGet())

  const totalBookmarks = bmCount?.total ?? '—'
  const totalJobs = jobsAll?.total ?? '—'
  const totalFeeds = feedsPage?.total ?? '—'
  const totalCreds = credsPage?.total ?? '—'
  const failedJobs = jobsFailed?.total ?? 0
  const deadJobs = jobsDead?.total ?? 0
  const queuedJobs = jobsQueued?.total ?? 0
  const inProgJobs = jobsInProg?.total ?? 0
  const dbOk = db?.ok === true
  const pgTrgm = db?.details?.pg_trgm_enabled === true
  const idxOk = db?.details?.indexes ? Object.values(db.details.indexes).every(Boolean) : undefined

  const handleRetry = () => {
    const refreshers = [
      refreshBookmarks,
      refreshJobsAll,
      refreshJobsFailed,
      refreshJobsDead,
      refreshJobsQueued,
      refreshJobsInProg,
      refreshFeeds,
      refreshCreds,
      refreshStatus,
      refreshDb,
    ]
    for (const refresh of refreshers) {
      void refresh()
    }
  }

  return (
    <ErrorBoundary onRetry={handleRetry}>
      <div>
        <Nav />
        <main className="container py-6">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold">{t('dashboard_title')}</h1>
            <p className="text-gray-700">{t('dashboard_description')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard title={t('bookmarks_title')} value={totalBookmarks} href="/bookmarks" />
            <StatCard title={t('dashboard_jobs_total')} value={totalJobs} href="/jobs" />
            <StatCard title={t('feeds_title')} value={totalFeeds} href="/feeds" />
            <StatCard title={t('credentials_title')} value={totalCreds} href="/credentials" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-lg">{t('dashboard_jobs_status_heading')}</h2>
                <Link href="/jobs" className="text-blue-600 hover:underline text-sm">{t('dashboard_view_all')}</Link>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatCard title={t('jobs_status_queued')} value={queuedJobs} />
                <StatCard title={t('jobs_status_in_progress')} value={inProgJobs} />
                <StatCard title={t('jobs_status_failed')} value={failedJobs} />
                <StatCard title={t('jobs_status_dead')} value={deadJobs} />
              </div>
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-lg">{t('dashboard_database_health_heading')}</h2>
                <Link href="/admin" className="text-blue-600 hover:underline text-sm">{t('nav_admin')}</Link>
              </div>
              <ul className="text-sm text-gray-800 space-y-1">
                <li><span className={dbOk ? 'text-green-700' : 'text-red-700'}>•</span> {t('status_label')}: {dbOk ? t('status_ok') : t('dashboard_db_status_check')}</li>
                <li><span className={pgTrgm ? 'text-green-700' : 'text-red-700'}>•</span> {t('dashboard_db_pgtrgm')}</li>
                {idxOk !== undefined && (
                  <li><span className={idxOk ? 'text-green-700' : 'text-red-700'}>•</span> {t('dashboard_db_indexes')}</li>
                )}
              </ul>
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-lg">{t('dashboard_service_heading')}</h2>
              </div>
              <ul className="text-sm text-gray-800 space-y-1">
                <li>{t('dashboard_service_api')}: {status?.status || '—'}</li>
                <li>{t('dashboard_service_version')}: {status?.version || '—'}</li>
              </ul>
            </div>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  )
}
