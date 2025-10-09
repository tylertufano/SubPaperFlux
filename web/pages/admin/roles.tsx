import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'
import { useFeatureFlags } from '../../lib/featureFlags'
import { useNumberFormatter } from '../../lib/format'
import { v1, type AdminRoleListItem, type AdminRolesPage } from '../../lib/openapi'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useRouter } from 'next/router'

type FilterState = {
  search: string
}

type RoleFormState = {
  name: string
  description: string
}

type FlashMessage = { kind: 'success' | 'error'; message: string }

type RolesKey = ['/v1/admin/roles', number, number, string]

function createEmptyFilters(): FilterState {
  return { search: '' }
}

function createRoleFormState(role?: Pick<AdminRoleListItem, 'name' | 'description'> | null): RoleFormState {
  return { name: role?.name ?? '', description: role?.description ?? '' }
}

export default function AdminRoles() {
  const { t } = useI18n()
  const { userMgmtCore, userMgmtUi, isLoaded: flagsLoaded } = useFeatureFlags()
  const rolesEnabled = userMgmtCore && userMgmtUi
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const numberFormatter = useNumberFormatter()
  const [formState, setFormState] = useState<FilterState>(createEmptyFilters)
  const [filters, setFilters] = useState<FilterState>(createEmptyFilters)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [selectedRole, setSelectedRole] = useState<AdminRoleListItem | null>(null)
  const [createForm, setCreateForm] = useState<RoleFormState>(createRoleFormState)
  const [editForm, setEditForm] = useState<RoleFormState>(createRoleFormState)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const createNameRef = useRef<HTMLInputElement | null>(null)
  const editNameRef = useRef<HTMLInputElement | null>(null)

  const openCreateDialog = useCallback(() => {
    setCreateForm(createRoleFormState())
    setIsCreateOpen(true)
  }, [])

  const closeCreateDialog = useCallback(() => {
    setIsCreateOpen(false)
    setCreateForm(createRoleFormState())
  }, [])

  const openEditDialog = useCallback((role: AdminRoleListItem) => {
    setSelectedRole(role)
    setEditForm(createRoleFormState(role))
    setIsEditOpen(true)
  }, [])

  const closeEditDialog = useCallback(() => {
    setIsEditOpen(false)
    setSelectedRole(null)
    setEditForm(createRoleFormState())
  }, [])

  useEffect(() => {
    if (!flash) return undefined
    const timer = window.setTimeout(() => setFlash(null), 5000)
    return () => window.clearTimeout(timer)
  }, [flash])

  useEffect(() => {
    if (isCreateOpen && createNameRef.current) {
      createNameRef.current.focus()
    }
  }, [isCreateOpen])

  useEffect(() => {
    if (isEditOpen && editNameRef.current) {
      editNameRef.current.focus()
    }
  }, [isEditOpen])

  useEffect(() => {
    if (!isCreateOpen && !isEditOpen) return undefined
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (isEditOpen) {
          closeEditDialog()
        } else if (isCreateOpen) {
          closeCreateDialog()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeCreateDialog, closeEditDialog, isCreateOpen, isEditOpen])

  const { search } = filters
  const canFetch = flagsLoaded && rolesEnabled

  const swrKey = useMemo<RolesKey | null>(
    () => (canFetch ? ['/v1/admin/roles', page, size, search] : null),
    [canFetch, page, size, search],
  )

  const { data, error, isLoading, mutate } = useSWR<AdminRolesPage, Error, RolesKey | null>(
    swrKey,
    ([, currentPage, pageSize, searchValue]) =>
      v1.listAdminRoles({
        page: currentPage,
        size: pageSize,
        search: searchValue ? searchValue.trim() : undefined,
      }),
  )

  const totalPages = data ? data.total_pages ?? Math.max(1, Math.ceil(data.total / Math.max(1, data.size))) : 1
  const hasPrev = Boolean(data && data.page > 1)
  const hasNext = Boolean(data && (data.has_next ?? data.page < totalPages))

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setFilters({ search: formState.search.trim() })
  }

  const handleClear = () => {
    const empty = createEmptyFilters()
    setFormState(empty)
    setFilters(empty)
    setPage(1)
    setSize(20)
  }

  const handleCreateSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = createForm.name.trim()
    if (!name) {
      setFlash({ kind: 'error', message: t('admin_roles_name_required') })
      return
    }
    setIsSubmitting(true)
    setFlash(null)
    try {
      const description = createForm.description.trim()
      await v1.createAdminRole({
        adminRoleCreate: {
          name,
          description: description ? description : undefined,
        },
      })
      setFlash({ kind: 'success', message: t('admin_roles_created_success', { name }) })
      setPage(1)
      closeCreateDialog()
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedRole) return
    const name = editForm.name.trim()
    if (!name) {
      setFlash({ kind: 'error', message: t('admin_roles_name_required') })
      return
    }
    setIsUpdating(true)
    setFlash(null)
    try {
      const description = editForm.description.trim()
      await v1.updateAdminRole({
        roleId: selectedRole.id,
        adminRoleUpdate: {
          name,
          description: description ? description : undefined,
        },
      })
      setFlash({ kind: 'success', message: t('admin_roles_updated_success', { name }) })
      closeEditDialog()
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDelete = async (role: AdminRoleListItem) => {
    if (role.is_system) return
    if (!window.confirm(t('admin_roles_delete_confirm', { name: role.name }))) {
      return
    }
    setDeletingId(role.id)
    setFlash(null)
    try {
      await v1.deleteAdminRole({ roleId: role.id })
      setFlash({ kind: 'success', message: t('admin_roles_deleted_success', { name: role.name }) })
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setDeletingId(null)
    }
  }

  if (!flagsLoaded) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 id="admin-roles-heading" className="text-xl font-semibold mb-1">
              {t('nav_roles')}
            </h2>
            <p className="text-gray-600 mb-4">{t('loading_text')}</p>
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  if (!rolesEnabled) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 id="admin-roles-heading" className="text-xl font-semibold mb-4">
              {t('nav_roles')}
            </h2>
            <Alert kind="info" message={t('admin_roles_disabled_message')} />
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
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 id="admin-roles-heading" className="text-xl font-semibold mb-1">
                {t('nav_roles')}
              </h2>
              <p className="text-gray-600 mb-2 md:mb-0">{t('admin_roles_description')}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn" onClick={openCreateDialog}>
                {t('admin_roles_add_role')}
              </button>
            </div>
          </div>
          <form
            className="card p-4 my-4"
            role="search"
            aria-labelledby="admin-roles-heading"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-roles-search">
                {t('admin_roles_search_label')}
                <input
                  id="admin-roles-search"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.search}
                  placeholder={t('admin_roles_search_placeholder')}
                  onChange={(event) => setFormState((prev) => ({ ...prev, search: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-roles-page-size">
                {t('admin_roles_page_size_label')}
                <select
                  id="admin-roles-page-size"
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
                      {t('admin_roles_total_count', { count: numberFormatter.format(data.total) })}
                    </p>
                  </div>
                  <table className="table" role="table" aria-label={t('admin_roles_table_label')}>
                    <thead className="bg-gray-100 dark:bg-gray-800">
                      <tr>
                        <th className="th" scope="col">
                          {t('admin_roles_column_name')}
                        </th>
                        <th className="th" scope="col">
                          {t('admin_roles_column_description')}
                        </th>
                        <th className="th" scope="col">
                          {t('admin_roles_column_assigned')}
                        </th>
                        <th className="th" scope="col">
                          {t('actions_label')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((role) => {
                        const assignedCount = role.assigned_user_count ?? 0
                        return (
                          <tr key={role.id} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-800 dark:even:bg-gray-900">
                            <td className="td align-top">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900">{role.name}</span>
                                {role.is_system ? (
                                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                                    {t('admin_roles_system_badge')}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="td align-top text-sm text-gray-700">
                              {role.description ? role.description : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="td align-top text-sm text-gray-700">
                              {numberFormatter.format(assignedCount)}
                            </td>
                            <td className="td align-top">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => openEditDialog(role)}
                                >
                                  {t('btn_edit')}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => handleDelete(role)}
                                  disabled={role.is_system || deletingId === role.id}
                                  title={role.is_system ? t('admin_roles_delete_system_disabled') : undefined}
                                >
                                  {t('btn_delete')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
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
                    icon={<span aria-hidden="true">🛡️</span>}
                    message={
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">{t('admin_roles_empty_title')}</p>
                        <p>{t('admin_roles_empty_description')}</p>
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
        {isCreateOpen && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeCreateDialog()
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-role-create-title"
              className="card w-full max-w-lg space-y-4 p-6"
            >
              <div className="flex items-start justify-between">
                <h3 id="admin-role-create-title" className="text-lg font-semibold text-gray-900">
                  {t('admin_roles_create_heading')}
                </h3>
                <button type="button" className="btn" onClick={closeCreateDialog} disabled={isSubmitting}>
                  {t('btn_cancel')}
                </button>
              </div>
              <form className="space-y-4" onSubmit={handleCreateSubmit}>
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="admin-role-create-name">
                    {t('admin_roles_name_label')}
                    <input
                      id="admin-role-create-name"
                      ref={createNameRef}
                      className="input mt-1 w-full"
                      type="text"
                      value={createForm.name}
                      placeholder={t('admin_roles_name_placeholder')}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                      required
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="admin-role-create-description">
                    {t('admin_roles_description_label')}
                    <input
                      id="admin-role-create-description"
                      className="input mt-1 w-full"
                      type="text"
                      value={createForm.description}
                      placeholder={t('admin_roles_description_placeholder')}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn" onClick={closeCreateDialog} disabled={isSubmitting}>
                    {t('btn_cancel')}
                  </button>
                  <button type="submit" className="btn" disabled={isSubmitting}>
                    {t('btn_create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {isEditOpen && selectedRole && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeEditDialog()
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-role-edit-title"
              className="card w-full max-w-lg space-y-4 p-6"
            >
              <div className="flex items-start justify-between">
                <h3 id="admin-role-edit-title" className="text-lg font-semibold text-gray-900">
                  {t('admin_roles_edit_heading', { name: selectedRole.name })}
                </h3>
                <button type="button" className="btn" onClick={closeEditDialog} disabled={isUpdating}>
                  {t('btn_cancel')}
                </button>
              </div>
              <form className="space-y-4" onSubmit={handleEditSubmit}>
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="admin-role-edit-name">
                    {t('admin_roles_name_label')}
                    <input
                      id="admin-role-edit-name"
                      ref={editNameRef}
                      className="input mt-1 w-full"
                      type="text"
                      value={editForm.name}
                      placeholder={t('admin_roles_name_placeholder')}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                      required
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="admin-role-edit-description">
                    {t('admin_roles_description_label')}
                    <input
                      id="admin-role-edit-description"
                      className="input mt-1 w-full"
                      type="text"
                      value={editForm.description}
                      placeholder={t('admin_roles_description_placeholder')}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn" onClick={closeEditDialog} disabled={isUpdating}>
                    {t('btn_cancel')}
                  </button>
                  <button type="submit" className="btn" disabled={isUpdating}>
                    {t('btn_save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
