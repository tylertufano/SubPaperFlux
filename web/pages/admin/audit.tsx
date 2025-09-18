import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'
import { useFeatureFlags } from '../../lib/featureFlags'
import { v1, type AuditLogEntry, type AuditLogsPage } from '../../lib/openapi'
import { useFormatDateTime, useNumberFormatter } from '../../lib/format'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useRouter } from 'next/router'

type FilterState = {
  entityType: string
  entityId: string
  action: string
  ownerUserId: string
  actorUserId: string
  since: string
  until: string
}

type AuditKey = [
  '/v1/admin/audit',
  number,
  number,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]

function createEmptyFilters(): FilterState {
  return {
    entityType: '',
    entityId: '',
    action: '',
    ownerUserId: '',
    actorUserId: '',
    since: '',
    until: '',
  }
}

function toIsoString(input: string): string | undefined {
  if (!input) return undefined
  const date = new Date(input)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export default function AdminAudit() {
  const { t } = useI18n()
  const { userMgmtCore, userMgmtUi, isLoaded: flagsLoaded } = useFeatureFlags()
  const auditEnabled = userMgmtCore && userMgmtUi
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const numberFormatter = useNumberFormatter()
  const formatDateTime = useFormatDateTime({ dateStyle: 'medium', timeStyle: 'short' })
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [formState, setFormState] = useState<FilterState>(createEmptyFilters)
  const [filters, setFilters] = useState<FilterState>(createEmptyFilters)
  const [selected, setSelected] = useState<AuditLogEntry | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

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

  const {
    entityType: filterEntityType,
    entityId: filterEntityId,
    action: filterAction,
    ownerUserId: filterOwnerUserId,
    actorUserId: filterActorUserId,
    since: filterSince,
    until: filterUntil,
  } = filters
  const canFetch = flagsLoaded && auditEnabled

  const swrKey = useMemo<AuditKey | null>(
    () =>
      canFetch
        ? [
            '/v1/admin/audit',
            page,
            size,
            filterEntityType,
            filterEntityId,
            filterAction,
            filterOwnerUserId,
            filterActorUserId,
            filterSince,
            filterUntil,
          ]
        : null,
    [
      canFetch,
      page,
      size,
      filterEntityType,
      filterEntityId,
      filterAction,
      filterOwnerUserId,
      filterActorUserId,
      filterSince,
      filterUntil,
    ],
  )

  const { data, error, isLoading } = useSWR<AuditLogsPage, Error, AuditKey | null>(
    swrKey,
    ([
      ,
      currentPage,
      pageSize,
      entityType,
      entityId,
      action,
      ownerUserId,
      actorUserId,
      since,
      until,
    ]) =>
      v1.listAuditLogsV1AdminAuditGet({
        page: currentPage,
        size: pageSize,
        entityType: entityType || undefined,
        entityId: entityId || undefined,
        action: action || undefined,
        ownerUserId: ownerUserId || undefined,
        actorUserId: actorUserId || undefined,
        since: toIsoString(since),
        until: toIsoString(until),
      }),
  )

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setFilters({ ...formState })
  }

  const handleClear = () => {
    const empty = createEmptyFilters()
    setFormState(empty)
    setFilters(empty)
    setSelected(null)
    setPage(1)
    setSize(50)
  }

  const applyFilterAndClose = (partial: Partial<FilterState>) => {
    setFormState((prev) => ({ ...prev, ...partial }))
    setFilters((prev) => ({ ...prev, ...partial }))
    setPage(1)
    setSelected(null)
  }

  const totalPages = data ? data.total_pages ?? Math.max(1, Math.ceil(data.total / Math.max(1, data.size))) : 1
  const hasPrev = Boolean(data && data.page > 1)
  const hasNext = Boolean(data && (data.has_next ?? data.page < totalPages))

  if (!flagsLoaded) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 id="audit-heading" className="text-xl font-semibold mb-1">
              {t('nav_audit')}
            </h2>
            <p className="text-gray-600 mb-4">{t('loading_text')}</p>
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  if (!auditEnabled) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 id="audit-heading" className="text-xl font-semibold mb-4">
              {t('nav_audit')}
            </h2>
            <Alert kind="info" message={t('admin_audit_disabled_message')} />
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6">
          <h2 id="audit-heading" className="text-xl font-semibold mb-1">{t('nav_audit')}</h2>
          <p className="text-gray-600 mb-4">{t('admin_audit_description')}</p>
          <form
            className="card p-4 mb-4"
            role="search"
            aria-labelledby="audit-heading"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm font-medium text-gray-700" htmlFor="audit-entity-type">
                {t('audit_entity_type_label')}
                <input
                  id="audit-entity-type"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.entityType}
                  onChange={(event) => setFormState((prev) => ({ ...prev, entityType: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="audit-entity-id">
                {t('audit_entity_id_label')}
                <input
                  id="audit-entity-id"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.entityId}
                  onChange={(event) => setFormState((prev) => ({ ...prev, entityId: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="audit-action">
                {t('audit_action_label')}
                <input
                  id="audit-action"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.action}
                  onChange={(event) => setFormState((prev) => ({ ...prev, action: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="audit-owner-user">
                {t('audit_owner_user_label')}
                <input
                  id="audit-owner-user"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.ownerUserId}
                  onChange={(event) => setFormState((prev) => ({ ...prev, ownerUserId: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="audit-actor-user">
                {t('audit_actor_user_label')}
                <input
                  id="audit-actor-user"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.actorUserId}
                  onChange={(event) => setFormState((prev) => ({ ...prev, actorUserId: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="audit-since">
                {t('audit_since_label')}
                <input
                  id="audit-since"
                  className="input mt-1 w-full"
                  type="datetime-local"
                  value={formState.since}
                  onChange={(event) => setFormState((prev) => ({ ...prev, since: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="audit-until">
                {t('audit_until_label')}
                <input
                  id="audit-until"
                  className="input mt-1 w-full"
                  type="datetime-local"
                  value={formState.until}
                  onChange={(event) => setFormState((prev) => ({ ...prev, until: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="audit-page-size">
                {t('audit_page_size_label')}
                <select
                  id="audit-page-size"
                  className="input mt-1 w-full"
                  value={size}
                  onChange={(event) => {
                    const nextSize = Number(event.target.value) || 50
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
                      {t('audit_total_count', { count: numberFormatter.format(data.total) })}
                    </p>
                  </div>
                  <table className="table" role="table" aria-label={t('audit_table_label')}>
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="th" scope="col">{t('audit_column_entity')}</th>
                        <th className="th" scope="col">{t('audit_column_action')}</th>
                        <th className="th" scope="col">{t('audit_column_owner')}</th>
                        <th className="th" scope="col">{t('audit_column_actor')}</th>
                        <th className="th" scope="col">{t('audit_column_created')}</th>
                        <th className="th" scope="col">{t('actions_label')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((item) => (
                        <tr key={item.id} className="odd:bg-white even:bg-gray-50">
                          <td className="td align-top">
                            <div className="font-medium text-gray-900">{item.entity_type}</div>
                            <div className="text-sm text-gray-600 break-all">{item.entity_id}</div>
                          </td>
                          <td className="td align-top">
                            <span className="font-medium text-gray-900">{item.action}</span>
                          </td>
                          <td className="td align-top">
                            <span className="text-sm text-gray-800">{item.owner_user_id || '—'}</span>
                          </td>
                          <td className="td align-top">
                            <span className="text-sm text-gray-800">{item.actor_user_id || '—'}</span>
                          </td>
                          <td className="td align-top">
                            <span className="text-sm text-gray-800">{formatDateTime(item.created_at, '—')}</span>
                          </td>
                          <td className="td align-top">
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setSelected(item)}
                              aria-expanded={selected?.id === item.id}
                            >
                              {t('audit_view_details')}
                            </button>
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
                    icon={<span aria-hidden="true">📜</span>}
                    message={(
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700">{t('empty_admin_audit_title')}</p>
                        <p>{t('audit_empty_description')}</p>
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
              aria-labelledby="audit-drawer-title"
              className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 id="audit-drawer-title" className="text-lg font-semibold text-gray-900">
                    {t('audit_details_heading')}
                  </h3>
                  <p className="text-sm text-gray-600">{formatDateTime(selected.created_at, '—')}</p>
                </div>
                <button type="button" className="btn" onClick={() => setSelected(null)} ref={closeButtonRef}>
                  {t('btn_close')}
                </button>
              </div>
              <div className="space-y-4 px-6 py-4">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('audit_details_id_label')}</dt>
                    <dd className="text-sm text-gray-900 break-all">{selected.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('audit_details_entity_type')}</dt>
                    <dd className="text-sm text-gray-900">{selected.entity_type}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('audit_details_entity_id')}</dt>
                    <dd className="text-sm text-gray-900 break-all">{selected.entity_id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('audit_details_action')}</dt>
                    <dd className="text-sm text-gray-900">{selected.action}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('audit_details_owner')}</dt>
                    <dd className="text-sm text-gray-900">{selected.owner_user_id || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('audit_details_actor')}</dt>
                    <dd className="text-sm text-gray-900">{selected.actor_user_id || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('audit_details_created')}</dt>
                    <dd className="text-sm text-gray-900">{formatDateTime(selected.created_at, '—')}</dd>
                  </div>
                </dl>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-600">{t('audit_details_metadata')}</h4>
                  {selected.details && Object.keys(selected.details).length > 0 ? (
                    <pre className="max-h-80 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-900">
                      {JSON.stringify(selected.details, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-gray-600">{t('audit_details_empty')}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-600">{t('audit_details_drilldown')}</h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => applyFilterAndClose({ entityType: selected.entity_type })}
                    >
                      {t('audit_filter_by_entity_type')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => applyFilterAndClose({ entityId: selected.entity_id || '' })}
                    >
                      {t('audit_filter_by_entity_id')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => applyFilterAndClose({ action: selected.action })}
                    >
                      {t('audit_filter_by_action')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => applyFilterAndClose({ ownerUserId: selected.owner_user_id || '' })}
                      disabled={!selected.owner_user_id}
                    >
                      {t('audit_filter_by_owner')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => applyFilterAndClose({ actorUserId: selected.actor_user_id || '' })}
                      disabled={!selected.actor_user_id}
                    >
                      {t('audit_filter_by_actor')}
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
