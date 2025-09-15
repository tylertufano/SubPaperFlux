import useSWR from 'swr'
import Nav from '../components/Nav'
import { useState } from 'react'
import { v1 } from '../lib/openapi'
import Link from 'next/link'
import { useI18n } from '../lib/i18n'

export default function Admin() {
  const { t } = useI18n()
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
        <h2 className="text-xl font-semibold mb-3">{t('nav_admin')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="card p-4">
            <h3 className="font-semibold mb-2">{t('admin_system_heading')}</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>{t('admin_system_api_status_label')}: {status?.status || '—'}</li>
              <li>{t('admin_system_version_label')}: {status?.version || '—'}</li>
              <li>{t('admin_system_openapi_label')}: <a className="text-blue-600 hover:underline" href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a></li>
              <li>{t('admin_system_docs_label')}: <a className="text-blue-600 hover:underline" href="/docs" target="_blank" rel="noreferrer">/docs</a></li>
              <li>{t('admin_system_metrics_label')}: <a className="text-blue-600 hover:underline" href="/metrics" target="_blank" rel="noreferrer">/metrics</a></li>
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold mb-2">{t('admin_database_heading')}</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>{t('status_label')}: {db?.ok === true ? t('status_ok') : (db ? t('status_check') : '—')}</li>
              <li>{t('admin_db_backend_label')}: {db?.details?.backend || '—'}</li>
              <li>{t('admin_db_pgtrgm_label')}: {db?.details?.pg_trgm_enabled == null ? '—' : t(db.details.pg_trgm_enabled ? 'boolean_yes' : 'boolean_no')}</li>
              {db?.details?.indexes && (
                <li>{t('admin_db_indexes_ok_label')}: {t(Object.values(db.details.indexes).every(Boolean) ? 'boolean_yes' : 'boolean_no')}</li>
              )}
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold mb-2">{t('admin_actions_heading')}</h3>
            {!isPg && (
              <div className="mb-2 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded p-2">
                {t('admin_actions_postgres_required', { backend: db?.details?.backend || t('admin_actions_backend_unknown') })}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                className="btn"
                disabled={!isPg}
                title={!isPg ? t('admin_actions_requires_postgres') : ''}
                onClick={async () => {
                  const r = await v1.postgresPrepareV1AdminPostgresPreparePost()
                  setPrep(r)
                  setMsg(JSON.stringify(r, null, 2))
                }}
              >
                {t('admin_actions_prepare_postgres')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={!isPg}
                title={!isPg ? t('admin_actions_requires_postgres') : ''}
                onClick={async () => {
                  const r = await v1.postgresEnableRlsV1AdminPostgresEnableRlsPost()
                  setRls(r)
                  setMsg(JSON.stringify(r, null, 2))
                }}
              >
                {t('admin_actions_enable_rls')}
              </button>
            </div>
          </div>
        </div>
        {prep && (
          <div className="card p-4 my-3">
            <h3 className="font-semibold mb-2">{t('admin_prep_heading')}</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>{t('admin_overall_label')}: {prep.ok ? t('status_ok') : t('status_check')}</li>
              <li>{t('admin_prep_pgtrgm_label')}: {prep.details?.pg_trgm_enabled == null ? '—' : t(prep.details.pg_trgm_enabled ? 'boolean_yes' : 'boolean_no')}</li>
            </ul>
            {prep.details?.index_errors && (
              <div className="mt-2">
                <h4 className="font-semibold">{t('admin_prep_index_errors_heading')}</h4>
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
            <h3 className="font-semibold mb-2">{t('admin_rls_heading')}</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>{t('admin_overall_label')}: {rls.ok ? t('status_ok') : t('status_check')}</li>
            </ul>
            <table className="table mt-2" role="table" aria-label={t('admin_rls_table_label')}>
              <thead className="bg-gray-100">
                <tr>
                  <th className="th">{t('admin_rls_table_col')}</th>
                  <th className="th">{t('admin_rls_enabled_col')}</th>
                  <th className="th">{t('admin_rls_policies_col')}</th>
                  <th className="th">{t('admin_rls_error_col')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rls.details?.tables || {}).map(([tbl, info]: any) => (
                  <tr key={tbl} className="odd:bg-white even:bg-gray-50">
                    <td className="td">{tbl}</td>
                    <td className="td">{t((info as any).enabled ? 'boolean_yes' : 'boolean_no')}</td>
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
