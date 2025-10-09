import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'
import { useFeatureFlags } from '../../lib/featureFlags'
import { useFormatDateTime, useNumberFormatter } from '../../lib/format'
import {
  v1,
  type AdminOrganization,
  type AdminOrganizationDetail,
  type AdminOrganizationMember,
  type AdminOrganizationsPage,
  type AdminOrganizationMembershipChangePayload,
} from '../../lib/openapi'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useRouter } from 'next/router'

type FilterState = {
  search: string
  defaultStatus: 'all' | 'default' | 'nondefault'
}

type OrganizationsKey = [
  '/v1/admin/orgs',
  number,
  number,
  string,
  FilterState['defaultStatus'],
]

type FlashMessage = { kind: 'success' | 'error'; message: string }

function createEmptyFilters(): FilterState {
  return { search: '', defaultStatus: 'all' }
}

function organizationDisplayName(org: AdminOrganization): string {
  return org.name || org.slug || org.id
}

function memberDisplayName(member: AdminOrganizationMember): string {
  return member.full_name || member.email || member.id
}

function mapDefaultStatus(value: FilterState['defaultStatus']): boolean | undefined {
  if (value === 'all') return undefined
  return value === 'default'
}

export default function AdminOrgs() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const { userMgmtCore, userMgmtUi, isLoaded: flagsLoaded } = useFeatureFlags()
  const userMgmtEnabled = userMgmtCore && userMgmtUi
  const numberFormatter = useNumberFormatter()
  const formatDateTime = useFormatDateTime({ dateStyle: 'medium', timeStyle: 'short' })
  const [formState, setFormState] = useState<FilterState>(createEmptyFilters)
  const [filters, setFilters] = useState<FilterState>(createEmptyFilters)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const [selectedOrg, setSelectedOrg] = useState<AdminOrganization | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<AdminOrganizationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [memberInput, setMemberInput] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const detailRequestRef = useRef(0)

  useEffect(() => {
    if (!flash) return undefined
    const timer = window.setTimeout(() => setFlash(null), 5000)
    return () => window.clearTimeout(timer)
  }, [flash])

  useEffect(() => {
    if (selectedOrg && closeButtonRef.current) {
      closeButtonRef.current.focus()
    }
  }, [selectedOrg])

  const handleCloseDrawer = useCallback(() => {
    detailRequestRef.current += 1
    setSelectedOrg(null)
    setSelectedDetail(null)
    setDetailError(null)
    setMemberInput('')
    setIsAddingMember(false)
    setRemovingMemberId(null)
    setDetailLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedOrg) return undefined
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleCloseDrawer()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedOrg, handleCloseDrawer])

  useEffect(() => {
    setSelectedOrg(null)
  }, [page, filters])

  useEffect(() => {
    setMemberInput('')
    setDetailError(null)
  }, [selectedOrg])

  const { search, defaultStatus } = filters
  const canFetch = flagsLoaded && userMgmtEnabled

  const swrKey = useMemo<OrganizationsKey | null>(
    () => (canFetch ? ['/v1/admin/orgs', page, size, search, defaultStatus] : null),
    [canFetch, page, size, search, defaultStatus],
  )

  const { data, error, isLoading, mutate } = useSWR<
    AdminOrganizationsPage,
    Error,
    OrganizationsKey | null
  >(
    swrKey,
    ([, currentPage, pageSize, searchValue, defaultFilter]) =>
      v1.listAdminOrganizationsV1AdminOrgsGet({
        page: currentPage,
        size: pageSize,
        search: searchValue ? searchValue.trim() : undefined,
        is_default: mapDefaultStatus(defaultFilter),
      }),
  )

  useEffect(() => {
    if (!selectedOrg || !selectedOrg.id) return
    if (!data?.items) return
    const match = data.items.find((item) => item.id === selectedOrg.id)
    if (!match) return
    setSelectedOrg((prev) => {
      if (!prev || prev.id !== match.id) return prev
      if (
        prev.name !== match.name ||
        prev.slug !== match.slug ||
        prev.description !== match.description ||
        prev.is_default !== match.is_default ||
        prev.member_count !== match.member_count ||
        prev.updated_at !== match.updated_at ||
        prev.created_at !== match.created_at
      ) {
        return { ...prev, ...match }
      }
      return prev
    })
  }, [data, selectedOrg?.id])

  const totalPages = data
    ? data.total_pages ?? Math.max(1, Math.ceil(data.total / Math.max(1, data.size)))
    : 1
  const hasPrev = Boolean(data && data.page > 1)
  const hasNext = Boolean(data && (data.has_next ?? data.page < totalPages))

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setFilters({
      search: formState.search.trim(),
      defaultStatus: formState.defaultStatus,
    })
  }

  const handleClear = () => {
    const empty = createEmptyFilters()
    setFormState(empty)
    setFilters(empty)
    setPage(1)
    setSize(20)
    setFlash(null)
    handleCloseDrawer()
  }

  const handleOpenDetail = async (organization: AdminOrganization) => {
    setSelectedOrg(organization)
    setSelectedDetail(null)
    setDetailError(null)
    setMemberInput('')
    setIsAddingMember(false)
    setRemovingMemberId(null)
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    setDetailLoading(true)
    try {
      const detail = await v1.getOrganizationV1AdminOrgsOrganizationIdGet({
        organizationId: organization.id,
      })
      if (detailRequestRef.current !== requestId) return
      const normalized: AdminOrganizationDetail = {
        ...detail,
        members: detail.members ?? [],
      }
      setSelectedDetail(normalized)
      setSelectedOrg((prev) => {
        if (!prev || prev.id !== normalized.id) return prev
        return {
          ...prev,
          name: normalized.name,
          slug: normalized.slug,
          description: normalized.description,
          is_default: normalized.is_default,
          created_at: normalized.created_at,
          updated_at: normalized.updated_at,
          member_count: normalized.member_count,
        }
      })
    } catch (err) {
      if (detailRequestRef.current !== requestId) return
      const message = err instanceof Error ? err.message : String(err)
      setDetailError(message)
    } finally {
      if (detailRequestRef.current === requestId) {
        setDetailLoading(false)
      }
    }
  }

  const handleAddMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedOrg) return
    const trimmed = memberInput.trim()
    if (!trimmed) {
      setFlash({ kind: 'error', message: t('admin_orgs_members_add_required') })
      return
    }
    const payload: AdminOrganizationMembershipChangePayload = { user_id: trimmed }
    setIsAddingMember(true)
    setFlash(null)
    try {
      const updated = await v1.addOrganizationMemberV1AdminOrgsOrganizationIdMembersPost({
        organizationId: selectedOrg.id,
        adminOrganizationMembershipChange: payload,
      })
      const normalized: AdminOrganizationDetail = {
        ...updated,
        members: updated.members ?? [],
      }
      setFlash({
        kind: 'success',
        message: t('admin_orgs_members_add_success', {
          member: trimmed,
          name: organizationDisplayName(normalized),
        }),
      })
      setMemberInput('')
      setSelectedDetail(normalized)
      setSelectedOrg((prev) => {
        if (!prev || prev.id !== normalized.id) return prev
        return { ...prev, ...normalized }
      })
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setIsAddingMember(false)
    }
  }

  const handleRemoveMember = async (member: AdminOrganizationMember) => {
    if (!selectedOrg) return
    const display = memberDisplayName(member)
    const confirmed = window.confirm(
      t('admin_orgs_members_remove_confirm', {
        member: display,
        name: organizationDisplayName(selectedOrg),
      }),
    )
    if (!confirmed) return
    setRemovingMemberId(member.id)
    setFlash(null)
    try {
      const updated = await v1.removeOrganizationMemberV1AdminOrgsOrganizationIdMembersUserIdDelete({
        organizationId: selectedOrg.id,
        userId: member.id,
      })
      const normalized: AdminOrganizationDetail = {
        ...updated,
        members: updated.members ?? [],
      }
      setFlash({
        kind: 'success',
        message: t('admin_orgs_members_remove_success', {
          member: display,
          name: organizationDisplayName(normalized),
        }),
      })
      setSelectedDetail(normalized)
      setSelectedOrg((prev) => {
        if (!prev || prev.id !== normalized.id) return prev
        return { ...prev, ...normalized }
      })
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setRemovingMemberId(null)
    }
  }

  if (!userMgmtEnabled) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 id="admin-orgs-heading" className="text-xl font-semibold mb-4">
              {t('nav_orgs')}
            </h2>
            <Alert kind="info" message={t('admin_orgs_disabled_message')} />
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  const members = selectedDetail?.members ?? []
  const detailName = selectedDetail?.name ?? selectedOrg?.name ?? ''
  const detailSlug = selectedDetail?.slug ?? selectedOrg?.slug ?? ''
  const detailDescription =
    selectedDetail?.description ?? selectedOrg?.description ?? null
  const detailDefault = selectedDetail?.is_default ?? selectedOrg?.is_default
  const detailCreated = selectedDetail?.created_at ?? selectedOrg?.created_at
  const detailUpdated = selectedDetail?.updated_at ?? selectedOrg?.updated_at
  const detailCount = selectedDetail?.member_count ?? selectedOrg?.member_count ?? 0

  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6">
          <h2 id="admin-orgs-heading" className="text-xl font-semibold mb-1">
            {t('nav_orgs')}
          </h2>
          <p className="text-gray-600 mb-4">{t('admin_orgs_description')}</p>
          <form
            className="card p-4 mb-4"
            role="search"
            aria-labelledby="admin-orgs-heading"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-orgs-search">
                {t('admin_orgs_search_label')}
                <input
                  id="admin-orgs-search"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.search}
                  placeholder={t('admin_orgs_search_placeholder')}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, search: event.target.value }))
                  }
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-orgs-default-filter">
                {t('admin_orgs_default_filter_label')}
                <select
                  id="admin-orgs-default-filter"
                  className="input mt-1 w-full"
                  value={formState.defaultStatus}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      defaultStatus: event.target.value as FilterState['defaultStatus'],
                    }))
                  }
                >
                  <option value="all">{t('admin_orgs_default_filter_all')}</option>
                  <option value="default">{t('admin_orgs_default_filter_default')}</option>
                  <option value="nondefault">{t('admin_orgs_default_filter_nondefault')}</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-orgs-page-size">
                {t('admin_orgs_page_size_label')}
                <select
                  id="admin-orgs-page-size"
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
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {t('admin_orgs_total_count', { count: numberFormatter.format(data.total) })}
                    </p>
                  </div>
                  <table className="table" role="table" aria-label={t('admin_orgs_table_label')}>
                    <thead className="bg-gray-100 dark:bg-gray-800">
                      <tr>
                        <th className="th" scope="col">
                          {t('admin_orgs_column_name')}
                        </th>
                        <th className="th" scope="col">
                          {t('admin_orgs_column_members')}
                        </th>
                        <th className="th" scope="col">
                          {t('admin_orgs_column_default')}
                        </th>
                        <th className="th" scope="col">
                          {t('admin_orgs_column_updated')}
                        </th>
                        <th className="th" scope="col">
                          {t('actions_label')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((organization) => (
                        <tr key={organization.id} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-800 dark:even:bg-gray-900">
                          <td className="td align-top">
                            <div className="space-y-1">
                              <div className="font-medium text-gray-900">
                                {organizationDisplayName(organization)}
                              </div>
                              <div className="text-sm text-gray-600">{organization.slug}</div>
                              {organization.description ? (
                                <div className="text-sm text-gray-500 line-clamp-2">
                                  {organization.description}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="td align-top text-sm text-gray-800">
                            {numberFormatter.format(organization.member_count ?? 0)}
                          </td>
                          <td className="td align-top">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                                organization.is_default
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
                              }`}
                            >
                              {organization.is_default
                                ? t('admin_orgs_default_badge')
                                : t('admin_orgs_custom_badge')}
                            </span>
                          </td>
                          <td className="td align-top text-sm text-gray-800">
                            {formatDateTime(organization.updated_at, '—')}
                          </td>
                          <td className="td align-top">
                            <button
                              type="button"
                              className="btn"
                              onClick={() => handleOpenDetail(organization)}
                              aria-expanded={selectedOrg?.id === organization.id}
                            >
                              {t('admin_orgs_view_details')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                      disabled={!hasPrev}
                    >
                      {t('pagination_prev')}
                    </button>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
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
                    icon={<span aria-hidden="true">🏢</span>}
                    message={
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">
                          {t('admin_orgs_empty_title')}
                        </p>
                        <p>{t('admin_orgs_empty_description')}</p>
                      </div>
                    }
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
        {selectedOrg && (
          <div className="fixed inset-0 z-40 flex">
            <button
              type="button"
              className="flex-1 bg-black/40 focus:outline-none"
              aria-label={t('btn_close')}
              onClick={handleCloseDrawer}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-orgs-drawer-title"
              className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 id="admin-orgs-drawer-title" className="text-lg font-semibold text-gray-900">
                    {detailName}
                  </h3>
                  <p className="text-sm text-gray-600">{detailSlug}</p>
                </div>
                <button type="button" className="btn" onClick={handleCloseDrawer} ref={closeButtonRef}>
                  {t('btn_close')}
                </button>
              </div>
              <div className="space-y-4 px-6 py-4">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">
                      {t('admin_orgs_details_description')}
                    </dt>
                    <dd className="text-sm text-gray-900 whitespace-pre-line break-words">
                      {detailDescription || t('admin_orgs_details_description_none')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">
                      {t('admin_orgs_details_default')}
                    </dt>
                    <dd className="text-sm text-gray-900">
                      {detailDefault ? t('admin_orgs_details_default_yes') : t('admin_orgs_details_default_no')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">
                      {t('admin_orgs_details_member_count')}
                    </dt>
                    <dd className="text-sm text-gray-900">
                      {numberFormatter.format(detailCount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">
                      {t('admin_orgs_details_created')}
                    </dt>
                    <dd className="text-sm text-gray-900">{formatDateTime(detailCreated, '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">
                      {t('admin_orgs_details_updated')}
                    </dt>
                    <dd className="text-sm text-gray-900">{formatDateTime(detailUpdated, '—')}</dd>
                  </div>
                </dl>
                <section>
                  <h4 className="text-md font-semibold text-gray-900">
                    {t('admin_orgs_members_heading')}
                  </h4>
                  <form className="mt-3 flex flex-col gap-3" onSubmit={handleAddMember}>
                    <label className="text-sm font-medium text-gray-700" htmlFor="admin-orgs-member-input">
                      {t('admin_orgs_members_add_label')}
                      <input
                        id="admin-orgs-member-input"
                        className="input mt-1"
                        type="text"
                        value={memberInput}
                        placeholder={t('admin_orgs_members_add_placeholder')}
                        onChange={(event) => setMemberInput(event.target.value)}
                      />
                    </label>
                    <button type="submit" className="btn self-start" disabled={isAddingMember}>
                      {isAddingMember ? t('loading_text') : t('admin_orgs_members_add_submit')}
                    </button>
                  </form>
                  {detailError && (
                    <div className="mt-3">
                      <Alert kind="error" message={detailError} />
                    </div>
                  )}
                  {detailLoading ? (
                    <p className="mt-3 text-sm text-gray-600">{t('loading_text')}</p>
                  ) : members.length > 0 ? (
                    <ul
                      className="mt-3 divide-y divide-gray-200 rounded-md border border-gray-200"
                      aria-label={t('admin_orgs_members_list_label')}
                    >
                      {members.map((member) => (
                        <li key={member.id} className="flex items-start justify-between gap-3 p-3">
                          <div>
                            <div className="font-medium text-gray-900">{memberDisplayName(member)}</div>
                            {member.email && (
                              <div className="text-sm text-gray-600">{member.email}</div>
                            )}
                            <div className="text-xs text-gray-500">{member.id}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {t('admin_orgs_members_joined', {
                                date: formatDateTime(member.joined_at, '—'),
                              })}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => handleRemoveMember(member)}
                            disabled={removingMemberId === member.id}
                          >
                            {t('admin_orgs_members_remove')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-gray-600">{t('admin_orgs_members_empty')}</p>
                  )}
                </section>
              </div>
            </aside>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
