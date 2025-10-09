import { useMemo } from 'react'
import { useRouter } from 'next/router'
import { signIn, useSession } from 'next-auth/react'

import { Breadcrumbs, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useFormatDateTime } from '../../lib/format'
import { decodeBase64UrlSegment } from '../../lib/base64'

type JwtClaims = Record<string, unknown>

type SessionUser = {
  id?: string | null
  displayName?: string | null
  name?: string | null
  email?: string | null
  roles?: string[] | null
  groups?: string[] | null
  permissions?: string[] | null
}

function isIterableObject(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.iterator in (value as Record<string, unknown>)
}

function normalizeStringList(value: unknown): string[] {
  if (!value) {
    return []
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
  }
  if (isIterableObject(value)) {
    const results: string[] = []
    for (const entry of value) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim()
        if (trimmed) {
          results.push(trimmed)
        }
      }
    }
    return results
  }
  return []
}

function decodeJwtClaims(token?: string | null): JwtClaims | null {
  if (!token) {
    return null
  }
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }
  const payload = decodeBase64UrlSegment(parts[1])
  if (!payload) {
    return null
  }
  try {
    const parsed = JSON.parse(payload)
    return parsed && typeof parsed === 'object' ? (parsed as JwtClaims) : null
  } catch {
    return null
  }
}

function parseEpochSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function toDateFromEpoch(seconds: number | null): Date | null {
  if (seconds === null) {
    return null
  }
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

function renderStringList(values: string[], emptyLabel: string) {
  if (!values.length) {
    return <span className="text-sm text-gray-500">{emptyLabel}</span>
  }
  return (
    <ul className="text-sm text-gray-900 dark:text-gray-100 list-disc pl-5 space-y-1">
      {values.map((value, index) => (
        <li key={`${value}-${index}`} className="font-mono break-all">
          {value}
        </li>
      ))}
    </ul>
  )
}

export default function Debug() {
  const { data: session, status } = useSession()
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const formatDateTime = useFormatDateTime({ dateStyle: 'medium', timeStyle: 'long' })

  if (status === 'loading') {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <p className="text-gray-700 dark:text-gray-300">{t('loading_text')}</p>
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <section className="card p-4 max-w-2xl">
              <h2 className="text-xl font-semibold mb-2">{t('me_debug_title')}</h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">{t('me_debug_sign_in_message')}</p>
              <button type="button" className="btn" onClick={() => signIn('oidc')}>
                {t('btn_sign_in')}
              </button>
            </section>
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  const user = (session?.user ?? null) as SessionUser | null
  const displayName = user?.displayName?.trim() || null
  const name = user?.name?.trim() || null
  const email = user?.email?.trim() || null
  const userId = user?.id?.trim() || null
  const roles = [...(user?.roles ?? [])].map((role) => role?.trim()).filter((role): role is string => Boolean(role)).sort()
  const groups = [...(user?.groups ?? [])].map((group) => group?.trim()).filter((group): group is string => Boolean(group)).sort()
  const permissions = [...(user?.permissions ?? [])]
    .map((permission) => permission?.trim())
    .filter((permission): permission is string => Boolean(permission))
    .sort()

  const idTokenClaims = decodeJwtClaims(session?.idToken)
  const subjectClaim = typeof idTokenClaims?.sub === 'string' ? idTokenClaims.sub : null
  const issuerClaim = typeof idTokenClaims?.iss === 'string' ? idTokenClaims.iss : null
  const audienceClaim = normalizeStringList(idTokenClaims?.aud)
  const iatSeconds = parseEpochSeconds(idTokenClaims?.iat)
  const expSeconds = parseEpochSeconds(idTokenClaims?.exp)
  const authTimeSeconds = parseEpochSeconds(idTokenClaims?.auth_time)
  const iatDate = toDateFromEpoch(iatSeconds)
  const expDate = toDateFromEpoch(expSeconds)
  const authTimeDate = toDateFromEpoch(authTimeSeconds)
  const formattedIat = iatDate ? formatDateTime(iatDate, '') : ''
  const formattedExp = expDate ? formatDateTime(expDate, '') : ''
  const formattedAuthTime = authTimeDate ? formatDateTime(authTimeDate, '') : ''
  const sessionExpiresAt = session?.expires ? new Date(session.expires) : null
  const validSessionExpiresAt = sessionExpiresAt && !Number.isNaN(sessionExpiresAt.getTime()) ? sessionExpiresAt : null
  const formattedSessionExpires = validSessionExpiresAt ? formatDateTime(validSessionExpiresAt, '') : ''
  const noneLabel = t('me_debug_none')
  const notAvailableLabel = t('me_debug_not_available')

  const idTokenLength = session?.idToken ? session.idToken.length : 0
  const accessTokenLength = session?.accessToken ? session.accessToken.length : 0
  const sessionJson = session ? JSON.stringify(session, null, 2) : null
  const claimsJson = idTokenClaims ? JSON.stringify(idTokenClaims, null, 2) : null

  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6 space-y-4">
          <header className="space-y-1">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('me_debug_title')}</h2>
            <p className="text-gray-700 dark:text-gray-300">{t('me_debug_description')}</p>
          </header>

          <section className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('me_debug_identity_heading')}</h3>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_identity_display_name')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">
                  {displayName ? <span className="break-all">{displayName}</span> : <span className="text-gray-500">{noneLabel}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_identity_name')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">
                  {name ? <span className="break-all">{name}</span> : <span className="text-gray-500">{noneLabel}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_identity_email')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">
                  {email ? <span className="break-all">{email}</span> : <span className="text-gray-500">{noneLabel}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_identity_user_id')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">
                  {userId ? <code className="font-mono break-all">{userId}</code> : <span className="text-gray-500">{noneLabel}</span>}
                </dd>
              </div>
            </dl>
          </section>

          <section className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('me_debug_oidc_heading')}</h3>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_oidc_sub_label')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">
                  {subjectClaim ? (
                    <code className="font-mono break-all">{subjectClaim}</code>
                  ) : userId ? (
                    <code className="font-mono break-all">{userId}</code>
                  ) : (
                    <span className="text-gray-500">{notAvailableLabel}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_oidc_iss_label')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">
                  {issuerClaim ? (
                    <span className="break-all">{issuerClaim}</span>
                  ) : (
                    <span className="text-gray-500">{notAvailableLabel}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_oidc_aud_label')}</dt>
                <dd>{renderStringList(audienceClaim, noneLabel)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_oidc_iat_label')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100 space-y-1">
                  {iatSeconds !== null ? (
                    <>
                      <code className="font-mono break-all">{iatSeconds}</code>
                      {formattedIat ? (
                        <div className="text-xs text-gray-500">{t('me_debug_local_time_label', { value: formattedIat })}</div>
                      ) : null}
                      {iatDate ? (
                        <div className="text-xs text-gray-500">{t('me_debug_iso_time_label', { value: iatDate.toISOString() })}</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-gray-500">{notAvailableLabel}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_oidc_exp_label')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100 space-y-1">
                  {expSeconds !== null ? (
                    <>
                      <code className="font-mono break-all">{expSeconds}</code>
                      {formattedExp ? (
                        <div className="text-xs text-gray-500">{t('me_debug_local_time_label', { value: formattedExp })}</div>
                      ) : null}
                      {expDate ? (
                        <div className="text-xs text-gray-500">{t('me_debug_iso_time_label', { value: expDate.toISOString() })}</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-gray-500">{notAvailableLabel}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_oidc_auth_time_label')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100 space-y-1">
                  {authTimeSeconds !== null ? (
                    <>
                      <code className="font-mono break-all">{authTimeSeconds}</code>
                      {formattedAuthTime ? (
                        <div className="text-xs text-gray-500">{t('me_debug_local_time_label', { value: formattedAuthTime })}</div>
                      ) : null}
                      {authTimeDate ? (
                        <div className="text-xs text-gray-500">{t('me_debug_iso_time_label', { value: authTimeDate.toISOString() })}</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-gray-500">{notAvailableLabel}</span>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">{t('me_debug_oidc_claims_label')}</h4>
              {claimsJson ? (
                <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words dark:bg-gray-900/40 dark:border-gray-700 dark:text-gray-100">
                  {claimsJson}
                </pre>
              ) : (
                <p className="text-sm text-gray-500">{notAvailableLabel}</p>
              )}
            </div>
          </section>

          <section className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('me_debug_access_heading')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{t('me_debug_access_roles_label')}</h4>
                {renderStringList(roles, noneLabel)}
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{t('me_debug_access_groups_label')}</h4>
                {renderStringList(groups, noneLabel)}
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{t('me_debug_access_permissions_label')}</h4>
                {renderStringList(permissions, noneLabel)}
              </div>
            </div>
          </section>

          <section className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('me_debug_tokens_heading')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{t('me_debug_tokens_id_token_label')}</h4>
                <div className="text-xs text-gray-500 mb-1">{t('me_debug_token_length_label', { value: idTokenLength })}</div>
                {session?.idToken ? (
                  <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words dark:bg-gray-900/40 dark:border-gray-700 dark:text-gray-100">
                    {session.idToken}
                  </pre>
                ) : (
                  <p className="text-sm text-gray-500">{notAvailableLabel}</p>
                )}
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{t('me_debug_tokens_access_token_label')}</h4>
                <div className="text-xs text-gray-500 mb-1">{t('me_debug_token_length_label', { value: accessTokenLength })}</div>
                {session?.accessToken ? (
                  <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words dark:bg-gray-900/40 dark:border-gray-700 dark:text-gray-100">
                    {session.accessToken}
                  </pre>
                ) : (
                  <p className="text-sm text-gray-500">{notAvailableLabel}</p>
                )}
              </div>
            </div>
          </section>

          <section className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('me_debug_session_heading')}</h3>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <dt className="text-sm font-medium text-gray-600">{t('me_debug_session_expires_label')}</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100 space-y-1">
                  {session?.expires ? (
                    <>
                      <code className="font-mono break-all">{session.expires}</code>
                      {formattedSessionExpires ? (
                        <div className="text-xs text-gray-500">{t('me_debug_local_time_label', { value: formattedSessionExpires })}</div>
                      ) : null}
                      {validSessionExpiresAt ? (
                        <div className="text-xs text-gray-500">{t('me_debug_iso_time_label', { value: validSessionExpiresAt.toISOString() })}</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-gray-500">{notAvailableLabel}</span>
                  )}
                </dd>
              </div>
            </dl>
            <div>
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">{t('me_debug_session_raw_label')}</h4>
              {sessionJson ? (
                <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words dark:bg-gray-900/40 dark:border-gray-700 dark:text-gray-100">
                  {sessionJson}
                </pre>
              ) : (
                <p className="text-sm text-gray-500">{notAvailableLabel}</p>
              )}
            </div>
          </section>
        </main>
      </div>
    </ErrorBoundary>
  )
}
