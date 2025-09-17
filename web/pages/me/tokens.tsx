import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'
import { useFormatDateTime } from '../../lib/format'
import { v1, type ApiToken, type ApiTokensPage, type ApiTokenWithSecret } from '../../lib/openapi'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useRouter } from 'next/router'

type TokenFormState = {
  name: string
  description: string
  scopes: string
  expiresAt: string
}

type FlashMessage = { kind: 'success' | 'error'; message: string }

function createInitialFormState(): TokenFormState {
  return { name: '', description: '', scopes: '', expiresAt: '' }
}

function toIsoString(input: string): string | undefined {
  if (!input) return undefined
  const date = new Date(input)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function isTokenActive(token: ApiToken): boolean {
  return !token.revoked_at
}

export default function Tokens() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const formatDateTime = useFormatDateTime({ dateStyle: 'medium', timeStyle: 'short' })
  const [formState, setFormState] = useState<TokenFormState>(createInitialFormState)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [includeRevoked, setIncludeRevoked] = useState(false)
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const [issuedToken, setIssuedToken] = useState<ApiTokenWithSecret | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  useEffect(() => {
    if (flash) {
      const timer = window.setTimeout(() => setFlash(null), 5000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [flash])

  const swrKey = useMemo(
    () => ['/v1/me/tokens', page, size, includeRevoked] as const,
    [page, size, includeRevoked],
  )

  const { data, error, isLoading, mutate } = useSWR<ApiTokensPage>(
    swrKey,
    ([, currentPage, pageSize, showRevoked]) =>
      v1.listMeTokensV1MeTokensGet({
        page: currentPage,
        size: pageSize,
        include_revoked: showRevoked,
      }),
  )

  const totalPages = data ? data.total_pages ?? Math.max(1, Math.ceil(data.total / Math.max(1, data.size))) : 1
  const hasPrev = Boolean(data && data.page > 1)
  const hasNext = Boolean(data && (data.has_next ?? data.page < totalPages))

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = formState.name.trim()
    if (!name) {
      setFlash({ kind: 'error', message: t('me_tokens_name_required') })
      return
    }
    setIsSubmitting(true)
    setFlash(null)
    try {
      const scopes = formState.scopes
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0)
      const expiresAt = toIsoString(formState.expiresAt)
      const created = await v1.createMeTokenV1MeTokensPost({
        apiTokenCreate: {
          name,
          description: formState.description.trim() || undefined,
          scopes,
          expires_at: expiresAt,
        },
      })
      setIssuedToken(created)
      setFlash({ kind: 'success', message: t('me_tokens_created_success', { name: created.name }) })
      setFormState(createInitialFormState())
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRevoke = async (token: ApiToken) => {
    if (!window.confirm(t('me_tokens_confirm_revoke', { name: token.name }))) {
      return
    }
    setRevokingId(token.id)
    setFlash(null)
    try {
      await v1.revokeMeTokenV1MeTokensTokenIdDelete({ tokenId: token.id })
      setFlash({ kind: 'success', message: t('me_tokens_revoked_success', { name: token.name }) })
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6">
          <h2 className="text-xl font-semibold mb-1">{t('nav_tokens')}</h2>
          <p className="text-gray-600 mb-4">{t('me_tokens_description')}</p>
          {flash && (
            <div className="mb-4">
              <Alert kind={flash.kind} message={flash.message} />
            </div>
          )}
          {error && (
            <div className="mb-4">
              <Alert kind="error" message={error instanceof Error ? error.message : String(error)} />
            </div>
          )}
          <div className="space-y-4">
            <section className="card p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('me_tokens_create_heading')}</h3>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="token-name">
                    {t('me_tokens_name_label')}
                    <input
                      id="token-name"
                      className="input mt-1 w-full"
                      type="text"
                      value={formState.name}
                      placeholder={t('me_tokens_name_placeholder')}
                      onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                      required
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="token-description">
                    {t('me_tokens_description_label')}
                    <input
                      id="token-description"
                      className="input mt-1 w-full"
                      type="text"
                      value={formState.description}
                      placeholder={t('me_tokens_description_placeholder')}
                      onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="token-scopes">
                    {t('me_tokens_scopes_label')}
                    <input
                      id="token-scopes"
                      className="input mt-1 w-full"
                      type="text"
                      value={formState.scopes}
                      placeholder={t('me_tokens_scopes_placeholder')}
                      onChange={(event) => setFormState((prev) => ({ ...prev, scopes: event.target.value }))}
                    />
                  </label>
                  <p className="mt-1 text-xs text-gray-600">{t('me_tokens_scopes_help')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="token-expires">
                    {t('me_tokens_expires_label')}
                    <input
                      id="token-expires"
                      className="input mt-1 w-full"
                      type="datetime-local"
                      value={formState.expiresAt}
                      onChange={(event) => setFormState((prev) => ({ ...prev, expiresAt: event.target.value }))}
                    />
                  </label>
                  <p className="mt-1 text-xs text-gray-600">{t('me_tokens_expires_help')}</p>
                </div>
                <div>
                  <button type="submit" className="btn" disabled={isSubmitting}>
                    {t('me_tokens_issue_button')}
                  </button>
                </div>
              </form>
              {issuedToken && (
                <div className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                  <p className="font-semibold">{t('me_tokens_secret_heading', { name: issuedToken.name })}</p>
                  <p className="mt-1">{t('me_tokens_secret_notice')}</p>
                  <pre className="mt-2 overflow-auto rounded bg-white p-2 text-sm text-gray-900">{issuedToken.token}</pre>
                </div>
              )}
            </section>
            <section className="card p-0">
              <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-sm text-gray-600">{t('me_tokens_list_heading')}</p>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={includeRevoked}
                    onChange={(event) => {
                      setIncludeRevoked(event.target.checked)
                      setPage(1)
                    }}
                  />
                  {t('me_tokens_include_revoked')}
                </label>
              </div>
              {isLoading && <p className="px-4 py-3 text-sm text-gray-600">{t('loading_text')}</p>}
              {data && data.items.length > 0 ? (
                <>
                  <table className="table" role="table" aria-label={t('me_tokens_table_label')}>
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="th" scope="col">{t('me_tokens_column_name')}</th>
                        <th className="th" scope="col">{t('me_tokens_column_scopes')}</th>
                        <th className="th" scope="col">{t('me_tokens_column_created')}</th>
                        <th className="th" scope="col">{t('me_tokens_column_last_used')}</th>
                        <th className="th" scope="col">{t('me_tokens_column_expires')}</th>
                        <th className="th" scope="col">{t('me_tokens_column_status')}</th>
                        <th className="th" scope="col">{t('actions_label')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((token) => (
                        <tr key={token.id} className="odd:bg-white even:bg-gray-50">
                          <td className="td align-top">
                            <div className="font-medium text-gray-900">{token.name}</div>
                            <div className="text-xs text-gray-500">{token.id}</div>
                            {token.description && (
                              <div className="text-sm text-gray-700">{token.description}</div>
                            )}
                          </td>
                          <td className="td align-top">
                            <div className="flex flex-wrap gap-1">
                              {token.scopes.length === 0 && (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                  {t('me_tokens_scopes_empty')}
                                </span>
                              )}
                              {token.scopes.map((scope) => (
                                <span key={scope} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">
                                  {scope}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="td align-top text-sm text-gray-800">
                            {formatDateTime(token.created_at, '—')}
                          </td>
                          <td className="td align-top text-sm text-gray-800">
                            {formatDateTime(token.last_used_at, t('me_tokens_last_used_never'))}
                          </td>
                          <td className="td align-top text-sm text-gray-800">
                            {token.expires_at ? formatDateTime(token.expires_at, '—') : t('me_tokens_expires_never')}
                          </td>
                          <td className="td align-top">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                isTokenActive(token)
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-200 text-gray-700'
                              }`}
                            >
                              {isTokenActive(token)
                                ? t('me_tokens_status_active')
                                : t('me_tokens_status_revoked')}
                            </span>
                          </td>
                          <td className="td align-top">
                            <div className="flex flex-wrap gap-2">
                              {isTokenActive(token) && (
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => handleRevoke(token)}
                                  disabled={revokingId === token.id}
                                >
                                  {t('me_tokens_revoke_button')}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                      disabled={!hasPrev}
                    >
                      {t('pagination_prev')}
                    </button>
                    <div className="text-sm text-gray-600">
                      {t('pagination_status', { page: data.page, total: totalPages })}
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setPage((prev) => prev + 1)}
                      disabled={!hasNext}
                    >
                      {t('pagination_next')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-6">
                  <EmptyState
                    icon={<span aria-hidden="true">🔑</span>}
                    message={(
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700">{t('empty_tokens_title')}</p>
                        <p>{t('me_tokens_empty_description')}</p>
                      </div>
                    )}
                  />
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  )
}

