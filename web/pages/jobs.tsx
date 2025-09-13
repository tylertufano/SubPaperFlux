import useSWR from 'swr'
import Nav from '../components/Nav'
import { sdk } from '../lib/sdk'
import Alert from '../components/Alert'
import { useState } from 'react'

export default function Jobs() {
  const [status, setStatus] = useState<string>('')
  const [page, setPage] = useState(1)
  const { data, error, isLoading, mutate } = useSWR([`/v1/jobs`, page, status], ([, p, s]) => sdk.listJobs({ page: p, status: s }))
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  return (
    <div>
      <Nav />
      <main className="container py-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-xl font-semibold">Jobs</h2>
        </div>
        <div className="card p-4 mb-4 flex items-center gap-2">
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
        </div>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">Loading...</p>}
        {error && <Alert kind="error" message={String(error)} />}
        {data && (
          <>
            <div className="card p-0 overflow-hidden">
              <table className="table">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="th">ID</th>
                    <th className="th">Type</th>
                    <th className="th">Status</th>
                    <th className="th">Attempts</th>
                    <th className="th">Last Error</th>
                    <th className="th">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((j: any) => (
                    <tr key={j.id} className="odd:bg-white even:bg-gray-50">
                      <td className="td">{j.id}</td>
                      <td className="td">{j.type}</td>
                      <td className="td">{j.status}</td>
                      <td className="td">{j.attempts}</td>
                      <td className="td">{j.last_error || ''}</td>
                      <td className="td">
                        {(j.status === 'failed' || j.status === 'dead') && (
                          <button className="btn" onClick={async () => { try { await sdk.retryJob(j.id); setBanner({ kind: 'success', message: 'Job requeued' }); mutate() } catch (e: any) { setBanner({ kind: 'error', message: `Retry failed: ${e.message || e}` }) } }}>Retry</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span className="text-gray-700">Page {page} / {data.total_pages}</span>
              <button className="btn" disabled={!data.has_next} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
