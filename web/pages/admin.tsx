import useSWR from 'swr'
import Nav from '../components/Nav'
import { useState } from 'react'
import { v1 } from '../lib/openapi'
import Link from 'next/link'

export default function Admin() {
  const [msg, setMsg] = useState<string>('')
  const { data: status } = useSWR(['/v1/status'], () => v1.getStatusV1StatusGet())
  const { data: db } = useSWR(['/v1/status/db'], () => v1.dbStatusV1StatusDbGet())
  const [prep, setPrep] = useState<any | null>(null)
  const [rls, setRls] = useState<any | null>(null)
  const isPg = (db?.details?.backend || '').toLowerCase() === 'postgres'
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
              <li>Backend: {db?.details?.backend || '—'}</li>
              <li>pg_trgm: {String(db?.details?.pg_trgm_enabled ?? '—')}</li>
              {db?.details?.indexes && (
                <li>Indexes OK: {String(Object.values(db.details.indexes).every(Boolean))}</li>
              )}
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold mb-2">Actions</h3>
            {!isPg && (
              <div className="mb-2 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded p-2">
                Postgres required for these actions. Current backend: {db?.details?.backend || 'unknown'}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button
                disabled={!isPg}
                title={!isPg ? 'Requires Postgres backend' : ''}
                onClick={async () => {
                  const r = await v1.postgresPrepareV1AdminPostgresPreparePost()
                  setPrep(r)
                  setMsg(JSON.stringify(r, null, 2))
                }}
              >
                Prepare Postgres (pg_trgm + indexes)
              </button>
              <button
                disabled={!isPg}
                title={!isPg ? 'Requires Postgres backend' : ''}
                onClick={async () => {
                  const r = await v1.postgresEnableRlsV1AdminPostgresEnableRlsPost()
                  setRls(r)
                  setMsg(JSON.stringify(r, null, 2))
                }}
              >
                Enable RLS (owner policies)
              </button>
            </div>
          </div>
        </div>
        {prep && (
          <div className="card p-4 my-3">
            <h3 className="font-semibold mb-2">Postgres Prep Results</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>Overall: {prep.ok ? 'ok' : 'check'}</li>
              <li>pg_trgm enabled: {String(prep.details?.pg_trgm_enabled ?? false)}</li>
            </ul>
            {prep.details?.index_errors && (
              <div className="mt-2">
                <h4 className="font-semibold">Index errors</h4>
                <ul className="list-disc ml-6 text-sm">
                  {Object.entries(prep.details.index_errors).map(([name, info]: any) => (
                    <li key={name}>
                      <span className="font-mono">{name}</span>: {(info as any).error || String(info)}{(info as any).hint ? ` — ${(info as any).hint}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {rls && (
          <div className="card p-4 my-3">
            <h3 className="font-semibold mb-2">RLS Enable Results</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>Overall: {rls.ok ? 'ok' : 'check'}</li>
            </ul>
            <table className="table mt-2">
              <thead className="bg-gray-100">
                <tr>
                  <th className="th">Table</th>
                  <th className="th">Enabled</th>
                  <th className="th">Policies</th>
                  <th className="th">Error</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rls.details?.tables || {}).map(([tbl, info]: any) => (
                  <tr key={tbl} className="odd:bg-white even:bg-gray-50">
                    <td className="td">{tbl}</td>
                    <td className="td">{String((info as any).enabled)}</td>
                    <td className="td text-sm">
                      select_owner: {String((info as any).policies?.select_owner)}; mod_owner: {String((info as any).policies?.mod_owner)}; del_owner: {String((info as any).policies?.del_owner)}
                    </td>
                    <td className="td">{(info as any).error ? `${(info as any).error}${(info as any).hint ? ` — ${(info as any).hint}` : ''}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {msg && <pre className="card p-3 overflow-auto text-sm">{msg}</pre>}
      </main>
    </div>
  )
}
