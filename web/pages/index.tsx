import useSWR from 'swr'
import Nav from '../components/Nav'
import { v1 } from '../lib/openapi'
import Link from 'next/link'

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
  // Bookmarks total (server-side count endpoint)
  const { data: bmCount } = useSWR(['/v1/bookmarks/count'], () => v1.countBookmarksV1BookmarksCountGet({}))

  // Jobs totals by status (query with small page size; use total field)
  const { data: jobsAll } = useSWR(['/v1/jobs', ''], () => v1.listJobsV1JobsGet({ size: 1 }))
  const { data: jobsFailed } = useSWR(['/v1/jobs', 'failed'], () => v1.listJobsV1JobsGet({ status: 'failed', size: 1 }))
  const { data: jobsDead } = useSWR(['/v1/jobs', 'dead'], () => v1.listJobsV1JobsGet({ status: 'dead', size: 1 }))
  const { data: jobsQueued } = useSWR(['/v1/jobs', 'queued'], () => v1.listJobsV1JobsGet({ status: 'queued', size: 1 }))
  const { data: jobsInProg } = useSWR(['/v1/jobs', 'in_progress'], () => v1.listJobsV1JobsGet({ status: 'in_progress', size: 1 }))

  // Other totals
  const { data: feedsPage } = useSWR(['/v1/feeds'], () => v1.listFeedsV1V1FeedsGet({ size: 1 }))
  const { data: credsPage } = useSWR(['/v1/credentials'], () => v1.listCredentialsV1V1CredentialsGet({ size: 1 }))

  // Health
  const { data: status } = useSWR(['/v1/status'], () => v1.getStatusV1StatusGet())
  const { data: db } = useSWR(['/v1/status/db'], () => v1.dbStatusV1StatusDbGet())

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

  return (
    <div>
      <Nav />
      <main className="container py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-gray-700">At-a-glance usage and system health.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Bookmarks" value={totalBookmarks} href="/bookmarks" />
          <StatCard title="Jobs (total)" value={totalJobs} href="/jobs" />
          <StatCard title="Feeds" value={totalFeeds} href="/feeds" />
          <StatCard title="Credentials" value={totalCreds} href="/credentials" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Jobs Status</h3>
              <Link href="/jobs" className="text-blue-600 hover:underline text-sm">View all</Link>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCard title="Queued" value={queuedJobs} />
              <StatCard title="In Progress" value={inProgJobs} />
              <StatCard title="Failed" value={failedJobs} />
              <StatCard title="Dead" value={deadJobs} />
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Database Health</h3>
              <Link href="/admin" className="text-blue-600 hover:underline text-sm">Admin</Link>
            </div>
            <ul className="text-sm text-gray-800 space-y-1">
              <li><span className={dbOk ? 'text-green-700' : 'text-red-700'}>•</span> Status: {dbOk ? 'ok' : 'check admin'}</li>
              <li><span className={pgTrgm ? 'text-green-700' : 'text-red-700'}>•</span> pg_trgm enabled</li>
              {idxOk !== undefined && (
                <li><span className={idxOk ? 'text-green-700' : 'text-red-700'}>•</span> Recommended indexes</li>
              )}
            </ul>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Service</h3>
            </div>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>API: {status?.status || '—'}</li>
              <li>Version: {status?.version || '—'}</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
