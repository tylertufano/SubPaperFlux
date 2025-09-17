import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'
import { useFormatDateTime, useNumberFormatter } from '../../lib/format'
import { v1, type AdminUser, type AdminUsersPage } from '../../lib/openapi'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useRouter } from 'next/router'

type FilterState = {
  search: string
  status: 'all' | 'active' | 'inactive'
  role: string
}

const quotaFields = ['quota_credentials', 'quota_site_configs', 'quota_feeds', 'quota_api_tokens'] as const
type QuotaField = (typeof quotaFields)[number]

type QuotaFormState = Record<QuotaField, string>

type AdminUserUpdateInput = Partial<Record<QuotaField, number | null>> & {
  is_active?: boolean
  confirm?: boolean
}

const quotaFieldLabelKeys: Record<QuotaField, string> = {
  quota_credentials: 'admin_users_quota_label_credentials',
  quota_site_configs: 'admin_users_quota_label_site_configs',
  quota_feeds: 'admin_users_quota_label_feeds',
  quota_api_tokens: 'admin_users_quota_label_api_tokens',
}

type FlashMessage = { kind: 'success' | 'error'; message: string }

function createEmptyFilters(): FilterState {
  return { search: '', status: 'all', role: '' }
}

function createQuotaFormState(user: AdminUser | null): QuotaFormState {
  return {
    quota_credentials: user?.quota_credentials != null ? String(user.quota_credentials) : '',
    quota_site_configs: user?.quota_site_configs != null ? String(user.quota_site_configs) : '',
    quota_feeds: user?.quota_feeds != null ? String(user.quota_feeds) : '',
    quota_api_tokens: user?.quota_api_tokens != null ? String(user.quota_api_tokens) : '',
  }
}

function displayName(user: AdminUser): string {
  return user.full_name || user.email || user.id
}

function statusBadge(user: AdminUser, t: ReturnType<typeof useI18n>['t']): { label: string; className: string } {
  if (user.is_active) {
    return { label: t('admin_users_status_active_badge'), className: 'bg-green-100 text-green-800' }
  }
  return { label: t('admin_users_status_inactive_badge'), className: 'bg-red-100 text-red-800' }
}

