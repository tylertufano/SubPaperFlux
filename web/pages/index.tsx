import { useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Breadcrumbs, ErrorBoundary, Nav } from '../components'
import WelcomeContent from '../components/WelcomeContent'
import { v1 } from '../lib/openapi'
import { useI18n } from '../lib/i18n'
import { formatNumberValue, useNumberFormatter } from '../lib/format'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'

type WelcomeKey = ['/v1/site-settings/welcome', 'public']
type CountKey = ['/v1/bookmarks/count']
type JobsKey = ['/v1/jobs', string]
type PageKey = ['/v1/feeds'] | ['/v1/credentials']
type StatusKey = ['/v1/status']
type DbStatusKey = ['/v1/status/db']

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
  const router = useRouter()
  const { status } = useSession()
  const numberFormatter = useNumberFormatter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const isAuthenticated = status === 'authenticated'
  const shouldLoadProtected = isAuthenticated
  const shouldLoadWelcome = status === 'unauthenticated'

  const bookmarksKey: CountKey | null = shouldLoadProtected ? ['/v1/bookmarks/count'] : null
  const { data: bmCount, mutate: refreshBookmarks } = useSWR(bookmarksKey, () =>
    v1.countBookmarksV1BookmarksCountGet({}),
  )

  const jobsAllKey: JobsKey | null = shouldLoadProtected ? ['/v1/jobs', ''] : null
  const { data: jobsAll, mutate: refreshJobsAll } = useSWR(jobsAllKey, () => v1.listJobsV1JobsGet({ size: 1 }))
  const jobsFailedKey: JobsKey | null = shouldLoadProtected ? ['/v1/jobs', 'failed'] : null
  const { data: jobsFailed, mutate: refreshJobsFailed } = useSWR(jobsFailedKey, () =>
    v1.listJobsV1JobsGet({ status: 'failed', size: 1 }),
  )
  const jobsDeadKey: JobsKey | null = shouldLoadProtected ? ['/v1/jobs', 'dead'] : null
  const { data: jobsDead, mutate: refreshJobsDead } = useSWR(jobsDeadKey, () =>
    v1.listJobsV1JobsGet({ status: 'dead', size: 1 }),
  )
  const jobsQueuedKey: JobsKey | null = shouldLoadProtected ? ['/v1/jobs', 'queued'] : null
  const { data: jobsQueued, mutate: refreshJobsQueued } = useSWR(jobsQueuedKey, () =>
    v1.listJobsV1JobsGet({ status: 'queued', size: 1 }),
  )
  const jobsInProgressKey: JobsKey | null = shouldLoadProtected ? ['/v1/jobs', 'in_progress'] : null
  const { data: jobsInProg, mutate: refreshJobsInProg } = useSWR(jobsInProgressKey, () =>
    v1.listJobsV1JobsGet({ status: 'in_progress', size: 1 }),
  )

  const feedsKey: PageKey | null = shouldLoadProtected ? ['/v1/feeds'] : null
  const credsKey: PageKey | null = shouldLoadProtected ? ['/v1/credentials'] : null
  const { data: feedsPage, mutate: refreshFeeds } = useSWR(feedsKey, () => v1.listFeedsV1V1FeedsGet({ size: 1 }))
  const { data: credsPage, mutate: refreshCreds } = useSWR(credsKey, () => v1.listCredentialsV1V1CredentialsGet({ size: 1 }))

  const statusKey: StatusKey | null = shouldLoadProtected ? ['/v1/status'] : null
  const dbStatusKey: DbStatusKey | null = shouldLoadProtected ? ['/v1/status/db'] : null
  const { data: statusData, mutate: refreshStatus } = useSWR(statusKey, () => v1.getStatusV1StatusGet())
  const { data: db, mutate: refreshDb } = useSWR(dbStatusKey, () => v1.dbStatusV1StatusDbGet())

  const welcomeKey: WelcomeKey | null = shouldLoadWelcome ? ['/v1/site-settings/welcome', 'public'] : null
  const {
    data: welcomeSetting,
    mutate: refreshWelcome,
    error: welcomeError,
    isLoading: welcomeLoading,
  } = useSWR(welcomeKey, () => v1.getPublicSiteWelcomeSetting())

  const totalBookmarks = formatNumberValue(bmCount?.total, numberFormatter, '—')
  const totalJobs = formatNumberValue(jobsAll?.total, numberFormatter, '—')
  const totalFeeds = formatNumberValue(feedsPage?.total, numberFormatter, '—')
  const totalCreds = formatNumberValue(credsPage?.total, numberFormatter, '—')
  const failedJobs = formatNumberValue(jobsFailed?.total ?? 0, numberFormatter, '0')
  const deadJobs = formatNumberValue(jobsDead?.total ?? 0, numberFormatter, '0')
  const queuedJobs = formatNumberValue(jobsQueued?.total ?? 0, numberFormatter, '0')
  const inProgJobs = formatNumberValue(jobsInProg?.total ?? 0, numberFormatter, '0')
  const dbOk = db?.ok === true
  const pgTrgm = db?.details?.pg_trgm_enabled === true
  const idxOk = db?.details?.indexes ? Object.values(db.details.indexes).every(Boolean) : undefined

  const handleRetry = () => {
    if (isAuthenticated) {
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
      return
    }
    void refreshWelcome()
  }

  if (status === 'loading') {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <main className="container py-12">
            <p className="text-gray-700 dark:text-gray-300">{t('loading_text')}</p>
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  if (!isAuthenticated) {
    return (
      <ErrorBoundary onRetry={handleRetry}>
        <div>
          <Nav />
          <main className="container py-12">
            <WelcomeContent content={welcomeSetting?.value} error={welcomeError ?? null} isLoading={welcomeLoading} />
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary onRetry={handleRetry}>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold">{t('dashboard_title')}</h1>
            <p className="text-gray-700 dark:text-gray-300">{t('dashboard_description')}</p>
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
                <Link href="/jobs" className="text-blue-600 hover:underline text-sm">
                  {t('dashboard_view_all')}
                </Link>
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
                <Link href="/admin" className="text-blue-600 hover:underline text-sm">
                  {t('nav_admin')}
                </Link>
              </div>
              <ul className="text-sm text-gray-800 space-y-1">
                <li>
                  <span className={dbOk ? 'text-green-700' : 'text-red-700'}>•</span> {t('status_label')}:{' '}
                  {dbOk ? t('status_ok') : t('dashboard_db_status_check')}
                </li>
                <li>
                  <span className={pgTrgm ? 'text-green-700' : 'text-red-700'}>•</span> {t('dashboard_db_pgtrgm')}
                </li>
                {idxOk !== undefined && (
                  <li>
                    <span className={idxOk ? 'text-green-700' : 'text-red-700'}>•</span> {t('dashboard_db_indexes')}
                  </li>
                )}
              </ul>
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-lg">{t('dashboard_service_heading')}</h2>
              </div>
              <ul className="text-sm text-gray-800 space-y-1">
                <li>
                  {t('dashboard_service_api')}: {statusData?.status || '—'}
                </li>
                <li>
                  {t('dashboard_service_version')}: {statusData?.version || '—'}
                </li>
              </ul>
            </div>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  )
}
