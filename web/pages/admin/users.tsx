import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'
import { useFeatureFlags } from '../../lib/featureFlags'
import { useFormatDateTime, useNumberFormatter } from '../../lib/format'
import {
  v1,
  type AdminOrganization,
  type AdminOrganizationsPage,
  type AdminUser,
  type AdminUserOrganization,
  type AdminUsersPage,
  type RoleGrantRequest,
} from '../../lib/openapi'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useRouter } from 'next/router'

type FilterState = {
  search: string
  status: 'all' | 'active' | 'inactive'
  role: string
  organization: string
}

type UsersKey = [
  '/v1/admin/users',
  number,
  number,
  string,
  FilterState['status'],
  string,
  string,
]

type OrganizationSearchKey = ['/v1/admin/orgs/search', string]

const quotaFields = ['quota_credentials', 'quota_site_configs', 'quota_feeds', 'quota_api_tokens'] as const
type QuotaField = (typeof quotaFields)[number]

type QuotaFormState = Record<QuotaField, string>

type AdminUserUpdateInput = Partial<Record<QuotaField, number | null>> & {
  is_active?: boolean
  confirm?: boolean
}

type RoleFormState = {
  role: string
  description: string
  createMissing: boolean
}

const quotaFieldLabelKeys: Record<QuotaField, string> = {
  quota_credentials: 'admin_users_quota_label_credentials',
  quota_site_configs: 'admin_users_quota_label_site_configs',
  quota_feeds: 'admin_users_quota_label_feeds',
  quota_api_tokens: 'admin_users_quota_label_api_tokens',
}

type FlashMessage = { kind: 'success' | 'error'; message: string }

function createEmptyFilters(): FilterState {
  return { search: '', status: 'all', role: '', organization: '' }
}

function createQuotaFormState(user: AdminUser | null): QuotaFormState {
  return {
    quota_credentials: user?.quota_credentials != null ? String(user.quota_credentials) : '',
    quota_site_configs: user?.quota_site_configs != null ? String(user.quota_site_configs) : '',
    quota_feeds: user?.quota_feeds != null ? String(user.quota_feeds) : '',
    quota_api_tokens: user?.quota_api_tokens != null ? String(user.quota_api_tokens) : '',
  }
}

function createRoleFormState(): RoleFormState {
  return { role: '', description: '', createMissing: false }
}

function displayName(user: AdminUser): string {
  return user.full_name || user.email || user.id
}

function statusBadge(user: AdminUser, t: ReturnType<typeof useI18n>['t']): { label: string; className: string } {
  if (user.is_active) {
    return {
      label: t('admin_users_status_active_badge'),
      className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
    }
  }
  return {
    label: t('admin_users_status_inactive_badge'),
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  }
}

function organizationDisplayNameFromRecord(record: {
  id: string
  slug?: string | null
  name?: string | null
}): string {
  if (record.name && record.name.trim().length > 0) {
    return record.name
  }
  if (record.slug && record.slug.trim().length > 0) {
    return record.slug
  }
  return record.id
}

function sortUserOrganizations(orgs: AdminUserOrganization[] | undefined): AdminUserOrganization[] {
  if (!orgs || orgs.length === 0) {
    return []
  }
  return [...orgs].sort((a, b) => {
    const aDefault = Boolean(a.is_default)
    const bDefault = Boolean(b.is_default)
    if (aDefault !== bDefault) {
      return aDefault ? -1 : 1
    }
    if (a.joined_at !== b.joined_at) {
      return a.joined_at < b.joined_at ? -1 : 1
    }
    const aName = organizationDisplayNameFromRecord(a)
    const bName = organizationDisplayNameFromRecord(b)
    return aName.localeCompare(bName)
  })
}