export default function AdminUsers() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const numberFormatter = useNumberFormatter()
  const formatDateTime = useFormatDateTime({ dateStyle: 'medium', timeStyle: 'short' })
  const [formState, setFormState] = useState<FilterState>(createEmptyFilters)
  const [filters, setFilters] = useState<FilterState>(createEmptyFilters)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [quotaForm, setQuotaForm] = useState<QuotaFormState>(() => createQuotaFormState(null))
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (flash) {
      const timer = window.setTimeout(() => setFlash(null), 5000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [flash])

  useEffect(() => {
    if (selected && closeButtonRef.current) {
      closeButtonRef.current.focus()
    }
  }, [selected])

  useEffect(() => {
    if (!selected) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelected(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected])

  useEffect(() => {
    setSelected(null)
  }, [page, filters])

  useEffect(() => {
    setQuotaForm(createQuotaFormState(selected))
  }, [selected])

  const swrKey = useMemo(
    () =>
      [
        '/v1/admin/users',
        page,
        size,
        filters.search,
        filters.status,
        filters.role,
      ] as const,
    [page, size, filters],
  )

  const { data, error, isLoading, mutate } = useSWR<AdminUsersPage>(
    swrKey,
    ([, currentPage, pageSize, search, status, role]) =>
      v1.listAdminUsersV1AdminUsersGet({
        page: currentPage,
        size: pageSize,
        search: search ? search.trim() : undefined,
        role: role ? role.trim() : undefined,
        isActive: status === 'all' ? undefined : status === 'active',
      }),
  )

  const totalPages = data ? data.total_pages ?? Math.max(1, Math.ceil(data.total / Math.max(1, data.size))) : 1
  const hasPrev = Boolean(data && data.page > 1)
  const hasNext = Boolean(data && (data.has_next ?? data.page < totalPages))

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setFilters({
      search: formState.search.trim(),
      status: formState.status,
      role: formState.role.trim(),
    })
  }

  const handleClear = () => {
    const empty = createEmptyFilters()
    setFormState(empty)
    setFilters(empty)
    setPage(1)
    setSize(20)
    setFlash(null)
    setSelected(null)
  }

  const applyRoleFilter = (role: string) => {
    const trimmed = role.trim()
    setFormState((prev) => ({ ...prev, role: trimmed }))
    setFilters((prev) => ({ ...prev, role: trimmed }))
    setPage(1)
    setSelected(null)
  }

  const handleToggleActive = async (user: AdminUser, nextActive: boolean) => {
    if (!nextActive) {
      const confirmed = window.confirm(
        t('admin_users_suspend_confirm', { name: displayName(user) }),
      )
      if (!confirmed) {
        return
      }
    }
    setPendingUserId(user.id)
    setFlash(null)
    try {
      const adminUserUpdate: { is_active: boolean; confirm?: boolean } = { is_active: nextActive }
      if (!nextActive) {
        adminUserUpdate.confirm = true
      }
      const updated = await v1.updateAdminUserV1AdminUsersUserIdPatch({
        userId: user.id,
        adminUserUpdate,
      })
      setFlash({
        kind: 'success',
        message: nextActive
          ? t('admin_users_reactivated_success', { name: displayName(updated) })
          : t('admin_users_suspended_success', { name: displayName(updated) }),
      })
      if (selected?.id === updated.id) {
        setSelected(updated)
      }
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setPendingUserId(null)
    }
  }

  const handleQuotaSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) {
      return
    }
    const updates: AdminUserUpdateInput = {}
    for (const field of quotaFields) {
      const rawValue = quotaForm[field].trim()
      const currentValue = selected[field] ?? null
      if (rawValue === '') {
        if (currentValue !== null) {
          updates[field] = null
        }
        continue
      }
      const parsed = Number(rawValue)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFlash({ kind: 'error', message: t('admin_users_quota_invalid_number') })
        return
      }
      if (currentValue !== parsed) {
        updates[field] = parsed
      }
    }
    if (Object.keys(updates).length === 0) {
      setFlash({ kind: 'error', message: t('admin_users_quota_no_changes') })
      return
    }
    setPendingUserId(selected.id)
    setFlash(null)
    try {
      const updated = await v1.updateAdminUserV1AdminUsersUserIdPatch({
        userId: selected.id,
        adminUserUpdate: updates,
      })
      setFlash({
        kind: 'success',
        message: t('admin_users_quota_success', { name: displayName(updated) }),
      })
      setSelected(updated)
      setQuotaForm(createQuotaFormState(updated))
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setPendingUserId(null)
    }
  }

  const handleQuotaReset = () => {
    setQuotaForm(createQuotaFormState(selected))
  }

  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6">
          <h2 id="admin-users-heading" className="text-xl font-semibold mb-1">{t('nav_users')}</h2>
          <p className="text-gray-600 mb-4">{t('admin_users_description')}</p>
          <form
            className="card p-4 mb-4"
            role="search"
            aria-labelledby="admin-users-heading"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-users-search">
                {t('admin_users_search_label')}
                <input
                  id="admin-users-search"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.search}
                  placeholder={t('admin_users_search_placeholder')}
                  onChange={(event) => setFormState((prev) => ({ ...prev, search: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-users-role">
                {t('admin_users_role_filter_label')}
                <input
                  id="admin-users-role"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.role}
                  placeholder={t('admin_users_role_placeholder')}
                  onChange={(event) => setFormState((prev) => ({ ...prev, role: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-users-status">
                {t('admin_users_status_filter_label')}
                <select
                  id="admin-users-status"
                  className="input mt-1 w-full"
                  value={formState.status}
                  onChange={(event) => setFormState((prev) => ({ ...prev, status: event.target.value as FilterState['status'] }))}
                >
                  <option value="all">{t('admin_users_status_all')}</option>
                  <option value="active">{t('admin_users_status_active')}</option>
                  <option value="inactive">{t('admin_users_status_inactive')}</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-users-page-size">
                {t('admin_users_page_size_label')}
                <select
                  id="admin-users-page-size"
                  className="input mt-1 w-full"
                  value={size}
                  onChange={(event) => {
                    const nextSize = Number(event.target.value) || 20
                    setSize(nextSize)
                    setPage(1)
                  }}
                >
                  {[20, 50, 100, 150, 200].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" className="btn">
                {t('btn_search')}
              </button>
              <button type="button" className="btn" onClick={handleClear}>
                {t('btn_clear_filters')}
              </button>
            </div>
          </form>
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
          {isLoading && <p className="text-gray-600 mb-4">{t('loading_text')}</p>}
          {data && (
            <div className="card p-0 overflow-hidden">
              {data.items && data.items.length > 0 ? (
                <>
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="text-sm text-gray-600">
                      {t('admin_users_total_count', { count: numberFormatter.format(data.total) })}
                    </p>
                  </div>
                  <table className="table" role="table" aria-label={t('admin_users_table_label')}>
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="th" scope="col">{t('admin_users_column_identity')}</th>
                        <th className="th" scope="col">{t('admin_users_column_roles')}</th>
                        <th className="th" scope="col">{t('admin_users_column_groups')}</th>
                        <th className="th" scope="col">{t('admin_users_column_status')}</th>
                        <th className="th" scope="col">{t('admin_users_column_last_login')}</th>
                        <th className="th" scope="col">{t('actions_label')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((user) => {
                        const badge = statusBadge(user, t)
                        return (
                          <tr key={user.id} className="odd:bg-white even:bg-gray-50">
                            <td className="td align-top">
                              <div className="flex items-start gap-3">
                                <div className="mt-1 h-10 w-10 flex-none overflow-hidden rounded-full bg-gray-200 text-center text-sm font-semibold leading-10 text-gray-600">
                                  {user.picture_url ? (
                                    <img
                                      src={user.picture_url}
                                      alt={displayName(user)}
                                      className="h-10 w-10 rounded-full object-cover"
                                    />
                                  ) : (
                                    (displayName(user)[0] || '?').toUpperCase()
                                  )}
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">{displayName(user)}</div>
                                  <div className="text-sm text-gray-600">{user.email || t('admin_users_email_unknown')}</div>
                                  <div className="text-xs text-gray-500">{user.id}</div>
                                </div>
                              </div>
                            </td>
                            <td className="td align-top">
                              <div className="flex flex-wrap gap-1">
                                {user.roles.length === 0 && (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                    {t('admin_users_roles_empty')}
                                  </span>
                                )}
                                {user.roles.map((role) => (
                                  <button
                                    key={role}
                                    type="button"
                                    className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    onClick={() => applyRoleFilter(role)}
                                  >
                                    {role}
                                  </button>
                                ))}
                                {user.is_admin && (
                                  <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
                                    {t('admin_users_role_admin_badge')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="td align-top">
                              <div className="flex flex-wrap gap-1">
                                {user.groups.length === 0 && (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                    {t('admin_users_groups_empty')}
                                  </span>
                                )}
                                {user.groups.map((group) => (
                                  <span
                                    key={group}
                                    className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700"
                                  >
                                    {group}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="td align-top">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="td align-top text-sm text-gray-800">
                              {formatDateTime(user.last_login_at, t('admin_users_last_login_unknown'))}
                            </td>
                            <td className="td align-top">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => setSelected(user)}
                                  aria-expanded={selected?.id === user.id}
                                >
                                  {t('admin_users_view_details')}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={pendingUserId === user.id}
                                  onClick={() => handleToggleActive(user, !user.is_active)}
                                >
                                  {user.is_active ? t('admin_users_suspend') : t('admin_users_reactivate')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
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
                    icon={<span aria-hidden="true">🧑‍🤝‍🧑</span>}
                    message={(
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700">{t('empty_admin_users_title')}</p>
                        <p>{t('admin_users_empty_description')}</p>
                      </div>
                    )}
                    action={
                      <button type="button" className="btn" onClick={handleClear}>
                        {t('btn_clear_filters')}
                      </button>
                    }
                  />
                </div>
              )}
            </div>
          )}
        </main>
        {selected && (
          <div className="fixed inset-0 z-40 flex">
            <button
              type="button"
              className="flex-1 bg-black/40 focus:outline-none"
              aria-label={t('btn_close')}
              onClick={() => setSelected(null)}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-user-drawer-title"
              className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 id="admin-user-drawer-title" className="text-lg font-semibold text-gray-900">
                    {displayName(selected)}
                  </h3>
                  <p className="text-sm text-gray-600">{selected.email || t('admin_users_email_unknown')}</p>
                </div>
                <button type="button" className="btn" onClick={() => setSelected(null)} ref={closeButtonRef}>
                  {t('btn_close')}
                </button>
              </div>
              <div className="space-y-4 px-6 py-4">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_id_label')}</dt>
                    <dd className="text-sm text-gray-900 break-all">{selected.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_status')}</dt>
                    <dd className="text-sm text-gray-900">{statusBadge(selected, t).label}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_created')}</dt>
                    <dd className="text-sm text-gray-900">{formatDateTime(selected.created_at, '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_updated')}</dt>
                    <dd className="text-sm text-gray-900">{formatDateTime(selected.updated_at, '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_last_login')}</dt>
                    <dd className="text-sm text-gray-900">{formatDateTime(selected.last_login_at, t('admin_users_last_login_unknown'))}</dd>
                  </div>
                </dl>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-600">{t('admin_users_details_roles')}</h4>
                  <div className="flex flex-wrap gap-1">
                    {selected.roles.length === 0 && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {t('admin_users_roles_empty')}
                      </span>
                    )}
                    {selected.roles.map((role) => (
                      <button
                        key={role}
                        type="button"
                        className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onClick={() => {
                          applyRoleFilter(role)
                          setSelected(null)
                        }}
                      >
                        {role}
                      </button>
                    ))}
                    {selected.is_admin && (
                      <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
                        {t('admin_users_role_admin_badge')}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-600">{t('admin_users_details_groups')}</h4>
                  <div className="flex flex-wrap gap-1">
                    {selected.groups.length === 0 && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {t('admin_users_groups_empty')}
                      </span>
                    )}
                    {selected.groups.map((group) => (
                      <span key={group} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                        {group}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-600">{t('admin_users_quota_heading')}</h4>
                  <p className="mb-3 text-sm text-gray-500">{t('admin_users_quota_description')}</p>
                  <form className="space-y-3" onSubmit={handleQuotaSubmit}>
                    <div className="grid gap-3">
                      {quotaFields.map((field) => (
                        <label key={field} className="block text-sm font-medium text-gray-700" htmlFor={`quota-${field}`}>
                          {t(quotaFieldLabelKeys[field])}
                          <input
                            id={`quota-${field}`}
                            className="input mt-1 w-full"
                            type="number"
                            min={0}
                            value={quotaForm[field]}
                            placeholder={t('admin_users_quota_placeholder')}
                            onChange={(event) =>
                              setQuotaForm((prev) => ({ ...prev, [field]: event.target.value }))
                            }
                            disabled={pendingUserId === selected.id}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className="btn" disabled={pendingUserId === selected.id}>
                        {t('admin_users_quota_save')}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={handleQuotaReset}
                        disabled={pendingUserId === selected.id}
                      >
                        {t('admin_users_quota_reset')}
                      </button>
                    </div>
                  </form>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn"
                    disabled={pendingUserId === selected.id || selected.is_active}
                    onClick={() => handleToggleActive(selected, false)}
                  >
                    {t('admin_users_suspend')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={pendingUserId === selected.id || !selected.is_active}
                    onClick={() => handleToggleActive(selected, true)}
                  >
                    {t('admin_users_reactivate')}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}

