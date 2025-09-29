import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Alert, Breadcrumbs, ErrorBoundary, Nav } from '../components'
import { v1 } from '../lib/openapi'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'

type IntegrationStatusDetail = {
  ok?: boolean
  status?: number
  error?: string
  endpoint?: string
  [key: string]: any
}

type IntegrationStatusResponse = {
  ok?: boolean
  details?: Record<string, IntegrationStatusDetail>
  [key: string]: any
}

type IntegrationParams = { instapaperCredId?: string; minifluxCredId?: string }

function pickFirst<T>(source: Record<string, any> | undefined, keys: string[]): T | undefined {
  if (!source) return undefined
  for (const key of keys) {
    if (key in source && source[key] != null) {
      return source[key] as T
    }
  }
  return undefined
}

function formatTimestamp(value: unknown, locale: string): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
    }
    return value
  }
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000
    const parsed = new Date(ms)
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
    }
    return value.toString()
  }
  return null
}

function describeRateLimit(
  detail: IntegrationStatusDetail | undefined,
  locale: string,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  const rateLimit = pickFirst<Record<string, any>>(detail, ['rate_limit', 'rateLimit', 'ratelimit'])
  if (!rateLimit || typeof rateLimit !== 'object') {
    return t('admin_integrations_rate_limit_unavailable')
  }
  const parts: string[] = []
  const limit = pickFirst<number>(rateLimit, ['limit', 'max', 'capacity'])
  if (limit != null) {
    parts.push(t('admin_integrations_rate_limit_limit', { limit }))
  }
  const remaining = pickFirst<number>(rateLimit, ['remaining', 'left'])
  if (remaining != null) {
    parts.push(t('admin_integrations_rate_limit_remaining', { remaining }))
  }
  const windowSeconds = pickFirst<number>(rateLimit, ['window_seconds', 'windowSeconds', 'window'])
  if (windowSeconds != null) {
    parts.push(t('admin_integrations_rate_limit_window', { seconds: windowSeconds }))
  }
  const reset = pickFirst<number | string>(rateLimit, ['reset_at', 'resetAt', 'reset', 'next'])
  const formattedReset = formatTimestamp(reset, locale)
  if (formattedReset) {
    parts.push(t('admin_integrations_rate_limit_reset', { time: formattedReset }))
  }
  return parts.length > 0 ? parts.join(' · ') : t('admin_integrations_rate_limit_unavailable')
}

function describeBackoff(
  detail: IntegrationStatusDetail | undefined,
  locale: string,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  const backoff = pickFirst<Record<string, any>>(detail, ['backoff', 'retry', 'retry_state', 'retryState'])
  if (!backoff || typeof backoff !== 'object') {
    return t('admin_integrations_backoff_none')
  }
  const parts: string[] = []
  const seconds = pickFirst<number>(backoff, ['seconds', 'delay', 'delay_seconds', 'wait'])
  if (seconds != null) {
    parts.push(t('admin_integrations_backoff_wait', { seconds }))
  }
  const until = pickFirst<number | string>(backoff, ['retry_at', 'retryAt', 'until', 'next_retry_at'])
  const formattedUntil = formatTimestamp(until, locale)
  if (formattedUntil) {
    parts.push(t('admin_integrations_backoff_until', { time: formattedUntil }))
  }
  const attempts = pickFirst<number>(backoff, ['attempts', 'attempt', 'retries'])
  if (attempts != null) {
    parts.push(t('admin_integrations_backoff_attempts', { attempts }))
  }
  const reason = pickFirst<string>(backoff, ['reason', 'message'])
  if (reason) {
    parts.push(t('admin_integrations_backoff_reason', { reason }))
  }
  const lastError = pickFirst<string>(backoff, ['last_error', 'lastError', 'error'])
  if (lastError) {
    parts.push(t('admin_integrations_backoff_last_error', { error: lastError }))
  }
  return parts.length > 0 ? parts.join(' · ') : t('admin_integrations_backoff_none')
}