function findOrganizationMatch(
  value: string,
  suggestions: AdminOrganization[],
  existing: AdminUserOrganization[],
  memberships: AdminUser['organization_memberships'],
): { id: string; name: string } | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()

  const search = <T,>(items: T[], resolver: (item: T) => { id: string; slug?: string | null; name?: string | null }) => {
    for (const item of items) {
      const { id, slug, name } = resolver(item)
      const display = organizationDisplayNameFromRecord({ id, slug, name })
      if (id === trimmed || id.toLowerCase() === lower) {
        return { id, name: display }
      }
      if (slug && (slug === trimmed || slug.toLowerCase() === lower)) {
        return { id, name: display }
      }
      if (name && (name === trimmed || name.toLowerCase() === lower)) {
        return { id, name: display }
      }
    }
    return null
  }

  return (
    search(suggestions, (org) => ({ id: org.id, slug: org.slug, name: org.name })) ??
    search(existing, (org) => ({ id: org.id, slug: org.slug, name: org.name })) ??
    search(memberships, (membership) => ({
      id: membership.organization_id,
      slug: membership.organization_slug,
      name: membership.organization_name,
    }))
  )
}

export default function AdminUsers() {
  const { t } = useI18n()
  const { userMgmtCore, userMgmtUi, isLoaded: flagsLoaded } = useFeatureFlags()
  const userMgmtEnabled = userMgmtCore && userMgmtUi
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
  const [roleForm, setRoleForm] = useState<RoleFormState>(createRoleFormState)
  const [organizationInput, setOrganizationInput] = useState('')
  const [overrideInput, setOverrideInput] = useState('')
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

  useEffect(() => {
    setRoleForm(createRoleFormState())
  }, [selected])

  useEffect(() => {
    if (!selected) {
      setOrganizationInput('')
      return
    }
    const sorted = sortUserOrganizations(selected.organizations)
    if (sorted.length > 0) {
      const primary = sorted[0]
      setOrganizationInput(primary.slug || organizationDisplayNameFromRecord(primary))
    } else {
      setOrganizationInput('')
    }
  }, [selected])

  useEffect(() => {
    setOverrideInput('')
  }, [selected])

  const { search: filterSearch, status: filterStatus, role: filterRole, organization: filterOrganization } = filters
  const canFetch = flagsLoaded && userMgmtEnabled

  const swrKey = useMemo<UsersKey | null>(
    () =>
      canFetch
        ? [
            '/v1/admin/users',
            page,
            size,
            filterSearch,
            filterStatus,
            filterRole,
            filterOrganization,
          ]
        : null,
    [canFetch, page, size, filterSearch, filterStatus, filterRole, filterOrganization],
  )

  const { data, error, isLoading, mutate } = useSWR<AdminUsersPage, Error, UsersKey | null>(
    swrKey,
    ([, currentPage, pageSize, search, statusValue, role, organization]) =>
      v1.listAdminUsersV1AdminUsersGet({
        page: currentPage,
        size: pageSize,
        search: search ? search.trim() : undefined,
        role: role ? role.trim() : undefined,
        organization_id: organization ? organization.trim() : undefined,
        isActive: statusValue === 'all' ? undefined : statusValue === 'active',
      }),
  )

  const trimmedOrganizationInput = organizationInput.trim()
  const organizationSearchKey = useMemo<OrganizationSearchKey | null>(
    () => (selected ? ['/v1/admin/orgs/search', trimmedOrganizationInput] : null),
    [selected, trimmedOrganizationInput],
  )

  const { data: organizationSearchResults } = useSWR<
    AdminOrganizationsPage,
    Error,
    OrganizationSearchKey | null
  >(
    organizationSearchKey,
    ([, search]) =>
      v1.listAdminOrganizationsV1AdminOrgsGet({
        page: 1,
        size: 20,
        search: search ? search.trim() : undefined,
      }),
  )

  const organizationSuggestions = organizationSearchResults?.items ?? []

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
      organization: formState.organization.trim(),
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

  const handleRoleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) {
      return
    }
    const trimmedRole = roleForm.role.trim()
    if (!trimmedRole) {
      setFlash({ kind: 'error', message: t('admin_users_roles_add_required') })
      return
    }
    const description = roleForm.description.trim()
    const payload: RoleGrantRequest | undefined =
      description || roleForm.createMissing
        ? {
            ...(description ? { description } : {}),
            ...(roleForm.createMissing ? { create_missing: true } : {}),
          }
        : undefined
    setPendingUserId(selected.id)
    setFlash(null)
    try {
      const updated = await v1.grantAdminUserRoleV1AdminUsersUserIdRolesRoleNamePost({
        userId: selected.id,
        roleName: trimmedRole,
        roleGrantRequest: payload,
      })
      setFlash({
        kind: 'success',
        message: t('admin_users_roles_add_success', {
          role: trimmedRole,
          name: displayName(updated),
        }),
      })
      setSelected(updated)
      setRoleForm(createRoleFormState())
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setPendingUserId(null)
    }
  }

  const handleRoleRemove = async (role: string) => {
    if (!selected) {
      return
    }
    const user = selected
    const confirmed = window.confirm(
      t('admin_users_roles_remove_confirm', { role, name: displayName(user) }),
    )
    if (!confirmed) {
      return
    }
    setPendingUserId(user.id)
    setFlash(null)
    try {
      await v1.revokeAdminUserRoleV1AdminUsersUserIdRolesRoleNameDelete({
        userId: user.id,
        roleName: role,
      })
      setFlash({
        kind: 'success',
        message: t('admin_users_roles_remove_success', { role, name: displayName(user) }),
      })
      setSelected((prev) => {
        if (!prev || prev.id !== user.id) {
          return prev
        }
        return { ...prev, roles: prev.roles.filter((existing) => existing !== role) }
      })
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setPendingUserId(null)
    }
  }

  const handleOrganizationSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) {
      return
    }
    const trimmed = organizationInput.trim()
    const match =
      findOrganizationMatch(
        trimmed,
        organizationSuggestions,
        selected.organizations,
        selected.organization_memberships,
      ) ?? null
    const targetId = match?.id ?? trimmed
    const memberships = selected.organization_memberships
    const removalTargets = targetId
      ? memberships.filter((membership) => membership.organization_id !== targetId)
      : memberships
    const hasTargetMembership = Boolean(
      targetId && memberships.some((membership) => membership.organization_id === targetId),
    )
    const shouldAdd = Boolean(targetId && !hasTargetMembership)
    if (removalTargets.length === 0 && !shouldAdd) {
      setFlash({ kind: 'error', message: t('admin_users_organization_no_changes') })
      return
    }
    setPendingUserId(selected.id)
    setFlash(null)
    try {
      for (const membership of removalTargets) {
        await v1.removeOrganizationMemberV1AdminOrgsOrganizationIdMembersUserIdDelete({
          organizationId: membership.organization_id,
          userId: selected.id,
        })
      }
      if (shouldAdd && targetId) {
        await v1.addOrganizationMemberV1AdminOrgsOrganizationIdMembersPost({
          organizationId: targetId,
          adminOrganizationMembershipChange: { user_id: selected.id },
        })
      }
      const updated = await v1.getAdminUserV1AdminUsersUserIdGet({ userId: selected.id })
      setSelected(updated)
      const userName = displayName(updated)
      let message: string
      if (targetId && (shouldAdd || removalTargets.length > 0)) {
        const updatedMatch =
          findOrganizationMatch(
            targetId,
            organizationSuggestions,
            updated.organizations,
            updated.organization_memberships,
          ) ?? {
            id: targetId,
            name: match?.name ?? organizationDisplayNameFromRecord({
              id: targetId,
              slug: trimmed,
              name: match?.name,
            }),
          }
        message = t('admin_users_organization_assign_success', {
          name: userName,
          organization: updatedMatch.name ?? updatedMatch.id,
        })
      } else if (removalTargets.length > 1) {
        message = t('admin_users_organization_remove_all_success', { name: userName })
      } else if (removalTargets.length === 1) {
        const removed = removalTargets[0]
        const removedName = organizationDisplayNameFromRecord({
          id: removed.organization_id,
          slug: removed.organization_slug,
          name: removed.organization_name,
        })
        message = t('admin_users_organization_remove_success', {
          name: userName,
          organization: removedName,
        })
      } else {
        message = t('admin_users_organization_update_success', { name: userName })
      }
      setFlash({ kind: 'success', message })
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setPendingUserId(null)
    }
  }

  const handleOverrideToggle = async (user: AdminUser, nextEnabled: boolean) => {
    setPendingUserId(user.id)
    setFlash(null)
    try {
      const updated = await v1.updateAdminUserRoleOverridesV1AdminUsersUserIdRoleOverridesPatch({
        userId: user.id,
        adminUserRoleOverridesUpdate: { enabled: nextEnabled },
      })
      setFlash({
        kind: 'success',
        message: nextEnabled
          ? t('admin_users_overrides_enabled_success', { name: displayName(updated) })
          : t('admin_users_overrides_disabled_success', { name: displayName(updated) }),
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

  const handleOverrideAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) {
      return
    }
    const trimmed = overrideInput.trim()
    if (!trimmed) {
      setFlash({ kind: 'error', message: t('admin_users_overrides_add_required') })
      return
    }
    const existing = selected.role_overrides?.preserve ?? []
    const normalized = new Set(existing.map((value) => value.toLowerCase()))
    if (normalized.has(trimmed.toLowerCase())) {
      setFlash({ kind: 'error', message: t('admin_users_overrides_add_exists') })
      return
    }
    setPendingUserId(selected.id)
    setFlash(null)
    try {
      const updated = await v1.updateAdminUserRoleOverridesV1AdminUsersUserIdRoleOverridesPatch({
        userId: selected.id,
        adminUserRoleOverridesUpdate: { preserve: [...existing, trimmed] },
      })
      setFlash({
        kind: 'success',
        message: t('admin_users_overrides_add_success', {
          role: trimmed,
          name: displayName(updated),
        }),
      })
      setOverrideInput('')
      setSelected(updated)
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setPendingUserId(null)
    }
  }

  const handleOverrideRemove = async (role: string) => {
    if (!selected) {
      return
    }
    const existing = selected.role_overrides?.preserve ?? []
    if (!existing.includes(role)) {
      return
    }
    setPendingUserId(selected.id)
    setFlash(null)
    try {
      const updated = await v1.updateAdminUserRoleOverridesV1AdminUsersUserIdRoleOverridesPatch({
        userId: selected.id,
        adminUserRoleOverridesUpdate: { preserve: existing.filter((value) => value !== role) },
      })
      setFlash({
        kind: 'success',
        message: t('admin_users_overrides_remove_success', {
          role,
          name: displayName(updated),
        }),
      })
      setSelected(updated)
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setPendingUserId(null)
    }
  }

  const handleOverrideClear = async () => {
    if (!selected) {
      return
    }
    const overrides = selected.role_overrides
    const hasState =
      overrides.enabled || overrides.preserve.length > 0 || overrides.suppress.length > 0
    if (!hasState) {
      return
    }
    const confirmed = window.confirm(
      t('admin_users_overrides_clear_confirm', { name: displayName(selected) }),
    )
    if (!confirmed) {
      return
    }
    setPendingUserId(selected.id)
    setFlash(null)
    try {
      const updated = await v1.clearAdminUserRoleOverridesV1AdminUsersUserIdRoleOverridesDelete({
        userId: selected.id,
      })
      setFlash({
        kind: 'success',
        message: t('admin_users_overrides_clear_success', { name: displayName(updated) }),
      })
      setOverrideInput('')
      setSelected(updated)
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setPendingUserId(null)
    }
  }

  if (!flagsLoaded) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 id="admin-users-heading" className="text-xl font-semibold mb-1">
              {t('nav_users')}
            </h2>
            <p className="text-gray-600 mb-4">{t('loading_text')}</p>
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  if (!userMgmtEnabled) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 id="admin-users-heading" className="text-xl font-semibold mb-4">
              {t('nav_users')}
            </h2>
            <Alert kind="info" message={t('admin_users_disabled_message')} />
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
          <h2 id="admin-users-heading" className="text-xl font-semibold mb-1">{t('nav_users')}</h2>
          <p className="text-gray-600 mb-4">{t('admin_users_description')}</p>
          <form
            className="card p-4 mb-4"
            role="search"
            aria-labelledby="admin-users-heading"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="admin-users-search">
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="admin-users-role">
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="admin-users-organization">
                {t('admin_users_organization_filter_label')}
                <input
                  id="admin-users-organization"
                  className="input mt-1 w-full"
                  type="text"
                  value={formState.organization}
                  placeholder={t('admin_users_organization_placeholder')}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, organization: event.target.value }))
                  }
                />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="admin-users-status">
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="admin-users-page-size">
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
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {t('admin_users_total_count', { count: numberFormatter.format(data.total) })}
                    </p>
                  </div>
                  <table className="table" role="table" aria-label={t('admin_users_table_label')}>
                    <thead className="bg-gray-100 dark:bg-gray-800">
                      <tr>
                        <th className="th" scope="col">{t('admin_users_column_identity')}</th>
                        <th className="th" scope="col">{t('admin_users_column_roles')}</th>
                        <th className="th" scope="col">{t('admin_users_column_groups')}</th>
                        <th className="th" scope="col">{t('admin_users_column_organizations')}</th>
                        <th className="th" scope="col">{t('admin_users_column_status')}</th>
                        <th className="th" scope="col">{t('admin_users_column_last_login')}</th>
                        <th className="th" scope="col">{t('actions_label')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((user) => {
                        const badge = statusBadge(user, t)
                        return (
                          <tr key={user.id} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-800 dark:even:bg-gray-900">
                            <td className="td align-top">
                              <div className="flex items-start gap-3">
                                <div className="mt-1 h-10 w-10 flex-none overflow-hidden rounded-full bg-gray-200 text-center text-sm font-semibold leading-10 text-gray-600 dark:bg-gray-700 dark:text-gray-200">
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
                                  <div className="font-medium text-gray-900 dark:text-gray-100">{displayName(user)}</div>
                                  <div className="text-sm text-gray-600">{user.email || t('admin_users_email_unknown')}</div>
                                  <div className="text-xs text-gray-500">{user.id}</div>
                                </div>
                              </div>
                            </td>
                            <td className="td align-top">
                              <div className="flex flex-wrap gap-1">
                                {user.roles.length === 0 && (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-200">
                                    {t('admin_users_roles_empty')}
                                  </span>
                                )}
                                {user.roles.map((role) => (
                                  <button
                                    key={role}
                                    type="button"
                                    className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                                    onClick={() => applyRoleFilter(role)}
                                  >
                                    {role}
                                  </button>
                                ))}
                                {user.is_admin && (
                                  <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                                    {t('admin_users_role_admin_badge')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="td align-top">
                              <div className="flex flex-wrap gap-1">
                                {user.groups.length === 0 && (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-200">
                                    {t('admin_users_groups_empty')}
                                  </span>
                                )}
                                {user.groups.map((group) => (
                                  <span
                                    key={group}
                                    className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                  >
                                    {group}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="td align-top">
                              <div className="flex flex-wrap gap-1">
                                {user.organizations.length === 0 && (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-200">
                                    {t('admin_users_organizations_empty')}
                                  </span>
                                )}
                                {sortUserOrganizations(user.organizations).map((organization) => (
                                  <span
                                    key={organization.id}
                                    className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                  >
                                    {organizationDisplayNameFromRecord(organization)}
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
                    icon={<span aria-hidden="true">🧑‍🤝‍🧑</span>}
                    message={(
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">{t('empty_admin_users_title')}</p>
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
                <h3 id="admin-user-drawer-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {displayName(selected)}
                </h3>
                <p className="text-sm text-gray-600">{selected.email || t('admin_users_email_unknown')}</p>
                {selected.organizations.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {sortUserOrganizations(selected.organizations)
                      .map((org) => organizationDisplayNameFromRecord(org))
                      .join(', ')}
                  </p>
                )}
              </div>
                <button type="button" className="btn" onClick={() => setSelected(null)} ref={closeButtonRef}>
                  {t('btn_close')}
                </button>
              </div>
              <div className="space-y-4 px-6 py-4">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_id_label')}</dt>
                    <dd className="text-sm text-gray-900 dark:text-gray-100 break-all">{selected.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_status')}</dt>
                    <dd className="text-sm text-gray-900 dark:text-gray-100">{statusBadge(selected, t).label}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_created')}</dt>
                    <dd className="text-sm text-gray-900 dark:text-gray-100">{formatDateTime(selected.created_at, '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_updated')}</dt>
                    <dd className="text-sm text-gray-900 dark:text-gray-100">{formatDateTime(selected.updated_at, '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_details_last_login')}</dt>
                    <dd className="text-sm text-gray-900 dark:text-gray-100">{formatDateTime(selected.last_login_at, t('admin_users_last_login_unknown'))}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-gray-600">{t('admin_users_overrides_status_label')}</dt>
                    <dd className="text-sm text-gray-900 dark:text-gray-100">
                      {selected.role_overrides.enabled
                        ? t('admin_users_overrides_status_enabled')
                        : t('admin_users_overrides_status_disabled')}
                    </dd>
                  </div>
                </dl>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-600">
                    {t('admin_users_details_organizations')}
                  </h4>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1">
                      {selected.organizations.length === 0 && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-200">
                          {t('admin_users_organizations_empty')}
                        </span>
                      )}
                      {sortUserOrganizations(selected.organizations).map((organization) => (
                        <span
                          key={organization.id}
                          className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        >
                          {organizationDisplayNameFromRecord(organization)}
                        </span>
                      ))}
                    </div>
                    <form className="space-y-3" onSubmit={handleOrganizationSubmit}>
                      <label
                        className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                        htmlFor="admin-user-organization-input"
                      >
                        {t('admin_users_organization_input_label')}
                        <input
                          id="admin-user-organization-input"
                          className="input mt-1 w-full"
                          type="text"
                          value={organizationInput}
                          placeholder={t('admin_users_organization_input_placeholder')}
                          onChange={(event) => setOrganizationInput(event.target.value)}
                          list="admin-user-organization-options"
                          disabled={pendingUserId === selected.id}
                        />
                      </label>
                      <datalist id="admin-user-organization-options">
                        {organizationSuggestions.map((organization) => {
                          const optionValue = organization.slug || organization.id
                          const label = organization.name
                            ? organization.slug
                              ? `${organization.name} (${organization.slug})`
                              : organization.name
                            : optionValue
                          return <option key={organization.id} value={optionValue} label={label} />
                        })}
                      </datalist>
                      <p className="text-xs text-gray-500">
                        {t('admin_users_organization_input_hint')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" className="btn" disabled={pendingUserId === selected.id}>
                          {t('admin_users_organization_update_button')}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setOrganizationInput('')}
                          disabled={pendingUserId === selected.id}
                        >
                          {t('admin_users_organization_clear_button')}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-600">{t('admin_users_details_roles')}</h4>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1">
                      {selected.roles.length === 0 && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-200">
                          {t('admin_users_roles_empty')}
                        </span>
                      )}
                      {selected.roles.map((role) => (
                        <div key={role} className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            onClick={() => {
                              applyRoleFilter(role)
                              setSelected(null)
                            }}
                          >
                            {role}
                          </button>
                          <button
                            type="button"
                            className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
                            onClick={() => handleRoleRemove(role)}
                            disabled={pendingUserId === selected.id}
                          >
                            {t('admin_users_roles_remove')}
                          </button>
                        </div>
                      ))}
                      {selected.is_admin && (
                        <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                          {t('admin_users_role_admin_badge')}
                        </span>
                      )}
                    </div>
                    <form className="space-y-3" onSubmit={handleRoleSubmit}>
                      <div className="grid gap-3">
                        <label
                          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                          htmlFor="admin-user-role-name"
                        >
                          {t('admin_users_roles_add_role_label')}
                          <input
                            id="admin-user-role-name"
                            className="input mt-1 w-full"
                            type="text"
                            value={roleForm.role}
                            placeholder={t('admin_users_roles_add_role_placeholder')}
                            onChange={(event) =>
                              setRoleForm((prev) => ({ ...prev, role: event.target.value }))
                            }
                            disabled={pendingUserId === selected.id}
                          />
                        </label>
                        <label
                          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                          htmlFor="admin-user-role-description"
                        >
                          {t('admin_users_roles_add_description_label')}
                          <input
                            id="admin-user-role-description"
                            className="input mt-1 w-full"
                            type="text"
                            value={roleForm.description}
                            placeholder={t('admin_users_roles_add_description_placeholder')}
                            onChange={(event) =>
                              setRoleForm((prev) => ({ ...prev, description: event.target.value }))
                            }
                            disabled={pendingUserId === selected.id}
                          />
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={roleForm.createMissing}
                            onChange={(event) =>
                              setRoleForm((prev) => ({ ...prev, createMissing: event.target.checked }))
                            }
                            disabled={pendingUserId === selected.id}
                          />
                          <span>{t('admin_users_roles_add_create_label')}</span>
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" className="btn" disabled={pendingUserId === selected.id}>
                          {t('admin_users_roles_add_submit')}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-600">{t('admin_users_overrides_heading')}</h4>
                  <p className="mb-3 text-sm text-gray-600">{t('admin_users_overrides_description')}</p>
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selected.role_overrides.enabled}
                      onChange={(event) => handleOverrideToggle(selected, event.target.checked)}
                      disabled={pendingUserId === selected.id}
                    />
                    <span>
                      {selected.role_overrides.enabled
                        ? t('admin_users_overrides_toggle_enabled')
                        : t('admin_users_overrides_toggle_disabled')}
                    </span>
                  </label>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-1">
                      {selected.role_overrides.preserve.length === 0 && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-200">
                          {t('admin_users_overrides_empty')}
                        </span>
                      )}
                      {selected.role_overrides.preserve.map((role) => (
                        <div key={role} className="flex items-center gap-1">
                          <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                            {role}
                          </span>
                          <button
                            type="button"
                            className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
                            onClick={() => handleOverrideRemove(role)}
                            disabled={pendingUserId === selected.id}
                          >
                            {t('admin_users_overrides_remove')}
                          </button>
                        </div>
                      ))}
                    </div>
                    <form className="flex flex-wrap gap-2" onSubmit={handleOverrideAdd}>
                      <label className="sr-only" htmlFor="admin-user-override-role">
                        {t('admin_users_overrides_add_label')}
                      </label>
                      <input
                        id="admin-user-override-role"
                        className="input w-full md:w-auto"
                        type="text"
                        value={overrideInput}
                        placeholder={t('admin_users_overrides_add_placeholder')}
                        onChange={(event) => setOverrideInput(event.target.value)}
                        disabled={pendingUserId === selected.id}
                      />
                      <button type="submit" className="btn" disabled={pendingUserId === selected.id}>
                        {t('admin_users_overrides_add_submit')}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={handleOverrideClear}
                        disabled={
                          pendingUserId === selected.id ||
                          (!selected.role_overrides.enabled &&
                            selected.role_overrides.preserve.length === 0 &&
                            selected.role_overrides.suppress.length === 0)
                        }
                      >
                        {t('admin_users_overrides_clear')}
                      </button>
                    </form>
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-600">{t('admin_users_details_groups')}</h4>
                  <div className="flex flex-wrap gap-1">
                    {selected.groups.length === 0 && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-200">
                        {t('admin_users_groups_empty')}
                      </span>
                    )}
                    {selected.groups.map((group) => (
                      <span
                        key={group}
                        className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      >
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
                        <label key={field} className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor={`quota-${field}`}>
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

