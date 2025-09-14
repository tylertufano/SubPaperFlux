import useSWR from 'swr'
import Nav from '../components/Nav'
import { useState } from 'react'
import { v1 } from '../lib/openapi'
import Link from 'next/link'

export default function Admin() {
  const [msg, setMsg] = useState<string>('')
  const { data: status } = useSWR(['/v1/status'], () => v1.getStatusV1StatusGet())
  const { data: db } = useSWR(['/v1/status/db'], () => v1.dbStatusV1StatusDbGet())
  return (
    <div>
      <Nav />
      <main className="container py-6">
        <h2 className="text-xl font-semibold mb-3">Admin</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="card p-4">
            <h3 className="font-semibold mb-2">System</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>API Status: {status?.status || '—'}</li>
              <li>Version: {status?.version || '—'}</li>
              <li>OpenAPI: <a className="text-blue-600 hover:underline" href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a></li>
              <li>Docs: <a className="text-blue-600 hover:underline" href="/docs" target="_blank" rel="noreferrer">/docs</a></li>
              <li>Metrics: <a className="text-blue-600 hover:underline" href="/metrics" target="_blank" rel="noreferrer">/metrics</a></li>
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold mb-2">Database</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>Status: {db?.ok === true ? 'ok' : (db ? 'check' : '—')}</li>
              <li>pg_trgm: {String(db?.details?.pg_trgm_enabled ?? '—')}</li>
              {db?.details?.indexes && (
                <li>Indexes OK: {String(Object.values(db.details.indexes).every(Boolean))}</li>
              )}
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold mb-2">Actions</h3>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={async () => {
                  const r = await v1.postgresPrepareV1AdminPostgresPreparePost()
                  setMsg(JSON.stringify(r))
                }}
              >
                Prepare Postgres (pg_trgm + indexes)
              </button>
              <button
                onClick={async () => {
                  const r = await v1.postgresEnableRlsV1AdminPostgresEnableRlsPost()
                  setMsg(JSON.stringify(r))
                }}
              >
                Enable RLS (owner policies)
              </button>
            </div>
          </div>
        </div>
        {msg && <pre className="card p-3 overflow-auto text-sm">{msg}</pre>}
      </main>
    </div>
  )
}