export default function Admin() {
  const { t, locale } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const [msg, setMsg] = useState<string>('')
  const { data: status, error: statusError, isLoading: statusLoading, mutate: refreshStatus } = useSWR(['/v1/status'], () => v1.getStatusV1StatusGet())
  const { data: db, error: dbError, isLoading: dbLoading, mutate: refreshDb } = useSWR(['/v1/status/db'], () => v1.dbStatusV1StatusDbGet())
  const [integrationInputs, setIntegrationInputs] = useState<{ instapaper: string; miniflux: string }>({ instapaper: '', miniflux: '' })
  const [integrationParams, setIntegrationParams] = useState<IntegrationParams>({})
  const integrationFetcher = useCallback(
    ([, params]: readonly [string, IntegrationParams]) => v1.integrationsStatusV1StatusIntegrationsGet(params),
    [],
  )
  const {
    data: integrations,
    error: integrationError,
    isLoading: integrationLoading,
    mutate: refreshIntegrations,
  } = useSWR<IntegrationStatusResponse, Error, readonly [string, IntegrationParams]>(
    ['/v1/status/integrations', integrationParams] as const,
    integrationFetcher,
  )
  const [retryingIntegration, setRetryingIntegration] = useState<string | null>(null)
  const integrationEntries = useMemo(() => Object.entries(integrations?.details ?? {}), [integrations])
  const [prep, setPrep] = useState<any | null>(null)
  const [rls, setRls] = useState<any | null>(null)
  const isPg = (db?.details?.backend || '').toLowerCase() === 'postgres'
  const rlsEnableHref = '/docs/user-management-rollout#postgres-rls-enable'
  const rlsDisableHref = '/docs/user-management-rollout#postgres-rls-disable'
  const handleIntegrationInputChange = (key: 'instapaper' | 'miniflux') => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setIntegrationInputs(prev => ({ ...prev, [key]: value }))
  }
  const handleRunIntegrationChecks = () => {
    const next = {
      instapaperCredId: integrationInputs.instapaper.trim() || undefined,
      minifluxCredId: integrationInputs.miniflux.trim() || undefined,
    }
    setIntegrationParams(next)
    void refreshIntegrations()
  }
  const handleIntegrationSubmit = (event: FormEvent) => {
    event.preventDefault()
    handleRunIntegrationChecks()
  }
  const testers: Record<string, ((credentialId: string) => Promise<unknown>) | undefined> = {
    instapaper: (credentialId: string) =>
      v1.testInstapaperV1IntegrationsInstapaperTestPost({ requestBody: { credential_id: credentialId } }),
    miniflux: (credentialId: string) =>
      v1.testMinifluxV1IntegrationsMinifluxTestPost({ requestBody: { credential_id: credentialId } }),
  }
  const handleRetryIntegration = async (integration: string) => {
    const credentialId =
      (integration === 'instapaper' ? integrationInputs.instapaper : integrationInputs.miniflux).trim() ||
      pickFirst<string>(integrations?.details?.[integration], ['credential_id', 'credentialId']) ||
      undefined
    const tester = credentialId ? testers[integration] : undefined
    if (!tester || !credentialId) {
      return
    }
    try {
      setIntegrationParams({
        instapaperCredId: integrationInputs.instapaper.trim() || undefined,
        minifluxCredId: integrationInputs.miniflux.trim() || undefined,
      })
      setRetryingIntegration(integration)
      await tester(credentialId)
      void refreshIntegrations()
    } finally {
      setRetryingIntegration(prev => (prev === integration ? null : prev))
    }
  }
  const handleRetry = () => {
    void refreshStatus()
    void refreshDb()
    void refreshIntegrations()
  }
  return (
    <ErrorBoundary onRetry={handleRetry}>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6">
          <h2 className="text-xl font-semibold mb-3">{t('nav_admin')}</h2>
          {(statusLoading || dbLoading || integrationLoading) && <p className="text-gray-600">{t('loading_text')}</p>}
          {(statusError || dbError || integrationError) && (
            <div className="mb-3 space-y-2">
              {statusError && <Alert kind="error" message={String(statusError)} />}
              {dbError && <Alert kind="error" message={String(dbError)} />}
              {integrationError && <Alert kind="error" message={String(integrationError)} />}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="card p-4">
              <h3 className="font-semibold mb-2">{t('admin_system_heading')}</h3>
              <ul className="text-sm text-gray-800 space-y-1">
                <li>{t('admin_system_api_status_label')}: {status?.status || '—'}</li>
                <li>{t('admin_system_version_label')}: {status?.version || '—'}</li>
                <li>{t('admin_system_openapi_label')}: <a className="text-blue-600 hover:underline" href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a></li>
                <li>{t('admin_system_docs_label')}: <a className="text-blue-600 hover:underline" href="/docs" target="_blank" rel="noreferrer">/docs</a></li>
                <li>
                  {t('admin_system_metrics_label')}: <a className="text-blue-600 hover:underline" href="/metrics" target="_blank" rel="noreferrer">/metrics</a>{' · '}
                  <Link href="/admin/metrics" className="text-blue-600 hover:underline">
                    {t('admin_metrics_ui_link_label')}
                  </Link>
                </li>
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
              <div className="flex flex-col gap-3">
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
                    title={!isPg ? t('admin_actions_requires_postgres') : t('admin_actions_enable_rls_tooltip')}
                    onClick={async () => {
                      if (!isPg) {
                        return
                      }
                      if (!window.confirm(t('admin_actions_enable_rls_confirm'))) {
                        return
                      }
                      const r = await v1.postgresEnableRlsV1AdminPostgresEnableRlsPost()
                      setRls(r)
                      setMsg(JSON.stringify(r, null, 2))
                    }}
                  >
                    {t('admin_actions_enable_rls')}
                  </button>
                  <Link
                    href={rlsEnableHref}
                    className="btn"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('admin_actions_enable_rls_docs_button')}
                  </Link>
                </div>
                {isPg && (
                  <Alert
                    kind="warning"
                    message={
                      <span>
                        {t('admin_actions_enable_rls_warning_prefix')}{' '}
                        <a
                          href={rlsEnableHref}
                          className="underline text-blue-700 hover:text-blue-800"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('admin_actions_enable_rls_warning_enable_link')}
                        </a>
                        {' · '}
                        <a
                          href={rlsDisableHref}
                          className="underline text-blue-700 hover:text-blue-800"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('admin_actions_enable_rls_warning_disable_link')}
                        </a>
                        {' '}
                        {t('admin_actions_enable_rls_warning_suffix')}
                      </span>
                    }
                  />
                )}
              </div>
          </div>
        </div>
        <div className="card p-4 mb-4">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="font-semibold mb-1">{t('admin_integrations_heading')}</h3>
              <p className="text-sm text-gray-600">{t('admin_integrations_help')}</p>
            </div>
            <form className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={handleIntegrationSubmit}>
              <label className="flex flex-col gap-1 text-sm text-gray-700 md:w-1/3">
                <span className="font-medium">{t('admin_integrations_instapaper_label')}</span>
                <input
                  type="text"
                  className="input"
                  value={integrationInputs.instapaper}
                  onChange={handleIntegrationInputChange('instapaper')}
                  placeholder={t('admin_integrations_credential_placeholder')}
                />
                <span className="text-xs text-gray-500">{t('admin_integrations_credential_hint')}</span>
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700 md:w-1/3">
                <span className="font-medium">{t('admin_integrations_miniflux_label')}</span>
                <input
                  type="text"
                  className="input"
                  value={integrationInputs.miniflux}
                  onChange={handleIntegrationInputChange('miniflux')}
                  placeholder={t('admin_integrations_credential_placeholder')}
                />
                <span className="text-xs text-gray-500">{t('admin_integrations_credential_hint')}</span>
              </label>
              <div className="md:ml-auto">
                <button type="submit" className="btn">
                  {t('admin_integrations_run_checks')}
                </button>
              </div>
            </form>
            {integrationEntries.length === 0 && !integrationLoading && !integrationError && (
              <p className="text-sm text-gray-600">{t('admin_integrations_empty')}</p>
            )}
            {integrationEntries.length > 0 && (
              <div className="overflow-x-auto">
                <table className="table" role="table" aria-label={t('admin_integrations_table_label')}>
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="th">{t('admin_integrations_column_integration')}</th>
                      <th className="th">{t('admin_integrations_column_connectivity')}</th>
                      <th className="th">{t('admin_integrations_column_rate_limit')}</th>
                      <th className="th">{t('admin_integrations_column_backoff')}</th>
                      <th className="th">{t('admin_integrations_column_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {integrationEntries.map(([name, detail]) => {
                      const normalizedName = typeof name === 'string' ? name : String(name)
                      const label =
                        normalizedName === 'instapaper'
                          ? t('admin_integrations_name_instapaper')
                          : normalizedName === 'miniflux'
                            ? t('admin_integrations_name_miniflux')
                            : normalizedName
                                .replace(/[_-]+/g, ' ')
                                .replace(/\b\w/g, (c) => c.toUpperCase())
                      const credentialFromDetail = pickFirst<string>(detail, ['credential_id', 'credentialId']) || ''
                      const currentInput =
                        (normalizedName === 'instapaper' ? integrationInputs.instapaper : integrationInputs.miniflux).trim()
                      const credentialId = currentInput || credentialFromDetail
                      const ok = detail?.ok
                      const statusCode = pickFirst<number>(detail, ['status', 'status_code', 'statusCode', 'http_status'])
                      const lastCheckedRaw = pickFirst<number | string>(detail, [
                        'checked_at',
                        'checkedAt',
                        'last_checked_at',
                        'lastCheckedAt',
                      ])
                      const lastChecked = formatTimestamp(lastCheckedRaw, locale)
                      const error = pickFirst<string>(detail, ['error', 'message', 'last_error', 'lastError'])
                      const connectivityClass = ok === true ? 'text-green-600' : ok === false ? 'text-red-600' : 'text-gray-700'
                      const connectivityLabel =
                        ok === true
                          ? t('admin_integrations_connectivity_ok')
                          : ok === false
                            ? t('admin_integrations_connectivity_failed')
                            : t('admin_integrations_connectivity_unknown')
                      const canRetry = Boolean(testers[normalizedName] && credentialId)
                      const isRetrying = retryingIntegration === normalizedName
                      const rateLimitDescription = describeRateLimit(detail, locale, t)
                      const backoffDescription = describeBackoff(detail, locale, t)
                      const endpoint = pickFirst<string>(detail, ['endpoint', 'url'])
                      return (
                        <tr key={normalizedName} className="odd:bg-white even:bg-gray-50 align-top">
                          <td className="td">
                            <div className="font-semibold text-gray-900">{label}</div>
                            {credentialId && (
                              <div className="text-xs text-gray-500">{t('admin_integrations_credential_value', { id: credentialId })}</div>
                            )}
                            {!credentialId && (
                              <div className="text-xs text-gray-500">{t('admin_integrations_credential_missing')}</div>
                            )}
                            {endpoint && (
                              <div className="text-xs text-gray-500">{t('admin_integrations_endpoint', { endpoint })}</div>
                            )}
                          </td>
                          <td className="td">
                            <div className={`font-medium ${connectivityClass}`}>{connectivityLabel}</div>
                            {statusCode != null && (
                              <div className="text-sm text-gray-700">{t('admin_integrations_status_code', { status: statusCode })}</div>
                            )}
                            {lastChecked && (
                              <div className="text-xs text-gray-500">{t('admin_integrations_last_checked', { time: lastChecked })}</div>
                            )}
                            {error && (
                              <div className="text-xs text-red-600">{t('admin_integrations_error_message', { message: error })}</div>
                            )}
                          </td>
                          <td className="td text-sm text-gray-800">{rateLimitDescription}</td>
                          <td className="td text-sm text-gray-800">{backoffDescription}</td>
                          <td className="td">
                            <div className="flex flex-col gap-2 items-start">
                              <button
                                type="button"
                                className="btn"
                                onClick={() => void handleRetryIntegration(normalizedName)}
                                disabled={!canRetry || isRetrying}
                              >
                                {isRetrying
                                  ? t('admin_integrations_retrying', { name: label })
                                  : t('admin_integrations_retry_button', { name: label })}
                              </button>
                              {!canRetry && (
                                <p className="text-xs text-gray-500">{t('admin_integrations_retry_requires_credential')}</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
    </ErrorBoundary>
  )
}
